import XCTest
@testable import Focus

@MainActor
final class NovaExecutionTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("NovaExecutionTests-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
    }

    override func tearDown() async throws {
        FocusLocalStore.flush()
        FocusLocalStore.clearAll()
        try? FileManager.default.removeItem(at: directory)
    }

    private func store() -> FocusDataStore {
        let store = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        store.events = []
        store.tasks = []
        store.novaMessages = []
        store.settings.notificationsEnabled = false
        store.settings.novaMemoryEnabled = false
        return store
    }

    private func event(_ title: String = "Dentista") -> BackendAction {
        .addEvent(BackendEventCreate(title: title, timeString: "11:00 AM", endTimeString: nil,
            dateString: "2027-09-10", section: nil, icon: "event",
            reminderOffsets: nil, reminderNotes: nil, location: nil, notes: nil, subtitle: nil))
    }

    private func response(_ actions: [BackendAction], mode: NovaService.Mode = .chatWithAction,
                          confidence: Double = 0.95, ask: Bool = false,
                          proposed: [BackendAction] = [], reply: String = "Listo, agendé todo.",
                          blocked: Bool = false, blockedMessage: String? = nil) -> NovaService.Result {
        NovaService.Result(reply: reply, actions: actions,
            smartActionsBlocked: blocked, smartActionsMessage: blockedMessage, confidence: confidence,
            shouldAskUser: ask, mode: mode, proposedActions: proposed, requestId: "test")
    }

    func testExistingConversationKeepsLegacyRoleAndOriginalWordsAfterRebranding() throws {
        let fixture = """
        [
          {"id":"A2C19942-707C-4BD8-9754-6C61F18E9530","role":"user","content":"Mi proyecto se llama Nova","timestamp":"2026-09-07T10:00:00Z","actionLabels":[]},
          {"id":"B2C19942-707C-4BD8-9754-6C61F18E9530","role":"nova","content":"Guardé tu proyecto Nova.","timestamp":"2026-09-07T10:01:00Z","actionLabels":["Proyecto Nova"]}
        ]
        """
        let guest = directory.appendingPathComponent("guest", isDirectory: true)
        try FileManager.default.createDirectory(at: guest, withIntermediateDirectories: true)
        try Data(fixture.utf8).write(to: guest.appendingPathComponent("focus.v1.novaMessages.json"))
        let restored = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        XCTAssertEqual(restored.novaMessages.map(\.role), [.user, .nova])
        XCTAssertEqual(restored.novaMessages.map(\.content), ["Mi proyecto se llama Nova", "Guardé tu proyecto Nova."])
        XCTAssertEqual(restored.novaMessages.last?.actionLabels, ["Proyecto Nova"])
    }

    func testAssistantBrandDoesNotRewriteUserEntitiesInRepliesOrSavedActions() {
        let store = store()
        let answer = response([], mode: .chatOnly, reply: "El proyecto Nova sigue pendiente.")
        store.receiveNovaResult(answer, userText: "¿Cómo va mi proyecto Nova?")
        XCTAssertEqual(store.novaMessages.last?.content, answer.reply)
        store.receiveNovaResult(response([event("Revisar proyecto Nova")]), userText: "Revisar proyecto Nova mañana a las 11")
        XCTAssertEqual(store.events.first?.title, "Revisar proyecto Nova")
        XCTAssertTrue(store.novaMessages.last?.actionLabels.contains(where: { $0.contains("Nova") }) == true)
    }

    func testLegacyQuotaMessageDoesNotRestoreOldBrandOrExecuteActions() {
        let store = store()
        let limited = response([event()], blocked: true, blockedMessage: "Llegaste al límite de Nova.")
        store.receiveNovaResult(limited, userText: "dentista mañana a las 11")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.novaErrorMessage?.contains(AssistantBrand.displayName) == true)
        XCTAssertFalse(store.novaErrorMessage?.contains("Nova") == true)
        XCTAssertEqual(store.novaLastFailedInput, "dentista mañana a las 11")
        let error = NovaServiceError.quotaExceeded(message: "Llegaste al límite de Nova.")
        XCTAssertFalse(error.localizedDescription.contains("Nova"))
    }

    func testHTTP429KeepsQuotaMetadataButDoesNotCallThrottlingAnExhaustedAllowance() {
        let quota = Data(#"{"error":"quota_exceeded","message":"Límite de Nova","action_type":"nova_message","period":"monthly","used":40,"limit":40,"reset_at":"2027-10-01T00:00:00Z"}"#.utf8)
        guard case .quotaExceeded(_, let details) = NovaService.rateLimitError(from: quota) else {
            return XCTFail("Expected an explicit quota")
        }
        XCTAssertEqual(details?.period, "monthly")
        XCTAssertEqual(details?.actionType, "nova_message")
        XCTAssertEqual(details?.resetAt, "2027-10-01T00:00:00Z")
        XCTAssertTrue(details?.displayMessage(now: .distantPast).contains("mensual") == true)
        XCTAssertTrue(details?.displayMessage(now: .distantPast).contains("40 de 40") == true)
        for body in [#"{"error":"rate_limit"}"#, #"{"error":"upstream_rate_limit"}"#, "unavailable"] {
            guard case .rateLimited = NovaService.rateLimitError(from: Data(body.utf8)) else {
                return XCTFail("Throttling must not report an exhausted allowance")
            }
        }
    }

    func testNonExecutableModesNeverMutateEvenIfProviderReturnsActions() {
        for result in [response([event()], mode: .chatOnly), response([event()], mode: .clarification),
                       response([event()], confidence: 0.1), response([event()], ask: true)] {
            let store = store()
            store.receiveNovaResult(result, userText: "dentista mañana a las 11")
            XCTAssertTrue(store.events.isEmpty)
            XCTAssertTrue(store.tasks.isEmpty)
        }
    }

    func testProposalAppliesOnceOnlyAfterConfirmation() {
        let store = store()
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event()]), userText: "dentista a las 11")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaPendingProposal)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 1)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 1)
    }

    func testDestructiveResponseNeedsConfirmationAndUsesActualItemLabel() {
        let store = store()
        store.receiveNovaResult(response([event()]), userText: "dentista a las 11")
        let id = try! XCTUnwrap(store.events.first?.id)
        store.receiveNovaResult(response([.deleteEvent(id: id.uuidString)]), userText: "borra dentista")
        XCTAssertEqual(store.events.count, 1)
        XCTAssertTrue(store.novaPendingProposal?.actionLabels.first?.contains("Dentista") == true)
        store.confirmNovaProposal()
        XCTAssertTrue(store.events.isEmpty)
    }

    func testMalformedActionBlocksBatchAndNeverClaimsItWasSaved() {
        let store = store()
        store.receiveNovaResult(response([event(), .unsupported(typeName: "invalid")]), userText: "dentista a las 11 y otra cosa")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaErrorMessage)
        XCTAssertFalse(store.novaMessages.last?.content.contains("agendé todo") == true)
    }

    func testTaskDeadlineSurvivesAndRepeatingSameTaskDoesNotDuplicate() {
        let store = store()
        let task = BackendTaskCreate(label: "Comprar pan", priority: nil, category: "semana",
            linkedEventId: nil, parentTaskId: nil, dateString: "2027-09-10")
        store.receiveNovaResult(response([.addTask(task)]), userText: "comprar pan antes del viernes")
        store.receiveNovaResult(response([.addTask(task)]), userText: "comprar pan antes del viernes")
        XCTAssertEqual(store.tasks.count, 1)
        XCTAssertEqual(store.tasks.first?.dueDate, NovaTimeFormatter.parseISODate("2027-09-10"))
        XCTAssertNil(store.tasks.first?.dueTime)
    }

    func testStaleReferencePreventsPartialBatch() {
        let store = store()
        store.receiveNovaResult(response([event(), .editEvent(id: UUID().uuidString,
            updates: BackendEventUpdates(title: "Cambio", timeString: nil, endTimeString: nil,
                dateString: nil, location: nil, reminderOffsets: nil, reminderNotes: nil))]),
            userText: "dentista a las 11 y cambia la reunión")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaErrorMessage)
    }

    func testLocationReminderNeverCreatesArbitraryTime() {
        let store = store()
        store.sendNovaMessage("recuérdame pagar cuando llegue a casa")
        XCTAssertTrue(store.tasks.isEmpty)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.novaMessages.last?.content.contains("ubicación") == true)
    }

    func testBusyRejectsRepeatedSendAndCancelClearsProposal() {
        let store = store()
        store.isNovaTyping = true
        store.sendNovaMessage("comprar pan")
        XCTAssertTrue(store.novaMessages.isEmpty)
        store.cancelNovaRequest()
        XCTAssertFalse(store.isNovaTyping)
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event()]), userText: "dentista a las 11")
        store.cancelNovaRequest()
        store.confirmNovaProposal()
        XCTAssertTrue(store.events.isEmpty)
    }

    func testLocalTaskForTomorrowKeepsDateWithoutTime() {
        let store = store()
        store.sendNovaMessage("mañana tengo que estudiar economía")
        XCTAssertEqual(store.tasks.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.tasks.first?.title.localizedCaseInsensitiveContains("economía") == true)
        XCTAssertTrue(store.tasks.first?.dueDate.map(Calendar.current.isDateInTomorrow) == true)
        XCTAssertNil(store.tasks.first?.dueTime)
    }

    func testLocalDeadlineBeforeFriday() {
        let store = store()
        store.sendNovaMessage("tengo que entregar el informe antes del viernes")
        XCTAssertEqual(store.tasks.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertEqual(store.tasks.first?.dueDate.map { Calendar.current.component(.weekday, from: $0) }, 6)
        XCTAssertNil(store.tasks.first?.dueTime)
    }

    func testLocalMixedTaskAndEventCreatesBoth() {
        let store = store()
        store.sendNovaMessage("mañana dentista a las 11 y comprar pan")
        XCTAssertEqual(store.events.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertEqual(store.tasks.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertTrue(store.tasks.first?.title.localizedCaseInsensitiveContains("pan") == true)
        XCTAssertNil(store.tasks.first?.dueTime)
    }

    func testLocalReminderOffsetBelongsToItsEvent() {
        let store = store()
        store.sendNovaMessage("mañana dentista a las 11, avísame 30 minutos antes")
        XCTAssertEqual(store.events.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertEqual(store.events.first?.reminderOffsets, [30])
    }

    func testLocalTimeClarificationCompletesOriginalEvent() {
        let store = store()
        store.sendNovaMessage("mañana tengo dentista")
        XCTAssertTrue(store.events.isEmpty)
        store.sendNovaMessage("a las 11 de la mañana")
        XCTAssertEqual(store.events.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertTrue(store.events.first?.title.localizedCaseInsensitiveContains("dentista") == true, store.events.first?.title ?? "missing")
        XCTAssertEqual(store.events.first.map { Calendar.current.component(.hour, from: $0.startTime) }, 11)
    }

    func testLocalLocationLimitationCanBeResolvedWithTime() {
        let store = store()
        store.sendNovaMessage("recuérdame pagar cuando llegue a casa")
        store.sendNovaMessage("mañana a las 7 de la tarde")
        XCTAssertEqual(store.events.count, 1, store.novaMessages.last?.content ?? "")
        XCTAssertTrue(store.events.first?.title.localizedCaseInsensitiveContains("pagar") == true)
    }

    func testLocalOrganizingAndEmotionalMessagesDoNotCreateItems() {
        let store = store()
        for message in ["ordena mis pendientes", "estoy saturado", "quizás mañana vaya al gimnasio"] {
            store.sendNovaMessage(message)
            XCTAssertTrue(store.events.isEmpty, message)
            XCTAssertTrue(store.tasks.isEmpty, message)
        }
    }

    func testLocalRepeatedTaskDoesNotDuplicate() {
        let store = store()
        store.sendNovaMessage("comprar pan")
        store.sendNovaMessage("comprar pan")
        XCTAssertEqual(store.tasks.count, 1, store.novaMessages.last?.content ?? "")
    }

    func testDisabledMemoryDoesNotLearnFromCapture() {
        let store = store()
        let previous = NovaMemoryStore.shared.activeMemories
        store.sendNovaMessage("Juan es mi jefe")
        XCTAssertEqual(NovaMemoryStore.shared.activeMemories, previous)
    }

    func testVerifiedActionRetainsQuestionForAnotherInstruction() {
        let store = store()
        var result = response([event()])
        result.followUpQuestion = "¿A qué hora quieres ir al gimnasio?"
        store.receiveNovaResult(result, userText: "dentista a las 11 y luego gimnasio")
        XCTAssertEqual(store.events.count, 1)
        XCTAssertEqual(store.novaMessages.last?.content, result.followUpQuestion)
    }

    func testInvalidCalendarDatesAndTimesAreRejected() {
        XCTAssertNil(NovaTimeFormatter.parseISODate("2026-02-30"))
        XCTAssertNil(NovaTimeFormatter.parseISODate("2026-13-10"))
        XCTAssertNotNil(NovaTimeFormatter.parseISODate("2028-02-29"))
        XCTAssertNil(NovaTimeFormatter.parseHourMinute("0 PM"))
        XCTAssertNil(NovaTimeFormatter.parseHourMinute("13 AM"))
        XCTAssertEqual(NovaTimeFormatter.parseHourMinute("12 AM")?.0, 0)
    }
}

/// Permission continuations and recognition callbacks are synthetic; these tests never start audio.
@MainActor
final class NovaDictationLifecycleTests: XCTestCase {
    private func service(
        status: @escaping () async -> NovaLiveService.AuthorizationCombined = { .notDetermined },
        speech: @escaping () async -> Bool = { false },
        microphone: @escaping () async -> Bool = { false }
    ) -> NovaLiveService {
        NovaLiveService(permissions: .init(currentStatus: status, requestSpeech: speech,
                                          requestMicrophone: microphone))
    }

    func testCancelDuringSpeechPermissionDoesNotRequestMicrophone() async {
        let requested = expectation(description: "speech permission suspended")
        var continuation: CheckedContinuation<Bool, Never>?
        var microphoneRequests = 0
        let service = service(speech: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        }, microphone: { microphoneRequests += 1; return true })
        let task = Task { await service.requestAuthorization() }
        await fulfillment(of: [requested], timeout: 1)
        service.cancel()
        continuation?.resume(returning: true)
        let granted = await task.value
        XCTAssertFalse(granted)
        XCTAssertEqual(microphoneRequests, 0)
        XCTAssertEqual(service.state, .idle)
    }

    func testCancelDuringMicrophonePermissionCannotResumeSession() async {
        let requested = expectation(description: "microphone permission suspended")
        var continuation: CheckedContinuation<Bool, Never>?
        let service = service(speech: { true }, microphone: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        })
        let task = Task { await service.requestAuthorization() }
        await fulfillment(of: [requested], timeout: 1)
        service.cancel()
        continuation?.resume(returning: true)
        let granted = await task.value
        XCTAssertFalse(granted)
        XCTAssertEqual(service.state, .idle)
    }

    func testTaskCancellationDuringPermissionStopsBeforeMicrophone() async {
        let requested = expectation(description: "speech permission suspended")
        var continuation: CheckedContinuation<Bool, Never>?
        var microphoneRequests = 0
        let service = service(speech: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        }, microphone: { microphoneRequests += 1; return true })
        let task = Task { await service.requestAuthorization() }
        await fulfillment(of: [requested], timeout: 1)
        task.cancel()
        continuation?.resume(returning: true)
        let granted = await task.value
        XCTAssertFalse(granted)
        XCTAssertEqual(microphoneRequests, 0)
        XCTAssertEqual(service.state, .idle)
    }

    func testCancelledStartCannotActivateAudioAfterAuthorizationLookup() async {
        let requested = expectation(description: "authorization lookup suspended")
        var continuation: CheckedContinuation<NovaLiveService.AuthorizationCombined, Never>?
        let service = service(status: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        })
        let task = Task { await service.start() }
        await fulfillment(of: [requested], timeout: 1)
        service.cancel()
        continuation?.resume(returning: .authorized)
        await task.value
        XCTAssertEqual(service.state, .idle)
        XCTAssertTrue(service.transcript.isEmpty)
    }

    func testDismissedSheetCannotAskPermissionsAfterAuthorizationLookup() async {
        let requested = expectation(description: "authorization lookup suspended")
        var continuation: CheckedContinuation<NovaLiveService.AuthorizationCombined, Never>?
        var speechRequests = 0
        let service = service(status: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        }, speech: { speechRequests += 1; return true })
        let task = Task { await service.beginDictation() }
        await fulfillment(of: [requested], timeout: 1)
        service.cancel()
        continuation?.resume(returning: .notDetermined)
        await task.value
        XCTAssertEqual(speechRequests, 0)
        XCTAssertEqual(service.state, .idle)
    }

    func testDictationCancelledDuringSpeechDialogNeverContinuesToMicrophone() async {
        let requested = expectation(description: "speech permission suspended")
        var continuation: CheckedContinuation<Bool, Never>?
        var microphoneRequests = 0
        let service = service(speech: {
            await withCheckedContinuation { continuation = $0; requested.fulfill() }
        }, microphone: { microphoneRequests += 1; return true })
        let task = Task { await service.beginDictation() }
        await fulfillment(of: [requested], timeout: 1)
        service.cancel()
        continuation?.resume(returning: true)
        await task.value
        XCTAssertEqual(microphoneRequests, 0)
        XCTAssertEqual(service.state, .idle)
    }

    func testSupersededPermissionResultDoesNotOverwriteNewDenial() async {
        let requested = expectation(description: "first speech permission suspended")
        var continuation: CheckedContinuation<Bool, Never>?
        var speechRequests = 0
        let service = service(speech: {
            speechRequests += 1
            if speechRequests == 1 {
                return await withCheckedContinuation { continuation = $0; requested.fulfill() }
            }
            return false
        })
        let first = Task { await service.requestAuthorization() }
        await fulfillment(of: [requested], timeout: 1)
        let secondGranted = await service.requestAuthorization()
        XCTAssertFalse(secondGranted)
        XCTAssertEqual(service.state, .denied)
        continuation?.resume(returning: true)
        let firstGranted = await first.value
        XCTAssertFalse(firstGranted)
        XCTAssertEqual(service.state, .denied)
    }

    func testOldRecognitionFinalAndErrorCannotContaminateNewTranscript() {
        let service = service()
        let oldGeneration = service.sessionGeneration
        service.cancel()
        service.state = .listening
        let currentGeneration = service.sessionGeneration
        service.receiveRecognitionUpdate(text: "Texto nuevo", isFinal: false, error: nil,
                                         generation: currentGeneration)
        service.receiveRecognitionUpdate(text: "Texto viejo", isFinal: true,
            error: NSError(domain: "speech-test", code: 1), generation: oldGeneration)
        XCTAssertEqual(service.transcript, "Texto nuevo")
        XCTAssertEqual(service.state, .listening)
        service.receiveRecognitionUpdate(text: "Texto final", isFinal: true, error: nil,
                                         generation: currentGeneration)
        XCTAssertEqual(service.transcript, "Texto final")
        XCTAssertEqual(service.state, .idle)
        service.receiveRecognitionUpdate(text: "Callback posterior", isFinal: false, error: nil,
                                         generation: currentGeneration)
        XCTAssertEqual(service.transcript, "Texto final")
    }
}
