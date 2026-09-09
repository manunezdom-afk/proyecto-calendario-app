import XCTest

final class HomePriorityUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-fixture"]
        app.launch()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 15))
    }

    func testHomeDoesNotPromoteAnUnscheduledSomedayTaskAndPersistsTheDecision() {
        openTab("Pendientes")
        element("task.new").tap()
        let title = element("task.title")
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Leer cuando tenga tiempo")
        element("task.save").tap()
        openTab("Hoy")

        XCTAssertTrue(element("today.priority.empty").waitForExistence(timeout: 5))
        XCTAssertEqual(priorityRows.count, 0)
        attachScreenshot("Home sin prioridades artificiales")

        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(element("today.priority.empty").waitForExistence(timeout: 10))
    }

    func testHomeShowsOnlyThreePrioritiesAndReplenishesAfterCompletion() {
        openTab("Pendientes")
        for title in ["Cerrar presupuesto", "Enviar propuesta", "Llamar al proveedor", "Revisar contrato"] {
            createHighPriorityTask(title)
        }

        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(priorityRows.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(priorityRows.count, 3)
        XCTAssertTrue(app.buttons["Ver demás pendientes"].exists)
        attachScreenshot("Home con tres prioridades")

        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "today.complete.")).firstMatch.tap()
        XCTAssertEqual(priorityRows.count, 3)
        XCTAssertFalse(app.buttons["Ver demás pendientes"].exists)
    }

    private func createHighPriorityTask(_ title: String) {
        element("task.new").tap()
        let field = element("task.title")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(title)
        let priority = element("task.priority")
        for _ in 0..<3 where !priority.isHittable { app.swipeUp() }
        XCTAssertTrue(priority.isHittable)
        priority.tap()
        let high = app.buttons["Alta"].firstMatch
        XCTAssertTrue(high.waitForExistence(timeout: 5))
        high.tap()
        element("task.save").tap()
        let saved = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "task.edit.", title
        )).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
    }

    private var priorityRows: XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "today.priority.task.open."))
    }

    private func element(_ id: String) -> XCUIElement {
        let button = app.buttons.matching(identifier: id).firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func openTab(_ title: String) {
        let button = app.tabBars.buttons[title]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        if !button.isSelected { button.tap() }
        XCTAssertTrue(button.isSelected)
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
