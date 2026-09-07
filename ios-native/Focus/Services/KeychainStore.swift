import Foundation
import Security

/// Wrapper minimalista de Keychain Services para tokens y otros secretos
/// que no deberían ir a UserDefaults.
///
/// Usa `kSecAttrAccessibleAfterFirstUnlock` — el item es accesible después
/// del primer unlock del iPhone tras un boot, incluso si el device está
/// bloqueado después (necesario para background push / refresh tokens).
enum KeychainStore {
    enum Key: String {
        case accessToken  = "me.usefocus.app.auth.access_token"
        case refreshToken = "me.usefocus.app.auth.refresh_token"
        case userId       = "me.usefocus.app.auth.user_id"
        case email        = "me.usefocus.app.auth.email"
        /// Nombre completo del usuario (de Google `name`/`full_name` o de
        /// Supabase `user_metadata`). Opcional — si está vacío, la UI cae
        /// al email como displayName.
        case fullName     = "me.usefocus.app.auth.full_name"
    }

    @discardableResult
    static func set(_ value: String, forKey key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue
        ]
        SecItemDelete(query as CFDictionary)

        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        return SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let s = String(data: data, encoding: .utf8) else {
            return nil
        }
        return s
    }

    @discardableResult
    static func delete(_ key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Borra todos los items de auth manejados por este store.
    static func clearAllAuth() {
        delete(.accessToken)
        delete(.refreshToken)
        delete(.userId)
        delete(.email)
        delete(.fullName)
    }
}
