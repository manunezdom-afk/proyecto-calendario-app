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
        XCTAssertEqual(input.value as? String, "")
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
