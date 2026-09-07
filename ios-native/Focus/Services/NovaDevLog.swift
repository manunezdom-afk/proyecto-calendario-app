import Foundation

/// Logger centralizado para diagnóstico de Nova. Captura el ciclo
/// completo de cada interacción: input del user, contexto enviado al
/// backend, modelo seleccionado, mode devuelto, acciones ejecutadas y
/// resultado final en UI.
///
/// **Por qué existe**: durante beta, cuando Nova falla, necesitamos saber
/// EXACTAMENTE por qué — fue Haiku o Sonnet, qué eventos vio, qué mode
/// clasificó, qué acciones intentó. Sin estos logs cada bug es opaco.
///
/// **Privacidad**:
/// - DEBUG: console (Xcode) y buffer en memoria — visible solo durante
///   desarrollo. NO se persiste en disco ni se envía a servidor.
/// - RELEASE: solo metadata abstracta (counts, mode, model) — el TEXTO
///   del input/output del user NO se loggea. Eso evita filtrar contenido
///   sensible a Crashlytics u otros sistemas.
///
/// Uso típico:
///   NovaDevLog.shared.startRequest(source: .inlineMiDia, userText: "...")
///   ...
///   NovaDevLog.shared.recordModelResponse(mode: .chatOnly, ...)
///   NovaDevLog.shared.finishRequest(outcome: .chatOnly)
@MainActor
final class NovaDevLog: ObservableObject {

    static let shared = NovaDevLog()

    /// Cada entrada del log es UN turno de Nova de principio a fin.
    /// Empieza con `startRequest`, se enriquece a lo largo del flujo,
    /// y se cierra con `finishRequest`.
    struct Entry: Identifiable, Equatable {
        let id: UUID
        let timestamp: Date
        var source: Source
        /// Sólo se mantiene en DEBUG. RELEASE pone solo el length.
        var userText: String?
        var userTextLength: Int
        /// Eventos visibles en el contexto cuando se mandó el request.
        var eventsCount: Int
        var tasksCount: Int
        var discussedEventsCount: Int
        var historyTurns: Int
        var modelUsed: ModelKind?
        var modelReason: String?
        var modeReturned: String?
        var confidence: Double?
        var shouldAskUser: Bool?
        var actionsCount: Int
        var proposedActionsCount: Int
        var assistantMessagePreview: String?
        /// Si la acción terminó tocando un evento existente.
        var matchedEventId: UUID?
        /// Final outcome — qué efectivamente vio el user.
        var outcome: Outcome?
        var errorDescription: String?
        /// Para debugging: la última vez que mutamos este entry.
        var lastUpdated: Date
    }

    enum Source: String {
        case inlineMiDia = "inline_mi_dia"
        case novaChat = "nova_chat"
        case unknown
    }

    enum ModelKind: String {
        case haiku
        case sonnet
        case localFallback = "local_fallback"
        case unknown
    }

    enum Outcome: String {
        case chatOnly = "chat_only"
        case actionApplied = "action_applied"
        case proposalShown = "proposal_shown"
        case clarificationAsked = "clarification_asked"
        case blockedByValidator = "blocked_by_validator"
        case demotedByAntiBasura = "demoted_by_anti_basura"
        case error
    }

    /// Buffer in-memory de las últimas N entradas. UI de debug puede
    /// pintarlo. Capped para no crecer infinito.
    @Published private(set) var entries: [Entry] = []
    private let maxEntries: Int = 50

    private init() {}

    // MARK: - Lifecycle de un turno

    /// Inicia el log de un turno. Devuelve el ID — pasarlo a las llamadas
    /// posteriores para enriquecer la misma entry.
    @discardableResult
    func startRequest(source: Source, userText: String, eventsCount: Int,
                      tasksCount: Int, discussedEventsCount: Int,
                      historyTurns: Int) -> UUID {
        let id = UUID()
        let entry = Entry(
            id: id,
            timestamp: Date(),
            source: source,
            userText: debugIncludeText ? userText : nil,
            userTextLength: userText.count,
            eventsCount: eventsCount,
            tasksCount: tasksCount,
            discussedEventsCount: discussedEventsCount,
            historyTurns: historyTurns,
            modelUsed: nil,
            modelReason: nil,
            modeReturned: nil,
            confidence: nil,
            shouldAskUser: nil,
            actionsCount: 0,
            proposedActionsCount: 0,
            assistantMessagePreview: nil,
            matchedEventId: nil,
            outcome: nil,
            errorDescription: nil,
            lastUpdated: Date()
        )
        appendEntry(entry)
        log("→ START \(source.rawValue) [chars=\(userText.count)] events=\(eventsCount) tasks=\(tasksCount) discussed=\(discussedEventsCount) history=\(historyTurns)")
        if debugIncludeText {
            log("   user: \(redactedText(userText))")
        }
        return id
    }

    /// Registra cuál modelo se eligió y por qué. El cliente lo deduce
    /// de su lado (no hay header del backend), basado en la latencia o
    /// futuros telemetry fields.
    func recordModelSelection(id: UUID, model: ModelKind, reason: String) {
        update(id: id) { e in
            e.modelUsed = model
            e.modelReason = reason
        }
        log("   model=\(model.rawValue) reason=\(reason)")
    }

    /// Registra la respuesta del backend (Nova).
    func recordModelResponse(id: UUID, mode: String?, confidence: Double?,
                              shouldAskUser: Bool, actionsCount: Int,
                              proposedActionsCount: Int,
                              assistantMessage: String) {
        update(id: id) { e in
            e.modeReturned = mode
            e.confidence = confidence
            e.shouldAskUser = shouldAskUser
            e.actionsCount = actionsCount
            e.proposedActionsCount = proposedActionsCount
            e.assistantMessagePreview = debugIncludeText
                ? String(assistantMessage.prefix(200))
                : nil
        }
        let confStr = confidence.map { String(format: "%.2f", $0) } ?? "nil"
        log("   response mode=\(mode ?? "nil") conf=\(confStr) actions=\(actionsCount) proposed=\(proposedActionsCount) ask=\(shouldAskUser)")
        if debugIncludeText {
            log("   reply: \(redactedText(String(assistantMessage.prefix(200))))")
        }
    }

    /// Registra cuando matcheamos contra un evento existente (edit, attach
    /// reminder, etc.).
    func recordMatchedEvent(id: UUID, eventId: UUID, eventTitle: String) {
        update(id: id) { e in
            e.matchedEventId = eventId
        }
        log("   matched event id=\(eventId.uuidString.prefix(8))…")
    }

    /// Cierra el turno con el outcome final.
    func finishRequest(id: UUID, outcome: Outcome, error: String? = nil) {
        update(id: id) { e in
            e.outcome = outcome
            e.errorDescription = error
        }
        log("← END outcome=\(outcome.rawValue)\(error.map { " error=\($0)" } ?? "")")
    }

    /// Marca un turno como degradado por anti-basura.
    func recordAntiBasuraDemotion(id: UUID, reason: String) {
        log("   ⚠ anti-basura demotion: \(reason)")
    }

    // MARK: - Helpers privados

    private var debugIncludeText: Bool { false }

    /// Trunca/sanitiza texto para los logs. Si el texto contiene tokens
    /// que parecen sensibles (email, números largos, "@", "key"), los
    /// reemplazamos por placeholder. Conservador.
    private func redactedText(_ raw: String) -> String {
        var s = raw
        // Emails básicos.
        s = s.replacingOccurrences(of: #"[\w.+-]+@[\w-]+\.[\w.-]+"#,
                                    with: "[email]",
                                    options: .regularExpression)
        // Números largos (8+ dígitos seguidos).
        s = s.replacingOccurrences(of: #"\b\d{8,}\b"#,
                                    with: "[number]",
                                    options: .regularExpression)
        return s
    }

    private func appendEntry(_ entry: Entry) {
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
    }

    private func update(id: UUID, _ mutate: (inout Entry) -> Void) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        var entry = entries[idx]
        mutate(&entry)
        entry.lastUpdated = Date()
        entries[idx] = entry
    }

    private func log(_ message: String) {
        #if DEBUG
        print("[NovaDevLog] \(message)")
        #endif
    }

    // MARK: - Public introspection (UI debug / dev menu)

    /// Snapshot del último turno completo. Útil para mostrar en una
    /// vista de debug en Ajustes.
    func latestEntry() -> Entry? {
        entries.last
    }

    /// Limpia el buffer. Útil cuando quieres aislar un caso de prueba.
    func clearAll() {
        entries.removeAll()
    }
}
