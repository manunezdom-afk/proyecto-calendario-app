import Foundation

/// A grammar certificate, not a probabilistic confidence estimate. A parsed
/// intent alone is never enough to authorize a local mutation.
enum NovaLocalRoutingPolicy {
    enum Route: String { case localParser = "local_parser", remoteAI = "remote_ai" }
    struct Decision {
        let route: Route
        let reason: String
        var permitsLocalMutation: Bool { route == .localParser }
    }

    static func decide(_ message: String, hasPendingClarification: Bool = false) -> Decision {
        let text = message.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "es_CL"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if scheduledCommitmentTitle(message) != nil {
            return Decision(route: .localParser, reason: "explicit_scheduled_commitment")
        }
        let day = #"(?:hoy|manana|pasado manana|\d{4}-\d{2}-\d{2})"#
        let time = #"(?:[01]?\d|2[0-3]):[0-5]\d"#
        let explicitTime = #"(?:"# + time + #"|(?:[1-9]|1[0-2])\s*(?:am|pm|de la manana|de la tarde|de la noche))"#
        let activity = #"(?:gym|gimnasio|futbol|dentista|medico|clase|reunion)"#
        func matches(_ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
        // Outside the affirmative commitment grammar, no relative/vague times or reference resolution,
        // conjunctions, fuzzy IDs or inferred AM/PM at this boundary.
        if matches(#"^"# + activity + #"\s+(?:"# + day + #"\s+)?(?:a las?\s+)?"# + explicitTime + #"$"#) {
            return Decision(route: .localParser, reason: "exact_calendar_grammar")
        }
        if hasPendingClarification,
           (matches(#"^(?:"# + day + #"\s+)?(?:a las?\s+)?"# + explicitTime + #"$"#) || matches(#"^"# + day + #"$"#)) {
            return Decision(route: .localParser, reason: "exact_pending_time")
        }
        if matches(#"^(?:"# + day + #"\s+)?(?:(?:tengo|ponme)\s+)?"# + activity + #"(?:\s+"# + day + #")?$"#) {
            return Decision(route: .localParser, reason: "exact_missing_event_time")
        }
        // Date-only tasks are deterministic too, but this deliberately small
        // grammar cannot interpret conversational requests or multiple goals.
        let excluded = #"\b(?:y|o|pero|si|no|como|tipo|onda|quizas|creo|despues|antes|cuando|luego|en|por|para|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|[\d:?!¿¡,;\n]"#
        let task = #"^(?:(?:hoy|manana)\s+)?(?:(?:tengo que|necesito|debo)\s+)?(?:comprar|pagar|llamar|estudiar|entregar|revisar|enviar|leer|preparar)\s+([\p{L} '-]{1,60}?)(?:\s+(?:hoy|manana|antes del (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)))?$"#
        if let expression = try? NSRegularExpression(pattern: task),
           let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let range = Range(match.range(at: 1), in: text) {
            let object = String(text[range])
            if object.split(separator: " ").count <= 5,
               object.range(of: excluded, options: .regularExpression) == nil {
                return Decision(route: .localParser, reason: "exact_task_grammar")
            }
        }
        return Decision(route: .remoteAI, reason: "semantic_interpretation_required")
    }

    /// A single affirmative commitment with a concrete clock time. Keep names and
    /// places in the title; uncertain scope/references stay on the semantic route.
    static func scheduledCommitmentTitle(_ message: String) -> String? {
        let original = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let folded = original.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "es_CL"))
        let excluded = #"[?¿!¡;\n]|\b(?:si|no|quizas|tal vez|podria|deberia|puede|puedo|cuando|antes|despues|pero|o|y|eso|ahi|alli|entonces|pa|donde)\b"#
        guard folded.range(of: excluded, options: .regularExpression) == nil else { return nil }
        let clock = #"\ba las?\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:am|pm|de la mañana|de la manana|de la tarde|de la noche))?\b"#
        guard let expression = try? NSRegularExpression(pattern: clock, options: .caseInsensitive),
              expression.numberOfMatches(in: original, range: NSRange(original.startIndex..., in: original)) == 1 else { return nil }
        var action = original.replacingOccurrences(of: clock, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
        // Only standalone day markers, never a destination/person embedded in the action.
        action = action.replacingOccurrences(of: #"(?i)^(?:hoy|mañana|manana|pasado mañana|pasado manana)\s+|\s+(?:hoy|mañana|manana|pasado mañana|pasado manana)$"#,
                                             with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        let obligation = #"(?i)^(?:tengo que|debo|necesito)\s+((?:salir|irme|ir|estar|llegar|volver|asistir|pasar|recoger|buscar|llamar|entregar|pagar|comprar)(?:\s+[\p{L} '-]+)?)$"#
        let firstPerson = #"(?i)^(salgo|me voy|voy|llego|vuelvo|paso)(?:\s+([\p{L} '-]+))?$"#
        var title: String
        if let regex = try? NSRegularExpression(pattern: obligation),
           let match = regex.firstMatch(in: action, range: NSRange(action.startIndex..., in: action)),
           let range = Range(match.range(at: 1), in: action) {
            title = String(action[range])
        } else if let regex = try? NSRegularExpression(pattern: firstPerson),
                  let match = regex.firstMatch(in: action, range: NSRange(action.startIndex..., in: action)),
                  let verbRange = Range(match.range(at: 1), in: action) {
            let verb = String(action[verbRange]).lowercased()
            let infinitives = ["salgo": "salir", "me voy": "irme", "voy": "ir", "llego": "llegar", "vuelvo": "volver", "paso": "pasar"]
            title = infinitives[verb] ?? verb
            if let objectRange = Range(match.range(at: 2), in: action) { title += " " + action[objectRange] }
        } else { return nil }
        if title.lowercased() == "irme" { title = "salir" }
        guard title.count <= 90 else { return nil }
        return title.prefix(1).uppercased() + title.dropFirst()
    }

}

/// Debug evidence is structural: never prompts, titles, people or credentials.
/// Synthetic tests retain their explicit before/after fixtures independently.
enum NovaRouteTrace {
    static func selected(_ decision: NovaLocalRoutingPolicy.Decision) {
        #if DEBUG
        print("[NovaRoute] route=\(decision.route.rawValue) reason=\(decision.reason)")
        #endif
    }
    static func normalized(beforeTitle: String, afterTitle: String, beforeSubtitle: String?, afterSubtitle: String?) {
        #if DEBUG
        print("[NovaNormalization] titleChanged=\(beforeTitle != afterTitle) subtitleBefore=\(!(beforeSubtitle?.isEmpty ?? true)) subtitleAfter=\(!(afterSubtitle?.isEmpty ?? true))")
        #endif
    }
}
