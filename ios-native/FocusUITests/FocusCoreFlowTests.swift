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
        // A cold simulator can miss the first navigation tap while the native
        // tab bar is settling. Verify selection before interacting with content;
        // this retries navigation only, never a mutation or message submission.
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: button)
        if XCTWaiter.wait(for: [selected], timeout: 3) != .completed { button.tap() }
        XCTAssertTrue(button.isSelected, "No se abrió la pestaña \(title)")
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

    func testSettingsSignInOpensEmailAndCanReturnToWelcome() {
        element("today.settings").tap()
        XCTAssertTrue(element("settings.signIn").waitForExistence(timeout: 5))
        element("settings.signIn").tap()
        XCTAssertTrue(element("login.email").waitForExistence(timeout: 10))
        element("login.back").tap()
        XCTAssertTrue(element("onboarding.start").waitForExistence(timeout: 5))
        XCTAssertFalse(element("login.email").exists)
        element("onboarding.start").tap()
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
        tab("Hilante")
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
        tab("Hilante")
        XCTAssertFalse(element("nova.send").isEnabled)
        element("nova.input").tap()
        element("nova.input").typeText("Tengo que comprar pan")
        XCTAssertTrue(element("nova.send").isHittable)
        screenshot("Hilante con teclado")
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

    private func say(_ message: String) {
        let input = element("nova.input")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText(message)
        element("nova.send").tap()
        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 5))
        XCTAssertTrue(element("nova.send").waitForExistence(timeout: 5))
    }

    func testHilanteLocalConversationCreatesReviewsDeletesAndKeepsHistoryAfterRestart() {
        tab("Hilante")
        say("Dentista hoy a las 11")
        tab("Agenda")
        XCTAssertTrue(app.staticTexts["Dentista"].waitForExistence(timeout: 5))
        tab("Hilante")
        say("Borra lo de dentista")
        XCTAssertTrue(element("nova.confirm").waitForExistence(timeout: 5))
        screenshot("Hilante revisión antes de eliminar")
        // Proposed deletion cannot change the agenda before explicit confirmation.
        tab("Agenda")
        XCTAssertTrue(app.staticTexts["Dentista"].exists)
        tab("Hilante")
        element("nova.confirm").tap()
        XCTAssertFalse(element("nova.confirm").exists)
        tab("Agenda")
        XCTAssertFalse(app.staticTexts["Dentista"].exists)
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        tab("Agenda")
        XCTAssertFalse(app.staticTexts["Dentista"].exists)
        tab("Hilante")
        XCTAssertTrue(app.staticTexts["Borra lo de dentista"].waitForExistence(timeout: 5))
        screenshot("Hilante conversación persistida")
    }

    func testHilanteClarificationKeepsTitleAcrossTurnsAndDuplicateCaptureCreatesOnce() {
        tab("Hilante")
        say("Ponme dentista")
        tab("Agenda")
        XCTAssertFalse(app.staticTexts["Dentista"].exists)
        tab("Hilante")
        say("Hoy a las 11 de la mañana")
        tab("Agenda")
        XCTAssertTrue(app.staticTexts["Dentista"].waitForExistence(timeout: 5))
        tab("Hilante")
        say("Dentista hoy a las 11 de la mañana")
        tab("Agenda")
        XCTAssertEqual(app.staticTexts.matching(identifier: "Dentista").count, 1)
        screenshot("Hilante aclaración sin duplicado")
    }

    func testHilanteMemoryCanBeReadAfterRestartAndForgotten() {
        tab("Hilante")
        say("Cata es mi polola")
        say("Qué recuerdas")
        let memory = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Esto es lo que recuerdo", "Cata")).firstMatch
        XCTAssertTrue(memory.waitForExistence(timeout: 5))
        screenshot("Hilante memoria consultable")
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        tab("Hilante")
        say("Qué sabes de mí")
        XCTAssertTrue(memory.waitForExistence(timeout: 5))
        say("Olvida todo")
        XCTAssertTrue(element("nova.confirm").waitForExistence(timeout: 5))
        element("nova.confirm").tap()
        XCTAssertTrue(app.staticTexts["Listo, borré todas las memorias."].waitForExistence(timeout: 5))
        say("Qué tienes en memoria")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Todavía no tengo nada guardado")).firstMatch.waitForExistence(timeout: 5))
        screenshot("Hilante memoria eliminada")
    }

    func testHomeSwipeDeleteUndoAndRestart() {
        tab("Agenda")
        element("event.new").tap()
        let title = app.textFields["event.title"]
        XCTAssertTrue(app.navigationBars["Nuevo evento"].waitForExistence(timeout: 5))
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        // The medium sheet can expose its field while its presentation is
        // settling. Retry focus only; never retry typing or saving a mutation.
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { title.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        title.typeText("Fútbol gesto QA")
        XCTAssertEqual(title.value as? String, "Fútbol gesto QA")
        element("event.save").tap()
        tab("Hoy")
        // The row identifier is inherited by its hour label and button.
        // Swipe the containing native cell, not the first 49-point text child.
        let row = app.cells.containing(.staticText, identifier: "Fútbol gesto QA").firstMatch
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        screenshot("Agenda con color semántico")
        let swipeStart = row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        let swipeEnd = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        swipeStart.press(forDuration: 0.1, thenDragTo: swipeEnd)
        let delete = app.buttons["Eliminar"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 3))
        screenshot("Swipe parcial con Eliminar")
        delete.tap()
        XCTAssertTrue(element("today.undoDelete").waitForExistence(timeout: 5))
        screenshot("Borrado con Deshacer")
        element("today.undoDelete").tap()
        XCTAssertTrue(app.staticTexts["Fútbol gesto QA"].waitForExistence(timeout: 5))
        let restored = app.cells.containing(.staticText, identifier: "Fútbol gesto QA").firstMatch
        screenshot("Evento restaurado")
        let fullSwipeStart = restored.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5))
        let fullSwipeEnd = restored.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        fullSwipeStart.press(forDuration: 0.1, thenDragTo: fullSwipeEnd)
        XCTAssertTrue(element("today.undoDelete").waitForExistence(timeout: 5))
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        XCTAssertFalse(app.staticTexts["Fútbol gesto QA"].exists)
        tab("Agenda")
        XCTAssertFalse(app.staticTexts["Fútbol gesto QA"].exists)
    }

    func testCompactVoiceCanCancelPermissionsAndReturnToUnchangedDraft() {
        let input = element("capture.input")
        input.tap(); input.typeText("Borrador para conservar")
        if app.buttons["Listo"].exists { app.buttons["Listo"].tap() }
        element("capture.voice").tap()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if system.alerts.firstMatch.waitForExistence(timeout: 3) {
            let deny = system.alerts.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'permitir' OR label CONTAINS[c] 'allow'")).firstMatch
            if deny.exists { deny.tap() }
        }
        XCTAssertTrue(element("voice.cancel").waitForExistence(timeout: 5))
        screenshot("Dictado compacto")
        element("voice.cancel").tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Borrador para conservar")
    }

    func testManualCategoriesKeepTheirTypesAndColorsAfterRestart() {
        let examples = [("Estudio QA", "Estudio"), ("Entrenamiento QA", "Entrenamiento"), ("Reunión QA", "Reunión")]
        tab("Agenda")
        for (name, category) in examples {
            element("event.new").tap()
            let title = app.textFields["event.title"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            title.tap()
            if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { title.tap() }
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            title.typeText(name)
            if app.buttons["Listo"].exists { app.buttons["Listo"].tap() }
            let type = element("event.section")
            for _ in 0..<4 where !type.isHittable { app.swipeUp() }
            XCTAssertTrue(type.isHittable)
            type.tap()
            let option = app.buttons[category].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            option.tap()
            XCTAssertTrue((type.value as? String) == category || type.label.contains(category))
            element("event.save").tap()
            XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
        }
        tab("Hoy")
        for (name, _) in examples { XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5)) }
        screenshot("Hoy con Estudio, Entrenamiento y Reunión")
        tab("Agenda")
        screenshot("Agenda con tres tipos explícitos")
        app.terminate(); app.launchArguments = ["--ui-testing"]; app.launch()
        XCTAssertTrue(element("capture.input").waitForExistence(timeout: 15))
        tab("Hoy")
        for (name, _) in examples { XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5)) }
        screenshot("Tres tipos conservados al reiniciar")
        for (name, category) in examples {
            app.staticTexts[name].tap()
            XCTAssertTrue(app.navigationBars["Editar evento"].waitForExistence(timeout: 5))
            let type = element("event.section")
            for _ in 0..<4 where !type.isHittable { app.swipeUp() }
            XCTAssertTrue((type.value as? String) == category || type.label.contains(category), "El tipo elegido debe persistir")
            element("event.cancel").tap()
        }
    }

}

/// Opt-in by selecting this class on a physical device. It never inherits the
/// synthetic fixture setup or accepts permissions, enters text, or sends chat.
final class FocusPhysicalSmokeTests: XCTestCase {
    func testExistingHomeAndDictationCanBeOpenedAndCancelledWithoutChangingDraft() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Comprobación reservada al iPhone físico; no usa fixtures.")
        #else
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "me.usefocus.app")
        app.launchArguments = []
        if app.state == .notRunning { app.launch() } else { app.activate() }
        let today = app.tabBars.buttons["Hoy"]
        guard today.waitForExistence(timeout: 15) else {
            throw XCTSkip("Hoy no está disponible en la sesión actual; no se inicia sesión ni se cambia el modo de uso.")
        }
        today.tap()
        let input = app.textFields["capture.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let originalDraft = input.value as? String
        let home = XCTAttachment(screenshot: app.screenshot())
        home.name = "iPhone Home — evidencia privada"; home.lifetime = .keepAlways
        add(home)
        let voice = app.buttons["capture.voice"]
        guard voice.isEnabled else { throw XCTSkip("Dictado no disponible mientras existe una operación en curso.") }
        voice.tap()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if system.alerts.firstMatch.waitForExistence(timeout: 3) {
            let cancel = system.alerts.buttons.matching(NSPredicate(format: "label == 'Cancelar' OR label == 'Cancel'")).firstMatch
            if cancel.exists { cancel.tap() }
            else { XCUIDevice.shared.press(.home) }
            throw XCTSkip("Apareció un permiso del sistema: no se aceptó ni rechazó automáticamente; dictado real pendiente.")
        }
        let cancel = app.buttons["voice.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        let sheet = XCTAttachment(screenshot: app.screenshot())
        sheet.name = "iPhone dictado compacto — evidencia privada"; sheet.lifetime = .keepAlways
        add(sheet)
        cancel.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        // A failed assertion must not print the user's draft into test logs.
        XCTAssertTrue((input.value as? String) == originalDraft, "Cancelar debe conservar el borrador previo.")
        #endif
    }
}
