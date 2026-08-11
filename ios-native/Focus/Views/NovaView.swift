import Combine
import SwiftUI
import UIKit

/// Observador global del teclado iOS. Objeto (no view-modifier) a propósito:
/// los `onReceive` montados dentro de las páginas del pager horizontal de
/// MainTabView demostraron NO recibir las notificaciones de teclado en
/// iOS 26.4 (QA-closure 2026-06-10), mientras que el observer de
/// MainTabView (root) sí las recibe. Suscribirse en un ObservableObject
/// desacopla la recepción de la posición del view en la jerarquía.
///
/// `overlap` = puntos de teclado que invaden la pantalla por encima del
/// safe area inferior, calculado con `minY` del frame FINAL en coordenadas
/// de ventana (`keyboardWillChangeFrame` + `keyboardWillHide`). Robusto a
/// frames interinos del accessory bar (~55 pt) que rompían el cálculo
/// `height - safeArea` del workaround anterior.
@MainActor
final class KeyboardObserver: ObservableObject {
    @Published var overlap: CGFloat = 0
    /// Y global (coordenadas de ventana) del borde SUPERIOR del teclado,
    /// o `nil` si está oculto. Permite a las vistas calcular cuánto deben
    /// elevarse midiendo su propia posición — robusto frente a contenedores
    /// que redimensionan (el pager horizontal agranda la página con el
    /// content-inset del teclado, así que un offset fijo no sirve).
    @Published var keyboardTopY: CGFloat? = nil

    private var cancellables: Set<AnyCancellable> = []

    init() {
        // willShow Y willChangeFrame: el runtime del simulador iOS 26.4
        // postea willShow pero NO siempre willChangeFrame (verificado con
        // instrumentación — un sink solo-willChangeFrame jamás corrió
        // mientras el onReceive de willShow de MainTabView sí). En device
        // real ambas llegan; la matemática por minY es idempotente así
        // que recibir las dos no causa doble aplicación.
        for name in [UIResponder.keyboardWillShowNotification,
                     UIResponder.keyboardWillChangeFrameNotification] {
            NotificationCenter.default
                .publisher(for: name)
                .sink { [weak self] notification in
                    self?.update(from: notification)
                }
                .store(in: &cancellables)
        }
        NotificationCenter.default
            .publisher(for: UIResponder.keyboardWillHideNotification)
            .sink { [weak self] _ in
                self?.overlap = 0
                self?.keyboardTopY = nil
            }
            .store(in: &cancellables)
    }

    private func update(from notification: Notification) {
        guard let endFrame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .keyWindow
            ?? UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.windows.first }
                .first
        guard let window else { return }
        let frameInWindow = window.convert(endFrame, from: nil)
        let overlapPoints = max(0, window.bounds.maxY - frameInWindow.minY)
        overlap = max(0, overlapPoints - window.safeAreaInsets.bottom)
        keyboardTopY = overlapPoints > 0 ? frameInWindow.minY : nil
    }
}

/// Nova como tab principal. Tres segmentos internos:
/// - **Bandeja** (default): cards de decisiones de Nova con Aprobar/Posponer/Descartar.
/// - **Acciones**: 6 quick actions para arrancar conversaciones útiles (organizar
///   día, crear tarea, revisar pendientes, etc).
/// - **Chat**: conversación libre con Nova como segunda capa.
///
/// Por diseño, Nova NO es solo un chat: aterrizar en Bandeja deja al usuario
/// frente a decisiones concretas, no frente a un cursor parpadeando.
struct NovaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var toast: ToastManager
    @EnvironmentObject private var coachMarks: CoachMarksStore

    @State private var draft: String = ""
    // Texto retenido a la espera del consentimiento IA (5.1.2(i)) — solo se
    // envía al backend después de que el usuario acepte en la sheet.
    @State private var aiConsentPendingText: String? = nil
    @State private var showCreateTask: Bool = false
    @State private var showCreateEvent: Bool = false
    @State private var showImportCalendar: Bool = false
    @State private var showExportCalendar: Bool = false
    @State private var showNovaLive: Bool = false
    @State private var showVoiceDictation: Bool = false

    @StateObject private var dictationService = NovaLiveService()
    @State private var isDictating: Bool = false
    @State private var dictationDeniedMessage: String? = nil

    /// Teclado iOS — ver doc de `KeyboardObserver` arriba.
    @StateObject private var keyboard = KeyboardObserver()

    /// Y global del borde inferior del VStack raíz (medida por el anchor
    /// invisible del overlay). El pager horizontal AGRANDA la página con
    /// el content-inset del teclado, así que este borde puede quedar muy
    /// por debajo de la pantalla — por eso el lift se calcula contra la
    /// posición REAL medida y no con la altura del teclado a secas.
    @State private var containerBottomY: CGFloat = 0

    /// Alto REAL del composer, medido con GeometryReader. Antes el inset
    /// inferior del chat usaba un 88 fijo "≈ alto del inputBar" — con el
    /// TextField auto-expandido (2-6 líneas) o el visualizador de dictado
    /// abierto, el composer crecía y TAPABA los últimos mensajes; y cuando
    /// era más bajo, quedaba un hueco. Medir el alto real elimina ambos.
    @State private var inputBarHeight: CGFloat = 88

    /// Cuántos puntos hay que subir el composer para que su borde inferior
    /// quede exactamente en el borde superior del teclado.
    private var composerLift: CGFloat {
        guard let kbTop = keyboard.keyboardTopY else { return 0 }
        return max(0, containerBottomY - kbTop)
    }

    /// **Feature flag Nova Live**. La V1 actual (Speech framework + STT
    /// + envío a Nova) NO es la experiencia conversacional tipo
    /// ChatGPT/Gemini Live que querríamos para beta — es esencialmente
    /// dictado + procesamiento posterior. Para no enviar una experiencia
    /// de voz que se sienta a medias, ocultamos la entrada por chip en
    /// el empty state del chat. El código de `NovaLiveView` +
    /// `NovaLiveService` Live mode queda compilado pero inalcanzable
    /// desde la UI.
    ///
    /// Para reactivar cuando se implemente realtime real (OpenAI Realtime
    /// API o equivalente con backend seguro para mintear ephemeral
    /// tokens), flipear este flag a `true`. El roadmap está documentado
    /// en FOCUS_AUDIT_MASTER.md.
    private static let isNovaLiveEnabled = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                branding
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, Theme.Spacing.lg)

                segmentedControl
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, Theme.Spacing.lg)
                    .padding(.bottom, Theme.Spacing.md)

                Group {
                    switch nav.novaSegment {
                    case .bandeja:  bandejaContent
                    case .acciones: accionesContent
                    case .chat:     chatContent
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // El inset inferior del chat (composer + teclado) vive DENTRO
                // de `chatContent`, no acá: así la zona compensada queda
                // cubierta por el backdrop dark del chat. Antes el padding
                // iba en este Group (fuera del backdrop) y el hueco mostraba
                // el canvas CLARO de la app bajo el composer — los "agujeros
                // claros" reportados al abrir/cerrar teclado en iPhone.
            }
            // Anchor invisible: mide la Y global REAL del borde inferior
            // del VStack. Dentro del pager horizontal de MainTabView la
            // página se agranda con el content-inset del teclado (el borde
            // puede quedar cientos de puntos bajo la pantalla), así que
            // cualquier offset fijo basado en la altura del teclado falla.
            .overlay(alignment: .bottom) {
                Color.clear
                    .frame(height: 1)
                    .background(GeometryReader { proxy in
                        Color.clear
                            .onAppear { containerBottomY = proxy.frame(in: .global).maxY }
                            .onChange(of: proxy.frame(in: .global).maxY) { _, maxY in
                                containerBottomY = maxY
                            }
                    })
                    .allowsHitTesting(false)
            }
            // Composer flotante del chat, fuera del flow del VStack: un
            // overlay no participa del keyboard avoidance del sistema, y
            // el lift se auto-corrige midiendo anchor vs tope del teclado
            // (composerLift) — el borde inferior del composer queda
            // EXACTAMENTE en el borde superior del teclado (QA-closure
            // 2026-06-10, bug "composer atrapado detrás del teclado").
            .overlay(alignment: .bottom) {
                if nav.novaSegment == .chat {
                    inputBar
                        // Medir el alto REAL del composer (auto-expand del
                        // TextField, visualizador de dictado, etc.) ANTES
                        // del offset — el inset del chat usa este valor en
                        // vez del 88 fijo que tapaba mensajes al crecer.
                        .background(
                            GeometryReader { proxy in
                                Color.clear
                                    .onAppear { inputBarHeight = proxy.size.height }
                                    .onChange(of: proxy.size.height) { _, h in
                                        inputBarHeight = h
                                    }
                            }
                        )
                        .offset(y: -composerLift)
                }
            }
            .animation(.easeOut(duration: 0.25), value: composerLift)
            .animation(.easeOut(duration: 0.20), value: inputBarHeight)
            .background(
                FocusAmbientCanvas(state: store.isNovaTyping ? .thinking : .idle)
            )
            .navigationBarHidden(true)
        }
        // Coach mark de Nova la primera vez que el usuario llega a esta
        // tab. Mismo patrón que Mi Día y Calendario.
        .task(id: nav.selectedTab) {
            if nav.selectedTab == .nova {
                try? await Task.sleep(nanoseconds: 500_000_000)
                coachMarks.presentIfNeeded(.nova)
            }
        }
        .sheet(isPresented: $showCreateTask) {
            NuevaTareaSheet { task in
                store.addTask(task)
                toast.success("Tarea creada")
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.Colors.background)
        }
        .sheet(isPresented: $showCreateEvent) {
            NuevoEventoSheet(initialDate: Date()) { event in
                store.addEvent(event)
                toast.success("Evento creado")
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.Colors.background)
        }
        .sheet(isPresented: $showImportCalendar) {
            ComingSoonSheet(
                title: "Importar calendario",
                message: "Próximamente podrás traer eventos desde Google Calendar, Apple Calendar o un archivo .ics. Nova te ayudará a ordenarlos, detectar conflictos y dejar bloques de foco entre medio.",
                icon: "square.and.arrow.down",
                iconTint: Theme.Colors.novaAccent,
                secondaryAction: (label: "Crear evento manual", action: {
                    showCreateEvent = true
                })
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showExportCalendar) {
            ComingSoonSheet(
                title: "Exportar calendario",
                message: "Próximamente podrás sacar tu agenda como archivo .ics o sincronizar de vuelta a Google/Apple Calendar. Por ahora todo se guarda local en tu iPhone.",
                icon: "square.and.arrow.up",
                iconTint: Theme.Colors.novaAccent
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showNovaLive) {
            NovaLiveView { transcript in
                // Misma puerta de entrada que el input escrito del chat.
                // Backend o fallback local + acciones reales + sync.
                submitToNova(transcript)
            }
        }
        .sheet(
            isPresented: Binding(
                get: { aiConsentPendingText != nil },
                set: { presented in
                    // Swipe-down = "Ahora no": devolver el texto al input
                    // para que no se pierda lo escrito/dictado.
                    if !presented, let pending = aiConsentPendingText {
                        draft = pending
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
                        store.sendNovaMessage(pending)
                    }
                },
                onDecline: {
                    if let pending = aiConsentPendingText {
                        draft = pending
                        aiConsentPendingText = nil
                    }
                }
            )
            .presentationBackground(Theme.Colors.background)
        }
        .onChange(of: dictationService.state) { _, newState in
            switch newState {
            case .listening:
                isDictating = true
                dictationDeniedMessage = nil
            case .processing:
                isDictating = true
            case .idle:
                isDictating = false
                let finalTranscript = dictationService.transcript
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !finalTranscript.isEmpty {
                    draft = finalTranscript
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
        .onChange(of: nav.selectedTab) { _, newTab in
            if isDictating && newTab != .nova {
                dictationService.cancel()
            }
        }
        // Binding derivado REAL (no `.constant`): con `.constant` SwiftUI
        // no puede escribir el cierre y el alert queda INMORTAL — el botón
        // Cerrar no hace nada y la app queda bloqueada (bug QA-closure
        // 2026-06-10, reproducido en simulador).
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
        .onChange(of: nav.pendingNovaPrompt) { _, newPrompt in
            // Si Mi Día (u otra pantalla) llega con un texto pendiente, lo
            // disparamos al chat y limpiamos.
            guard let prompt = newPrompt,
                  !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return }
            submitToNova(prompt)
            nav.pendingNovaPrompt = nil
        }
        .onAppear {
            // Drenar prompt pendiente en el primer appear también (no siempre se
            // dispara onChange si el valor ya estaba seteado).
            if let prompt = nav.pendingNovaPrompt,
               !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                submitToNova(prompt)
                nav.pendingNovaPrompt = nil
            }
        }
    }

    // MARK: - Quick action dispatch

    /// Acciones visibles en el grid: fuera importar/exportar mientras sean
    /// "Próximamente" (Guideline 2.1) y fuera "Crear tarea" en modo
    /// SOLO-EVENTOS (`addTask` es no-op — sería un flujo que no guarda nada).
    private var visibleQuickActions: [NovaQuickAction] {
        NovaQuickAction.allCases.filter { action in
            switch action {
            case .importarCalendario, .exportarCalendario:
                return FocusConfig.showComingSoonSurfaces
            case .crearTarea:
                return FocusConfig.tasksEnabled
            default:
                return true
            }
        }
    }

    /// Routea cada quick action a su efecto real: sheets, segmentos, mensajes
    /// + sugerencias en bandeja. Nada decorativo.
    private func handleQuickAction(_ action: NovaQuickAction) {
        HapticManager.shared.tap()
        switch action {
        case .crearTarea:
            showCreateTask = true

        case .crearEvento:
            showCreateEvent = true

        case .importarCalendario:
            showImportCalendar = true

        case .exportarCalendario:
            showExportCalendar = true

        case .revisarPendientes:
            withAnimation(.easeInOut(duration: 0.20)) {
                nav.novaSegment = .bandeja
            }

        case .organizar:
            // Disparamos al chat con "organiza mi día" — el parser local
            // hace el análisis REAL (eventos hoy, tareas, huecos, back-to-
            // back) y solo crea sugerencia si hay algo accionable. NO
            // metemos suggestion hardcoded — esta función ya no inventa
            // un "Plan del día actualizado" cuando no hay nada que
            // organizar.
            store.runQuickAction(.organizar)
            toast.show(.info("Analizando tu día", symbol: "sparkles"))
            withAnimation(.easeInOut(duration: 0.20)) {
                nav.novaSegment = .chat
            }

        case .prepararManana:
            store.runQuickAction(.prepararManana)
            let cal = Calendar.current
            let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            let tomorrowStart = cal.date(bySettingHour: 10, minute: 0, second: 0, of: tomorrow)
                ?? tomorrow
            let tomorrowEnd = cal.date(byAdding: .hour, value: 2, to: tomorrowStart) ?? tomorrowStart
            store.addSuggestion(NovaSuggestion(
                title: "Bloque para mañana",
                detail: "Te dejo 2 horas de foco antes de tu próxima reunión. Aprueba para agendarlo.",
                kind: .schedule,
                priority: .normal,
                suggestedAction: "Foco \(DateFormatters.hourMinute.string(from: tomorrowStart))–\(DateFormatters.hourMinute.string(from: tomorrowEnd))"
            ))
            toast.show(.info("Sugerencia para mañana", symbol: "moon.stars"))
            withAnimation(.easeInOut(duration: 0.20)) {
                nav.novaSegment = .bandeja
            }

        case .cerrarDia:
            store.runQuickAction(.cerrarDia)
            // Saltar al chat — el resumen es conversacional, no una decisión
            // que vaya a la bandeja.
            withAnimation(.easeInOut(duration: 0.20)) {
                nav.novaSegment = .chat
            }
        }
    }

    // MARK: - Branding header (consistente con Mi Día)

    private var branding: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                FocusBrandRow()
                Spacer()
                // Sparkle decorativo a la derecha — la primera señal de
                // que Nova es una capa especial, no otra sección más.
                ZStack {
                    Circle()
                        .fill(Theme.Colors.novaGradient)
                        .frame(width: 28, height: 28)
                        .shadow(color: Theme.Colors.novaAccent.opacity(0.50), radius: 12, y: 4)
                    NovaSparkMark(size: 12)
                }
            }
            // Theme 2.0: "Nova" en displayHero 34pt SemiBold + tracking
            // displayHero (-1.36) — coherente con "Mi Día" del bloque D.
            // El gradient horizontal cobalto→violet permanece como
            // diferenciador visual de Nova respecto al resto de pantallas
            // (que tienen títulos negros planos).
            Text("Nova")
                .font(Theme.Typography.displayHero)
                .tracking(Theme.Tracking.displayHero)
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Theme.Colors.focusAccent,
                            Theme.Colors.novaAccent
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        }
    }

    // MARK: - Segmented control

    private var segmentedControl: some View {
        let isChat = nav.novaSegment == .chat
        return HStack(spacing: 0) {
            segmentButton(.bandeja, label: "Bandeja", badge: store.pendingDisplaySuggestions.count)
            segmentButton(.acciones, label: "Acciones")
            segmentButton(.chat, label: "Chat")
        }
        .padding(3)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(isChat ? AnyShapeStyle(Theme.Colors.novaGlassFill) : AnyShapeStyle(Theme.Colors.surfaceHigh))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .strokeBorder(isChat ? Theme.Colors.novaGlassStroke : Color.clear, lineWidth: 0.8)
        )
        .animation(.easeInOut(duration: 0.22), value: nav.novaSegment)
    }

    private func segmentButton(_ seg: NovaSegment, label: String, badge: Int = 0) -> some View {
        let isSelected = nav.novaSegment == seg
        let isChat = nav.novaSegment == .chat
        return Button {
            HapticManager.shared.tick()
            withAnimation(.easeInOut(duration: 0.20)) {
                nav.novaSegment = seg
            }
        } label: {
            HStack(spacing: 6) {
                Text(label)
                    .font(Theme.Typography.subheadEmphasized)
                if badge > 0 {
                    Text("\(badge)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Theme.Colors.novaAccent))
                }
            }
            .foregroundStyle(
                isSelected 
                    ? (isChat ? Theme.Colors.novaTextOnDark : Theme.Colors.textPrimary) 
                    : (isChat ? Theme.Colors.novaTextOnDarkSecondary.opacity(0.65) : Theme.Colors.textTertiary)
            )
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .fill(
                        isSelected 
                            ? (isChat ? AnyShapeStyle(Theme.Colors.novaGlassUserFill) : AnyShapeStyle(Theme.Colors.surface))
                            : AnyShapeStyle(Color.clear)
                    )
                    .focusCardShadow(strong: isChat)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bandeja

    private var bandejaContent: some View {
        // El contenido se conecta directo al store + toast; no necesita
        // closure de callback ni inyección manual.
        NovaInboxContent()
    }

    // MARK: - Acciones

    private var accionesContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                accionesHeader
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, Theme.Spacing.sm)

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: Theme.Spacing.md),
                        GridItem(.flexible(), spacing: Theme.Spacing.md)
                    ],
                    spacing: Theme.Spacing.md
                ) {
                    ForEach(visibleQuickActions) { action in
                        NovaActionCard(action: action) {
                            handleQuickAction(action)
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.xl)

                // SOLO-EVENTOS (temporal): ocultar el acceso a la lista de
                // tareas mientras las tareas estén deshabilitadas.
                if FocusConfig.tasksEnabled {
                    tasksLink
                        .padding(.horizontal, Theme.Spacing.xl)
                        .padding(.top, Theme.Spacing.sm)
                }

                Spacer(minLength: Theme.Spacing.bottomBarSafety)
            }
        }
    }

    private var accionesHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("¿Qué quieres hacer?")
                .font(Theme.Typography.title1)
                .tracking(Theme.Tracking.title1)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("Toca una acción y Nova arranca contigo. Las decisiones quedan en Bandeja.")
                .font(Theme.Typography.subhead)
                .tracking(Theme.Tracking.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    /// Link a "Todas las tareas" — la única forma de llegar a la vista completa
    /// ahora que Tareas no es tab principal.
    private var tasksLink: some View {
        NavigationLink {
            TareasView()
        } label: {
            HStack(spacing: Theme.Spacing.md) {
                IconBadge(symbol: "checklist", tint: Theme.Colors.focusAccent, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Todas las tareas")
                        .font(Theme.Typography.bodyBold)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text("Lista completa con filtros y subtareas.")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.Colors.textTertiary)
            }
            .padding(Theme.Spacing.md)
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

    // MARK: - Chat (glassmorphic dark — rediseño 2026-05)
    //
    // El segmento Chat entra en "modo IA premium": fondo violet-black
    // glassmorphic, burbujas glass para usuario y Nova, markdown render
    // con code blocks + copy, input flotante con auto-expand y glow,
    // typing indicator hiper-minimalista. Bandeja y Acciones siguen
    // light, igual que Mi Día/Calendario. La transición visual entre
    // los segmentos refuerza la diferencia: el chat es donde la IA
    // habla, los otros segmentos son workflow productivo.

    private var chatContent: some View {
        // El `inputBar` se monta como overlay bottom del NavigationStack
        // con lift manual (ver arriba, QA-closure 2026-06-10). Acá va el
        // contenido: backdrop dark + hero/scroll con el inset inferior
        // que compensa composer + teclado. El padding vive DENTRO de este
        // ZStack a propósito — el backdrop cubre también la zona compensada
        // y no se asoman "agujeros" del canvas claro durante las
        // animaciones del teclado.
        ZStack {
            NovaChatBackdrop()
                .onTapGesture {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }

            Group {
                if store.novaMessages.isEmpty && !store.isNovaTyping {
                    NovaEmptyChatHeroDark(
                        onChip: { action in
                            handleQuickAction(action)
                        },
                        showLiveChip: Self.isNovaLiveEnabled,
                        onLive: Self.isNovaLiveEnabled
                            ? {
                                HapticManager.shared.tap()
                                showNovaLive = true
                            }
                            : nil
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    chatScroll
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .padding(.bottom, inputBarHeight + composerLift)
        }
    }

    private var chatScroll: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: Theme.Spacing.lg) {
                    ForEach(store.novaMessages) { msg in
                        Group {
                            if msg.role == .user {
                                NovaGlassUserBubble(content: msg.content)
                            } else {
                                NovaGlassNovaBubble(content: msg.content)
                            }
                        }
                        .id(msg.id)
                        // Entrada suave: fade-in + slide-up + scale sutil
                        // (98% → 100%, anclado al lado de la burbuja) con el
                        // spring de entrada — la burbuja "aterriza" en vez de
                        // aparecer. La salida es solo opacity para que los
                        // message id changes no muevan la altura.
                        .transition(.asymmetric(
                            insertion: .opacity
                                .combined(with: .offset(y: 10))
                                .combined(with: .scale(
                                    scale: 0.98,
                                    anchor: msg.role == .user ? .bottomTrailing : .bottomLeading
                                )),
                            removal: .opacity
                        ))
                    }
                    if store.isNovaTyping {
                        NovaPulseTypingIndicator()
                            .id(Self.typingAnchor)
                            .transition(.opacity.combined(with: .offset(y: 8)))
                    }
                    // Anchor invisible al final — permite hacer scroll a
                    // "abajo de todo" sin depender del último id.
                    Color.clear
                        .frame(height: 1)
                        .id(Self.chatBottomAnchor)
                }
                .padding(.horizontal, Theme.Spacing.lg)
                .padding(.top, Theme.Spacing.lg)
                .padding(.bottom, Theme.Spacing.lg)
                .animation(Theme.Spring.entrance, value: store.novaMessages.count)
                .animation(Theme.Spring.entrance, value: store.isNovaTyping)
            }
            // FIX teclado pegado (QA-closure 2026-06-10): con mensajes en
            // el chat, este ScrollView cubre al NovaChatBackdrop y se traga
            // los taps — el tap-para-cerrar del backdrop solo funcionaba en
            // el estado vacío, y el toolbar "Listo" se quitó a propósito.
            // Sin esto NO existía gesto alguno para cerrar el teclado.
            //
            // `.interactively` (2026-08-11): arrastrar hacia abajo baja el
            // teclado siguiendo el dedo, como iMessage. El composer usa
            // lift manual (KeyboardObserver), así que durante el drag se
            // queda elevado hasta que iOS postea willHide al soltar — ese
            // desfase era la razón del `.immediately` anterior, pero ya no
            // muestra huecos claros: la franja que se revela bajo el
            // composer ahora es el backdrop DARK (el inset del chat vive
            // dentro del ZStack del backdrop) y el lift anima a 0 al
            // confirmarse el dismiss.
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.novaMessages.count) { _, _ in
                scrollToBottom(proxy: proxy, animated: true)
                // Háptico sutil cuando ATERRIZA una respuesta de Nova (el
                // envío ya vibra en el botón). Solo el último mensaje —
                // los redraws del ForEach no pasan por acá.
                if store.novaMessages.last?.role == .nova {
                    HapticManager.shared.tick()
                }
            }
            .onChange(of: store.isNovaTyping) { _, typing in
                if typing { scrollToBottom(proxy: proxy, animated: true) }
            }
            // Al abrir el teclado, el viewport se encoge (sube el inset) y
            // el final de la conversación quedaba tapado hasta el próximo
            // mensaje. Re-anclamos al fondo apenas iOS anuncia el teclado.
            .onReceive(NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillShowNotification
            )) { _ in
                scrollToBottom(proxy: proxy, animated: true)
            }
            .onAppear {
                scrollToBottom(proxy: proxy, animated: false)
            }
        }
    }

    private static let chatBottomAnchor = "nova-chat-bottom"
    private static let typingAnchor = "nova-typing"

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(.easeOut(duration: 0.28)) {
                proxy.scrollTo(Self.chatBottomAnchor, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(Self.chatBottomAnchor, anchor: .bottom)
        }
    }

    /// Input bar glass del chat. Reemplaza el FocusBarInput compartido —
    /// el chat es la única superficie dark de la app, así que tiene su
    /// propio input bar (NovaGlassInputBar) sin afectar Mi Día/Calendario
    /// que siguen usando FocusBarInput sobre fondo light.
    ///
    /// El gradient encima del input crea un fade del scroll content hacia
    /// la barra, evitando que un mensaje largo "termine cortado" pegado
    /// al borde superior del input.
    private var inputBar: some View {
        VStack(spacing: 0) {
            // Fade superior — gradient vertical transparent → fondo dark
            // para suavizar el corte entre scroll content y la barra.
            LinearGradient(
                colors: [
                    Color.clear,
                    Color(red: 0.04, green: 0.02, blue: 0.10).opacity(0.65)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 14)
            .allowsHitTesting(false)

            NovaGlassInputBar(
                text: $draft,
                placeholder: isDictating ? "Habla ahora…" : "Escríbele a Nova…",
                onSubmit: submitDraft,
                onMic: {
                    HapticManager.shared.tap()
                    Task { await toggleInlineDictation() }
                },
                isDictating: isDictating,
                audioLevel: CGFloat(dictationService.audioLevel)
            )
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.top, 2)
            .padding(.bottom, Theme.Spacing.sm)
            .background(
                // Detrás del input: gradient + blur sutil para que el
                // backdrop dark se difumine bajo el bar sin verse plano.
                // `.container` (no default `.all`) — extiende el fondo bajo
                // el home indicator pero **respeta el keyboard safe area**.
                // Con `.all` (el default cuando se omite el primer arg),
                // el background se extendería detrás del teclado y empujaba
                // visualmente al composer fuera de vista. Mismo patrón que
                // `NovaChatBackdrop` para que el inputBar quede pegado al
                // borde superior del teclado sin overlaps.
                Color(red: 0.04, green: 0.02, blue: 0.10).opacity(0.70)
                    .background(.ultraThinMaterial.opacity(0.40))
                    .environment(\.colorScheme, .dark)
                    .ignoresSafeArea(.container, edges: .bottom)
            )
        }
    }

    private func submitDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        submitToNova(text)
    }

    /// Puerta única de entrada al chat (teclado y voz). Gatea el
    /// consentimiento IA (5.1.2(i)) solo cuando el mensaje va a salir al
    /// backend — en modo demo el parser local no manda nada fuera del
    /// dispositivo, así que no hay nada que consentir.
    private func submitToNova(_ text: String) {
        if store.syncCredentials != nil && !NovaAIConsent.granted {
            aiConsentPendingText = text
            return
        }
        store.sendNovaMessage(text)
    }

    private func toggleInlineDictation() async {
        if isDictating {
            dictationService.stop()
            return
        }
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
}

// MARK: - Action card (Acciones segment)

private struct NovaActionCard: View {
    let action: NovaQuickAction
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                IconBadge(symbol: action.symbol, tint: Theme.Colors.novaAccent, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(action.label)
                        .font(Theme.Typography.bodyBold)
                        .foregroundStyle(Theme.Colors.textPrimary)
                        .multilineTextAlignment(.leading)
                    Text(action.subtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
            }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
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

// Las bubbles del chat y el typing indicator viven ahora en
// `Shared/NovaChatComponents.swift` (NovaGlassUserBubble, NovaGlassNovaBubble,
// NovaPulseTypingIndicator). Aquí solo queda el shell del NovaView con
// branding + segment control + dispatch de quick actions.
