import SwiftUI

struct MiDiaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var toast: ToastManager
    @EnvironmentObject private var coachMarks: CoachMarksStore
    // ScenePhase — para cancelar dictado cuando la app va a background
    // (privacy: no dejar mic activo cuando el usuario sale de la app).
    @Environment(\.scenePhase) private var scenePhase
    @State private var focusBarText: String = ""
    // Texto retenido a la espera del consentimiento IA (5.1.2(i)) — solo se
    // envía al backend después de que el usuario acepte en la sheet.
    @State private var aiConsentPendingText: String? = nil
    @State private var showAllEvents: Bool = false
    /// Servicio de dictado inline en el FocusBar. NO es Nova Live.
    /// El transcript se va metiendo en `focusBarText` mientras el usuario
    /// habla; al detener, queda listo en la barra para que revise y mande.
    @StateObject private var dictationService = NovaLiveService()
    @State private var isDictating: Bool = false
    @State private var dictationDeniedMessage: String? = nil
    /// Evento que se está editando vía sheet. nil = sheet cerrado.
    @State private var editingEvent: FocusEvent? = nil
    /// Tarea que se está editando vía sheet. nil = sheet cerrado.
    @State private var editingTask: FocusTask? = nil
    /// Última respuesta inline de Nova. Se reemplaza al enviar otra petición
    /// y se puede cerrar manualmente. NO está en el store; es estado de UI.
    @State private var inlineResponse: InlineNovaResponse? = nil
    /// Acciones propuestas pendientes — cuando Nova devuelve mode=proposal
    /// (o el cliente degrada vía anti-basura), guardamos las actions aquí
    /// para que los botones "Aplicar / Editar / No por ahora" sepan qué
    /// ejecutar. Se limpia al aplicar, editar o descartar.
    @State private var pendingProposalActions: [BackendAction] = []
    /// userText original que generó la propuesta — sirve cuando aplicamos.
    @State private var pendingProposalUserText: String = ""
    // Descartes de demo viven ahora en `FocusDataStore` (persisten a disco).
    // Acceso: `store.dismissedDemoEventTitles` / `store.dismissedDemoTaskTitles`
    // y `store.dismissDemoEvent(title:)` / `store.dismissDemoTask(title:)`.

    /// 3 bloques visibles por defecto — más allá de eso es ruido.
    private let visibleEventsLimit: Int = 3

    // MARK: - Source of truth

    /// Eventos visibles: del usuario si tiene, demo si NO tiene Y está en
    /// modo demo (no logueado). Una cuenta real con 0 eventos muestra vacío
    /// real — nunca eventos falsos como si fueran propios.
    /// Recordatorios vencidos van separados en `overdueReminders`.
    private var displayEvents: [FocusEvent] {
        if store.hasUserEvents {
            return store.upcomingAndCurrentEventsToday()
        }
        guard store.isInDemoMode else { return [] }
        return DemoDataProvider.shared.exampleTodayEvents()
            .filter { !store.dismissedDemoEventTitles.contains($0.title) }
    }

    /// Recordatorios cuya hora ya pasó y siguen sin "atender". Se muestran
    /// arriba en Mi Día como una fila compacta con acciones (completar /
    /// borrar / reprogramar). Solo aparecen si hay alguno — sino la
    /// sección no se renderiza.
    private var overdueReminders: [FocusEvent] {
        guard store.hasUserEvents else { return [] }
        return store.overdueRemindersToday()
    }

    /// Eventos del día siguiente del usuario. Demo NO tiene datos para
    /// mañana — mostrarlos confundiría, así que devolvemos vacío. Filtramos
    /// cancelados defensivamente (en práctica eliminar = borrar físicamente,
    /// pero respetamos el contrato del enum) y ordenamos por hora.
    private var tomorrowEvents: [FocusEvent] {
        guard store.hasUserEvents else { return [] }
        let cal = Calendar.current
        guard let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) else {
            return []
        }
        return store.eventsFor(date: tomorrow)
            .filter { $0.status != .cancelled }
    }

    /// Preview de mañana: aparece siempre que el usuario tenga al menos un
    /// evento real agendado para el día siguiente. El usuario necesita
    /// feedback inmediato cuando Nova agenda algo "para mañana" — antes lo
    /// gatebamos a horario nocturno y eso ocultaba la confirmación visual
    /// si el evento se creaba de día.
    private var shouldShowTomorrowPreview: Bool {
        !tomorrowEvents.isEmpty
    }

    var body: some View {
        ZStack {
            // Theme 2.0 v4: ambient canvas animado tipo Gemini.
            // Reemplaza `Theme.Colors.background + AmbientCalmRadial` con
            // un componente vivo (2 halos cobalto + violet desplazándose
            // lentamente). El estado es .listening mientras dicta, .idle
            // el resto del tiempo — la app respira.
            FocusAmbientCanvas(state: isDictating ? .listening : .idle)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    header
                        .padding(.horizontal, Theme.Spacing.xl)
                        // Padding superior generoso para garantizar que
                        // "Mi Día" jamás quede bajo el Dynamic Island.
                        .padding(.top, Theme.Spacing.xxl)

                    focusBar
                        .padding(.horizontal, Theme.Spacing.xl)

                    // Respuesta inline de Nova: aparece DEBAJO del FocusBar al
                    // procesar una petición. Mi Día NO navega al Chat — toda
                    // la confirmación de acciones queda visible acá.
                    if let resp = inlineResponse {
                        InlineNovaResponseView(
                            response: resp,
                            onAction: { handleInlineAction(resp.action) },
                            onDismiss: {
                                withAnimation(.easeOut(duration: 0.20)) {
                                    inlineResponse = nil
                                }
                            },
                            onChipTap: { chip in
                                // Tres modos posibles según el chip:
                                // 1) sendText: el chip "escribe" texto.
                                // 2) proposalAction: aplica/edita/descarta
                                //    la propuesta pendiente.
                                // 3) Ambos nil: no-op (placeholder).
                                if let send = chip.sendText {
                                    withAnimation(.easeOut(duration: 0.18)) {
                                        inlineResponse = nil
                                    }
                                    processNovaInline(text: send)
                                } else if let action = chip.proposalAction {
                                    handleProposalChip(action)
                                }
                            }
                        )
                        .padding(.horizontal, Theme.Spacing.xl)
                        .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    // Antes acá iba un `ProximoBloqueCard` con el próximo evento.
                    // Lo sacamos: duplicaba el primer item del timeline más
                    // abajo (mismo evento renderizado dos veces). Ahora el
                    // timeline es la ÚNICA fuente de verdad para los bloques
                    // de hoy — el primer item recibe un badge "PRÓXIMO" para
                    // darle presencia visual sin duplicar.

                    if !overdueReminders.isEmpty {
                        overdueRemindersSection
                            .padding(.horizontal, Theme.Spacing.xl)
                    }

                    // Mi Día = SOLO eventos del calendario (con sus chips de
                    // reminder anclados). La sección "Pendientes de hoy" se
                    // retiró 2026-05-15 porque duplicaba la pestaña Tareas
                    // sin agregar valor — los pendientes viven ahí, no en
                    // la vista de timeline. Los reminders custom (texto
                    // anclado al evento) se ven dentro del card del evento
                    // padre, así que la sección de pendientes no aportaba.

                    timelineSection

                    nextDayPreviewSection

                    Spacer(minLength: Theme.Spacing.bottomBarSafety)
                }
                .padding(.top, Theme.Spacing.sm)
            }
            // Scroll dismisses keyboard: tan pronto como el usuario arrastra
            // hacia abajo, el teclado se baja. Patrón nativo iOS.
            .scrollDismissesKeyboard(.immediately)
            // Tap-outside dismiss: cualquier tap en el scroll cierra el
            // teclado. `.simultaneousGesture` corre en paralelo con los taps
            // de botones — no consume sus acciones.
            .simultaneousGesture(
                TapGesture().onEnded { _ in
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil, from: nil, for: nil
                    )
                }
            )
        }
        // Mic inline: el dictation service llena focusBarText en vivo.
        // Cuando el usuario detiene (toca el mic stop) y hay transcript,
        // el texto queda en la barra listo para revisar o enviar.
        // ChatGPT-style: durante la escucha NO escribimos transcript palabra
        // por palabra al input — eso ensucia visualmente y distrae. Solo
        // animamos el diamante de Nova. Cuando el dictado termina (state
        // pasa a `.idle`), volcamos el transcript final completo al input.
        // El usuario lo revisa y manda con el botón enviar.
        .onChange(of: dictationService.state) { _, newState in
            switch newState {
            case .listening:
                isDictating = true
                dictationDeniedMessage = nil
            case .processing:
                // Mientras el recognizer está cerrando: ya no captura más
                // audio. Mantenemos el estado "dictando" visualmente hasta
                // que pase a .idle con el transcript final.
                isDictating = true
            case .idle:
                isDictating = false
                // Volcar transcript final al input — recién acá el usuario
                // ve el texto, revisa y manda con enviar.
                let finalTranscript = dictationService.transcript
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !finalTranscript.isEmpty {
                    focusBarText = finalTranscript
                }
            case .denied:
                isDictating = false
                dictationDeniedMessage = "Activa el micrófono y voz en Ajustes del iPhone."
            case .error(let msg):
                isDictating = false
                dictationDeniedMessage = msg
            case .requestingPermissions:
                isDictating = false
            }
        }
        // Si el usuario cambia de tab mientras está dictando, cancelar
        // inmediatamente el mic. Sin esto el audio engine quedaba activo
        // grabando audio que el usuario no vería + audio session bloqueada
        // para otros sonidos (música, llamadas). Privacy + UX fix.
        .onChange(of: nav.selectedTab) { _, newTab in
            if isDictating && newTab != .miDia {
                dictationService.cancel()
            }
        }
        // Coach mark del FocusBar la primera vez que el usuario entra
        // a Mi Día. Solo se dispara una vez por dispositivo (flag en
        // UserDefaults). El usuario puede resetear desde Ajustes.
        .task(id: nav.selectedTab) {
            if nav.selectedTab == .miDia {
                // Pequeño delay para que la UI termine de aparecer antes
                // del overlay — evita parpadeo al boot.
                try? await Task.sleep(nanoseconds: 600_000_000)
                coachMarks.presentIfNeeded(.focusBar)
            }
        }
        // Mismo cleanup cuando la app va a background — sin esto el mic
        // sigue activo (técnicamente iOS lo permite breve, pero es un
        // mal patrón). El scenePhase change captura background, inactive
        // y active de forma consistente.
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background && isDictating {
                dictationService.cancel()
            }
        }
        // Binding derivado REAL (no `.constant`): con `.constant` SwiftUI
        // no puede escribir el cierre y el alert queda INMORTAL (bug
        // QA-closure 2026-06-10 — mismo fix que NovaView).
        .alert("Dictado no disponible", isPresented: Binding(
            get: { dictationDeniedMessage != nil },
            set: { if !$0 { dictationDeniedMessage = nil } }
        ), actions: {
            Button("Abrir Ajustes") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
                dictationDeniedMessage = nil
            }
            Button("Cerrar", role: .cancel) { dictationDeniedMessage = nil }
        }, message: {
            Text(dictationDeniedMessage ?? "")
        })
        // Sheets de edición — se abren desde el menú "Editar" de cualquier
        // evento o tarea real en Mi Día.
        .sheet(item: $editingEvent) { event in
            NuevoEventoSheet(editing: event) { updated in
                store.updateEvent(updated)
                toast.success("Evento actualizado")
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.Colors.background)
        }
        .sheet(item: $editingTask) { task in
            NuevaTareaSheet(editing: task) { updated in
                store.updateTask(updated)
                toast.success("Tarea actualizada")
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.Colors.background)
        }
        .sheet(
            isPresented: Binding(
                get: { aiConsentPendingText != nil },
                set: { presented in
                    // Swipe-down = "Ahora no": devolver el texto al input
                    // para que no se pierda lo escrito/dictado.
                    if !presented, let pending = aiConsentPendingText {
                        focusBarText = pending
                        aiConsentPendingText = nil
                    }
                }
            )
        ) {
            NovaAIConsentSheet(
                onAccept: {
                    NovaAIConsent.grant()
                    if let pending = aiConsentPendingText {
                        aiConsentPendingText = nil
                        processNovaInline(text: pending)
                    }
                },
                onDecline: {
                    if let pending = aiConsentPendingText {
                        focusBarText = pending
                        aiConsentPendingText = nil
                    }
                }
            )
            .presentationBackground(Theme.Colors.background)
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                FocusBrandRow()
                Spacer()
                HStack(spacing: Theme.Spacing.sm) {
                    bandejaButton
                    profileButton
                }
            }
            Text("Mi Día")
                .font(Theme.Typography.displayHero)
                .tracking(Theme.Tracking.displayHero)
                .foregroundStyle(Theme.Colors.textPrimary)
            // Subtítulo con tracking body para coherencia con el sistema.
            Text(headerSubtitle)
                .font(Theme.Typography.subhead)
                .tracking(Theme.Tracking.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }


    /// Subtítulo del header: solo el estado del día con el conteo de
    /// bloques (eventos). Después de retirar "Pendientes de hoy" (2026-05-15),
    /// el contador de pendientes ya no aparece acá — vive en la pestaña
    /// Tareas. Ejemplos:
    /// - 0 bloques → "Día libre"
    /// - 1 bloque  → "1 bloque"
    /// - 3 bloques → "3 bloques"
    private var headerSubtitle: String {
        let blocks = displayEvents.count
        if blocks == 0 {
            return "Día libre"
        }
        return blocks == 1 ? "1 bloque" : "\(blocks) bloques"
    }

    private var bandejaButton: some View {
        Button {
            HapticManager.shared.tap()
            nav.openNova(segment: .bandeja)
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "tray.full")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .frame(width: 42, height: 42)
                    // Theme 2.0: hairline border + sombra Z-1 más fina.
                    .background(
                        Circle()
                            .fill(Theme.Colors.surface)
                            .overlay(
                                Circle().strokeBorder(Theme.Colors.borderHairline, lineWidth: Theme.Stroke.hairline)
                            )
                    )
                    .focusCardShadow()
                if store.pendingDisplaySuggestions.count > 0 {
                    // Dot Nova con glow sutil — el aviso debe sentirse vivo.
                    Circle()
                        .fill(Theme.Colors.novaAccent)
                        .frame(width: 10, height: 10)
                        .overlay(Circle().strokeBorder(Theme.Colors.background, lineWidth: 2))
                        .shadow(color: Theme.Colors.novaAccent.opacity(0.55), radius: 4, y: 0)
                        .offset(x: 2, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Bandeja de Nova")
    }

    private var profileButton: some View {
        Button {
            HapticManager.shared.tap()
            withAnimation(Theme.Spring.settle) {
                nav.selectedTab = .ajustes
            }
        } label: {
            Circle()
                .fill(Theme.Colors.surface)
                .frame(width: 42, height: 42)
                .overlay(
                    Circle().strokeBorder(Theme.Colors.borderHairline, lineWidth: Theme.Stroke.hairline)
                )
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.Colors.textSecondary)
                )
                .focusCardShadow()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ajustes")
    }

    // MARK: - FocusBar (entry point omnipresente a Nova)

    private var focusBar: some View {
        // El placeholder cambia a "Habla ahora…" durante el dictado para
        // dar feedback semántico sin ocupar espacio extra en pantalla.
        // El diamante de Nova en sí pulsa (glow gradient) cuando isDictating
        // = true — eso reemplaza el label flotante "Escuchando…" que antes
        // chocaba con el diseño.
        FocusBarInput(
            text: $focusBarText,
            placeholder: isDictating ? "Habla ahora…" : "Pregúntale a Nova…",
            onSubmit: {
                let text = focusBarText
                focusBarText = ""
                UIApplication.shared.sendAction(
                    #selector(UIResponder.resignFirstResponder),
                    to: nil, from: nil, for: nil
                )
                processNovaInline(text: text)
            },
            onMic: {
                HapticManager.shared.tap()
                // Coach mark del mic la primera vez. Lo disparamos ANTES
                // de empezar el dictado para que el usuario entienda el
                // flujo (escucha → revisa → envía) antes de empezar.
                if coachMarks.shouldShow(.mic) {
                    coachMarks.presentIfNeeded(.mic)
                    return
                }
                // Mic del FocusBar = DICTADO INLINE. NO abre Nova Live,
                // NO abre sheet, NO cambia de pantalla.
                Task { await toggleInlineDictation() }
            },
            isDictating: isDictating,
            audioLevel: CGFloat(dictationService.audioLevel)
        )
    }

    // MARK: - Nova inline (interacción principal desde Mi Día)

    /// Procesa la petición del usuario:
    /// 1. Si hay sesión (`syncCredentials` no es nil), llama al backend
    ///    `/api/focus-assistant` vía `NovaService`. Si responde OK,
    ///    aplica las `actions` al store (sync Supabase automático) y
    ///    muestra el `reply` como inline response.
    /// 2. Si el backend falla con error "esperable" (401/429/timeout/red/
    ///    quota), cae a `NovaResponder.parse` con una nota sutil al final.
    /// 3. Si está en modo demo o no logueado, va directo al parser local
    ///    (sin llamar backend, sin nota).
    /// Mantiene la inline response abajo del FocusBar — no navega al chat.
    /// Toggle del dictado inline. Si NO está dictando, pide permisos y
    /// arranca; el transcript llena `focusBarText` en vivo via `.onChange`.
    /// Si YA está dictando, lo detiene — el texto queda en la barra para
    /// que el usuario revise y mande con el botón enviar.
    private func toggleInlineDictation() async {
        if isDictating {
            dictationService.stop()
            return
        }
        // Limpiar transcript previo si el usuario va a empezar de cero.
        // Si quería dictar después de un texto que ya escribió, se respeta.
        let auth = await dictationService.currentAuthorizationStatus()
        switch auth {
        case .authorized:
            await dictationService.start()
        case .notDetermined:
            if await dictationService.requestAuthorization() {
                await dictationService.start()
            }
        case .denied:
            dictationDeniedMessage = "Activa el micrófono y voz en Ajustes del iPhone para usar el dictado."
        }
    }

    private func processNovaInline(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Consentimiento IA (5.1.2(i)): con sesión activa el mensaje sale al
        // backend, así que antes del PRIMER envío pedimos permiso nombrando
        // al proveedor. En demo el parser local no manda nada fuera del
        // dispositivo — no gatea.
        if store.syncCredentials != nil && !NovaAIConsent.granted {
            aiConsentPendingText = trimmed
            return
        }

        HapticManager.shared.tap()

        // Loading inmediato — el usuario ve la card "processing" mientras se
        // decide el path (local o remoto). Copy humano, no técnico.
        withAnimation(.easeInOut(duration: 0.18)) {
            inlineResponse = InlineNovaResponse(
                userText: trimmed,
                summary: "Nova está ordenando esto…",
                isLoading: true,
                tone: .processing
            )
        }

        Task { @MainActor in
            let response = await resolveNovaResponse(for: trimmed)
            withAnimation(.easeInOut(duration: 0.20)) {
                inlineResponse = response
            }
            // Registrar el turno en el historial compartido (`novaMessages`)
            // para que el SIGUIENTE mensaje le mande el contexto al backend.
            // Sin esto, Mi Día solo leía el historial y nunca escribía → el
            // backend no podía resolver "muévela", "ponle…", "esa llamada".
            // (Bug de memoria multi-turno reportado 2026-06-13.) No registramos
            // estados de carga; sí registramos respuestas finales (incluido
            // fallback/clarify) porque son lo que el usuario "habló" con Nova.
            if !response.isLoading {
                let reply = [response.summary, response.details]
                    .compactMap { $0 }
                    .joined(separator: " ")
                store.recordInlineNovaTurn(userText: trimmed, assistantReply: reply)
            }
        }
    }

    /// Decide backend vs. fallback local y devuelve el `InlineNovaResponse`
    /// final. Estrategia:
    /// 1. Pre-parse local (cheap). Si el intent requiere contexto del cliente
    ///    (correcciones al último ítem, follow-up de pending, comandos meta),
    ///    se short-circuit y NO se llama al backend — el backend no tiene
    ///    el `lastEventId` ni el pending, así que no podría resolverlos.
    /// 2. Si el local diría clarify con título, guardar pending preventivo
    ///    para que el siguiente turno corto se pueda completar localmente
    ///    aunque el backend haya respondido.
    /// 3. Llamar backend con accessToken; fallback local en errores recuperables.
    private func resolveNovaResponse(for trimmed: String) async -> InlineNovaResponse {
        // [NovaMemory V3 — 2026-05-28] Comandos meta de memoria SIEMPRE
        // local ("qué sabes de mí", "olvida X") — son operaciones sobre
        // UserDefaults.
        if let memoryReply = store.handleMemoryCommand(trimmed: trimmed) {
            return InlineNovaResponse(
                userText: trimmed,
                summary: memoryReply,
                tone: .success
            )
        }

        // [NovaMemory V3] APRENDIZAJE local como PRIMERA línea: "X es mi Y",
        // "la agustina es mi polola", "mi mamá se llama Susana", etc.
        // Lo detectamos con `tryLearnFromUserText` (lista de roles ampliada
        // post-2026-05-27) y guardamos AL TIRO — funciona en demo, offline
        // y logueado. Instant, sin esperar al backend. Si el LLM además lo
        // ve, hace upsert idempotente. Esto arregla el caso demo donde
        // "la agustina es mi polola" devolvía "cuéntame más detalle".
        if let learned = NovaMemoryStore.shared.tryLearnFromUserText(trimmed) {
            let reply = store.replyForLearnedMemory(learned)
            HapticManager.shared.success()
            return InlineNovaResponse(
                userText: trimmed,
                summary: reply,
                tone: .success
            )
        }

        // Short-circuit ATTACH-REMINDER: "acuérdame N min antes de X" donde
        // X coincide con un evento existente de hoy. Lo resolvemos local
        // SIN llamar al backend — la respuesta es corta, predecible y no
        // depende de que el modelo siga las reglas. Si el patrón existe
        // pero no encontramos el evento, devolvemos clarify con chips
        // para que el usuario decida (crear bloque / tarea).
        if let response = tryAttachReminderToExistingEvent(userText: trimmed) {
            return response
        }

        // Short-circuit REMINDER ABSOLUTO: "[evento] a las X acuérdame a
        // las Y" (caso A — crear evento nuevo con offset calculado) o
        // "acuérdame a las Y de [evento existente]" (caso B — adjuntar
        // a existing). El detector multi-action antes marcaba esto como
        // complejo y mostraba "envíalas por separado" — bug reportado
        // el 2026-05-13 con "Tengo clases a las 1:30 acuérdame a las 12:50".
        if let response = tryReminderAbsoluteFlow(userText: trimmed) {
            return response
        }

        // Short-circuit RECORDATORIO SIN EVENTO NOMBRADO: "acuérdame 25 min
        // antes" (sin "de X"). Es el follow-up natural tras crear un evento
        // ("psicóloga mañana a las 4" → "acuérdame 25 min antes"). Lo
        // anclamos al evento en foco (`novaContext.topicEvent`) y aplicamos
        // local SIN tocar el backend. Antes, logueado, esto iba al backend y
        // el modelo adivinaba mal el evento (anclaba a uno demo). Resolverlo
        // acá lo hace determinista y testeable con la suite local.
        if let response = tryAttachBareReminderToTopicEvent(userText: trimmed) {
            return response
        }

        let preIntent = NovaResponder.parse(trimmed, context: store.novaContext)
        // Frase con múltiples acciones encadenadas o referencias temporales
        // en palabras ("en una hora", "más o menos a las 12"). El parser
        // local NO sabe separar estas con confianza — fuerza al backend
        // (IA fuerte). Si el backend falla, pedimos al usuario que las
        // envíe por separado en vez de crear basura localmente.
        let isComplex = NovaResponder.isLikelyMultiAction(trimmed)

        // 1. Short-circuit: intents que requieren contexto local que el
        //    backend no tiene (corrige/borra último ítem, follow-up
        //    pending resuelto, comandos meta del cliente).
        //    EXCEPCIÓN (2026-06-13, "Nova más humana"): si el intent es un
        //    resumen/meta (reviewToday/reviewPending/organizeDay) pero el
        //    mensaje es claramente conversacional/de consejo/emocional, NO
        //    cortamos local — lo manda la IA. Bug: "lo que tengo mañana me
        //    siento abrumado, cómo me recomiendas organizar" matcheaba la
        //    subcadena "que tengo mañana" → resumen robótico "0 eventos hoy"
        //    sin empatía ni el día correcto. La IA da una respuesta humana.
        if shouldShortCircuit(preIntent),
           !shouldDeferToBackendForHumanAnswer(preIntent, text: trimmed) {
            return executeIntent(preIntent, userText: trimmed)
        }

        // 2. Save pending preventivo si local diría clarify con título.
        if case .clarify(let reason) = preIntent,
           let pending = buildPendingClarification(
               from: reason,
               userText: trimmed,
               source: .inlineMiDia
           ) {
            store.setPendingClarification(pending)
        }

        // 3. Sin sesión activa → parser local directo (incluso para frases
        // complejas). `runLocalFallback` ya tiene multi-intent splitting
        // por "luego/después/también" + smart " y " split. Si logra crear
        // al menos un ítem, devuelve éxito multi-intent; si no, cae a un
        // mensaje útil (no "no pude separar" genérico).
        guard let creds = store.syncCredentials else {
            return runLocalFallback(for: trimmed, withNote: nil)
        }

        // Antes de mandar al backend, promover en discussedEvents
        // cualquier evento mencionado por título en este mensaje. Así Nova
        // IA recibe el topic focus actualizado.
        store.detectAndPromoteMentions(in: trimmed)

        // Logging: arranca el turno. El ID nos sigue hasta el outcome final.
        let eventsForContext = visibleEventsForContext()
        let tasksForContext = visibleTasksForContext()
        let history = recentNovaHistory()
        let discussedIds = store.novaContext.freshDiscussedEvents.map { $0.eventId }
        let logId = await MainActor.run {
            NovaDevLog.shared.startRequest(
                source: .inlineMiDia,
                userText: trimmed,
                eventsCount: eventsForContext.count,
                tasksCount: tasksForContext.count,
                discussedEventsCount: discussedIds.count,
                historyTurns: history.count
            )
        }

        do {
            let result = try await NovaService.send(
                message: trimmed,
                events: eventsForContext,
                tasks: tasksForContext,
                history: history,
                accessToken: creds.accessToken,
                surface: .inlineMiDia,
                discussedEventIds: discussedIds,
                userMemories: NovaMemoryStore.shared
                    .allActiveMemoriesHuman(maxEntries: 30)
                    .map { $0.text }
            )
            // Registrar la respuesta del backend.
            await MainActor.run {
                NovaDevLog.shared.recordModelResponse(
                    id: logId,
                    mode: result.mode.rawValue,
                    confidence: result.confidence,
                    shouldAskUser: result.shouldAskUser,
                    actionsCount: result.actions.count,
                    proposedActionsCount: result.proposedActions.count,
                    assistantMessage: result.reply
                )
            }
            return await applyBackendResult(result, userText: trimmed, logId: logId)
        } catch let error as NovaServiceError {
            // ──────────────────────────────────────────────────────────
            // SESIÓN EXPIRADA: honestidad sobre "Listo". El user spec
            // exige: NO ejecutar el local como si hubiera guardado en la
            // nube, NO decir "Listo", NO mostrar la card como si se
            // hubiera creado. Mostrar mensaje claro: "Tu sesión expiró".
            //
            // El usuario NO pierde el texto: queda en el input y puede
            // reintentar tras iniciar sesión. Esto es más honesto que
            // crear localmente y dejar un huevo de pascua sin sync que
            // confunde al usuario cuando vuelva al servidor.
            // ──────────────────────────────────────────────────────────
            if case .unauthorized = error {
                await MainActor.run {
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .error, error: "unauthorized")
                }
                return InlineNovaResponse(
                    userText: trimmed,
                    summary: "Tu sesión expiró.",
                    details: "Vuelve a iniciar sesión para guardar esto.",
                    isError: true
                )
            }
            // Política 2026-05-13 v3: aunque la frase sea compleja, si el
            // backend falla intentamos el parser local. `runLocalFallback`
            // tiene multi-intent + smart " y " split + reordenamiento de
            // segmentos. Si logra ejecutar 1+ acción, devolvemos eso. Si
            // ni eso logra, devuelve un mensaje útil mostrando lo que SÍ
            // entendió en vez del genérico "no pude separar".
            if error.canFallbackToLocal {
                // LOG CLARO del error REAL (user spec 2026-06-13): el fallback
                // logueado debe verse en consola, no pasar desapercibido.
                debugLog("[Nova] ⚠️ FALLBACK LOGUEADO (Mi Día): backend falló → \(error.debugLabel). Usando parser local de respaldo.")
                await MainActor.run {
                    NovaDevLog.shared.recordModelSelection(id: logId, model: .localFallback,
                                                          reason: "backend error: \(error.debugLabel)")
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .actionApplied,
                                                    error: nil)
                }
                let note = humanFallbackNote(for: error)
                return runLocalFallback(for: trimmed, withNote: note)
            }
            // Errores sin fallback (mensaje vacío, demasiado largo).
            await MainActor.run {
                NovaDevLog.shared.finishRequest(id: logId, outcome: .error,
                                                error: error.errorDescription ?? "no_fallback")
            }
            return InlineNovaResponse(
                userText: trimmed,
                summary: error.errorDescription ?? "Algo no salió bien al procesar eso.",
                details: "Intenta decírmelo de otra forma o más corto. Si quieres, sepáralo en pasos y te ayudo uno por uno.",
                tone: .clarify
            )
        } catch {
            // Error inesperado (no NovaServiceError): también visible + logueado.
            // El fallback logueado NUNCA es silencioso (user spec 2026-06-13).
            debugLog("[Nova] ⚠️ FALLBACK LOGUEADO (Mi Día): error inesperado → \(error). Usando parser local de respaldo.")
            await MainActor.run {
                NovaDevLog.shared.recordModelSelection(id: logId, model: .localFallback,
                                                      reason: "unknown error fallback")
                NovaDevLog.shared.finishRequest(id: logId, outcome: .actionApplied)
            }
            return runLocalFallback(
                for: trimmed,
                withNote: "No pude contactar a Nova (IA) — usé el modo local de respaldo. Vuelve a intentarlo en un momento."
            )
        }
    }

    /// Respuesta cuando el usuario manda una frase compleja (multi-acción)
    /// y NO tiene sesión activa. Sin IA fuerte no podemos separar las
    /// acciones con seguridad — proponemos enviarlas una por una.
    ///
    /// Tono asistente real: no "no puedo", sino "lo hago mejor si me lo
    /// pasas en partes". No usamos "isError: true" porque visualmente
    /// arroja un tono ámbar/rojo de fallo que no corresponde a UX
    /// normal de demo mode.
    private func complexInputNoSessionResponse(trimmed: String) -> InlineNovaResponse {
        InlineNovaResponse(
            userText: trimmed,
            summary: "Probemos en partes.",
            details: "Tu mensaje tiene varias cosas. Inicia sesión y las agendo todas juntas, o pásame una por una desde aquí.",
            action: .dismiss,
            isError: false,
            tone: .clarify
        )
    }

    /// Respuesta cuando el backend falló procesando una frase compleja.
    /// MISMA política: no caer al parser local porque solo entendería una
    /// de las acciones. Pedimos enviarlas separadas con tono asistente.
    private func complexInputBackendErrorResponse(
        trimmed: String,
        error: NovaServiceError?
    ) -> InlineNovaResponse {
        InlineNovaResponse(
            userText: trimmed,
            summary: "Mejor lo hacemos en partes.",
            details: "Estoy teniendo problemas para procesar todo junto. Pásame las acciones por separado y las agendo igual de bien — por ejemplo, primero «jugar fútbol en una hora», después «volver en dos horas».",
            action: .dismiss,
            isError: false,
            tone: .clarify
        )
    }

    /// Short-circuit "acuérdame N min antes de X" → attach reminder al
    /// evento existente. Devuelve `nil` si el input NO matchea el patrón
    /// — el flujo normal sigue. Si matchea y encuentra el evento, hace
    /// el edit local SIN llamar al backend (más rápido, sin AI, copy
    /// limpio garantizado). Si matchea pero no encuentra el evento,
    /// devuelve un clarify con chips ("crear bloque" / "agregar tarea").
    ///
    /// El usuario reportó (2026-05-13) que Nova respondía con frases
    /// largas y técnicas tipo "Listo, te aviso 10 minutos antes de tu
    /// ducha a las 9:50 AM. No moví ni edité el evento existente..."
    /// — eso era el modelo (Sonnet) generando texto sin ceñirse al
    /// prompt. Resolviendo local nos aseguramos copy corto y predecible.
    private func tryAttachReminderToExistingEvent(userText: String) -> InlineNovaResponse? {
        guard let intent = NovaResponder.extractReminderAttachIntent(from: userText) else {
            return nil
        }
        // Antes de matchear, promover en discussedEvents cualquier evento
        // mencionado por título en el texto del user — eso refresca el
        // topic focus para el fallback de abajo.
        store.detectAndPromoteMentions(in: userText)

        let todayEvents = store.todayEvents()
        // 1) Match por título aproximado contra eventos de hoy.
        var matched = NovaResponder.findEventByApproxTitle(
            intent.activity, in: todayEvents
        )
        // 2) Topic-focus fallback: si NO hay match en hoy, pero hay un
        //    evento "en discusión" reciente (creado/editado/mencionado en
        //    los últimos 30 min), anclamos a ese. El "activity" pasa a
        //    ser una NOTA del reminder, no el título del evento.
        //
        //    Caso del user spec (2026-05-15):
        //      Turno 1: "tengo partido tipo 3" → partido.
        //      Turno 2: "acuérdame 20 min antes de echar las zapatillas"
        //              → activity="echar las zapatillas". No matchea ningún
        //                evento por título. Pero topicEvent = Partido →
        //                anclar reminder a Partido con note="Echar las zapatillas".
        var attachedViaTopicFocus = false
        if matched == nil, let topic = store.novaContext.topicEvent,
           let topicEvent = store.events.first(where: { $0.id == topic.eventId }),
           topicEvent.startTime > Date() {
            matched = topicEvent
            attachedViaTopicFocus = true
        }
        guard let matched else {
            // Sin match ni topic focus — pregunta.
            return missingEventForAttachReminder(
                activity: intent.activity,
                offset: intent.offsetMinutes,
                userText: userText
            )
        }

        let existing = matched.reminderOffsets ?? []
        if existing.contains(intent.offsetMinutes) {
            // Duplicado — informar al usuario y NO mutar.
            return InlineNovaResponse(
                userText: userText,
                summary: "Ese aviso ya estaba agregado.",
                details: "«\(matched.title)» · 🔔 \(humanReminderLabel(intent.offsetMinutes))",
                action: .openCalendar,
                isError: false,
                tone: .clarify
            )
        }

        // Aplicar: añadir offset al evento (sin tocar título / hora /
        // categoría). Si caímos vía topic focus, el activity pasa a ser
        // la NOTA del nuevo offset — array paralelo de reminderNotes
        // alineado con reminderOffsets.
        var updated = matched
        let newOffsets = (existing + [intent.offsetMinutes]).sorted()
        updated.reminderOffsets = newOffsets
        if attachedViaTopicFocus {
            // Capitalizar primera letra del activity para que sea legible
            // como texto de notif ("Echar las zapatillas a la mochila").
            let noteText: String = {
                guard let first = intent.activity.first else { return intent.activity }
                return first.uppercased() + intent.activity.dropFirst()
            }()
            // Reconstruir notes alineadas al nuevo orden de offsets.
            var notesByOffset: [Int: String] = [:]
            for (i, off) in existing.enumerated() {
                if let oldNote = matched.reminderNote(at: i) {
                    notesByOffset[off] = oldNote
                }
            }
            notesByOffset[intent.offsetMinutes] = noteText
            updated.reminderNotes = newOffsets.map { notesByOffset[$0] ?? "" }
        }
        store.updateEvent(updated)
        HapticManager.shared.success()

        let fireTime = matched.startTime.addingTimeInterval(-Double(intent.offsetMinutes) * 60)
        let fireLabel = DateFormatters.hourMinute.string(from: fireTime)

        // Si caímos vía topic focus, mencionamos el evento padre para que
        // el user vea que adivinamos bien (y pueda corregir si no).
        let summary: String
        if attachedViaTopicFocus {
            summary = "Listo. Te aviso \(humanReminderLabel(intent.offsetMinutes)) antes de «\(matched.title)»."
        } else {
            summary = "Listo. Añadí un aviso a «\(matched.title)»."
        }

        return InlineNovaResponse(
            userText: userText,
            summary: summary,
            details: "🔔 \(humanReminderLabel(intent.offsetMinutes)) · \(fireLabel)",
            action: .openCalendar,
            isError: false,
            tone: .success
        )
    }

    /// Short-circuit para "acuérdame N min antes" SIN nombrar el evento ni
    /// dar hora absoluta — el clásico follow-up tras crear un evento. Se
    /// ancla al evento en foco (`novaContext.topicEvent`: el último que el
    /// usuario creó, editó o mencionó, vivo 30 min). Determinista: no
    /// depende del backend ni de que el modelo siga las reglas de topic
    /// focus. Si NO hay un evento en foco futuro, devolvemos nil y dejamos
    /// que el flujo normal (parser local / backend) decida — no adivinamos.
    private func tryAttachBareReminderToTopicEvent(userText: String) -> InlineNovaResponse? {
        guard let offset = NovaResponder.extractBareReminderOffset(from: userText) else {
            return nil
        }
        // Por si el user nombró el evento en este mismo mensaje de forma que
        // el extractor de arriba no capturó: refresca el topic focus.
        store.detectAndPromoteMentions(in: userText)
        guard let topic = store.novaContext.topicEvent,
              let event = store.events.first(where: { $0.id == topic.eventId }),
              event.startTime > Date() else {
            return nil
        }

        let existing = event.reminderOffsets ?? []
        if existing.contains(offset) {
            return InlineNovaResponse(
                userText: userText,
                summary: "Ese aviso ya estaba agregado.",
                details: "«\(event.title)» · 🔔 \(humanReminderLabel(offset))",
                action: .openCalendar,
                isError: false,
                tone: .clarify
            )
        }

        // Añadir el offset sin tocar título/hora. El aviso nuevo no lleva
        // nota (el user no dio detalle); reconstruimos `reminderNotes`
        // alineadas al nuevo orden de offsets para no desfasar las existentes.
        var updated = event
        let newOffsets = (existing + [offset]).sorted()
        updated.reminderOffsets = newOffsets
        if event.reminderNotes?.isEmpty == false {
            var notesByOffset: [Int: String] = [:]
            for (i, off) in existing.enumerated() {
                if let oldNote = event.reminderNote(at: i) { notesByOffset[off] = oldNote }
            }
            updated.reminderNotes = newOffsets.map { notesByOffset[$0] ?? "" }
        }
        store.updateEvent(updated)
        HapticManager.shared.success()

        let fireTime = event.startTime.addingTimeInterval(-Double(offset) * 60)
        let fireLabel = DateFormatters.hourMinute.string(from: fireTime)
        return InlineNovaResponse(
            userText: userText,
            summary: "Listo. Te aviso \(humanReminderLabel(offset)) antes de «\(event.title)».",
            details: "🔔 \(humanReminderLabel(offset)) · \(fireLabel)",
            action: .openCalendar,
            isError: false,
            tone: .success
        )
    }

    /// Respuesta cuando el patrón "acuérdame N min antes de X" matcheó
    /// pero X no coincide con ningún evento de hoy. NO creamos basura;
    /// devolvemos clarify con chips para que el usuario decida.
    private func missingEventForAttachReminder(
        activity: String,
        offset: Int,
        userText: String
    ) -> InlineNovaResponse {
        // Capitalizar primera letra del activity para mostrarlo en el copy.
        let displayActivity: String = {
            guard let first = activity.first else { return activity }
            return first.uppercased() + activity.dropFirst()
        }()
        // Chips: "Crear como evento" → agenda <activity>; "Como tarea" →
        // crea tarea <activity>. El callback genérico de InlineNovaResponseView
        // ejecuta el chip.sendText como nuevo mensaje del usuario.
        let chips = [
            NovaQuickChip(label: "Crear como evento", sendText: "agenda \(activity)"),
            NovaQuickChip(label: "Crear como tarea", sendText: "crea tarea \(activity)"),
        ]
        return InlineNovaResponse(
            userText: userText,
            summary: "No tengo «\(displayActivity)» en tu día como para ponerle aviso.",
            details: "¿Lo creamos como evento o como tarea? En cuanto exista, le pongo el aviso \(humanReminderLabel(offset)) antes.",
            action: .dismiss,
            isError: false,
            tone: .clarify,
            quickChips: chips
        )
    }

    /// "10" → "10 min", "60" → "1 h", "90" → "1 h 30 min". Para mostrar
    /// en el copy del aviso de manera consistente.
    private func humanReminderLabel(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        if minutes == 60 { return "1 h" }
        if minutes % 60 == 0 { return "\(minutes / 60) h" }
        let h = minutes / 60
        let m = minutes % 60
        return "\(h) h \(m) min"
    }

    /// Short-circuit para reminder en TIEMPO ABSOLUTO. Maneja dos patrones:
    ///
    /// **Caso A — nuevo bloque + reminder absoluto**:
    ///   "tengo clase a las 1:30 acuérdame a las 12:50"
    ///   → crea evento "Clase" 13:30 con `reminderOffsets=[40]`.
    ///
    /// **Caso B — reminder absoluto sobre evento existente**:
    ///   "acuérdame a las 9:50 de ducharme" (con "Ducharme" 10:00 en hoy)
    ///   → atajamos al evento existente con offset calculado.
    ///
    /// Reglas:
    /// - Si el reminder time queda DESPUÉS del event time → preguntamos
    ///   sin crear.
    /// - Si las dos horas son IGUALES → preguntamos también (aviso = evento
    ///   no tiene sentido).
    /// - Resolvemos AM/PM con el contexto: por defecto, si event hora es
    ///   1-12 y reminder hora es 1-12, asumimos ambas en el MISMO bracket
    ///   (PM o AM). La regla coloquial 1-7 → PM funciona bien para
    ///   "clase a las 1:30 acuérdame a las 12:50" (event 13:30, reminder
    ///   12:50). Si reminder > event en bracket PM, ya queda raro y
    ///   preguntamos.
    private func tryReminderAbsoluteFlow(userText: String) -> InlineNovaResponse? {
        guard let intent = NovaResponder.extractReminderAbsoluteIntent(from: userText) else {
            return nil
        }

        switch intent {
        case .newBlock(let rawTitle, let eH, let eM, let rH, let rM):
            return executeNewBlockWithAbsoluteReminder(
                userText: userText,
                rawTitle: rawTitle,
                eventH: eH, eventMin: eM,
                reminderH: rH, reminderMin: rM
            )

        case .attachByAbsolute(let activity, let rH, let rM):
            return executeAttachAbsoluteReminder(
                userText: userText,
                activity: activity,
                reminderH: rH, reminderMin: rM
            )
        }
    }

    /// Caso A: crear evento con offset calculado desde reminder absoluto.
    private func executeNewBlockWithAbsoluteReminder(
        userText: String,
        rawTitle: String,
        eventH: Int, eventMin: Int,
        reminderH: Int, reminderMin: Int
    ) -> InlineNovaResponse {
        // 1. Resolver event hour via `adjustAmPm` con el texto completo
        //    como contexto (capta "de la tarde", verbos morning/PM,
        //    school context con tope 6-12, etc.). Si event ≤ 12, lo
        //    pasamos por adjustAmPm. Si > 12, queda 24h.
        let eventHour24 = eventH > 12 ? eventH : NovaResponder.adjustAmPm(
            hour: eventH, in: userText
        )
        // 2. Reminder hour: usamos scoring smart que prueba AM y PM y
        //    elige el bracket con offset positivo razonable (0..4 h
        //    típicos). Esto evita el bug de "12:50" interpretado como
        //    0:50 AM cuando el evento está en PM (offset ~12h, absurdo).
        let reminderHour24 = NovaResponder.resolveAbsoluteReminderHour(
            rawReminderHour: reminderH,
            rawReminderMin: reminderMin,
            eventHour24: eventHour24,
            eventMin: eventMin
        )

        let eventMinutesAbs = eventHour24 * 60 + eventMin
        let reminderMinutesAbs = reminderHour24 * 60 + reminderMin

        // 3. Calcular offset en minutos.
        let offsetMinutes = eventMinutesAbs - reminderMinutesAbs

        // 4. Validar: si offset <= 0 → reminder no es anterior al evento
        //    → preguntar.
        guard offsetMinutes > 0 else {
            return InlineNovaResponse(
                userText: userText,
                summary: "Ese aviso queda después del bloque.",
                details: "Pediste «\(rawTitle)» a las \(formatTime24(eventHour24, eventMin)) y aviso a las \(formatTime24(reminderHour24, reminderMin)). ¿Quieres cambiar la hora del aviso?",
                action: .dismiss,
                isError: false,
                tone: .clarify
            )
        }

        // 4. Limpiar el título (singular, capitalizado, sin filler).
        let cleanTitle = NovaActionNormalizer.cleanTitle(rawTitle)
        let finalTitle = cleanTitle.isEmpty ? rawTitle.capitalized : cleanTitle

        // 5. Construir startTime hoy a la eventHour24:eventMin. Si ya
        //    pasó hoy hace > 4h, lo bumpeamos a mañana (misma política
        //    que extractDateTime). Conservador.
        let cal = Calendar.current
        let now = Date()
        let startOfDay = cal.startOfDay(for: now)
        guard var start = cal.date(
            bySettingHour: eventHour24, minute: eventMin, second: 0, of: startOfDay
        ) else {
            return InlineNovaResponse(
                userText: userText,
                summary: "Necesito la hora en otro formato para agendarlo.",
                details: "Dímela en 24h, por ejemplo «a las 17:00» o «a las 5 PM», y lo creo de inmediato.",
                tone: .clarify
            )
        }
        if start <= now {
            let gap = now.timeIntervalSince(start)
            if gap > 14_400 {  // > 4h pasado → mañana
                start = cal.date(byAdding: .day, value: 1, to: start) ?? start
            }
        }

        // 6. Crear el evento.
        let section = NovaResponder.guessSection(for: finalTitle) ?? .personal
        let event = FocusEvent(
            title: finalTitle,
            startTime: start,
            section: section,
            reminderOffsets: [offsetMinutes]
        )
        store.addEvent(event)
        HapticManager.shared.success()

        // 7. Respuesta corta.
        let fireLabel = formatTime24(reminderHour24, reminderMin)
        return InlineNovaResponse(
            userText: userText,
            summary: "Listo. Te dejé «\(finalTitle)» a las \(formatTime24(eventHour24, eventMin)) con aviso a las \(fireLabel).",
            details: "🔔 \(humanReminderLabel(offsetMinutes)) antes",
            action: .openCalendar,
            isError: false,
            tone: .success
        )
    }

    /// Caso B: attach reminder absoluto a un evento existente.
    private func executeAttachAbsoluteReminder(
        userText: String,
        activity: String,
        reminderH: Int, reminderMin: Int
    ) -> InlineNovaResponse {
        let todayEvents = store.todayEvents()
        guard let matched = NovaResponder.findEventByApproxTitle(
            activity, in: todayEvents
        ) else {
            return missingEventForAttachReminder(
                activity: activity, offset: 0,
                userText: userText
            )
        }

        let cal = Calendar.current
        let startOfMatched = cal.startOfDay(for: matched.startTime)
        let matchedHour24 = cal.component(.hour, from: matched.startTime)
        let matchedMin = cal.component(.minute, from: matched.startTime)
        // Smart scoring para evitar el bug de "12:50 AM vs PM" cuando el
        // evento existente está en PM. Usa el mismo helper que Caso A.
        let reminderHour24 = NovaResponder.resolveAbsoluteReminderHour(
            rawReminderHour: reminderH,
            rawReminderMin: reminderMin,
            eventHour24: matchedHour24,
            eventMin: matchedMin
        )
        guard let reminderDate = cal.date(
            bySettingHour: reminderHour24, minute: reminderMin, second: 0, of: startOfMatched
        ) else { return missingEventForAttachReminder(
            activity: activity, offset: 0, userText: userText
        ) }

        let offsetSeconds = matched.startTime.timeIntervalSince(reminderDate)
        let offsetMinutes = Int(offsetSeconds / 60)
        guard offsetMinutes > 0 else {
            return InlineNovaResponse(
                userText: userText,
                summary: "Ese aviso queda después del bloque.",
                details: "«\(matched.title)» empieza a las \(DateFormatters.hourMinute.string(from: matched.startTime)) y el aviso quedaría a las \(formatTime24(reminderHour24, reminderMin)). ¿Quieres cambiarlo?",
                action: .dismiss,
                isError: false,
                tone: .clarify
            )
        }

        let existing = matched.reminderOffsets ?? []
        if existing.contains(offsetMinutes) {
            return InlineNovaResponse(
                userText: userText,
                summary: "Ese aviso ya estaba agregado.",
                details: "«\(matched.title)» · 🔔 \(humanReminderLabel(offsetMinutes)) antes",
                action: .openCalendar,
                isError: false,
                tone: .clarify
            )
        }

        var updated = matched
        updated.reminderOffsets = (existing + [offsetMinutes]).sorted()
        store.updateEvent(updated)
        HapticManager.shared.success()

        return InlineNovaResponse(
            userText: userText,
            summary: "Listo. Añadí un aviso a «\(matched.title)».",
            details: "🔔 \(humanReminderLabel(offsetMinutes)) antes · \(formatTime24(reminderHour24, reminderMin))",
            action: .openCalendar,
            isError: false,
            tone: .success
        )
    }

    /// Formatea (h, m) como "HH:MM" en 24h. Helper local.
    private func formatTime24(_ h: Int, _ m: Int) -> String {
        String(format: "%02d:%02d", h, m)
    }

    /// True cuando el intent local SIEMPRE es mejor que el backend porque
    /// requiere contexto cliente o porque el backend lo entendería peor.
    /// Conservador: solo cubre casos donde tenemos alta confianza.
    /// Cuando hay sesión, deja que la IA conteste (en vez del resumen local)
    /// los pedidos conversacionales/de consejo/emocionales que el parser
    /// local clasificó como resumen/meta por una subcadena suelta. Nova es
    /// un ASISTENTE, no solo un calendario: "me siento abrumado, ¿cómo
    /// organizo el día?" merece una respuesta humana de la IA, no
    /// "0 eventos hoy". Las consultas PURAS y cortas ("¿qué tengo hoy?")
    /// siguen resolviéndose local (rápido, sin gastar el backend).
    private func shouldDeferToBackendForHumanAnswer(_ intent: NovaIntent, text: String) -> Bool {
        // Sin sesión no hay IA real → conviene el resumen local.
        guard store.syncCredentials != nil else { return false }
        switch intent {
        case .reviewToday, .reviewPending, .organizeDay:
            break
        default:
            return false
        }
        let lower = text.lowercased()
        let humanMarkers: [String] = [
            "me siento", "abrumad", "estresad", "agobiad", "ansios",
            "no sé", "no se ", "no doy abasto", "ayúdame", "ayudame",
            "recomiend", "sugier", "qué hago", "que hago", "qué hacer",
            "cómo organiz", "como organiz", "cómo lo hago", "como lo hago",
            "qué opinas", "que opinas", "qué me dices", "que me dices",
            "consejo", "por dónde empiezo", "por donde empiezo", "abruma",
            "priorizar", "prioriza", "ayuda con"
        ]
        return humanMarkers.contains { lower.contains($0) }
    }

    private func shouldShortCircuit(_ intent: NovaIntent) -> Bool {
        switch intent {
        case .correctLastEvent, .deleteLastItem, .convertLastToTask:
            // Corrige/borra el último ítem usando `lastEventId`/`lastTaskId`
            // del contexto local. Backend no tiene esos ids.
            return true
        case .organizeDay, .reviewPending, .reviewToday, .askAboutDemo:
            // Comandos meta del cliente — generan suggestions/listados locales,
            // no requieren NLU del backend.
            return true
        case .smallTalk:
            // Confirmaciones/cancelaciones cortas que el local ya resolvió.
            return true
        case .deleteEventByActivity, .rescheduleEventByActivity, .attachReminderToEvent:
            // Operan sobre eventos locales por fuzzy match — el backend no
            // tiene visibilidad de IDs locales. Siempre resolver local.
            return true
        case .proposeActionPlan, .confirmActionPlan:
            // Plan extraction + confirmación: local.
            return true
        case .annotateTaskCorrection, .annotateDependency:
            // Corrección/dependencia sobre tareas locales por fuzzy match.
            return true
        case .createEvent, .createTask:
            // V2 (2026-05-28) — user spec "que use GPT con razonamiento":
            // creación NUEVA de eventos/tareas va al LLM (GPT-5 reasoning).
            // El parser local generaba títulos basura ("Q jugar counter más
            // o menos") porque no entiende "q"="que" ni "más o menos"=hora
            // aproximada. GPT sí. Único short-circuit: pending follow-up
            // (GPT no tiene ese contexto local).
            //
            // Nota: el system prompt de GPT ya maneja "hora sin fecha → hoy"
            // (regla Mi Día), así que no reintroduce el bug de "¿qué día?".
            return store.novaContext.pendingIsActive
        default:
            return false
        }
    }

    /// Aplica el `NovaService.Result` al store y arma el inline response.
    /// Si el backend solo devolvió `reply` sin actions (clarify o smalltalk),
    /// mostramos solo el texto. ADEMÁS: si el reply termina con "?", lo
    /// tratamos como pregunta del backend y guardamos un pending
    /// clarification basado en el texto del usuario — así el siguiente
    /// turno corto ("a las 3", "mañana", "en 20") puede completar la
    /// acción aunque el local parser no haya detectado clarify.
    private func applyBackendResult(_ result: NovaService.Result, userText: String,
                                     logId: UUID? = nil) async -> InlineNovaResponse {
        let replyText = result.reply.trimmingCharacters(in: .whitespacesAndNewlines)

        // ═══════════════════════════════════════════════════════════════
        //  ANTI-BASURA CLIENT-SIDE (2026-05-15 — beta closure)
        //
        //  Última red contra el patrón antiguo "convierte TODO en evento".
        //  Si el user dijo algo emocional/contextual ("estoy colapsado",
        //  "no sé si voy a alcanzar") Y el backend (a pesar del prompt)
        //  devolvió chat_with_action con creates → degradamos a proposal.
        //  Edits/deletes legítimos pasan tal cual aunque el wording sea
        //  "creo que muevo lo de fútbol".
        // ═══════════════════════════════════════════════════════════════
        let antiBasura = NovaActionValidator.applyAntiBasura(
            userText: userText,
            mode: result.mode.rawValue,
            actions: result.actions
        )
        let effectiveActions = antiBasura.safeActions
        let demotedActions = antiBasura.demotedToProposal
        if antiBasura.didDemote, let reason = antiBasura.reason, let logId {
            await MainActor.run {
                NovaDevLog.shared.recordAntiBasuraDemotion(id: logId, reason: reason)
            }
        }
        // Si hubo demotion Y el mode ORIGINAL era chat_with_action, lo
        // forzamos a proposal: el cliente mostrará buttons en vez de
        // ejecutar silencioso.
        let effectiveMode: NovaService.Mode = {
            if antiBasura.didDemote && !demotedActions.isEmpty {
                return .proposal
            }
            return result.mode
        }()
        let effectiveProposedActions = result.proposedActions + demotedActions

        // ═══════════════════════════════════════════════════════════════
        //  MODE-BASED ROUTING (introducido 2026-05-15)
        //
        //  El backend ahora clasifica la intención del mensaje en un campo
        //  `mode`. Antes de validar/aplicar acciones, respetamos esa
        //  clasificación. Esto permite que mensajes conversacionales
        //  ("Estoy saturado") generen respuesta de chat sin crear eventos.
        // ═══════════════════════════════════════════════════════════════

        switch effectiveMode {
        case .chatOnly:
            // Conversación abierta: NO ejecutar nada, solo mostrar reply.
            // Si el reply está vacío, tono neutral con texto fallback.
            let parts = splitReplyForUI(replyText.isEmpty
                ? "Aquí estoy si necesitas algo."
                : replyText)
            if let logId {
                await MainActor.run {
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .chatOnly)
                }
            }
            return InlineNovaResponse(
                userText: userText,
                summary: parts.summary,
                details: parts.details,
                action: .dismiss,
                isError: false,
                tone: .chat
            )
        case .proposal:
            // Propuesta: NO ejecutar — mostrar reply + botones Apply/Edit/
            // Dismiss para que el user decida. Persistimos las actions
            // propuestas en `pendingProposal` (state local) para que el
            // chip de "Aplicar" sepa qué ejecutar.
            self.pendingProposalActions = effectiveProposedActions
            self.pendingProposalUserText = userText
            let parts = splitReplyForUI(replyText.isEmpty
                ? "Te propongo un ajuste. ¿Lo aplico?"
                : replyText)
            let chips: [NovaQuickChip] = [
                NovaQuickChip(label: "Aplicar", proposalAction: .apply),
                NovaQuickChip(label: "Editar", proposalAction: .edit),
                NovaQuickChip(label: "No por ahora", proposalAction: .dismiss),
            ]
            if let logId {
                await MainActor.run {
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .proposalShown)
                }
            }
            return InlineNovaResponse(
                userText: userText,
                summary: parts.summary,
                details: parts.details,
                action: .dismiss,
                isError: false,
                tone: .clarify,
                quickChips: chips
            )
        case .clarification, .chatWithAction:
            // Pasan al flujo existente abajo. Clarification cae al gate de
            // shouldAskUser. chatWithAction valida + aplica acciones.
            break
        }

        // Planner gate: si el backend pidió no ejecutar (shouldAskUser=true
        // o confidence < 0.55), NO aplicamos las acciones — mostramos sólo
        // la pregunta y guardamos un pending para que el próximo turno
        // corto la complete. Es la diferencia entre "asistente que actúa"
        // (alta confianza) y "asistente que pregunta cuando duda".
        if result.shouldAskUser || result.confidence < 0.55 {
            if !replyText.isEmpty, !store.novaContext.pendingIsActive {
                persistBackendQuestionAsPending(userText: userText, question: replyText)
            }
            let parts = splitReplyForUI(replyText.isEmpty
                ? "Necesito un dato más para agendar esto."
                : replyText)
            return InlineNovaResponse(
                userText: userText,
                summary: parts.summary,
                details: parts.details,
                action: .dismiss,
                isError: false,
                tone: .clarify
            )
        }

        // Validador post-IA: revisa títulos sucios (concat, hora pegada),
        // categoría "reunión" sin trigger, longitudes anómalas. Si detecta
        // riesgo en CUALQUIER acción, NO aplica ninguna y baja a clarify.
        // Es la segunda red — el primer filtro es la confianza del modelo;
        // este atrapa modelos sobreconfiados.
        let validation = NovaActionValidator.validate(
            actions: effectiveActions,
            userText: userText
        )
        if validation.shouldAsk {
            let question = validation.suggestedQuestion
                ?? "Te entendí varias cosas, prefiero revisarlas contigo antes de guardar."
            if !store.novaContext.pendingIsActive {
                persistBackendQuestionAsPending(userText: userText, question: question)
            }
            // Loggeamos el motivo a console para diagnóstico.
            for (_, reason) in validation.rejected {
                debugLog("[NovaValidator] rechazo: \(reason)")
            }
            if let logId {
                await MainActor.run {
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .blockedByValidator,
                                                    error: validation.rejected.first?.reason)
                }
            }
            return InlineNovaResponse(
                userText: userText,
                summary: question,
                details: replyText.isEmpty ? nil : replyText,
                action: .dismiss,
                isError: false,
                tone: .clarify
            )
        }

        let outcome = store.applyBackendActions(validation.safeActions, userText: userText)
        // Loggear evento matcheado (si lo hubo) — para diagnosticar edits.
        if let logId, let eid = outcome.primaryEventId,
           let event = store.events.first(where: { $0.id == eid }) {
            await MainActor.run {
                NovaDevLog.shared.recordMatchedEvent(id: logId, eventId: eid, eventTitle: event.title)
            }
        }
        // Cuota de smart actions agotada: pegar nota humana al final.
        let blockedNote: String? = result.smartActionsBlocked
            ? (result.smartActionsMessage ?? "Llegaste al límite diario de acciones de Nova.")
            : nil

        // Si el backend NO mutó nada y su reply es una pregunta, guardar
        // pending basado en el original userText. Esto cubre casos como
        // "tengo parcial el jueves" donde el local parser sí entiende y
        // armó pending, pero también casos donde el backend hace una
        // pregunta no anticipada por el local. Idempotente: si el local
        // ya guardó un pending, este no lo sobreescribe a peor.
        if !outcome.didMutate, replyText.hasSuffix("?")
            && !store.novaContext.pendingIsActive {
            persistBackendQuestionAsPending(userText: userText, question: replyText)
        }

        if outcome.didMutate {
            // Hubo mutación: usamos el resumen del outcome como cabecera +
            // los bullets generados (multi-action) como detalle. Acción
            // contextual según tipo.
            //
            // El reply textual del backend NO se usa como detalle: repetía lo
            // mismo que `summary` pero en 12h ("4:00 PM") mientras el summary
            // nativo va en 24h ("16:00") → doble confirmación + formato mixto.
            // El subtítulo/preparativos ya se ven en la tarjeta del evento.
            // Solo caemos al reply si el outcome no produjo un summary propio.
            let summary = outcome.summary ?? "Listo."
            let hasOwnSummary = !(outcome.summary ?? "").isEmpty
            let baseDetails = outcome.details
                ?? (hasOwnSummary ? nil : (replyText.isEmpty ? nil : replyText))
            var details: String? = baseDetails
            if let note = blockedNote {
                details = [details, note].compactMap { $0 }.joined(separator: "\n\n")
            }
            let action: InlineNovaAction = {
                if outcome.primaryEventId != nil { return .openCalendar }
                if outcome.primaryTaskId != nil { return .openTasksList }
                return .dismiss
            }()
            if let logId {
                await MainActor.run {
                    NovaDevLog.shared.finishRequest(id: logId, outcome: .actionApplied)
                }
            }
            return InlineNovaResponse(
                userText: userText,
                summary: summary,
                details: details,
                action: action,
                isError: false,
                tone: .success
            )
        }

        // No hubo mutación: el backend devolvió solo texto (clarify o info).
        let summary: String
        let details: String?
        if !replyText.isEmpty {
            // Si el reply es corto y único, usarlo como summary; sino
            // partir título/detalle por primera oración.
            let parts = splitReplyForUI(replyText)
            summary = parts.summary
            details = parts.details
        } else {
            summary = "Nova respondió sin texto."
            details = nil
        }
        let merged: String? = {
            guard let note = blockedNote else { return details }
            return [details, note].compactMap { $0 }.joined(separator: "\n\n")
        }()
        if let logId {
            await MainActor.run {
                // No hubo mutación pero la respuesta no era clarification
                // según mode — la categorizamos como clarification para que
                // el log sea claro (Nova respondió texto sin ejecutar).
                NovaDevLog.shared.finishRequest(id: logId, outcome: .clarificationAsked)
            }
        }
        return InlineNovaResponse(
            userText: userText,
            summary: summary,
            details: merged,
            action: .dismiss,
            isError: false
        )
    }

    /// Corre el parser local y arma el inline response. Soporta frases
    /// compuestas: si el parser detecta múltiples intents (conectores
    /// "y luego", "luego", "después", "también"...), ejecuta cada uno y
    /// combina los resúmenes. Si la nota viene dada, la agrega al final.
    private func runLocalFallback(for trimmed: String, withNote note: String?) -> InlineNovaResponse {
        let intents = NovaResponder.parseAll(trimmed, context: store.novaContext)

        // Caso simple: un solo intent → comportamiento idéntico al anterior.
        if intents.count <= 1 {
            let intent = intents.first ?? .clarify(reason: .noContext)
            var response = executeIntent(intent, userText: trimmed)
            if let note {
                response.details = [response.details, note].compactMap { $0 }.joined(separator: "\n\n")
            }
            return response
        }

        // Multi-intent: ejecutar cada intent (side effects: addEvent/addTask)
        // y luego componer UN SOLO summary humano que enumere lo que se hizo.
        // El resumen anterior ("Evento agregado a Calendario · Evento agregado a
        // Calendario") era confuso — no decía qué se creó, repetía info, y
        // tenía clasificación errónea.
        var createdItems: [CreatedItem] = []
        var lastAction: InlineNovaAction? = nil

        for intent in intents {
            let resp = executeIntent(intent, userText: trimmed, isMultiIntent: true)
            guard !resp.isError else { continue }
            if lastAction == nil { lastAction = resp.action }
            if let item = CreatedItem(intent: intent, userText: trimmed) {
                createdItems.append(item)
            }
        }

        if createdItems.isEmpty {
            // Nada se creó — no guardar basura. Mensaje útil con tono
            // asistente (clarify, no error) en vez de "no pude separar"
            // que sonaba como rendición.
            return InlineNovaResponse(
                userText: trimmed,
                summary: "Vamos en partes.",
                details: "Te entendí varias cosas pero quiero confirmar antes de agendar. ¿Me las pasas una por una?",
                action: .dismiss,
                isError: false,
                tone: .clarify
            )
        }

        let (summary, details) = composeMultiIntentMessage(items: createdItems)
        let combinedDetails: String? = {
            let parts = [details, note].compactMap { $0 }.filter { !$0.isEmpty }
            return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
        }()
        return InlineNovaResponse(
            userText: trimmed,
            summary: summary,
            details: combinedDetails,
            action: lastAction
        )
    }

    /// Estructura interna para describir lo que se creó tras ejecutar cada
    /// intent del multi-intent. Nos permite componer un resumen humano
    /// agrupando por tipo y día.
    ///
    /// **Modelo unificado**: bajo el nuevo criterio "todo con hora = bloque",
    /// ya no separamos visualmente "recordatorio" vs "evento" en Mi Día.
    /// `kind` se queda como `.block` (tiene hora) o `.task` (no la tiene).
    /// El offset de aviso anticipado va en `reminderOffsetMinutes` del
    /// mismo bloque, no como ítem aparte.
    private struct CreatedItem {
        enum Kind { case block, task }
        let kind: Kind
        let title: String
        let date: Date?
        /// Si el usuario dijo "acuérdame N min antes", se persiste como
        /// metadata del bloque y se renderiza como chip 🔔 dentro del
        /// mismo ítem en Mi Día.
        let reminderOffsetMinutes: Int?

        init?(intent: NovaIntent, userText: String) {
            switch intent {
            case let .createEvent(rawTitle, when, _, _, _, _, _, segReminderOffset, _):
                let cleaned = NovaActionNormalizer.cleanTitle(rawTitle)
                guard !cleaned.isEmpty else { return nil }
                self.kind = .block
                self.title = cleaned
                self.date = when
                // Offset PRE-EXTRAÍDO del segmento (multi-evento) gana sobre
                // la extracción del userText completo (que daba el primer
                // offset a todos los eventos).
                self.reminderOffsetMinutes = segReminderOffset
                    ?? NovaActionNormalizer.extractReminderOffset(from: userText)
            case let .createTask(rawTitle, dueDate, _, _):
                let cleaned = NovaActionNormalizer.cleanTitle(rawTitle)
                guard !cleaned.isEmpty else { return nil }
                self.kind = .task
                self.title = cleaned
                self.date = dueDate
                self.reminderOffsetMinutes = nil
            default:
                return nil
            }
        }
    }

    /// Convierte los items creados en (summary, details) humanos.
    /// Bajo el modelo unificado, todo lo que tiene hora es un "bloque" en
    /// Mi Día — el offset de aviso se muestra como chip dentro del mismo
    /// bloque, no como tarjeta aparte.
    ///
    /// Ejemplos:
    /// - 2 bloques mismo día → "Listo. Te dejé 2 bloques para hoy: …"
    /// - 1 bloque + 1 tarea → "Listo. Te dejé 1 bloque y 1 tarea."
    /// - 1 tarea sola → no debería pasar (count == 1 va por path simple).
    private func composeMultiIntentMessage(items: [CreatedItem]) -> (String, String?) {
        let blocks = items.filter { $0.kind == .block }
        let tasks  = items.filter { $0.kind == .task }

        // Detectar si todos los items con fecha caen en el mismo día → "para hoy/mañana/...".
        let allDates = items.compactMap { $0.date }
        let cal = Calendar.current
        let sameDay: Bool = {
            guard let first = allDates.first else { return false }
            return allDates.allSatisfy { cal.isDate($0, inSameDayAs: first) }
        }()
        let dayLabel: String? = {
            guard sameDay, let date = allDates.first else { return nil }
            if cal.isDateInToday(date) { return "hoy" }
            if cal.isDateInTomorrow(date) { return "mañana" }
            return DateFormatters.weekdayDay.string(from: date).lowercased()
        }()

        // Summary: header humano. "Bloque" cuando tiene hora, "tarea" sino.
        let header: String
        let dayBit = dayLabel.map { " para \($0)" } ?? ""
        switch (blocks.count, tasks.count) {
        case (let b, 0) where b >= 2:
            header = "Listo. Te dejé \(b) bloques\(dayBit)."
        case (0, let t) where t >= 2:
            header = "Listo. Anoté \(t) tareas\(dayBit)."
        default:
            // Mixed.
            var parts: [String] = []
            if blocks.count > 0 { parts.append("\(blocks.count) bloque\(blocks.count == 1 ? "" : "s")") }
            if tasks.count > 0  { parts.append("\(tasks.count) tarea\(tasks.count == 1 ? "" : "s")") }
            let combined = parts.joined(separator: " y ")
            header = "Listo. Te dejé \(combined)\(dayBit)."
        }

        // Details: bullets ordenados por hora. Si el item tiene reminder
        // offset, lo incluimos en el mismo bullet — sin duplicar como ítem
        // aparte.
        let sorted = items.sorted { a, b in
            switch (a.date, b.date) {
            case let (l?, r?): return l < r
            case (_?, nil):    return true
            case (nil, _?):    return false
            default:           return false
            }
        }
        let bullets = sorted.map { item -> String in
            let hh = item.date.map { DateFormatters.hourMinute.string(from: $0) }
            var line: String
            switch (hh, sameDay) {
            case let (.some(time), true):
                line = "• \(item.title) — \(time)"
            case let (.some(time), false):
                if let d = item.date {
                    let day = cal.isDateInToday(d) ? "hoy"
                        : cal.isDateInTomorrow(d) ? "mañana"
                        : DateFormatters.weekdayDay.string(from: d).lowercased()
                    line = "• \(item.title) — \(day) \(time)"
                } else {
                    line = "• \(item.title) — \(time)"
                }
            case (.none, _):
                line = "• \(item.title)"
            }
            if let mins = item.reminderOffsetMinutes {
                let offsetLabel = mins < 60
                    ? "\(mins) min antes"
                    : (mins % 60 == 0 ? "\(mins/60) h antes" : "\(mins/60) h \(mins%60) min antes")
                line += "  🔔 \(offsetLabel)"
            }
            return line
        }
        let details = bullets.isEmpty ? nil : bullets.joined(separator: "\n")
        return (header, details)
    }

    /// Eventos que vamos a enviar como contexto al backend. Limita a hoy
    /// + mañana + 7 días siguientes para no pasar el límite de tokens.
    private func visibleEventsForContext() -> [FocusEvent] {
        let cal = Calendar.current
        let now = Date()
        let horizon = cal.date(byAdding: .day, value: 7, to: now) ?? now
        return store.events
            .filter { $0.startTime >= cal.startOfDay(for: now) && $0.startTime <= horizon }
            .sorted { $0.startTime < $1.startTime }
    }

    private func visibleTasksForContext() -> [FocusTask] {
        store.tasks.filter { !$0.done }
    }

    /// Convierte los últimos turnos del chat en el shape `history` del
    /// backend. Limita a 12 turnos (6 ida/vuelta).
    private func recentNovaHistory() -> [NovaService.HistoryEntry] {
        let recent = store.novaMessages.suffix(12)
        return recent.map { msg in
            NovaService.HistoryEntry(
                role: msg.role == .user ? .user : .assistant,
                content: msg.content
            )
        }
    }

    /// Mensajes amables que mostramos cuando el backend falla y caemos a
    /// local. Estado técnico va solo a console.log, NUNCA a la UI. El
    /// usuario no debe leer "modo local", "Nova avanzada", "Error 500",
    /// "status code", etc. — es ruido de implementación.
    private func humanFallbackNote(for error: NovaServiceError) -> String? {
        // Política 2026-06-13 (user spec): estando LOGUEADO, el fallback local
        // NUNCA es silencioso. Antes los errores de servidor devolvían nil y
        // el `summary` del local hacía parecer que Nova funcionó normal. Ahora
        // SIEMPRE mostramos la nota honesta (vive en NovaServiceError).
        let note = error.loggedInFallbackNote
        return note.isEmpty ? nil : note
    }

    /// Split del reply del backend en (summary, details). El backend ya
    /// devuelve máx 2 oraciones; si hay punto final, lo partimos ahí.
    /// Llamado cuando el backend retorna una pregunta sin actions. Re-parsea
    /// el `userText` localmente para extraer título/fecha tentativos y los
    /// guarda en `pendingClarification`. Así el siguiente turno corto puede
    /// completar la acción usando memoria local — aunque el backend nunca
    /// emita un "clarify" estructurado.
    private func persistBackendQuestionAsPending(userText: String, question: String) {
        // Re-parsear local para obtener intent y construir pending.
        let preIntent = NovaResponder.parse(userText, context: store.novaContext)
        if case .clarify(let reason) = preIntent,
           let pending = buildPendingClarification(
               from: reason,
               userText: userText,
               source: .inlineMiDia
           ) {
            // Sobreescribir el questionAsked con la pregunta REAL del
            // backend para que sea coherente con lo que el usuario está
            // viendo.
            var updated = pending
            updated.questionAsked = question
            store.setPendingClarification(updated)
            return
        }
        // Si el local parser no detectó clarify, hacemos un pending
        // genérico con title=userText (limpio) — el follow-up tendrá
        // que aportar la hora. Mejor algo que nada.
        let cleanedTitle = NovaActionNormalizer.cleanTitle(userText)
        guard !cleanedTitle.isEmpty else { return }
        let wantsReminder = NovaActionNormalizer.isReminderTrigger(in: userText)
        store.setPendingClarification(PendingClarification(
            originalInput: userText,
            kind: wantsReminder ? .reminder : .event,
            proposedTitle: cleanedTitle,
            proposedDate: nil,
            proposedSection: NovaResponder.guessSection(for: userText),
            wantsReminder: wantsReminder,
            missingFields: [.date, .time],
            questionAsked: question,
            source: .inlineMiDia
        ))
    }

    private func splitReplyForUI(_ raw: String) -> (summary: String, details: String?) {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Buscar primer punto seguido de espacio o fin de string.
        if let dotRange = normalized.range(of: #"[.!?]\s+"#, options: .regularExpression) {
            let first = String(normalized[..<dotRange.upperBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let rest = String(normalized[dotRange.upperBound...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if rest.isEmpty {
                return (first, nil)
            }
            return (first, rest)
        }
        return (normalized, nil)
    }

    private func executeIntent(_ intent: NovaIntent, userText: String, isMultiIntent: Bool = false) -> InlineNovaResponse {
        switch intent {
        case .createTask(let title, let dueDate, let recurrence, let wantsReminder):
            // SOLO-EVENTOS (temporal 2026-06-13): no creamos tareas. En vez de
            // anotar una tarea, pedimos la hora para agendarlo como EVENTO.
            if !FocusConfig.tasksEnabled {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "¿A qué hora lo agendo?",
                    details: "Lo pongo como evento en tu día.",
                    tone: .clarify
                )
            }
            // Si hay fecha y es hoy/mañana/esta semana, usamos esa categoría;
            // si es más lejos, .algunDia. La category se mantiene compatible
            // con el modelo existente; dueDate es metadata adicional.
            let category = categoryForDueDate(dueDate)
            let task = FocusTask(
                title: title,
                priority: .media,
                category: category,
                dueDate: dueDate
            )
            store.addTask(task)
            store.updateNovaContext(
                from: userText,
                title: title,
                date: dueDate,
                kind: .task,
                taskId: task.id
            )
            // Las tareas no envían notificación local (sólo eventos). Si el
            // user pidió aviso ("acuérdame"), le decimos por qué — sin
            // prometer un push remoto futuro.
            let reminderNote = wantsReminder ? " Como tarea no envía aviso al iPhone — agéndalo como evento con hora si quieres que te avise." : ""
            let dueLabel: String? = {
                guard let d = dueDate else { return nil }
                let cal = Calendar.current
                if cal.isDateInToday(d) { return "hoy" }
                if cal.isDateInTomorrow(d) { return "mañana" }
                return DateFormatters.weekdayDay.string(from: d).lowercased()
            }()
            if let rec = recurrence {
                let due = dueLabel.map { " para el \($0)" } ?? ""
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Tarea creada (sin recurrencia todavía).",
                    details: "«\(title)»\(due). La recurrencia (\(rec.label)) la dejamos preparada para más adelante.\(reminderNote)",
                    action: .openTasksList
                )
            }
            let summary: String
            if let due = dueLabel {
                summary = "Tarea creada para \(due)."
            } else {
                summary = "Tarea creada en pendientes de hoy."
            }
            return InlineNovaResponse(
                userText: userText,
                summary: summary,
                details: "«\(title)»\(reminderNote)",
                action: .openTasksList
            )

        case .createEvent(let rawTitle, let when, let explicitEnd, let location, let section, let wantsReminder, let recurrence, let segReminderOffset, let segReminderNote):
            // BUG-USER 2026-05-18: este path guardaba el título RAW del intent
            // parser sin pasarlo por cleanTitle, mientras que
            // FocusDataStore.applyLocalNovaIntent SÍ lo limpia. Resultado: el
            // mismo input creaba bloques con título tipo "Más tarde viene la
            // agustina 20 min antes" en vez de "Viene la agustina". Unificamos
            // el pipeline llamando cleanTitle acá también.
            let cleanedTitle = NovaActionNormalizer.cleanTitle(rawTitle)
            guard !cleanedTitle.isEmpty else {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Me falta el nombre del evento para agendarlo.",
                    details: "Cuéntame qué quieres anotar y cuándo. Ej: «agenda reunión con Juan mañana a las 12».",
                    tone: .clarify
                )
            }
            // Subtítulo/detalle, espejo de FocusDataStore.applyLocalNovaIntent:
            // detalle trailing del userText ("…acuérdame de llevar la receta") →
            // subtítulo del evento. En multi-intent solo se ancla al evento que
            // el detalle nombra explícitamente ("…al dentista" → "Dentista");
            // sin referencia (o auto-referencia) se suprime para no filtrarlo
            // a todos. Antes este path inline JAMÁS seteaba subtítulo (2026-06-12).
            let trailingDetail = NovaActionNormalizer.extractEventDetail(from: userText).detail
            let (title, eventSubtitle): (String, String?) = {
                if let detail = trailingDetail {
                    if !isMultiIntent { return (cleanedTitle, detail) }
                    if NovaActionNormalizer.detailTargetsTitle(detail: detail, title: cleanedTitle) {
                        return (cleanedTitle, detail)
                    }
                }
                if let split = NovaActionNormalizer.splitTitleSubtitle(cleanedTitle) {
                    return (split.title, split.subtitle)
                }
                return (cleanedTitle, nil)
            }()
            guard let date = when else {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Necesito saber el día y la hora.",
                    details: "Prueba: «agenda \(title) mañana a las 12».",
                    isError: true
                )
            }
            // Anti-duplicado: si el mismo título ya existe a esa hora, no
            // duplicar. Antes el usuario podía dictar lo mismo dos veces
            // (autocomplete, voz repetida) y terminaba con 2-3 bloques iguales.
            if NovaActionNormalizer.isLikelyDuplicate(
                title: title,
                startTime: date,
                existingEvents: store.events
            ) {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Ya tenías «\(title)» a esa hora.",
                    details: "No lo duplico.",
                    action: .openCalendar,
                    tone: .clarify
                )
            }
            let cal = Calendar.current
            // Pipeline unificado con `applyLocalNovaIntent` del store:
            //   1) Si hay endTime explícito (rango "de X a Y") → respetarlo
            //      siempre, AUNQUE además el usuario haya dicho "acuérdame N
            //      antes". El chip de offset va dentro del MISMO bloque, no
            //      duplica el evento.
            //   2) Si NO hay endTime y wantsReminder → punto en tiempo,
            //      duración interna 5 min para ordenamiento, isReminder=true.
            //   3) Si NO hay endTime y no es reminder → inferredDuration=true,
            //      la UI lo muestra como punto puntual.
            let endResolution = NovaActionNormalizer.resolveEndTime(
                startTime: date,
                providedEndTime: explicitEnd,
                hasExplicitEndTime: explicitEnd != nil && (explicitEnd ?? date) > date,
                isReminder: wantsReminder
            )
            let end: Date
            let isReminderFlag: Bool?
            let inferredFlag: Bool?
            if let resolved = endResolution.endTime {
                // Rango explícito (con o sin "acuérdame antes").
                end = resolved
                isReminderFlag = nil
                inferredFlag = false
            } else if wantsReminder {
                end = cal.date(byAdding: .minute, value: 5, to: date) ?? date
                isReminderFlag = true
                inferredFlag = nil
            } else {
                end = cal.date(byAdding: .minute, value: 5, to: date) ?? date
                isReminderFlag = nil
                inferredFlag = endResolution.inferredDuration
            }

            let effectiveSection: EventSection
            if wantsReminder {
                effectiveSection = section ?? .reminder
            } else {
                effectiveSection = section
                    ?? NovaResponder.guessSection(for: title)
                    ?? .personal
            }
            // Reminder offset: PRIORIDAD al offset PRE-EXTRAÍDO del segmento
            // de este evento (parseAll lo inyecta por-segmento), si no, del
            // userText completo. Antes el offset del userText completo (el
            // primero que aparecía) se aplicaba a TODOS los eventos del lote.
            let extractedOffsets: [Int]?
            if let segOffset = segReminderOffset {
                extractedOffsets = [segOffset]
            } else if !isMultiIntent, let mins = NovaActionNormalizer.extractReminderOffset(from: userText) {
                extractedOffsets = [mins]
            } else {
                extractedOffsets = nil
            }
            // Nota custom del recordatorio (segmento) → se persiste en el
            // evento si vino del segmento.
            let segReminderNotes: [String]? = (segReminderNote?.isEmpty == false) ? [segReminderNote!] : nil
            // Si hay recurrencia, expandir las próximas N ocurrencias.
            let occurrences: [Date]
            if let recurrence {
                occurrences = store.expandLocalRecurrenceDates(start: date, recurrence: recurrence)
            } else {
                occurrences = [date]
            }
            var firstEventId = UUID()
            for (idx, startDate) in occurrences.enumerated() {
                let duration = end.timeIntervalSince(date)
                let occurEnd = startDate.addingTimeInterval(duration)
                let event = FocusEvent(
                    title: title,
                    startTime: startDate,
                    endTime: occurEnd,
                    section: effectiveSection,
                    location: location,
                    isReminder: isReminderFlag,
                    inferredDuration: inferredFlag,
                    reminderOffsets: extractedOffsets,
                    reminderNotes: segReminderNotes,
                    subtitle: eventSubtitle
                )
                store.addEvent(event)
                if idx == 0 { firstEventId = event.id }
            }
            store.updateNovaContext(
                from: userText,
                title: title,
                date: date,
                location: location,
                section: effectiveSection,
                kind: .event,
                eventId: firstEventId
            )
            let timeLabel = DateFormatters.hourMinute.string(from: date)
            let dayLabel = DateFormatters.capitalizeFirst(
                DateFormatters.weekdayDay.string(from: date)
            )
            // Copy unificado para el usuario: "bloque" en vez de mezclar
            // "recordatorio"/"evento". Si hay offset, se menciona.
            var detail = "\(dayLabel) · \(timeLabel)"
            if let loc = location { detail += " · \(loc)" }
            if let mins = extractedOffsets?.first {
                let offsetLabel = mins < 60
                    ? "\(mins) min antes"
                    : (mins % 60 == 0 ? "\(mins/60) h antes" : "\(mins/60) h \(mins%60) min antes")
                detail += " · 🔔 \(offsetLabel)"
            }
            if let recurrence, occurrences.count > 1 {
                detail += " · \(recurrence.label), \(occurrences.count) próximas"
            }
            return InlineNovaResponse(
                userText: userText,
                summary: "Listo. Te dejé «\(title)» en Mi Día.",
                details: detail,
                action: .openCalendar,
                tone: .success
            )

        case .correctLastEvent(let modifier):
            guard let eventId = store.novaContext.lastEventId,
                  var event = store.events.first(where: { $0.id == eventId }) else {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Para corregir necesito un evento reciente.",
                    details: "Dime el nombre del evento que quieres cambiar — por ejemplo «mueve fútbol a las 6» y lo edito directo.",
                    action: .dismiss,
                    tone: .clarify
                )
            }
            let cal = Calendar.current
            switch modifier {
            case .shiftDays(let offset):
                if let newStart = cal.date(byAdding: .day, value: offset, to: event.startTime) {
                    event.startTime = newStart
                }
                if let oldEnd = event.endTime,
                   let newEnd = cal.date(byAdding: .day, value: offset, to: oldEnd) {
                    event.endTime = newEnd
                }
            case .setTime(let h, let m):
                let day = cal.startOfDay(for: event.startTime)
                if let newStart = cal.date(bySettingHour: h, minute: m, second: 0, of: day) {
                    // Preservar la naturaleza del evento al cambiar la hora.
                    // Antes: `endTime = newStart + 1h` SIEMPRE — esto convertía
                    // un recordatorio puntual ("dentista a las 4") en bloque
                    // de 1h ("16:00–17:00") apenas el usuario decía "muévelo
                    // a las 6". Ahora:
                    //   - Si era recordatorio o duración inferida → trasladar
                    //     el padding interno (5 min) sin asignar rango real.
                    //   - Si tenía rango real → preservar la duración exacta
                    //     (delta) y trasladarla a la nueva hora.
                    let oldStart = event.startTime
                    let wasPointInTime = event.displayAsPointInTime
                    event.startTime = newStart
                    if wasPointInTime {
                        event.endTime = cal.date(byAdding: .minute, value: 5, to: newStart)
                    } else if let oldEnd = event.endTime {
                        let delta = oldEnd.timeIntervalSince(oldStart)
                        event.endTime = newStart.addingTimeInterval(delta)
                    }
                }
            case .setLocation(let loc):
                event.location = loc
            case .setTitle(let newTitle):
                event.title = newTitle
            }
            store.updateEvent(event)
            store.updateNovaContext(
                from: userText,
                title: event.title,
                date: event.startTime,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let timeLabel = DateFormatters.hourMinute.string(from: event.startTime)
            let dayLabel = DateFormatters.capitalizeFirst(
                DateFormatters.weekdayDay.string(from: event.startTime)
            )
            return InlineNovaResponse(
                userText: userText,
                summary: "Evento actualizado.",
                details: "«\(event.title)» · \(dayLabel) · \(timeLabel)",
                action: .openCalendar
            )

        case .convertLastToTask:
            // Convertir el último evento en tarea: agregar tarea con el título
            // y borrar el evento. NO usamos contexto del lastTask porque
            // estamos pasando un evento a tarea.
            let title = store.novaContext.lastTitle ?? "Nueva tarea"
            let task = FocusTask(title: title, priority: .media, category: .hoy)
            store.addTask(task)
            if let eventId = store.novaContext.lastEventId {
                store.deleteEvent(eventId)
            }
            store.updateNovaContext(
                from: userText,
                title: title,
                kind: .task,
                taskId: task.id
            )
            return InlineNovaResponse(
                userText: userText,
                summary: "Listo, lo paso a tareas.",
                details: "«\(title)» quedó en pendientes de hoy.",
                action: .openTasksList
            )

        case .deleteLastItem:
            // Borrar el último ítem creado (evento o tarea) usando el contexto.
            let ctx = store.novaContext
            if let eventId = ctx.lastEventId, store.events.contains(where: { $0.id == eventId }) {
                let title = ctx.lastTitle ?? "Evento"
                store.deleteEvent(eventId)
                store.clearNovaContext()
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Eliminado.",
                    details: "«\(title)» se borró del calendario.",
                    action: .dismiss
                )
            }
            if let taskId = ctx.lastTaskId, store.tasks.contains(where: { $0.id == taskId }) {
                let title = ctx.lastTitle ?? "Tarea"
                store.deleteTask(taskId)
                store.clearNovaContext()
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Eliminada.",
                    details: "«\(title)» se borró de pendientes.",
                    action: .dismiss
                )
            }
            return InlineNovaResponse(
                userText: userText,
                summary: "Para borrar el último ítem necesito uno reciente.",
                details: "Dime «borra X» y lo encuentro por su nombre. También puedes arrastrar a la izquierda en Mi Día o Calendario.",
                action: .dismiss,
                tone: .clarify
            )

        case .deleteEventByActivity(let activity):
            // Borrar evento existente por título aproximado. Antes (pre-fix
            // 2026-05-19) este input caía al createTask y creaba una tarea
            // con el mismo nombre — basura. Ahora resolvemos vía
            // findEventByApproxTitle y borramos si hay match.
            if let event = NovaResponder.findEventByApproxTitle(activity, in: store.events) {
                let title = event.title
                store.deleteEvent(event.id)
                store.clearNovaContext()
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Eliminado.",
                    details: "«\(title)» se borró del calendario.",
                    action: .dismiss
                )
            }
            return InlineNovaResponse(
                userText: userText,
                summary: "Busqué «\(activity)» y no lo veo en tu agenda.",
                details: "¿Lo tienes con otro nombre? Si me dices el título exacto lo borro. También puedes revisar el Calendario.",
                action: .openCalendar,
                tone: .clarify
            )

        case .rescheduleEventByActivity(let activity, let hour, let minute):
            // Mover evento existente por título aproximado a nueva hora.
            // Antes el input caía al createEvent y duplicaba — ahora editamos
            // el evento existente preservando su día.
            guard let event = NovaResponder.findEventByApproxTitle(activity, in: store.events) else {
                let timeStr = String(format: "%02d:%02d", hour, minute)
                return InlineNovaResponse(
                    userText: userText,
                    summary: "No tengo «\(activity)» en tu agenda como para moverlo.",
                    details: "¿Quieres que lo cree nuevo a las \(timeStr)? Dime «agenda \(activity) hoy a las \(timeStr)».",
                    action: .dismiss,
                    tone: .clarify
                )
            }
            let cal = Calendar.current
            guard let newStart = cal.date(
                bySettingHour: hour, minute: minute, second: 0, of: event.startTime
            ) else {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Necesito la hora en otro formato.",
                    details: "Dímela en 24h, por ejemplo «a las 17:00», y muevo «\(event.title)» de una.",
                    tone: .clarify
                )
            }
            var updated = event
            updated.startTime = newStart
            if let oldEnd = event.endTime {
                let duration = oldEnd.timeIntervalSince(event.startTime)
                updated.endTime = newStart.addingTimeInterval(duration)
            }
            store.updateEvent(updated)
            store.updateNovaContext(
                from: userText,
                title: event.title,
                date: newStart,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let timeLabel = DateFormatters.hourMinute.string(from: newStart)
            return InlineNovaResponse(
                userText: userText,
                summary: "Listo. Moví «\(event.title)» a las \(timeLabel).",
                details: nil,
                action: .openCalendar
            )

        case .attachReminderToEvent(let activity, let offsetMinutes, let note):
            // Atribuir reminder a evento existente. Si no encuentra el evento,
            // NO crea uno nuevo (evita duplicado).
            guard let event = NovaResponder.findEventByApproxTitle(activity, in: store.events) else {
                let offsetLabel = offsetMinutes < 60 ? "\(offsetMinutes) min antes" : "\(offsetMinutes/60) h antes"
                return InlineNovaResponse(
                    userText: userText,
                    summary: "Para ponerle aviso a «\(activity)» primero necesito ese evento en tu agenda.",
                    details: "Si me das día y hora lo creo y le pongo el aviso \(offsetLabel) de una. Ej: «agenda \(activity) mañana a las 18».",
                    action: .dismiss,
                    tone: .clarify
                )
            }
            // Reemplazar offsets, no acumular. La syncLocalNotification cancela
            // las pendientes anteriores antes de programar la nueva.
            var updated = event
            updated.reminderOffsets = [offsetMinutes]
            if let note, !note.isEmpty {
                updated.reminderNotes = [note]
            } else {
                updated.reminderNotes = nil
            }
            store.updateEvent(updated)
            store.updateNovaContext(
                from: userText,
                title: event.title,
                date: event.startTime,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let offsetLabel = offsetMinutes < 60
                ? "\(offsetMinutes) min antes"
                : (offsetMinutes % 60 == 0 ? "\(offsetMinutes/60) h antes" : "\(offsetMinutes/60) h \(offsetMinutes%60) min antes")
            let detailsText = note.flatMap { $0.isEmpty ? nil : "Nota del aviso: «\($0)»." }
            return InlineNovaResponse(
                userText: userText,
                summary: "Listo. Te aviso \(offsetLabel) de «\(event.title)».",
                details: detailsText,
                action: nil
            )

        case .organizeDay:
            store.addSuggestion(NovaSuggestion(
                title: "Plan del día actualizado",
                detail: "Bloqueé tu mañana para foco profundo y dejé pendientes para después del mediodía. Aprueba para aplicar.",
                kind: .rebalance,
                priority: .high,
                suggestedAction: "Aplicar plan del día"
            ))
            store.addSuggestion(NovaSuggestion(
                title: "Pausa al mediodía",
                detail: "Te reservo 20 min sin notificaciones entre clases.",
                kind: .break_,
                priority: .normal,
                suggestedAction: "Reservar pausa 13:00"
            ))
            store.addSuggestion(NovaSuggestion(
                title: "Repaso para mañana",
                detail: "Te dejo un bloque de 60 min antes de tu próxima entrega.",
                kind: .prep,
                priority: .normal,
                suggestedAction: "Bloquear repaso"
            ))
            return InlineNovaResponse(
                userText: userText,
                summary: "Te dejé 3 sugerencias en la Bandeja.",
                details: "Aprueba las que te sirvan; las demás se descartan.",
                action: .openBandeja
            )

        case .reviewPending:
            // Filtro fuzzy por tema si el usuario lo pidió ("de la
            // universidad", "del trabajo", "de la casa"). Sin filtro,
            // devolvemos todas las tareas pendientes de hoy.
            let allPending = store.pendingTodayTasks
            let topicMatch = NovaResponder.topicKeywords(in: userText.lowercased())
            let pending: [FocusTask]
            let topicLabel: String?
            if let kw = topicMatch {
                topicLabel = kw.label
                pending = allPending.filter { task in
                    let haystack = (task.title + " " + (task.notes ?? "")).lowercased()
                    return kw.keywords.contains { haystack.contains($0) }
                }
            } else {
                topicLabel = nil
                pending = allPending
            }
            if pending.isEmpty {
                let msg = topicLabel.map { "No veo pendientes de \($0) en tu lista de hoy." }
                    ?? "No tienes pendientes de hoy. Disfrútalo."
                return InlineNovaResponse(userText: userText, summary: msg)
            }
            let preview = pending.prefix(5).map { "• \($0.title)" }.joined(separator: "\n")
            let summary: String
            if let label = topicLabel {
                summary = pending.count == 1
                    ? "Tienes 1 pendiente de \(label)."
                    : "Tienes \(pending.count) pendientes de \(label)."
            } else {
                summary = pending.count == 1
                    ? "Tienes 1 pendiente hoy."
                    : "Tienes \(pending.count) pendientes hoy."
            }
            return InlineNovaResponse(
                userText: userText,
                summary: summary,
                details: preview,
                action: pending.count > 5 ? .openTasksList : nil
            )

        case .reviewToday:
            // Incluir eventos demo si el usuario está en modo demo y aún
            // no tiene eventos propios — la UI los muestra como tarjetas,
            // Nova tiene que ser coherente con eso.
            let evts: [FocusEvent]
            if store.hasUserEvents {
                evts = store.todayEvents().sorted { $0.startTime < $1.startTime }
            } else if store.isInDemoMode {
                evts = DemoDataProvider.shared.exampleTodayEvents()
                    .filter { !store.dismissedDemoEventTitles.contains($0.title) }
                    .sorted { $0.startTime < $1.startTime }
            } else {
                evts = []
            }
            let pending = store.pendingTodayTasks
            if evts.isEmpty && pending.isEmpty {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "No tienes nada agendado para hoy."
                )
            }
            let fmt = DateFormatter()
            fmt.dateFormat = "HH:mm"
            fmt.locale = Locale(identifier: "es")
            var lines: [String] = []
            for e in evts {
                lines.append("• \(fmt.string(from: e.startTime)) — \(e.title)")
            }
            let header = evts.count == 1 ? "1 evento hoy" : "\(evts.count) eventos hoy"
            let taskNote = pending.isEmpty ? nil
                : (pending.count == 1 ? "+ 1 tarea pendiente" : "+ \(pending.count) tareas pendientes")
            let detailLines = lines + (taskNote.map { [$0] } ?? [])
            return InlineNovaResponse(
                userText: userText,
                summary: header,
                details: detailLines.joined(separator: "\n"),
                action: nil
            )

        case .askAboutDemo:
            return InlineNovaResponse(
                userText: userText,
                summary: "Los ejemplos desaparecen automáticamente.",
                details: "Solo aparecen mientras no tengas datos tuyos. Apenas crees tu primer evento o tarea, se reemplazan.",
                action: nil
            )

        case .proposeActionPlan(let actions):
            // Modo PROPUESTA — no creamos nada. Guardamos en novaContext
            // y mostramos el plan numerado. El usuario confirma con
            // "sí, agrégalas" en el siguiente turno.
            store.novaContext.pendingActionPlan = actions
            store.novaContext.updatedAt = Date()
            let bullets = actions.enumerated().map { idx, action in
                "\(idx + 1). \(action.title)"
            }.joined(separator: "\n")
            return InlineNovaResponse(
                userText: userText,
                summary: "Entendí \(actions.count) acciones.",
                details: "\(bullets)\n\nDi «sí, agrégalas» y las creo como tareas.",
                action: nil,
                tone: .clarify
            )

        case .annotateTaskCorrection, .annotateDependency:
            // Delegamos al store; ahí está la lógica de fuzzy match y
            // anotación. Una sola fuente de verdad.
            let reply = store.applyLocalNovaIntent(intent, userText: userText)
                ?? "Anoté la nota."
            return InlineNovaResponse(
                userText: userText,
                summary: reply,
                details: nil,
                action: nil
            )

        case .confirmActionPlan:
            // Delegamos al store para una sola fuente de verdad. El store
            // ya maneja distribución temporal según userText ("para hoy",
            // "para mañana", "para hoy y mañana") y devuelve el texto humano.
            guard let plan = store.novaContext.pendingActionPlan, !plan.isEmpty else {
                return InlineNovaResponse(
                    userText: userText,
                    summary: "No tengo una lista esperando confirmación.",
                    details: "Pégame tus acciones (una por línea) y te las organizo como tareas listas para confirmar.",
                    action: nil,
                    tone: .clarify
                )
            }
            let reply = store.applyLocalNovaIntent(intent, userText: userText)
                ?? "Listo, anoté las tareas."
            return InlineNovaResponse(
                userText: userText,
                summary: reply,
                details: nil,
                action: nil
            )

        case .smallTalk(let reply):
            return InlineNovaResponse(
                userText: userText,
                summary: reply
            )

        case .clarify(let reason):
            // Guarda pending clarification para que el siguiente turno corto
            // pueda completar la acción sin perder contexto.
            if let pending = buildPendingClarification(
                from: reason,
                userText: userText,
                source: .inlineMiDia
            ) {
                store.setPendingClarification(pending)
            }
            // Quick chips por razón — el usuario puede completar con un tap
            // en lugar de escribir. Solo se muestran en estado `.clarify`.
            return InlineNovaResponse(
                userText: userText,
                summary: clarifyHeadline(reason),
                details: clarifyDetail(reason),
                action: nil,
                isError: false,
                tone: .clarify,
                quickChips: chipsFor(reason: reason)
            )
        }
    }

    /// Devuelve chips de respuesta rápida sugeridos según el motivo del
    /// clarify. Diseñados para que el usuario complete con un tap:
    ///   - eventNeedsTime: "9:00", "12:00", "15:00", "Editar".
    ///   - eventNeedsDateTime: "Hoy 12:00", "Mañana 9:00", "Editar".
    ///   - taskNeedsTitle / eventNeedsTitle / noContext / unclear: ninguno.
    private func chipsFor(reason: NovaIntent.ClarifyReason) -> [NovaQuickChip] {
        switch reason {
        case .eventNeedsTime:
            return [
                NovaQuickChip(label: "9:00", sendText: "a las 9"),
                NovaQuickChip(label: "12:00", sendText: "a las 12"),
                NovaQuickChip(label: "15:00", sendText: "a las 15"),
                NovaQuickChip(label: "18:00", sendText: "a las 18")
            ]
        case .eventNeedsDateTime:
            return [
                NovaQuickChip(label: "Hoy 12:00", sendText: "hoy a las 12"),
                NovaQuickChip(label: "Hoy 18:00", sendText: "hoy a las 18"),
                NovaQuickChip(label: "Mañana 9:00", sendText: "mañana a las 9")
            ]
        default:
            return []
        }
    }

    /// Convierte un `ClarifyReason` en un `PendingClarification` apto para
    /// guardarse en `NovaContext`. Devuelve nil cuando la clarify no tiene
    /// suficiente info para resolver follow-ups (taskNeedsTitle, noContext,
    /// unclear) — esos casos requieren que el usuario empiece de nuevo.
    private func buildPendingClarification(
        from reason: NovaIntent.ClarifyReason,
        userText: String,
        source: PendingClarification.Source
    ) -> PendingClarification? {
        let lower = userText.lowercased()
        // Detección de "quiero recordatorio" — usaba `contains("acu")` que
        // generaba falsos positivos en palabras como "acudir", "acumular",
        // "acuse". Ahora se delega a la utilidad central que chequea
        // triggers explícitos ("acuérdame", "recuérdame", "avísame", etc.)
        // con word boundaries.
        let wantsReminder = NovaActionNormalizer.isReminderTrigger(in: userText)
            || NovaActionNormalizer.impliesPunctualReminder(in: userText)
        let section = NovaResponder.guessSection(for: userText)
        switch reason {
        case .eventNeedsTime(let title, let date):
            return PendingClarification(
                originalInput: userText,
                kind: wantsReminder ? .reminder : .event,
                proposedTitle: title,
                proposedDate: date,
                proposedSection: section,
                wantsReminder: wantsReminder,
                missingFields: [.time],
                questionAsked: "¿A qué hora?",
                source: source
            )
        case .eventNeedsDateTime(let title):
            return PendingClarification(
                originalInput: userText,
                kind: wantsReminder ? .reminder : .event,
                proposedTitle: title,
                proposedDate: nil,
                proposedSection: section,
                wantsReminder: wantsReminder,
                missingFields: [.date, .time],
                questionAsked: "¿Para qué día y hora?",
                source: source
            )
        case .taskNeedsTitle, .eventNeedsTitle, .noContext, .unclear:
            return nil
        }
    }

    /// Mapea una fecha de deadline a la categoría legacy del modelo
    /// `FocusTask` (hoy / semana / algún día). Necesario hasta que migremos
    /// a categorías derivadas de la fecha real.
    private func categoryForDueDate(_ date: Date?) -> TaskCategory {
        guard let date else { return .hoy }
        let cal = Calendar.current
        if cal.isDateInToday(date) { return .hoy }
        // Mañana o cualquier día dentro de los próximos 7 días → semana.
        if let diff = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: date)).day,
           diff >= 1 && diff <= 7 {
            return .semana
        }
        return .algunDia
    }

    private func clarifyHeadline(_ reason: NovaIntent.ClarifyReason) -> String {
        switch reason {
        case .taskNeedsTitle:           return "¿Qué tarea quieres que anote?"
        case .eventNeedsTitle:          return "¿Qué evento quieres agendar?"
        case .eventNeedsTime(let title, _):
            return "Tengo «\(title)». ¿A qué hora lo dejo?"
        case .eventNeedsDateTime(let title):
            return "Tengo «\(title)». ¿Para qué día y a qué hora?"
        case .noContext:                return "Cuéntame un poco más para ayudarte bien."
        case .unclear:                  return "Cuéntame con más detalle qué quieres hacer."
        }
    }

    private func clarifyDetail(_ reason: NovaIntent.ClarifyReason) -> String {
        switch reason {
        case .taskNeedsTitle:
            return "Prueba: «crea tarea estudiar cálculo»."
        case .eventNeedsTitle:
            return "Prueba: «agenda reunión con Juan mañana a las 12»."
        case .eventNeedsTime(_, let date):
            let day = DateFormatters.weekdayDay.string(from: date).lowercased()
            return "Dime una hora para el \(day). Ej: «a las 14» o «tipo 3»."
        case .noContext:
            return "Vuelve a decirme qué quieres crear. Ej: «agenda reunión mañana a las 12»."
        case .eventNeedsDateTime(let title):
            return "Dime cuándo. Ej: «\(title) mañana a las 12»."
        case .unclear:
            return "Puedo crear tareas, agendar eventos u ordenar tu día. Dime con más detalle."
        }
    }

    private func handleInlineAction(_ action: InlineNovaAction?) {
        guard let action else { return }
        HapticManager.shared.tap()
        switch action {
        case .openCalendar:
            withAnimation(.easeInOut(duration: 0.28)) {
                nav.selectedTab = .calendario
            }
        case .openTasksList:
            // Por ahora salta a Nova → Acciones donde está el link "Todas las
            // tareas". Cuando exista una vista de pendientes dedicada, se
            // ajusta acá.
            nav.openNova(segment: .acciones)
        case .openBandeja:
            nav.openNova(segment: .bandeja)
        case .openChat:
            nav.openNova(segment: .chat)
        case .dismiss:
            withAnimation(.easeOut(duration: 0.20)) {
                inlineResponse = nil
            }
        }
    }

    /// Maneja el tap en los chips de una propuesta (mode=proposal).
    /// - .apply → ejecuta `pendingProposalActions` via applyBackendActions.
    /// - .edit → abre Nova chat para que el user elabore (mantiene contexto).
    /// - .dismiss → limpia la propuesta y cierra la card.
    private func handleProposalChip(_ action: NovaProposalAction) {
        HapticManager.shared.tap()
        let actions = pendingProposalActions
        let originalUserText = pendingProposalUserText

        switch action {
        case .apply:
            guard !actions.isEmpty else {
                // No hay nada que aplicar — solo cerrar.
                withAnimation(.easeOut(duration: 0.20)) {
                    inlineResponse = nil
                }
                return
            }
            // Aplicamos pasando por el validator post-IA (mismo gate que
            // chat_with_action) — si el modelo se equivocó proponiendo
            // basura, el validator la frena.
            let validation = NovaActionValidator.validate(
                actions: actions,
                userText: originalUserText
            )
            if validation.shouldAsk {
                inlineResponse = InlineNovaResponse(
                    userText: originalUserText,
                    summary: validation.suggestedQuestion ?? "Mejor revisamos antes.",
                    details: "La propuesta tenía algo que no me cuadró.",
                    action: .dismiss,
                    isError: false,
                    tone: .clarify
                )
                pendingProposalActions = []
                pendingProposalUserText = ""
                return
            }
            let outcome = store.applyBackendActions(validation.safeActions,
                                                   userText: originalUserText)
            pendingProposalActions = []
            pendingProposalUserText = ""
            let summary = outcome.summary ?? "Listo, apliqué la propuesta."
            let details = outcome.details
            let resultAction: InlineNovaAction = {
                if outcome.primaryEventId != nil { return .openCalendar }
                if outcome.primaryTaskId != nil { return .openTasksList }
                return .dismiss
            }()
            withAnimation(.easeOut(duration: 0.20)) {
                inlineResponse = InlineNovaResponse(
                    userText: originalUserText,
                    summary: summary,
                    details: details,
                    action: resultAction,
                    isError: false,
                    tone: .success
                )
            }

        case .edit:
            // Abre Nova chat — el user puede elaborar/corregir con todo
            // el contexto de la propuesta a la vista. Mantenemos la
            // propuesta pendiente por si decide aplicarla después.
            nav.openNova(segment: .chat)
            withAnimation(.easeOut(duration: 0.20)) {
                inlineResponse = nil
            }

        case .dismiss:
            pendingProposalActions = []
            pendingProposalUserText = ""
            withAnimation(.easeOut(duration: 0.20)) {
                inlineResponse = nil
            }
        }
    }

    // MARK: - Vencidos

    /// Sección "Vencidos" — recordatorios que ya pasaron y siguen sin
    /// atender. Se muestra entre el header de Mi Día y el timeline para
    /// que el usuario los vea primero. Compacta — cada uno con título,
    /// hora vencida, y acciones (reprogramar +5 min / borrar).
    @ViewBuilder
    private var overdueRemindersSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: 6) {
                Image(systemName: "bell.slash.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.Colors.warning)
                // Theme 2.0: label en captionMono UPPERCASE + tracking opinado.
                Text("Vencidos")
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.warning)
                    .textCase(.uppercase)
            }
            VStack(spacing: Theme.Spacing.xs) {
                ForEach(overdueReminders.prefix(3)) { reminder in
                    overdueReminderRow(reminder)
                }
            }
        }
    }

    private func overdueReminderRow(_ event: FocusEvent) -> some View {
        let timeLabel = DateFormatters.hourMinute.string(from: event.startTime)
        let elapsed = Int(Date().timeIntervalSince(event.startTime) / 60)
        let ago = elapsed < 60
            ? "hace \(max(elapsed, 1)) min"
            : "hace \(elapsed / 60) h"
        return HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "clock.badge.exclamationmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Colors.warning)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(Theme.Typography.bodyEmphasized)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .lineLimit(1)
                Text("\(timeLabel) · \(ago)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textTertiary)
            }
            Spacer()
            // Reprogramar a "ahora + 5 min" como atajo rápido.
            Button {
                HapticManager.shared.tick()
                reschedule(event, addingMinutes: 5)
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.Colors.focusAccent)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Theme.Colors.focusAccentSoft))
            }
            .buttonStyle(.plain)
            // Borrar = "ya pasó, no me importa".
            Button {
                HapticManager.shared.tap()
                store.deleteEvent(event.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.Colors.textTertiary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Theme.Colors.surfaceHigh))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        // Theme 2.0: borde warning más sutil + warningSoft fill tonal para
        // que la urgencia se sienta sin ser agresiva.
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .fill(Theme.Colors.warningSoft.opacity(0.45))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .strokeBorder(Theme.Colors.warning.opacity(0.30), lineWidth: 1)
                )
        )
    }

    /// Reprograma un recordatorio sumando minutos desde "ahora". Triggers
    /// re-schedule de la notificación automáticamente via updateEvent.
    private func reschedule(_ event: FocusEvent, addingMinutes: Int) {
        var updated = event
        let newStart = Date().addingTimeInterval(TimeInterval(addingMinutes * 60))
        updated.startTime = newStart
        // Mantener punto en el tiempo (5 min de duración interna como antes).
        updated.endTime = newStart.addingTimeInterval(5 * 60)
        store.updateEvent(updated)
    }

    private var timelineSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            // El conteo "N bloques" ya aparece en el subtítulo del header
            // ("Martes 13 · 2 bloques · 1 pendiente"). Si lo repitiéramos
            // acá quedaría redundante. Dejamos sólo la etiqueta "TU DÍA"
            // como ancla de sección. Misma decisión en PENDIENTES.
            HStack(alignment: .firstTextBaseline) {
                Text("TU DÍA")
                    .sectionLabelStyle()
                Spacer()
            }
            .padding(.horizontal, Theme.Spacing.xl)

            if displayEvents.isEmpty {
                // 2026-05-14: el botón ahora navega directo al CHAT de Nova
                // (no a Bandeja). Antes `nav.openNova()` sin args caía en el
                // segmento por defecto `.bandeja` — un usuario que toca
                // "Hablar con Nova" espera abrir conversación, no inbox de
                // sugerencias. `aiStyledAction: true` aplica el degrade
                // violeta→azul (estilo Gemini) que pidió el usuario para
                // comunicar visualmente "esto va a la IA".
                EmptyStateView(
                    symbol: "sun.max",
                    title: "Tu día está libre",
                    message: "Agrega un bloque o pídele a Nova que lo organice.",
                    actionLabel: "Hablar con Nova",
                    action: { nav.openNova(segment: .chat) },
                    aiStyledAction: true
                )
                .frame(minHeight: 260)
                .padding(.horizontal, Theme.Spacing.xl)
            } else {
                let shown = showAllEvents
                    ? displayEvents
                    : Array(displayEvents.prefix(visibleEventsLimit))
                let hiddenCount = displayEvents.count - shown.count
                // Densidad del timeline: spacious con 1-2 eventos (más
                // presencia vertical, fonts más grandes), balanced con
                // 3-5, compact con 6+. Adapta el ritmo visual al día.
                let density = TimelineRowDensity.of(eventCount: displayEvents.count)

                VStack(spacing: density.rowSpacing) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { idx, event in
                        SwipeToDelete(enabled: true) {
                            if store.hasUserEvents {
                                store.deleteEvent(event.id)
                            } else {
                                withAnimation(.easeOut(duration: 0.22)) {
                                    store.dismissDemoEvent(title: event.title)
                                }
                            }
                            toast.success("Evento eliminado", symbol: "trash.fill")
                        } content: {
                            TimelineEventRow(
                                event: event,
                                isLast: idx == shown.count - 1 && hiddenCount == 0,
                                density: density,
                                isNext: event.id == store.nextBlock?.id
                            )
                        }
                        .contextMenu {
                            if store.hasUserEvents {
                                Button {
                                    editingEvent = event
                                } label: {
                                    Label("Editar", systemImage: "pencil")
                                }
                            }
                            Button(role: .destructive) {
                                if store.hasUserEvents {
                                    store.deleteEvent(event.id)
                                } else {
                                    store.dismissDemoEvent(title: event.title)
                                }
                                toast.success("Evento eliminado", symbol: "trash.fill")
                            } label: {
                                Label("Eliminar", systemImage: "trash")
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.xl)

                if hiddenCount > 0 {
                    Button {
                        HapticManager.shared.tick()
                        withAnimation(.easeInOut(duration: 0.25)) {
                            showAllEvents = true
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Ver \(hiddenCount) \(hiddenCount == 1 ? "bloque más" : "bloques más")")
                                .font(Theme.Typography.subheadEmphasized)
                                .foregroundStyle(Theme.Colors.focusAccent)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.Colors.focusAccent)
                        }
                        .padding(.vertical, Theme.Spacing.md - 2)
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, Theme.Spacing.xs)
                }
            }
        }
    }

    // MARK: - Preview "Para mañana"

    /// Cantidad máxima de eventos de mañana visibles en la preview. Más
    /// que esto compite con los bloques de hoy y la sección deja de
    /// sentirse como "vista previa" — pasa a "segunda agenda". Ver
    /// `tomorrowExtraCount` para el cómputo del "y X más".
    private static let tomorrowPreviewLimit: Int = 2

    /// Eventos de mañana efectivamente renderizados (cap 2).
    private var tomorrowShownEvents: [FocusEvent] {
        Array(tomorrowEvents.prefix(Self.tomorrowPreviewLimit))
    }

    /// Cantidad de eventos de mañana que NO entran en la preview — alimenta
    /// el texto "y N más". 0 si todos los eventos caben en `prefix(2)`.
    private var tomorrowExtraCount: Int {
        max(0, tomorrowEvents.count - Self.tomorrowPreviewLimit)
    }

    /// Vista previa pequeña y elegante de los eventos de mañana. Aparece
    /// siempre que haya al menos un evento agendado para el día siguiente
    /// (cualquier hora del día actual) — el usuario necesita confirmación
    /// visual inmediata cuando Nova agenda algo "para mañana".
    ///
    /// Diseño:
    /// - Header tipográfico, sin card hero — el contenedor es un tinte
    ///   azul muy suave con borde apenas visible, NO una card sólida.
    /// - Máximo 2 filas + "y N más" en azul acento (insinúa que es
    ///   tappable). Toda la sección abre el Calendario en la fecha de
    ///   mañana al tocarla.
    /// - Tipografía un punto debajo del timeline real para que no compita
    ///   con la jerarquía de "hoy".
    @ViewBuilder
    private var nextDayPreviewSection: some View {
        if shouldShowTomorrowPreview {
            Button {
                let cal = Calendar.current
                if let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) {
                    nav.openCalendar(on: tomorrow)
                }
            } label: {
                nextDayPreviewBody
            }
            .buttonStyle(.plain)
            .padding(.horizontal, Theme.Spacing.xl)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Abre el calendario en el día de mañana")
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    /// Contenido visual del preview — separado para que el Button padre
    /// solo aplique tap/hint sin alterar la jerarquía.
    private var nextDayPreviewBody: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm + 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                // Glyph organizacional, no sun/Nova-themed. `calendar` ata el
                // preview a su destino (tab Calendario) y refuerza la
                // identidad Focus de "agenda y planificación" sin pisar la
                // marca (autofocus brackets del AppIcon).
                Image(systemName: "calendar")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.Colors.textTertiary)
                // Theme 2.0: label "MAÑANA" en captionMono UPPERCASE para
                // coherencia con badges del timeline (PRÓXIMO/EN CURSO/etc).
                Text("Mañana")
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.textTertiary)
                    .textCase(.uppercase)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.Colors.focusAccent.opacity(0.65))
            }

            VStack(spacing: Theme.Spacing.xs) {
                ForEach(tomorrowShownEvents) { event in
                    tomorrowPreviewRow(event)
                }
                if tomorrowExtraCount > 0 {
                    Text(tomorrowExtraCount == 1
                         ? "y 1 más"
                         : "y \(tomorrowExtraCount) más")
                        .font(Theme.Typography.captionEmphasized)
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .padding(.top, 4)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.md)
        .padding(.horizontal, Theme.Spacing.md + 2)
        // Theme 2.0: borderHairline + surfaceTinted más tenue. La preview
        // de mañana es info secundaria, debe sentirse "atrás" del timeline.
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.Colors.surfaceTinted.opacity(0.55))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .strokeBorder(Theme.Colors.borderHairline, lineWidth: Theme.Stroke.hairline)
                )
        )
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }

    /// Fila individual del preview. Si el evento es punto en el tiempo
    /// (recordatorio o duración inferida) mostramos solo la hora; si no,
    /// la hora de inicio. Si el título es muy largo, se trunca con `…`.
    private func tomorrowPreviewRow(_ event: FocusEvent) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            Text(DateFormatters.hourMinute.string(from: event.startTime))
                .font(Theme.Typography.timestamp)
                .foregroundStyle(Theme.Colors.textTertiary)
                .frame(width: 50, alignment: .leading)
            Capsule()
                .fill(event.section.color.opacity(0.55))
                .frame(width: 3, height: 18)
            Text(event.title)
                .font(Theme.Typography.subhead)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer()
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Timeline row

/// Densidad visual del timeline — se adapta al número de eventos del día.
/// Cuando hay pocos eventos (1-2), las cards crecen para llenar el espacio
/// con presencia. Con muchos eventos, se compactan para que quepan sin
/// hacer scroll excesivo.
enum TimelineRowDensity {
    case spacious   // 1-2 eventos — cards grandes, mucho aire
    case balanced   // 3-5 eventos — layout normal
    case compact    // 6+ eventos — compactado para densidad

    var verticalPadding: CGFloat {
        switch self {
        case .spacious: return Theme.Spacing.lg + 4   // ~22
        case .balanced: return Theme.Spacing.md       // ~12
        case .compact:  return Theme.Spacing.sm       // ~8
        }
    }

    var titleFont: Font {
        switch self {
        case .spacious: return .system(size: 22, weight: .semibold)
        case .balanced: return Theme.Typography.bodyBold
        case .compact:  return Theme.Typography.subheadEmphasized
        }
    }

    var rowSpacing: CGFloat {
        switch self {
        case .spacious: return Theme.Spacing.lg
        case .balanced: return Theme.Spacing.md
        case .compact:  return Theme.Spacing.sm
        }
    }

    var sidebarWidth: CGFloat {
        // Theme 2.0: banda lateral MÁS ancha para que el color de la
        // sección (Foco cobalto, Reunión indigo, etc.) se lea como
        // marcador sólido visible, no como hairline decorativo.
        switch self {
        case .spacious: return 6
        case .balanced: return 7
        case .compact:  return 5
        }
    }

    var metaFont: Font {
        switch self {
        case .spacious: return Theme.Typography.subhead
        case .balanced: return Theme.Typography.caption
        case .compact:  return Theme.Typography.caption
        }
    }

    static func of(eventCount n: Int) -> TimelineRowDensity {
        // 2026-05-13: matamos `spacious`. Antes 1-2 eventos disparaba un
        // tratamiento hero (22pt title, gradient sobre la card, padding xxl)
        // que se sentía sobredimensionado para un solo bloque. El usuario
        // explícito: "se ve demasiado grande cuando hay solo una cosa".
        // Ahora 1-5 eventos comparten densidad `balanced` (17pt bodyBold,
        // 12pt padding, surface plano). La identidad del primer item ya
        // se da con el badge "PRÓXIMO" + la banda lateral de color, no
        // hace falta inflar la card. `spacious` queda en la enum por si
        // alguna sección futura la quiere, pero el día no la activa.
        if n <= 5 { return .balanced }
        return .compact
    }
}

private struct TimelineEventRow: View {
    let event: FocusEvent
    let isLast: Bool
    var density: TimelineRowDensity = .balanced
    /// True cuando este es el primer evento upcoming del día — se muestra
    /// un mini badge "PRÓXIMO" para darle presencia visual sin necesitar
    /// una card duplicada (la antigua ProximoBloqueCard).
    var isNext: Bool = false

    @EnvironmentObject private var coachMarks: CoachMarksStore

    /// Chip de recordatorio anticipado. Si el evento tiene
    /// `reminderOffsets = [40]` mostramos "🔔 40 min antes" dentro del
    /// mismo bloque — antes era una tarjeta separada que duplicaba
    /// visualmente el evento.
    private var primaryReminderOffsetMinutes: Int? {
        guard let offsets = event.reminderOffsets, !offsets.isEmpty else { return nil }
        return offsets.first
    }

    private var reminderChipLabel: String? {
        guard let m = primaryReminderOffsetMinutes else { return nil }
        let extraCount = (event.reminderOffsets?.count ?? 0) - 1
        let unit: String
        if m < 60 {
            unit = "\(m) min antes"
        } else if m == 60 {
            unit = "1 h antes"
        } else if m % 60 == 0 {
            unit = "\(m / 60) h antes"
        } else {
            let h = m / 60
            let mm = m % 60
            unit = "\(h) h \(mm) min antes"
        }
        // "Aviso N min antes" lee como subtítulo de metadata del evento,
        // distinto del propio título — match al spec del usuario.
        let base = "Aviso \(unit)"
        return extraCount > 0 ? "\(base) (+\(extraCount))" : base
    }

    /// Texto custom del primer reminder (si existe). Usado para mostrar la
    /// acción concreta debajo del chip cuando el user dijo algo como
    /// "acuérdame 20 min antes de echar las zapatillas a la mochila".
    private var primaryReminderNote: String? {
        event.reminderNote(at: 0)
    }

    /// Theme 2.0: para aplicar opacity + scale a eventos terminados.
    /// "Pasado" = endTime (o startTime si puntual) ya pasó respecto a now.
    private var eventHasPassed: Bool {
        let effectiveEnd = event.endTime ?? event.startTime
        return effectiveEnd < Date()
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            // Hora a la izquierda
            VStack(alignment: .trailing, spacing: 2) {
                Text(event.timeRangeLabel.components(separatedBy: " ").first ?? "")
                    .font(density == .spacious
                          ? .system(size: 13, weight: .semibold)
                          : Theme.Typography.captionEmphasized)
                    .foregroundStyle(Theme.Colors.textPrimary)
                if let dur = event.durationLabel {
                    Text(dur)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textTertiary)
                }
            }
            .frame(width: 50, alignment: .trailing)

            // Bullet + línea
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .stroke(event.section.color.opacity(0.5), lineWidth: 1.5)
                        .frame(width: density == .spacious ? 12 : 10,
                               height: density == .spacious ? 12 : 10)
                    Circle()
                        .fill(event.section.color)
                        .frame(width: density == .spacious ? 6 : 5,
                               height: density == .spacious ? 6 : 5)
                }
                if !isLast {
                    Rectangle()
                        .fill(Theme.Colors.border)
                        .frame(width: 1)
                        .padding(.top, 2)
                }
            }

            // Card del evento — banda lateral coloreada por sección que
            // sigue la curva del card. Truco: la banda es un Rectangle
            // simple ancho (sin cornerRadius) y se recorta junto con todo
            // el HStack via .clipShape con el cornerRadius del card.
            HStack(spacing: 0) {
                Rectangle()
                    .fill(event.section.color)
                    .frame(width: density.sidebarWidth)

                VStack(alignment: .leading, spacing: density == .spacious ? 8 : 6) {
                    // Theme 2.0: badges de estado en captionMono UPPERCASE con
                    // tracking opinado para density visual. Antes era SF Pro
                    // 10pt bold + tracking 1.2 — funcional pero indistinguible
                    // de un caption regular. CaptionMono da peso técnico.
                    let effectiveEnd = event.endTime ?? event.startTime
                    let hasPassed = effectiveEnd < Date()

                    if isNext && !event.isNow {
                        Text("PRÓXIMO")
                            .font(Theme.Typography.captionMono)
                            .tracking(Theme.Tracking.captionMono)
                            .foregroundStyle(Theme.Colors.focusAccent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Theme.Colors.focusAccent.opacity(0.08)))
                    } else if event.isNow {
                        Text("EN CURSO")
                            .font(Theme.Typography.captionMono)
                            .tracking(Theme.Tracking.captionMono)
                            .foregroundStyle(Theme.Colors.success)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Theme.Colors.successSoft))
                    } else if hasPassed {
                        Text("TERMINADO")
                            .font(Theme.Typography.captionMono)
                            .tracking(Theme.Tracking.captionMono)
                            .foregroundStyle(Theme.Colors.textTertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Theme.Colors.surfaceHigh))
                    }
                    Text(event.title)
                        .font(density.titleFont)
                        .foregroundStyle(Theme.Colors.textPrimary)
                        .lineLimit(2)

                    // Subtítulo / detalle (ej. "Llevar la pelota") debajo del
                    // título, en peso secundario. Solo se muestra si existe.
                    // No se renderiza espacio si subtitle es nil → la card no
                    // crece innecesariamente para eventos simples.
                    if let subtitle = event.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !subtitle.isEmpty {
                        Text(subtitle)
                            .font(density.metaFont)
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    HStack(spacing: 4) {
                        Image(systemName: event.section.symbol)
                            .font(.system(size: density == .spacious ? 12 : 11))
                            .foregroundStyle(event.section.color)
                        Text(event.section.displayName)
                            .font(density.metaFont)
                            .foregroundStyle(Theme.Colors.textTertiary)
                        if let loc = event.location, !loc.isEmpty {
                            Text("·").foregroundStyle(Theme.Colors.textQuaternary)
                            Text(loc)
                                .font(density.metaFont)
                                .foregroundStyle(Theme.Colors.textTertiary)
                                .lineLimit(1)
                        }
                    }

                    // Chip recordatorio anticipado — "🔔 40 min antes". Aparece
                    // DENTRO del mismo bloque, no como card separada arriba.
                    // Misma regla para eventos puntuales con offset y eventos
                    // con duración con offset.
                    if let chipLabel = reminderChipLabel {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Image(systemName: "bell.fill")
                                    .font(.system(size: density == .spacious ? 11 : 10, weight: .semibold))
                                    .foregroundStyle(Theme.Colors.sectionReminder)
                                Text(chipLabel)
                                    .font(density.metaFont)
                                    .foregroundStyle(Theme.Colors.sectionReminder)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                Capsule().fill(Theme.Colors.sectionReminder.opacity(0.12))
                            )
                            // Nota custom debajo del chip si el user pidió
                            // un reminder con acción concreta (ej. "echar
                            // las zapatillas a la mochila"). Wrap multilinea
                            // si la nota es larga — el card crece.
                            if let note = primaryReminderNote {
                                Text(note)
                                    .font(density.metaFont)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.leading, 2)
                            }
                        }
                    }

                    // Contador live solo si: evento EN CURSO o empieza en
                    // < 60 min. Más allá de eso, el tick por segundo es
                    // ruido visual sin valor.
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        if let label = inlineCountdownLabel(now: context.date) {
                            Text(label)
                                .font(density.metaFont)
                                .foregroundStyle(event.isNow
                                    ? Theme.Colors.success
                                    : Theme.Colors.focusAccent)
                                .monospacedDigit()
                                .contentTransition(.numericText(countsDown: true))
                        }
                    }
                }
                .padding(.vertical, density.verticalPadding)
                .padding(.leading, Theme.Spacing.md)
                .padding(.trailing, Theme.Spacing.md)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                // En modo spacious (1-2 eventos), un gradient sutil del color
                // de la sección a surface para que la card tenga atmósfera
                // y se sienta hero. En balanced/compact, solo surface plano.
                Group {
                    if density == .spacious {
                        LinearGradient(
                            colors: [
                                event.section.color.opacity(0.10),
                                Theme.Colors.surface
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    } else {
                        Theme.Colors.surface
                    }
                }
            )
            // Recortamos TODO el HStack (banda + contenido + fondo) con el
            // mismo cornerRadius — así la banda lateral termina en curva
            // exactamente como la card, no recta.
            .clipShape(
                RoundedRectangle(cornerRadius: density == .spacious ? Theme.Radius.lg : Theme.Radius.md, style: .continuous)
            )
            .overlay(
                // Theme 2.0: cuando el evento está EN CURSO, el border se
                // intensifica al color de la sección (75% opacity, 2pt
                // lineWidth) — la card "respira" con el contexto activo.
                RoundedRectangle(cornerRadius: density == .spacious ? Theme.Radius.lg : Theme.Radius.md, style: .continuous)
                    .strokeBorder(
                        event.isNow
                            ? event.section.color.opacity(0.75)
                            : (density == .spacious
                                ? event.section.color.opacity(0.25)
                                : Theme.Colors.borderHairline),
                        lineWidth: event.isNow ? 2.0 : (density == .spacious ? 1.2 : Theme.Stroke.hairline)
                    )
            )
            // Theme 2.0: shadow contextual MÁS fuerte cuando EN CURSO.
            // 55% opacity + radius 22 — el evento activo "irradia" su color
            // de sección. Antes era 32%/14 — visible pero podía pasar
            // desapercibido sobre canvas frío.
            .shadow(
                color: event.isNow
                    ? event.section.color.opacity(0.55)
                    : Theme.Colors.cardShadow,
                radius: event.isNow ? 22 : 6,
                x: 0,
                y: event.isNow ? 8 : 3
            )
            .padding(.bottom, isLast ? 0 : Theme.Spacing.sm)
        }
        // Theme 2.0: eventos terminados se desvanecen al 55% de opacidad
        // y se contraen levemente — el usuario ve "lo que ya pasó" pero el
        // foco visual está en el presente y futuro.
        .opacity(eventHasPassed ? 0.55 : 1.0)
        .scaleEffect(y: eventHasPassed ? 0.96 : 1.0, anchor: .top)
        .animation(Theme.Motion.easeInOutStandard, value: eventHasPassed)
        // Coach mark del chip 🔔: la primera vez que el usuario ve un
        // evento con reminder offset, le explicamos qué significa el chip.
        // Solo dispara si este row tiene offset y el flag no se vio antes.
        .onAppear {
            if event.reminderOffsets?.isEmpty == false {
                coachMarks.presentIfNeeded(.reminderChip)
            }
        }
    }

    /// Genera la etiqueta de countdown SOLO para eventos relevantes:
    /// - EN CURSO (entre startTime y endTime): "Termina en MM min SS s".
    /// - PRÓXIMO IMINENTE (start futuro, < 60 min): "Empieza en MM min SS s".
    /// - Más lejano o pasado: devuelve nil → no se renderiza la línea.
    /// Esto evita que TODOS los eventos del día parpadeen cada segundo.
    private func inlineCountdownLabel(now: Date) -> String? {
        // En curso: contamos lo que falta hasta endTime (si hay).
        if !event.displayAsPointInTime,
           let end = event.endTime,
           event.startTime <= now && end >= now {
            let s = max(0, Int(end.timeIntervalSince(now)))
            if s == 0 { return "Termina ahora" }
            return "Termina en " + Self.formatMS(seconds: s)
        }
        // Próximo en menos de una hora: minutos + segundos.
        let diff = event.startTime.timeIntervalSince(now)
        if diff > 0 && diff <= 3600 {
            let s = Int(diff)
            if event.displayAsPointInTime {
                return "En " + Self.formatMS(seconds: s)
            }
            return "Empieza en " + Self.formatMS(seconds: s)
        }
        return nil
    }

    private static func formatMS(seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        var parts: [String] = []
        if h > 0 { parts.append("\(h) h") }
        if h > 0 || m > 0 { parts.append("\(m) min") }
        parts.append("\(s) s")
        return parts.joined(separator: " ")
    }
}

// MARK: - Task row compacto (sin subtareas inline)

private struct MiDiaTaskRow: View {
    let task: FocusTask
    let onToggle: () -> Void

    var body: some View {
        Button(action: {
            HapticManager.shared.tap()
            onToggle()
        }) {
            HStack(spacing: Theme.Spacing.md) {
                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(task.done ? Theme.Colors.success : Theme.Colors.textTertiary)

                Circle()
                    .fill(task.priority.color)
                    .frame(width: 6, height: 6)
                    .opacity(task.done ? 0.4 : 1)

                VStack(alignment: .leading, spacing: 1) {
                    Text(task.title)
                        .font(Theme.Typography.bodyEmphasized)
                        .foregroundStyle(task.done ? Theme.Colors.textTertiary : Theme.Colors.textPrimary)
                        .strikethrough(task.done, color: Theme.Colors.textTertiary)
                        .multilineTextAlignment(.leading)
                    if task.hasSubtasks {
                        Text("\(task.completedSubtaskCount)/\(task.subtasks.count) subtareas")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textTertiary)
                    }
                }

                Spacer()
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.sm + 2)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.Colors.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                            .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                    )
                    .focusCardShadow()
            )
        }
        .buttonStyle(.plain)
    }
}
