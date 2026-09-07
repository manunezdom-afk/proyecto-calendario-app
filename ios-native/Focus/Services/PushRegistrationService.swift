import Foundation
import UIKit
import UserNotifications

/// Registro de push remotas (APNs) contra el backend de Focus.
///
/// Flujo completo:
/// 1. `registerIfAuthorized()` — si el usuario ya concedió permiso de
///    notificaciones, llama `registerForRemoteNotifications()` (idempotente;
///    iOS entrega el device token al AppDelegate aunque no haya cambiado).
/// 2. El AppDelegate (FocusApp.swift) recibe el token y lo pasa a
///    `handleDeviceToken(_:)`.
/// 3. Cuando hay token de dispositivo Y sesión activa, se sube al backend
///    con `POST /api/push {action: native_subscribe}` → tabla
///    `native_push_tokens`. The current cron delivers web-calendar (`events`)
///    alerts through APNs. Native `focus_events` reminders use the local queue;
///    this registration is not a background fallback for native reminders.
///
/// El par (token, userId) se re-sube cuando cualquiera de los dos cambia
/// (login con otra cuenta re-apunta el token — el backend upserta por token).
@MainActor
final class PushRegistrationService {

    static let shared = PushRegistrationService()
    private init() {}

    private var enabled = true
    private var deviceToken: String?
    private var accessToken: String?
    private var userId: String?
    /// Última combinación token+usuario subida OK — evita re-POSTs en cada
    /// refresh de access token (el token renovado no cambia la suscripción).
    private var lastSyncedKey: String?
    private var pendingKey: String?
    private var registrationTask: Task<Void, Never>?

    /// Uses the same explicit preference as local reminders. Disabling removes
    /// the native subscription after any older job finishes and stops APNs on
    /// this device immediately, including when the backend is unreachable.
    func setEnabled(_ enabled: Bool) {
        guard self.enabled != enabled else { return }
        self.enabled = enabled
        lastSyncedKey = nil
        pendingKey = nil
        if enabled {
            trySync()
            Task { await registerIfAuthorized() }
        } else {
            UIApplication.shared.unregisterForRemoteNotifications()
            if let deviceToken, let accessToken, userId != nil {
                let previousJob = registrationTask
                registrationTask = Task { [weak self] in
                    await previousJob?.value
                    _ = await self?.post(action: "native_unsubscribe", device: deviceToken, access: accessToken)
                }
            }
        }
    }

    /// Signing out immediately stops local APNs registration and removes the
    /// authenticated subscription when connectivity allows. Jobs are serialized
    /// so an old account's subscribe cannot finish after a newer account's job.
    func updateCredentials(accessToken: String?, userId: String?) {
        let previousAccess = self.accessToken
        let previousUser = self.userId
        self.accessToken = accessToken
        self.userId = userId
        if previousUser != userId {
            lastSyncedKey = nil
            pendingKey = nil
            UIApplication.shared.unregisterForRemoteNotifications()
            if let deviceToken, let previousAccess, previousUser != nil {
                let previousJob = registrationTask
                registrationTask = Task { [weak self] in
                    await previousJob?.value
                    await self?.post(action: "native_unsubscribe", device: deviceToken, access: previousAccess)
                }
            }
        }
        trySync()
    }

    /// Token de dispositivo entregado por APNs vía AppDelegate.
    func handleDeviceToken(_ token: String) {
        deviceToken = token
        trySync()
    }

    /// Pide el device token a APNs si el permiso de notificaciones ya está
    /// concedido. NO pide permiso — eso lo hace LocalNotificationService en
    /// su momento contextual; aquí solo aprovechamos el permiso existente.
    func registerIfAuthorized() async {
        guard enabled, userId != nil, accessToken != nil else { return }
        let activeUser = userId
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized
            || settings.authorizationStatus == .provisional else { return }
        guard enabled, userId == activeUser else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    private func trySync() {
        guard enabled, let device = deviceToken, let access = accessToken, let uid = userId else { return }
        let key = "\(device)|\(uid)"
        guard key != lastSyncedKey, key != pendingKey else { return }
        pendingKey = key
        let previousJob = registrationTask
        registrationTask = Task { [weak self] in
            await previousJob?.value
            guard let self, self.enabled, self.userId == uid, self.deviceToken == device else { return }
            let success = await self.post(action: "native_subscribe", device: device, access: access)
            guard self.enabled, self.userId == uid, self.deviceToken == device else { return }
            if success { self.lastSyncedKey = key }
            if self.pendingKey == key { self.pendingKey = nil }
        }
    }

    @discardableResult
    private func post(action: String, device: String, access: String) async -> Bool {
        var request = URLRequest(url: FocusConfig.apiOrigin.appendingPathComponent("/api/push"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = [
            "action": action,
            "token": device,
            "platform": "ios",
            "environment": Self.apnsEnvironment,
            "user_agent": "Focus iOS nativo",
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            debugLog("[Push] subscription update will retry with a future authenticated registration")
            return false
        }
    }

    /// Debe matchear el `aps-environment` con el que se firmó el binario:
    /// Debug/dev → sandbox APNs; Release (TestFlight/App Store) → production.
    private static var apnsEnvironment: String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }
}
