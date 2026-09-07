import Foundation
import UserNotifications

extension Notification.Name {
    /// Disparado cuando el usuario toca una notificación local de Focus
    /// (recordatorio puntual o aviso de evento). `userInfo["eventId"]`
    /// contiene el UUID del evento como String. La UI escucha esto para
    /// saltar a la tab Mi Día.
    static let focusReminderTapped = Notification.Name("focus.reminder.tapped")
}

/// Servicio de notificaciones LOCALES (UserNotifications framework).
///
/// Programa avisos puntuales en el iPhone para `FocusEvent` que sean
/// recordatorios (`isReminder == true`). NO usa APNs remoto, NO requiere
/// servidor, NO requiere entitlements especiales.
///
/// Reglas:
/// - Identifier estable por evento: `focus-reminder-event-<UUID>`. Si se
///   re-llama `schedule(for:)` con el mismo id, iOS reemplaza la pendiente.
/// - No programa si el evento ya pasó (iOS lo ignoraría igual, pero
///   evitamos llenar el log).
/// - No programa si el toggle `remindersEnabled` está apagado.
/// - `cancel(for:)` borra silenciosamente — si no existía, no crashea.
/// - `requestAuthorization()` pide permiso una sola vez (iOS recuerda la
///   decisión); si ya está concedido, devuelve `.authorized` inmediato.
///
/// Privacidad: el contenido de la notificación incluye el título del
/// evento + ubicación si la tiene. No incluye `id`, no incluye tokens,
/// no incluye datos sensibles. El cuerpo cumple con la regla del usuario
/// de mensajes cortos y útiles.
@MainActor
final class LocalNotificationService: NSObject, UNUserNotificationCenterDelegate {

    static let shared = LocalNotificationService()
    private var revisions: [UUID: UUID] = [:]
    private var generation = UUID()
    private var desiredEvents: [FocusEvent] = []

    private override init() {
        super.init()
        // Registramos self como delegate ANTES de que llegue ninguna
        // notificación. Sin delegate, iOS suprime el banner cuando la app
        // está en foreground — el usuario crearía un recordatorio, lo
        // dejaría arriba y la notif nunca se vería.
        //
        // El delegate se accede vía singleton: al primer touch de
        // `LocalNotificationService.shared` (boot bootstrap, Ajustes,
        // addEvent), iOS recibe el binding.
        UNUserNotificationCenter.current().delegate = self
    }

    // MARK: - Identifier convention

    /// Prefijo para identificar notificaciones de recordatorios de eventos.
    /// Permite cancelarlas en grupo si fuera necesario y distinguirlas de
    /// futuras notificaciones (resumen diario, etc.) que usen otros prefijos.
    private static let eventReminderPrefix = "focus-reminder-event-"

    static func identifier(for eventId: UUID) -> String {
        eventReminderPrefix + eventId.uuidString
    }

    // MARK: - Authorization

    /// Pide permiso al usuario (alert/badge/sound). Si ya está autorizado,
    /// devuelve `.authorized` inmediato sin mostrar prompt.
    ///
    /// `provisional: false` — pedimos permiso explícito porque queremos
    /// que la notificación realmente alerte al usuario (no entrega
    /// silenciosa). Si el usuario rechaza, `currentStatus()` devolverá
    /// `.denied` y el caller mostrará un mensaje.
    @discardableResult
    func requestAuthorization() async -> UNAuthorizationStatus {
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings().authorizationStatus
        // Si ya hay decisión, respetamos. iOS no muestra prompt dos veces.
        if current != .notDetermined {
            return current
        }
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                // Recién concedido → aprovechar para pedir el device token
                // de APNs (push remotas). Sin esto, el token solo se pedía
                // en el próximo relanzamiento de la app.
                await PushRegistrationService.shared.registerIfAuthorized()
            }
            return granted ? .authorized : .denied
        } catch {
            // El request falló por una razón rara (raro). Tratamos como denied.
            return .denied
        }
    }

    /// Estado actual del permiso. No bloquea ni dispara prompt.
    func currentStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    // MARK: - Scheduling

    /// Programa una notificación local para el evento si:
    /// - es recordatorio puntual (`isReminder == true`), **O**
    /// - tiene `reminderOffsets` configurados (≥ 1 offset) — caso típico:
    ///   evento regular tipo "Ducharme 10:00" al que el usuario le pegó
    ///   un aviso de "10 min antes" → `reminderOffsets=[10]`, isReminder
    ///   sigue false porque el evento en sí no es un compromiso de aviso.
    ///   El usuario igual quiere recibir la notif a las 09:50.
    /// - su `startTime` está en el futuro,
    /// - el toggle global lo permite (lo chequea el caller),
    /// - el permiso está concedido (lo chequea el caller).
    ///
    /// Idempotente: usar la misma id reemplaza la pendiente anterior, así
    /// que es seguro llamarla varias veces (por ejemplo en `mergeRemoteEvents`).
    private func scheduleReminder(for event: FocusEvent, allowedFireDates: Set<Date>) async {
        let isReminderEvent = event.isReminder == true
        let hasOffsets = !(event.reminderOffsets?.isEmpty ?? true)
        guard isReminderEvent || hasOffsets else {
            // Ni recordatorio puntual ni con offsets → no programamos.
            // El caller (FocusDataStore.syncLocalNotification) garantiza
            // que cualquier pendiente previa se cancela.
            return
        }
        guard event.startTime > Date() else {
            // Fecha ya pasó — iOS la rechazaría. Nos saltamos para no
            // ensuciar logs.
            return
        }

        // Antes de programar la nueva, cancelamos cualquier pendiente de
        // este evento (puede haber múltiples si tiene varios offsets).
        let revision = UUID()
        revisions[event.id] = revision
        let scheduledGeneration = generation
        let pending = await UNUserNotificationCenter.current().pendingNotificationRequests()
        guard revisions[event.id] == revision, generation == scheduledGeneration else { return }
        let prefix = Self.identifier(for: event.id)
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0 == prefix || $0.hasPrefix(prefix + "-") }
        )

        // Calculamos las fechas en que dispararán las notificaciones.
        // - Si hay `reminderOffsets`, programamos uno por cada offset
        //   (startTime - offset). Filtramos los que ya pasaron.
        // - Si no hay offsets, programamos una sola al startTime.
        let fireDates = Self.plannedFireDates(for: event, now: Date()).filter { allowedFireDates.contains($0) }
        guard !fireDates.isEmpty else { return }

        let center = UNUserNotificationCenter.current()
        let cleanTitle = event.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayTitle = cleanTitle.isEmpty ? "Focus" : cleanTitle

        // Mapeamos cada fireDate a su offset original para poder anclar
        // la nota custom (reminderNotes[i] está alineado a reminderOffsets[i]).
        let noteForFire = noteMapForFires(event: event, fireDates: fireDates)

        for (index, fireDate) in fireDates.enumerated() {
            let content = UNMutableNotificationContent()
            // Si hay nota custom para esta fire date, ESA es el título de la
            // notif (la ACCIÓN concreta que el user quiere recordar). El
            // título del evento pasa al subtitle como contexto. Caso user:
            // "tengo partido 3 PM acuérdame 20 min antes de echar zapatillas":
            //   - title = "Echar las zapatillas a la mochila"
            //   - subtitle = "Partido — En 20 min"
            //   - body = location si la hay
            // Si NO hay nota custom → comportamiento legacy:
            //   - title = título del evento (ej. "Ducharme")
            //   - subtitle = "En 10 min"
            //   - body = location
            // Dictionary[Int: String?] devuelve String?? por nested optional;
            // doble flatMap → String? con la nota efectiva.
            let note = noteForFire[index].flatMap { $0 }
            if let note = note, !note.isEmpty {
                content.title = note
                content.subtitle = "\(displayTitle) — \(subtitle(forFireDate: fireDate, eventStart: event.startTime))"
            } else {
                content.title = displayTitle
                content.subtitle = subtitle(forFireDate: fireDate, eventStart: event.startTime)
            }
            // Body = ubicación (si la hay) o vacío. NO repetimos el título
            // porque ya está en `content.title` o `subtitle`.
            if let location = event.location?.trimmingCharacters(in: .whitespacesAndNewlines),
               !location.isEmpty {
                content.body = location
            } else {
                content.body = ""
            }
            content.sound = .default
            content.userInfo = ["eventId": event.id.uuidString]

            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second, .timeZone],
                from: fireDate
            )
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

            // Identifier por offset para poder cancelar individualmente.
            // El primer fire usa el id base (compatibilidad con cancelReminder).
            // Each scheduling revision has its own identifier. A late completion
            // can remove its own request without cancelling a newer edit's alert.
            let identifier = "\(Self.identifier(for: event.id))-\(revision.uuidString)-\(index)"

            let request = UNNotificationRequest(
                identifier: identifier,
                content: content,
                trigger: trigger
            )

            do {
                try await center.add(request)
                guard revisions[event.id] == revision, generation == scheduledGeneration else {
                    center.removePendingNotificationRequests(withIdentifiers: [identifier])
                    return
                }
            } catch {
                debugLog("[LocalNotificationService] schedule failed: \(error.localizedDescription)")
            }
        }
    }

    struct PlannedReminder: Equatable {
        let eventID: UUID
        let fireDate: Date
    }

    /// iOS keeps a finite pending queue. Select the nearest reminders globally,
    /// rather than allowing a distant recurrence to occupy all available slots.
    static func plannedWindow(events: [FocusEvent], now: Date, capacity: Int = 64) -> [PlannedReminder] {
        let candidates = events.filter { $0.status != .done && $0.status != .cancelled }
            .flatMap { event in
                plannedFireDates(for: event, now: now).map { PlannedReminder(eventID: event.id, fireDate: $0) }
            }
            .sorted {
                if $0.fireDate != $1.fireDate { return $0.fireDate < $1.fireDate }
                return $0.eventID.uuidString < $1.eventID.uuidString
            }
        return Array(candidates.prefix(max(0, min(64, capacity))))
    }

    /// Reconcile the whole queue whenever data changes or the app becomes active.
    /// Existing non-Focus requests also consume the app's 64 available slots.
    func synchronizeReminders(for events: [FocusEvent]) async {
        desiredEvents = events
        generation = UUID()
        let currentGeneration = generation
        revisions.removeAll()
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        guard generation == currentGeneration else { return }
        let own = pending.filter { $0.identifier.hasPrefix(Self.eventReminderPrefix) }
        let available = max(0, 64 - (pending.count - own.count))
        let window = Self.plannedWindow(events: events, now: Date(), capacity: available)
        center.removePendingNotificationRequests(withIdentifiers: own.map(\.identifier))
        let datesByEvent = Dictionary(grouping: window, by: \.eventID)
        for event in events where datesByEvent[event.id] != nil {
            guard generation == currentGeneration else { return }
            let dates = Set((datesByEvent[event.id] ?? []).map(\.fireDate))
            await scheduleReminder(for: event, allowedFireDates: dates)
        }
    }

    /// Calcula las fechas reales en las que se van a disparar las notifs
    /// del evento. Aplica los offsets pidiendo `startTime - offset minutos`.
    /// Filtra las que quedaron en el pasado (ej. usuario crea evento para
    /// dentro de 3 min con offset de 10 min → la notif ya pasó, no la
    /// programamos pero sí seguimos con el resto).
    /// Pure planning boundary: tests can verify delivery dates without asking
    /// for permission or enqueuing a system notification.
    static func plannedFireDates(for event: FocusEvent, now: Date) -> [Date] {
        guard event.startTime > now else { return [] }
        let offsets = event.reminderOffsets ?? []
        if offsets.isEmpty { return event.isReminder == true ? [event.startTime] : [] }
        return Set(offsets.filter { $0 >= 0 })
            .map { event.startTime.addingTimeInterval(-Double($0) * 60) }
            .filter { $0 > now }
            .sorted()
    }

    /// Mapea cada índice de la lista de fireDates (ya filtradas + ordenadas)
    /// al note custom correspondiente. Por la complejidad de filtrar
    /// (futuras) y reordenar, mapeamos cada fireDate de vuelta al offset
    /// original y luego al note en `reminderNotes[i]`. Si el evento no
    /// tiene offsets ni notas, retorna [:] vacío.
    private func noteMapForFires(event: FocusEvent, fireDates: [Date]) -> [Int: String?] {
        guard let offsets = event.reminderOffsets, !offsets.isEmpty else { return [:] }
        var map: [Int: String?] = [:]
        for (fireIdx, fireDate) in fireDates.enumerated() {
            let deltaMinutes = Int(round(event.startTime.timeIntervalSince(fireDate) / 60))
            // Buscar offset original que matchee ese delta. Si hay duplicados
            // (raro), tomamos el primero.
            if let offsetIdx = offsets.firstIndex(of: deltaMinutes) {
                map[fireIdx] = event.reminderNote(at: offsetIdx)
            } else {
                map[fireIdx] = nil
            }
        }
        return map
    }

    /// Genera el subtitle según la relación entre el fireDate y el startTime
    /// del evento. Si la diferencia es ≥ 1 min, decimos "En N min".
    /// Si es 0 (o casi), decimos "Empieza a las HH:MM".
    private func subtitle(forFireDate fireDate: Date, eventStart: Date) -> String {
        let deltaMinutes = Int(round(eventStart.timeIntervalSince(fireDate) / 60))
        if deltaMinutes >= 1 {
            if deltaMinutes >= 60 && deltaMinutes % 60 == 0 {
                let h = deltaMinutes / 60
                return h == 1 ? "En 1 hora" : "En \(h) horas"
            }
            return deltaMinutes == 1 ? "En 1 min" : "En \(deltaMinutes) min"
        }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "es_CL")
        fmt.dateFormat = "HH:mm"
        return "Empieza a las \(fmt.string(from: eventStart))"
    }

    // MARK: - Cancellation

    /// Cancela TODAS las notifs pendientes asociadas al evento — la base
    /// (`focus-reminder-event-<id>`) y todas las variantes con sufijo
    /// `-0`, `-1`, etc. cuando hay múltiples offsets. Silencioso si no
    /// había nada pendiente.
    func cancelReminder(eventId: UUID) {
        let revision = UUID()
        revisions[eventId] = revision
        let base = Self.identifier(for: eventId)
        Task { [weak self] in
            let center = UNUserNotificationCenter.current()
            let pending = await center.pendingNotificationRequests()
            guard self?.revisions[eventId] == revision else { return }
            let ids = pending.map(\.identifier).filter { $0 == base || $0.hasPrefix(base + "-") }
            center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    /// Limpia TODAS las notificaciones de recordatorio (las que comienzan
    /// con `focus-reminder-event-`). Útil para "Reset local" en Ajustes y
    /// para signOut. NO toca otras notificaciones del sistema.
    func cancelAllReminders() async {
        desiredEvents = []
        generation = UUID()
        let cancellationGeneration = generation
        revisions.removeAll()
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        guard generation == cancellationGeneration else { return }
        let ourIds = pending
            .map(\.identifier)
            .filter { $0.hasPrefix(Self.eventReminderPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ourIds)
    }

    // MARK: - Debug

    /// Devuelve count de notificaciones pendientes propias. Solo para
    /// debugging interno o sección Ajustes "estado". No expone contenido.
    func pendingReminderCount() async -> Int {
        let pending = await UNUserNotificationCenter.current().pendingNotificationRequests()
        return pending.filter { $0.identifier.hasPrefix(Self.eventReminderPrefix) }.count
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Llamado por iOS cuando una notif está por entregarse y la app está
    /// en FOREGROUND. Sin esto, iOS suprime el banner — el usuario nunca
    /// vería la notificación si justo tiene la app abierta.
    ///
    /// Configuración V1: mostramos `banner` (alerta arriba), `sound`
    /// (default) y agregamos a la `list` del Notification Center. No
    /// usamos `badge` para no llenar el icon de la app con un número
    /// que el usuario no podría limpiar fácilmente.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
        // While the app is running, replenish the next reminder after delivery.
        // A background/suspended app replenishes when it becomes active again.
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.synchronizeReminders(for: self.desiredEvents)
        }
    }

    /// Llamado por iOS cuando el usuario interactúa con la notificación
    /// (tap o swipe-to-open). Posteamos un `Notification.Name` interno
    /// para que `MainTabView` salte a Mi Día — ahí están los eventos del
    /// día y es la pantalla natural para confirmar que vio el aviso.
    ///
    /// Privacy: solo pasamos el `eventId` por userInfo, sin contenido
    /// del recordatorio. El listener decide qué hacer.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Solo respondemos al action default (tap del banner). Dismiss
        // y otras acciones del system no deberían navegar.
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else {
            completionHandler()
            return
        }
        let eventIdString = response.notification.request.content.userInfo["eventId"] as? String
        // Transfer only a Sendable identifier; construct the Foundation payload
        // on the main queue where the UI consumes it.
        DispatchQueue.main.async {
            var payload: [AnyHashable: Any] = [:]
            if let eventIdString { payload["eventId"] = eventIdString }
            NotificationCenter.default.post(
                name: .focusReminderTapped,
                object: nil,
                userInfo: payload
            )
        }
        completionHandler()
    }
}
