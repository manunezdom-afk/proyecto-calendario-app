import XCTest
@testable import Focus

@MainActor
final class FocusDataStoreTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("FocusDataTests-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
    }

    override func tearDown() async throws {
        FocusLocalStore.flush()
        try? FileManager.default.removeItem(at: directory)
    }

    func testOutboxAcknowledgesOnlyUploadedRevision() throws {
        let id = UUID()
        var outbox = FocusSyncOutbox()
        outbox.enqueue(.event, id: id, operation: .upsert)
        let uploaded = try XCTUnwrap(outbox.mutations.first)
        outbox.enqueue(.event, id: id, operation: .delete)
        outbox.acknowledge(uploaded)
        XCTAssertEqual(outbox.mutations.count, 1)
        XCTAssertEqual(outbox.mutations.first?.operation, .delete)
        let decoded = try JSONDecoder().decode(FocusSyncOutbox.self, from: JSONEncoder().encode(outbox))
        XCTAssertEqual(decoded, outbox)
    }

    func testScopedStorageAndClearCannotReplayQueuedWrites() {
        let accountA = UUID(), accountB = UUID()
        FocusLocalStore.activateAccount(accountA)
        FocusLocalStore.save(["Private A"], forKey: .novaMessages)
        FocusLocalStore.clearAll()
        XCTAssertNil(FocusLocalStore.load([String].self, forKey: .novaMessages))
        FocusLocalStore.save(["Private A"], forKey: .novaMessages)
        FocusLocalStore.activateAccount(accountB)
        XCTAssertNil(FocusLocalStore.load([String].self, forKey: .novaMessages))
        FocusLocalStore.saveSync(["Private B"], forKey: .novaMessages)
        FocusLocalStore.activateAccount(accountA)
        XCTAssertEqual(FocusLocalStore.load([String].self, forKey: .novaMessages), ["Private A"])
        FocusLocalStore.activateAccount(nil)
        XCTAssertNil(FocusLocalStore.load([String].self, forKey: .novaMessages))
    }

    func testOfflineCreationSurvivesRestartAndUploadsOnRetry() async throws {
        let fake = SyncFake()
        fake.offline = true
        let account = UUID()
        let store = makeStore(fake)
        store.applyAuthChange(accessToken: "test-only", userId: account)
        let event = FocusEvent(title: "Offline appointment", startTime: Date().addingTimeInterval(7200))
        store.addEvent(event)
        await store.fetchRemoteAndMerge()
        XCTAssertEqual(store.pendingSyncCount, 1)
        XCTAssertEqual(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.events.first?.id, event.id)
        store.applyAuthChange(accessToken: nil, userId: nil)
        XCTAssertTrue(store.events.isEmpty)

        let restarted = makeStore(fake)
        fake.offline = false
        restarted.applyAuthChange(accessToken: "test-only", userId: account)
        XCTAssertEqual(restarted.events.first?.id, event.id)
        await restarted.fetchRemoteAndMerge()
        XCTAssertEqual(restarted.pendingSyncCount, 0)
        XCTAssertEqual(fake.events.first?.id, event.id)
        restarted.applyAuthChange(accessToken: nil, userId: nil)
    }

    func testEditDuringUploadIsSentAfterEarlierRevision() async throws {
        let fake = SyncFake()
        let store = makeStore(fake)
        let account = UUID()
        store.applyAuthChange(accessToken: "test-only", userId: account)
        await store.fetchRemoteAndMerge()
        let started = expectation(description: "first upload started")
        var resume: CheckedContinuation<Void, Never>?
        fake.beforeEventUpload = {
            fake.beforeEventUpload = nil
            await withCheckedContinuation { continuation in
                resume = continuation
                started.fulfill()
            }
        }
        var event = FocusEvent(title: "Original", startTime: Date().addingTimeInterval(7200))
        store.addEvent(event)
        await fulfillment(of: [started], timeout: 3)
        event.title = "Latest edit"
        store.updateEvent(event)
        resume?.resume()
        await store.fetchRemoteAndMerge()
        XCTAssertEqual(fake.uploadedTitles, ["Original", "Latest edit"])
        XCTAssertEqual(store.events.first?.title, "Latest edit")
        XCTAssertEqual(store.pendingSyncCount, 0)
        store.applyAuthChange(accessToken: nil, userId: nil)
    }

    func testResponseFromPreviousAccountCannotRepopulateNewAccount() async throws {
        let fake = SyncFake()
        let accountA = UUID(), accountB = UUID()
        let privateEvent = RemoteFocusEvent(local: FocusEvent(title: "Private A", startTime: Date()), userId: accountA)
        fake.events = [privateEvent]
        let started = expectation(description: "account A fetch suspended")
        var resume: CheckedContinuation<Void, Never>?
        fake.beforeEventFetch = { userID in
            guard userID == accountA.uuidString else { return }
            await withCheckedContinuation { continuation in
                resume = continuation
                started.fulfill()
            }
        }
        let store = makeStore(fake)
        store.applyAuthChange(accessToken: "test-A", userId: accountA)
        await fulfillment(of: [started], timeout: 3)
        let oldGeneration = store.accountGeneration
        store.applyAuthChange(accessToken: "test-B", userId: accountB)
        XCTAssertNotEqual(store.accountGeneration, oldGeneration)
        await store.fetchRemoteAndMerge()
        resume?.resume()
        for _ in 0..<8 { await Task.yield() }
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.syncCredentials?.userId, accountB)
        XCTAssertTrue(fake.uploadedTitles.isEmpty)
        store.applyAuthChange(accessToken: nil, userId: nil)
    }

    func testRemoteTombstoneRemovesLocalRecord() async {
        let fake = SyncFake()
        let store = makeStore(fake)
        let account = UUID()
        var row = RemoteFocusEvent(local: FocusEvent(title: "Removed elsewhere", startTime: Date()), userId: account)
        fake.events = [row]
        store.applyAuthChange(accessToken: "test-only", userId: account)
        await store.fetchRemoteAndMerge()
        XCTAssertEqual(store.events.count, 1)
        row.deletedAt = Date()
        fake.events = [row]
        await store.fetchRemoteAndMerge()
        XCTAssertTrue(store.events.isEmpty)
        store.applyAuthChange(accessToken: nil, userId: nil)
    }

    func testNullableEditsEncodeNullAndServerTimestampsStayOmitted() throws {
        let row = RemoteFocusEvent(local: FocusEvent(title: "Cleared notes", startTime: Date()), userId: UUID())
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(row)) as? [String: Any])
        XCTAssertTrue(json["notes"] is NSNull)
        XCTAssertTrue(json["end_time"] is NSNull)
        XCTAssertTrue(json["reminder_offsets"] is NSNull)
        XCTAssertNil(json["created_at"])
        XCTAssertNil(json["updated_at"])
    }

    func testTaskDateRoundTripPreservesCivilDateAcrossTimezones() throws {
        let previous = NSTimeZone.default
        defer { NSTimeZone.default = previous }
        for zone in ["America/Santiago", "Pacific/Auckland"] {
            NSTimeZone.default = try XCTUnwrap(TimeZone(identifier: zone))
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            let date = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 9, day: 7, hour: 9, minute: 45)))
            let task = FocusTask(title: "Civil deadline", dueDate: date, dueTime: date)
            let row = RemoteFocusTask(local: task, userId: UUID())
            XCTAssertEqual(row.dueDate, "2026-09-07")
            XCTAssertEqual(row.dueTime, "09:45:00")
            let restored = row.toLocal()
            XCTAssertTrue(calendar.isDate(try XCTUnwrap(restored.dueDate), inSameDayAs: date))
            XCTAssertEqual(calendar.component(.hour, from: try XCTUnwrap(restored.dueTime)), 9)
            XCTAssertEqual(calendar.component(.minute, from: try XCTUnwrap(restored.dueTime)), 45)
        }
    }

    func testFailedDiskWriteRollsBackMutationAndOutbox() throws {
        let blockedRoot = directory.appendingPathComponent("not-a-directory")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("occupied".utf8).write(to: blockedRoot)
        FocusLocalStore.useTestingDirectory(blockedRoot)
        let store = makeStore(SyncFake())
        let event = FocusEvent(title: "Must not claim success", startTime: Date())
        XCTAssertFalse(store.addEvent(event))
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.pendingSyncCount, 0)
        XCTAssertNotNil(store.localSaveError)
    }

    func testGuestDataRequiresExplicitImportAndSourceRemainsIntact() async {
        let fake = SyncFake()
        let store = makeStore(fake)
        let event = FocusEvent(title: "Local before login", startTime: Date())
        XCTAssertTrue(store.addEvent(event))
        store.applyAuthChange(accessToken: "test-only", userId: UUID())
        await store.fetchRemoteAndMerge()
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.guestRecoveryCount, 1)
        XCTAssertTrue(store.importGuestDataIntoCurrentAccount())
        await store.fetchRemoteAndMerge()
        XCTAssertEqual(store.events.map(\.title), [event.title])
        XCTAssertNotEqual(store.events.first?.id, event.id)
        XCTAssertEqual(store.guestRecoveryCount, 0)
        XCTAssertTrue(store.importGuestDataIntoCurrentAccount())
        XCTAssertEqual(store.events.count, 1)
        store.applyAuthChange(accessToken: nil, userId: nil)
        XCTAssertEqual(store.events.map(\.id), [event.id])
    }

    func testReminderPlanFiltersPastNegativeAndDuplicateOffsets() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let start = now.addingTimeInterval(600)
        let event = FocusEvent(title: "Planned alert", startTime: start, reminderOffsets: [30, 5, 0, 5, -1])
        XCTAssertEqual(LocalNotificationService.plannedFireDates(for: event, now: now), [start.addingTimeInterval(-300), start])
        let regular = FocusEvent(title: "No alert requested", startTime: start)
        XCTAssertTrue(LocalNotificationService.plannedFireDates(for: regular, now: now).isEmpty)
        let reminder = FocusEvent(title: "At start", startTime: start, isReminder: true)
        XCTAssertEqual(LocalNotificationService.plannedFireDates(for: reminder, now: now), [start])
        XCTAssertTrue(LocalNotificationService.plannedFireDates(for: reminder, now: start).isEmpty)
    }

    func testSettingsWriteFailurePreservesPreviousPreference() throws {
        let blockedRoot = directory.appendingPathComponent("not-a-directory")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("occupied".utf8).write(to: blockedRoot)
        let store = makeStore(SyncFake())
        FocusLocalStore.useTestingDirectory(blockedRoot)
        XCTAssertFalse(store.updateSettings { $0.remindersEnabled = false })
        XCTAssertTrue(store.settings.remindersEnabled)
        XCTAssertNotNil(store.localSaveError)
    }

    func testRecoveryUsesDistinctOwnerIDsAndRemapsRelations() async throws {
        let fake = SyncFake()
        fake.enforceGlobalOwners = true
        let store = makeStore(fake)
        let parent = FocusTask(title: "Parent")
        let eventID = UUID()
        let task = FocusTask(title: "Linked", linkedEventId: eventID, parentTaskId: parent.id)
        let event = FocusEvent(id: eventID, title: "Guest source", startTime: Date(), linkedTaskIds: [task.id])
        XCTAssertTrue(store.addEvent(event))
        XCTAssertTrue(store.addTask(parent))
        XCTAssertTrue(store.addTask(task))
        let accountA = UUID(), accountB = UUID()
        store.applyAuthChange(accessToken: "test-A", userId: accountA)
        XCTAssertTrue(store.importGuestDataIntoCurrentAccount())
        await store.fetchRemoteAndMerge()
        let copiedA = try XCTUnwrap(store.events.first)
        let copiedTaskA = try XCTUnwrap(store.tasks.first { $0.title == "Linked" })
        let copiedParentA = try XCTUnwrap(store.tasks.first { $0.title == "Parent" })
        XCTAssertNotEqual(copiedA.id, event.id)
        XCTAssertEqual(copiedA.linkedTaskIds, [copiedTaskA.id])
        XCTAssertEqual(copiedTaskA.linkedEventId, copiedA.id)
        XCTAssertEqual(copiedTaskA.parentTaskId, copiedParentA.id)
        XCTAssertEqual(store.pendingSyncCount, 0)
        XCTAssertTrue(store.importGuestDataIntoCurrentAccount())
        XCTAssertEqual(store.events.first?.id, copiedA.id)
        store.applyAuthChange(accessToken: nil, userId: nil)
        XCTAssertEqual(store.events.first?.id, event.id)
        store.applyAuthChange(accessToken: "test-B", userId: accountB)
        XCTAssertTrue(store.importGuestDataIntoCurrentAccount())
        await store.fetchRemoteAndMerge()
        let copiedB = try XCTUnwrap(store.events.first)
        XCTAssertNotEqual(copiedB.id, copiedA.id)
        XCTAssertEqual(store.pendingSyncCount, 0)
        XCTAssertEqual(Set(fake.events.map(\.userId)), Set([accountA, accountB]))
        store.applyAuthChange(accessToken: "test-A", userId: accountA)
        await store.fetchRemoteAndMerge()
        XCTAssertEqual(store.events.first?.id, copiedA.id)
        store.applyAuthChange(accessToken: nil, userId: nil)
    }

    func testReminderWindowSelectsNearest64AcrossAllEvents() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let events = (1...80).reversed().map { offset in
            FocusEvent(title: "Alert \(offset)", startTime: now.addingTimeInterval(Double(offset) * 60), isReminder: true)
        }
        let window = LocalNotificationService.plannedWindow(events: events, now: now)
        XCTAssertEqual(window.count, 64)
        XCTAssertEqual(window.first?.fireDate, now.addingTimeInterval(60))
        XCTAssertEqual(window.last?.fireDate, now.addingTimeInterval(64 * 60))
        let reduced = LocalNotificationService.plannedWindow(events: events, now: now, capacity: 60)
        XCTAssertEqual(reduced.count, 60)
        let replenished = LocalNotificationService.plannedWindow(events: events, now: now.addingTimeInterval(60))
        XCTAssertEqual(replenished.first?.fireDate, now.addingTimeInterval(120))
        XCTAssertEqual(replenished.last?.fireDate, now.addingTimeInterval(65 * 60))
    }

    func testTransientRefreshFailureDoesNotRequireLogin() {
        XCTAssertFalse(AuthStore.requiresLogin(after: AuthError.network("offline")))
        XCTAssertFalse(AuthStore.requiresLogin(after: AuthError.unknown("HTTP 503")))
        XCTAssertTrue(AuthStore.requiresLogin(after: AuthError.otpExpired))
    }

    private func makeStore(_ fake: SyncFake) -> FocusDataStore {
        FocusDataStore(syncTransport: fake.transport, restoreAccount: false, schedulesNotifications: false)
    }
}

@MainActor
private final class SyncFake {
    var events: [RemoteFocusEvent] = []
    var tasks: [RemoteFocusTask] = []
    var offline = false
    var enforceGlobalOwners = false
    var uploadedTitles: [String] = []
    var beforeEventUpload: (() async -> Void)?
    var beforeEventFetch: ((String) async -> Void)?

    var transport: FocusSyncTransport {
        FocusSyncTransport(
            fetchEvents: { [self] _, userID in
                if offline { throw SupabaseSyncError.network("offline") }
                await beforeEventFetch?(userID)
                return events.filter { $0.userId.uuidString == userID }
            },
            fetchTasks: { [self] _, userID in
                if offline { throw SupabaseSyncError.network("offline") }
                return tasks.filter { $0.userId.uuidString == userID }
            },
            upsertEvent: { [self] row, _ in
                if offline { throw SupabaseSyncError.network("offline") }
                if enforceGlobalOwners, let existing = events.first(where: { $0.id == row.id }), existing.userId != row.userId {
                    throw SupabaseSyncError.rlsRejected
                }
                uploadedTitles.append(row.title)
                await beforeEventUpload?()
                events.removeAll { $0.id == row.id }
                events.append(row)
            },
            upsertTask: { [self] row, _ in
                if offline { throw SupabaseSyncError.network("offline") }
                if enforceGlobalOwners, let existing = tasks.first(where: { $0.id == row.id }), existing.userId != row.userId {
                    throw SupabaseSyncError.rlsRejected
                }
                tasks.removeAll { $0.id == row.id }
                tasks.append(row)
            },
            deleteEvent: { [self] id, _ in
                if offline { throw SupabaseSyncError.network("offline") }
                events.removeAll { $0.id == id }
            },
            deleteTask: { [self] id, _ in
                if offline { throw SupabaseSyncError.network("offline") }
                tasks.removeAll { $0.id == id }
            }
        )
    }
}
