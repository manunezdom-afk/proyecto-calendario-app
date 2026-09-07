import Foundation

/// Validador post-IA: corre sobre las `BackendAction` que devuelve Haiku/
/// Sonnet ANTES de aplicarlas al store. Captura los patrones de "ruido"
/// más comunes que rompían el flujo del usuario en beta:
///
/// 1. **Títulos concatenados** — "Salir a jugar fútbol que llevar la
///    pelota" (verbos de cláusulas distintas pegados).
/// 2. **Títulos con hora pegada** — "Comer a las 4" (la hora ya va en
///    `time`, no debe aparecer en `title`).
/// 3. **Categoría reunión sin trigger** — el modelo a veces emite
///    icon="groups" para cualquier evento social. Reunión solo si el
///    usuario dijo literalmente reunión / junta / meet / call / 1:1 /
///    standup / demo.
/// 4. **Títulos vacíos o demasiado largos** — síntoma de prompt failure.
///
/// Política:
/// - Si el validador rechaza **alguna** acción → NO aplica ninguna y
///   pide al usuario revisar. Aplicar a medias es peor que pedir
///   confirmación: el usuario puede creer que ejecutó todo cuando
///   en realidad faltan piezas.
/// - Si todas las acciones pasan pero hay un *sanitize* leve (downgrade
///   de icon "groups" a "event" sin trigger de reunión), las acciones
///   se aplican con la corrección.
///
/// El validador NO intenta corregir títulos sucios — esos casos viene
/// de mala estructuración del modelo y es más seguro preguntar que
/// adivinar.
enum NovaActionValidator {
    /// Resultado de validar una tanda de acciones del backend.
    struct Result {
        /// Acciones consideradas seguras para aplicar al store. Vacío si
        /// alguna acción fue rechazada — en ese caso, el caller debe
        /// mostrar `suggestedQuestion` y NO aplicar nada.
        let safeActions: [BackendAction]
        /// Acciones que se descartaron por riesgo, con la razón legible.
        let rejected: [(action: BackendAction, reason: String)]
        /// True si el caller debe tratar la respuesta como pregunta (no
        /// ejecutar) en vez de éxito.
        let shouldAsk: Bool
        /// Mensaje humano sugerido para la pregunta. nil si no se necesita.
        let suggestedQuestion: String?
    }

    /// Punto de entrada. Decide qué acciones son seguras para aplicar.
    /// `userText` es el texto original del usuario (lo usamos para
    /// validar la presencia de triggers como "reunión").
    static func validate(
        actions: [BackendAction],
        userText: String
    ) -> Result {
        let lower = userText.lowercased()
        var safe: [BackendAction] = []
        var rejected: [(BackendAction, String)] = []

        for action in actions {
            switch action {
            case .addEvent(let evt):
                if let reason = risky(event: evt, userTextLower: lower) {
                    rejected.append((action, reason))
                } else {
                    safe.append(.addEvent(sanitized(evt, userTextLower: lower)))
                }

            case .addRecurringEvent(let evt, let recurrence):
                if let reason = risky(event: evt, userTextLower: lower) {
                    rejected.append((action, reason))
                } else {
                    safe.append(.addRecurringEvent(
                        sanitized(evt, userTextLower: lower),
                        recurrence
                    ))
                }

            case .addTask(let task):
                if let reason = riskyTaskTitle(task.label) {
                    rejected.append((action, reason))
                } else {
                    safe.append(action)
                }

            case .unsupported:
                rejected.append((action, "Acción no disponible"))

            case .editEvent, .deleteEvent, .toggleTask, .deleteTask,
                 .remember, .saveMemory, .forgetMemory:
                // Acciones de mantenimiento/edición + memoria — el riesgo es
                // bajo, pasan tal cual. saveMemory/forgetMemory (V2 2026-05-27)
                // van directo al NovaMemoryStore sin tocar calendario, así que
                // anti-basura no aplica.
                safe.append(action)
            }
        }

        let hasRejections = !rejected.isEmpty
        return Result(
            // Política conservadora: si hay rechazo, NO aplicar nada.
            // Aplicar solo las "buenas" puede dejar al usuario con un
            // estado parcial confuso ("agendaste 2 de 3").
            safeActions: hasRejections ? [] : safe,
            rejected: rejected,
            shouldAsk: hasRejections,
            suggestedQuestion: hasRejections
                ? "Te entendí varias cosas, pero algo no me cuadró del todo. ¿Las revisamos juntos antes de guardar?"
                : nil
        )
    }

    static func isDestructive(_ action: BackendAction) -> Bool {
        switch action {
        case .deleteEvent, .deleteTask, .forgetMemory: return true
        default: return false
        }
    }

    static func requiresLocationTrigger(_ text: String) -> Bool {
        text.range(of: #"(?i)(cuando|al)\s+(lleg(?:ue|ues|ar)|sal(?:ga|gas|ir))\b|al volver a casa"#,
                   options: .regularExpression) != nil
    }

    // MARK: - Validaciones de eventos

    /// Devuelve la razón (legible) si el evento es "sospechoso" y debería
    /// pedir confirmación. nil si es seguro.
    ///
    /// Nota: la categoría "groups" sin trigger NO se rechaza acá — se
    /// arregla silenciosamente en `sanitized()` (downgrade a "event").
    /// Rechazar bloquearía toda la tanda por un detalle de clasificación
    /// que el cliente puede corregir sin involucrar al usuario.
    private static func risky(event: BackendEventCreate, userTextLower lower: String) -> String? {
        if let r = riskyEventTitle(event.title) { return r }
        if let date = event.dateString, NovaTimeFormatter.parseISODate(date) == nil {
            return "Fecha inválida"
        }
        if let time = event.timeString, !time.isEmpty, NovaTimeFormatter.parseHourMinute(time) == nil {
            return "Hora inválida"
        }
        return nil
    }

    /// Reglas duras para títulos de evento.
    private static func riskyEventTitle(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "título vacío" }
        let lower = trimmed.lowercased()

        // Patrón 0 — TÍTULO BASURA (lista negra). Cuando `cleanTitle`
        // strippea agresivamente o el modelo emite un placeholder, el
        // título termina siendo un genérico que no aporta significado.
        // Caso real reportado (beta-12, papá del usuario): bloque con
        // título "Horas" — residuo de strippear "a las 5" sin consumir
        // "horas". Rechazamos para que el flujo pida aclaración en vez de
        // crear ruido en el calendario.
        //
        // La lista es CONSERVADORA: solo strings que NUNCA serían un
        // título legítimo POR SÍ SOLOS (sin más palabras). Si el título
        // es "Reunión de equipo" no matchea — el strip preservó contenido.
        // Si es "Reunión", tampoco — el user pudo decir "reunión" suelto
        // como tema.
        let bareGarbageTitles: Set<String> = [
            "hora", "horas",
            "hoy", "mañana", "manana",
            "evento", "recordatorio",
            "a las", "a las 5",
            "ev", "rec", "tarea sin título",
            "..."
        ]
        // Normalizamos: lower + sin puntuación final (.,!?:;) — "Horas." y
        // "horas" se tratan igual. Conservamos espacios internos para que
        // "a las 5" siga matcheando.
        var normalized = lower
        while let last = normalized.last,
              ".,!?:;".contains(last) {
            normalized.removeLast()
        }
        normalized = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
        if bareGarbageTitles.contains(normalized) {
            return "título genérico/placeholder ('\(trimmed)')"
        }
        // Patrón 0b — TÍTULO solo dígitos / solo hora ("5", "5:00", "17:00",
        // "5 horas"). Strip de fecha/hora demasiado agresivo. La hora va en
        // `time`, el título no puede SER la hora.
        if normalized.range(of: #"^\d{1,2}(:\d{2})?$"#, options: .regularExpression) != nil {
            return "título es solo una hora ('\(trimmed)')"
        }
        if normalized.range(of: #"^\d{1,2}\s*(horas?|min|minutos?|h|hs)$"#, options: .regularExpression) != nil {
            return "título es una duración suelta ('\(trimmed)')"
        }

        // Patrón A — verbos encadenados con palabra-puente explícita:
        // "X que (verb)" / "X luego (de) (verb)" / "X después (de) (verb)".
        let chainVerbs = "(llevar|volver|comer|cenar|almorzar|salir|ir|hacer|tomar|traer|estudiar|trabajar|jugar|leer)"
        let concatPatterns = [
            "\\bque \(chainVerbs)\\b",
            "\\bluego (?:de )?\(chainVerbs)\\b",
            "\\bdespu(?:é|e)s (?:de )?\(chainVerbs)\\b",
        ]
        for pattern in concatPatterns {
            if lower.range(of: pattern, options: .regularExpression) != nil {
                return "título con verbo encadenado de otra acción"
            }
        }

        // Patrón A2 — VERBO DE ACCIÓN HUÉRFANO. Detecta el caso del bug
        // 2026-05-13: "Ir a buscar a mi hermano   jugar counter" — dos
        // acciones se fusionaron en un solo título sin conector. La señal
        // es un verbo de acción común (jugar/comer/dormir/etc.) en MEDIO
        // del título sin ir precedido de una preposición ligadora
        // ("a"/"para"/"de"). En títulos sanos, esos verbos solo aparecen
        // al inicio o como complemento ("ir A buscar", "salir A comer").
        if let reason = orphanActionVerbReason(in: lower) { return reason }

        // Patrón A3 — ESPACIOS MÚLTIPLES. Dos o más espacios consecutivos
        // dentro del título son una señal fuerte de mala concatenación
        // de cláusulas (el modelo pegó dos strings con un buffer extra).
        if trimmed.range(of: #"\s{2,}"#, options: .regularExpression) != nil {
            return "título tiene espacios múltiples — concatenación"
        }

        // Patrón B — hora pegada en el título. La hora va en `time`,
        // nunca en `title`.
        if lower.range(of: #"\b\d{1,2}:\d{2}\b"#, options: .regularExpression) != nil {
            return "título tiene una hora pegada (la hora va en time, no en title)"
        }
        if lower.range(of: #"\ba la(?:s)? \d{1,2}\b"#, options: .regularExpression) != nil {
            return "título contiene 'a las N'"
        }
        if lower.range(of: #"\ben \d{1,3}\s*(min|hora)"#, options: .regularExpression) != nil {
            return "título contiene 'en N min/hora'"
        }

        // Patrón C — título demasiado largo. Casi siempre signo de
        // concatenación de varias cláusulas en un solo string.
        if trimmed.count > 60 {
            return "título demasiado largo (\(trimmed.count) chars)"
        }

        return nil
    }

    /// Tokeniza el título y busca verbos de acción "huérfanos" — verbos
    /// que en español típicamente SON la acción principal (no
    /// complemento de otra). Si aparecen en medio del título sin estar
    /// precedidos por una preposición que los introduce como complemento
    /// ("a", "para", "de", "con", "sin", "y", "o"), es señal de
    /// concatenación.
    ///
    /// Ejemplos:
    /// - "Ir a buscar a mi hermano" → "buscar" precedido de "a" ✓ OK.
    /// - "Salir a comer" → "comer" precedido de "a" ✓ OK.
    /// - "Comprar pan y leche" → no contiene verbos huérfanos ✓ OK.
    /// - "Ir a buscar a mi hermano jugar counter" → "jugar" precedido
    ///   de "hermano" (sustantivo) ✗ RECHAZAR.
    /// - "Dormir Volver a casa" → "Volver" precedido de "Dormir"
    ///   (otro verbo huérfano) ✗ RECHAZAR.
    private static func orphanActionVerbReason(in lower: String) -> String? {
        // Verbos cuya aparición en medio del título suele indicar OTRA
        // acción independiente. Excluimos verbos auxiliares/ligeros como
        // "ir", "hacer", "tomar" que suelen ser complemento ("ir a Y",
        // "hacer la X", "tomar café").
        let orphanVerbs: Set<String> = [
            "jugar", "comer", "cenar", "almorzar", "dormir", "salir",
            "volver", "estudiar", "trabajar", "leer", "escribir",
            "llamar", "comprar", "pagar", "responder", "preparar",
            "revisar", "limpiar",
        ]
        // Conectores que VÁLIDAMENTE introducen un verbo como complemento.
        let validConnectors: Set<String> = [
            "a", "para", "de", "del", "con", "sin", "y", "o", "u",
            "que", "luego", "después", "despues",  // ya cubiertos por concatPatterns, doble red
        ]

        // Tokeniza por espacios. Conservamos solo tokens "palabra".
        let tokens = lower
            .components(separatedBy: .whitespacesAndNewlines)
            .map { $0.trimmingCharacters(in: CharacterSet.punctuationCharacters) }
            .filter { !$0.isEmpty }

        for i in 1..<tokens.count where orphanVerbs.contains(tokens[i]) {
            let prev = tokens[i - 1]
            if !validConnectors.contains(prev) {
                return "título tiene verbo huérfano '\(tokens[i])' sin conector — concatenación"
            }
        }
        return nil
    }

    /// Tareas (sin hora) son más permisivas — la "y" entre objetos es
    /// común ("comprar pan y leche"). Solo validamos vacío y longitud.
    private static func riskyTaskTitle(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "tarea vacía" }
        if trimmed.count > 80 {
            return "tarea demasiado larga"
        }
        return nil
    }

    // MARK: - Sanitization (corrección leve, no bloqueante)

    /// Si el evento es seguro pero algún detalle es sospechoso, devolvemos
    /// una copia con el detalle corregido. Por ahora solo: icon "groups"
    /// sin trigger → cambia a "event" (genérico). El título se respeta.
    private static func sanitized(_ evt: BackendEventCreate, userTextLower lower: String) -> BackendEventCreate {
        var iconOut = evt.icon
        if let icon = evt.icon, icon.lowercased() == "groups",
           !mentionsReunionTrigger(lower) {
            iconOut = "event"
        }
        return BackendEventCreate(
            title: evt.title,
            timeString: evt.timeString,
            endTimeString: evt.endTimeString,
            dateString: evt.dateString,
            section: evt.section,
            icon: iconOut,
            reminderOffsets: evt.reminderOffsets,
            reminderNotes: evt.reminderNotes,
            location: evt.location,
            notes: evt.notes,
            subtitle: evt.subtitle
        )
    }

    // MARK: - Helpers

    /// True si el texto del usuario contiene alguna palabra que justifica
    /// categorizar como "reunión".
    static func mentionsReunionTrigger(_ lower: String) -> Bool {
        let triggers = [
            "reunión", "reunion", "junta", "juntada",
            "meet ", "meeting", "call ", " call",
            "llamada", "videollamada",
            "1:1", "1on1", "uno a uno",
            "stand up", "standup", "stand-up", "daily",
            "demo", "review", "retro",
        ]
        for t in triggers where lower.contains(t) { return true }
        return false
    }

    // MARK: - Anti-basura client-side (input emocional / contextual)

    /// True cuando el mensaje del user es claramente CONVERSACIONAL,
    /// EMOCIONAL o CONTEXTUAL — no un comando de acción. Si el backend
    /// (a pesar del system prompt) emite actions para este tipo de input,
    /// el cliente las degrada a proposed_actions o las bloquea.
    ///
    /// Esta es la última red contra el patrón antiguo de Nova ("convierte
    /// TODO en evento"). Sin esta capa, "estoy colapsado" podría generar
    /// un evento "Saturación" si el modelo cae a Haiku y no respeta mode.
    ///
    /// Patrones detectados:
    /// - Estados emocionales: "estoy cansado/colapsado/saturado/agotado".
    /// - Preguntas reflexivas: "qué debería", "no sé si", "cómo me organizo".
    /// - Pensamiento en voz alta: "creo que", "tal vez", "quizás".
    /// - Pedidos genéricos de ayuda: "ayúdame a ordenar", "organizame el día".
    static func isEmotionalOrContextual(_ userText: String) -> Bool {
        let lower = userText.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
        let cues: [String] = [
            "estoy colapsado", "estoy saturado", "estoy cansado",
            "estoy agotado", "estoy estresado", "estoy abrumado",
            "no se por donde", "no doy mas", "no llego",
            "no voy a alcanzar", "no se si voy",
            "me siento ", "que deberia", "que hago",
            "como me organizo", "como lo hago", "como hago",
            "ayudame a ordenar", "ayudame a organizar",
            "organizame el dia", "ordename el dia",
            "que priorizo", "mil cosas", "tengo mucho",
            "no se si", "creo que", "tal vez", "quizas",
            "podria", "pienso que", "siento que",
        ]
        for c in cues where lower.contains(c) { return true }
        return false
    }

    /// Resultado de aplicar anti-basura a una respuesta del backend.
    struct AntiBasuraDecision {
        /// Acciones que pasan al store (vacío si todo fue bloqueado).
        let safeActions: [BackendAction]
        /// Acciones que se degradaron a "propuesta" — el cliente debe
        /// mostrarlas como proposal (UI con Apply/Dismiss).
        let demotedToProposal: [BackendAction]
        /// True si hicimos alguna degradación (el caller logguea).
        let didDemote: Bool
        /// Razón legible para logs.
        let reason: String?
    }

    /// Aplica anti-basura a un par (mode, actions) cuando el user input
    /// es claramente emocional/contextual. Reglas:
    ///
    /// 1. Si el user dijo algo emocional Y el backend devolvió
    ///    `chat_with_action` con add_event/add_task → degradamos a
    ///    proposal (cliente muestra "Aplicar / No por ahora", no ejecuta).
    /// 2. Si el user dijo algo emocional Y el backend devolvió mode
    ///    apropiado (`chat_only` o `proposal`) → no tocamos nada.
    /// 3. edit/delete actions sobre eventos existentes NUNCA se degradan
    ///    — esos son correcciones legítimas aunque el wording sea suave
    ///    ("creo que muevo lo de fútbol a las 5" puede tener "creo que"
    ///    al inicio pero la acción es clara). Solo degradamos CREATEs.
    static func applyAntiBasura(
        userText: String,
        mode: String?,
        actions: [BackendAction]
    ) -> AntiBasuraDecision {
        let isEmotional = isEmotionalOrContextual(userText)
        let isExecutableMode = (mode == "chat_with_action") || (mode == nil)
        guard isEmotional && isExecutableMode && !actions.isEmpty else {
            return AntiBasuraDecision(
                safeActions: actions,
                demotedToProposal: [],
                didDemote: false,
                reason: nil
            )
        }
        // Separar creates (degradan a proposal) vs edits/deletes (pasan).
        var safe: [BackendAction] = []
        var demoted: [BackendAction] = []
        for action in actions {
            switch action {
            case .addEvent, .addTask, .addRecurringEvent:
                demoted.append(action)
            case .unsupported:
                demoted.append(action)

            case .editEvent, .deleteEvent, .toggleTask, .deleteTask,
                 .remember, .saveMemory, .forgetMemory:
                safe.append(action)
            }
        }
        let didDemote = !demoted.isEmpty
        return AntiBasuraDecision(
            safeActions: safe,
            demotedToProposal: demoted,
            didDemote: didDemote,
            reason: didDemote
                ? "input emocional/contextual + add_event/add_task → demote a propuesta"
                : nil
        )
    }
}

#if DEBUG
/// Tests del validador. Se invocan desde `NovaActionNormalizerTests.runAll`.
enum NovaActionValidatorTests {
    @discardableResult
    static func runAll(into failures: inout [String]) -> Int {
        let countBefore = failures.count

        // 1. Acción limpia pasa.
        let cleanEvent = mockEvent(title: "Ir a buscar a mi hermano", icon: "event")
        let r1 = NovaActionValidator.validate(
            actions: [.addEvent(cleanEvent)],
            userText: "necesito ir a buscar a mi hermano a las tres"
        )
        check(label: "validator: acción limpia pasa",
              actual: r1.safeActions.count, expected: 1, failures: &failures)
        check(label: "validator: clean → shouldAsk false",
              actual: r1.shouldAsk, expected: false, failures: &failures)

        // 2. Título concatenado se rechaza.
        let badEvent = mockEvent(title: "Salir a jugar fútbol que llevar la pelota", icon: "event")
        let r2 = NovaActionValidator.validate(
            actions: [.addEvent(badEvent)],
            userText: "salir a jugar fútbol y llevar la pelota a las 11"
        )
        check(label: "validator: concat 'que llevar' rechazado",
              actual: r2.safeActions.count, expected: 0, failures: &failures)
        check(label: "validator: concat → shouldAsk true",
              actual: r2.shouldAsk, expected: true, failures: &failures)

        // 3. Hora pegada al título se rechaza.
        let timeInTitle = mockEvent(title: "Comer a las 4", icon: "restaurant")
        let r3 = NovaActionValidator.validate(
            actions: [.addEvent(timeInTitle)],
            userText: "tengo que comer a las 4"
        )
        check(label: "validator: 'a las 4' pegado rechazado",
              actual: r3.shouldAsk, expected: true, failures: &failures)

        // 4. Categoría reunión sin trigger → sanitize a "event".
        let fakeReunion = mockEvent(title: "Comer con papá", icon: "groups")
        let r4 = NovaActionValidator.validate(
            actions: [.addEvent(fakeReunion)],
            userText: "comer con papá a las 7"
        )
        check(label: "validator: groups sin trigger sanitizado",
              actual: r4.safeActions.count, expected: 1, failures: &failures)
        if case .addEvent(let evt) = r4.safeActions.first {
            check(label: "validator: icon downgraded a 'event'",
                  actual: evt.icon, expected: "event" as String?, failures: &failures)
        }

        // 5. Categoría reunión CON trigger se respeta.
        let realReunion = mockEvent(title: "Reunión con Juan", icon: "groups")
        let r5 = NovaActionValidator.validate(
            actions: [.addEvent(realReunion)],
            userText: "reunión con Juan mañana a las 5"
        )
        if case .addEvent(let evt) = r5.safeActions.first {
            check(label: "validator: groups con 'reunión' se conserva",
                  actual: evt.icon, expected: "groups" as String?, failures: &failures)
        }

        // 5b. sanitized() PRESERVA el subtitle del backend (bug 2026-06-11:
        // el init reconstruido lo omitía y todo add_event perdía su
        // subtitle por-evento — el cliente luego untaba el detalle global
        // del userText en TODOS los eventos del batch).
        let subtitled = mockEvent(
            title: "Comer con papá", icon: "groups", subtitle: "Pierna"
        )
        let r5b = NovaActionValidator.validate(
            actions: [.addEvent(subtitled)],
            userText: "comer con papá a las 7"
        )
        if case .addEvent(let evt) = r5b.safeActions.first {
            check(label: "validator: subtitle sobrevive a sanitized()",
                  actual: evt.subtitle, expected: "Pierna" as String?, failures: &failures)
        } else {
            failures.append("validator: evento con subtitle no pasó validación")
        }

        // 6. Título demasiado largo se rechaza.
        let longTitle = String(repeating: "x", count: 65)
        let huge = mockEvent(title: longTitle, icon: "event")
        let r6 = NovaActionValidator.validate(
            actions: [.addEvent(huge)],
            userText: "x"
        )
        check(label: "validator: título >60 chars rechazado",
              actual: r6.shouldAsk, expected: true, failures: &failures)

        // 7. Tarea pasa con "y" entre objetos.
        let breadAndMilk = BackendTaskCreate(
            label: "Comprar pan y leche", priority: nil, category: nil,
            linkedEventId: nil, parentTaskId: nil
        )
        let r7 = NovaActionValidator.validate(
            actions: [.addTask(breadAndMilk)],
            userText: "comprar pan y leche"
        )
        check(label: "validator: 'pan y leche' tarea pasa",
              actual: r7.safeActions.count, expected: 1, failures: &failures)

        // 8. Mix: una acción mala bloquea TODO el lote.
        let mixActions: [BackendAction] = [
            .addEvent(mockEvent(title: "Ir a jugar fútbol", icon: "event")),
            .addEvent(mockEvent(title: "Salir que llevar pelota", icon: "event")),
        ]
        let r8 = NovaActionValidator.validate(
            actions: mixActions,
            userText: "ir a jugar fútbol y llevar la pelota"
        )
        check(label: "validator: una mala bloquea las 2 buenas",
              actual: r8.safeActions.count, expected: 0, failures: &failures)
        check(label: "validator: mix → shouldAsk true",
              actual: r8.shouldAsk, expected: true, failures: &failures)

        // ───── Bug del screenshot 2026-05-13 ──────────────────────────
        //
        // Sonnet emitió título "Ir a buscar a mi hermano   jugar counter"
        // que concatena dos acciones distintas. El validator anterior NO
        // lo detectaba porque no contiene "que jugar" ni "luego jugar"
        // (los patrones explícitos). Ahora detectamos:
        //   - verbo de acción huérfano (jugar precedido por "hermano")
        //   - espacios múltiples ("hermano   jugar")

        // 9. Verbo huérfano "jugar" sin conector después de sustantivo.
        let orphanCase = mockEvent(
            title: "Ir a buscar a mi hermano jugar counter", icon: "event"
        )
        let r9 = NovaActionValidator.validate(
            actions: [.addEvent(orphanCase)],
            userText: "ir a buscar a mi hermano luego jugar counter"
        )
        check(label: "validator: 'hermano jugar' verbo huérfano rechazado",
              actual: r9.shouldAsk, expected: true, failures: &failures)
        check(label: "validator: 'hermano jugar' safeActions vacío",
              actual: r9.safeActions.count, expected: 0, failures: &failures)

        // 10. Espacios múltiples se rechazan.
        let doubleSpaceCase = mockEvent(
            title: "Ir a buscar a mi hermano   jugar counter", icon: "event"
        )
        let r10 = NovaActionValidator.validate(
            actions: [.addEvent(doubleSpaceCase)],
            userText: "ir a buscar a mi hermano luego jugar counter"
        )
        check(label: "validator: 'hermano   jugar' espacios múltiples rechazado",
              actual: r10.shouldAsk, expected: true, failures: &failures)

        // 11. NO REGRESIÓN — títulos legítimos con verbos ligados a
        //     través de "a", "para", "de", "y", "o" pasan tal cual.
        let legitCases = [
            "Ir a buscar a mi hermano",
            "Salir a comer",
            "Comprar pan y leche",
            "Llamar a mamá",
            "Reunión con Juan",
            "Estudiar para el examen",
            "Salir a jugar fútbol",   // "salir a jugar" — válido
        ]
        for legit in legitCases {
            let evt = mockEvent(title: legit, icon: "event")
            let res = NovaActionValidator.validate(
                actions: [.addEvent(evt)], userText: legit.lowercased()
            )
            check(label: "validator: legit '\(legit)' pasa",
                  actual: res.safeActions.count, expected: 1, failures: &failures)
        }

        return failures.count - countBefore
    }

    // MARK: - Helpers locales del test

    private static func mockEvent(
        title: String, icon: String?, time: String? = "3:00 PM",
        subtitle: String? = nil
    ) -> BackendEventCreate {
        BackendEventCreate(
            title: title,
            timeString: time,
            endTimeString: nil,
            dateString: nil,
            section: nil,
            icon: icon,
            reminderOffsets: nil,
            reminderNotes: nil,
            location: nil,
            notes: nil,
            subtitle: subtitle
        )
    }

    private static func check<T: Equatable>(
        label: String, actual: T, expected: T,
        failures: inout [String]
    ) {
        if actual != expected {
            let msg = "  ✗ \(label) — got \(actual), expected \(expected)"
            print(msg); failures.append(msg)
        }
    }
}
#endif
