import Foundation

/// Versioned, account-scoped local files. Every write replaces one complete JSON
/// document atomically; reads, writes and deletion share the same serial queue.
/// Legacy unscoped UserDefaults remain untouched for explicit recovery: their
/// owner cannot be inferred safely when several accounts have used this phone.
enum FocusLocalStore {
    enum Key: String, CaseIterable {
        case tasks = "focus.v1.tasks"
        case events = "focus.v1.events"
        case suggestions = "focus.v1.suggestions"
        case novaMessages = "focus.v1.novaMessages"
        case settings = "focus.v1.settings"
        case dismissedDemoEvents = "focus.v1.dismissedDemoEvents"
        case dismissedDemoTasks = "focus.v1.dismissedDemoTasks"
        case pendingDeleteEvents = "focus.v1.pendingDeleteEvents"
        case pendingDeleteTasks = "focus.v1.pendingDeleteTasks"
        case syncSnapshot = "focus.v2.syncSnapshot"
    }

    private static let queue = DispatchQueue(label: "me.usefocus.app.localstore.persist", qos: .utility)
    private static var namespace = "guest"
    private static var storageRoot: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Focus/v2", isDirectory: true)

    static func activateAccount(_ userId: UUID?) {
        queue.sync { namespace = userId.map { "account-" + $0.uuidString.lowercased() } ?? "guest" }
    }

    /// Shared by auxiliary stores such as Nova memory. The owner is captured
    /// before enqueuing work so delayed writes cannot enter a different account.
    static func scopedStorageKey(for key: String) -> String {
        queue.sync { "focus.v2.\(namespace).\(key)" }
    }

    static var hasUnassignedLegacyData: Bool {
        Key.allCases.contains { UserDefaults.standard.data(forKey: $0.rawValue) != nil }
            || UserDefaults.standard.data(forKey: "focus.v1.nova.memories") != nil
    }

    private static func fileURL(_ key: Key) -> URL {
        storageRoot.appendingPathComponent(namespace, isDirectory: true)
            .appendingPathComponent(key.rawValue + ".json")
    }

    private static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func save<T: Encodable>(_ value: T, forKey key: Key) {
        let destination = queue.sync { fileURL(key) }
        queue.async {
            do { try write(value, to: destination) }
            catch { debugLog("[FocusLocalStore] save failed: \(error)") }
        }
    }

    /// Returns only after the atomic replacement completes. Used for the
    /// event/task/outbox transaction, so a successful local edit is recoverable.
    @discardableResult
    static func saveSync<T: Encodable>(_ value: T, forKey key: Key) -> Bool {
        queue.sync {
            do { try write(value, to: fileURL(key)); return true }
            catch { debugLog("[FocusLocalStore] save failed: \(error)"); return false }
        }
    }

    static func load<T: Decodable>(_ type: T.Type, forKey key: Key) -> T? {
        queue.sync {
            let url = fileURL(key)
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            do {
                let data = try Data(contentsOf: url)
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                return try decoder.decode(type, from: data)
            } catch {
                // Preserve an unreadable document before a subsequent user
                // edit could replace it. Recovery is possible without guessing.
                let recovery = url.appendingPathExtension("recovery-" + UUID().uuidString)
                try? FileManager.default.copyItem(at: url, to: recovery)
                debugLog("[FocusLocalStore] load failed; recovery copy preserved: \(error)")
                return nil
            }
        }
    }

    static func clear(_ key: Key) {
        queue.sync { try? FileManager.default.removeItem(at: fileURL(key)) }
    }

    static func clearAll() {
        queue.sync {
            for key in Key.allCases { try? FileManager.default.removeItem(at: fileURL(key)) }
        }
    }

    static func legacyRecoverySnapshot() -> FocusSyncSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let events = UserDefaults.standard.data(forKey: Key.events.rawValue)
            .flatMap { try? decoder.decode([FocusEvent].self, from: $0) } ?? []
        let tasks = UserDefaults.standard.data(forKey: Key.tasks.rawValue)
            .flatMap { try? decoder.decode([FocusTask].self, from: $0) } ?? []
        return FocusSyncSnapshot(events: events, tasks: tasks, outbox: FocusSyncOutbox())
    }

    static func guestRecoverySnapshot() -> FocusSyncSnapshot? {
        queue.sync {
            let url = storageRoot.appendingPathComponent("guest", isDirectory: true)
                .appendingPathComponent(Key.syncSnapshot.rawValue + ".json")
            guard let data = try? Data(contentsOf: url) else { return nil }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try? decoder.decode(FocusSyncSnapshot.self, from: data)
        }
    }

    static func flush() { queue.sync {} }

    #if DEBUG
    /// An isolated directory makes persistence tests independent of real data.
    static func useTestingDirectory(_ url: URL) {
        queue.sync { storageRoot = url; namespace = "guest" }
    }
    #endif
}

/// Persistent FIFO with one current operation per entity. A response may only
/// acknowledge the exact revision it uploaded; edits made during an await remain.
struct FocusSyncOutbox: Codable, Equatable {
    enum Entity: String, Codable { case event, task }
    enum Operation: String, Codable { case upsert, delete }
    struct Mutation: Codable, Equatable, Identifiable {
        let id: UUID
        let entity: Entity
        let operation: Operation
        let revision: UUID
    }
    private(set) var mutations: [Mutation] = []

    mutating func enqueue(_ entity: Entity, id: UUID, operation: Operation) {
        mutations.removeAll { $0.entity == entity && $0.id == id }
        mutations.append(Mutation(id: id, entity: entity, operation: operation, revision: UUID()))
    }

    mutating func acknowledge(_ mutation: Mutation) {
        mutations.removeAll { $0 == mutation }
    }

    func contains(_ entity: Entity, id: UUID) -> Bool {
        mutations.contains { $0.entity == entity && $0.id == id }
    }
}

struct FocusSyncSnapshot: Codable {
    var events: [FocusEvent]
    var tasks: [FocusTask]
    var outbox: FocusSyncOutbox
    var recoveryEventIDs: [UUID: UUID]? = nil
    var recoveryTaskIDs: [UUID: UUID]? = nil
}
