import Foundation

/// Configuración pública de Focus. NO contiene secretos.
///
/// - `supabaseURL`: URL del proyecto Supabase.
/// - `supabaseAnonKey`: clave pública del cliente (publishable). Es segura
///   en el binario — Supabase RLS controla el acceso real. NUNCA usar
///   `sb_secret_*` ni un JWT con `role: service_role` acá.
/// - `apiOrigin`: base URL del backend Vercel (donde viven /api/*).
///
/// **Formatos válidos para anon key**:
/// - `sb_publishable_*` (nuevo formato Supabase, late 2024+) — *este es el que usamos*.
/// - `eyJ...` (legacy JWT con `role: anon`) — sigue funcionando si lo prefieres.
///
/// **Cómo rotar la key**: Supabase Dashboard → Settings → API → "Publishable key".
/// Pegarla aquí y rebuild.
enum FocusConfig {
    static let supabaseURL = URL(string: "https://hvwqeemtfoyvfmongwzo.supabase.co")!

    /// Publishable key del proyecto Focus. Seguro en cliente — RLS protege los datos.
    /// Si la rotás, actualizá también `VITE_SUPABASE_ANON_KEY` en Vercel.
    static let supabaseAnonKey = "sb_publishable_uZZhxCyQPfb9K_4xawZV6g_FTUGEvhF"

    static let apiOrigin = URL(string: "https://www.usefocus.me")!

    /// Una intención sin hora puede guardarse como tarea.
    static let tasksEnabled = true

    /// Si no es nil, inyecta el header `x-vercel-protection-bypass` en
    /// CADA request a apiOrigin para saltar la SSO de Vercel Preview.
    /// SOLO debe estar set durante QA local; nil en builds productivas.
    static let vercelBypassToken: String? = nil

    /// Superficies "Próximamente" (importar/exportar calendario, calendarios
    /// conectados, resumen diario, sugerencias inteligentes, apariencia).
    /// Ocultas para App Review — Guideline 2.1/2.3.1 objeta features
    /// anunciadas no funcionales. Volver a true cuando cada una exista de
    /// verdad (o mejor: borrar el flag e ir mostrándolas al implementarlas).
    static let showComingSoonSurfaces = false

    /// True si la auth real puede funcionar (anon key presente).
    static var isAuthConfigured: Bool {
        !supabaseAnonKey.isEmpty
    }

    // MARK: - Google Sign-In (nativo iOS)

    /// OAuth Client ID de tipo **iOS** del proyecto Google Cloud
    /// `veo3-premium`. Creado vía Chrome MCP el 2026-05-12 (pase 56) con
    /// Bundle ID `me.usefocus.app` + Team ID `D8UM897B2T`. Va al Info.plist
    /// como `GIDClientID` Y configurado en Supabase Authentication →
    /// Providers → Google "Client IDs" allowlist (junto al Web client).
    /// Público: NO es secreto — el reversed scheme está en el binario
    /// igualmente.
    static let googleIOSClientID =
        "587696845191-f1fh55ukaaqtk7odfb8stntmeoqlglglub.apps.googleusercontent.com"

    /// URL scheme que Info.plist debe registrar como `CFBundleURLTypes`
    /// para que iOS rute el callback de Google al app. Es el iOS Client
    /// ID con orden invertido. Sin esto registrado en Xcode UI, el flow
    /// OAuth no completa.
    static let googleReversedClientID =
        "com.googleusercontent.apps.587696845191-f1fh55ukaaqtk7odfb8stntmeoqlglglub"
}

/// Consentimiento explícito para enviar datos a proveedores de IA externos
/// (Apple Guideline 5.1.2(i), nov 2025): antes del PRIMER mensaje que sale
/// al backend hay que nombrar al proveedor (DeepSeek) y pedir permiso.
/// Solo aplica al path remoto — el parser local del modo demo no manda nada
/// fuera del dispositivo, así que no gatea.
///
/// La key lleva versión: si cambia el proveedor principal o el texto del
/// aviso de forma sustancial, bumpear a `.v2` para volver a pedirlo.
enum NovaAIConsent {
    private static var key: String { FocusLocalStore.scopedStorageKey(for: "novaAIConsent.v2") }

    static var granted: Bool {
        UserDefaults.standard.bool(forKey: key)
    }

    static func revoke() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    static func grant() {
        UserDefaults.standard.set(true, forKey: key)
    }
}

/// Log solo-DEBUG. En Release no imprime nada — los `print` en producción
/// son ruido en Console y rozan fuga de metadata del usuario (keys de
/// memorias, labels de fallback). `@autoclosure` evita hasta el costo de
/// armar el string interpolado en Release.
@inline(__always)
func debugLog(_ message: @autoclosure () -> String) {
    #if DEBUG
    print(message())
    #endif
}
