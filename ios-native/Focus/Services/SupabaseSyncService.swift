import Foundation

// MARK: - Errores

enum SupabaseSyncError: Error, LocalizedError {
    case notAuthenticated
    case configMissing
    case tableNotFound      // 404: probablemente falta correr migración 018
    case rlsRejected        // 401/403: RLS rechazó (user_id no matchea)
    case network(String)
    case server(Int, String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Sin sesión activa. La sincronización requiere login."
        case .configMissing:
            return "Falta configuración Supabase. Revisar FocusConfig."
        case .tableNotFound:
            return "Tabla no encontrada en Supabase. ¿Migración 018 aplicada?"
        case .rlsRejected:
            return "Permiso rechazado por RLS."
        case .network(let msg):
            return "Error de red: \(msg)"
        case .server(let code, let msg):
            return "Servidor: HTTP \(code) — \(msg)"
        case .decoding(let msg):
            return "Error decoding: \(msg)"
        }
    }
}

// MARK: - Service

/// Cliente REST contra Supabase para sincronizar eventos y tareas iOS-native.
///
/// Reglas:
/// - **Stateless** y `actor`-free. Cada método toma `accessToken` + `userId`
///   explícitos; nada de singletons de auth global.
/// - **Solo se invoca cuando `auth.state == .loggedIn`**. Modo demo NO llega
///   acá (FocusDataStore es responsable de gatear).
/// - **Falla suave**: si la red falla o la migración no está aplicada, se
///   lanza un error específico pero la app NO crashea. El caller (sync
///   coordinator en `FocusDataStore`) decide si lo ignora o lo expone al usuario.
/// - **NUNCA loguea tokens completos**. Si necesita debug, los redacta.
/// - **Idempotente**: upsert usa `Prefer: resolution=merge-duplicates`, así
///   re-enviar la misma fila no falla.
///
/// Endpoints:
/// - `POST /rest/v1/focus_events?on_conflict=id` (upsert)
/// - `GET  /rest/v1/focus_events?user_id=eq.<uid>&deleted_at=is.null`
/// - `PATCH /rest/v1/focus_events?id=eq.<id>` (update específico — usado
///   para soft delete con `deleted_at=now()`)
/// - Mismo patrón para `focus_tasks`.
enum SupabaseSyncService {

    // MARK: - Network

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 20
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    // MARK: - Helpers

    /// Construye la URL para una tabla con query params opcionales.
    private static func url(table: String, query: [URLQueryItem] = []) throws -> URL {
        var comps = URLComponents(
            url: FocusConfig.supabaseURL.appendingPathComponent("/rest/v1/\(table)"),
            resolvingAgainstBaseURL: false
        )
        comps?.queryItems = query.isEmpty ? nil : query
        guard let url = comps?.url else {
            throw SupabaseSyncError.configMissing
        }
        return url
    }

    /// Headers comunes: apikey (publishable) + Authorization Bearer del
    /// usuario + Content-Type. NO loguear estos headers.
    private static func authHeaders(accessToken: String) -> [String: String] {
        [
            "apikey": FocusConfig.supabaseAnonKey,
            "Authorization": "Bearer \(accessToken)",
            "Content-Type": "application/json"
        ]
    }

    private static func performRequest(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                throw SupabaseSyncError.network("respuesta HTTP inválida")
            }
            return (data, http)
        } catch let err as URLError {
            throw SupabaseSyncError.network(err.localizedDescription)
        } catch let err as SupabaseSyncError {
            throw err
        } catch {
            throw SupabaseSyncError.network(error.localizedDescription)
        }
    }

    private static func interpretError(_ http: HTTPURLResponse, body: Data) throws -> Never {
        let bodyString = String(data: body, encoding: .utf8) ?? ""
        switch http.statusCode {
        case 404:
            throw SupabaseSyncError.tableNotFound
        case 401, 403:
            throw SupabaseSyncError.rlsRejected
        default:
            throw SupabaseSyncError.server(http.statusCode, bodyString)
        }
    }

    // MARK: - Focus events

    /// Include tombstones: otherwise deletions made on a second device can
    /// never remove the first device's local row. Page through the full result.
    static func fetchEvents(accessToken: String, userId: String) async throws -> [RemoteFocusEvent] {
        try await fetchRows(table: "focus_events", accessToken: accessToken, userId: userId)
    }

    private static func fetchRows<Row: Decodable>(table: String, accessToken: String, userId: String) async throws -> [Row] {
        var result: [Row] = []
        let pageSize = 500
        while true {
            try Task.checkCancellation()
            let endpoint = try url(table: table, query: [
                URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                URLQueryItem(name: "order", value: "id.asc"),
                URLQueryItem(name: "limit", value: String(pageSize)),
                URLQueryItem(name: "offset", value: String(result.count))
            ])
            var request = URLRequest(url: endpoint)
            request.httpMethod = "GET"
            for (key, value) in authHeaders(accessToken: accessToken) {
                request.setValue(value, forHTTPHeaderField: key)
            }
            let (data, response) = try await performRequest(request)
            guard (200..<300).contains(response.statusCode) else { try interpretError(response, body: data) }
            let page: [Row]
            do { page = try decoder.decode([Row].self, from: data) }
            catch { throw SupabaseSyncError.decoding("\(error)") }
            result.append(contentsOf: page)
            if page.count < pageSize { return result }
        }
    }

    /// Upsert (insert o update si existe el id). Requiere `Prefer:
    /// resolution=merge-duplicates` + `on_conflict=id` query param.
    static func upsertEvent(_ event: RemoteFocusEvent, accessToken: String) async throws {
        let url = try url(
            table: "focus_events",
            query: [URLQueryItem(name: "on_conflict", value: "id")]
        )
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        for (k, v) in authHeaders(accessToken: accessToken) {
            req.setValue(v, forHTTPHeaderField: k)
        }
        req.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = try encoder.encode([event])

        let (data, http) = try await performRequest(req)
        guard (200..<300).contains(http.statusCode) else {
            try interpretError(http, body: data)
        }
    }

    /// Soft delete: marca `deleted_at = now()`. Usamos PATCH en vez de
    /// DELETE para conservar histórico (útil para futuro undo + sync).
    static func softDeleteEvent(id: UUID, accessToken: String) async throws {
        let url = try url(
            table: "focus_events",
            query: [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        )
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        for (k, v) in authHeaders(accessToken: accessToken) {
            req.setValue(v, forHTTPHeaderField: k)
        }
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        let body: [String: String] = [
            "deleted_at": ISO8601DateFormatter().string(from: Date())
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, http) = try await performRequest(req)
        guard (200..<300).contains(http.statusCode) else {
            try interpretError(http, body: data)
        }
    }

    // MARK: - Focus tasks

    static func fetchTasks(accessToken: String, userId: String) async throws -> [RemoteFocusTask] {
        try await fetchRows(table: "focus_tasks", accessToken: accessToken, userId: userId)
    }

    static func upsertTask(_ task: RemoteFocusTask, accessToken: String) async throws {
        let url = try url(
            table: "focus_tasks",
            query: [URLQueryItem(name: "on_conflict", value: "id")]
        )
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        for (k, v) in authHeaders(accessToken: accessToken) {
            req.setValue(v, forHTTPHeaderField: k)
        }
        req.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = try encoder.encode([task])

        let (data, http) = try await performRequest(req)
        guard (200..<300).contains(http.statusCode) else {
            try interpretError(http, body: data)
        }
    }

    static func softDeleteTask(id: UUID, accessToken: String) async throws {
        let url = try url(
            table: "focus_tasks",
            query: [URLQueryItem(name: "id", value: "eq.\(id.uuidString)")]
        )
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        for (k, v) in authHeaders(accessToken: accessToken) {
            req.setValue(v, forHTTPHeaderField: k)
        }
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        let body: [String: String] = [
            "deleted_at": ISO8601DateFormatter().string(from: Date())
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, http) = try await performRequest(req)
        guard (200..<300).contains(http.statusCode) else {
            try interpretError(http, body: data)
        }
    }
}

// MARK: - Remote DTOs

/// Shape exacto del row de `public.focus_events`. Usa snake_case porque el
/// `keyEncodingStrategy = .convertToSnakeCase` se aplica al encoder JSON.
/// Convención: campos opcionales son nullable; los obligatorios coinciden con
/// `NOT NULL` en la migración 018.
struct RemoteFocusEvent: Codable, Hashable {
    enum CodingKeys: String, CodingKey { case id, userId, title, notes, startTime, endTime, isReminder, inferredDuration, section, location, source, externalCalendarId, externalEventId, url, lastSyncedAt, createdAt, updatedAt, deletedAt, subtitle, reminderOffsets, reminderNotes }

    let id: UUID
    let userId: UUID
    var title: String
    var notes: String?
    var startTime: Date?
    var endTime: Date?
    var isReminder: Bool
    var inferredDuration: Bool
    var section: String?
    var location: String?
    var source: String
    var externalCalendarId: String?
    var externalEventId: String?
    var url: String?
    var lastSyncedAt: Date?
    var createdAt: Date?
    var updatedAt: Date?
    var deletedAt: Date?
    // Campos que viven en el modelo iOS (`FocusEvent`) y antes se perdían en
    // el round-trip a la nube por no tener columna: detalle bajo el título y
    // avisos previos. Ver migración 019_focus_events_subtitle_reminders.
    var subtitle: String?
    var reminderOffsets: [Int]?
    var reminderNotes: [String]?

    /// Construye desde `FocusEvent` local más `userId` de sesión.
    init(local event: FocusEvent, userId: UUID) {
        self.id = event.id
        self.userId = userId
        self.title = event.title
        self.notes = event.notes
        self.startTime = event.startTime
        self.endTime = event.endTime
        self.isReminder = event.isReminder == true
        self.inferredDuration = event.inferredDuration == true
        self.section = event.section.rawValue
        self.location = event.location
        self.source = event.effectiveSource.rawValue
        self.externalCalendarId = event.externalCalendarId
        self.externalEventId = event.externalEventId
        self.url = event.url
        self.lastSyncedAt = event.lastSyncedAt
        self.createdAt = nil   // server default
        self.updatedAt = nil   // server-managed via trigger
        self.deletedAt = nil
        self.subtitle = event.subtitle
        self.reminderOffsets = event.reminderOffsets
        self.reminderNotes = event.reminderNotes
    }

    /// Convierte el row remoto a `FocusEvent` local.
    func toLocal() -> FocusEvent? {
        guard let startTime else { return nil }
        let sec: EventSection = EventSection(rawValue: section ?? "") ?? .reunion
        return FocusEvent(
            id: id,
            title: title,
            notes: notes,
            startTime: startTime,
            endTime: endTime,
            section: sec,
            status: .scheduled,
            location: location,
            featured: false,
            linkedTaskIds: [],
            source: EventSource(rawValue: source) ?? .local,
            externalCalendarId: externalCalendarId,
            externalEventId: externalEventId,
            url: url,
            lastSyncedAt: lastSyncedAt,
            isReminder: isReminder ? true : nil,
            inferredDuration: inferredDuration ? true : nil,
            reminderOffsets: reminderOffsets,
            reminderNotes: reminderNotes,
            subtitle: subtitle
        )
    }
}

struct RemoteFocusTask: Codable, Hashable {
    enum CodingKeys: String, CodingKey { case id, userId, title, notes, category, priority, isCompleted, doneAt, dueDate, dueTime, linkedEventId, subtasks, createdAt, updatedAt, deletedAt }

    let id: UUID
    let userId: UUID
    var title: String
    var notes: String?
    var category: String?
    var priority: String?
    var isCompleted: Bool
    var doneAt: Date?
    var dueDate: String?      // YYYY-MM-DD (DATE en Postgres)
    var dueTime: String?      // HH:MM:SS (TIME en Postgres)
    var linkedEventId: UUID?
    var subtasks: [RemoteSubtask]?
    var createdAt: Date?
    var updatedAt: Date?
    var deletedAt: Date?

    struct RemoteSubtask: Codable, Hashable {
        let id: UUID
        var title: String
        var isCompleted: Bool
    }

    init(local task: FocusTask, userId: UUID) {
        self.id = task.id
        self.userId = userId
        self.title = task.title
        self.notes = task.notes
        self.category = task.category.rawValue
        self.priority = task.priority.rawValue
        self.isCompleted = task.done
        self.doneAt = task.doneAt
        if let date = task.dueDate {
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "en_US_POSIX")
            fmt.calendar = Calendar(identifier: .gregorian)
            fmt.dateFormat = "yyyy-MM-dd"
            fmt.timeZone = .current
            self.dueDate = fmt.string(from: date)
        } else {
            self.dueDate = nil
        }
        if let time = task.dueTime {
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "en_US_POSIX")
            fmt.dateFormat = "HH:mm:ss"
            fmt.timeZone = .current
            self.dueTime = fmt.string(from: time)
        } else {
            self.dueTime = nil
        }
        self.linkedEventId = task.linkedEventId
        self.subtasks = task.subtasks.map { sub in
            RemoteSubtask(id: sub.id, title: sub.title, isCompleted: sub.isCompleted)
        }
        self.createdAt = nil
        self.updatedAt = nil
        self.deletedAt = nil
    }

    func toLocal() -> FocusTask {
        let cat = TaskCategory(rawValue: category ?? "") ?? .hoy
        let prio = TaskPriority(rawValue: priority ?? "") ?? .media
        let local = FocusTask(
            id: id,
            title: title,
            notes: notes,
            done: isCompleted,
            doneAt: doneAt,
            priority: prio,
            category: cat,
            dueDate: parseDueDate(),
            dueTime: parseDueTime(),
            subtasks: subtasks?.map { FocusSubtask(id: $0.id, title: $0.title, isCompleted: $0.isCompleted) } ?? [],
            linkedEventId: linkedEventId,
            parentTaskId: nil
        )
        return local
    }

    private func parseDueDate() -> Date? {
        guard let dueDate else { return nil }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = .current
        return fmt.date(from: dueDate)
    }

    private func parseDueTime() -> Date? {
        guard let dueTime else { return nil }
        let parts = dueTime.split(separator: ":")
        guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        let second = parts.count > 2 ? Int(Double(parts[2]) ?? 0) : 0
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar.date(bySettingHour: hour, minute: minute, second: second,
                             of: parseDueDate() ?? Date())
    }
}


/// Injectable boundary for deterministic sync tests. Production uses the REST
/// service; tests provide suspended or failing closures without any real token.
struct FocusSyncTransport {
    var fetchEvents: (String, String) async throws -> [RemoteFocusEvent]
    var fetchTasks: (String, String) async throws -> [RemoteFocusTask]
    var upsertEvent: (RemoteFocusEvent, String) async throws -> Void
    var upsertTask: (RemoteFocusTask, String) async throws -> Void
    var deleteEvent: (UUID, String) async throws -> Void
    var deleteTask: (UUID, String) async throws -> Void

    static let live = FocusSyncTransport(
        fetchEvents: SupabaseSyncService.fetchEvents,
        fetchTasks: SupabaseSyncService.fetchTasks,
        upsertEvent: SupabaseSyncService.upsertEvent,
        upsertTask: SupabaseSyncService.upsertTask,
        deleteEvent: SupabaseSyncService.softDeleteEvent,
        deleteTask: SupabaseSyncService.softDeleteTask
    )
}

extension RemoteFocusEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(title, forKey: .title)
        try container.encode(notes, forKey: .notes)
        try container.encode(startTime, forKey: .startTime)
        try container.encode(endTime, forKey: .endTime)
        try container.encode(isReminder, forKey: .isReminder)
        try container.encode(inferredDuration, forKey: .inferredDuration)
        try container.encode(section, forKey: .section)
        try container.encode(location, forKey: .location)
        try container.encode(source, forKey: .source)
        try container.encode(externalCalendarId, forKey: .externalCalendarId)
        try container.encode(externalEventId, forKey: .externalEventId)
        try container.encode(url, forKey: .url)
        try container.encode(lastSyncedAt, forKey: .lastSyncedAt)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(subtitle, forKey: .subtitle)
        try container.encode(reminderOffsets, forKey: .reminderOffsets)
        try container.encode(reminderNotes, forKey: .reminderNotes)
    }
}

extension RemoteFocusTask {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(title, forKey: .title)
        try container.encode(notes, forKey: .notes)
        try container.encode(category, forKey: .category)
        try container.encode(priority, forKey: .priority)
        try container.encode(isCompleted, forKey: .isCompleted)
        try container.encode(doneAt, forKey: .doneAt)
        try container.encode(dueDate, forKey: .dueDate)
        try container.encode(dueTime, forKey: .dueTime)
        try container.encode(linkedEventId, forKey: .linkedEventId)
        try container.encode(subtasks, forKey: .subtasks)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
    }
}
