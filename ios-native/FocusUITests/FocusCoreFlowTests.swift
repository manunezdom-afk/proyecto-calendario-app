import XCTest

final class FocusCoreFlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-fixture"]
        app.launch()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 15))
    }

    private func element(_ id: String) -> XCUIElement {
        let button = app.buttons.matching(identifier: id).firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tab(_ title: String) {
        let button = app.tabBars.buttons[title]
        XCTAssertTrue(button.waitForExistence(timeout: 5), "Falta tab \(title)")
        button.tap()
    }

    private func taskRow(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "task.edit.", title)).firstMatch
    }

    private func createTask(_ title: String) {
        tab("Pendientes")
        element("task.new").tap()
        let field = element("task.title")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText(title)
        element("task.save").tap()
        XCTAssertTrue(taskRow(title).waitForExistence(timeout: 5), app.debugDescription)
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testFirstLaunchHasOneClearStepAndNoFakeData() {
        app.terminate()
        app.launchArguments = ["--ui-testing", "--reset-fixture", "--onboarding"]
        app.launch()
        XCTAssertTrue(element("onboarding.start").waitForExistence(timeout: 10))
        screenshot("Onboarding")
        element("onboarding.start").tap()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Empieza por una cosa."].exists)
        screenshot("Hoy vacío")
        tab("Pendientes")
        XCTAssertTrue(app.staticTexts["Todo en orden"].exists)
    }

    func testLoginRejectsInvalidEmailAndCanReturnToLocalMode() {
        app.terminate()
        app.launchArguments = ["--ui-testing", "--reset-fixture", "--onboarding"]
        app.launch()
        element("onboarding.signIn").tap()
        XCTAssertTrue(element("login.email").waitForExistence(timeout: 5))
        element("login.email").tap()
        element("login.email").typeText("correo-invalido")
        element("login.sendCode").tap()
        XCTAssertTrue(element("login.error").waitForExistence(timeout: 5))
        screenshot("Login sin correo válido")
        if app.buttons["Listo"].exists { app.buttons["Listo"].tap() }
        element("login.local").tap()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 5))
    }

    func testManualTaskPersistsCanBeEditedCompletedAndReopened() {
        createTask("Preparar presentación QA")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task.edit.")).firstMatch
        row.tap()
        let field = element("task.title")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Preparar presentación QA".count) + "Preparar exposición QA")
        element("task.save").tap()
        XCTAssertTrue(taskRow("Preparar exposición QA").waitForExistence(timeout: 5))
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        tab("Pendientes")
        XCTAssertTrue(taskRow("Preparar exposición QA").waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task.complete.")).firstMatch.tap()
        app.segmentedControls.buttons["Completadas"].tap()
        XCTAssertTrue(taskRow("Preparar exposición QA").exists)
        screenshot("Tarea completada")
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task.complete.")).firstMatch.tap()
        app.segmentedControls.buttons["Pendientes"].tap()
        XCTAssertTrue(taskRow("Preparar exposición QA").exists)
    }

    func testTaskDeleteDoesNotReappearAfterRelaunch() {
        createTask("Descartable QA")
        taskRow("Descartable QA").swipeLeft()
        app.buttons["Eliminar"].firstMatch.tap()
        XCTAssertFalse(taskRow("Descartable QA").exists)
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        tab("Pendientes")
        XCTAssertFalse(taskRow("Descartable QA").exists)
    }

    func testCaptureCreatesTaskWithoutRequiringTimeAndSharesHistory() {
        let input = element("capture.input")
        input.tap(); input.typeText("Tengo que estudiar economía mañana")
        element("capture.send").tap()
        XCTAssertTrue(element("capture.result").waitForExistence(timeout: 10))
        screenshot("Resultado de captura")
        tab("Pendientes")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task.edit.")).firstMatch.waitForExistence(timeout: 5))
        tab("Nova")
        XCTAssertTrue(app.staticTexts["Tengo que estudiar economía mañana"].waitForExistence(timeout: 5))
        XCTAssertTrue(element("nova.input").exists)
    }

    func testManualEventRoundTripAndEmptyTitleValidation() {
        tab("Agenda")
        element("event.new").tap()
        XCTAssertTrue(element("event.title").waitForExistence(timeout: 5))
        XCTAssertFalse(element("event.save").isEnabled)
        element("event.title").tap(); element("event.title").typeText("Revisión QA")
        element("event.save").tap()
        XCTAssertTrue(app.staticTexts["Revisión QA"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "event.edit.")).firstMatch.tap()
        XCTAssertTrue(element("event.title").waitForExistence(timeout: 5))
        XCTAssertEqual(element("event.title").value as? String, "Revisión QA")
        screenshot("Editar evento")
        element("event.cancel").tap()
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        tab("Agenda")
        XCTAssertTrue(app.staticTexts["Revisión QA"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "event.options.")).firstMatch.tap()
        app.buttons["Eliminar"].firstMatch.tap()
        XCTAssertFalse(app.staticTexts["Revisión QA"].exists)
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        tab("Agenda")
        XCTAssertFalse(app.staticTexts["Revisión QA"].exists)
    }

    func testNovaKeyboardNavigationAndEmptySend() {
        tab("Nova")
        XCTAssertFalse(element("nova.send").isEnabled)
        element("nova.input").tap()
        element("nova.input").typeText("Tengo que comprar pan")
        XCTAssertTrue(element("nova.send").isHittable)
        screenshot("Nova con teclado")
        element("nova.send").tap()
        XCTAssertTrue(app.staticTexts["Tengo que comprar pan"].waitForExistence(timeout: 5))
        tab("Hoy")
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 5))
        element("today.settings").tap()
        XCTAssertTrue(element("settings.close").waitForExistence(timeout: 5))
        screenshot("Ajustes")
        element("settings.close").tap()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 5))
    }
}
