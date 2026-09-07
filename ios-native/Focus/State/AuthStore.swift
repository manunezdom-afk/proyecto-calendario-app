import SwiftUI
import Foundation
import AuthenticationServices

/// Estado actual de la autenticación.
enum AuthState: Equatable {
    case loading                    // Resolviendo Keychain (instantáneo en práctica)
    case loggedOut                  // Sin sesión, sin demo
    case codeSent(email: String)    // Email enviado, esperando código
    case loggedIn(SupabaseSession)  // Sesión activa
    case demo                       // Modo demo (sin login real)
}

/// Store de autenticación. Se inyecta como `@EnvironmentObject` y reacciona
/// a cambios de `state`.
@MainActor
final class AuthStore: ObservableObject {
    @Published var state: AuthState = .loading
    @Published var lastError: String? = nil
    @Published var isWorking: Bool = false

    private let expiresAtKey = "focus.v1.auth.expiresAt"
    private let localModeKey = "focus.v2.auth.localMode"
    /// Guard de reentrancia para que múltiples gatillos de refresh (init +
    /// scenePhase) no disparen llamadas concurrentes al endpoint de token.
    private var isRefreshing = false
    private var authGeneration = UUID()
    /// Timer proactivo de refresh. `refreshIfNeeded()` solo corría en init +
    /// scenePhase `.active`; una app mucho rato en primer plano (sin
    /// transición de escena) dejaba expirar el access token → Nova caía al
    /// parser local mid-sesión. Este timer renueva proactivamente.
    private var refreshTimer: Timer?

    init() {
        #if DEBUG
        if CommandLine.arguments.contains("--ui-testing") {
            state = CommandLine.arguments.contains("--onboarding") ? .loggedOut : .demo
            return
        }
        #endif
        if let session = loadPersistedSession() {
            if !session.isExpired {
                // Sesión válida — entrar directo.
                state = .loggedIn(session)
            } else if !session.refreshToken.isEmpty {
                // Access token expirado pero hay refresh token: arrancar en
                // loading y disparar refresh asíncrono. Si funciona, la sesión
                // se renueva sin que el usuario vea Login.
                // Keep account-owned local data usable without connectivity.
                state = .loggedIn(session)
                Task { [weak self] in
                    await self?.attemptRefresh(using: session)
                }
            } else {
                // Hay datos pero sin refresh — limpio y a Login.
                KeychainStore.clearAllAuth()
                state = .loggedOut
            }
        } else {
            state = UserDefaults.standard.bool(forKey: localModeKey) ? .demo : .loggedOut
        }
        startRefreshTimer()
    }

    deinit { refreshTimer?.invalidate() }

    // MARK: - Refresh

    /// Renueva proactivamente cada 60s aunque la app siga en primer plano (sin
    /// transición de escena). Arregla el bug donde el access token expiraba
    /// mid-sesión y Nova caía al parser local. `refreshIfNeeded()` es no-op
    /// hasta 120s antes de expirar, así que el costo es nulo el resto del tiempo.
    private func startRefreshTimer() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshIfNeeded() }
        }
    }

    /// Intenta renovar la sesión con el refresh token persistido. Solo se
    /// llama desde `init()` cuando la sesión está expirada. Si falla, limpia
    /// los tokens locales y manda al usuario a Login con un mensaje claro.
    /// **No toca datos locales** (eventos/tareas/etc) — solo limpia auth.
    /// Refresca proactivamente si el access token ya expiró o está por
    /// expirar (buffer 120s). Seguro de llamar seguido. Se invoca al volver
    /// la app a primer plano (scenePhase `.active`).
    ///
    /// **Por qué existe (bug 2026-05-28):** antes el refresh SOLO corría en
    /// `init()`. Una sesión viva más que el TTL del access token (~1h) — app
    /// mucho rato en foreground o reanudada de background sin matarla —
    /// quedaba con el token expirado: Nova recibía 401 y el cliente caía al
    /// parser local en silencio, y `Sincronizar ahora` devolvía "rechazado
    /// por RLS". Ahora renovamos al reactivarse la app.
    func refreshIfNeeded() {
        guard case .loggedIn(let session) = state else { return }
        guard !session.refreshToken.isEmpty else { return }
        let secondsToExpiry = session.expiresAt.timeIntervalSinceNow
        guard secondsToExpiry < 120 else { return }   // todavía fresco
        guard !isRefreshing else { return }
        // Network failures keep the persisted refresh token and local account
        // accessible. Only a definitive token rejection returns to login.
        Task { [weak self] in
            await self?.attemptRefresh(using: session)
        }
    }

    private func attemptRefresh(using expired: SupabaseSession) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        let generation = authGeneration
        defer { if authGeneration == generation { isRefreshing = false } }
        do {
            let renewed = try await AuthService.refreshSession(refreshToken: expired.refreshToken)
            guard authGeneration == generation,
                  case .loggedIn(let current) = state,
                  current.userId == expired.userId else { return }
            let merged = SupabaseSession(
                accessToken: renewed.accessToken,
                refreshToken: renewed.refreshToken,
                expiresAt: renewed.expiresAt,
                userId: renewed.userId.isEmpty ? expired.userId : renewed.userId,
                email: renewed.email.isEmpty ? expired.email : renewed.email,
                fullName: renewed.fullName.isEmpty ? expired.fullName : renewed.fullName
            )
            persistSession(merged)
            lastError = nil
            state = .loggedIn(merged)
        } catch {
            guard authGeneration == generation else { return }
            // A network/server failure says nothing about whether the refresh
            // token is valid. Keep it for the next retry, including an offline boot.
            if Self.requiresLogin(after: error) {
                invalidatePendingAuthentication()
                KeychainStore.clearAllAuth()
                KeychainStore.delete(.fullName)
                UserDefaults.standard.removeObject(forKey: expiresAtKey)
                lastError = "Tu sesión expiró. Vuelve a iniciar sesión."
                state = .loggedOut
            } else {
                lastError = "No pudimos renovar la conexión. Tus datos siguen disponibles en este iPhone."
            }
        }
    }

    static func requiresLogin(after error: Error) -> Bool {
        guard let authError = error as? AuthError else { return false }
        switch authError {
        case .otpExpired, .invalidCode: return true
        default: return false
        }
    }

    private func invalidatePendingAuthentication() {
        authGeneration = UUID()
        isRefreshing = false
        isWorking = false
    }

    // MARK: - Computed

    var isLoggedIn: Bool {
        if case .loggedIn = state { return true }
        return false
    }

    var isDemo: Bool {
        if case .demo = state { return true }
        return false
    }

    var isAuthenticatedOrDemo: Bool {
        isLoggedIn || isDemo
    }

    var currentEmail: String? {
        if case .loggedIn(let s) = state { return s.email }
        return nil
    }

    /// Nombre completo de la sesión activa si el provider lo dio
    /// (Google name/full_name o user_metadata.full_name). Vacío para
    /// usuarios OTP-only sin perfil enriquecido. La UI cae al email.
    var currentFullName: String? {
        if case .loggedIn(let s) = state {
            let trimmed = s.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return nil
    }

    /// Nombre que la UI muestra arriba en Ajustes/Perfil. Prioriza
    /// `fullName` real; si no hay, cae al email; si tampoco hay, devuelve
    /// "Usuario Focus".
    var displayName: String {
        if let name = currentFullName { return name }
        if let email = currentEmail, !email.isEmpty { return email }
        return "Usuario Focus"
    }

    /// True cuando la sesión activa tiene nombre real (no email). Útil
    /// para decidir si mostramos el email debajo como subtitle.
    var hasRealName: Bool {
        currentFullName != nil
    }

    var accessToken: String? {
        if case .loggedIn(let s) = state { return s.accessToken }
        return nil
    }

    // MARK: - Actions

    /// Pide código OTP al servidor.
    func sendOTP(email: String) async {
        guard !isWorking else { return }
        let generation = authGeneration
        lastError = nil
        isWorking = true
        defer { if authGeneration == generation { isWorking = false } }
        do {
            try await AuthService.sendOTP(email: email)
            guard authGeneration == generation else { return }
            let clean = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            state = .codeSent(email: clean)
            HapticManager.shared.success()
        } catch let err as AuthError {
            guard authGeneration == generation else { return }
            lastError = err.errorDescription
            HapticManager.shared.warning()
        } catch {
            guard authGeneration == generation else { return }
            lastError = error.localizedDescription
            HapticManager.shared.warning()
        }
    }

    /// Verifica el código y crea sesión.
    func verifyOTP(token: String) async {
        guard case .codeSent(let email) = state else { return }
        guard !isWorking else { return }
        let generation = authGeneration
        lastError = nil
        isWorking = true
        defer { if authGeneration == generation { isWorking = false } }
        do {
            let session = try await AuthService.verifyOTP(email: email, token: token)
            guard authGeneration == generation else { return }
            persistSession(session)
            state = .loggedIn(session)
            HapticManager.shared.success()
        } catch let err as AuthError {
            guard authGeneration == generation else { return }
            lastError = err.errorDescription
            HapticManager.shared.warning()
        } catch {
            guard authGeneration == generation else { return }
            lastError = error.localizedDescription
            HapticManager.shared.warning()
        }
    }

    /// Vuelve al paso "ingresar email".
    func changeEmail() {
        invalidatePendingAuthentication()
        lastError = nil
        state = .loggedOut
    }

    /// Pide otro código (re-send) sin volver al paso anterior.
    func resendCode() async {
        guard case .codeSent(let email) = state else { return }
        await sendOTP(email: email)
        // sendOTP setea state = .codeSent(email) de nuevo, lo que es correcto.
    }

    /// Inicia el flujo OAuth de Google. Lanza `ASWebAuthenticationSession`
    /// (Safari in-app), espera el callback `focus://auth-callback#…tokens…`,
    /// y persiste la sesión igual que el OTP path.
    ///
    /// **Status**: deprecated en favor de `signInWithGoogleNative()`.
    /// Lo dejamos para fallback temporal si el SDK nativo falla en
    /// runtime. Cuando confirmemos que el native flow es estable post-beta,
    /// se puede eliminar. iOS muestra "hvwqeemt..." en el prompt — por eso
    /// `LoginView.isGoogleSignInEnabled` controla qué flow ejecutar.
    ///
    /// `anchor` lo provee la vista (LoginView) — sin anchor válido la
    /// presentación falla en iOS 13+.
    func signInWithGoogle(presentationAnchor: ASPresentationAnchor) async {
        guard !isWorking else { return }
        let generation = authGeneration
        lastError = nil
        isWorking = true
        defer { if authGeneration == generation { isWorking = false } }
        do {
            let session = try await AuthService.signInWithGoogle(
                presentationAnchor: presentationAnchor
            )
            guard authGeneration == generation else { return }
            persistSession(session)
            state = .loggedIn(session)
            HapticManager.shared.success()
        } catch AuthError.oauthCanceled {
            // El usuario cerró el Safari sheet — silencioso, no mostramos
            // banner agresivo. El estado se mantiene como está (.loggedOut).
        } catch let err as AuthError {
            guard authGeneration == generation else { return }
            lastError = err.errorDescription
            HapticManager.shared.warning()
        } catch {
            guard authGeneration == generation else { return }
            lastError = error.localizedDescription
            HapticManager.shared.warning()
        }
    }

    /// Inicia el flow nativo de Google Sign-In via el SDK GoogleSignIn-iOS.
    /// Genera nonce, lanza la UI nativa de Google, obtiene `idToken`, lo
    /// intercambia con Supabase por una sesión. iOS NO muestra el host de
    /// Supabase — solo la pantalla oficial de Google.
    ///
    /// Requiere el package `GoogleSignIn-iOS` agregado al target (paso
    /// manual via Xcode). Sin SPM, el método throws error claro.
    ///
    /// `presenter` es el `UIViewController` activo. La vista lo resuelve
    /// con `resolveTopViewController()` igual que como hace el OAuth web.
    @MainActor
    func signInWithGoogleNative(presenter: UIViewController) async {
        guard !isWorking else { return }
        let generation = authGeneration
        lastError = nil
        isWorking = true
        defer { if authGeneration == generation { isWorking = false } }
        do {
            let session = try await AuthService.signInWithGoogleNative(
                presenter: presenter
            )
            guard authGeneration == generation else { return }
            persistSession(session)
            state = .loggedIn(session)
            HapticManager.shared.success()
        } catch AuthError.oauthCanceled {
            // Usuario tocó cancelar en la UI de Google — silencioso.
        } catch let err as AuthError {
            guard authGeneration == generation else { return }
            lastError = err.errorDescription
            HapticManager.shared.warning()
        } catch {
            guard authGeneration == generation else { return }
            lastError = error.localizedDescription
            HapticManager.shared.warning()
        }
    }

    /// Entra en modo demo (sin login).
    func enterDemo() {
        invalidatePendingAuthentication()
        UserDefaults.standard.set(true, forKey: localModeKey)
        lastError = nil
        state = .demo
        HapticManager.shared.tap()
    }

    /// Cierra sesión.
    /// NO borra datos locales (FocusDataStore) — eso queda en Ajustes
    /// como acción manual del usuario.
    func signOut() {
        invalidatePendingAuthentication()
        UserDefaults.standard.removeObject(forKey: localModeKey)
        AuthService.signOut()
        // También limpia la sesión local de Google SDK (si el package
        // está instalado). Sin esto, GIDSignIn.sharedInstance.currentUser
        // queda con el usuario anterior y el próximo signIn podría
        // auto-completar sin selector. No afecta a Supabase ni Keychain.
        AuthService.signOutGoogleNative()
        UserDefaults.standard.removeObject(forKey: expiresAtKey)
        lastError = nil
        state = .loggedOut
        HapticManager.shared.tick()
    }

    /// Sale de modo demo y vuelve a LoginView.
    func exitDemo() {
        invalidatePendingAuthentication()
        UserDefaults.standard.removeObject(forKey: localModeKey)
        lastError = nil
        state = .loggedOut
        HapticManager.shared.tick()
    }

    /// Borra la cuenta en el backend (irreversible) y limpia la sesión
    /// local. Los datos locales (FocusDataStore) los borra la vista que
    /// llama — este store no conoce al data store.
    /// Lanza `AuthError` si el backend falla; en ese caso la sesión local
    /// queda intacta para poder reintentar.
    func deleteAccount() async throws {
        guard case .loggedIn(let session) = state else {
            throw AuthError.unknown("Necesitas una sesión activa para eliminar la cuenta.")
        }
        let generation = authGeneration
        try await AuthService.deleteAccount(accessToken: session.accessToken)
        guard generation == authGeneration else { throw CancellationError() }
        invalidatePendingAuthentication()
        // La cuenta ya no existe en el backend: limpiar todo rastro local
        // de auth (Keychain + Google SDK + expiración persistida).
        AuthService.signOut()
        AuthService.signOutGoogleNative()
        UserDefaults.standard.removeObject(forKey: expiresAtKey)
        lastError = nil
        state = .loggedOut
        HapticManager.shared.tick()
    }

    // MARK: - Persistencia

    private func loadPersistedSession() -> SupabaseSession? {
        guard let access = KeychainStore.get(.accessToken),
              let refresh = KeychainStore.get(.refreshToken),
              let userId = KeychainStore.get(.userId),
              let email = KeychainStore.get(.email),
              let expiresAt = UserDefaults.standard.object(forKey: expiresAtKey) as? Date else {
            return nil
        }
        // fullName puede no estar (data legacy persistida antes de pase 64).
        // Si está vacío, la UI cae al email.
        let fullName = KeychainStore.get(.fullName) ?? ""
        return SupabaseSession(
            accessToken: access,
            refreshToken: refresh,
            expiresAt: expiresAt,
            userId: userId,
            email: email,
            fullName: fullName
        )
    }

    private func persistSession(_ s: SupabaseSession) {
        UserDefaults.standard.removeObject(forKey: localModeKey)
        KeychainStore.set(s.accessToken, forKey: .accessToken)
        KeychainStore.set(s.refreshToken, forKey: .refreshToken)
        KeychainStore.set(s.userId, forKey: .userId)
        KeychainStore.set(s.email, forKey: .email)
        KeychainStore.set(s.fullName, forKey: .fullName)
        UserDefaults.standard.set(s.expiresAt, forKey: expiresAtKey)
    }
}
