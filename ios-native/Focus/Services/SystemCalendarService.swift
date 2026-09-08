import Foundation
import EventKit
import CryptoKit
import UIKit

/// Lector del calendario del sistema (EventKit). **READ-ONLY por diseño**:
/// Focus muestra los eventos del iPhone (iCloud, Google, Outlook — cualquier
/// cuenta configurada en Ajustes de iOS) dentro de Mi Día y Calendario, pero
/// no los edita ni los sube a Supabase.
///
/// Contrato de seguridad con el sync: `SupabaseSyncService` lee
/// `store.events`; los eventos del sistema viven en `store.systemEvents` —
/// arrays separados a propósito para que el sync jamás pueda subir a la nube
/// un evento que no es de Focus. El merge ocurre solo en la capa de lectura
/// (`eventsFor(date:)`).
@MainActor
final class SystemCalendarService {

    static let shared = SystemCalendarService()

    private let eventStore = EKEventStore()

    /// Callback cuando el calendario del sistema cambia por fuera (el
    /// usuario editó algo en la app Calendario, llegó un invite, etc.).
    /// Lo setea FocusDataStore para re-fetchear.
    var onStoreChanged: (() -> Void)?

    private init() {
        // EKEventStoreChanged dispara con CUALQUIER cambio del calendario
        // del sistema mientras la app está viva.
        NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.onStoreChanged?() }
        }
    }

    var authorizationStatus: EKAuthorizationStatus {
        EKEventStore.authorizationStatus(for: .event)
    }

    var isAuthorized: Bool {
        authorizationStatus == .fullAccess
    }

    var isDenied: Bool {
        authorizationStatus == .denied || authorizationStatus == .restricted
    }

    /// Pide acceso completo a eventos (iOS 17+). Devuelve true si quedó
    /// autorizado. El texto del prompt sale de
    /// `NSCalendarsFullAccessUsageDescription` en Info.plist.
    func requestAccess() async -> Bool {
        do {
            return try await eventStore.requestFullAccessToEvents()
        } catch {
            debugLog("[SystemCalendar] requestFullAccessToEvents falló: \(error)")
            return false
        }
    }

    /// Eventos del sistema en la ventana [start, end), mapeados a
    /// `FocusEvent` con `source: .apple`. Excluye:
    /// - all-day (el timeline de Focus es horario; un all-day como bloque
    ///   00:00–24:00 taparía el día entero),
    /// - calendarios de cumpleaños (ruido que iOS ya muestra a su manera).
    func events(from start: Date, to end: Date) -> [FocusEvent] {
        guard isAuthorized else { return [] }
        let predicate = eventStore.predicateForEvents(
            withStart: start, end: end, calendars: nil
        )
        return eventStore.events(matching: predicate)
            .filter { !$0.isAllDay && $0.calendar?.type != .birthday }
            .compactMap { Self.mapToFocusEvent($0) }
    }

    // MARK: - Mapeo

    private static func mapToFocusEvent(_ ek: EKEvent) -> FocusEvent? {
        guard let start = ek.startDate else { return nil }
        let title = (ek.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }

        var mapped = FocusEvent(
            // UUID determinístico: mismo evento (misma ocurrencia) → mismo id
            // entre fetches. Sin esto, cada refresh regeneraría ids random y
            // SwiftUI re-animaría todas las filas. Las ocurrencias de un
            // recurrente comparten eventIdentifier → incluimos el start.
            id: stableUUID("\(ek.eventIdentifier ?? title)|\(start.timeIntervalSince1970)"),
            title: title,
            notes: nil,
            startTime: start,
            endTime: ek.endDate,
            // Heurística mínima: con invitados se lee como reunión; el resto
            // neutro. No adivinamos más — el evento no es de Focus.
            section: ek.hasAttendees ? .reunion : .personal,
            status: .scheduled,
            location: ek.location?.trimmingCharacters(in: .whitespacesAndNewlines),
            source: .apple,
            externalCalendarId: ek.calendar?.calendarIdentifier,
            externalEventId: ek.eventIdentifier
        )
        if let color = ek.calendar?.cgColor {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            if UIColor(cgColor: color).getRed(&r, green: &g, blue: &b, alpha: &a), a > 0.1 {
                mapped.externalCalendarColorHex = String(format: "%02X%02X%02X", Int(r*255), Int(g*255), Int(b*255))
            }
        }
        return mapped
    }

    /// SHA256 del seed → primeros 16 bytes como UUID estable.
    private static func stableUUID(_ seed: String) -> UUID {
        let digest = SHA256.hash(data: Data(seed.utf8))
        let b = Array(digest.prefix(16))
        return UUID(uuid: (
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
            b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
        ))
    }
}
