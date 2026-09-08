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
        let day = #"(?:hoy|manana|pasado manana|\d{4}-\d{2}-\d{2})"#
        let time = #"(?:[01]?\d|2[0-3]):[0-5]\d"#
        let explicitTime = #"(?:"# + time + #"|(?:[1-9]|1[0-2])\s*(?:am|pm|de la manana|de la tarde|de la noche))"#
        let activity = #"(?:gym|gimnasio|futbol|dentista|medico|clase|reunion)"#
        func matches(_ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
        // No relative/vague times, colloquial motion, reference resolution,
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
