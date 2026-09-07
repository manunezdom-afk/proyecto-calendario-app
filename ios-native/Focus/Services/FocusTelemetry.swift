import Foundation
import OSLog

/// Contadores locales de producto: sin texto, identificadores, fechas ni red.
/// Un conjunto cerrado de eventos impide adjuntar contenido del usuario.
enum FocusTelemetry {
    enum Event: String, CaseIterable {
        case onboardingStarted = "onboarding_started"
        case onboardingCompleted = "onboarding_completed"
        case firstItemCreated = "first_item_created"
        case novaRequest = "nova_request"
        case novaActionSuccess = "nova_action_success"
        case novaActionFailure = "nova_action_failure"
        case taskCompleted = "task_completed"
        case reminderCreated = "reminder_created"
    }

    private static let lock = NSLock()
    private static let key = "focus.v2.productCounters"
    private static let logger = Logger(subsystem: "me.usefocus.app", category: "Product")

    static func record(_ event: Event) {
        lock.lock()
        var counts = UserDefaults.standard.dictionary(forKey: key) as? [String: Int] ?? [:]
        counts[event.rawValue] = min((counts[event.rawValue] ?? 0) + 1, 1_000_000)
        UserDefaults.standard.set(counts, forKey: key)
        lock.unlock()
        logger.debug("event=\(event.rawValue, privacy: .public)")
    }

    static func recordFirstItem() {
        lock.lock()
        let hasRecorded = (UserDefaults.standard.dictionary(forKey: key) as? [String: Int])?[Event.firstItemCreated.rawValue] != nil
        lock.unlock()
        if !hasRecorded { record(.firstItemCreated) }
    }
}
