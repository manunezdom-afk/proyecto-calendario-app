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
        XCTAssertTrue(app.staticTexts["Para tener en cuenta"].exists)
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
