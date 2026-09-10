import XCTest
import SwiftUI
@testable import Focus

final class HilantePresentationTests: XCTestCase {
    func testReplyLifetimeAndConfirmedReceipt() {
        let now = Calendar.current.startOfDay(for: Date()).addingTimeInterval(12 * 3600)
        var reply = NovaMessage(role: .nova, content: "**Paso siguiente**", timestamp: now)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now), .fresh)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now.addingTimeInterval(90)), .compact)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now.addingTimeInterval(600)), .hidden)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now, contextChanged: true), .hidden)
        reply.actionLabels = ["Tarea guardada"]
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now.addingTimeInterval(89)), .fresh)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: now.addingTimeInterval(90)), .hidden)
    }

    func testMidnightAndFutureTimestampDoNotResurfaceOldAdvice() {
        let midnight = Calendar.current.startOfDay(for: Date())
        let reply = NovaMessage(role: .nova, content: "Hoy", timestamp: midnight.addingTimeInterval(-30))
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: midnight), .hidden)
        XCTAssertEqual(HomeReplyPhase.resolve(reply, now: reply.timestamp.addingTimeInterval(-1)), .hidden)
        XCTAssertEqual(reply.content, "Hoy") // Presentation does not rewrite history.
    }

    func testMarkdownHierarchyListsAndEmphasis() {
        let blocks = HilanteText.blocks("## Plan\n\n**Empieza aquí**\n- Uno\n2. Dos\nSalto\nfinal")
        XCTAssertEqual(blocks.count, 6)
        XCTAssertTrue(blocks[0].heading)
        XCTAssertEqual(blocks[2].marker, "•")
        XCTAssertEqual(blocks[3].marker, "2.")
        let attributed = HilanteText.inline(blocks[1].text)
        XCTAssertEqual(String(attributed.characters), "Empieza aquí")
        XCTAssertTrue(attributed.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    }
}


@MainActor
final class ScheduledCommitmentTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("Commitment-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
        NovaResponder.testReferenceDate = Calendar.current.startOfDay(for: Date()).addingTimeInterval(10 * 3600)
    }
    override func tearDown() async throws {
        NovaResponder.testReferenceDate = nil
        FocusLocalStore.testRejectSynchronousWrite = nil
        FocusLocalStore.flush()
        try? FileManager.default.removeItem(at: directory)
    }
    private func store() -> FocusDataStore {
        FocusDataStore(restoreAccount: false, schedulesNotifications: false, novaTransport: { _ in
            XCTFail("A certified commitment must not call Luna, Terra or Sol")
            throw URLError(.notConnectedToInternet)
        })
    }
    func testConcreteCommitmentsPersistAndKeepActionTitles() throws {
        let cases = [("tengo que salir a las 3:20", "Salir", 15, 20, 0),
                     ("a las 5 tengo que irme", "Salir", 17, 0, 0),
                     ("mañana tengo que estar en la U a las 10", "Estar en la U", 10, 0, 1),
                     ("a las 7 paso a buscar a Juan", "Pasar a buscar a Juan", 19, 0, 0)]
        let subject = store()
        for (message, title, hour, minute, dayOffset) in cases {
            XCTAssertEqual(NovaLocalRoutingPolicy.decide(message).reason, "explicit_scheduled_commitment")
            subject.sendNovaMessage(message)
            let event = try XCTUnwrap(subject.events.first { $0.title == title && Calendar.current.component(.hour, from: $0.startTime) == hour })
            XCTAssertEqual(event.title, title)
            XCTAssertEqual(Calendar.current.component(.hour, from: event.startTime), hour)
            XCTAssertEqual(Calendar.current.component(.minute, from: event.startTime), minute)
            let expected = Calendar.current.date(byAdding: .day, value: dayOffset, to: NovaResponder.referenceNow)!
            XCTAssertTrue(Calendar.current.isDate(event.startTime, inSameDayAs: expected))
            XCTAssertTrue(subject.novaMessages.last?.content.contains(title) == true)
            XCTAssertNil(subject.novaErrorMessage)
        }
        FocusLocalStore.flush()
        let reloaded = store()
        XCTAssertEqual(reloaded.events.count, 4)
        XCTAssertEqual(Set(reloaded.events.map(\.title)), Set(cases.map { $0.1 }))
        subject.sendNovaMessage(cases[0].0)
        XCTAssertEqual(subject.events.count, 4)
    }
    func testQuestionsHypothesesAndReferencesDoNotAuthorizeMutation() {
        let subject = store()
        for message in ["¿tengo que salir a las 3:20?", "si tengo que salir a las 3:20 te aviso",
                        "quizás a las 5 tengo que irme", "mañana podría estar en la U a las 10",
                        "a las 7 paso a buscar a Juan o a Pedro", "tengo que ir ahí a las 5",
                        "no tengo que salir a las 3:20"] {
            XCTAssertFalse(NovaLocalRoutingPolicy.decide(message).permitsLocalMutation, message)
            subject.sendNovaMessage(message)
            XCTAssertTrue(subject.events.isEmpty, message)
            XCTAssertTrue(subject.tasks.isEmpty, message)
        }
    }
    func testCommitmentDoesNotClaimSuccessWhenPersistenceFails() {
        let subject = store()
        FocusLocalStore.testRejectSynchronousWrite = { $0 == .syncSnapshot }
        subject.sendNovaMessage("tengo que salir a las 3:20")
        XCTAssertTrue(subject.events.isEmpty)
        XCTAssertFalse(subject.novaMessages.last?.content.contains("Te dejé") == true)
    }
}

@MainActor
final class HomeReplyPersistenceTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("HomeReply-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
        NovaResponder.testReferenceDate = Calendar.current.startOfDay(for: Date()).addingTimeInterval(10 * 3600)
    }
    override func tearDown() async throws {
        NovaResponder.testReferenceDate = nil
        FocusLocalStore.testRejectSynchronousWrite = nil
        FocusLocalStore.flush()
        try? FileManager.default.removeItem(at: directory)
    }
    private func store() -> FocusDataStore {
        FocusDataStore(syncTransport: .init(fetchEvents: { _, _ in [] }, fetchTasks: { _, _ in [] },
            upsertEvent: { _, _ in }, upsertTask: { _, _ in }, deleteEvent: { _, _ in }, deleteTask: { _, _ in }),
            restoreAccount: false, schedulesNotifications: false, novaTransport: { _ in
            XCTFail("Home presentation must never call AI")
            throw URLError(.notConnectedToInternet)
        })
    }
    func testDismissalKeepsEventTasksHistoryAndOutboxAcrossRelaunch() throws {
        let subject = store()
        _ = subject.addTask(FocusTask(title: "Tarea que se conserva"))
        subject.sendNovaMessage("a las 5 tengo que irme")
        let reply = try XCTUnwrap(subject.homeReply)
        let events = subject.events, tasks = subject.tasks, history = subject.novaMessages
        let outbox = subject.pendingSyncCount
        XCTAssertTrue(subject.dismissHomeReply(reply.id))
        XCTAssertNil(subject.homeReply)
        subject.refreshHomeReply()
        XCTAssertNil(subject.homeReply)
        let restored = store()
        XCTAssertNil(restored.homeReply)
        XCTAssertEqual(restored.homeReplyState?.hiddenReason, .dismissed)
        XCTAssertEqual(restored.events.map(\.id), events.map(\.id))
        XCTAssertEqual(restored.tasks.map(\.id), tasks.map(\.id))
        XCTAssertEqual(restored.novaMessages.map(\.id), history.map(\.id))
        XCTAssertEqual(restored.pendingSyncCount, outbox)
        XCTAssertEqual(Calendar.current.component(.hour, from: try XCTUnwrap(restored.events.first).startTime), 17)
        restored.sendNovaMessage("a las 7 paso a buscar a Juan")
        XCTAssertNotNil(restored.homeReply)
        XCTAssertNotEqual(restored.homeReply?.id, reply.id)
        XCTAssertFalse(restored.dismissHomeReply(reply.id))
        XCTAssertNotNil(restored.homeReply)
    }
    func testNewReplySurvivesReconstructionAndSemanticNoOpSync() throws {
        let subject = store()
        subject.sendNovaMessage("a las 5 tengo que irme")
        let id = try XCTUnwrap(subject.homeReply?.id)
        subject.events[0].lastSyncedAt = Date()
        XCTAssertEqual(subject.homeReply?.id, id)
        XCTAssertEqual(store().homeReply?.id, id)
    }
    func testContextInvalidationCannotResurrectEvenWhenContextIsRestored() throws {
        let subject = store()
        subject.recordInlineNovaTurn(userText: "Hola", assistantReply: "Tu día")
        let original = subject.tasks
        subject.tasks.append(FocusTask(title: "Cambio real"))
        XCTAssertNil(subject.homeReply)
        subject.tasks = original
        XCTAssertNil(subject.homeReply)
        XCTAssertEqual(store().homeReplyState?.hiddenReason, .contextChanged)
    }
    func testExpiryIsTerminalEvenIfClockMovesBackAndHistoryRemains() throws {
        let subject = store()
        subject.recordInlineNovaTurn(userText: "Hola", assistantReply: "Tu día")
        let reply = try XCTUnwrap(subject.homeReply)
        subject.refreshHomeReply(now: reply.timestamp.addingTimeInterval(91))
        XCTAssertEqual(subject.homeReplyPhase, .compact)
        subject.refreshHomeReply(now: reply.timestamp.addingTimeInterval(601))
        XCTAssertNil(subject.homeReply)
        subject.refreshHomeReply(now: reply.timestamp.addingTimeInterval(30))
        XCTAssertNil(subject.homeReply)
        XCTAssertNil(store().homeReply)
        XCTAssertEqual(subject.novaMessages.last?.id, reply.id)
    }
    func testFailedDismissalDoesNotPretendItWasSaved() throws {
        let subject = store()
        subject.recordInlineNovaTurn(userText: "Hola", assistantReply: "Tu día")
        let id = try XCTUnwrap(subject.homeReply?.id)
        FocusLocalStore.testRejectSynchronousWrite = { $0 == .homeReply }
        XCTAssertFalse(subject.dismissHomeReply(id))
        XCTAssertEqual(subject.homeReply?.id, id)
    }
    func testHistoryRemovalAndAccountSwitchCannotPublishOldReplies() throws {
        let subject = store()
        subject.recordInlineNovaTurn(userText: "Hola", assistantReply: "Tu día")
        let id = try XCTUnwrap(subject.homeReply?.id)
        subject.novaMessages.append(NovaMessage(role: .user, content: "Otro mensaje"))
        subject.novaMessages.removeLast()
        XCTAssertNil(subject.homeReply)
        XCTAssertEqual(subject.homeReplyState?.messageID, id)
        subject.applyAuthChange(accessToken: "synthetic", userId: UUID())
        XCTAssertNil(subject.homeReply)
        XCTAssertNil(subject.homeReplyState)
        subject.applyAuthChange(accessToken: nil, userId: nil)
        XCTAssertNil(subject.homeReply)
        XCTAssertEqual(subject.homeReplyState?.messageID, id)
    }
    func testLegacyHistoryIsNeverPromotedOnLaunch() {
        FocusLocalStore.saveSync([NovaMessage(role: .nova, content: "Antigua")], forKey: .novaMessages)
        let subject = store()
        XCTAssertEqual(subject.novaMessages.count, 1)
        XCTAssertNil(subject.homeReply)
    }
}
