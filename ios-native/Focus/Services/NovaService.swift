import Foundation

/// Cliente para `POST /api/focus-assistant`. Stateless: cada llamada arma
/// el request, manda Bearer + body JSON y decodifica la respuesta.
///
/// El contrato del backend está documentado en `api/focus-assistant.js` +
/// `api/_lib/systemPrompt.js`. Lo respetamos tal cual (lo usa también la
/// web en producción); el mapping al modelo iOS (FocusEvent/FocusTask) se
/// hace acá adentro para no contaminar el resto de la app.
///
/// Auth: el endpoint EXIGE Bearer válido. Sin sesión devuelve 401, y el
/// caller debe usar fallback local (`NovaResponder`).
///
/// Privacidad: NUNCA loguear el accessToken completo ni los prompts/replies
/// del usuario. Los logs solo dicen `name` o `status` del error.
enum NovaService {

    // MARK: - Public API

    /// Origen de la llamada — el backend no lo usa todavía, pero lo
    /// pasamos como flag a futuro para diferenciar costos por surface.
    enum Surface: String {
        case inlineMiDia = "inline_mi_dia"
        case novaChat = "nova_chat"
    }

    /// Personalidad activa del usuario para el system prompt. Se mantiene
    /// la lista canónica del backend.
    enum Personality: String {
        case focus
        case cercana
        case estrategica
    }

    /// Modo de respuesta de Nova — clasifica la intención del mensaje
    /// del user (introducido 2026-05-15 — refactor de Nova para que NO
    /// fuerce toda conversación a una acción de calendario).
    enum Mode: String {
        /// Conversación abierta / desahogue / consejo. NO ejecutar actions.
        /// Solo mostrar el reply como mensaje de chat. Ejemplo:
        /// "Estoy saturado" → Nova responde con consejo, no crea evento.
        case chatOnly = "chat_only"
        /// Acción directa clara — el user pidió ejecutar algo concreto.
        /// El cliente aplica `actions` y muestra `reply` como confirmación.
        case chatWithAction = "chat_with_action"
        /// Propuesta — Nova sugiere una acción pero NO la ejecuta. Las
        /// acciones están en `proposedActions`. El cliente muestra UI con
        /// botones "Aplicar / Editar / No por ahora".
        case proposal
        /// Falta info crítica. NO ejecutar nada. El reply tiene una
        /// pregunta concreta para el user.
        case clarification

        /// Fallback cuando el backend no envía el campo o envía algo no
        /// reconocido. Inferimos por la presencia de actions/pregunta.
        static func fallback(actions: [BackendAction], shouldAskUser: Bool) -> Mode {
            if shouldAskUser { return .clarification }
            return actions.isEmpty ? .chatOnly : .chatWithAction
        }
    }

    /// Resultado exitoso de una llamada. El `reply` es texto plano corto
    /// para mostrar al usuario. `actions` son mutaciones estructuradas
    /// que el caller aplica al `FocusDataStore`. `confidence` y
    /// `shouldAskUser` permiten al cliente decidir si ejecuta o solo
    /// muestra la pregunta.
    struct Result {
        let reply: String
        let actions: [BackendAction]
        let smartActionsBlocked: Bool
        let smartActionsMessage: String?
        /// 0..1 — qué tan seguro está Nova de su interpretación. ≥0.80
        /// = ejecutar normal. 0.55..0.79 = ejecutar pero el reply
        /// confirma/aclara. <0.55 = NO ejecutar (preguntar primero).
        /// Si el backend no devolvió el campo, asumimos 1.0 (alta).
        let confidence: Double
        /// Si true, el backend pidió no ejecutar y mostrar la pregunta
        /// del reply. Las `actions` deberían venir vacías cuando es true.
        let shouldAskUser: Bool
        /// Clasificación de intención del mensaje del user — define cómo
        /// el cliente debe renderizar la respuesta.
        let mode: Mode
        /// Acciones PROPUESTAS (no ejecutadas). Solo no-vacío cuando
        /// `mode == .proposal`. El cliente muestra UI para aplicar/descartar.
        let proposedActions: [BackendAction]
        /// ID generado por el backend (o reenviado desde el header
        /// X-Request-Id del cliente) para correlacionar logs entre Nova,
        /// el endpoint y la app. Sin PII — UUID o hash corto.
        let requestId: String?
        var followUpQuestion: String? = nil
    }

    /// Llama al backend. Lanza `NovaServiceError` para que el caller
    /// decida si cae al parser local.
    static func send(
        message: String,
        events: [FocusEvent],
        tasks: [FocusTask],
        history: [HistoryEntry],
        accessToken: String,
        personality: Personality = .focus,
        surface: Surface = .inlineMiDia,
        timezone: TimeZone = .current,
        now: Date = Date(),
        discussedEventIds: [UUID] = [],
        userMemories: [String] = []
    ) async throws -> Result {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw NovaServiceError.emptyMessage }
        guard trimmed.count <= 4000 else { throw NovaServiceError.messageTooLong }

        let url = FocusConfig.apiOrigin.appendingPathComponent("api/focus-assistant")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45  // matchea anthropic SDK timeout backend
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-Id")
        // FASE 3 QA — bypass Vercel SSO para Preview. nil en prod.
        if let bypass = FocusConfig.vercelBypassToken {
            request.setValue(bypass, forHTTPHeaderField: "x-vercel-protection-bypass")
        }

        let payload = BackendRequestPayload(
            message: trimmed,
            novaPersonality: personality.rawValue,
            mode: surface.rawValue,
            events: events.map { BackendEventDTO(local: $0) },
            tasks: tasks.map { BackendTaskDTO(local: $0) },
            history: history.map { BackendHistoryEntry(role: $0.role.rawValue, content: $0.content) },
            clientNow: Int(now.timeIntervalSince1970 * 1000),
            clientTimezone: timezone.identifier,
            discussedEventIds: discussedEventIds.map { $0.uuidString },
            userMemories: userMemories.isEmpty ? nil : userMemories
        )

        do {
            request.httpBody = try jsonEncoder.encode(payload)
        } catch {
            throw NovaServiceError.encoding(error)
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let urlErr as URLError where urlErr.code == .timedOut {
            throw NovaServiceError.timeout
        } catch let urlErr as URLError where [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(urlErr.code) {
            throw NovaServiceError.offline
        } catch {
            throw NovaServiceError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw NovaServiceError.invalidResponse
        }

        switch http.statusCode {
        case 200:
            do {
                let decoded = try jsonDecoder.decode(BackendResponsePayload.self, from: data)
                let shouldAsk = decoded.shouldAskUser ?? false
                let modeRaw = decoded.mode
                let resolvedMode: Mode = {
                    if let raw = modeRaw, let m = Mode(rawValue: raw) {
                        return m
                    }
                    return Mode.fallback(actions: decoded.actions, shouldAskUser: shouldAsk)
                }()
                #if DEBUG
                if let rid = decoded.requestId, !rid.isEmpty {
                    // Trazabilidad e2e — solo DEBUG, sin PII (UUID).
                    debugLog("[NovaService] reqId=\(rid) actions=\(decoded.actions.count) mode=\(resolvedMode.rawValue)")
                }
                #endif
                return Result(
                    reply: decoded.reply,
                    actions: decoded.actions,
                    smartActionsBlocked: decoded.smartActionsBlocked ?? false,
                    smartActionsMessage: decoded.smartActionsMessage,
                    confidence: decoded.confidence ?? 1.0,
                    shouldAskUser: shouldAsk,
                    mode: resolvedMode,
                    proposedActions: decoded.proposedActions,
                    requestId: decoded.requestId,
                    followUpQuestion: decoded.followUpQuestion
                )
            } catch {
                throw NovaServiceError.decoding(error)
            }
        case 401, 403:
            throw NovaServiceError.unauthorized
        case 429:
            throw rateLimitError(from: data)
        case 502:
            throw NovaServiceError.badLLMOutput
        case 503, 504:
            throw NovaServiceError.serviceUnavailable
        default:
            throw NovaServiceError.server(status: http.statusCode)
        }
    }

    // MARK: - History entry

    /// Turno previo del chat enviado al backend. Mantener orden cronológico
    /// (user/assistant alternados, idealmente).
    struct HistoryEntry {
        enum Role: String { case user, assistant }
        let role: Role
        let content: String
    }

    /// A provider throttle is temporary; only an explicit quota code means the
    /// user's allowance is exhausted. Do not show legacy server branding.
    static func rateLimitError(from data: Data) -> NovaServiceError {
        let payload = try? jsonDecoder.decode(BackendErrorPayload.self, from: data)
        guard payload?.error == "quota_exceeded" else { return .rateLimited }
        return .quotaExceeded(message: payload?.message, details: payload?.quotaDetails)
    }

    // MARK: - Internal coders

    private static let jsonEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = []
        return e
    }()

    private static let jsonDecoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()
}

// MARK: - Errores tipados

struct NovaQuotaDetails {
    let actionType: String?
    let period: String?
    let used: Int?
    let limit: Int?
    let resetAt: String?

    func displayMessage(now: Date = Date()) -> String {
        let periodLabel = ["daily": "diario", "weekly": "semanal", "monthly": "mensual"][period ?? ""]
        let scope: String
        switch actionType {
        case "nova_message": scope = "mensajes"
        case "nova_smart_action": scope = "acciones automáticas"
        case "nova_premium_message": scope = "respuestas avanzadas"
        default: scope = "uso"
        }
        var lines = ["Has alcanzado el límite\(periodLabel.map { " \($0)" } ?? "") de \(scope) de \(AssistantBrand.displayName)."]
        if let used, let limit, used >= 0, limit > 0 {
            lines.append("Uso registrado: \(used) de \(limit).")
        }
        if let resetAt {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let fractional = formatter.date(from: resetAt)
            formatter.formatOptions = [.withInternetDateTime]
            if let reset = fractional ?? formatter.date(from: resetAt), reset > now {
                lines.append("Se restablece el \(reset.formatted(.dateTime.day().month(.wide).hour().minute())).")
            }
        }
        lines.append("Puedes seguir creando tareas y eventos manualmente.")
        return lines.joined(separator: " ")
    }

    static let unspecified = NovaQuotaDetails(actionType: nil, period: nil, used: nil, limit: nil, resetAt: nil)
}

enum NovaServiceError: Error, LocalizedError {
    case emptyMessage
    case messageTooLong
    case unauthorized           // 401/403 → caller debe usar fallback
    case quotaExceeded(message: String?, details: NovaQuotaDetails? = nil)
    case rateLimited
    case badLLMOutput           // 502 (parser falló en backend)
    case serviceUnavailable     // 503/504 (modelo / red upstream)
    case offline
    case timeout
    case network(Error)
    case invalidResponse
    case encoding(Error)
    case decoding(Error)
    case server(status: Int)

    /// True cuando el error es "esperable" y la app debería usar el
    /// `NovaResponder` local con un mensaje sutil.
    ///
    /// **Política V2 (2026-05-11)**: pragmatic fallback — un usuario que
    /// escribe en Nova quiere su acción ejecutada, no ver "Error 500". Si
    /// el local puede resolver, lo resolvemos. Solo `emptyMessage` y
    /// `messageTooLong` quedan sin fallback porque son client-side y no
    /// hay nada que el local pueda aportar.
    ///
    /// Antes: `.server`, `.invalidResponse`, `.encoding`, `.decoding`
    /// mostraban un mensaje técnico directamente al usuario. Ahora caen
    /// al parser local con una nota humana.
    var canFallbackToLocal: Bool {
        switch self {
        case .emptyMessage, .messageTooLong:
            return false
        default:
            return true
        }
    }

    /// Mensajes que SÍ se muestran al usuario cuando el error no permite
    /// fallback (típicamente cuota agotada o mensaje vacío). Todos en
    /// español neutro, sin jargon técnico, sin números de status. El
    /// usuario no debe saber que existió un "500", un "modo local" ni
    /// "Nova avanzada vs simple" — eso es ruido de implementación.
    var errorDescription: String? {
        switch self {
        case .emptyMessage:        return "El mensaje está vacío."
        case .messageTooLong:      return "El mensaje es demasiado largo. Acórtalo un poco."
        case .unauthorized:        return "Tu sesión expiró. Vuelve a iniciar sesión cuando puedas."
        case .quotaExceeded(_, let details): return (details ?? .unspecified).displayMessage()
        case .rateLimited:         return "Hay demasiadas solicitudes en este momento. Espera un poco y vuelve a intentarlo."
        case .badLLMOutput:        return "No pude entender bien lo que respondió \(AssistantBrand.displayName). Repite el mensaje, por favor."
        case .serviceUnavailable:  return "\(AssistantBrand.displayName) no está disponible en este momento. Vuelve a intentarlo en un rato."
        case .offline:             return "Sin conexión. Tus cambios quedan en este iPhone hasta que vuelvas a tener internet."
        case .timeout:             return "\(AssistantBrand.displayName) tardó más de lo esperado. Vuelve a intentarlo."
        case .network:             return "Hubo un problema con la conexión. Vuelve a intentarlo."
        case .invalidResponse:     return "Algo no salió como esperaba. Vuelve a intentarlo."
        case .encoding:            return "No pude armar tu solicitud. Vuelve a intentarlo."
        case .decoding:            return "No pude leer la respuesta. Vuelve a intentarlo."
        case .server:              return "Algo no salió como esperaba. Vuelve a intentarlo en un momento."
        }
    }

    /// Nota HONESTA para mostrar al usuario cuando, estando LOGUEADO, el
    /// backend (Nova IA) falló y caímos al parser local de respaldo. Deja
    /// CLARO que lo resuelto NO vino de la IA real — el fallback NUNCA debe
    /// parecer que Nova funcionó normal (user spec 2026-06-13). Antes estos
    /// casos de servidor devolvían `nil` → fallback silencioso.
    var loggedInFallbackNote: String {
        switch self {
        case .unauthorized:
            return "Tu sesión expiró — esto quedó solo en este iPhone. Vuelve a iniciar sesión para sincronizarlo con \(AssistantBrand.displayName)."
        case .quotaExceeded(_, let details):
            return (details ?? .unspecified).displayMessage() + " Esta petición se resolvió en este iPhone con el modo local."
        case .rateLimited:
            return "Hay demasiadas solicitudes en este momento. Esta petición se resolvió en este iPhone con el modo local."
        case .offline:
            return "Sin conexión — lo resolví en este iPhone con el modo local. Se sincronizará con \(AssistantBrand.displayName) cuando vuelvas a tener internet."
        case .timeout:
            return "\(AssistantBrand.displayName) (IA) tardó demasiado — usé el modo local de respaldo. Vuelve a intentarlo en un momento."
        case .serviceUnavailable:
            return "\(AssistantBrand.displayName) (IA) no está disponible — usé el modo local de respaldo. Vuelve a intentarlo en un rato."
        case .network:
            return "Falló la conexión con \(AssistantBrand.displayName) — usé el modo local de respaldo. Revisa tu internet y vuelve a intentarlo."
        case .badLLMOutput, .server, .invalidResponse, .encoding, .decoding:
            return "No pude contactar a \(AssistantBrand.displayName) (IA) — usé el modo local de respaldo. Vuelve a intentarlo en un momento."
        case .emptyMessage, .messageTooLong:
            return ""  // No aplica: estos no hacen fallback.
        }
    }

    /// Etiqueta corta y técnica para LOGS (consola / NovaDevLog). Permite
    /// ver el error REAL del backend cuando ocurre un fallback logueado.
    var debugLabel: String {
        switch self {
        case .emptyMessage:        return "emptyMessage"
        case .messageTooLong:      return "messageTooLong"
        case .unauthorized:        return "unauthorized(401/403)"
        case .quotaExceeded:       return "quotaExceeded(429)"
        case .rateLimited:         return "rateLimited(429)"
        case .badLLMOutput:        return "badLLMOutput(502)"
        case .serviceUnavailable:  return "serviceUnavailable(503/504)"
        case .offline:             return "offline"
        case .timeout:             return "timeout"
        case .network:             return "network"
        case .invalidResponse:     return "invalidResponse"
        case .encoding:            return "encoding"
        case .decoding:            return "decoding"
        case .server(let s):       return "server(status=\(s))"
        }
    }
}

// MARK: - DTOs request

/// Shape exacto del request que el backend espera (snake_case via CodingKeys).
private struct BackendRequestPayload: Encodable {
    let message: String
    let novaPersonality: String
    let mode: String
    let events: [BackendEventDTO]
    let tasks: [BackendTaskDTO]
    let history: [BackendHistoryEntry]
    let clientNow: Int
    let clientTimezone: String
    /// IDs de eventos discutidos recientemente (más reciente primero).
    /// Sirve al backend para resolver referencias implícitas: si el user
    /// pide "acuérdame de X" sin nombrar evento, anclamos al primero de
    /// esta lista que coincida por contexto temático.
    let discussedEventIds: [String]
    /// Memoria persistente del usuario (V2 2026-05-27). Array de líneas
    /// humanas tipo "Juan Pablo es mi coordinador" o "teorías = Teorías
    /// de la Comunicación". El backend OpenAI las inyecta al system prompt
    /// para que GPT pueda resolver referencias sin repreguntar.
    /// Opcional para back-compat con backend Anthropic que ignora el campo.
    let userMemories: [String]?

    enum CodingKeys: String, CodingKey {
        case message
        case novaPersonality
        case mode
        case events
        case tasks
        case history
        case clientNow
        case clientTimezone
        case discussedEventIds
        case userMemories
    }
}

private struct BackendHistoryEntry: Encodable {
    let role: String
    let content: String
}

/// Shape de evento que el backend espera (referencia en
/// `systemPrompt.js`). Hora como string "H:MM AM/PM", date YYYY-MM-DD.
private struct BackendEventDTO: Encodable {
    let id: String
    let title: String
    let subtitle: String?
    let time: String
    let endTime: String?
    let date: String?
    let section: String
    let reminderOffsets: [Int]?

    init(local event: FocusEvent) {
        self.id = event.id.uuidString
        self.title = event.title
        self.subtitle = event.subtitle
        self.time = NovaTimeFormatter.formatHourMinute(from: event.startTime)
        self.endTime = event.displayAsPointInTime ? nil : event.endTime.map(NovaTimeFormatter.formatHourMinute)
        self.reminderOffsets = event.reminderOffsets
        self.date = NovaTimeFormatter.formatISODate(from: event.startTime)
        let hour = Calendar.current.component(.hour, from: event.startTime)
        self.section = hour >= 14 ? "evening" : "focus"
    }
}

/// Shape de tarea que el backend espera.
private struct BackendTaskDTO: Encodable {
    let id: String
    let label: String
    let priority: String
    let category: String
    let done: Bool
    let date: String?
    let time: String?

    init(local task: FocusTask) {
        self.id = task.id.uuidString
        self.label = task.title
        self.priority = task.priority.backendLabel
        self.category = task.category.backendLabel
        self.done = task.done
        self.date = task.dueDate.map(NovaTimeFormatter.formatISODate)
        self.time = task.dueTime.map(NovaTimeFormatter.formatHourMinute)
    }
}

// MARK: - DTOs response

private struct BackendResponsePayload: Decodable {
    let reply: String
    let actions: [BackendAction]
    let proposedActions: [BackendAction]
    let smartActionsBlocked: Bool?
    let smartActionsMessage: String?
    let confidence: Double?
    let shouldAskUser: Bool?
    let mode: String?
    let requestId: String?
    let followUpQuestion: String?

    enum CodingKeys: String, CodingKey {
        case reply
        case actions
        case proposedActions = "proposed_actions"
        case smartActionsBlocked = "smart_actions_blocked"
        case smartActionsMessage = "smart_actions_message"
        case confidence
        case shouldAskUser
        case mode
        case requestId
        case followUpQuestion = "follow_up_question"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.reply = try c.decodeIfPresent(String.self, forKey: .reply) ?? ""
        self.smartActionsBlocked = try c.decodeIfPresent(Bool.self, forKey: .smartActionsBlocked)
        self.smartActionsMessage = try c.decodeIfPresent(String.self, forKey: .smartActionsMessage)
        self.confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        self.shouldAskUser = try c.decodeIfPresent(Bool.self, forKey: .shouldAskUser)
        self.mode = try c.decodeIfPresent(String.self, forKey: .mode)
        self.requestId = try c.decodeIfPresent(String.self, forKey: .requestId)
        self.followUpQuestion = try c.decodeIfPresent(String.self, forKey: .followUpQuestion)
        // Decodificar actions de forma resiliente: si un item falla por type
        // desconocido o shape inesperado, lo saltamos en vez de tumbar todo.
        if let raw = try? c.decode([RawAction].self, forKey: .actions) {
            self.actions = raw.compactMap { $0.decoded }
        } else {
            self.actions = []
        }
        // Mismo decoder resiliente para proposed_actions.
        if let raw = try? c.decode([RawAction].self, forKey: .proposedActions) {
            self.proposedActions = raw.compactMap { $0.decoded }
        } else {
            self.proposedActions = []
        }
    }
}

private struct BackendErrorPayload: Decodable {
    let error: String?
    let message: String?
    let quotaDetails: NovaQuotaDetails

    enum CodingKeys: String, CodingKey {
        case error, message, period, used, limit
        case actionType = "action_type"
        case resetAt = "reset_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        error = try? container.decode(String.self, forKey: .error)
        message = try? container.decode(String.self, forKey: .message)
        quotaDetails = NovaQuotaDetails(
            actionType: try? container.decode(String.self, forKey: .actionType),
            period: try? container.decode(String.self, forKey: .period),
            used: try? container.decode(Int.self, forKey: .used),
            limit: try? container.decode(Int.self, forKey: .limit),
            resetAt: try? container.decode(String.self, forKey: .resetAt)
        )
    }
}

// MARK: - Actions (heterogéneas)

/// Acciones que el backend puede devolver. Mantiene los mismos cases que
/// la lista canónica del system prompt. Si llega un tipo desconocido, lo
/// envolvemos en `.unsupported` para loggear pero no crashear.
enum BackendAction {
    /// Crear evento — `endTime` null cuando no hay término.
    case addEvent(BackendEventCreate)
    /// Crear evento recurrente — cliente expande N instancias.
    case addRecurringEvent(BackendEventCreate, BackendRecurrence)
    /// Editar campos de un evento existente. `id` puede ser UUID del local.
    case editEvent(id: String, updates: BackendEventUpdates)
    /// Borrar evento.
    case deleteEvent(id: String)
    /// Crear tarea.
    case addTask(BackendTaskCreate)
    /// Toggle de tarea (marca/desmarca como hecha).
    case toggleTask(id: String)
    /// Borrar tarea.
    case deleteTask(id: String)
    /// Memoria sobre el usuario — V1 (legacy): no se persiste, solo se loguea.
    case remember
    /// V2 (2026-05-27): el LLM (OpenAI w/ reasoning) detectó que el user
    /// está enseñando algo personal. Persistimos en NovaMemoryStore.
    case saveMemory(key: String, value: String, category: String)
    /// V2: el user pidió olvidar. `key == "__all__"` → clear total.
    case forgetMemory(key: String)
    /// Type desconocido — guardamos el name para diagnóstico.
    case unsupported(typeName: String)
}

/// Datos para crear un evento (matchea `event` del backend).
struct BackendEventCreate {
    let title: String
    let timeString: String?      // "9:00 AM", "20:00", etc.
    let endTimeString: String?   // null si recordatorio
    let dateString: String?      // "YYYY-MM-DD"; null = hoy
    let section: String?         // "focus" / "evening"
    let icon: String?            // fitness_center | groups | …
    let reminderOffsets: [Int]?
    let reminderNotes: [String]?  // texto custom por offset (paralelo)
    let location: String?
    let notes: String?
    /// Subtítulo/contexto que el backend (Claude) manda para mostrar debajo
    /// del título en la tarjeta. SIN default a propósito: dos constructores
    /// lo omitían en silencio (validator.sanitized y expandRecurringEvent) y
    /// el subtitle por-evento del backend se perdía — el compilador ahora
    /// obliga a propagarlo en toda copia del payload.
    let subtitle: String?
}

/// Recurrencia (matchea shape backend).
struct BackendRecurrence {
    let pattern: String          // "daily" | "weekdays" | "weekly"
    let weekday: Int?            // 0=domingo
    let count: Int?
    let startDate: String?       // "YYYY-MM-DD"
}

/// Campos parciales para editar un evento.
struct BackendEventUpdates {
    let title: String?
    let timeString: String?
    let endTimeString: String?
    let dateString: String?
    let location: String?
    let reminderOffsets: [Int]?
    let reminderNotes: [String]?
    /// Subtítulo nuevo. nil = no tocar; string vacío "" = quitar el actual.
    var subtitle: String? = nil
}

/// Datos para crear una tarea.
struct BackendTaskCreate {
    let label: String
    let priority: String?        // "Alta" | "Media" | "Baja"
    let category: String?        // "hoy" | "semana" | "algún día"
    let linkedEventId: String?
    let parentTaskId: String?
    var dateString: String? = nil
}

// MARK: - Action decoding

/// Decodificador resiliente: lee `type` primero y dispatch al case que
/// corresponda. Si el shape interno está incompleto, devuelve `.unsupported`
/// en vez de fallar.
private struct RawAction: Decodable {
    let decoded: BackendAction?

    private enum DispatchKeys: String, CodingKey {
        case type
        case event
        case task
        case id
        case updates
        case recurrence
        case memory
    }

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: DispatchKeys.self) else {
            self.decoded = .unsupported(typeName: "invalid")
            return
        }
        let rawType = (try? c.decode(String.self, forKey: .type)) ?? ""

        switch rawType {
        case "add_event":
            if let ev = try? c.decode(EventCreateDecoded.self, forKey: .event) {
                self.decoded = .addEvent(ev.toModel())
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "add_recurring_event":
            let ev = try? c.decode(EventCreateDecoded.self, forKey: .event)
            let rec = try? c.decode(RecurrenceDecoded.self, forKey: .recurrence)
            if let ev, let rec {
                self.decoded = .addRecurringEvent(ev.toModel(), rec.toModel())
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "edit_event", "update_event":
            let id = (try? c.decode(String.self, forKey: .id)) ?? ""
            let upd = (try? c.decode(EventUpdatesDecoded.self, forKey: .updates))
                ?? EventUpdatesDecoded()
            if id.isEmpty {
                self.decoded = .unsupported(typeName: rawType)
            } else {
                self.decoded = .editEvent(id: id, updates: upd.toModel())
            }
        case "delete_event":
            if let id = try? c.decode(String.self, forKey: .id), !id.isEmpty {
                self.decoded = .deleteEvent(id: id)
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "add_task":
            if let t = try? c.decode(TaskCreateDecoded.self, forKey: .task) {
                self.decoded = .addTask(t.toModel())
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "toggle_task":
            if let id = try? c.decode(String.self, forKey: .id), !id.isEmpty {
                self.decoded = .toggleTask(id: id)
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "delete_task":
            if let id = try? c.decode(String.self, forKey: .id), !id.isEmpty {
                self.decoded = .deleteTask(id: id)
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "remember":
            self.decoded = .remember
        case "save_memory":
            let mem = try? c.decode(MemoryDecoded.self, forKey: .memory)
            if let mem, !mem.key.isEmpty, !mem.value.isEmpty {
                self.decoded = .saveMemory(
                    key: mem.key,
                    value: mem.value,
                    category: mem.category ?? "preference"
                )
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        case "forget_memory":
            let mem = try? c.decode(MemoryDecoded.self, forKey: .memory)
            if let mem, !mem.key.isEmpty {
                self.decoded = .forgetMemory(key: mem.key)
            } else {
                self.decoded = .unsupported(typeName: rawType)
            }
        default:
            self.decoded = .unsupported(typeName: rawType)
        }
    }

    /// Shape de memoria en action JSON: `{key, value, category}`.
    private struct MemoryDecoded: Decodable {
        let key: String
        let value: String
        let category: String?
    }

    // MARK: - Subdecoders

    private struct EventCreateDecoded: Decodable {
        let title: String?
        let subtitle: String?
        let time: String?
        let endTime: String?
        let date: String?
        let section: String?
        let icon: String?
        let reminderOffsets: [Int]?
        let reminderNotes: [String]?
        let location: String?
        let notes: String?

        enum CodingKeys: String, CodingKey {
            case title, subtitle, time, endTime, date, section, icon
            case reminderOffsets
            case reminderNotes
            case location, notes
        }

        func toModel() -> BackendEventCreate {
            BackendEventCreate(
                title: title ?? "",
                timeString: time,
                endTimeString: endTime,
                dateString: date,
                section: section,
                icon: icon,
                reminderOffsets: reminderOffsets,
                reminderNotes: reminderNotes,
                location: location,
                notes: notes,
                subtitle: subtitle
            )
        }
    }

    private struct EventUpdatesDecoded: Decodable {
        let title: String?
        let time: String?
        let endTime: String?
        let date: String?
        let location: String?
        let reminderOffsets: [Int]?
        let reminderNotes: [String]?
        let subtitle: String?

        init() {
            title = nil; time = nil; endTime = nil; date = nil
            location = nil; reminderOffsets = nil; reminderNotes = nil
            subtitle = nil
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.title = try c.decodeIfPresent(String.self, forKey: .title)
            self.time = try c.decodeIfPresent(String.self, forKey: .time)
            self.endTime = try c.decodeIfPresent(String.self, forKey: .endTime)
            self.date = try c.decodeIfPresent(String.self, forKey: .date)
            self.location = try c.decodeIfPresent(String.self, forKey: .location)
            self.reminderOffsets = try c.decodeIfPresent([Int].self, forKey: .reminderOffsets)
            self.reminderNotes = try c.decodeIfPresent([String].self, forKey: .reminderNotes)
            self.subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
        }

        enum CodingKeys: String, CodingKey {
            case title, time, endTime, date, location, reminderOffsets, reminderNotes, subtitle
        }

        func toModel() -> BackendEventUpdates {
            BackendEventUpdates(
                title: title,
                timeString: time,
                endTimeString: endTime,
                dateString: date,
                location: location,
                reminderOffsets: reminderOffsets,
                reminderNotes: reminderNotes,
                subtitle: subtitle
            )
        }
    }

    private struct TaskCreateDecoded: Decodable {
        let label: String?
        let priority: String?
        let category: String?
        let linkedEventId: String?
        let parentTaskId: String?
        let date: String?

        func toModel() -> BackendTaskCreate {
            BackendTaskCreate(
                label: label ?? "",
                priority: priority,
                category: category,
                linkedEventId: linkedEventId,
                parentTaskId: parentTaskId,
                dateString: date
            )
        }
    }

    private struct RecurrenceDecoded: Decodable {
        let pattern: String?
        let weekday: Int?
        let count: Int?
        let startDate: String?

        func toModel() -> BackendRecurrence {
            BackendRecurrence(
                pattern: pattern ?? "daily",
                weekday: weekday,
                count: count,
                startDate: startDate
            )
        }
    }
}

// MARK: - Parsers de hora/fecha

/// Conversión bidireccional entre Date y los strings que usa el backend.
/// "9:00 AM" / "3:30 PM" / "20:00" → hora del día. "YYYY-MM-DD" → fecha.
enum NovaTimeFormatter {

    /// Fecha + hora del backend → Date local.
    /// - Si solo viene `time` (sin `date`), asume HOY (la fecha por defecto es razonable
    ///   para el flujo "voy al gym a las 6" sin fecha).
    /// - Si solo viene `date` (sin `time`), retorna **nil** — esto es CRÍTICO:
    ///   antes asignaba 9:00 AM por default, lo que generaba el bug
    ///   "Nova inventa hora cuando user no la dijo". Ahora devolver nil
    ///   fuerza al call site a tratar el evento como needsClarification
    ///   y preguntar al usuario.
    /// - Si ambos null, retorna nil.
    static func resolveDate(dateString: String?, timeString: String?) -> Date? {
        let cal = Calendar.current
        let now = Date()
        let baseDay = parseISODate(dateString) ?? cal.startOfDay(for: now)
        guard let (hour, minute) = parseHourMinute(timeString) else {
            // Antes: asignaba 9:00 AM si había fecha — eso inventaba hora.
            // Ahora: retornar nil para que el caller pida aclaración.
            return nil
        }
        return cal.date(bySettingHour: hour, minute: minute, second: 0, of: baseDay)
    }

    /// "20:00" / "8:00 PM" / "8 PM" / "8am" → (hour, minute).
    static func parseHourMinute(_ raw: String?) -> (Int, Int)? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        let lower = raw.lowercased()

        // 24h "HH:MM" puro.
        if let m = lower.range(of: #"^(\d{1,2}):(\d{2})$"#, options: .regularExpression) {
            let parts = String(lower[m]).split(separator: ":")
            if parts.count == 2,
               let h = Int(parts[0]), h < 24,
               let mn = Int(parts[1]), mn < 60 {
                return (h, mn)
            }
        }

        // "HH AM/PM" / "HH:MM AM/PM" / "HHam" / "HH PM".
        let amPmPattern = #"^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)$"#
        if let regex = try? NSRegularExpression(pattern: amPmPattern, options: [.caseInsensitive]) {
            let ns = lower as NSString
            if let match = regex.firstMatch(in: lower, range: NSRange(location: 0, length: ns.length)),
               match.numberOfRanges >= 4 {
                let h = Int(ns.substring(with: match.range(at: 1))) ?? 0
                guard h >= 1 && h <= 12 else { return nil }
                let mn: Int = {
                    let r = match.range(at: 2)
                    if r.location == NSNotFound { return 0 }
                    return Int(ns.substring(with: r)) ?? 0
                }()
                let suffix = ns.substring(with: match.range(at: 3)).lowercased()
                let isPM = suffix.hasPrefix("p")
                var hour24 = h
                if h == 12 {
                    hour24 = isPM ? 12 : 0
                } else if isPM {
                    hour24 = h + 12
                }
                if hour24 < 24, mn < 60 { return (hour24, mn) }
            }
        }

        // 24h "HH" puro (poco común desde backend, pero por las dudas).
        if let n = Int(lower), n >= 0, n < 24 {
            return (n, 0)
        }

        return nil
    }

    /// "YYYY-MM-DD" → Date (medianoche local).
    static func parseISODate(_ raw: String?) -> Date? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]),
              let m = Int(parts[1]),
              let d = Int(parts[2]) else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = m
        comps.day = d
        let calendar = Calendar.current
        guard let date = calendar.date(from: comps) else { return nil }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        guard roundTrip.year == y, roundTrip.month == m, roundTrip.day == d else { return nil }
        return date
    }

    /// Date → "h:mm AM/PM" en es-CL (formato que devuelve Anthropic en sus
    /// ejemplos). Usado para serializar eventos al backend.
    static func formatHourMinute(from date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "h:mm a"
        return fmt.string(from: date).uppercased()
    }

    /// Date → "YYYY-MM-DD" en zona local.
    static func formatISODate(from date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: date)
    }
}

// MARK: - Mapping helpers

extension TaskPriority {
    /// Etiqueta que el backend espera para la prioridad. Mismo wording que
    /// usa el system prompt ("Alta" / "Media" / "Baja").
    fileprivate var backendLabel: String {
        switch self {
        case .alta:  return "Alta"
        case .media: return "Media"
        case .baja:  return "Baja"
        }
    }

    /// Decodifica el `priority` que devuelve el backend. Es flexible: acepta
    /// "Alta"/"alta", "high", etc. Cae a `.media` si no entiende.
    static func fromBackendLabel(_ raw: String?) -> TaskPriority {
        guard let raw = raw?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return .media }
        switch raw {
        case "alta", "high":     return .alta
        case "baja", "low":      return .baja
        default:                 return .media
        }
    }
}

extension TaskCategory {
    fileprivate var backendLabel: String {
        switch self {
        case .hoy:      return "hoy"
        case .semana:   return "semana"
        case .algunDia: return "algún día"
        }
    }

    static func fromBackendLabel(_ raw: String?) -> TaskCategory {
        guard let raw = raw?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return .hoy }
        if raw.contains("semana") { return .semana }
        if raw.contains("algún") || raw.contains("algun") { return .algunDia }
        return .hoy
    }
}

/// Mapeo `icon` del backend → `EventSection` iOS. Conservador: cae a
/// `.personal` para casos no mapeados; `isReminder=true` lo override
/// arriba.
extension EventSection {
    static func fromBackendIcon(_ icon: String?) -> EventSection {
        let key = (icon ?? "").lowercased()
        // Familia deporte/entrenamiento: el modelo usa variantes
        // (directions_run, sports_tennis, sports_soccer, pool, etc.).
        // Todas → .entrenamiento. Antes solo "fitness_center" matcheaba y el
        // resto caía en .personal (categoría incorrecta). Bug 2026-06-13.
        if key.hasPrefix("sports_") { return .entrenamiento }
        switch key {
        case "fitness_center", "directions_run", "directions_bike",
             "directions_walk", "pool", "hiking", "sports":
                                   return .entrenamiento
        case "groups":             return .reunion
        case "menu_book":          return .estudio
        case "work":               return .foco
        case "alarm":              return .reminder
        case "local_hospital",
             "shopping_cart",
             "cake",
             "flight",
             "account_balance":    return .personal
        case "restaurant":         return .personal
        case "event":              return .reunion
        default:                   return .personal
        }
    }
}
