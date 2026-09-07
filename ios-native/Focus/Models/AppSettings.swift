import Foundation

enum AppearancePreference: String, Codable, CaseIterable, Identifiable {
    case system
    case dark
    case light

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "Sistema"
        case .dark: return "Oscuro"
        case .light: return "Claro"
        }
    }
}

enum NovaPersonality: String, Codable, CaseIterable, Identifiable {
    case focus
    case cercana
    case estrategica

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .focus: return "Focus"
        case .cercana: return "Cercana"
        case .estrategica: return "Estratégica"
        }
    }

    var description: String {
        switch self {
        case .focus: return "Directa y breve. Sin rodeos."
        case .cercana: return "Cálida y amable. Te acompaña."
        case .estrategica: return "Analítica. Te muestra el panorama."
        }
    }
}

enum PlanName: String, Codable, CaseIterable {
    case free
    case earlyAccess
    case pro

    var displayName: String {
        switch self {
        case .free: return "Free"
        case .earlyAccess: return "Early Access"
        case .pro: return "Pro"
        }
    }
}

struct AppSettings: Codable, Hashable {
    var notificationsEnabled: Bool
    var dailySummaryEnabled: Bool
    var smartSuggestionsEnabled: Bool
    var remindersEnabled: Bool
    var appearance: AppearancePreference
    var novaPersonality: NovaPersonality
    var novaMemoryEnabled: Bool
    var novaVoiceEnabled: Bool
    var plan: PlanName
    var demoMode: Bool
    /// Mostrar eventos del calendario del iPhone (EventKit, read-only)
    /// dentro de Mi Día y Calendario. Optional a propósito: el JSON
    /// persistido antes de esta versión no tiene la key y un Bool no
    /// opcional haría fallar el decode completo → reset de settings.
    /// nil → false (ver `systemCalendarOn`).
    var showSystemCalendar: Bool?

    /// Lectura segura del flag del calendario del sistema.
    var systemCalendarOn: Bool { showSystemCalendar ?? false }

    static let defaults = AppSettings(
        notificationsEnabled: true,
        dailySummaryEnabled: true,
        smartSuggestionsEnabled: true,
        remindersEnabled: true,
        appearance: .system,
        novaPersonality: .focus,
        novaMemoryEnabled: true,
        novaVoiceEnabled: false,
        plan: .earlyAccess,
        demoMode: true
    )
}
