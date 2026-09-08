import SwiftUI
import Foundation

enum EventSection: String, Codable, CaseIterable, Hashable, Identifiable {
    case foco
    case reunion
    case personal
    case estudio
    case descanso
    case entrenamiento
    case reminder

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .foco: return "Foco"
        case .reunion: return "Reunión"
        case .personal: return "Personal"
        case .estudio: return "Estudio"
        case .descanso: return "Descanso"
        case .entrenamiento: return "Entrenamiento"
        case .reminder: return "Recordatorio"
        }
    }

    var color: Color {
        switch self {
        case .foco: return Theme.Colors.sectionFoco
        case .reunion: return Theme.Colors.sectionReunion
        case .personal: return Theme.Colors.sectionPersonal
        case .estudio: return Theme.Colors.sectionEstudio
        case .descanso: return Theme.Colors.sectionDescanso
        case .entrenamiento: return Theme.Colors.sectionEntrenamiento
        case .reminder: return Theme.Colors.sectionReminder
        }
    }

    var symbol: String {
        switch self {
        case .foco: return "scope"
        case .reunion: return "person.2.fill"
        case .personal: return "person.fill"
        case .estudio: return "book.fill"
        case .descanso: return "cup.and.saucer.fill"
        case .entrenamiento: return "figure.run"
        case .reminder: return "bell.fill"
        }
    }
}

enum EventStatus: String, Codable, Hashable {
    case scheduled
    case inProgress
    case done
    case cancelled
}

/// De dónde viene un evento. `local` = creado en Focus. El resto se reserva
/// para cuando conectemos integraciones reales (Apple EventKit / Google
/// Calendar OAuth / archivo .ics). Por ahora siempre es nil → tratar como local.
enum EventSource: String, Codable, Hashable {
    case local
    case google
    case apple
    case ics
}

struct FocusEvent: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var notes: String?
    var startTime: Date
    var endTime: Date?
    var section: EventSection
    var status: EventStatus
    var location: String?
    var featured: Bool
    var linkedTaskIds: [UUID]

    // MARK: - Fields preparados para C5/C6 (integraciones externas)
    // Son **opcionales** a propósito: el `init(from decoder:)` sintetizado por
    // Swift usa `decodeIfPresent` para Optionals, así que el JSON guardado
    // antes de esta versión (sin estos keys) sigue decodificando sin error.
    /// Origen del evento. `nil` → tratar como `.local` (ver `effectiveSource`).
    var source: EventSource?
    /// ID del calendario externo (ej. el calendarId de Google).
    var externalCalendarId: String?
    /// ID del evento en el sistema externo (para detectar duplicados al sync).
    var externalEventId: String?
    /// EventKit calendar color, local read metadata only. Old snapshots decode nil.
    var externalCalendarColorHex: String? = nil
    /// URL asociada (ej. link de Meet/Zoom). Distinto de `location`.
    var url: String?
    /// Última vez que sincronizamos contra el servicio externo.
    var lastSyncedAt: Date?
    /// Si es `true`, el evento se muestra como punto en el tiempo (solo hora
    /// de inicio, sin rango). El usuario lo creó con "acuérdame"/"recuérdame"
    /// y conceptualmente es un recordatorio, no un bloque con duración.
    var isReminder: Bool?
    /// `true` cuando Nova creó el evento sin que el usuario haya dado hora
    /// fin explícita (no dijo "de X a Y", "hasta Y", "por N horas"). La UI
    /// muestra solo la hora puntual aunque internamente el evento tenga
    /// duración mínima para mantener orden en el timeline.
    var inferredDuration: Bool?
    /// Minutos antes del `startTime` en los que el usuario quiere ser
    /// notificado (ej. "acuérdame 5 minutos antes" → `[5]`). Si está vacío
    /// o nil y `isReminder == true`, se notifica al `startTime`. Permite
    /// múltiples avisos en el futuro (ej. `[60, 10]`) sin romper API.
    var reminderOffsets: [Int]?
    /// Texto custom POR cada offset — array paralelo a `reminderOffsets`.
    /// `reminderNotes[i]` es la acción concreta que el usuario quiere que
    /// le recuerden (ej. "Echar las zapatillas a la mochila") para el
    /// offset `reminderOffsets[i]`. Si es `nil`, "" o el array es más
    /// corto que offsets, la notificación usa el título del evento como
    /// texto genérico ("Recordatorio: Partido"). Permite el caso del user:
    /// "tengo partido tipo 3 acuérdame 20 min antes de echar las zapatillas
    /// a la mochila" → offset=20, note="Echar las zapatillas a la mochila"
    /// anclado al evento "Partido" 15:00.
    var reminderNotes: [String]?
    /// Subtítulo / contexto semántico del evento. Separación opcional
    /// "X de Y" → title=X, subtitle=Y. Usado para representaciones más
    /// legibles cuando el usuario menciona contexto al final:
    /// - "reunión a las 8 de mindfulness" → title=Reunión, subtitle=Mindfulness
    /// - "clase de teorías" → title=Clase, subtitle=Teorías
    /// - "prueba de historia" → title=Prueba, subtitle=Historia
    /// - "cumpleaños de Urrutia" → title=Cumpleaños, subtitle=Urrutia
    ///
    /// Optional para back-compat con eventos persistidos antes (el JSON
    /// decoder usa decodeIfPresent para Optionals). Nil cuando el evento
    /// es simple ("dentista hoy a las 4" → solo title, sin subtitle).
    var subtitle: String?

    /// Origen efectivo del evento. Si `source` es nil (data legacy) lo
    /// tratamos como `.local`.
    var effectiveSource: EventSource { source ?? .local }

    var accentColor: Color {
        guard effectiveSource != .local, let hex = externalCalendarColorHex,
              hex.count == 6, let value = UInt32(hex, radix: 16) else { return section.color }
        // EventKit's color is an accent, never body text. Adapt its brightness
        // for the current surface while preserving hue and keeping a label/icon.
        return Color(uiColor: UIColor { traits in
            var r = CGFloat((value >> 16) & 255) / 255
            var g = CGFloat((value >> 8) & 255) / 255
            var b = CGFloat(value & 255) / 255
            func luminance(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> CGFloat {
                func linear(_ x: CGFloat) -> CGFloat { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
                return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
            }
            let dark = traits.userInterfaceStyle == .dark
            let background: CGFloat = dark ? luminance(25/255, 31/255, 47/255) : 1
            let target: CGFloat = traits.accessibilityContrast == .high ? 4.5 : 3
            for _ in 0..<30 {
                let foreground = luminance(r, g, b)
                if (max(foreground, background) + 0.05) / (min(foreground, background) + 0.05) >= target { break }
                r = dark ? r + (1-r)*0.08 : r*0.92
                g = dark ? g + (1-g)*0.08 : g*0.92
                b = dark ? b + (1-b)*0.08 : b*0.92
            }
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        })
    }

    /// True si la card debe mostrar solo la hora de inicio (sin "15:00–16:00").
    /// Es punto en el tiempo cuando es recordatorio O cuando la duración fue
    /// inferida (no explícita).
    var displayAsPointInTime: Bool {
        isReminder == true || inferredDuration == true
    }

    init(
        id: UUID = UUID(),
        title: String,
        notes: String? = nil,
        startTime: Date,
        endTime: Date? = nil,
        section: EventSection = .reunion,
        status: EventStatus = .scheduled,
        location: String? = nil,
        featured: Bool = false,
        linkedTaskIds: [UUID] = [],
        source: EventSource? = nil,
        externalCalendarId: String? = nil,
        externalEventId: String? = nil,
        url: String? = nil,
        lastSyncedAt: Date? = nil,
        isReminder: Bool? = nil,
        inferredDuration: Bool? = nil,
        reminderOffsets: [Int]? = nil,
        reminderNotes: [String]? = nil,
        subtitle: String? = nil
    ) {
        self.id = id
        self.title = title
        self.notes = notes
        self.startTime = startTime
        self.endTime = endTime
        self.section = section
        self.status = status
        self.location = location
        self.featured = featured
        self.linkedTaskIds = linkedTaskIds
        self.source = source
        self.externalCalendarId = externalCalendarId
        self.externalEventId = externalEventId
        self.url = url
        self.lastSyncedAt = lastSyncedAt
        self.isReminder = isReminder
        self.inferredDuration = inferredDuration
        self.reminderOffsets = reminderOffsets
        self.reminderNotes = reminderNotes
        self.subtitle = subtitle
    }

    /// Devuelve la nota custom para el offset en posición `index`. Maneja
    /// arrays desincronizados (notes más corto que offsets) y strings vacíos.
    /// Si no hay nota válida, devuelve `nil` → la notif usa el título genérico.
    func reminderNote(at index: Int) -> String? {
        guard let notes = reminderNotes, index < notes.count else { return nil }
        let trimmed = notes[index].trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var timeRangeLabel: String {
        let fmt = DateFormatters.hourMinute
        let start = fmt.string(from: startTime)
        // Recordatorios se muestran como punto en el tiempo (sin rango).
        if displayAsPointInTime { return start }
        if let endTime {
            return "\(start) – \(fmt.string(from: endTime))"
        }
        return start
    }

    var durationLabel: String? {
        // Para recordatorios no mostramos duración (no representa un bloque).
        if displayAsPointInTime { return nil }
        guard let end = endTime else { return nil }
        let mins = Int(end.timeIntervalSince(startTime) / 60)
        if mins < 60 {
            return "\(mins) min"
        }
        let h = mins / 60
        let m = mins % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    var isNow: Bool {
        let now = Date()
        guard let end = endTime else { return false }
        return startTime <= now && end >= now
    }
}
