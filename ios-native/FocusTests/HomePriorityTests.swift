import XCTest
@testable import Focus

@MainActor
final class HomePriorityTests: XCTestCase {
    private var directory: URL!
    private var calendar: Calendar!
    private var now: Date!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("HomePriorityTests-" + UUID().uuidString)
        FocusLocalStore.useTestingDirectory(directory)
        FocusLocalStore.activateAccount(nil)
        calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Santiago"))
        now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 9, day: 9, hour: 14)))
    }

    override func tearDownWithError() throws {
        FocusLocalStore.flush()
        FocusLocalStore.clearAll()
        FocusLocalStore.activateAccount(nil)
        try? FileManager.default.removeItem(at: directory)
    }

    func testPrioritizesUrgencyTodayAndHighWithoutFillingArbitraryTasks() throws {
        let yesterday = try date(day: 8)
        let today = try date(day: 9)
        let tomorrow = try date(day: 10)
        let dueAtFive = try date(day: 9, hour: 17)
        let overdue = FocusTask(title: "Atrasada", priority: .baja, category: .semana, dueDate: yesterday)
        let dueToday = FocusTask(title: "Entrega de hoy", priority: .media, category: .hoy, dueDate: today, dueTime: dueAtFive)
        let high = FocusTask(title: "Llamada importante", priority: .alta, category: .algunDia)
        let chosenToday = FocusTask(title: "Ordenar notas", priority: .media, category: .hoy)
        let someday = FocusTask(title: "Leer algún día", priority: .media, category: .algunDia)
        let futureHigh = FocusTask(title: "Importante pero futura", priority: .alta, category: .semana, dueDate: tomorrow)
        let done = FocusTask(title: "Ya hecha", done: true, priority: .alta, category: .hoy)

        let plan = HomePriorityPlanner.makePlan(
            tasks: [someday, chosenToday, high, dueToday, overdue, futureHigh, done],
            events: [], now: now, calendar: calendar, limit: 3
        )

        XCTAssertEqual(taskTitles(in: plan), ["Atrasada", "Entrega de hoy", "Llamada importante"])
        XCTAssertEqual(plan.totalTaskCount, 4)
        XCTAssertEqual(plan.hiddenTaskCount, 1)
        XCTAssertFalse(plan.items.contains { $0.taskID == someday.id || $0.taskID == futureHigh.id || $0.taskID == done.id })
        XCTAssertEqual(plan.items.map(\.reason), ["Atrasada", "Para hoy · 17:00", "Prioridad alta"])
    }

    func testMergesOverdueReminderAndDoesNotRepeatTaskAlreadyInTodaysAgenda() throws {
        let linkedTask = FocusTask(title: "Preparar reunión", priority: .alta, category: .hoy, linkedEventId: UUID())
        let meeting = FocusEvent(
            id: try XCTUnwrap(linkedTask.linkedEventId),
            title: "Preparar reunión",
            startTime: try date(day: 9, hour: 16),
            endTime: try date(day: 9, hour: 17)
        )
        let reminder = FocusEvent(
            title: "Enviar documento",
            startTime: try date(day: 9, hour: 12),
            isReminder: true
        )
        let independent = FocusTask(title: "Responder correo", priority: .alta, category: .hoy)

        let plan = HomePriorityPlanner.makePlan(
            tasks: [linkedTask, independent], events: [meeting, reminder],
            now: now, calendar: calendar
        )

        XCTAssertEqual(plan.items.count, 2)
        guard case .reminder(let first) = plan.items[0].content else {
            return XCTFail("El aviso vencido debe encabezar la selección")
        }
        XCTAssertEqual(first.id, reminder.id)
        XCTAssertEqual(taskTitles(in: plan), ["Responder correo"])
        XCTAssertFalse(plan.items.contains { $0.taskID == linkedTask.id })
    }

    func testRecommendationAppearsOnlyWhenCurrentUsefulAndNotDuplicated() throws {
        let currentHigh = NovaSuggestion(
            title: "Deja aire antes de la reunión", detail: "Dos bloques están pegados.",
            kind: .break_, priority: .high, suggestedAction: "Reservar una pausa",
            createdAt: try date(day: 9, hour: 13)
        )
        let currentNormal = NovaSuggestion(
            title: "Tienes un hueco", detail: "Hay noventa minutos libres.",
            kind: .schedule, suggestedAction: "Usar el hueco",
            createdAt: try date(day: 9, hour: 12)
        )
        let stale = NovaSuggestion(
            title: "Ayer", detail: "Ya no aplica.", kind: .prep, priority: .high,
            suggestedAction: "Preparar ayer", createdAt: try date(day: 8, hour: 12)
        )
        let task = FocusTask(title: "Pendiente prioritario", priority: .alta, category: .hoy)

        let busyPlan = HomePriorityPlanner.makePlan(
            tasks: [task], events: [], suggestions: [currentNormal, stale, currentHigh],
            now: now, calendar: calendar
        )
        XCTAssertEqual(busyPlan.recommendation?.id, currentHigh.id)

        let quietPlan = HomePriorityPlanner.makePlan(
            tasks: [], events: [], suggestions: [currentNormal, stale],
            now: now, calendar: calendar
        )
        XCTAssertEqual(quietPlan.recommendation?.id, currentNormal.id)

        let duplicate = NovaSuggestion(
            title: "Duplicada", detail: "No debe repetirse.", kind: .task, priority: .high,
            suggestedAction: "Pendiente prioritario", createdAt: try date(day: 9, hour: 13)
        )
        let duplicatePlan = HomePriorityPlanner.makePlan(
            tasks: [task], events: [], suggestions: [duplicate], now: now, calendar: calendar
        )
        XCTAssertNil(duplicatePlan.recommendation)
    }

    func testVisibleMembershipUsesTheSameThreeItemsAsHome() throws {
        let tasks = (0..<5).map { index in
            FocusTask(title: "Pendiente \(index)", priority: .media, category: .hoy)
        }
        let plan = HomePriorityPlanner.makePlan(tasks: tasks, events: [], now: now, calendar: calendar)
        let ids = HomePriorityPlanner.visibleTaskIDs(tasks, now: now, timezone: calendar.timeZone)

        XCTAssertEqual(ids, Set(plan.items.compactMap(\.taskID)))
        XCTAssertEqual(ids.count, 3)
        XCTAssertEqual(plan.hiddenTaskCount, 2)
    }

    func testCompletionPersistsAndRemovesTaskFromHomeAfterRestart() {
        let task = FocusTask(title: "Persistente", priority: .alta, category: .hoy)
        var store: FocusDataStore? = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        store?.events = []
        store?.tasks = []
        store?.settings.notificationsEnabled = false
        XCTAssertTrue(store?.addTask(task) == true)
        XCTAssertTrue(store?.toggleTask(task.id) == true)
        FocusLocalStore.flush()
        store = nil

        let restored = FocusDataStore(restoreAccount: false, schedulesNotifications: false)
        let persisted = restored.tasks.first { $0.id == task.id }
        XCTAssertEqual(persisted?.done, true)
        let plan = HomePriorityPlanner.makePlan(tasks: restored.tasks, events: restored.events, now: now, calendar: calendar)
        XCTAssertFalse(plan.items.contains { $0.taskID == task.id })
    }

    private func date(day: Int, hour: Int = 0) throws -> Date {
        try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour)))
    }

    private func taskTitles(in plan: HomePriorityPlan) -> [String] {
        plan.items.compactMap { item in
            guard case .task(let task) = item.content else { return nil }
            return task.title
        }
    }
}
