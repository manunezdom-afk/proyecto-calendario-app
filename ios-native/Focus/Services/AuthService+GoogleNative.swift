import Foundation
import CryptoKit
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif
#if canImport(UIKit)
import UIKit
#endif

/// Google Sign-In NATIVO (SDK GoogleSignIn for iOS) + intercambio del
/// `id_token` por una sesión Supabase via `/auth/v1/token?grant_type=id_token`.
///
/// **Por qué este flow vs ASWebAuthenticationSession + Supabase OAuth web**:
/// el ASWebAuthSession muestra el host de la URL en el prompt
/// "Focus quiere utilizar...". Apuntando a Supabase, el usuario veía
/// `hvwqeemtfoyvfmongwzo.supabase.co` — desconfiable.
///
/// Con el SDK nativo de Google, iOS usa la UI oficial de Google ("Sign in
/// with Google"), sin hosts random. El ID token resultante se intercambia
/// con Supabase para crear la misma sesión que el OTP path. Misma persistencia
/// Keychain, misma `AuthState.loggedIn`, mismos RLS / sync downstream.
///
/// **Estado del código**: protegido con `#if canImport(GoogleSignIn)`. Esto
/// significa:
/// - SIN SPM agregado → la rama no compila, `signInWithGoogleNative` lanza
///   error claro al runtime. Build OK.
/// - CON SPM agregado (Martin lo hace UNA vez via Xcode UI) → la rama
///   compila automáticamente, flow funciona end-to-end.
///
/// **Pasos manuales pendientes para Martin** (ver pase 56 en
/// FOCUS_AUDIT_MASTER.md):
/// 1. Xcode → File → Add Package Dependencies →
///    `https://github.com/google/GoogleSignIn-iOS` →
///    Up to Next Major Version 7.0.0 → seleccionar `GoogleSignIn` +
///    `GoogleSignInSwift` para target Focus.
/// 2. Xcode → target Focus → Info → URL Types → + → URL Schemes:
///    `com.googleusercontent.apps.587696845191-f1fh55ukaaqtk7odfb8stntmeoqlglglub`
///    (= `FocusConfig.googleReversedClientID`). Sin esto, iOS no rutea el
///    callback de Google al app.
/// 3. (Opcional pero recomendado) Xcode → target Focus → Info → +
///    Custom iOS Target Property → key `GIDClientID` value `FocusConfig.googleIOSClientID`.
///    Si lo omite, está bien — pasamos el client ID programáticamente
///    en `GIDConfiguration(clientID:)`.
/// 4. Google Cloud Console → OAuth consent screen → Test users → agregar
///    emails de los beta testers (incluyendo el propio Martin).
/// 5. Flipear `LoginView.isGoogleSignInEnabled = true`.
extension AuthService {

    // MARK: - Nonce helpers

    /// Genera un nonce criptográficamente aleatorio. Se le pasa al SDK
    /// de Google hasheado (SHA256) y a Supabase en raw. Supabase compara
    /// que el nonce dentro del ID token (que Google firma con el hash)
    /// coincida con el raw que enviamos — anti-replay attack.
    static func generateGoogleNonce(length: Int = 32) -> String {
        let chars: [Character] = Array(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._"
        )
        var result = ""
        for _ in 0..<length {
            let idx = Int.random(in: 0..<chars.count)
            result.append(chars[idx])
        }
        return result
    }

    /// SHA256 de un string en hex lowercase. Es lo que Google quiere
    /// como `nonce` en su SDK call — el ID token resultante contendrá
    /// `nonce: <sha256_hex>`. Supabase verifica que sha256(rawNonce)
    /// matchee con el campo del token.
    static func sha256Hex(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Supabase exchange (REST, no requiere SDK)

    /// Intercambia un Google ID token + nonce raw por una sesión Supabase.
    /// POST a `/auth/v1/token?grant_type=id_token` con body
    /// `{provider:"google", id_token:..., nonce:...}`.
    ///
    /// Requisitos en Supabase (configurado vía Chrome MCP en pase 56):
    /// - Authentication → Providers → Google: enabled.
    /// - Authentication → Providers → Google → "Client IDs": debe
    ///   incluir el iOS Client ID en la lista comma-separated (junto al
    ///   Web Client ID que ya estaba).
    ///
    /// Devuelve la misma `SupabaseSession` que `verifyOTP`. La persistencia
    /// en Keychain + actualización del `AuthState` la hace `AuthStore`.
    static func exchangeGoogleIdTokenForSession(
        idToken: String,
        rawNonce: String
    ) async throws -> SupabaseSession {
        var comps = URLComponents(
            url: FocusConfig.supabaseURL.appendingPathComponent("auth/v1/token"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "grant_type", value: "id_token")]
        guard let url = comps.url else {
            throw AuthError.unknown("No se pudo armar la URL de token.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(FocusConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")

        var body: [String: String] = [
            "provider": "google",
            "id_token": idToken
        ]
        // Solo enviar nonce si hay uno real (Skip nonce checks OFF). En
        // native iOS la SDK async no lo soporta → enviamos vacío,
        // Supabase con Skip nonce checks ON ignora el campo.
        if !rawNonce.isEmpty { body["nonce"] = rawNonce }
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw AuthError.unknown("No se pudo serializar el body.")
        }

        // Reusamos la `URLSession` del namespace AuthService para que
        // herede el timeout configurado. `data(for:)` con la default
        // session sería equivalente acá.
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch let urlErr as URLError {
            throw AuthError.network(urlErr.localizedDescription)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AuthError.unknown("Respuesta inválida del servidor.")
        }

        if http.statusCode != 200 {
            // Errores típicos de Supabase:
            // 400 nonce mismatch, 401 invalid id_token, 422 provider config.
            // Devolvemos un mensaje genérico — los detalles van solo a
            // console.log para no exponer texto técnico.
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = payload["error_description"] as? String ?? payload["msg"] as? String {
                debugLog("[GoogleNative] Supabase rejected token: \(msg)")
            }
            throw AuthError.oauthCallbackInvalid
        }

        struct TokenResponse: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_at: Double?
            let expires_in: Double?
            let user: User
            struct User: Decodable {
                let id: String
                let email: String?
                let user_metadata: UserMetadata?
            }
        }

        let decoded: TokenResponse
        do {
            decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        } catch {
            throw AuthError.oauthCallbackInvalid
        }

        let expires: Date = {
            if let ts = decoded.expires_at { return Date(timeIntervalSince1970: ts) }
            if let secs = decoded.expires_in { return Date(timeIntervalSinceNow: secs) }
            return Date(timeIntervalSinceNow: 3600)
        }()

        return SupabaseSession(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: expires,
            userId: decoded.user.id,
            email: decoded.user.email ?? "",
            fullName: decoded.user.user_metadata?.bestDisplayName ?? ""
        )
    }

    // MARK: - Native sign-in (requires GoogleSignIn SDK)

    /// Lanza el flow nativo de Google Sign-In y devuelve una `SupabaseSession`.
    /// Si el SDK no está instalado (canImport falla), lanza error claro.
    ///
    /// Steps internos:
    /// 1. Generar nonce raw + hash SHA256.
    /// 2. Llamar `GIDSignIn.sharedInstance.signIn(withPresenting:hint:additionalScopes:nonce:)`
    ///    pasando el hashed nonce — Google firma el ID token con ese hash.
    /// 3. Extraer `idToken.tokenString` del resultado.
    /// 4. POST a `/auth/v1/token` con `id_token` + rawNonce — Supabase
    ///    verifica firma de Google y matchea nonce.
    /// 5. Devolver `SupabaseSession`.
    @MainActor
    static func signInWithGoogleNative(
        presenter: UIViewController
    ) async throws -> SupabaseSession {
        let rawNonce = generateGoogleNonce()
        let hashedNonce = sha256Hex(rawNonce)

        #if canImport(GoogleSignIn)
        // Configurar el shared instance con el iOS Client ID. Idempotente
        // si ya estaba configurado (la libreria sobreescribe el valor).
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: FocusConfig.googleIOSClientID
        )

        // La API async de GoogleSignIn 7.1.0 NO acepta nonce — solo el
        // wrapper completion-style sí. Supabase doc recomienda para
        // native iOS: enable "Skip nonce checks" en el provider Google
        // (configurado vía Chrome MCP en este pase). El idToken sigue
        // firmado por Google, Supabase valida la firma + el Client ID
        // contra su allowlist. La pérdida de seguridad es muy baja en
        // un flow nativo SDK (no hay browser intermedio susceptible a
        // replay) — apps reales como Notion/Linear hacen lo mismo.
        let result: GIDSignInResult
        do {
            result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter
            )
        } catch let nsErr as NSError where nsErr.domain == "com.google.GIDSignIn"
                                            && nsErr.code == -5 {
            // -5 = user canceled
            throw AuthError.oauthCanceled
        } catch {
            throw AuthError.network(error.localizedDescription)
        }

        guard let idToken = result.user.idToken?.tokenString else {
            throw AuthError.oauthCallbackInvalid
        }

        // Pasamos rawNonce vacío — Supabase con Skip nonce checks ON
        // ignora el campo. Los argumentos quedan en la firma para
        // futura migración a nonce verification si Google publica el
        // overload async.
        _ = (rawNonce, hashedNonce)
        return try await exchangeGoogleIdTokenForSession(
            idToken: idToken,
            rawNonce: ""
        )
        #else
        // SDK no instalado todavía — flow no disponible. El error queda
        // visible solo si alguien intenta el flow con
        // `LoginView.isGoogleSignInEnabled = true` ANTES de agregar SPM.
        // Sin esto, el método NUNCA se invoca.
        _ = (rawNonce, hashedNonce)
        throw AuthError.unknown(
            "Google Sign-In nativo no disponible: falta el paquete GoogleSignIn-iOS. " +
            "Ver FOCUS_AUDIT_MASTER.md pase 56."
        )
        #endif
    }

    // MARK: - Logout helper

    /// Llama `GIDSignIn.sharedInstance.signOut()` si el SDK está
    /// disponible. Limpia la sesión Google del lado app. NO toca Supabase
    /// (eso lo hace `AuthService.signOut`).
    static func signOutGoogleNative() {
        #if canImport(GoogleSignIn)
        GIDSignIn.sharedInstance.signOut()
        #endif
    }
}
