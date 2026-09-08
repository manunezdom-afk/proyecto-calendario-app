import XCTest
@testable import Focus

@MainActor
final class NovaExecutionTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("NovaExecutionTests-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
        NovaResponder.testTimeZone = nil
        NovaMemoryStore.shared.reloadForCurrentAccount()
        NovaMemoryStore.shared.clearAll()
    }

    override func tearDown() async throws {
        NovaResponder.testReferenceDate = nil
        NovaResponder.testTimeZone = nil
        FocusLocalStore.testRejectSynchronousWrite = nil
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

    func testMemoryForgetAllAfterStoreRestartRequiresReviewAndPersistsEmptyMemory() throws {
        let original = store()
        original.settings.novaMemoryEnabled = true
        original.sendNovaMessage("Cata es mi polola")
        XCTAssertEqual(NovaMemoryStore.shared.activeMemories.count, 1)
        FocusLocalStore.flush()
        NovaMemoryStore.shared.reloadForCurrentAccount()
        let restored = store()
        restored.settings.novaMemoryEnabled = true
        restored.sendNovaMessage("Qué sabes de mí")
        XCTAssertTrue(restored.novaMessages.last?.content.contains("Cata") == true)
        restored.sendNovaMessage("Olvida todo")
        XCTAssertNotNil(restored.novaPendingProposal)
        XCTAssertEqual(NovaMemoryStore.shared.activeMemories.count, 1)
        restored.confirmNovaProposal()
        XCTAssertNil(restored.novaErrorMessage, restored.novaMessages.map(\.content).joined(separator: "\n"))
        XCTAssertTrue(NovaMemoryStore.shared.lastPersistenceSucceeded)
        XCTAssertTrue(NovaMemoryStore.shared.activeMemories.isEmpty)
        XCTAssertEqual(restored.novaMessages.last?.content, "Listo, borré todas las memorias.")
        NovaMemoryStore.shared.reloadForCurrentAccount()
        XCTAssertTrue(NovaMemoryStore.shared.activeMemories.isEmpty)
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

    func testMultipleGoalsAndReminderOffsetsRequireRemoteInterpretation() {
        for message in ["mañana dentista a las 11 y comprar pan", "mañana dentista a las 11, avísame 30 minutos antes"] {
            let store = store()
            store.sendNovaMessage(message)
            XCTAssertTrue(store.events.isEmpty)
            XCTAssertTrue(store.tasks.isEmpty)
            XCTAssertNotNil(store.novaErrorMessage)
            XCTAssertFalse(NovaLocalRoutingPolicy.decide(message).permitsLocalMutation)
        }
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

extension NovaExecutionTests {
    private var noNetwork: FocusSyncTransport {
        FocusSyncTransport(fetchEvents: { _, _ in throw SupabaseSyncError.network("test offline") },
            fetchTasks: { _, _ in throw SupabaseSyncError.network("test offline") },
            upsertEvent: { _, _ in throw SupabaseSyncError.network("test offline") },
            upsertTask: { _, _ in throw SupabaseSyncError.network("test offline") },
            deleteEvent: { _, _ in throw SupabaseSyncError.network("test offline") },
            deleteTask: { _, _ in throw SupabaseSyncError.network("test offline") })
    }

    func testMovingEventPreservesItsDurationAndSurvivesRestart() throws {
        let store = store()
        let start = try XCTUnwrap(NovaTimeFormatter.resolveDate(dateString: "2027-09-10", timeString: "10:00"))
        let appointment = FocusEvent(title: "Dentista", startTime: start, endTime: start.addingTimeInterval(3600), inferredDuration: false)
        XCTAssertTrue(store.addEvent(appointment))
        let updates = BackendEventUpdates(title: nil, timeString: "12:00", endTimeString: nil,
            dateString: nil, location: nil, reminderOffsets: nil, reminderNotes: nil)
        store.receiveNovaResult(response([.editEvent(id: appointment.id.uuidString, updates: updates)]), userText: "mueve dentista a las 12")
        let saved = try XCTUnwrap(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.events.first)
        XCTAssertEqual(Calendar.current.component(.hour, from: saved.startTime), 12)
        XCTAssertEqual(saved.endTime?.timeIntervalSince(saved.startTime), 3600)
        XCTAssertEqual(store.events.first, saved)
    }

    func testInvalidEventEditRejectsWholeBatchBeforeFirstWrite() throws {
        let store = store()
        let appointment = FocusEvent(title: "Existente", startTime: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970) + 7200))
        XCTAssertTrue(store.addEvent(appointment))
        let updates = BackendEventUpdates(title: nil, timeString: "12:00", endTimeString: nil,
            dateString: "2027-02-30", location: nil, reminderOffsets: nil, reminderNotes: nil)
        store.receiveNovaResult(response([event("Otro"), .editEvent(id: appointment.id.uuidString, updates: updates)]), userText: "crea otro y mueve existente")
        XCTAssertEqual(store.events, [appointment])
        XCTAssertEqual(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.events, [appointment])
        XCTAssertNotNil(store.novaErrorMessage)
    }

    func testLocalDeletionNeverResolvesAReplacementAfterReview() throws {
        let store = store()
        let first = FocusEvent(title: "Gym", startTime: Date().addingTimeInterval(7200))
        XCTAssertTrue(store.addEvent(first))
        store.sendNovaMessage("borra gym")
        XCTAssertNotNil(store.novaPendingProposal)
        XCTAssertTrue(store.deleteEvent(first.id))
        let replacement = FocusEvent(title: "Gym", startTime: first.startTime.addingTimeInterval(86400))
        XCTAssertTrue(store.addEvent(replacement))
        store.confirmNovaProposal()
        XCTAssertEqual(store.events, [replacement])
        XCTAssertNotNil(store.novaErrorMessage)
    }

    func testRemoteDeletionRequiresReviewAgainIfEventChanges() {
        let store = store()
        var appointment = FocusEvent(title: "Dentista", startTime: Date().addingTimeInterval(7200))
        store.addEvent(appointment)
        store.receiveNovaResult(response([.deleteEvent(id: appointment.id.uuidString)]), userText: "borra dentista")
        appointment.title = "Dentista confirmado"
        store.updateEvent(appointment)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events, [appointment])
        XCTAssertTrue(store.novaErrorMessage?.contains("cambiaron") == true)
    }

    func testChatWithoutActionsCannotClaimItSavedATask() {
        let store = store()
        store.receiveNovaResult(response([], mode: .chatOnly, reply: "Listo, creé la tarea."), userText: "comprar pan")
        XCTAssertTrue(store.tasks.isEmpty)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaErrorMessage)
        XCTAssertFalse(store.novaMessages.contains { $0.content == "Listo, creé la tarea." })
        XCTAssertFalse(NovaService.claimsExecutedMutation("Podemos pensar juntos cómo organizarlo."))
        XCTAssertFalse(NovaService.claimsExecutedMutation("El proyecto Nova sigue pendiente."))
    }

    func testLegacyToggleReplayIsSkippedAfterRestartUsingAtomicReceipt() throws {
        let store = store()
        let task = FocusTask(title: "Comprar pan")
        XCTAssertTrue(store.addTask(task))
        let id = UUID().uuidString
        let result = NovaService.Result(reply: "Preparé el cambio", actions: [.toggleTask(id: task.id.uuidString)],
            smartActionsBlocked: false, smartActionsMessage: nil, confidence: 1, shouldAskUser: false,
            mode: .chatWithAction, proposedActions: [], requestId: id)
        store.receiveNovaResult(result, userText: "completa comprar pan")
        XCTAssertEqual(store.tasks.first?.done, true)
        let persisted = try XCTUnwrap(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot))
        XCTAssertTrue(persisted.novaAppliedActionIDs?.contains(id.lowercased() + ":0") == true)
        let restarted = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        restarted.receiveNovaResult(result, userText: "completa comprar pan")
        XCTAssertEqual(restarted.tasks.first?.done, true)
        XCTAssertEqual(restarted.tasks.count, 1)
    }

    func testExplicitTaskCompletionIsIdempotentAndEditingCanRemoveItsDate() throws {
        let store = store()
        let task = FocusTask(title: "Informe", dueDate: Date(), dueTime: Date())
        XCTAssertTrue(store.addTask(task))
        for _ in 0..<2 {
            store.receiveNovaResult(response([.completeTask(id: task.id.uuidString, done: true)]), userText: "completa informe")
        }
        XCTAssertEqual(store.tasks.first?.done, true)
        store.receiveNovaResult(response([.editTask(id: task.id.uuidString,
            updates: BackendTaskUpdates(label: "Informe final", clearsDate: true))]), userText: "informe final sin fecha")
        XCTAssertEqual(store.tasks.first?.title, "Informe final")
        XCTAssertNil(store.tasks.first?.dueDate)
        XCTAssertNil(store.tasks.first?.dueTime)
        let saved = FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.tasks.first
        XCTAssertEqual(saved?.title, "Informe final")
        XCTAssertEqual(saved?.done, true)
        XCTAssertNil(saved?.dueDate)
    }

    func testDiskFailureCannotAcknowledgeAnActionOrItsReceipt() throws {
        let store = store()
        let task = FocusTask(title: "Informe")
        XCTAssertTrue(store.addTask(task))
        FocusLocalStore.flush()
        let guest = directory.appendingPathComponent("guest")
        try FileManager.default.removeItem(at: guest)
        try Data("blocked directory".utf8).write(to: guest)
        let result = NovaService.Result(reply: "Completado", actions: [.completeTask(id: task.id.uuidString, done: true)],
            smartActionsBlocked: false, smartActionsMessage: nil, confidence: 1, shouldAskUser: false,
            mode: .chatWithAction, proposedActions: [], requestId: UUID().uuidString)
        store.receiveNovaResult(result, userText: "completa informe")
        XCTAssertEqual(store.tasks.first?.done, false)
        XCTAssertNotNil(store.localSaveError)
        XCTAssertNotNil(store.novaErrorMessage)
        XCTAssertFalse(store.novaMessages.last?.content.contains("Completé") == true)
    }

    func testLogicalRequestIdentitySurvivesRestartAndIsScopedToAccountAndText() throws {
        let store = store()
        let first = try XCTUnwrap(store.prepareNovaRequestID(for: "Compra pan"))
        let restarted = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        XCTAssertEqual(restarted.prepareNovaRequestID(for: "Compra pan"), first)
        XCTAssertNotEqual(restarted.prepareNovaRequestID(for: "Compra leche"), first)
        FocusLocalStore.activateAccount(UUID())
        XCTAssertNotEqual(restarted.prepareNovaRequestID(for: "Compra pan"), first)
        FocusLocalStore.activateAccount(nil)
    }

    func testTimeoutRetryReusesIdentityAndPersistsOnlyVerifiedActions() async throws {
        var requests: [NovaService.Request] = []
        let failed = expectation(description: "timeout returned")
        let retried = expectation(description: "retry returned")
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { request in
            requests.append(request)
            if requests.count == 1 { failed.fulfill(); throw NovaServiceError.timeout }
            retried.fulfill()
            return NovaService.Result(reply: "Preparé la tarea", actions: [.addTask(BackendTaskCreate(label: "Pan", priority: nil, category: nil, linkedEventId: nil, parentTaskId: nil))], smartActionsBlocked: false,
                smartActionsMessage: nil, confidence: 1, shouldAskUser: false, mode: .chatWithAction,
                proposedActions: [], requestId: request.requestID.uuidString)
        })
        store.settings.novaMemoryEnabled = false
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("añade comprar pan")
        await fulfillment(of: [failed], timeout: 3)
        for _ in 0..<20 where store.isNovaTyping { await Task.yield() }
        XCTAssertTrue(store.tasks.isEmpty)
        XCTAssertNotNil(store.novaLastFailedInput)
        store.retryNovaMessage()
        await fulfillment(of: [retried], timeout: 3)
        for _ in 0..<20 where store.isNovaTyping { await Task.yield() }
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests.first?.requestID, requests.last?.requestID)
        XCTAssertEqual(store.tasks.count, 1)
        XCTAssertEqual(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.tasks, store.tasks)
    }

    func testCancelledLateResponseCannotWriteIntoAnotherGeneration() async throws {
        let started = expectation(description: "request started")
        var resume: CheckedContinuation<NovaService.Result, Never>?
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { _ in
            await withCheckedContinuation { continuation in resume = continuation; started.fulfill() }
        })
        store.settings.novaMemoryEnabled = false
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("añade comprar pan")
        await fulfillment(of: [started], timeout: 3)
        store.cancelNovaRequest()
        let before = store.novaMessages
        resume?.resume(returning: response([event()]))
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.novaMessages, before)
    }

    func testMorningPeriodAndLaterWeekdayDoNotBecomeTomorrow() throws {
        let timezone = try XCTUnwrap(TimeZone(identifier: "America/Santiago"))
        let now = try XCTUnwrap(NovaTimeFormatter.resolveDate(dateString: "2027-09-07", timeString: "06:00", timezone: timezone))
        NovaResponder.testReferenceDate = now
        NovaResponder.testTimeZone = timezone
        defer { NovaResponder.testReferenceDate = nil; NovaResponder.testTimeZone = nil }
        let calendar = NovaTimeFormatter.calendar(timezone: timezone)
        for (text, day) in [("dentista esta mañana a las 10", 7), ("dentista el lunes en la mañana a las 9", 13)] {
            guard case .createEvent(_, let date, _, _, _, _, _, _, _) = NovaResponder.parse(text), let date else {
                return XCTFail("Expected a dated event: \(text)")
            }
            XCTAssertEqual(calendar.component(.day, from: date), day, text)
        }
    }

    func testInvalidDatesAndDSTGapOrFoldRequireClarification() throws {
        let zone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        XCTAssertNil(NovaTimeFormatter.resolveDate(dateString: "2027-03-14", timeString: "02:30", timezone: zone))
        XCTAssertNil(NovaTimeFormatter.resolveDate(dateString: "2027-11-07", timeString: "01:30", timezone: zone))
        XCTAssertNotNil(NovaTimeFormatter.resolveDate(dateString: "2027-03-14", timeString: "03:30", timezone: zone))
        XCTAssertNil(NovaTimeFormatter.resolveDate(dateString: "2027-02-30", timeString: "09:00", timezone: zone))
        NovaResponder.testTimeZone = zone
        defer { NovaResponder.testTimeZone = nil }
        for phrase in ["dentista el 31 de febrero a las 10", "dentista 2027-02-30 a las 10", "dentista mañana a las 10:99", "dentista 2027-03-14 a las 02:30 am"] {
            guard case .clarify = NovaResponder.parse(phrase) else { return XCTFail("Must clarify: \(phrase)") }
        }
    }

    func testAbsoluteDateAndSequentialDateInheritance() throws {
        let calendar = NovaTimeFormatter.calendar()
        NovaResponder.testReferenceDate = calendar.date(from: DateComponents(year: 2027, month: 9, day: 7, hour: 6))
        defer { NovaResponder.testReferenceDate = nil }
        let intents = NovaResponder.parseAll("hoy dentista a las 10 y luego gimnasio a las 11 y luego mañana estudiar a las 15")
        XCTAssertEqual(intents.count, 3)
        let days = intents.compactMap { intent -> Int? in
            guard case .createEvent(_, let date, _, _, _, _, _, _, _) = intent, let date else { return nil }
            return calendar.component(.day, from: date)
        }
        XCTAssertEqual(days, [7, 7, 8])
        guard case .createEvent(_, let date, _, _, _, _, _, _, _) = NovaResponder.parse("dentista el 18 de septiembre de 2027 a las 10"), let date else { return XCTFail("Expected absolute date") }
        XCTAssertEqual(calendar.component(.day, from: date), 18)
        XCTAssertEqual(calendar.component(.month, from: date), 9)
    }

    func testSensitiveCasualDisclosureCannotCreateMemoryLocallyOrRemotely() {
        let store = store()
        store.settings.novaMemoryEnabled = true
        NovaMemoryStore.shared.reloadForCurrentAccount()
        NovaMemoryStore.shared.clearAll()
        store.sendNovaMessage("Ana es mi psicóloga")
        XCTAssertTrue(NovaMemoryStore.shared.activeMemories.isEmpty)
        XCTAssertTrue(store.tasks.isEmpty)
        store.receiveNovaResult(response([.saveMemory(key: "Ana", value: "mi psicóloga", category: "person_alias")]), userText: "Ana es mi psicóloga")
        XCTAssertTrue(NovaMemoryStore.shared.activeMemories.isEmpty)
        XCTAssertNil(NovaMemoryStore.shared.tryLearnFromUserText("prefiero que mi contraseña sea secreta"))
    }

    func testRelevantMemoryDoesNotUploadUnrelatedSensitiveContext() {
        let memory = NovaMemoryStore.shared
        memory.reloadForCurrentAccount()
        memory.clearAll()
        memory.upsert(NovaMemory(category: .personAlias, key: "ana", value: "Ana (psicóloga)"))
        memory.upsert(NovaMemory(category: .projectContext, key: "informe", value: "El informe trimestral se entrega a dirección"))
        memory.upsert(NovaMemory(category: .courseAlias, key: "historia", value: "Historia contemporánea"))
        let context = memory.contextForRequest("preparar informe trimestral")
        XCTAssertEqual(context.count, 1)
        XCTAssertTrue(context.first?.contains("informe") == true)
        XCTAssertFalse(context.joined().contains("psicóloga"))
        XCTAssertFalse(context.joined().contains("Historia"))
    }

    func testMemoryWriteFailureDoesNotClaimItLearnedOrLosePreviousMemory() throws {
        let store = store()
        store.settings.novaMemoryEnabled = true
        let memory = NovaMemoryStore.shared
        memory.reloadForCurrentAccount()
        memory.clearAll()
        memory.upsert(NovaMemory(category: .courseAlias, key: "historia", value: "Historia contemporánea"))
        FocusLocalStore.flush()
        let guest = directory.appendingPathComponent("guest")
        try FileManager.default.removeItem(at: guest)
        try Data("blocked".utf8).write(to: guest)
        store.sendNovaMessage("Juan es mi coordinador")
        XCTAssertNotNil(store.novaErrorMessage)
        XCTAssertEqual(memory.activeMemories.map(\.key), ["historia"])
        XCTAssertFalse(store.novaMessages.last?.content.contains("ya sé") == true)
    }

    func testLegacyParserBatteryReportsFailuresAsXCTestAssertions() {
        let report = NovaActionNormalizerTests.runAll()
        XCTAssertEqual(report, "✓ ALL TESTS PASSED", report)
    }
}


extension NovaExecutionTests {
    func testPendingDentistAcceptsExactMorningReplyFromUI() {
        let calendar = NovaTimeFormatter.calendar()
        let day = calendar.startOfDay(for: Date())
        NovaResponder.testReferenceDate = calendar.date(bySettingHour: 8, minute: 0, second: 0, of: day)
        let store = store()
        store.sendNovaMessage("Ponme dentista")
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.novaContext.pendingClarification?.proposedTitle, "Dentista", store.novaMessages.map(\.content).joined(separator: "\n"))
        store.sendNovaMessage("A las 11 de la mañana")
        XCTAssertEqual(store.events.count, 1, store.novaMessages.map(\.content).joined(separator: "\n"))
        XCTAssertEqual(store.events.first?.title, "Dentista")
        XCTAssertEqual(store.events.first.map { calendar.component(.hour, from: $0.startTime) }, 11)
        XCTAssertEqual(store.events.first.map { calendar.startOfDay(for: $0.startTime) }, day)
    }

    func testPastMorningReplyAsksForDayAndHonorsEachExplicitChoice() throws {
        let calendar = NovaTimeFormatter.calendar()
        let day = calendar.startOfDay(for: Date())
        NovaResponder.testReferenceDate = try XCTUnwrap(calendar.date(bySettingHour: 14, minute: 0, second: 0, of: day))
        for (reply, dayOffset) in [("hoy", 0), ("mañana", 1)] {
            let store = store()
            store.sendNovaMessage("Ponme dentista")
            store.sendNovaMessage("A las 11 de la mañana")
            XCTAssertTrue(store.events.isEmpty, "A past hour without a day must not create tomorrow silently")
            XCTAssertEqual(store.novaContext.pendingClarification?.missingFields, [.date])
            XCTAssertEqual(store.novaContext.pendingClarification?.proposedTitle, "Dentista")
            XCTAssertTrue(store.novaMessages.last?.content.contains("hoy o mañana") == true)
            store.sendNovaMessage("sí")
            XCTAssertTrue(store.events.isEmpty, "An affirmative answer does not choose a missing day")
            store.sendNovaMessage(reply)
            let saved = try XCTUnwrap(store.events.first, store.novaMessages.map(\.content).joined(separator: "\n"))
            XCTAssertEqual(store.events.count, 1)
            XCTAssertEqual(saved.title, "Dentista")
            XCTAssertEqual(calendar.component(.hour, from: saved.startTime), 11)
            XCTAssertEqual(calendar.startOfDay(for: saved.startTime), calendar.date(byAdding: .day, value: dayOffset, to: day))
        }
    }

    func testPastNineAMClarificationKeepsNineAsAnExplicitTime() throws {
        let calendar = NovaTimeFormatter.calendar()
        let day = calendar.startOfDay(for: Date())
        NovaResponder.testReferenceDate = calendar.date(bySettingHour: 14, minute: 0, second: 0, of: day)
        let store = store()
        store.sendNovaMessage("Ponme dentista")
        store.sendNovaMessage("A las 9 de la mañana")
        XCTAssertTrue(store.events.isEmpty)
        store.sendNovaMessage("mañana")
        let saved = try XCTUnwrap(store.events.first)
        XCTAssertEqual(calendar.component(.hour, from: saved.startTime), 9)
        XCTAssertEqual(calendar.startOfDay(for: saved.startTime), calendar.date(byAdding: .day, value: 1, to: day))
    }

    func testRemoteExplicitPastDateIsNeverShiftedDuringPersistence() throws {
        let store = store()
        let payload = BackendEventCreate(title: "Dentista", timeString: "11:00 AM", endTimeString: "12:00 PM",
            dateString: "2001-09-10", section: nil, icon: "event", reminderOffsets: nil,
            reminderNotes: nil, location: nil, notes: nil, subtitle: nil)
        let outcome = store.applyBackendActions([.addEvent(payload)], userText: "dentista de 11 am a 12 pm")
        XCTAssertTrue(outcome.didMutate)
        let saved = try XCTUnwrap(store.events.first)
        XCTAssertEqual(saved.startTime, NovaTimeFormatter.resolveDate(dateString: "2001-09-10", timeString: "11:00 AM"))
        XCTAssertEqual(saved.endTime, NovaTimeFormatter.resolveDate(dateString: "2001-09-10", timeString: "12:00 PM"))
    }

    func testTerminal503ReleasesOnlyTheMatchingCompletedRequestForExplicitRetry() async throws {
        for variant in ["completed", "no_flags", "wrong_id", "incomplete", "no_retry"] {
            var requests: [NovaService.Request] = []
            let failed = expectation(description: variant + " failed")
            let retried = expectation(description: variant + " retried")
            let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { request in
                requests.append(request)
                if requests.count == 1 {
                    var body: [String: Any] = ["error": "assistant_unavailable", "requestId": request.requestID.uuidString]
                    if variant != "no_flags" {
                        body["request_completed"] = variant != "incomplete"
                        body["request_retryable"] = variant != "no_retry"
                    }
                    if variant == "wrong_id" { body["requestId"] = UUID().uuidString }
                    let error = NovaService.unavailableError(from: try JSONSerialization.data(withJSONObject: body), requestID: request.requestID)
                    failed.fulfill()
                    throw error
                }
                retried.fulfill()
                return NovaService.Result(reply: "Podemos seguir", actions: [], smartActionsBlocked: false,
                    smartActionsMessage: nil, confidence: 1, shouldAskUser: false, mode: .chatOnly,
                    proposedActions: [], requestId: request.requestID.uuidString)
            })
            store.settings.novaMemoryEnabled = false
            store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
            NovaAIConsent.grant()
            defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
            store.sendNovaMessage("añade comprar pan")
            await fulfillment(of: [failed], timeout: 3)
            for _ in 0..<20 where store.isNovaTyping { await Task.yield() }
            XCTAssertEqual(requests.count, 1, "No automatic paid retry")
            XCTAssertTrue(store.tasks.isEmpty)
            XCTAssertNotNil(store.novaLastFailedInput)
            store.retryNovaMessage()
            await fulfillment(of: [retried], timeout: 3)
            for _ in 0..<20 where store.isNovaTyping { await Task.yield() }
            XCTAssertEqual(requests.count, 2)
            if variant == "completed" { XCTAssertNotEqual(requests.first?.requestID, requests.last?.requestID) }
            else { XCTAssertEqual(requests.first?.requestID, requests.last?.requestID, variant) }
        }
    }

    func testMorningFollowUpPreservesThePreviouslyRequestedDay() {
        let store = store()
        store.sendNovaMessage("mañana tengo dentista")
        store.sendNovaMessage("a las 11 de la mañana")
        XCTAssertTrue(store.events.first.map { Calendar.current.isDateInTomorrow($0.startTime) } == true,
                      store.novaMessages.map(\.content).joined(separator: "\n"))
    }

    func testSecretsAreNeverLearnedEvenIfUserExplicitlyAsks() {
        let memory = NovaMemoryStore.shared
        for secret in ["PIN", "CVV", "token", "clave privada", "contraseña"] {
            XCTAssertFalse(NovaMemoryPrivacy.canRemember(secret + " 1234", userText: "recuerda que mi " + secret + " es 1234"), secret)
            let validation = NovaActionValidator.validate(actions: [.saveMemory(key: secret, value: "1234", category: "preference")], userText: "mi " + secret + " es 1234")
            XCTAssertTrue(validation.shouldAsk, secret)
            memory.upsert(NovaMemory(category: .preference, key: secret, value: "1234"))
            XCTAssertTrue(memory.contextForRequest(secret).isEmpty, secret)
        }
    }

    func testNonFiniteConfidenceCannotShowAnExecutionClaim() {
        let store = store()
        store.receiveNovaResult(response([], confidence: .nan, reply: "Listo, guardé tu tarea."), userText: "compra pan")
        XCTAssertTrue(store.tasks.isEmpty)
        XCTAssertNotNil(store.novaErrorMessage)
        XCTAssertFalse(store.novaMessages.last?.content == "Listo, guardé tu tarea.")
    }

    func testTimelessEventAndReceiptUseASingleWriteAndReplayDoesNotDuplicate() throws {
        let store = store()
        let payload = BackendEventCreate(title: "Pan", timeString: nil, endTimeString: nil, dateString: "2027-09-10",
            section: nil, icon: nil, reminderOffsets: nil, reminderNotes: nil, location: nil, notes: nil, subtitle: nil)
        var writes = 0
        FocusLocalStore.testRejectSynchronousWrite = { key in
            guard key == .syncSnapshot else { return false }
            writes += 1
            return writes > 1
        }
        defer { FocusLocalStore.testRejectSynchronousWrite = nil }
        let receipt = UUID().uuidString.lowercased() + ":0"
        let outcome = store.applyBackendActions([.addEvent(payload)], userText: "compra pan", actionIDs: [receipt])
        XCTAssertTrue(outcome.didMutate)
        XCTAssertEqual(writes, 1)
        XCTAssertTrue(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)?.novaAppliedActionIDs?.contains(receipt) == true)
        let replay = store.applyBackendActions([.addEvent(payload)], userText: "compra pan", actionIDs: [receipt])
        XCTAssertFalse(replay.didMutate)
        XCTAssertEqual(store.tasks.count, 1)
        XCTAssertEqual(writes, 1)
    }

    func testRecurringSeriesAndReceiptCommitAtomicallyInOneWrite() throws {
        let store = store()
        guard case .addEvent(let payload) = event("Estudiar") else { return XCTFail() }
        let action = BackendAction.addRecurringEvent(payload, BackendRecurrence(pattern: "daily", weekday: nil, count: 3, startDate: "2027-09-10"))
        var writes = 0
        FocusLocalStore.testRejectSynchronousWrite = { key in
            guard key == .syncSnapshot else { return false }
            writes += 1
            return writes > 1
        }
        defer { FocusLocalStore.testRejectSynchronousWrite = nil }
        let receipt = UUID().uuidString.lowercased() + ":0"
        let outcome = store.applyBackendActions([action], userText: "estudiar todos los días a las 11", actionIDs: [receipt])
        XCTAssertTrue(outcome.didMutate)
        XCTAssertEqual(store.events.count, 3)
        XCTAssertEqual(writes, 1)
        let saved = try XCTUnwrap(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot))
        XCTAssertEqual(saved.events.count, 3)
        // This fixture is a guest: persist locally without scheduling uploads
        // against a nonexistent account. Account outbox behavior has its own suite.
        XCTAssertTrue(saved.outbox.mutations.isEmpty)
        XCTAssertTrue(saved.novaAppliedActionIDs?.contains(receipt) == true)
    }

    func testFailedRecurringCommitLeavesNoPartialSeriesOrReceipt() {
        let store = store()
        guard case .addEvent(let payload) = event("Estudiar") else { return XCTFail() }
        let action = BackendAction.addRecurringEvent(payload, BackendRecurrence(pattern: "daily", weekday: nil, count: 3, startDate: "2027-09-10"))
        FocusLocalStore.testRejectSynchronousWrite = { $0 == .syncSnapshot }
        defer { FocusLocalStore.testRejectSynchronousWrite = nil }
        let outcome = store.applyBackendActions([action], userText: "estudiar todos los días a las 11", actionIDs: [UUID().uuidString + ":0"])
        XCTAssertFalse(outcome.didMutate)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.pendingSyncCount, 0)
        XCTAssertTrue(outcome.ignored.contains("persistence_failed"))
        XCTAssertNil(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot))
    }

    func testAnotherLocalGoalAndCompletedChatInvalidateOldRetryIdentity() throws {
        let store = store()
        let first = try XCTUnwrap(store.prepareNovaRequestID(for: "plan anterior"))
        store.sendNovaMessage("comprar leche")
        XCTAssertNotEqual(store.prepareNovaRequestID(for: "plan anterior"), first)
        let chat = try XCTUnwrap(store.prepareNovaRequestID(for: "hola"))
        store.receiveNovaResult(response([], mode: .chatOnly, reply: "Hola, ¿en qué te ayudo?"), userText: "hola")
        XCTAssertNotEqual(store.prepareNovaRequestID(for: "hola"), chat)
    }

    func testManualEditWhileWaitingCannotBeOverwrittenByLatePlan() async throws {
        let started = expectation(description: "request started")
        var continuation: CheckedContinuation<NovaService.Result, Never>?
        var receivedID: UUID?
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { request in
            receivedID = request.requestID
            return await withCheckedContinuation { continuation = $0; started.fulfill() }
        })
        store.settings.novaMemoryEnabled = false
        var appointment = FocusEvent(title: "Dentista", startTime: Date().addingTimeInterval(7200))
        XCTAssertTrue(store.addEvent(appointment))
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        // An open request reaches the remote transport; the delayed result targets this event.
        store.sendNovaMessage("actualiza el título de Dentista")
        await fulfillment(of: [started], timeout: 3)
        appointment.title = "Dentista confirmado manualmente"
        XCTAssertTrue(store.updateEvent(appointment))
        let updates = BackendEventUpdates(title: "Dentista anterior", timeString: nil, endTimeString: nil,
            dateString: nil, location: nil, reminderOffsets: nil, reminderNotes: nil)
        continuation?.resume(returning: NovaService.Result(reply: "Preparé el cambio", actions: [.editEvent(id: appointment.id.uuidString, updates: updates)],
            smartActionsBlocked: false, smartActionsMessage: nil, confidence: 1, shouldAskUser: false,
            mode: .chatWithAction, proposedActions: [], requestId: receivedID?.uuidString))
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(store.events.first?.title, "Dentista confirmado manualmente")
        XCTAssertTrue(store.novaErrorMessage?.contains("cambiaron") == true)
    }

    func testOldOrUnavailableChatRuntimeNeverReceivesPrivateMessage() async throws {
        let invalid: [NovaCapabilityURLProtocol.Fixture] = [
            .init(status: 404, contentType: "text/html", body: "<html>Previous deployment</html>"),
            .init(contentType: "text/html", body: "<html>Sign in</html>"),
            .init(body: #"{"runtime":"previous","chat_provider":"anthropic"}"#),
            .init(body: #"{"runtime":"focus-openai-v1"}"#),
            .init(body: "not json"),
            .init(networkFailure: true)
        ]
        for fixture in invalid {
            NovaCapabilityURLProtocol.configure(fixture)
            let session = capabilitySession()
            defer { session.invalidateAndCancel() }
            do {
                _ = try await NovaService.send(message: "Mensaje privado de prueba", events: [], tasks: [], history: [],
                    accessToken: "synthetic-only", session: session)
                XCTFail("The chat must not reach an incompatible deployment")
            } catch let error as NovaServiceError {
                guard case .runtimeUpdating = error else { return XCTFail("Unexpected error: \(error)") }
                XCTAssertFalse(error.canFallbackToLocal)
                XCTAssertTrue(error.errorDescription?.contains("Estamos actualizando Hilante") == true)
            }
            let calls = NovaCapabilityURLProtocol.requests
            XCTAssertEqual(calls.count, 1)
            XCTAssertEqual(calls.first?.url?.path, "/api/ai-capabilities")
            XCTAssertEqual(calls.first?.httpMethod, "GET")
            XCTAssertNil(calls.first?.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(calls.first?.httpBody)
            XCTAssertNil(calls.first?.httpBodyStream)
            XCTAssertEqual(calls.first?.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            XCTAssertEqual(calls.first?.httpShouldHandleCookies, false)
        }
    }

    func testMatchingRuntimeAllowsChatButRollbackIsCheckedAgain() async throws {
        NovaCapabilityURLProtocol.configure(.init())
        let session = capabilitySession()
        defer { session.invalidateAndCancel() }
        let result = try await NovaService.send(message: "Hola", events: [], tasks: [], history: [],
            accessToken: "synthetic-only", session: session)
        XCTAssertEqual(result.reply, "Podemos continuar.")
        let calls = NovaCapabilityURLProtocol.requests
        XCTAssertEqual(calls.map { $0.httpMethod }, ["GET", "POST"])
        XCTAssertEqual(calls.last?.url?.path, "/api/focus-assistant")
        XCTAssertEqual(calls.last?.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-only")
        XCTAssertLessThanOrEqual(try XCTUnwrap(calls.last?.timeoutInterval), 55)
        NovaCapabilityURLProtocol.configure(.init(body: #"{"runtime":"previous","chat_provider":"deepseek"}"#))
        do {
            _ = try await NovaService.send(message: "Segundo mensaje privado", events: [], tasks: [], history: [],
                accessToken: "synthetic-only", session: session)
            XCTFail("A cached match must not authorize a rolled back deployment")
        } catch let error as NovaServiceError {
            guard case .runtimeUpdating = error else { return XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertEqual(NovaCapabilityURLProtocol.requests.map { $0.httpMethod }, ["GET"])
    }

    func testAutomaticCaptureDoesNotTrustAnUnrequestedDuration() throws {
        let store = store()
        let payload = BackendEventCreate(title: "Dentista", timeString: "11:00", endTimeString: "12:00",
            dateString: "2027-09-10", section: nil, icon: "event", reminderOffsets: nil,
            reminderNotes: nil, location: nil, notes: nil, subtitle: nil)
        store.receiveNovaResult(response([.addEvent(payload)]), userText: "Dentista el 10 de septiembre de 2027 a las 11")
        let saved = try XCTUnwrap(store.events.first)
        XCTAssertEqual(try XCTUnwrap(saved.endTime).timeIntervalSince(saved.startTime), 5 * 60)
        XCTAssertEqual(saved.inferredDuration, true)
    }

    func testServerPlanningProposalPreservesDurationAndWaitsForApproval() async throws {
        let store = store()
        let footballStart = try XCTUnwrap(Calendar.current.date(from: DateComponents(year: 2027, month: 9, day: 10, hour: 20)))
        let football = FocusEvent(title: "Fútbol", startTime: footballStart, endTime: footballStart.addingTimeInterval(3600))
        XCTAssertTrue(store.addEvent(football))
        NovaCapabilityURLProtocol.configure(.init(), chatBody: #"{"reply":"Preparé una propuesta.","mode":"proposal","actions":[],"confidence":1,"proposed_actions":[{"type":"add_event","event":{"title":"Focus","date":"2027-09-10","time":"09:00","endTime":"12:00"}},{"type":"add_event","event":{"title":"Gym","date":"2027-09-10","time":"13:00","endTime":"14:00"}}]}"#)
        let session = capabilitySession()
        defer { session.invalidateAndCancel() }
        let message = "Organiza el 10 de septiembre de 2027 con 3 horas de Focus, 1 hora de Gym y deja mi fútbol a las 20 fijo"
        let result = try await NovaService.send(message: message, events: store.events, tasks: [], history: [],
            accessToken: "synthetic-only", session: session)
        XCTAssertEqual(result.mode, .proposal)
        store.receiveNovaResult(result, userText: message)
        XCTAssertEqual(store.events, [football])
        XCTAssertNotNil(store.novaPendingProposal)
        XCTAssertTrue(store.novaPendingProposal?.actionLabels.contains(where: { $0.contains("09:00–12:00") }) == true)
        XCTAssertTrue(store.novaPendingProposal?.actionLabels.contains(where: { $0.contains("13:00–14:00") }) == true)
        store.confirmNovaProposal()
        XCTAssertNil(store.novaErrorMessage)
        XCTAssertEqual(store.events.count, 3)
        XCTAssertEqual(store.events.first { $0.id == football.id }, football)
        let focus = try XCTUnwrap(store.events.first { $0.title == "Focus" })
        let gym = try XCTUnwrap(store.events.first { $0.title == "Gym" })
        XCTAssertEqual(try XCTUnwrap(focus.endTime).timeIntervalSince(focus.startTime), 3 * 3600)
        XCTAssertEqual(try XCTUnwrap(gym.endTime).timeIntervalSince(gym.startTime), 3600)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 3)
    }

    func testReviewedRecurringProposalShowsItsRangeAndCountBeforeSaving() throws {
        let store = store()
        let payload = BackendEventCreate(title: "Estudiar", timeString: "10:00", endTimeString: "12:00",
            dateString: "2027-09-10", section: nil, icon: "event", reminderOffsets: nil,
            reminderNotes: nil, location: nil, notes: nil, subtitle: nil)
        let recurring = BackendAction.addRecurringEvent(payload, BackendRecurrence(pattern: "daily", weekday: nil, count: 2, startDate: "2027-09-10"))
        store.receiveNovaResult(response([], mode: .proposal, proposed: [recurring]), userText: "Organiza dos sesiones de estudio")
        let label = try XCTUnwrap(store.novaPendingProposal?.actionLabels.first)
        XCTAssertTrue(label.contains("10:00–12:00"))
        XCTAssertTrue(label.contains("cada día"))
        XCTAssertTrue(label.contains("2 próximas"))
        XCTAssertTrue(store.events.isEmpty)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 2)
        XCTAssertTrue(store.events.allSatisfy { $0.endTime?.timeIntervalSince($0.startTime) == 2 * 3600 })
    }

    func testReviewedSingleEventDoesNotExpandIntoAnUnreviewedSeries() throws {
        let store = store()
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event()]), userText: "Dentista todos los viernes a las 11")
        XCTAssertEqual(store.novaPendingProposal?.actionLabels.count, 1)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 1)
    }

    func testPendingCalendarContextIsSeparateAndDecodesReplacementIdentity() async throws {
        let id = UUID().uuidString
        let pending = try XCTUnwrap(NovaService.PendingProposal(id: id, originalRequest: "Organízame la tarde", actions: [event("Estudiar")]))
        XCTAssertNil(NovaService.PendingProposal(id: id, originalRequest: "Organízame", actions: [.deleteEvent(id: UUID().uuidString)]))
        NovaCapabilityURLProtocol.configure(.init(), chatBody: "{\"reply\":\"Preparé el ajuste.\",\"mode\":\"proposal\",\"actions\":[],\"proposed_actions\":[],\"replacesProposalId\":\"\(id)\"}")
        let session = capabilitySession()
        defer { session.invalidateAndCancel() }
        let result = try await NovaService.send(message: "No quiero estudiar después de las 20", events: [], tasks: [], history: [],
            accessToken: "synthetic-only", pendingProposal: pending, session: session)
        XCTAssertEqual(result.replacesProposalId, id)
        let request = try XCTUnwrap(NovaCapabilityURLProtocol.requests.last)
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertTrue((json["events"] as? [Any])?.isEmpty == true)
        let context = try XCTUnwrap(json["pendingProposal"] as? [String: Any])
        XCTAssertEqual(Set(context.keys), ["id", "originalRequest", "actions"])
        XCTAssertEqual(context["id"] as? String, id)
        XCTAssertEqual(context["originalRequest"] as? String, "Organízame la tarde")
        let actions = try XCTUnwrap(context["actions"] as? [[String: Any]])
        XCTAssertEqual(actions.first?["type"] as? String, "add_event")
        XCTAssertNil(actions.first?["reviewedEvent"])
        XCTAssertNil(actions.first?["actionId"])
    }

    func testRefinementRetainsPendingPlanUntilVerifiedReplacementAndApproval() async throws {
        let started = expectation(description: "refinement started")
        var continuation: CheckedContinuation<NovaService.Result, Never>?
        var sent: NovaService.Request?
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { request in
            sent = request
            return await withCheckedContinuation { continuation = $0; started.fulfill() }
        })
        store.settings.novaMemoryEnabled = false
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event("Estudiar")]), userText: "Organízame la tarde")
        let original = try XCTUnwrap(store.novaPendingProposal?.id)
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("No quiero estudiar después de las 20")
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(store.novaPendingProposal?.id, original)
        XCTAssertEqual(sent?.pendingProposal?.id, original.uuidString)
        XCTAssertEqual(sent?.pendingProposal?.originalRequest, "Organízame la tarde")
        XCTAssertTrue(sent?.events.isEmpty == true)
        let payload = BackendEventCreate(title: "Estudiar", timeString: "18:00", endTimeString: "20:00",
            dateString: "2027-09-10", section: nil, icon: "event", reminderOffsets: nil,
            reminderNotes: nil, location: nil, notes: nil, subtitle: nil)
        let replacement = NovaService.Result(reply: "Preparé el ajuste.", actions: [], smartActionsBlocked: false,
            smartActionsMessage: nil, confidence: 1, shouldAskUser: false, mode: .proposal,
            proposedActions: [.addEvent(payload)], requestId: sent?.requestID.uuidString,
            replacesProposalId: original.uuidString)
        continuation?.resume(returning: replacement)
        for _ in 0..<30 { await Task.yield() }
        XCTAssertNil(store.novaErrorMessage)
        XCTAssertNotEqual(store.novaPendingProposal?.id, original)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.novaPendingProposal?.actionLabels.first?.contains("18:00–20:00") == true)
        store.confirmNovaProposal()
        let saved = try XCTUnwrap(store.events.first)
        XCTAssertEqual(try XCTUnwrap(saved.endTime).timeIntervalSince(saved.startTime), 2 * 3600)
        store.confirmNovaProposal()
        XCTAssertEqual(store.events.count, 1)
    }

    func testOfflineClarificationAndUnknownReplacementKeepPendingPlan() async throws {
        let failed = expectation(description: "refinement failed")
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { _ in
            failed.fulfill()
            throw NovaServiceError.offline
        })
        store.settings.novaMemoryEnabled = false
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event("Estudiar")]), userText: "Organízame la tarde")
        let original = try XCTUnwrap(store.novaPendingProposal?.id)
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("No quiero estudiar después de las 20")
        await fulfillment(of: [failed], timeout: 3)
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(store.novaPendingProposal?.id, original)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.tasks.isEmpty)
        store.receiveNovaResult(response([], mode: .clarification, reply: "¿Cuánto tiempo quieres estudiar?"), userText: "Ajusta el plan")
        XCTAssertEqual(store.novaPendingProposal?.id, original)
        var stale = response([], mode: .proposal, proposed: [event("Otro plan")])
        stale.replacesProposalId = UUID().uuidString
        store.receiveNovaResult(stale, userText: "Ajusta el plan")
        XCTAssertEqual(store.novaPendingProposal?.id, original)
        store.cancelNovaRequest(preservingProposal: true)
        XCTAssertEqual(store.novaPendingProposal?.id, original)
        XCTAssertTrue(store.events.isEmpty)
    }

    func testTwoRefinementsCarryAcceptedConstraintsOnceAndKeepThemOutOfSavedEvents() async throws {
        let called = expectation(description: "third turn carries both accepted refinements")
        var sent: NovaService.Request?
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { request in
            sent = request; called.fulfill()
            return NovaService.Result(reply: "La propuesta sigue pendiente.", actions: [], smartActionsBlocked: false,
                smartActionsMessage: nil, confidence: 1, shouldAskUser: false, mode: .chatOnly,
                proposedActions: [], requestId: request.requestID.uuidString)
        })
        store.settings.novaMemoryEnabled = false
        let goal = "Organiza mi tarde con estudio y Gym"
        let cutoff = "No quiero estudiar después de las 20"
        let gym = "Mueve Gym a las 17"
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event("Estudiar")]), userText: goal)
        let firstID = try XCTUnwrap(store.novaPendingProposal?.id)
        var first = response([], mode: .proposal, proposed: [event("Estudiar")])
        first.replacesProposalId = firstID.uuidString
        store.receiveNovaResult(first, userText: cutoff)
        let secondID = try XCTUnwrap(store.novaPendingProposal?.id)
        // The server can replay a completed result; it must not append twice.
        store.receiveNovaResult(first, userText: cutoff)
        XCTAssertEqual(store.novaPendingProposal?.id, secondID)
        store.receiveNovaResult(response([], mode: .clarification, reply: "¿A qué hora quieres Gym?"), userText: "Una aclaración no aceptada")
        var second = response([], mode: .proposal, proposed: [event("Estudiar")])
        second.replacesProposalId = secondID.uuidString
        store.receiveNovaResult(second, userText: gym)
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("Muéstrame la propuesta")
        await fulfillment(of: [called], timeout: 3)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(sent?.pendingProposal?.originalRequest, goal + "\n" + cutoff + "\n" + gym)
        XCTAssertTrue(sent?.events.isEmpty == true)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaPendingProposal)
    }

    func testPendingConstraintCapUsesUTF16AndStopsBeforeNetworkWithoutDiscardingPlan() async throws {
        var calls = 0
        let store = FocusDataStore(syncTransport: noNetwork, restoreAccount: false, schedulesNotifications: false, novaTransport: { _ in
            calls += 1
            throw NovaServiceError.offline
        })
        store.settings.novaMemoryEnabled = false
        let goal = "Organiza " + String(repeating: "😀", count: 1990)
        XCTAssertLessThan(goal.count, 4000)
        XCTAssertLessThan(goal.utf16.count, 4000)
        store.receiveNovaResult(response([], mode: .proposal, proposed: [event("Estudiar")]), userText: goal)
        let id = try XCTUnwrap(store.novaPendingProposal?.id)
        store.syncCredentials = .init(accessToken: "test-only", userId: UUID())
        NovaAIConsent.grant()
        defer { store.syncCredentials = nil; store.cancelNovaRequest(); NovaAIConsent.revoke() }
        store.sendNovaMessage("No quiero estudiar después de las 20")
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(store.novaPendingProposal?.id, id)
        XCTAssertTrue(store.novaErrorMessage?.contains("límite de ajustes") == true)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNil(NovaService.PendingProposal(id: id.uuidString, originalRequest: String(repeating: "😀", count: 2001), actions: [event()]))
        XCTAssertEqual(NovaService.PendingProposal.appending("x", to: String(repeating: "a", count: 3998))?.utf16.count, 4000)
        XCTAssertNil(NovaService.PendingProposal.appending("😀", to: String(repeating: "a", count: 3998)))
        // A direct/late response is checked too, even if preflight was skipped.
        var late = response([], mode: .proposal, proposed: [event("Otro")])
        late.replacesProposalId = id.uuidString
        store.receiveNovaResult(late, userText: "No quiero estudiar después de las 20")
        XCTAssertEqual(store.novaPendingProposal?.id, id)
    }

    private func capabilitySession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NovaCapabilityURLProtocol.self]
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

}


/// Synthetic HTTP only: every request, including an unexpected POST, is intercepted.
private final class NovaCapabilityURLProtocol: URLProtocol, @unchecked Sendable {
    struct Fixture {
        var status = 200
        var contentType = "application/json"
        var body = #"{"runtime":"focus-openai-v1","chat_provider":"openai"}"#
        var networkFailure = false
    }
    private static let lock = NSLock()
    private static var fixture = Fixture()
    private static var chatBody = ""
    private static var recorded: [URLRequest] = []

    static func configure(_ value: Fixture, chatBody: String = #"{"reply":"Podemos continuar.","mode":"chat_only","actions":[],"proposed_actions":[]}"#) {
        lock.lock(); defer { lock.unlock() }
        fixture = value
        self.chatBody = chatBody
        recorded = []
    }
    static var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
    private static func next(_ request: URLRequest) -> Fixture {
        lock.lock(); defer { lock.unlock() }
        var captured = request
        if captured.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            captured.httpBody = data
        }
        recorded.append(captured)
        return request.url?.path == "/api/ai-capabilities" ? fixture : Fixture(body: chatBody)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let value = Self.next(request)
        if value.networkFailure {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: value.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": value.contentType])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(value.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}


@MainActor
final class FocusExperienceRefinementTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("FocusExperience-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
    }
    override func tearDown() async throws {
        FocusLocalStore.flush()
        try? FileManager.default.removeItem(at: directory)
    }
    func testColloquialVariantsCannotBeCapturedByLocalParserEvenWithPendingContext() {
        let variants = ["salgo a la casa de un amigo en 20", "en 20 minutos me voy donde un amigo",
            "en un rato tengo que ir donde el mati", "tipo 8 voy a la casa de la fran",
            "mañana después de almuerzo voy donde un amigo", "a las 9 salgo pa donde la vale",
            "en media hora me voy a fútbol", "en 15 tengo que salir al dentista"]
        for message in variants {
            XCTAssertFalse(NovaLocalRoutingPolicy.decide(message).permitsLocalMutation, message)
            XCTAssertFalse(NovaLocalRoutingPolicy.decide(message, hasPendingClarification: true).permitsLocalMutation, message)
        }
        XCTAssertTrue(NovaLocalRoutingPolicy.decide("gym mañana 18:00").permitsLocalMutation)
        XCTAssertFalse(NovaLocalRoutingPolicy.decide("quizás gym mañana 18:00").permitsLocalMutation)
        let store = FocusDataStore()
        store.sendNovaMessage(variants[0])
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertNotNil(store.novaErrorMessage)
    }
    func testSemanticPresentationPreservesProperNamesAndDoesNotInventDescription() {
        let result = NovaActionNormalizer.semanticPresentation(title: " Ir a casa de Fran ", subtitle: nil)
        XCTAssertEqual(result.title, "Ir a casa de Fran"); XCTAssertNil(result.subtitle)
        XCTAssertNil(NovaActionNormalizer.semanticPresentation(title: "Dentista", subtitle: " dentista ").subtitle)
        XCTAssertEqual(NovaActionNormalizer.semanticPresentation(title: "Fútbol", subtitle: "Llevar la camiseta").subtitle, "Llevar la camiseta")
        XCTAssertEqual(NovaActionNormalizer.semanticPresentation(title: "Como agua para chocolate", subtitle: nil).title, "Como agua para chocolate")
    }
    func testSwipeDeletionUndoAndRelaunchHaveOneDurableIdentity() throws {
        let store = FocusDataStore()
        let event = FocusEvent(title: "Fútbol QA", startTime: Date().addingTimeInterval(7200), section: .entrenamiento)
        XCTAssertTrue(store.addEvent(event))
        let receipt = try XCTUnwrap(store.deleteEventWithUndo(event.id))
        XCTAssertNil(store.deleteEventWithUndo(event.id))
        XCTAssertFalse(FocusDataStore().events.contains { $0.id == event.id })
        XCTAssertTrue(store.undoEventDeletion(receipt)); XCTAssertFalse(store.undoEventDeletion(receipt))
        XCTAssertEqual(FocusDataStore().events.filter { $0.id == event.id }.count, 1)
        let snapshot = try XCTUnwrap(FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot))
        XCTAssertTrue(snapshot.outbox.mutations.isEmpty, "Guest writes persist locally without a cloud owner")
    }
    func testExternalCalendarCannotBeDeletedThroughLocalMutation() {
        let store = FocusDataStore()
        let event = FocusEvent(title: "Calendario externo QA", startTime: Date(), source: .apple)
        XCTAssertTrue(store.addEvent(event))
        XCTAssertFalse(store.deleteEvent(event.id)); XCTAssertNil(store.deleteEventWithUndo(event.id))
        XCTAssertTrue(store.events.contains { $0.id == event.id })
    }
    func testCalendarColorMetadataSurvivesSerializationAndInvalidColorFallsBack() throws {
        var event = FocusEvent(title: "Agenda QA", startTime: Date(), section: .estudio, source: .apple)
        event.externalCalendarColorHex = "D58A38"
        let restored = try JSONDecoder().decode(FocusEvent.self, from: JSONEncoder().encode(event))
        XCTAssertEqual(restored.externalCalendarColorHex, event.externalCalendarColorHex)
        XCTAssertEqual(restored.section, .estudio)
        event.externalCalendarColorHex = "invalid"
        XCTAssertEqual(event.accentColor, event.section.color)
    }
    func testRealAmplitudeHistoryAndInterruptionKeepWordsWithoutRestartingMic() {
        let service = NovaLiveService()
        let uptime = ProcessInfo.processInfo.systemUptime
        service.beginListening(at: uptime)
        let generation = service.sessionGeneration
        service.receiveRecognitionUpdate(text: "En veinte minutos", isFinal: false, error: nil, generation: generation)
        for _ in 0..<9 { service.receiveAudioLevel(0.8, generation: generation, uptime: uptime + 0.1) }
        XCTAssertTrue(service.audioSamples.contains { $0 > 0 })
        service.pauseForInterruption(.audioSession)
        XCTAssertEqual(service.transcript, "En veinte minutos"); XCTAssertEqual(service.state, .idle)
        service.receiveRecognitionUpdate(text: "Tardío", isFinal: true, error: nil, generation: generation)
        XCTAssertEqual(service.transcript, "En veinte minutos")
        service.cancel(); XCTAssertTrue(service.transcript.isEmpty)
        XCTAssertTrue(service.audioSamples.allSatisfy { $0 == 0 })
    }
    func testSilenceAndBackgroundCannotLeaveRecordingActive() {
        let service = NovaLiveService()
        service.beginListening(at: 100)
        service.checkSilence(at: 101)
        XCTAssertTrue(service.isPausedForSilence)
        service.checkSilence(at: 107)
        XCTAssertEqual(service.state, .processing)
        service.pauseForInterruption(.background)
        XCTAssertEqual(service.state, .idle)
        XCTAssertNotNil(service.notice)
        service.cancel()
    }
}
