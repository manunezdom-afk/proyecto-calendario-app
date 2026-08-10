import Foundation
import AuthenticationServices

// MARK: - Errors

enum AuthError: Error, LocalizedError {
    case configMissing
    case invalidEmail
    case rateLimited
    case emailNotConfigured
    case emailSendFailed
    case invalidCode
    case otpExpired
    case oauthCanceled
    case oauthProviderNotConfigured
    case oauthCallbackInvalid
    case network(String)
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .configMissing:
            return "Auth no configurada. Falta el anon key de Supabase en FocusConfig.swift."
        case .invalidEmail:
            return "El correo no parece válido."
        case .rateLimited:
            return "Demasiados intentos. Espera un minuto antes de pedir otro código."
        case .emailNotConfigured:
            return "El servidor de envío de correos no está configurado todavía."
        case .emailSendFailed:
            return "No pudimos enviar el correo. Prueba de nuevo en un minuto."
        case .invalidCode:
            return "El código es incorrecto. Revísalo o pide uno nuevo."
        case .otpExpired:
            return "El código expiró. Pide uno nuevo."
        case .oauthCanceled:
            return "Inicio de sesión cancelado."
        case .oauthProviderNotConfigured:
            return "Google sign-in todavía no está configurado en Supabase. Avísanos."
        case .oauthCallbackInvalid:
            return "Recibimos una respuesta inválida de Google. Vuelve a intentar."
        case .network(let msg):
            return "Error de red: \(msg)"
        case .unknown(let msg):
            return msg
        }
    }
}

// MARK: - Session model

/// Sesión de Supabase persistible (in-memory + Keychain).
struct SupabaseSession: Codable, Hashable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userId: String
    let email: String
    /// Nombre completo (Google `name`/`full_name` o Supabase
    /// `user_metadata.full_name`). Vacío si el provider no lo dio (típico
    /// en OTP-only sin perfil enriquecido). La UI debe caer al email.
    var fullName: String

    var isExpired: Bool {
        expiresAt <= Date()
    }

    init(accessToken: String, refreshToken: String, expiresAt: Date,
         userId: String, email: String, fullName: String = "") {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userId = userId
        self.email = email
        self.fullName = fullName
    }

    /// Decoder custom para no romper sesiones persistidas en disco antes de
    /// que existiera el campo `fullName`. Si la key no existe → string vacío.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.accessToken = try c.decode(String.self, forKey: .accessToken)
        self.refreshToken = try c.decode(String.self, forKey: .refreshToken)
        self.expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        self.userId = try c.decode(String.self, forKey: .userId)
        self.email = try c.decode(String.self, forKey: .email)
        self.fullName = try c.decodeIfPresent(String.self, forKey: .fullName) ?? ""
    }
}

// MARK: - Service

/// Capa HTTP para autenticación. Stateless.
/// - `sendOTP`: pega contra nuestro `/api/auth/email/send-otp` (Resend SMTP).
/// - `verifyOTP`: pega contra `<supabase>/auth/v1/verify` directamente.
enum AuthService {

    // MARK: - Network plumbing

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    // MARK: - Send OTP

    private struct SendBody: Encodable { let email: String }

    /// Envía el código OTP al correo. No devuelve el código (se entrega por email).
    static func sendOTP(email: String) async throws {
        let clean = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard clean.contains("@"), clean.count > 3, clean.count <= 254 else {
            throw AuthError.invalidEmail
        }

        let url = FocusConfig.apiOrigin.appendingPathComponent("/api/auth/email/send-otp")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(SendBody(email: clean))

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                throw AuthError.unknown("Respuesta HTTP inválida")
            }
            switch http.statusCode {
            case 200:
                return
            case 400:
                let body = try? decoder.decode(ErrorBody.self, from: data)
                if body?.error == "invalid_email" {
                    throw AuthError.invalidEmail
                }
                throw AuthError.unknown("Solicitud inválida")
            case 429:
                throw AuthError.rateLimited
            case 503:
                let body = try? decoder.decode(ErrorBody.self, from: data)
                if body?.error == "email_not_configured" {
                    throw AuthError.emailNotConfigured
                }
                throw AuthError.unknown("Servicio no configurado")
            case 502:
                throw AuthError.emailSendFailed
            default:
                throw AuthError.unknown("HTTP \(http.statusCode)")
            }
        } catch let err as AuthError {
            throw err
        } catch let err as URLError {
            throw AuthError.network(err.localizedDescription)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
    }

    // MARK: - Verify OTP

    private struct VerifyBody: Encodable {
        let email: String
        let token: String
        let type: String
    }

    /// Verifica el código contra Supabase y devuelve la sesión completa.
    static func verifyOTP(email: String, token: String) async throws -> SupabaseSession {
        guard FocusConfig.isAuthConfigured else {
            throw AuthError.configMissing
        }

        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // Supabase puede estar configurado en 6 u 8 dígitos — no truncamos.
        let cleanToken = token.filter(\.isNumber)
        guard cleanToken.count >= 6, cleanToken.count <= 10 else {
            throw AuthError.invalidCode
        }

        let url = FocusConfig.supabaseURL.appendingPathComponent("/auth/v1/verify")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(FocusConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(FocusConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try encoder.encode(VerifyBody(email: cleanEmail, token: cleanToken, type: "email"))

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                throw AuthError.unknown("Respuesta HTTP inválida")
            }

            if (200..<300).contains(http.statusCode) {
                let r = try decoder.decode(VerifyResponse.self, from: data)
                let expiresAt = Date(timeIntervalSince1970: r.expires_at)
                return SupabaseSession(
                    accessToken: r.access_token,
                    refreshToken: r.refresh_token,
                    expiresAt: expiresAt,
                    userId: r.user.id,
                    email: r.user.email ?? cleanEmail,
                    fullName: r.user.user_metadata?.bestDisplayName ?? ""
                )
            }

            // Errores de Supabase
            let body = try? decoder.decode(ErrorBody.self, from: data)
            let raw = body?.error_description ?? body?.msg ?? body?.error ?? ""
            let msg = raw.lowercased()

            if msg.contains("expired") {
                throw AuthError.otpExpired
            }
            if msg.contains("invalid") || msg.contains("incorrect") || msg.contains("token") {
                throw AuthError.invalidCode
            }
            if http.statusCode == 400 || http.statusCode == 401 || http.statusCode == 403 {
                throw AuthError.invalidCode
            }
            throw AuthError.unknown(raw.isEmpty ? "HTTP \(http.statusCode)" : raw)
        } catch let err as AuthError {
            throw err
        } catch let err as URLError {
            throw AuthError.network(err.localizedDescription)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
    }

    // MARK: - Refresh session

    private struct RefreshBody: Encodable {
        let refresh_token: String
    }

    /// Renueva la sesión usando el refresh token. Devuelve la nueva sesión
    /// (con nuevo access_token + posiblemente nuevo refresh_token rotado).
    ///
    /// Endpoint: `POST /auth/v1/token?grant_type=refresh_token`.
    /// Supabase a veces rota el refresh_token (recomendado) y a veces lo
    /// reutiliza — siempre tomamos el que viene en la respuesta.
    static func refreshSession(refreshToken: String) async throws -> SupabaseSession {
        guard FocusConfig.isAuthConfigured else {
            throw AuthError.configMissing
        }
        guard !refreshToken.isEmpty else {
            throw AuthError.invalidCode
        }

        var components = URLComponents(
            url: FocusConfig.supabaseURL.appendingPathComponent("/auth/v1/token"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = components?.url else {
            throw AuthError.unknown("URL refresh inválida")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(FocusConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(FocusConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try encoder.encode(RefreshBody(refresh_token: refreshToken))

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                throw AuthError.unknown("Respuesta HTTP inválida")
            }

            if (200..<300).contains(http.statusCode) {
                let r = try decoder.decode(RefreshResponse.self, from: data)
                // Supabase puede devolver expires_at (Unix seconds) o sólo
                // expires_in (TTL en segundos). Preferimos expires_at; si
                // falta, derivamos de expires_in.
                let expiresAt: Date
                if let absolute = r.expires_at {
                    expiresAt = Date(timeIntervalSince1970: absolute)
                } else if let ttl = r.expires_in {
                    expiresAt = Date().addingTimeInterval(TimeInterval(ttl))
                } else {
                    // Fallback ultra-conservador: 1 hora desde ahora.
                    expiresAt = Date().addingTimeInterval(3600)
                }
                return SupabaseSession(
                    accessToken: r.access_token,
                    // Supabase a veces no devuelve refresh nuevo (raro). Si no
                    // viene, reutilizamos el viejo — sigue siendo válido hasta
                    // que el server lo rote.
                    refreshToken: r.refresh_token ?? refreshToken,
                    expiresAt: expiresAt,
                    userId: r.user?.id ?? "",
                    email: r.user?.email ?? "",
                    fullName: r.user?.user_metadata?.bestDisplayName ?? ""
                )
            }

            // Errores: refresh token vencido/revocado → forzar re-login.
            let body = try? decoder.decode(ErrorBody.self, from: data)
            let raw = body?.error_description ?? body?.msg ?? body?.error ?? ""
            let msg = raw.lowercased()
            if msg.contains("expired") || msg.contains("invalid") || http.statusCode == 401 {
                throw AuthError.otpExpired
            }
            throw AuthError.unknown(raw.isEmpty ? "HTTP \(http.statusCode)" : raw)
        } catch let err as AuthError {
            throw err
        } catch let err as URLError {
            throw AuthError.network(err.localizedDescription)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
    }

    // MARK: - Sign out

    /// MVP: solo limpia local. Cuando agreguemos sync con backend, llamar
    /// `/auth/v1/logout` con el bearer para invalidar el refresh token server-side.
    static func signOut() {
        KeychainStore.clearAllAuth()
    }

    // MARK: - Delete account

    private struct DeleteAccountBody: Encodable { let confirm: String }

    /// Borra la cuenta del usuario y TODOS sus datos en el backend
    /// (Guideline 5.1.1(v) — eliminación de cuenta in-app). Irreversible.
    /// La UI pide confirmación tipeando "ELIMINAR" ANTES de llamar aquí; el
    /// literal "DELETE" del body es el cinturón que exige el endpoint
    /// (`api/auth/delete-account.js`), no el texto que ve el usuario.
    static func deleteAccount(accessToken: String) async throws {
        let url = FocusConfig.apiOrigin.appendingPathComponent("/api/auth/delete-account")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try encoder.encode(DeleteAccountBody(confirm: "DELETE"))

        do {
            let (_, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                throw AuthError.unknown("Respuesta HTTP inválida")
            }
            switch http.statusCode {
            case 200:
                return
            case 401:
                throw AuthError.unknown("Tu sesión expiró. Inicia sesión de nuevo e inténtalo otra vez.")
            case 429:
                throw AuthError.rateLimited
            default:
                throw AuthError.unknown("No se pudo eliminar la cuenta (HTTP \(http.statusCode)). Inténtalo de nuevo.")
            }
        } catch let err as AuthError {
            throw err
        } catch let err as URLError {
            throw AuthError.network(err.localizedDescription)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
    }

    // MARK: - OAuth (Google)

    /// URL scheme custom registrado en pbxproj (`CFBundleURLTypes`). Tiene
    /// que matchear EXACTAMENTE el "Redirect URL" configurado en Supabase
    /// Dashboard → Authentication → URL Configuration.
    static let oauthCallbackScheme = "focus"
    static let oauthCallbackHost = "auth-callback"
    static var oauthRedirectURL: String { "\(oauthCallbackScheme)://\(oauthCallbackHost)" }

    /// Inicia el flujo OAuth de Google usando ASWebAuthenticationSession.
    /// El sistema abre Safari "in-app" (sin salir de Focus), el usuario se
    /// autentica con Google, Supabase devuelve `focus://auth-callback#access_token=...`
    /// y este método parsea los tokens y construye la `SupabaseSession`.
    ///
    /// Requisitos de configuración (todos aplicados al 2026-05-12):
    /// - Supabase Authentication → URL Configuration → Redirect URLs
    ///   incluye `focus://auth-callback` (pase 53 via Chrome MCP).
    /// - Supabase Authentication → Providers → Google: enabled con
    ///   Client ID + Secret de Google Cloud (pase 53 verified).
    /// - NO requiere `CFBundleURLTypes` en Info.plist: ASWebAuthSession
    ///   intercepta el callback por `callbackURLScheme` antes del sistema.
    ///
    /// **Limitación conocida**: iOS muestra el host técnico de Supabase
    /// (`hvwqeemtfoyvfmongwzo.supabase.co`) en el prompt
    /// "Focus quiere utilizar...". Esto es inherente a
    /// `ASWebAuthenticationSession` — siempre muestra el host de la URL
    /// que va a cargar. Solución real: Supabase Custom Auth Domain
    /// (feature Pro, ~$25/mes) — configurar p.ej. `auth.usefocus.me`
    /// como CNAME y cambiar `FocusConfig.supabaseURL`. Alternativa:
    /// SDK nativo `GoogleSignIn` (Apple/Google directo, sin Supabase
    /// como intermediario en el browser). No bloquea beta cerrada.
    @MainActor
    static func signInWithGoogle(presentationAnchor: ASPresentationAnchor) async throws -> SupabaseSession {
        // 1. Construir la URL de inicio OAuth contra Supabase.
        var comps = URLComponents(
            url: FocusConfig.supabaseURL.appendingPathComponent("auth/v1/authorize"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: oauthRedirectURL),
            // `prompt=select_account` fuerza que Google muestre el
            // selector de cuentas SIEMPRE, incluso si ya hay sesión
            // activa en el navegador. Mejor UX: el usuario ve
            // explícitamente qué cuenta está usando para entrar a Focus.
            // Sin este param, si ya está logueado en Google, el flow
            // auto-completa sin mostrar nada — confuso si el usuario
            // tiene varias cuentas (personal, trabajo, etc.).
            URLQueryItem(name: "query_params",
                         value: "prompt=select_account")
        ]
        guard let startURL = comps.url else {
            throw AuthError.unknown("No se pudo armar la URL de OAuth.")
        }

        // 2. Lanzar ASWebAuthenticationSession y esperar callback.
        let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
            let presenter = OAuthPresenter(anchor: presentationAnchor)
            let session = ASWebAuthenticationSession(
                url: startURL,
                callbackURLScheme: oauthCallbackScheme
            ) { callbackURL, error in
                if let nsErr = error as? ASWebAuthenticationSessionError, nsErr.code == .canceledLogin {
                    cont.resume(throwing: AuthError.oauthCanceled)
                    return
                }
                if let error {
                    cont.resume(throwing: AuthError.network(error.localizedDescription))
                    return
                }
                guard let callbackURL else {
                    cont.resume(throwing: AuthError.oauthCallbackInvalid)
                    return
                }
                cont.resume(returning: callbackURL)
            }
            session.presentationContextProvider = presenter
            session.prefersEphemeralWebBrowserSession = false
            // Retener el presenter mientras la sesión está viva. La closure
            // captura `presenter`; cuando ASWebAuthenticationSession invoque
            // su completion, se libera.
            _ = presenter
            session.start()
        }

        // 3. Supabase devuelve tokens en el FRAGMENT, no en query string.
        //    Ej: focus://auth-callback#access_token=...&refresh_token=...&expires_at=...
        //    El URLComponents nativo no parsea fragments con &, lo hacemos a mano.
        let fragment = callbackURL.fragment ?? ""
        let pairs = fragment.split(separator: "&").reduce(into: [String: String]()) { acc, item in
            let kv = item.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 {
                acc[kv[0]] = kv[1].removingPercentEncoding ?? kv[1]
            }
        }

        // Si Supabase respondió con error (provider no habilitado, etc.).
        if let errorCode = pairs["error"] {
            // Errores típicos: "server_error" cuando Google provider no está
            // configurado, "access_denied" si el usuario rechazó permisos.
            if errorCode == "access_denied" {
                throw AuthError.oauthCanceled
            }
            throw AuthError.oauthProviderNotConfigured
        }

        guard let accessToken = pairs["access_token"],
              let refreshToken = pairs["refresh_token"]
        else {
            throw AuthError.oauthCallbackInvalid
        }

        // expires_at viene como Unix timestamp; si no viene, calculamos
        // 1 hora desde ahora como fallback razonable.
        let expiresAt: Date = {
            if let ts = pairs["expires_at"], let v = Double(ts) {
                return Date(timeIntervalSince1970: v)
            }
            if let inStr = pairs["expires_in"], let secs = Double(inStr) {
                return Date(timeIntervalSinceNow: secs)
            }
            return Date(timeIntervalSinceNow: 3600)
        }()

        // 4. Obtener el user (id + email) a partir del access token. El
        //    fragment no incluye user data; consultamos /auth/v1/user.
        let (userId, email) = try await fetchUserInfo(accessToken: accessToken)

        return SupabaseSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            userId: userId,
            email: email
        )
    }

    /// GET /auth/v1/user con bearer token. Devuelve (userId, email).
    private static func fetchUserInfo(accessToken: String) async throws -> (String, String) {
        let url = FocusConfig.supabaseURL.appendingPathComponent("auth/v1/user")
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(FocusConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AuthError.oauthCallbackInvalid
        }

        struct UserPayload: Decodable {
            let id: String
            let email: String?
        }
        guard let payload = try? decoder.decode(UserPayload.self, from: data) else {
            throw AuthError.oauthCallbackInvalid
        }
        return (payload.id, payload.email ?? "")
    }
}

// MARK: - ASWebAuthenticationSession presentation

/// Helper que provee el anchor de presentación para
/// `ASWebAuthenticationSession`. Necesario en iOS — sin un anchor válido
/// el flujo no arranca.
private final class OAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    let anchor: ASPresentationAnchor

    init(anchor: ASPresentationAnchor) {
        self.anchor = anchor
        super.init()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor
    }
}

// MARK: - Wire types (privados al servicio)

private struct VerifyResponse: Decodable {
    let access_token: String
    let refresh_token: String
    let expires_at: Double
    let user: SBUser

    struct SBUser: Decodable {
        let id: String
        let email: String?
        let user_metadata: UserMetadata?
    }
}

private struct RefreshResponse: Decodable {
    let access_token: String
    let refresh_token: String?
    let expires_at: Double?
    let expires_in: Int?
    let user: SBUser?

    struct SBUser: Decodable {
        let id: String
        let email: String?
        let user_metadata: UserMetadata?
    }
}

/// Subset de `user_metadata` que nos interesa. Supabase guarda metadata
/// arbitraria pero estos campos son los que llenan Google y los proveedores
/// más comunes:
///   - `full_name`: "Martín Núñez" (Google `name`).
///   - `name`: a veces presente con el mismo valor que `full_name`.
///   - `given_name` / `family_name`: nombre/apellido por separado.
/// Si el usuario solo hizo OTP sin enriquecer perfil, todos vienen nil → la
/// UI cae al email.
struct UserMetadata: Decodable {
    let full_name: String?
    let name: String?
    let given_name: String?
    let family_name: String?

    /// Mejor nombre disponible, priorizando full_name → name → "given family".
    /// Devuelve string vacío si nada está disponible.
    var bestDisplayName: String {
        if let fn = full_name?.trimmingCharacters(in: .whitespacesAndNewlines), !fn.isEmpty {
            return fn
        }
        if let n = name?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty {
            return n
        }
        let given = given_name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let family = family_name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let combined = [given, family].filter { !$0.isEmpty }.joined(separator: " ")
        return combined
    }
}

private struct ErrorBody: Decodable {
    let error: String?
    let error_description: String?
    let msg: String?
    let code: String?
}
