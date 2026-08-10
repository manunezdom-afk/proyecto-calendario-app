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
///    `native_push_tokens` → el cron de recordatorios (`cron-notifications`)
///    ya sabe enviarle APNs.
///
/// El par (token, userId) se re-sube cuando cualquiera de los dos cambia
/// (login con otra cuenta re-apunta el token — el backend upserta por token).
@MainActor
final class PushRegistrationService {

    static let shared = PushRegistrationService()
    private init() {}

    private var deviceToken: String?
    private var accessToken: String?
    private var userId: String?
    /// Última combinación token+usuario subida OK — evita re-POSTs en cada
    /// refresh de access token (el token renovado no cambia la suscripción).
    private var lastSyncedKey: String?

    /// Credenciales actuales (las empuja FocusApp cuando cambia AuthState).
    /// nil = logout/demo → no hay a quién asociar el token; no borramos la
    /// suscripción del backend (el token sigue siendo del mismo iPhone y el
    /// próximo login la re-asocia).
    func updateCredentials(accessToken: String?, userId: String?) {
        self.accessToken = accessToken
        self.userId = userId
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
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized
            || settings.authorizationStatus == .provisional else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    private func trySync() {
        guard let device = deviceToken,
              let access = accessToken,
              let uid = userId else { return }
        let key = "\(device)|\(uid)"
        guard key != lastSyncedKey else { return }
        lastSyncedKey = key
        Task { await postSubscribe(device: device, access: access, key: key) }
    }

    private func postSubscribe(device: String, access: String, key: String) async {
        var req = URLRequest(url: FocusConfig.apiOrigin.appendingPathComponent("/api/push"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = [
            "action": "native_subscribe",
            "token": device,
            "platform": "ios",
            "environment": Self.apnsEnvironment,
            "user_agent": "Focus iOS nativo",
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
            if status == 200 {
                debugLog("[Push] native_subscribe OK (\(Self.apnsEnvironment))")
            } else {
                debugLog("[Push] native_subscribe falló HTTP \(status) — se reintenta en el próximo trigger")
                await MainActor.run { self.lastSyncedKey = nil }
            }
        } catch {
            debugLog("[Push] native_subscribe error de red: \(error.localizedDescription)")
            await MainActor.run { self.lastSyncedKey = nil }
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
