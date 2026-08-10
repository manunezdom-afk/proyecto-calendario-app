import Foundation

/// Capa de persistencia local en `UserDefaults`.
///
/// Reglas:
/// - **Solo datos no-sensibles.** Tokens, secrets y material auth van a Keychain (no acá).
/// - **Keys versionadas** con prefix `focus.v1.` para permitir migración futura (v2, v3…)
///   sin colisiones.
/// - **Encoding JSON ISO-8601** para fechas — compatible con backend si más adelante
///   sincronizamos contra Supabase.
/// - **Errores silenciosos**: load devuelve `nil`, save imprime a consola. La app sigue
///   funcionando con fallback a demo data. Un decode roto no rompe el boot.
enum FocusLocalStore {

    /// Claves persistidas. Cualquier dato nuevo a persistir agregar acá con prefix versionado.
    enum Key: String, CaseIterable {
        case tasks                  = "focus.v1.tasks"
        case events                 = "focus.v1.events"
        case suggestions            = "focus.v1.suggestions"
        case novaMessages           = "focus.v1.novaMessages"
        case settings               = "focus.v1.settings"
        /// Títulos de eventos/tareas demo que el usuario descartó. Sobreviven
        /// al cerrar la app — los ejemplos descartados NO vuelven a aparecer.
        case dismissedDemoEvents    = "focus.v1.dismissedDemoEvents"
        case dismissedDemoTasks     = "focus.v1.dismissedDemoTasks"
        /// IDs de items que el usuario borró localmente pero cuya
        /// confirmación remota (soft delete en Supabase) puede haber
        /// fallado por red. Sobreviven a cierres y se reintentan en cada
        /// `fetchRemoteAndMerge`. Sin esto, un evento borrado offline
        /// podía "revivir" al volver a tener internet.
        case pendingDeleteEvents    = "focus.v1.pendingDeleteEvents"
        case pendingDeleteTasks     = "focus.v1.pendingDeleteTasks"
    }

    // MARK: - Encoders cacheados (mismo motivo que DateFormatters)

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static var defaults: UserDefaults { .standard }

    /// Queue serial de baja prioridad para persistencia. JSONEncoder.encode
    /// + UserDefaults.set toma 20-80ms cada uno (depende del tamaño del
    /// array). Antes corrían en main thread → cada mutación bloqueaba la
    /// UI por ~30-100ms. Con 5 acciones rápidas (swipes consecutivos),
    /// el main thread se enquebraba 200-500ms y los touches subsequentes
    /// se sentían "pegados".
    ///
    /// `.utility` qos es la priority correcta para esto — más baja que
    /// userInitiated (no necesitamos respuesta inmediata) pero más alta
    /// que background (queremos que termine pronto para no perder data
    /// si la app se suspende).
    ///
    /// Serial → garantiza orden FIFO de los writes, evita race conditions
    /// donde un save de tasks viejo aterrizaría después de uno nuevo.
    private static let persistQueue = DispatchQueue(
        label: "me.usefocus.app.localstore.persist",
        qos: .utility
    )

    // MARK: - API

    /// Codifica y guarda un valor bajo la key indicada.
    /// **Async en background queue** — la mutación que disparó este save
    /// no bloquea el main thread. Si falla, imprime el error a consola y
    /// la key queda con su valor previo.
    ///
    /// **Persistencia eventual**: el write puede tardar 20-100ms en
    /// completarse. Si la app se cierra inmediatamente después de un
    /// save (raro), iOS coalesce los writes pending de UserDefaults en
    /// el background; en la práctica no se pierde data.
    static func save<T: Encodable>(_ value: T, forKey key: Key) {
        persistQueue.async {
            do {
                let data = try encoder.encode(value)
                defaults.set(data, forKey: key.rawValue)
            } catch {
                debugLog("[FocusLocalStore] save '\(key.rawValue)' failed: \(error)")
            }
        }
    }

    /// Versión SÍNCRONA del save. Solo usar cuando es crítico que el
    /// write llegue al disco antes de continuar (e.g., `applicationWillTerminate`
    /// hooks). En 99% de mutaciones normales usar `save` (async).
    static func saveSync<T: Encodable>(_ value: T, forKey key: Key) {
        do {
            let data = try encoder.encode(value)
            defaults.set(data, forKey: key.rawValue)
        } catch {
            debugLog("[FocusLocalStore] saveSync '\(key.rawValue)' failed: \(error)")
        }
    }

    /// Carga y decodifica un valor de la key indicada.
    /// Devuelve `nil` si la key no existe, está corrupta, o el tipo no matchea.
    static func load<T: Decodable>(_ type: T.Type, forKey key: Key) -> T? {
        guard let data = defaults.data(forKey: key.rawValue) else { return nil }
        do {
            return try decoder.decode(type, from: data)
        } catch {
            debugLog("[FocusLocalStore] load '\(key.rawValue)' failed: \(error)")
            return nil
        }
    }

    /// Elimina una key específica.
    static func clear(_ key: Key) {
        defaults.removeObject(forKey: key.rawValue)
    }

    /// Elimina TODAS las keys gestionadas por este store.
    /// Útil para "Borrar datos locales" o futuro logout.
    /// NOTA: no toca Keychain (este store no lo usa) ni otras keys de UserDefaults
    /// que la app/SDKs externos pudieran tener.
    static func clearAll() {
        for key in Key.allCases {
            defaults.removeObject(forKey: key.rawValue)
        }
    }
}
