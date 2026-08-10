import SwiftUI
import UIKit

/// Delegate mínimo para recibir el device token de APNs. SwiftUI no expone
/// estos callbacks — el adaptor lo conecta al ciclo de vida de UIKit.
final class FocusAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            PushRegistrationService.shared.handleDeviceToken(token)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Esperado en simulador sin soporte APNs — no es un error de app.
        debugLog("[Push] registro APNs falló: \(error.localizedDescription)")
    }
}

@main
struct FocusApp: App {
    @UIApplicationDelegateAdaptor(FocusAppDelegate.self) private var appDelegate
    @StateObject private var dataStore = FocusDataStore()
    @StateObject private var authStore = AuthStore()
    @StateObject private var coachMarks = CoachMarksStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        // Test runner gate: `FOCUS_RUN_TESTS=1` env var (preferido —
        // `SIMCTL_CHILD_FOCUS_RUN_TESTS=1` desde el host) o argumento
        // `--run-nova-tests` en argv. Algunas combinaciones de simulador/
        // versión de iOS no propagan SIMCTL_CHILD_* a `ProcessInfo`, así
        // que aceptamos ambas formas.
        let testFlag = ProcessInfo.processInfo.environment["FOCUS_RUN_TESTS"]
        let argRunAll = CommandLine.arguments.contains("--run-nova-tests")
        let argRun50 = CommandLine.arguments.contains("--run-nova-50")
        let argRunSubtitle50 = CommandLine.arguments.contains("--run-subtitle-50")
        let argRun50Final = CommandLine.arguments.contains("--run-50-final")
        let argRunMemory = CommandLine.arguments.contains("--run-memory")
        let argRunBattery = CommandLine.arguments.contains("--run-battery")
        if testFlag != nil || argRunAll || argRun50 || argRunSubtitle50 || argRun50Final || argRunMemory || argRunBattery {
            if let docs = FileManager.default.urls(
                for: .documentDirectory, in: .userDomainMask
            ).first {
                let marker = docs.appendingPathComponent("focus-tests-started.log")
                try? "init reached test branch at \(Date())".write(
                    to: marker, atomically: true, encoding: .utf8
                )
            }

            // Flag "memory" → suite de memoria Nova (Phase 1-3 wire-up).
            // Flag "subtitle50" → suite del user spec 2026-05-27 (50 casos
            // con expectativa de subtitle).
            // Flag "50" → suite anterior (kind/hour/end-time).
            // Flag "1" o default → runAll() legacy.
            let runMemory = (testFlag == "memory") || argRunMemory
            let runSubtitle50 = (testFlag == "subtitle50") || argRunSubtitle50
            let run50Final = (testFlag == "final50") || argRun50Final
            let runFiftyOnly = (testFlag == "50") || argRun50
            let runBattery = (testFlag == "battery") || argRunBattery
            let result: String
            let outName: String
            if runBattery {
                // Batería integral eventos + subtítulos + recordatorios
                // (35 complejas + 15 simples). User spec 2026-06-13.
                result = NovaActionNormalizerTests.runEventReminderBattery()
                outName = "focus-validation-battery.log"
            } else if runMemory {
                result = NovaActionNormalizerTests.runValidationMemoryCases()
                outName = "focus-validation-memory.log"
            } else if run50Final {
                result = NovaActionNormalizerTests.runValidation50FinalCases()
                outName = "focus-validation-50final.log"
            } else if runSubtitle50 {
                result = NovaActionNormalizerTests.runValidationSubtitle50Cases()
                outName = "focus-validation-subtitle50.log"
            } else if runFiftyOnly {
                result = NovaActionNormalizerTests.runValidation50Cases()
                outName = "focus-validation-50.log"
            } else {
                result = NovaActionNormalizerTests.runAll()
                outName = "focus-tests.log"
            }
            print("===== NOVA TESTS =====\n\(result)\n=====================")
            if let docs = FileManager.default.urls(
                for: .documentDirectory, in: .userDomainMask
            ).first {
                let path = docs.appendingPathComponent(outName)
                try? result.write(to: path, atomically: true, encoding: .utf8)
            }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            // Background cobalto cuya color matchea EXACTAMENTE el asset
            // LaunchBackground (#1E2D6B = rgb 0.118/0.176/0.420). Sin esto,
            // entre el iOS launch screen y el primer paint del BootView
            // SwiftUI mostraba 1-2 frames de Color.white default → flash
            // blanco. Ahora cualquier vista hija que NO pinte su propio
            // fondo deja ver cobalto, no blanco.
            ZStack {
                Color(red: 0.118, green: 0.176, blue: 0.420)
                    .ignoresSafeArea()
                ContentView()
                // Overlay global de coach marks — se monta acá para que
                // ningún sheet/tab interfiera con el zIndex. La card aparece
                // cuando `coachMarks.presenting != nil`.
                CoachMarkOverlay(store: coachMarks)
            }
            .environmentObject(dataStore)
            .environmentObject(authStore)
            .environmentObject(coachMarks)
            .preferredColorScheme(.light)
            .tint(Theme.Colors.focusAccent)
            // Conexión Auth → DataStore para sync Supabase. Cuando
            // cambia el estado de auth (login, refresh, logout, demo),
            // empujamos credenciales al store. Si hay sesión, dispara
            // fetch remoto + habilita upserts en mutaciones.
            .task(id: authChangeId) {
                syncAuthIntoDataStore()
            }
            // Al reactivarse la app, renovar el token si está por expirar.
            // Antes el refresh solo corría en AuthStore.init() → una sesión
            // viva > TTL del token quedaba con token muerto y Nova caía al
            // parser local (bug 2026-05-28).
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    authStore.refreshIfNeeded()
                    // Push remotas: si el permiso de notificaciones ya está
                    // concedido, pedir/renovar el device token de APNs.
                    // Idempotente y barato — iOS re-entrega el token cacheado.
                    Task { await PushRegistrationService.shared.registerIfAuthorized() }
                }
            }
            // Bootstrap notificaciones locales: al arrancar la app,
            // re-asegurar que cada recordatorio futuro tenga su notif
            // programada. iOS no persiste notifs locales al reinstalar
            // ni siempre tras updates, así que esto cubre el gap.
            // Solo dispara una vez por sesión.
            .task {
                dataStore.bootstrapLocalNotifications()
            }
        }
    }

    /// Identidad que cambia cada vez que el `AuthState` produce credenciales
    /// distintas. Sirve como key del `.task(id:)` para re-evaluar.
    private var authChangeId: String {
        switch authStore.state {
        case .loggedIn(let session):
            // Incluir expiresAt → cuando un refresh renueva el token, el id
            // cambia y `.task(id:)` re-empuja las nuevas credenciales al
            // dataStore (si solo usáramos userId, el token renovado no
            // llegaría a syncCredentials y Nova seguiría con el viejo).
            return "loggedIn:\(session.userId):\(session.expiresAt.timeIntervalSince1970)"
        case .demo:
            return "demo"
        case .loggedOut, .codeSent, .loading:
            return "loggedOut"
        }
    }

    private func syncAuthIntoDataStore() {
        if case .loggedIn(let session) = authStore.state,
           let userId = UUID(uuidString: session.userId) {
            dataStore.applyAuthChange(
                accessToken: session.accessToken,
                userId: userId
            )
            // Con sesión activa: subir el device token de APNs al backend
            // (si ya llegó) y pedirlo si el permiso de notifs existe.
            PushRegistrationService.shared.updateCredentials(
                accessToken: session.accessToken,
                userId: session.userId
            )
            Task { await PushRegistrationService.shared.registerIfAuthorized() }
        } else {
            dataStore.applyAuthChange(accessToken: nil, userId: nil)
            PushRegistrationService.shared.updateCredentials(accessToken: nil, userId: nil)
        }
    }
}
