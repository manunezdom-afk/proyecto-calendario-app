import XCTest

final class HilantePresentationUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    private func launch(_ mode: String? = nil) {
        app.launchArguments = ["--ui-testing", "--reset-fixture"]
        if let mode { app.launchArguments.append("--hilante-preview=\(mode)") }
        app.launch()
        XCTAssertTrue(app.textViews["capture.input"].waitForExistence(timeout: 15))
    }
    private func capture(_ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = title; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func openHilante() {
        let tab = app.tabBars.buttons["Hilante"]
        tab.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: tab)
        if XCTWaiter.wait(for: [selected], timeout: 3) != .completed { tab.tap() }
        XCTAssertTrue(tab.isSelected)
    }
    private var result: XCUIElement { app.staticTexts["capture.result"] }

    func testComposerKeepsMultilineTextAndControlsAboveKeyboard() {
        launch()
        let input = app.textViews["capture.input"]
        input.tap(); input.typeText("Uno")
        let shortHeight = input.frame.height
        capture("Home short input keyboard")
        input.typeText("\nDos\nTres\nCuatro\nCinco\nSeis\nSiete\nÚltima línea")
        XCTAssertTrue((input.value as? String)?.contains("Última línea") == true)
        XCTAssertGreaterThan(input.frame.height, shortHeight)
        XCTAssertLessThanOrEqual(input.frame.height, 161)
        let send = app.buttons["capture.send"]
        XCTAssertTrue(send.isHittable)
        XCTAssertTrue(app.buttons["capture.voice"].isHittable)
        XCTAssertLessThan(send.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        capture("Home multiline internal scrolling keyboard")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (input.value as? String)?.count ?? 0))
        let emptied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", ""), object: input)
        XCTAssertEqual(XCTWaiter.wait(for: [emptied], timeout: 5), .completed)
        XCTAssertLessThanOrEqual(input.frame.height, shortHeight + 1)
        capture("Home composer collapsed")
        app.terminate()
        launch("long")
        openHilante()
        let nova = app.textViews["nova.input"]
        XCTAssertTrue(nova.waitForExistence(timeout: 5))
        nova.tap(); nova.typeText("Primera línea\nSegunda línea\nTercera línea\nCuarta línea\nQuinta línea\nSexta línea")
        XCTAssertTrue(app.buttons["nova.send"].isHittable)
        XCTAssertLessThan(app.buttons["nova.send"].frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        capture("Hilante multiline keyboard")
    }

    func testFreshCompactExpiredAndHistory() {
        launch("short")
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertFalse(result.label.contains("**"))
        capture("Home fresh short reply")
        app.terminate(); launch("long")
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertFalse(result.label.contains("###"))
        capture("Home fresh long reply")
        app.buttons["capture.history"].tap()
        XCTAssertTrue(app.textViews["nova.input"].waitForExistence(timeout: 5))
        capture("Hilante full Markdown reply")
        app.terminate(); launch("compact")
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["capture.history"].exists)
        capture("Home compact reply")
        app.terminate(); launch("expiring")
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: result)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 22), .completed)
        capture("Home expired in place")
        openHilante()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Un paso a la vez")).firstMatch.waitForExistence(timeout: 5))
    }

    func testThinkingHasNoPrematureSuccessAndCanCancel() {
        launch("thinking")
        XCTAssertTrue(app.otherElements["nova.progress"].waitForExistence(timeout: 5))
        XCTAssertFalse(result.exists)
        XCTAssertFalse(app.staticTexts["Hilante está trabajando…"].exists)
        capture("Home thinking")
        app.buttons["Cancelar"].tap()
        XCTAssertFalse(app.otherElements["nova.progress"].exists)
        XCTAssertFalse(result.exists)
    }
}

final class HomeCommitmentUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    private func launch(_ mode: String, reset: Bool = true) {
        app.launchArguments = ["--ui-testing", "--home-preview=\(mode)"]
        if reset { app.launchArguments.append("--reset-fixture") }
        if mode == "recommendation" { app.launchArguments.append("--hilante-preview=compact") }
        app.launch()
        XCTAssertTrue(app.textViews["capture.input"].waitForExistence(timeout: 15))
    }
    private func shot(_ title: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = title; a.lifetime = .keepAlways; add(a)
    }
    func testExactDepartureCreatesAgendaAndSurvivesRelaunch() {
        launch("departure")
        let input = app.textViews["capture.input"]
        input.tap(); input.typeText("tengo que salir a las 3:20")
        app.buttons["capture.send"].tap()
        let result = app.staticTexts["capture.result"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertTrue(result.label.contains("Salir"), result.label)
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", ""), object: input)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed)
        // Look through the scroll view too: SwiftUI may expose the row as a cell.
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "today.event.")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.isHittable)
        for _ in 0..<2 where !row.isHittable { app.swipeUp() }
        shot("Compromiso guardado en Home")
        app.terminate(); launch("departure", reset: false)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.exists)
        shot("Compromiso persistido tras relanzar")
    }
    func testContextualHomeStates() {
        for mode in ["empty", "one", "three", "agenda", "recommendation"] {
            launch(mode)
            let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "today.priority.task.open."))
            XCTAssertEqual(rows.count, mode == "three" ? 3 : mode == "one" ? 1 : 0)
            XCTAssertFalse(app.staticTexts["No hay nada urgente ahora."].exists)
            if mode == "recommendation" { XCTAssertFalse(app.staticTexts["Espacio para lo que venga."].exists) }
            shot("Home contextual \(mode)")
            app.swipeUp()
            shot("Home contenido \(mode)")
            app.terminate()
        }
    }
    func testFastEditingOneToFiveLinesAndDeletion() {
        launch("empty")
        let input = app.textViews["capture.input"]
        input.tap()
        var value = ""
        for index in 1...5 {
            let next = (index == 1 ? "" : "\n") + "Línea \(index) escrita rápidamente"
            value += next
            input.typeText(next)
            XCTAssertEqual(input.value as? String, value)
            XCTAssertLessThanOrEqual(input.frame.height, 161)
            XCTAssertTrue(app.buttons["capture.send"].isHittable)
            shot("Composer \(index) líneas")
        }
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        let emptied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", ""), object: input)
        XCTAssertEqual(XCTWaiter.wait(for: [emptied], timeout: 5), .completed)
        shot("Composer vacío después de borrar")
    }
}

final class HomeReleaseCandidateUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    private func launch(_ args: [String] = [], reset: Bool = true) {
        app.launchArguments = ["--ui-testing", "--home-preview=empty"] + args
        if reset { app.launchArguments.append("--reset-fixture") }
        app.launch()
        if !app.textViews["capture.input"].waitForExistence(timeout: 5) { app.swipeUp() }
        XCTAssertTrue(app.textViews["capture.input"].waitForExistence(timeout: 10))
    }
    private func shot(_ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = title; attachment.lifetime = .keepAlways; add(attachment)
    }
    private var reply: XCUIElement { app.staticTexts["capture.result"] }
    private func tab(_ name: String) {
        let target = app.tabBars.buttons[name]
        target.tap()
        if !target.isSelected { target.tap() }
        XCTAssertTrue(target.isSelected)
    }
    private func lifecycle() {
        for name in ["Hilante", "Hoy", "Pendientes", "Hoy", "Agenda", "Hoy"] { tab(name) }
        XCUIDevice.shared.press(.home)
        app.activate()
    }
    func testReplySwipeOnlyHidesPresentationAndSurvivesLifecycle() {
        launch()
        let input = app.textViews["capture.input"]
        input.tap(); input.typeText("a las 5 tengo que irme")
        app.buttons["capture.send"].tap()
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        let cardText = reply.label
        // The small iPhone may place feedback below the tab bar.
        for _ in 0..<3 where reply.frame.maxY >= app.tabBars.firstMatch.frame.minY { app.swipeUp() }
        // A partial swipe exposes the explicit, non-destructive action.
        reply.swipeLeft()
        XCTAssertTrue(app.buttons["Quitar"].waitForExistence(timeout: 3))
        shot("Home Quitar solo respuesta")
        app.buttons["Quitar"].tap()
        XCTAssertFalse(reply.exists)
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.exists)
        lifecycle()
        XCTAssertFalse(reply.exists)
        app.terminate(); launch(reset: false)
        XCTAssertFalse(reply.exists)
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.exists)
        shot("Home descarte persistido con evento intacto")
        tab("Agenda")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.exists
                      || app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Salir")).firstMatch.exists)
        tab("Hilante")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", cardText)).firstMatch.exists)
        tab("Hoy")
        input.tap(); input.typeText("a las 7 paso a buscar a Juan")
        app.buttons["capture.send"].tap()
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        XCTAssertTrue(reply.label.contains("Juan"))
    }
    func testFreshReplyAndExpiredReplyAcrossFullLifecycle() {
        launch(["--hilante-preview=short"])
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        let text = reply.label
        lifecycle()
        XCTAssertEqual(reply.label, text)
        app.terminate(); launch(reset: false)
        XCTAssertEqual(reply.label, text)
        app.terminate(); launch(["--hilante-preview=expired"])
        XCTAssertFalse(reply.exists)
        lifecycle()
        XCTAssertFalse(reply.exists)
        app.terminate(); launch(reset: false)
        XCTAssertFalse(reply.exists)
    }
    func testVisualHomeMatrixInBothAppearances() {
        for appearance in ["light", "dark"] {
            for mode in ["empty", "reply", "agenda", "activities", "three"] {
                app.launchArguments = ["--ui-testing", "--reset-fixture", "--home-preview=\(mode)", "--appearance=\(appearance)"]
                if mode == "reply" { app.launchArguments.append("--hilante-preview=short") }
                app.launch()
                XCTAssertTrue(app.textViews["capture.input"].waitForExistence(timeout: 10))
                XCTAssertTrue(app.buttons["capture.voice"].isHittable)
                if ["empty", "reply"].contains(mode) { XCTAssertTrue(app.otherElements["today.priority.empty"].exists) }
                if mode == "agenda" { XCTAssertFalse(app.staticTexts["Lo importante"].exists) }
                shot("RC Home \(mode) \(appearance)")
                app.terminate()
            }
        }
    }
    func testVoiceReviewEditingCancelAndSend() {
        launch(["--voice-preview=review"])
        app.buttons["capture.voice"].tap()
        let transcript = app.descendants(matching: .any).matching(identifier: "voice.transcript").firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 5))
        shot("RC voz revisar")
        transcript.tap(); transcript.typeText(" hoy")
        XCTAssertTrue((transcript.value as? String)?.contains("hoy") == true)
        shot("RC voz editar con teclado")
        app.buttons["voice.cancel"].tap()
        XCTAssertEqual(app.textViews["capture.input"].value as? String, "")
        app.buttons["capture.voice"].tap()
        XCTAssertTrue(app.buttons["voice.use"].waitForExistence(timeout: 5))
        app.buttons["voice.use"].tap()
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        XCTAssertTrue(reply.label.contains("Salir"))
    }
    func testAccessibilityText() {
        launch(["--voice-preview=review", "--appearance=dark",
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        for _ in 0..<3 where !app.buttons["capture.voice"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["capture.voice"].isHittable)
        shot("RC Home accesibilidad texto máximo")
        app.buttons["capture.voice"].tap()
        XCTAssertTrue(app.buttons["voice.cancel"].waitForExistence(timeout: 5))
        shot("RC voz accesibilidad texto máximo")
        for _ in 0..<3 where !app.buttons["voice.use"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["voice.use"].isHittable)
        XCTAssertEqual(app.buttons["voice.cancel"].label, "Cancelar dictado")
        shot("RC voz controles accesibles")
    }

    func testVoiceVisualStatesAndDenial() {
        for appearance in ["light", "dark"] {
            for mode in ["listening", "processing", "denied", "review"] {
                launch(["--voice-preview=\(mode)", "--appearance=\(appearance)"])
                app.buttons["capture.voice"].tap()
                XCTAssertTrue(app.buttons["voice.cancel"].waitForExistence(timeout: 5))
                if mode == "listening" { XCTAssertTrue(app.buttons["voice.stop"].isHittable) }
                if mode == "denied" { XCTAssertTrue(app.buttons["voice.settings"].isHittable) }
                XCTAssertFalse(app.staticTexts["Tu voz en Focus"].exists)
                shot("RC voz \(mode) \(appearance)")
                app.buttons["voice.cancel"].tap()
                app.terminate()
            }
        }
    }
}

final class HomeRCMicrophoneTests: XCTestCase {
    func testPhysicalMicrophoneInterruptionSilenceAndCancel() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Necesita el micrófono del iPhone físico.")
        #else
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-fixture", "--home-preview=empty"]
        app.launch()
        let input = app.textViews["capture.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        input.tap(); input.typeText("Borrador de prueba")
        app.buttons["capture.voice"].tap()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<2 {
            if system.alerts.firstMatch.waitForExistence(timeout: 2) {
                let allow = system.alerts.buttons.matching(NSPredicate(format: "label == 'Permitir' OR label == 'Allow' OR label == 'OK' OR label == 'Aceptar'")).firstMatch
                if allow.exists { allow.tap() }
            }
        }
        func shot(_ name: String) {
            let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
        }
        shot("RC iPhone micrófono real")
        guard app.buttons["voice.stop"].waitForExistence(timeout: 3) else {
            app.buttons["voice.cancel"].tap()
            throw XCTSkip("Micrófono o reconocimiento local no disponible en la configuración del iPhone.")
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["voice.retry"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["voice.stop"].exists)
        shot("RC iPhone dictado tras background")
        app.buttons["voice.cancel"].tap()
        XCTAssertEqual(input.value as? String, "Borrador de prueba")
        app.buttons["capture.voice"].tap()
        XCTAssertTrue(app.buttons["voice.stop"].waitForExistence(timeout: 4))
        // Actual microphone silence; there is no injected transcript or audio.
        guard app.buttons["voice.retry"].waitForExistence(timeout: 12) else {
            app.buttons["voice.cancel"].tap()
            throw XCTSkip("El micrófono detecta sonido ambiente; silencio real pendiente.")
        }
        shot("RC iPhone silencio")
        app.buttons["voice.cancel"].tap()
        XCTAssertEqual(input.value as? String, "Borrador de prueba")
        #endif
    }
}
