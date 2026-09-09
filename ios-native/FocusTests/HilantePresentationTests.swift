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
