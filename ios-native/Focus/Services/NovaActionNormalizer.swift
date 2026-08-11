import Foundation

/// Capa única de normalización de acciones de Nova. Tanto el backend
/// (`applyBackendActions`) como el fallback local (`applyLocalNovaIntent`)
/// pasan por acá antes de modificar el store.
///
/// Su trabajo:
///   1. **Limpiar el título** — quitar triggers tipo "acuérdame", "tipo 3",
///      "en 20", "recuérdame", fillers, fechas que se colaron al texto.
///   2. **Decidir si es recordatorio** — escanea el `userText` original
///      por triggers explícitos ("acuérdame", "recuérdame", "avísame",
///      "que no se me olvide", "no te olvides", "acuérdate") sin importar
///      lo que dijo el backend.
///   3. **Calcular endTime** — `nil` cuando es recordatorio o cuando el
///      backend no devolvió endTime explícito → UI muestra como punto, no
///      como rango falso.
///   4. **Decidir si programar notificación** — `true` solo cuando hay
///      hora futura + es recordatorio + toggle global activo.
///
/// Es una capa estática, sin estado, sin dependencias de SwiftUI. Solo
/// funciones puras de validación / sanitización.
enum NovaActionNormalizer {

    // MARK: - Triggers explícitos de recordatorio

    /// Triggers que, si aparecen en el `userText` original, fuerzan a que
    /// la acción se trate como recordatorio puntual aunque el backend o el
    /// parser local hayan dicho otra cosa.
    ///
    /// Estos triggers cubren toda la familia común en español chileno/latino.
    private static let reminderTriggers: [String] = [
        "acuérdame",
        "acuerdame",
        "acuérdate",
        "acuerdate",
        "acuérdalo",
        "acuerdalo",
        "acordarme",
        "recuérdame",
        "recuerdame",
        "recordame",
        "recordarme",
        "avísame",
        "avisame",
        "que no se me olvide",
        "no te olvides",
        "no olvides",
        "no me dejes olvidar",
        // "pon una alarma para estudiar a las 7" es un recordatorio, no un
        // evento (QA-closure 2026-06-10, caso 46 de la suite 50).
        "pon una alarma",
        "ponme una alarma",
        "pon alarma",
        "ponme alarma",
        "pon un recordatorio",
        "ponme un recordatorio",
        "pon recordatorio"
    ]

    /// True cuando `userText` contiene cualquier trigger explícito de
    /// recordatorio. Case-insensitive y robusto a acentos faltantes.
    static func isReminderTrigger(in userText: String) -> Bool {
        let lower = userText.lowercased()
        return reminderTriggers.contains { lower.contains($0) }
    }

    /// True cuando `userText` empieza con un trigger de recordatorio.
    /// Más restrictivo que `isReminderTrigger`: solo cuenta si el trigger
    /// es la PRIMERA palabra significativa. Usado para distinguir:
    ///   - "recuérdame a las 5 llevar la pelota" → SÍ es reminder
    ///   - "futbol a las 5 acordarme de llevar la pelota" → NO es reminder
    ///     (trigger mid-sentence + detail extraído como subtítulo)
    static func startsWithReminderTrigger(in userText: String) -> Bool {
        let lower = userText.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return reminderTriggers.contains { trigger in
            // Match al inicio + boundary (espacio/puntuación o fin).
            guard lower.hasPrefix(trigger) else { return false }
            let after = lower.dropFirst(trigger.count)
            return after.isEmpty || after.first?.isWhitespace == true
                || after.first?.isPunctuation == true
        }
    }

    /// True si `detail` termina con una referencia explícita a un destino
    /// ("...al dentista", "...a la reunión", "...del banco") cuya palabra
    /// objetivo aproxima el `title` del evento. Sirve para anclar, en un
    /// mensaje multi-evento, el detalle a EXACTAMENTE el evento que nombra:
    ///   "dentista a las 4 y comprar remedios a las 5, acuérdame de llevar
    ///    la receta al dentista" → el detalle "Llevar la receta al dentista"
    ///    se ancla a "Dentista", NO a "Comprar remedios".
    ///
    /// Gateado en la referencia trailing "al/a la/… X": un detalle SIN esa
    /// referencia ("comprar remedios") nunca matchea, así que el guard
    /// multi-intent lo sigue suprimiendo (no reintroduce el bug original ni
    /// se auto-referencia).
    static func detailTargetsTitle(detail: String, title: String) -> Bool {
        let dl = detail.lowercased()
        let tl = title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tl.isEmpty else { return false }
        // Palabra objetivo tras la última preposición de destino, al final.
        guard let range = dl.range(
            of: #"\b(?:al|a la|a los|a las|del|de la|de los|de las)\s+([a-záéíóúñ]{3,})\s*$"#,
            options: .regularExpression
        ) else {
            return false
        }
        let targetWord = String(dl[range])
            .components(separatedBy: .whitespaces)
            .last ?? ""
        guard targetWord.count >= 3 else { return false }
        let titleWords = Set(tl.split(separator: " ").map(String.init))
        return titleWords.contains(targetWord) || tl == targetWord
    }

    /// Verbos que implican una **acción puntual** y se tratan como
    /// recordatorio (sin duración + notificación si toggle activo)
    /// aunque el usuario no haya dicho "acuérdame".
    ///
    /// Dos familias:
    ///   - **Despertar / levantar / amanecer**: momento de inicio del día.
    ///   - **Comidas** (comer, cenar, almorzar, desayunar, merendar, once):
    ///     "comer a las 7" es un evento puntual ("voy a comer a esa hora"),
    ///     no un bloque de 1 hora que el usuario quiera reservar. La
    ///     duración real es variable y el usuario rara vez la specifica;
    ///     mostrarlo como punto con notificación es más útil que un rango
    ///     inventado. Si el usuario quiere bloquear "almuerzo con Pedro de
    ///     1 a 3" puede usar "de N a M" y se respeta el endTime explícito.
    private static let punctualVerbPattern: String =
        // ACCIONES verbales (despertar/comer/cenar/...) — verbo en forma
        // de acción, sugiere momento puntual.
        // Después del user spec 2026-05-27 NO incluimos los sustantivos
        // (comida|cena|almuerzo|desayuno|merienda) porque "almuerzo con
        // mi papá a las 2" debe ser EVENTO con subtítulo, no recordatorio
        // puntual. "Comer a las 7" sigue siendo reminder porque el verbo
        // 'comer' es claramente acción puntual sin contexto de duración.
        #"\b(despertar(me|te|se|nos|los)?|despertame|despertarnos|despierto|despierta|levantar(me|te|se|nos|los)?|levantame|levantarnos|levanto|levanta|amanecer|amanezca|amanezco|comer|comerme|cenar|cenamos|almorzar|almorzamos|desayunar|desayunamos|merendar|tomar\s+once)\b"#

    /// True cuando el texto contiene un verbo puntual (despertar/levantar/
    /// amanecer/comer/cenar/almorzar/desayunar/merendar). Estos verbos
    /// describen un momento, no un intervalo — se tratan como recordatorios
    /// para que: (a) no aparezcan con rango falso en el calendario,
    /// (b) disparen notificación si el toggle de recordatorios está activo.
    static func impliesPunctualReminder(in userText: String) -> Bool {
        return userText.range(
            of: punctualVerbPattern,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    // MARK: - Limpieza de título

    /// Quita ruido del título — triggers de recordatorio, marcadores
    /// temporales sueltos, fillers, prefijos "Recordatorio:" duplicados.
    /// Centraliza la limpieza que antes vivía fragmentada en `cleanTaskTitle`,
    /// `stripReminderTriggers`, `cleanupTitle`.
    ///
    /// Pasos:
    ///   1. Strip "Recordatorio:" prefix (lo manejamos via isReminder flag).
    ///   2. Strip triggers de recordatorio embebidos.
    ///   3. Strip marcadores temporales sueltos ("tipo 3", "a las 20",
    ///      "en 20 minutos", "mañana", "hoy", "el jueves").
    ///   4. Strip fillers ("porfa", "oye", "dale").
    ///   5. Strip "ir a buscar" → "Buscar a" (verbo redundante).
    ///   6. Collapse whitespace + capitalize first noun.
    ///
    /// Devuelve "" si el resultado queda vacío — el caller decide si pide
    /// clarificación.
    static func cleanTitle(_ raw: String) -> String {
        guard !raw.isEmpty else { return "" }
        var result = raw

        // 1. Strip prefix "Recordatorio: " (case-insensitive)
        if let range = result.range(of: #"^\s*recordatorio[:\s-]+"#,
                                     options: [.regularExpression, .caseInsensitive]) {
            result.removeSubrange(range)
        }

        // 1.5. Truncar metadata de recordatorio mid-título tras una COMA.
        //      Caso del parser local multi-intent (2026-06-12): el segmento
        //      "comprar remedios a las 5, acuérdame de llevar la receta al
        //      dentista" dejaba el título "Comprar remedios , acuérdame de"
        //      (coma huérfana + residuo del trigger) cuando lo que seguía al
        //      trigger no era un verbo de detalle reconocido. La COMA seguida
        //      de un trigger de recordatorio marca una cláusula separada:
        //      todo desde ahí es la acción a recordar (se extrae aparte vía
        //      extractEventDetail), NO parte del título. Cortamos en la coma.
        //
        //      La coma es la señal — gateando en ella evitamos falsos
        //      positivos tipo "hoy recuérdame llamar a Juan" (sin coma, el
        //      trigger lidera la acción; el step 2 lo strippea y deja
        //      "Llamar a Juan").
        let triggerAlternation = reminderTriggers
            .map { NSRegularExpression.escapedPattern(for: $0) }
            .joined(separator: "|")
        let reminderClausePattern = "\\s*,\\s*(?:" + triggerAlternation + ")\\b[\\s\\S]*$"
        if let range = result.range(
            of: reminderClausePattern,
            options: [.regularExpression, .caseInsensitive]
        ) {
            result.removeSubrange(range)
        }

        // 2. Strip reminder triggers embebidos.
        //    a) Primero las versiones LARGAS con "de" / "que" trailing
        //    ("acuérdame de salir" → " salir"), para no dejar "de" huérfano
        //    cuando solo se strippea el trigger corto. Ordenar por longitud
        //    descendente garantiza que el patrón más específico gane.
        let extendedReminderPrefixes: [String] = [
            // Pattern: [trigger] [de|que] — consume el conector que une
            // el trigger con la acción real.
            #"\bacu[eé]rdame\s+(?:de|que)\b"#,
            #"\bacu[eé]rdate\s+(?:de|que)\b"#,
            #"\bacu[eé]rdalo\s+(?:de|que)\b"#,
            #"\bacordarme\s+(?:de|que)\b"#,
            #"\brecu[eé]rdame\s+(?:de|que)\b"#,
            #"\brecordame\s+(?:de|que)\b"#,
            #"\brecordarme\s+(?:de|que)\b"#,
            #"\bav[ií]same\s+(?:de|que)\b"#,
            #"\bque\s+no\s+se\s+me\s+olvide\s+(?:de|que)?\b"#,
            #"\bno\s+(?:te\s+)?olvides\s+(?:de|que)?\b"#,
            // "pon(me) una alarma para X" / "pon(me) un recordatorio de X"
            // → el título es X, no la frase de la alarma.
            #"\bpon(?:me)?\s+(?:una\s+)?alarma\s+(?:para|de|que)?\b"#,
            #"\bpon(?:me)?\s+(?:un\s+)?recordatorio\s+(?:para|de|que)?\b"#,
        ]
        for pattern in extendedReminderPrefixes {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }
        //    b) Luego los triggers cortos sueltos (sin "de" trailing).
        for trigger in reminderTriggers {
            result = result.replacingOccurrences(
                of: "\\b" + NSRegularExpression.escapedPattern(for: trigger) + "\\b",
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 3. Strip marcadores temporales sueltos.
        let temporalPatterns: [String] = [
            // 3a. Marcadores de RECURRENCIA — deben strippearse antes que
            // los days/times sueltos porque incluyen mismas palabras.
            // Sin esto, "todos los lunes a las 5 tengo clases" dejaba
            // "Todos los lunes clases" como título. El parser ya extrae
            // la recurrencia por separado (detectRecurrence), así que en
            // el TÍTULO esta info es ruido.
            #"\btodos los d[ií]as\b"#,
            #"\bdiariamente\b"#,
            #"\bcada d[ií]a\b"#,
            // Multi-weekday: "todos los lunes y miércoles" / "lunes, miércoles y viernes".
            // Estos patrones consumen la lista completa, no solo el primer día.
            #"\btodos los (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)(?:,\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?))*\s+y\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b"#,
            #"\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)(?:,\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?))*\s+y\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b"#,
            // Single-weekday recurrentes (después de multi para no comer la parte).
            #"\btodos los lunes\b"#, #"\btodos los martes\b"#,
            #"\btodos los mi[eé]rcoles\b"#, #"\btodos los jueves\b"#,
            #"\btodos los viernes\b"#, #"\btodos los s[aá]bados\b"#,
            #"\btodos los domingos\b"#,
            #"\blos lunes de por medio\b"#, #"\blos martes de por medio\b"#,
            #"\blos mi[eé]rcoles de por medio\b"#, #"\blos jueves de por medio\b"#,
            #"\blos viernes de por medio\b"#, #"\blos s[aá]bados de por medio\b"#,
            #"\blos domingos de por medio\b"#,
            #"\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\s+de\s+por\s+medio\b"#,
            #"\bcada\s+dos\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?|semanas|d[ií]as)\b"#,
            #"\bcada\s+2\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?|semanas|d[ií]as)\b"#,
            #"\bcada\s+\d{1,2}\s+d[ií]as\b"#,
            #"\bcada\s+semana\b"#, #"\btodas\s+las\s+semanas\b"#,
            #"\bcada\s+mes\b"#, #"\bmensualmente\b"#, #"\bmensual\b"#,
            #"\bcada\s+15\s+d[ií]as\b"#, #"\bcada\s+quince\s+d[ií]as\b"#,
            #"\bd[ií]a\s+por\s+medio\b"#,
            #"\bde\s+lunes\s+a\s+viernes\b"#, #"\blunes\s+a\s+viernes\b"#,
            #"\bd[ií]as\s+h[aá]biles\b"#, #"\bentre\s+semana\b"#,
            #"\bd[ií]as\s+de\s+semana\b"#,
            // 3b. Marcador de "Para [temporal]" leading — debe ir antes
            // que strip de days sueltos.
            #"^\s*para\s+(mañana|manana|hoy|esta\s+(tarde|noche|mañana|manana)|en\s+la\s+(tarde|noche|mañana|manana)|el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|pasado\s+mañana|pasado\s+manana|al\s+mediod[ií]a)\b"#,
            // Aproximación coloquial "más o menos" / "mas o menos" — marca
            // que la hora es aproximada ("a la 1 más o menos"). Es metadata,
            // no parte del título. User report 2026-05-28: "tengo q jugar
            // counter a la 1 más o menos" dejaba "más o menos" en el título.
            #"\bm[aá]s o menos\b"#,
            #"\bmas o menos\b"#,
            #"\baproximadamente\b"#,
            #"\bm[aá]s\s+o\s+menos\b"#,
            // Horas en dígitos.
            #"\ba la?s? \d{1,2}(:\d{2})?\s*(am|pm|hrs?|de la (mañana|manana|tarde|noche))?\b"#,
            #"\b\d{1,2}:\d{2}\b"#,
            #"\btipo (las? )?\d{1,2}(:\d{2})?\b"#,
            #"\bcomo a la?s? \d{1,2}(:\d{2})?\b"#,
            #"\b(a eso de|cerca de|alrededor de|por) la?s? \d{1,2}(:\d{2})?\b"#,
            // Horas en PALABRAS — "a las tres", "a la una", "a las tres y
            // media", "a las tres y cuarto", "tres y treinta", "tipo cuatro",
            // "como a las seis de la tarde". Sin este patrón el cleanTitle
            // dejaba "Ir a buscar a mi hermano a las tres" intacto y el step
            // 7 (artículos+nombres propios) capitalizaba "tres" → "a Tres".
            //
            // FIX 2026-05-15: el patrón anterior `tipo (las? )?` consumía el
            // espacio trailing y dejaba a `\s+` sin nada que matchear, lo
            // que rompía "tipo nueve"/"tipo seis"/etc en palabras (los
            // dígitos seguían funcionando por la línea separada de arriba).
            // Reformulado: el grupo de prefijos ya NO incluye espacio final;
            // el `\s+` después del grupo lo absorbe; y el opcional "las/la"
            // pasa a un grupo dedicado `(la?s?\s+)?` entre `\s+` y el número.
            #"\b(a\s+la?s?|tipo|como\s+a\s+la?s?|a\s+eso\s+de\s+la?s?|cerca\s+de\s+la?s?|alrededor\s+de\s+la?s?)\s+(la?s?\s+)?(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(\s+y\s+(media|cuarto|diez|quince|veinte|veinticinco|treinta))?(\s+(treinta|quince))?(\s+de la (mañana|manana|tarde|noche))?\b"#,
            // Relativos. El "más" coloquial ("en 10 minutos más", "en dos horas más")
            // es redundante — se consume junto con la expresión temporal para evitar
            // que quede huérfano en el título ("Ir a buscar a mi hermano  más").
            #"\ben\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)(\s+m[aá]s)?\b"#,
            #"\ben\s+\d{1,2}(\s+m[aá]s)?\b"#,
            #"\b\d{1,2}\s*hrs?\b"#,
            #"\b\d{1,2}\s*hs\b"#,
            // Franja horaria "de la mañana/tarde/noche" como UNIDAD — debe ir
            // ANTES del strip del día "mañana" suelto. Si no, "a las 9 de la
            // mañana" perdía solo "mañana" y dejaba "de la" huérfano en el
            // título (ej. "Cita médica de la"). El AM/PM real se resuelve en
            // parseAll sobre el texto original, no acá.
            #"\bde\s+la\s+(mañana|manana|tarde|noche|madrugada)\b"#,
            // Días — orden: compuestos PRIMERO para que no queden residuos.
            // "hoy día" y "hoy en día" son expresiones coloquiales de "hoy";
            // si solo strippeamos "hoy", "día" queda suelto en el título.
            #"\ben el d[ií]a de hoy\b"#,
            #"\bel d[ií]a de hoy\b"#,
            #"\bhoy\s+en\s+d[ií]a\b"#,
            #"\bhoy\s+d[ií]a\b"#,
            #"\bhoy\b"#,
            #"\bmañana\b"#,
            #"\bmanana\b"#,
            #"\bpasado mañana\b"#,
            #"\bpasado manana\b"#,
            #"\besta (tarde|noche|mañana|manana)\b"#,
            #"\ben la (tarde|noche|mañana|manana)\b"#,
            #"\bal mediod(í|i)a\b"#,
            #"\bel (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b"#,
            #"\bdespu(é|e)s de(l)? (almuerzo|almorzar|trabajo)\b"#,
            #"\bal final del d(í|i)a\b"#,
            #"\bal amanecer\b"#,
            // Limpieza: "de la/las/el/los" HUÉRFANO al final del título. Queda
            // cuando parseAll ya consumió el sustantivo antes de cleanTitle
            // (ej. "mañana" de "de la mañana" se fue como día → "Cita médica
            // de la"). Solo aplica al final (nada que estropear en medio).
            #"\s+de\s+(la|las|el|los)\s*$"#
        ]
        for pattern in temporalPatterns {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 3-bis. Cleanup "tipo" huérfano. Si tras strippear horas, "tipo"
        //        quedó solo (sin número ni palabra-número adyacente), es
        //        residuo. Detectamos por whitespace doble en algún lado
        //        (señal de que algo se removió pegado a "tipo"). Versión
        //        narrow para NO romper "tipo de X" (compuestos legítimos
        //        donde "tipo" mantiene espaciado simple).
        //
        //        Caso real (BETA-2): "para estar tipo 6:30 acá" — strip de
        //        "6:30" deja "para estar tipo  acá" con doble espacio →
        //        este cleanup lo limpia.
        result = result.replacingOccurrences(
            of: #"\s{2,}tipo\s+|\s+tipo\s{2,}"#,
            with: " ",
            options: [.regularExpression, .caseInsensitive]
        )

        // 3a. Strip destinos educacionales trailing tipo "para la universidad".
        //     "salir de mi casa a las 8 para la universidad" → tras strip
        //     temporal queda "salir de mi casa para la universidad" — el
        //     destino es contexto, no parte del título visible. Solo cuando
        //     la frase ESTÁ DOMINADA por un verbo de desplazamiento ("salir",
        //     "ir", "voy") + "para/a la X" donde X es ámbito educacional.
        //     No tocar "para el examen" / "para mi mamá" (no son destinos
        //     físicos, son objetivos personales).
        let lowerForDest = result.lowercased()
        let hasMoveVerb = lowerForDest.range(
            of: #"\b(salir|salgo|ir|voy|vamos|me voy|me salgo|entrar)\b"#,
            options: .regularExpression
        ) != nil
        if hasMoveVerb {
            // Artículo / posesivo opcional — la normalización previa puede haber
            // capitalizado "la universidad" → "Universidad" dejando "para
            // Universidad" sin artículo, pero también puede llegar tal cual.
            let destinationPatterns: [String] = [
                #"\s+para\s+(?:(?:la|el|las|los|mi|tu|su)\s+)?(?:universidad|colegio|escuela|clase|clases|facultad|liceo|preescolar|gimnasio|gym)\b"#,
                #"\s+a\s+(?:(?:la|el|las|los|mi|tu|su)\s+)?(?:universidad|colegio|escuela|facultad|liceo|preescolar|gimnasio|gym)\b"#
            ]
            for pattern in destinationPatterns {
                result = result.replacingOccurrences(
                    of: pattern,
                    with: " ",
                    options: [.regularExpression, .caseInsensitive]
                )
            }
        }

        // 3a-bis. Strip "antes de(l) [art opcional] [sustantivo]" — es
        //         CONTEXTO temporal del recordatorio, no parte del título.
        //         "recuérdame antes de la clase comprar una bebida" →
        //         tras eliminar "recuérdame" y "antes de la clase", queda
        //         "comprar una bebida". El cliente decide si asociar a un
        //         evento existente o crear como tarea.
        //         Solo strippeamos el patrón de tipo "antes de [art] noun";
        //         no tocamos "antes de las 5" (eso ya cae en temporalPatterns).
        // Patrones case-INSENSITIVE (artículo y verbo conocido):
        let antesDePatternsInsensitive: [String] = [
            // "antes de(l) [art] [palabra]" — consume artículo y palabra siguiente.
            #"\bantes de(?:l)?\s+(?:la|el|los|las|mi|tu|su)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+\b"#,
            // "antes de [verbo]" sin artículo (ej. "antes de comer").
            #"\bantes de(?:l)?\s+(?:salir|llegar|empezar|comer|estudiar|trabajar|llamar|ir|dormir)\b"#,
        ]
        for pattern in antesDePatternsInsensitive {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }
        // Patrón case-SENSITIVE para el SUSTANTIVO: "[Aa]ntes de Capitalized"
        // — captura el caso post-parser ("antes de la clase" → "antes de
        // Clase" tras normalizeProperNounsAfterArticles upstream).
        //
        // El leading `[Aa]ntes` admite "antes" o "Antes" (porque el parser
        // capitaliza la primera letra del título). El `[A-Z][a-z]+` para el
        // sustantivo es case-SENSITIVE — eso garantiza que NO matchee
        // "antes de echar" (lowercase) que es texto legítimo de una nota
        // custom de reminder ("acuérdame 20 min antes de echar zapatillas").
        if let regex = try? NSRegularExpression(
            pattern: #"\b[Aa]ntes de(?:l)?\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\b"#,
            options: []  // case-SENSITIVE en el sustantivo
        ) {
            let ns = result as NSString
            let range = NSRange(location: 0, length: ns.length)
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: " ")
        }

        // 3b. Strip frases de "X minutos antes" / "media hora antes" /
        //     "una hora antes" / "cinco min antes" — son metadata de
        //     notificación, no parte del título.
        //
        //     IMPORTANTE: cada patrón consume OPCIONALMENTE el "de <resto>"
        //     trailing — caso del user spec: "tengo partido tipo 3 acuérdame
        //     20 min antes de echar las zapatillas a la mochila" debe quedar
        //     como título "Partido" sin "20 min antes de echar las zapatillas
        //     a la mochila" embebido. La nota se extrae en paralelo vía
        //     `extractReminderOffsetAndNote` para anclarla al evento como
        //     `reminderNotes[i]`.
        // ORDEN CRÍTICO: primero aplicamos los patrones que CONSUMEN el
        // trailing "de [nota]" (greedy hasta puntuación/fin), luego los
        // patrones sin "de" para los casos sin nota custom.
        //
        // Por qué dividir en lugar de hacer `(...)?` opcional: el regex
        // engine con grupo opcional prefería el match más corto, dejando
        // "de echar las zapatillas..." intacto en el título. Dividir lo
        // hace determinista.
        let offsetPatterns: [String] = [
            // CON nota custom — "N min antes de X" → strip todo.
            #"\b(con|y)?\s*(acu(é|e)rdame|recu(é|e)rdame|av(í|i)same|recordame|recu(é|e)rdate|acu(é|e)rdate)\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+[^.,;!?]+"#,
            #"\b(con|y)?\s*(acu(é|e)rdame|recu(é|e)rdame|av(í|i)same|recordame|recu(é|e)rdate|acu(é|e)rdate)\s+(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+[^.,;!?]+"#,
            #"\b\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+[^.,;!?]+"#,
            #"\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+[^.,;!?]+"#,
            // SIN nota custom — "N min antes" solo (catch-all para casos
            // donde el reminder no tiene trailing "de X").
            #"\b(con|y)?\s*(acu(é|e)rdame|recu(é|e)rdame|av(í|i)same|recordame|recu(é|e)rdate|acu(é|e)rdate)\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#,
            #"\b(con|y)?\s*(acu(é|e)rdame|recu(é|e)rdame|av(í|i)same|recordame|recu(é|e)rdate|acu(é|e)rdate)\s+(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#,
            #"\b\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#,
            #"\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#
        ]
        for pattern in offsetPatterns {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 3b-bis. Strip trailing "para estar/llegar [tipo|a las] X [acá|aquí|allá]".
        //         Es contexto secundario de timing — "buscar a mi polola tipo
        //         6 a su casa para estar tipo 6:30 acá" debe quedar como
        //         "Buscar a mi polola"; la segunda hora ("estar 6:30 acá") y
        //         el destino ("a su casa") son metadata, no el título.
        //
        //         Importante: corre DESPUÉS de los temporal patterns para que,
        //         si "tipo 6:30" ya fue strippeado, este patrón limpie el
        //         "para estar acá" que queda. También cubre el caso donde el
        //         temporal NO fue strippeado por venir en palabras post-fix.
        let trailingContextPatterns: [String] = [
            // Word-based hours: "para estar [listo] tipo seis [y treinta] acá"
            #"\s+para\s+(estar(\s+listo)?|llegar)(\s+(tipo|a\s+la?s?|como\s+a\s+la?s?|sobre\s+la?s?)\s+(?:una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(\s+y\s+(media|cuarto|treinta|quince))?)?(\s+(ac[aá]|aqu[ií]|all[aá]))?\b"#,
            // Digit-based hours: "para estar [listo] tipo 6:30 acá"
            #"\s+para\s+(estar(\s+listo)?|llegar)(\s+(tipo|a\s+la?s?|como\s+a\s+la?s?|sobre\s+la?s?)\s+\d{1,2}(:\d{2})?)?(\s+(ac[aá]|aqu[ií]|all[aá]))?\b"#,
            // Sin temporal: "para estar [listo] acá/aquí/allá" o solo "para llegar"
            #"\s+para\s+(estar(\s+listo)?|llegar)(\s+(ac[aá]|aqu[ií]|all[aá]))?\b"#,
            // "para [verbo reflexivo]me" trailing — propósito personal del usuario
            // (no parte del título del evento). Caso real (BUG-USER 2026-05-18):
            // "más tarde viene la agustina tipo 6 acuérdame 20 min antes para
            // prepararme" → tras strip de leading "más tarde" y "20 min antes",
            // quedaba "Viene la agustina para prepararme" con "para prepararme"
            // colgando. La whitelist refleja reflexiveVerbMap (descanso,
            // higiene, foco, cuerpo) más "salir/ir" para casos puntuales.
            #"\s+para\s+(prepararme|concentrarme|relajarme|calmarme|ducharme|bañarme|banarme|lavarme|peinarme|vestirme|afeitarme|cambiarme|dormirme|despertarme|levantarme|acostarme|moverme|ejercitarme|estirarme|irme|salirme|volverme|alistarme|arreglarme|organizarme|ordenarme)\b"#,
        ]
        for pattern in trailingContextPatterns {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 3b-ter. Strip trailing "a (su|mi|tu|nuestra) [lugar]" cuando el
        //         título contiene un verbo de movimiento/recogida. Es location,
        //         pertenece a `notes`/`location`, no al título visible.
        //         No se aplica sin verbo de movimiento para evitar romper
        //         "Cena en su casa" o "Reunión en mi oficina" si llegaran
        //         como título completo.
        let lowerForLocStrip = result.lowercased()
        let hasMoveOrFetchVerb = lowerForLocStrip.range(
            of: #"\b(ir|salir|voy|vamos|buscar|llevar|recoger|pasar|me\s+voy)\b"#,
            options: .regularExpression
        ) != nil
        if hasMoveOrFetchVerb {
            // Solo lugares — NO incluir personas ("a mi polola" se queda
            // porque es el objeto directo del verbo "buscar").
            result = result.replacingOccurrences(
                of: #"\s+a\s+(su|mi|tu|nuestra|nuestro)\s+(casa|depto|departamento|oficina|trabajo|pega|pieza|jard[ií]n|patio|escuela|colegio|liceo|gimnasio|gym|consulta|consultorio)\b"#,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 3c. Strip prefijos coloquiales de eventos. Cubre las construcciones
        //     más comunes en español donde el usuario introduce un evento con
        //     una frase de obligación/posesión/intención. Estos prefijos
        //     NUNCA forman parte del título — describen la relación del
        //     usuario con el evento.
        //
        //     - "Tengo (una|un|el|la|los|las|mi)? X" → X.
        //         "Tengo una comida" → "comida".
        //         "Tengo reunión con Juan" → "reunión con Juan".
        //     - "Tengo que X" → X. "Tengo que estudiar cálculo" → "estudiar cálculo".
        //     - "Necesito (que)? X" → X. "Necesito ir al dentista" → "ir al dentista".
        //     - "Quiero X" / "Voy a X" / "Tengo ganas de X" → X.
        //         "Voy a comer con Pedro" → "comer con Pedro".
        //     - "Me toca X" / "Me agendaron X" / "Me programaron X" → X.
        //
        //     Solo aplica AL INICIO. Eso evita romper títulos legítimos como
        //     "Reunión donde tengo que hablar" — ahí "tengo que" no es prefijo.
        let eventoPrefixPatterns: [String] = [
            // ORDEN: más específico primero. Cada patrón consume el artículo
            // determinado o indeterminado opcional que sigue ("la reunión" →
            // "reunión", "un café" → "café") para evitar dejar "la"/"un" suelto.
            // El grupo de artículos es OPCIONAL — si el verbo va directo al
            // sustantivo ("voy a correr") no se rompe.
            //
            // 0. ADVERBIOS DE SECUENCIA — "luego", "después" al INICIO son
            //    relleno temporal coloquial ("luego tengo que X" → "tengo
            //    que X"). Strippeamos primero para que el patrón #2 ("tengo
            //    que X") matchee aunque haya "luego" delante. Reportado
            //    por user 2026-05-15: "luego tengo que seguir trabajando
            //    con focus" quedaba como título literal.
            #"^\s*(luego|después|despues|ahora|más tarde|mas tarde|después de eso|despues de eso)\s+"#,
            // 1. "Tengo ganas de X" → X (antes que "tengo X" para evitar que
            //    el patrón general consuma solo "tengo ").
            #"^\s*tengo\s+ganas\s+de\s+(la|el|los|las|una|un)?\s*"#,
            // 2. "Tengo (que|q|una?|un|el|la|los|las|mi)? X" → X.
            //    "q" es abreviación coloquial de "que" (chat): "tengo q
            //    jugar counter" → "jugar counter". User report 2026-05-28.
            #"^\s*tengo(\s+(que|q|una?|un|el|la|los|las|mi))?\s+"#,
            // 2-bis. "q" / "que" SUELTO al inicio (sin "tengo"): "q comprar
            //    pan" → "comprar pan". Abreviación de "que" coloquial.
            #"^\s*(?:que|q)\s+"#,
            // 3. "Necesito (que)? X" → X.
            #"^\s*necesito(\s+que)?\s+(la|el|los|las|una|un)?\s*"#,
            // 4. "Quiero X" / "Voy a X" / "Me toca X" / "Me agendaron X" /
            //    "Me programaron X". Consumen artículo opcional siguiente.
            #"^\s*(quiero|voy\s+a|me\s+toca|me\s+agendaron|me\s+programaron)\s+(la|el|los|las|una|un)?\s*"#,
            // 4b. "que (me)? agendes/pongas/programes/anotes/crees/añadas" —
            //     queda como residuo después de strippear "quiero"/"necesito".
            //     Ej. "quiero que agendes estudiar" → tras #4 queda "que
            //     agendes estudiar" → este pattern → "estudiar".
            #"^\s*que\s+(me\s+)?(agendes|pongas|programes|anotes|crees|a[ñn]adas|registres|guardes)\s+(la|el|los|las|una|un)?\s*"#,
            // 4c. Imperativos de agenda — "Agéndame X" / "Anota X" / "Ponme X"
            //     / "Programa X" / "Crea X" / "Añade X". El usuario los usa
            //     como verbo directo para pedir crear evento. Nunca son parte
            //     del título.
            #"^\s*(ag[eé]ndame|ag[eé]ndamelo|anota|anotame|a[ñn]ade|a[ñn]ademe|agr[eé]ga(me|le|lo|melo)?|agregar|ponme|p[oó]ngame|p[oó]nme|programa(me|melo)?|crea(me)?|cr[eé]ame|registra(me)?|guarda(me)?|m[eé]te(me|le|lo)?|inclu[ií]ye(me|le)?)\s+(la|el|los|las|una|un|que)?\s*"#,
            // 4d. "salir/ir/me voy + (al|a la|a los|a las) + EVENT_NOUN" — el
            //     verbo de movimiento es contexto, el sustantivo es el evento
            //     real. Ejemplos:
            //         "salir al cumpleaños de Urrutia" → "cumpleaños de Urrutia"
            //         "ir al matrimonio de Pedro" → "matrimonio de Pedro"
            //         "voy a la cena de fin de año" → "cena de fin de año"
            //     Lookahead `(?=...)` para NO consumir el sustantivo — sólo
            //     el verbo + artículo. La whitelist cubre los nouns más
            //     frecuentes en eventos sociales/profesionales. NO incluye
            //     "casa/oficina/trabajo" porque ya van por la regla 3b-ter
            //     (location stripping cuando hay verbo de movimiento).
            #"^\s*(salir|ir|me\s+voy|me\s+salgo|voy|vamos)\s+(al?|a\s+la|a\s+los|a\s+las)\s+(?=(cumplea[ñn]os|cumple|fiesta|reuni[oó]n|matrimonio|boda|funeral|entrenamiento|clase|clases|concierto|partido|cena|almuerzo|cita|m[eé]dico|doctor|dentista|peluquer[ií]?a?|gym|gimnasio|hospital|cl[ií]nica|misa|onom[aá]stico|aeropuerto|mall|cine|teatro|consulta|consultorio|farmacia|supermercado|banco|kiosko|kiosco|f[eé]ria))\b"#,
            // 5. "Seguir + [gerund]" → strip "seguir" para dejar el verbo
            //    activo ("seguir trabajando" → "trabajando"). Apunta al
            //    caso del user: "tengo que seguir trabajando con focus"
            //    debe quedar como "Trabajar con focus" tras pasar también
            //    por el gerund-to-infinitive map abajo. "Seguir" solo
            //    cuando va inmediatamente seguido de un verbo terminado
            //    en -ando/-iendo/-yendo (gerund) o un -ar/-er/-ir
            //    (infinitivo). "yendo" cubre gerundios irregulares
            //    ("leyendo" de leer, "cayendo" de caer, "yendo" de ir).
            #"^\s*seguir\s+(?=\S+(?:ando|iendo|yendo|ar|er|ir)\b)"#
        ]
        for pattern in eventoPrefixPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let ns = result as NSString
                let range = NSRange(location: 0, length: ns.length)
                result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: "")
            }
        }

        // 3c-bis. RE-APLICACIÓN: después de strippear "luego" en step 0,
        //         el siguiente prefijo ("tengo que") quedó al inicio. El
        //         patrón #2 ya no matcheó porque corrió antes de que "luego"
        //         se fuera. Re-ejecutamos los prefix patterns una vez más
        //         para cubrir esa cadena. Idempotente: si no hay nada que
        //         strippear, no cambia el texto.
        for pattern in eventoPrefixPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let ns = result as NSString
                let range = NSRange(location: 0, length: ns.length)
                result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: "")
            }
        }

        // 4. Strip fillers comunes.
        let fillerPatterns: [String] = [
            #"\bporfa(vor)?\b"#,
            #"\bpor favor\b"#,
            #"\boye\b"#,
            #"\bhey\b"#,
            #"\bdale\b"#,
            #"\bche\b"#
        ]
        for pattern in fillerPatterns {
            result = result.replacingOccurrences(
                of: pattern,
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // 5. "ir a buscar [a la|a el|a los|a las] X" → "Buscar a X".
        //    Si HABÍA artículo, capitalizamos X (es nombre propio en español
        //    cuando se nombra con artículo "la Agustina" = nombre familiar).
        //    Si NO había artículo, dejamos X como está ("a mi hermano").
        result = stripVerboseGoVerb(result, verb: "ir a buscar")

        // 6. "salir a buscar a X" → "Buscar a X"
        result = stripVerboseGoVerb(result, verb: "salir a buscar")

        // 6b. "buscar a la X" (sin "ir a" / "salir a") → "Buscar a X".
        //     Caso C del spec: "buscar a la Agustina tipo 3 acuérdate"
        //     debe quedar como "Buscar a Agustina" — el artículo "la"
        //     antes de nombre propio es coloquial y se descarta. Como
        //     el verbo principal ya es "buscar" (no "ir a buscar"), no
        //     necesitamos prefix-stripear — solo el artículo + capitalizar.
        if let regex = try? NSRegularExpression(
            pattern: #"^\s*buscar\s+a\s+(la|el|los|las)\s+([a-záéíóúñA-ZÁÉÍÓÚÑ]+)"#,
            options: [.caseInsensitive]
        ) {
            let ns = result as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let match = regex.firstMatch(in: result, range: range),
               match.numberOfRanges >= 3 {
                let noun = ns.substring(with: match.range(at: 2))
                let cap = noun.prefix(1).uppercased() + noun.dropFirst()
                let rest = ns.substring(from: match.range.location + match.range.length)
                result = "Buscar a \(cap)\(rest)"
            }
        }

        // 7. Quitar artículos antes de nombres propios: "con la Agustina"
        //    → "con Agustina". Solo aplica cuando el sustantivo EMPIEZA EN
        //    MAYÚSCULA — señal de que es nombre propio ya capitalizado.
        //    Si el sustantivo es minúscula (ej. "para la reunión"), NO se
        //    toca: el artículo forma parte del español neutro correcto.
        if let regex = try? NSRegularExpression(
            pattern: #"\b(a|con|de|para|por) (la|las|el|los) ([a-záéíóúñA-ZÁÉÍÓÚÑ]+)\b"#,
            options: []  // case-sensitive: necesitamos ver la caja real del sustantivo
        ) {
            let ns = result as NSString
            let matches = regex.matches(in: result, range: NSRange(location: 0, length: ns.length))
            for match in matches.reversed() {
                guard match.numberOfRanges >= 4 else { continue }
                let prep = ns.substring(with: match.range(at: 1))
                let noun = ns.substring(with: match.range(at: 3))
                // Solo nombres propios (primera letra mayúscula).
                // "la reunión", "la clase" → lowercase → skip.
                // "la Agustina", "el Juan" → uppercase → strip artículo.
                guard noun.first?.isUppercase == true else { continue }
                result = (result as NSString)
                    .replacingCharacters(in: match.range, with: "\(prep) \(noun)")
            }
        }

        // 8. Limpieza de coma/;/: HUÉRFANA interior — una puntuación
        //    flanqueada por espacio (no pegada a la palabra previa) es
        //    residuo de un strip temporal/trigger, no puntuación legítima de
        //    lista ("Pan, leche" no tiene espacio antes de la coma → intacto).
        //    "remedios , algo" → "remedios algo"; "remedios ," → "remedios".
        result = result.replacingOccurrences(
            of: #"\s+[,;:](\s|$)"#, with: "$1", options: .regularExpression
        )

        // 8-bis. Collapse whitespace + trim puntuación de bordes.
        result = result
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        result = result.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // 8b. Verbos reflexivos → infinitivo base. "Dormirme" → "Dormir",
        //     "Despertarme" → "Despertar", "Levantarme" → "Levantar", etc.
        //     El usuario reportó: "si le digo dormirme a las 8 que el evento
        //     no se llame dormirme sino dormir". Whitelist explícita —
        //     evitar falsos positivos con palabras que casualmente terminen
        //     en -arme/-erme/-irme (ej. "Carme", "firme", "duerme"). Se
        //     aplica word-boundary, case-insensitive, preservando el resto
        //     del título. La capitalización final la hace step 9.
        result = stripReflexiveMe(in: result)

        // 8c. Gerundios → infinitivo base. "Trabajando" → "Trabajar",
        //     "Estudiando" → "Estudiar". Reportado por user 2026-05-15:
        //     "luego tengo que seguir trabajando con focus" tras strippear
        //     "luego" y "tengo que seguir" debería quedar "trabajar con
        //     focus" en infinitivo, no "trabajando con focus" en gerundio.
        //     Los títulos de eventos son acciones — infinitivo es lo
        //     idiomático. Whitelist conservadora para evitar romper
        //     palabras no-verbales que terminen en -ando/-iendo.
        result = stripGerunds(in: result)

        // 8d. Normalizar "cumple/cumpleaños de (la|el)? Person" →
        //     "cumple/cumpleaños Person". Drop del conector "de"/"de la"/
        //     "de el" + capitaliza la persona. Preserva la palabra del
        //     usuario (cumple vs cumpleaños).
        //
        //     Ejemplos (user spec 2026-05-27):
        //       "cumpleaños de Urrutia" → "Cumpleaños Urrutia"
        //       "cumple de la Cata"     → "Cumple Cata"
        //       "cumpleaños del Pedro"  → "Cumpleaños Pedro"
        if let regex = try? NSRegularExpression(
            pattern: #"\b(cumple(?:años|anos)?)\s+de(?:l)?(?:\s+(?:la|el))?\s+([a-záéíóúñA-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+)\b"#,
            options: [.caseInsensitive]
        ) {
            let ns = result as NSString
            let matches = regex.matches(in: result, range: NSRange(location: 0, length: ns.length))
            for match in matches.reversed() {
                guard match.numberOfRanges >= 3 else { continue }
                let activity = ns.substring(with: match.range(at: 1))
                let person = ns.substring(with: match.range(at: 2))
                let personCap = person.prefix(1).uppercased() + person.dropFirst()
                result = (result as NSString)
                    .replacingCharacters(in: match.range, with: "\(activity) \(personCap)")
            }
        }

        // Los posesivos familiares ("a mi hermano", "con mi papá", "llamar a
        // mi mamá") se CONSERVAN — leen más natural que "a hermano" / "con
        // papá", que sonaban secos. (Decisión 2026-06-01.)

        // 8f. Capitalizar palabras tras "con " y "a " que parezcan nombres
        //     propios (lowercase + ≥3 letras), excluyendo sustantivos comunes
        //     y artículos. User spec:
        //       "reunión con cristina" → "Reunión con Cristina"
        //       "llamar a cristina"    → "Llamar a Cristina"
        //
        //     Lista de exclusión: artículos, números, pronombres, sustantivos
        //     genéricos que aparecen tras "con/a" pero no son nombres.
        let nameCapSkipList: Set<String> = [
            "las", "los", "una", "uno", "casa", "oficina", "trabajo", "pega",
            "pieza", "jardin", "jardín", "patio", "escuela", "colegio",
            "liceo", "gimnasio", "gym", "consulta", "consultorio",
            "farmacia", "supermercado", "banco", "mall", "cine", "teatro",
            "comer", "salir", "ir", "ver", "comprar", "hacer", "estudiar",
            "trabajar", "hablar", "cargar", "leer", "escribir", "tomar",
            "almorzar", "cenar", "desayunar", "merendar", "dormir",
            "despertar", "levantar", "mediodía", "mediodia", "tarde",
            "noche", "mañana", "manana", "siesta", "dos", "tres", "cuatro",
            "cinco", "seis", "siete", "ocho", "nueve", "diez", "once",
            "doce", "trece", "catorce", "quince", "veinte", "treinta",
            "pap", "mam", "papá", "mamá", "papa", "mama", "hermano",
            "hermana", "hijo", "hija", "padre", "madre", "abuelo", "abuela",
            "tío", "tía", "tio", "tia", "primo", "prima", "esposo", "esposa",
            "novio", "novia", "polola", "pololo", "amigo", "amiga", "jefe",
            "jefa", "amigos", "amigas", "compañeros", "companeros",
            "compañeras", "companeras",
            // Infinitivos comunes tras "a" ("salir a correr", "ir a jugar")
            // — son acciones, no nombres propios (QA-closure 2026-06-10).
            "jugar", "correr", "trotar", "caminar", "nadar", "entrenar",
            "bailar", "cocinar", "descansar", "pasear", "buscar", "llevar",
            "pelota", "botines", "agua", "audífonos", "audifonos",
            "regalo", "copete", "bebidas", "cartas", "computador", "pauta",
            "antes", "ortografía", "ortografia", "certificado", "radiografía",
            "radiografia", "exámenes", "examenes", "proyecto", "postre",
            "libro", "bugs", "subtítulos", "subtitulos", "testflight",
            "carnet", "leche", "remedios", "pelota", "pan", "mail",
            "matemática", "matematica", "historia", "lenguaje", "redacción",
            "redaccion", "teorías", "teorias", "comunicación", "comunicacion",
            "portafolio", "mindfulness", "focus", "nova",
        ]
        let nameCapPatterns: [String] = [
            #"\bcon\s+([a-záéíóúñ])([a-záéíóúñ]{2,})\b"#,
            #"\ba\s+([a-záéíóúñ])([a-záéíóúñ]{2,})\b"#,
        ]
        for pattern in nameCapPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
                let ns = result as NSString
                let matches = regex.matches(in: result, range: NSRange(location: 0, length: ns.length))
                for match in matches.reversed() {
                    guard match.numberOfRanges >= 3 else { continue }
                    let firstLetter = ns.substring(with: match.range(at: 1))
                    let rest = ns.substring(with: match.range(at: 2))
                    let fullWord = (firstLetter + rest).lowercased()
                    if nameCapSkipList.contains(fullWord) { continue }
                    // Preserva el prefijo (con/a) y separador — solo cambia
                    // la inicial del sustantivo.
                    let prefixRange = NSRange(
                        location: match.range.location,
                        length: match.range(at: 1).location - match.range.location
                    )
                    let prefixStr = ns.substring(with: prefixRange)
                    result = (result as NSString).replacingCharacters(
                        in: match.range,
                        with: "\(prefixStr)\(firstLetter.uppercased())\(rest)"
                    )
                }
            }
        }

        // 8g. Strip trailing detail action chain. Cuando un verbo de detalle
        //     ("llevar", "comprar", "hablar", etc.) aparece DESPUÉS de
        //     contenido sustantivo en el título, lo strippeamos — el
        //     detalle se re-extrae como subtítulo vía
        //     `extractEventDetail(from: userText)`.
        //
        //     Casos del user spec 2026-05-27:
        //       "futbol llevar la pelota"  → "futbol"
        //       "supermercado comprar leche" → "supermercado"
        //       "trabajar en Nova arreglar subtítulos" → "trabajar en Nova"
        //
        //     Anclaje en `^...$` + non-greedy en el prefijo garantiza que se
        //     captura solo cuando el verbo viene PRECEDIDO por contenido.
        //     "comprar pan" sin contenido antes NO matchea (es el título).
        if let regex = try? NSRegularExpression(
            pattern: "^(\\S+(?:\\s+\\S+){0,15}?)\\s+(?:\(detailActionVerbs)|no\\s+olvidar(?:me)?)\\s+\\S+(?:\\s+\\S+)*$",
            options: [.caseInsensitive]
        ) {
            let ns = result as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let match = regex.firstMatch(in: result, range: range),
               match.numberOfRanges >= 2 {
                let prefix = ns.substring(with: match.range(at: 1))
                let trimmedPrefix = prefix.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmedPrefix.isEmpty {
                    result = trimmedPrefix
                }
            }
        }

        // 8h. Strip "por el tema (de) X" trailing — capturado como subtítulo
        //     prefijado "Tema X" por extractEventDetail.
        result = result.replacingOccurrences(
            of: #"\s+por\s+el\s+tema(?:\s+de)?\s+\S+(?:\s+\S+)*$"#,
            with: " ",
            options: [.regularExpression, .caseInsensitive]
        )

        // 8i. Re-collapse después de strips 8d-8h.
        result = result
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // 9. Capitalize primera letra del título si no lo está.
        guard let firstChar = result.first else { return "" }
        if firstChar.isLowercase {
            result = firstChar.uppercased() + result.dropFirst()
        }

        return result
    }

    // MARK: - Fallback: backend devolvió título demasiado pobre

    /// Verbos de movimiento que NUNCA deberían ser el título completo —
    /// son contextuales ("voy a", "salgo al", "me voy a"). Cuando el
    /// backend devuelve uno de estos como título único, significa que
    /// extrajo mal: el evento real está en el sustantivo que sigue
    /// ("salir al cumpleaños de X" → backend devolvió "Salir", el evento
    /// real es "Cumpleaños de X").
    private static let motionOnlyTitles: Set<String> = [
        "salir", "salgo", "ir", "voy", "vamos", "vámonos",
        "me voy", "me salgo", "iré", "ire", "irme", "salirme"
    ]

    /// Decide qué título usar después de pasar el del backend por `cleanTitle`.
    /// Si el resultado del backend es solo un verbo de movimiento (caso real
    /// del user 2026-05-15: "Tengo que salir al cumpleaños de Urrutia" → el
    /// backend devolvía "Salir"), re-extraemos el título limpiando el
    /// `userText` completo — eso captura el sustantivo verdadero del evento.
    ///
    /// Reglas:
    /// - Si `backendCleaned` NO es motion-only y NO está vacío → se conserva.
    /// - Si SÍ es motion-only (o vacío), re-corremos `cleanTitle(userText)`.
    ///   Si la re-extracción produce algo distinto y NO motion-only → se usa.
    ///   Si no, se conserva el original como último recurso.
    ///
    /// Privacy: no logueamos contenidos. Devuelve el título a usar.
    static func preferBetterTitle(
        backendCleaned: String,
        userText: String
    ) -> String {
        let trimmed = backendCleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        let isMotionOnly = motionOnlyTitles.contains(lower)

        if !trimmed.isEmpty && !isMotionOnly {
            return trimmed
        }

        // Backend devolvió pobre — reextraer desde userText.
        let fromUser = cleanTitle(userText)
        let fromUserLower = fromUser.lowercased()
        if !fromUser.isEmpty
            && !motionOnlyTitles.contains(fromUserLower)
            && fromUserLower != lower {
            return fromUser
        }
        return trimmed
    }

    /// Mapa de verbos reflexivos comunes (1ª persona singular) a su forma
    /// infinitiva base. Whitelist explícita para evitar romper palabras
    /// como "Carme" (nombre), "firme", "duerme" — cosas que casualmente
    /// terminan en -arme/-erme/-irme pero no son verbos reflexivos.
    ///
    /// Cubre las cinco familias más comunes en eventos del día a día:
    /// dormir/despertar/levantar/acostar (descanso), duchar/bañar/lavar/
    /// peinar/vestir/afeitar/cambiar (higiene y arreglo), preparar/
    /// concentrar/relajar/calmar (foco), mover/ejercitar/estirar (cuerpo),
    /// salir/ir (transición — sólo cuando el usuario dice "salirme" o
    /// "irme" como acción puntual).
    private static let reflexiveVerbMap: [String: String] = [
        // Descanso
        "dormirme":     "dormir",
        "despertarme":  "despertar",
        "levantarme":   "levantar",
        "acostarme":    "acostar",
        // Higiene
        "ducharme":     "duchar",
        "bañarme":      "bañar",
        "banarme":      "bañar",       // sin tilde
        "lavarme":      "lavar",
        "peinarme":     "peinar",
        "vestirme":     "vestir",
        "afeitarme":    "afeitar",
        "cambiarme":    "cambiar",
        // Foco / mente
        "prepararme":   "preparar",
        "concentrarme": "concentrar",
        "relajarme":    "relajar",
        "calmarme":     "calmar",
        // Cuerpo
        "moverme":      "mover",
        "ejercitarme":  "ejercitar",
        "estirarme":    "estirar",
        // Transición (sólo si vino así literalmente)
        "irme":         "ir",
        "salirme":      "salir",
        "volverme":     "volver",
    ]

    /// Gerundios comunes (ando/iendo) mapeados a su infinitivo. Whitelist
    /// — solo cubre verbos frecuentes de actividades para evitar tocar
    /// palabras no-verbales. Si el user dice un gerundio raro que no está
    /// acá, queda como está (no rompe nada, solo el título sigue en gerund).
    private static let gerundToInfinitiveMap: [String: String] = [
        // Trabajo / foco
        "trabajando":   "trabajar",
        "estudiando":   "estudiar",
        "leyendo":      "leer",
        "escribiendo":  "escribir",
        "revisando":    "revisar",
        "preparando":   "preparar",
        "practicando":  "practicar",
        "investigando": "investigar",
        "programando":  "programar",
        "diseñando":    "diseñar",
        "disenando":    "diseñar",
        "planificando": "planificar",
        // Cuerpo / ejercicio
        "corriendo":    "correr",
        "caminando":    "caminar",
        "entrenando":   "entrenar",
        "haciendo":     "hacer",
        "jugando":      "jugar",
        "nadando":      "nadar",
        // Social / comida
        "comiendo":     "comer",
        "cenando":      "cenar",
        "almorzando":   "almorzar",
        "tomando":      "tomar",
        "hablando":     "hablar",
        "conversando":  "conversar",
        "llamando":     "llamar",
        // Casa / mantenimiento
        "limpiando":    "limpiar",
        "ordenando":    "ordenar",
        "lavando":      "lavar",
        "cocinando":    "cocinar",
    ]

    /// Reemplaza gerundios del map por su infinitivo base usando word-boundary.
    private static func stripGerunds(in input: String) -> String {
        var result = input
        for (gerund, infinitive) in gerundToInfinitiveMap {
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: gerund) + "\\b"
            result = result.replacingOccurrences(
                of: pattern,
                with: infinitive,
                options: [.regularExpression, .caseInsensitive]
            )
        }
        return result
    }

    /// Sustituye cualquier ocurrencia (case-insensitive) de un verbo
    /// reflexivo del map por su infinitivo base, preservando el resto del
    /// título. Solo word-boundary — no toca substrings (ej. "carme" en
    /// "carmen" NO matchea porque "carmen" tiene una letra extra).
    private static func stripReflexiveMe(in input: String) -> String {
        var result = input
        for (reflexive, base) in reflexiveVerbMap {
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: reflexive) + "\\b"
            result = result.replacingOccurrences(
                of: pattern,
                with: base,
                options: [.regularExpression, .caseInsensitive]
            )
        }
        return result
    }

    /// Strip "ir a buscar [a la/a el/a los/a las] X" / "salir a buscar ..."
    /// Comportamiento:
    /// 1. CON artículo definido ("a la Agustina") → consume artículo,
    ///    capitaliza noun y devuelve "Buscar a Agustina" (idiomático: "la X"
    ///    en español familiar es nombre propio, decir "Ir a" resulta
    ///    redundante).
    /// 2. SIN artículo definido (ej. "a mi hermano", "pan", "a Juan") → NO
    ///    acortamos. Devolvemos el input tal cual para que "Ir a buscar a
    ///    mi hermano" se conserve. Antes lo cortábamos a "Buscar a mi
    ///    hermano" que sonaba seco.
    private static func stripVerboseGoVerb(_ input: String, verb: String) -> String {
        let escaped = NSRegularExpression.escapedPattern(for: verb)
        let ns = input as NSString
        let fullRange = NSRange(location: 0, length: ns.length)

        // Case 1: definite article (la|el|los|las) → strip "verbo a artículo "
        // y capitalize el sustantivo (es nombre propio coloquial, ej. "la
        // Agustina" → "Agustina").
        let articlePattern = "^\\s*\(escaped)\\s+a\\s+(la|el|los|las)\\s+"
        if let regex = try? NSRegularExpression(pattern: articlePattern, options: [.caseInsensitive]),
           let match = regex.firstMatch(in: input, range: fullRange) {
            var rest = ns.substring(from: match.range.length)
            if let firstChar = rest.first, firstChar.isLowercase {
                rest = firstChar.uppercased() + rest.dropFirst()
            }
            return "Buscar a " + rest
        }

        // Case 2: posesivo (mi|tu|su|...) → strip SÓLO el verbo de
        // movimiento ("ir a buscar "/"salir a buscar "), DEJANDO INTACTO
        // el "a (poss) noun". Caso real del user: "ir a buscar a mi polola"
        // → "Buscar a mi polola" (no se capitaliza "polola", es un noun
        // común, no nombre propio).
        //
        // Antes (2026-05-15) descartábamos el shortening cuando no había
        // artículo definido para evitar que "Buscar a mi hermano" sonara
        // "seco". Pero el caso polola demostró que cuando el verbo es
        // explícitamente verboso ("ir a buscar a mi X"), el usuario quiere
        // "Buscar a mi X" — más limpio, más natural, sin el "Ir a" redundante.
        let possessivePattern = "^\\s*\(escaped)\\s+(?=a\\s+(mi|tu|su|mis|tus|sus|nuestra|nuestro)\\s+)"
        if let regex = try? NSRegularExpression(pattern: possessivePattern, options: [.caseInsensitive]),
           regex.firstMatch(in: input, range: fullRange) != nil {
            let stripped = regex.stringByReplacingMatches(in: input, range: fullRange, withTemplate: "")
            return "Buscar " + stripped
        }

        // No matched → keep input as-is (verbo se mantiene). Caller continúa.
        return input
    }

    // MARK: - endTime rules

    /// Decide qué endTime guardar en el FocusEvent según las reglas del producto:
    /// - **Rango explícito SIEMPRE gana**: si `hasExplicitEndTime` y end > start,
    ///   se respeta. Aplica también cuando `isReminder == true` — bajo el nuevo
    ///   modelo "todo con hora = bloque", el flag de aviso anticipado va como
    ///   chip dentro del mismo bloque (vía `reminderOffsets`), NO reemplaza la
    ///   duración real. Antes "reunión de 5 a 6 acuérdame 15 min antes" perdía
    ///   el rango porque `isReminder=true` devolvía `nil`.
    /// - **Reminder sin rango** → `nil` (UI muestra punto, sin duración).
    /// - **Sin rango ni reminder** → `nil` con `inferredDuration=true` (UI lo
    ///   trata como punto inferido).
    ///
    /// Importante: NO devolvemos `start + 5min` artificial — eso causaba que
    /// recordatorios vencidos se vieran como "próximos" hasta 5 min después.
    /// El store puede internamente padear si necesita, pero la decisión
    /// visible va por acá.
    static func resolveEndTime(
        startTime: Date,
        providedEndTime: Date?,
        hasExplicitEndTime: Bool,
        isReminder: Bool
    ) -> (endTime: Date?, inferredDuration: Bool) {
        // Rango explícito gana — incluso si el usuario dijo "acuérdame N antes".
        // El offset va como chip dentro del mismo bloque, no como duración.
        if hasExplicitEndTime, let end = providedEndTime, end > startTime {
            return (end, false)
        }
        if isReminder {
            return (nil, false)  // recordatorio puntual sin rango
        }
        return (nil, true)  // duración inferida, mostrar como punto
    }

    // MARK: - Nunca crear en el pasado (fix chat→Mi Día 2026-08-10)

    /// Margen de gracia contra el "recién pasado": una hora que pasó hace
    /// ≤ 2 min se considera "ahora" ("a las 9" dicho a las 9:01 es ese
    /// momento, no mañana). También se acepta un candidato PM que quede
    /// dentro del margen ("a las 8" a las 20:01 → hoy 20:00).
    private static let pastGraceInterval: TimeInterval = 2 * 60

    /// True cuando el usuario ancló EXPLÍCITAMENTE el día en su texto:
    /// "hoy", "mañana", "pasado mañana", un día de semana, una fecha ISO o
    /// "N de <mes>". En esos casos NUNCA movemos el evento de día — el
    /// usuario fue claro y moverlo sería peor que respetarlo.
    ///
    /// Ojo con "de la mañana": es franja horaria (AM), no el día "mañana".
    /// Se strippea antes de buscar `\bmañana\b` para no dar falso positivo
    /// en frases como "gimnasio a las 7 de la mañana".
    static func userAnchoredExplicitDay(in text: String) -> Bool {
        let lower = text.lowercased()
        let withoutDayparts = lower.replacingOccurrences(
            of: #"\b(de|en|por)\s+la\s+(mañana|manana|madrugada)\b"#,
            with: " ",
            options: .regularExpression
        )
        let dayPatterns: [String] = [
            #"\bhoy\b"#,
            #"\bma(ñ|n)ana\b"#,          // cubre también "pasado mañana"
            #"\b(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)\b"#,
            #"\b\d{4}-\d{2}-\d{2}\b"#,
            #"\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b"#,
        ]
        return dayPatterns.contains {
            withoutDayparts.range(of: $0, options: .regularExpression) != nil
        }
    }

    /// True cuando el texto trae un marcador AM explícito ("7 am",
    /// "de la mañana", "madrugada"). Con AM explícito, un roll-forward
    /// jamás debe convertir la hora en PM — solo puede saltar a mañana.
    static func userGaveExplicitAmMarker(in text: String) -> Bool {
        let lower = text.lowercased()
        if lower.range(of: #"\b\d{1,2}\s*(am|a\.m\.)\b"#, options: .regularExpression) != nil {
            return true
        }
        return lower.contains("de la mañana")
            || lower.contains("de la manana")
            || lower.contains("madrugada")
    }

    /// Contextos que el parser resuelve como AM por SEMÁNTICA aunque no
    /// haya marcador explícito (espejo del forceAM de `detectHourContext`):
    /// despertar/levantar/amanecer/desayunar + ámbito escolar. Para estos,
    /// el upgrade a PM del mismo día no tiene sentido — "despertarme a las
    /// 7" pedido a las 14h es MAÑANA 07:00, jamás hoy 19:00.
    private static let morningContextPattern: String =
        #"\b(despertar(me|te|se|nos|los)?|despertame|despertarnos|despierto|despierta|levantar(me|te|se|nos|los)?|levantame|levantarnos|levanto|levanta|amanecer|amanezca|amanezco|desayunar|desayuno|desayunamos|clase|clases|universidad|colegio|escuela|facultad|liceo|preescolar)\b"#

    private static func impliesMorningContext(in text: String) -> Bool {
        text.range(
            of: morningContextPattern,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    /// Regla de producto (fix del bug chat→Mi Día): **nunca crear un ítem
    /// en el pasado silenciosamente**. Caso real: "acuérdame de tomar mis
    /// remedios a las 8" pedido a las 21h resolvía HOY 08:00 — hora ya
    /// pasada — y el recordatorio nacía "vencido": Mi Día lo esconde del
    /// timeline (va a la sección Vencidos) y la notificación nunca se
    /// programa. El usuario percibía que el chat "no creó nada".
    ///
    /// Si la hora resuelta ya pasó hoy Y el usuario NO ancló el día:
    ///   1. Hora 1–11 sin marcador AM explícito → probar la versión PM de
    ///      HOY ("remedios a las 8" a las 14h → hoy 20:00).
    ///   2. Si la PM también pasó (o había AM explícito / hora ≥ 12) →
    ///      MAÑANA a esa misma hora ("remedios a las 8" a las 21h →
    ///      mañana 08:00).
    ///
    /// Con día explícito ("hoy", "mañana", weekday) no se toca nada — se
    /// respeta lo que el usuario dijo aunque quede en el pasado (Mi Día lo
    /// muestra como vencido, que es honesto).
    ///
    /// `now`/`calendar` son inyectables para tests deterministas.
    static func resolveNonPastStartTime(
        startTime: Date,
        userText: String,
        now: Date = Date(),
        calendar: Calendar = Calendar.current
    ) -> (startTime: Date, didRollForward: Bool) {
        // ¿Realmente pasado? (con margen de gracia para el "recién ahora").
        guard startTime < now.addingTimeInterval(-pastGraceInterval) else {
            return (startTime, false)
        }
        guard !userAnchoredExplicitDay(in: userText) else {
            return (startTime, false)
        }
        let hour = calendar.component(.hour, from: startTime)
        let minute = calendar.component(.minute, from: startTime)

        // Paso 1: upgrade AM → PM del MISMO día, solo si el usuario no
        // dijo AM explícito, la frase no implica mañana-del-día (verbos de
        // despertar / contexto escolar) y la versión PM todavía alcanza.
        if (1...11).contains(hour),
           !userGaveExplicitAmMarker(in: userText),
           !impliesMorningContext(in: userText),
           let pmCandidate = calendar.date(
               bySettingHour: hour + 12, minute: minute, second: 0, of: startTime
           ),
           pmCandidate > now.addingTimeInterval(-pastGraceInterval) {
            return (pmCandidate, true)
        }

        // Paso 2: mañana a la misma hora.
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: startTime),
           let rolled = calendar.date(
               bySettingHour: hour, minute: minute, second: 0, of: tomorrow
           ) {
            return (rolled, true)
        }
        return (startTime, false)
    }

    // MARK: - Gates de hora explícita en `userText`

    /// True si el usuario mencionó explícitamente una **hora-fin** o
    /// duración del evento. Reconoce los mismos patrones que el parser
    /// local (`FocusDataStore.extractExplicitEndTime`) más algunas
    /// variantes naturales:
    ///   - "de 5 a 7", "de las 17 a las 19", "5 a 7"
    ///   - "hasta las 4", "hasta 16:00"
    ///   - "por 2 horas", "durante 30 min", "por una hora"
    ///   - "1h", "30 min" como complemento de "por/durante"
    ///
    /// Se usa para **gatear el `endTimeString` que devuelve el backend**:
    /// si el modelo IA inventa una hora-fin pero el usuario nunca la dijo,
    /// se ignora y el evento queda como punto en el tiempo.
    static func userMentionedExplicitEndTime(in text: String) -> Bool {
        let lower = text.lowercased()
        let patterns: [String] = [
            // "de X a Y" / "de las X a las Y" / "X a Y" con horas
            #"\bde\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s+a\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b"#,
            #"\b\d{1,2}(?::\d{2})?\s+a\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s*(?:de\s+la\s+(?:tarde|mañana|manana|noche))?\b"#,
            // "hasta las X" / "hasta X"
            #"\bhasta\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b"#,
            // "por N horas" / "durante N min"
            #"\b(?:por|durante)\s+\d{1,3}\s*(?:h|hs|hrs?|hora|horas|min|minutos?)\b"#,
            // "por una hora" / "por media hora" / "por dos horas"
            #"\b(?:por|durante)\s+(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio)\s+(?:hora|horas|min|minutos?)\b"#,
        ]
        for pattern in patterns {
            if lower.range(of: pattern, options: [.regularExpression]) != nil {
                return true
            }
        }
        return false
    }

    /// True si el usuario mencionó algún marcador de **hora del día** en el
    /// texto. Cubre formatos numéricos ("a las 4", "16:00", "tipo 5"),
    /// horas en palabras ("a las tres"), tiempo relativo ("en 20 min"),
    /// y marcadores de franja horaria ("esta tarde", "al mediodía").
    ///
    /// Usado para **gatear `addEvent` del backend**: si el modelo IA
    /// quiere crear un evento horario pero el usuario solo dijo
    /// "fútbol hoy" (sin hora), preferimos crear una tarea/recordatorio
    /// del día en vez de un evento con hora inventada.
    static func userMentionedAnyTimeOfDay(in text: String) -> Bool {
        let lower = text.lowercased()
        let patterns: [String] = [
            // "a las 4", "a la 1", "a las 4:30"
            #"\ba\s+la?s?\s+\d{1,2}(?::\d{2})?\b"#,
            // "16:00", "4:30" — formato HH:MM puro
            #"\b\d{1,2}:\d{2}\b"#,
            // "tipo 3", "tipo las 5"
            #"\btipo\s+(?:la?s?\s+)?\d{1,2}\b"#,
            // "como a las 4", "a eso de las 6", "cerca de las 7"
            #"\b(?:como\s+a|a\s+eso\s+de|cerca\s+de|alrededor\s+de)\s+la?s?\s+\d{1,2}\b"#,
            // "5 am", "10pm", "8 hs", "9hrs"
            #"\b\d{1,2}\s*(?:am|pm|hs|hrs?)\b"#,
            // "en 20 min", "en 2 horas", "en 30"
            #"\ben\s+\d{1,3}(?:\s+(?:min|minutos?|h|hs|hrs?|horas?))?\b"#,
            // Horas en palabras tras "a las / tipo / como a las": "a las tres",
            // "tipo cinco", "a eso de las seis".
            #"\b(?:a\s+la?s?|tipo(?:\s+la?s?)?|como\s+a\s+la?s?|a\s+eso\s+de\s+la?s?|cerca\s+de\s+la?s?|alrededor\s+de\s+la?s?)\s+(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuna|veintidós|veintidos|veintitrés|veintitres)\b"#,
            // "hasta las X" / "de X a Y" también implican hora
            #"\bhasta\s+(?:la?s?\s+)?\d{1,2}\b"#,
            #"\bde\s+(?:la?s?\s+)?\d{1,2}\s+a\s+(?:la?s?\s+)?\d{1,2}\b"#,
        ]
        for pattern in patterns {
            if lower.range(of: pattern, options: [.regularExpression]) != nil {
                return true
            }
        }
        // Franjas horarias coloquiales ("esta tarde", "al mediodía") cuentan
        // como marcador de momento, no de hora exacta — para `addEvent` no
        // las consideramos suficientes (el backend tendría que inventar igual
        // una hora exacta dentro de la franja). Por diseño, devolvemos false
        // y el evento se desvía a tarea. Si el producto quiere darles
        // tratamiento especial (ej. inferir 13:00 para "mediodía"), agregar acá.
        return false
    }

    // MARK: - Subtitle / contexto semántico

    /// Separa un título en `(activityTitle, contextSubtitle)` cuando empieza
    /// con "reunión" + " de " + tópico. Caso de uso del user spec:
    ///   "Reunión de mindfulness con Cristina" → ("Reunión", "Mindfulness con Cristina")
    ///
    /// IMPORTANTE — restricciones de diseño:
    /// - **Solo "reunión"/"reunion"** dispara split. Cualquier otra palabra
    ///   de actividad ("clase", "prueba", "entrega", "almuerzo", ...) deja
    ///   el "de X" pegado al título ("Clase de redacción", "Prueba de
    ///   teorías", "Almuerzo con papá") — match al spec del usuario donde
    ///   ese "de X" identifica al evento, no es contexto separable.
    /// - " con " **nunca** es separador. "Reunión con Cristina" se conserva
    ///   como un solo título.
    /// - "Cumpleaños de Person" se normaliza en `cleanTitle` (drop "de"),
    ///   no acá. Por eso "Cumpleaños Urrutia" llega ya como un solo bloque
    ///   y este método devuelve nil.
    ///
    /// El detalle trailing ("acordarme de llevar la pelota", "hablar de
    /// mindfulness", "comprar regalo") se extrae por separado vía
    /// `extractEventDetail(from: userText)` — esta función NO lo maneja.
    static func splitTitleSubtitle(_ rawTitle: String) -> (title: String, subtitle: String)? {
        let trimmed = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let lower = trimmed.lowercased()

        // ── Regla general: CABEZA DE ACTIVIDAD + calificador. El título es el
        // TIPO de actividad y lo que sigue (con o sin "de") es el tema/parte,
        // que va al subtítulo. Cubre el spec canónico: "gym pierna" → Gym +
        // Pierna, "clase de álgebra" → Clase + Álgebra, "terapia ansiedad" →
        // Terapia + Ansiedad, "entrenamiento de espalda" → Entrenamiento +
        // Espalda. NO parte si el conector es "con" (persona) — "Reunión con
        // Juan" se queda íntegra. Las cabezas son una whitelist conservadora.
        let activityHeads = ["gym", "gimnasio", "clase", "clases", "terapia",
                             "entrenamiento", "entreno", "prueba", "examen",
                             "estudiar", "estudio", "taller", "curso", "ensayo",
                             "llamada", "entrega", "yoga", "pilates", "partido"]
        for head in activityHeads where lower.hasPrefix(head + " ") {
            let afterHead = String(trimmed.dropFirst(head.count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            var rest = afterHead
            // Conector "de " opcional al inicio del calificador.
            if rest.lowercased().hasPrefix("de ") {
                rest = String(rest.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let restLower = rest.lowercased()
            // No partir si el calificador es persona ("con X") o vacío/artículo.
            if restLower.hasPrefix("con ") || rest.isEmpty { break }
            if ["la", "el", "los", "las", "un", "una", "mi", "tu", "su"].contains(restLower) { break }
            let titleCap = head.prefix(1).uppercased() + head.dropFirst()
            let subCap = rest.prefix(1).uppercased() + rest.dropFirst()
            return (String(titleCap), String(subCap))
        }

        // Solo "reunión"/"reunion" — con o sin artículo opcional. Otras
        // actividades quedan intactas (ver doc).
        let triggers = ["reunión", "reunion", "la reunión", "la reunion",
                        "una reunión", "una reunion"]
        guard let trigger = triggers.first(where: { lower.hasPrefix($0) }) else {
            return nil
        }
        // Necesitamos " de " DESPUÉS del trigger.
        let afterTriggerStart = lower.index(lower.startIndex, offsetBy: trigger.count)
        let afterTrigger = lower[afterTriggerStart...]
        guard let deRange = afterTrigger.range(of: " de ") else { return nil }
        let absoluteAfterDe = lower.index(deRange.upperBound, offsetBy: 0)
        let subtitleRaw = String(trimmed[absoluteAfterDe...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !subtitleRaw.isEmpty else { return nil }
        // Subtítulo no debe ser solo un artículo o conector residual.
        let lowSub = subtitleRaw.lowercased()
        if ["la", "el", "los", "las", "un", "una"].contains(lowSub) { return nil }
        let titleCap = "Reunión"
        let subtitleCap = subtitleRaw.prefix(1).uppercased() + subtitleRaw.dropFirst()
        return (titleCap, String(subtitleCap))
    }

    // MARK: - Detalle / subtítulo trailing extraído del userText

    /// Verbos de acción que típicamente describen un DETALLE anclado a un
    /// evento (no son el título del evento mismo). Cuando uno de estos
    /// aparece DESPUÉS de un marcador de hora o tras un trigger de
    /// recordatorio, capturamos verbo+complemento como subtítulo.
    ///
    /// Lista derivada del user spec (test 50-case): llevar, comprar, traer,
    /// preparar, hablar, imprimir, estudiar, revisar, pedir, arreglar,
    /// mandar, hacer, firmar, entregar, enviar, sacar, cargar, recoger,
    /// terminar, finalizar.
    private static let detailActionVerbs: String =
        "llevar|llevarme|comprar|comprarme|traer|traerme|preparar|prepararme|hablar|imprimir|estudiar|revisar|revisarme|pedir|pedirme|arreglar|arreglarme|mandar|mandarme|hacer|firmar|entregar|entregarme|enviar|enviarme|sacar|sacarme|cargar|recoger|terminar|finalizar"

    /// Extrae el detalle trailing del `userText` original y devuelve:
    /// - `strippedText`: userText sin el span del detalle (útil si el
    ///   parser llamó a este método para reconstruir el título).
    /// - `detail`: el subtítulo limpio, capitalizado, o `nil` si no hay
    ///   match.
    ///
    /// Patrones que detecta (en orden de prioridad):
    /// 1. **Trigger explícito + acción** —
    ///    `acuérdame de llevar X`, `acordarme de comprar X`, `recordarme
    ///    de traer X`, `avísame de hablar de X`.
    /// 2. **"no olvidar / no te olvides / que no se me olvide" + acción** —
    ///    `no olvidar exámenes`, `no te olvides de llevar X`.
    /// 3. **"por el tema (de) X"** — `por el tema mindfulness` →
    ///    `Tema mindfulness`. Se prefija "Tema" para que el subtítulo
    ///    se lea natural y respete la convención del spec.
    /// 4. **Verbo de detalle trailing sin trigger** — `llevar X` /
    ///    `comprar X` / etc. al FINAL del texto, siempre y cuando haya
    ///    contenido sustantivo antes (heurística: el verbo no puede
    ///    estar en la posición 0, debe haber al menos un sustantivo o
    ///    marcador de hora antes). Esto cubre "futbol a las 5 llevar
    ///    la pelota" sin requerir trigger explícito.
    ///
    /// Notas:
    /// - "estudiar antes" se captura como detail aunque no haya "X" después.
    /// - Conserva mayúsculas/minúsculas del original (no fuerza lowercase).
    /// - Si el match cubre "todo" el userText (no queda título antes),
    ///   devuelve `(userText, nil)` — eso significa que ESE verbo es el
    ///   evento, no el detalle (ej. "comprar regalo" solo).
    static func extractEventDetail(from userText: String) -> (strippedText: String, detail: String?) {
        let lower = userText.lowercased()
        let originalNS = userText as NSString
        let lowerNS = lower as NSString
        let fullRange = NSRange(location: 0, length: lowerNS.length)

        // Patrón 1 — trigger explícito + acción (captura verbo+rest).
        let triggerPattern = "\\b(?:acu[eé]rdame|acordarme|recu[eé]rdame|recordarme|recordame|av[ií]same|acu[eé]rdate)\\s+de\\s+((?:\(detailActionVerbs)|no\\s+olvidar(?:me)?)\\s+[^.,;!?]+?)\\s*(?:$|[.,;!?])"
        // Patrón 2 — "no olvides / que no se me olvide" + acción.
        let noOlvidesPattern = "\\b(?:no\\s+(?:te\\s+)?olvides|que\\s+no\\s+se\\s+me\\s+olvide)(?:\\s+de)?\\s+((?:\(detailActionVerbs))\\s+[^.,;!?]+?)\\s*(?:$|[.,;!?])"
        // Patrón 3 — "no olvidar X" como verbo de detalle directo.
        let noOlvidarPattern = "\\b(no\\s+olvidar(?:me)?\\s+[^.,;!?]+?)\\s*(?:$|[.,;!?])"
        // Patrón 4 — "por el tema (de) X" → prefijo "Tema".
        let temaPattern = "\\bpor\\s+el\\s+tema(?:\\s+de)?\\s+(.+?)\\s*(?:$|[.,;!?])"
        // Patrón 5 — verbo trailing sin trigger (requiere contenido antes).
        // El `.{1,400}?` non-greedy + `\\s+\\S+` asegura ≥1 palabra antes.
        let trailingVerbPattern = "\\S+.{1,400}?\\s+((?:\(detailActionVerbs))\\s+[^.,;!?]+?)\\s*(?:$|[.,;!?])"

        // Orden importa — más específico primero.
        struct Attempt {
            let pattern: String
            let prefix: String?  // si != nil, prepend al detail capturado
            let captureIdx: Int
        }
        let attempts: [Attempt] = [
            Attempt(pattern: triggerPattern, prefix: nil, captureIdx: 1),
            Attempt(pattern: noOlvidesPattern, prefix: nil, captureIdx: 1),
            Attempt(pattern: noOlvidarPattern, prefix: nil, captureIdx: 1),
            Attempt(pattern: temaPattern, prefix: "Tema", captureIdx: 1),
            Attempt(pattern: trailingVerbPattern, prefix: nil, captureIdx: 1),
        ]

        for attempt in attempts {
            guard let regex = try? NSRegularExpression(pattern: attempt.pattern, options: [.caseInsensitive]) else { continue }
            guard let match = regex.firstMatch(in: lower, range: fullRange),
                  match.numberOfRanges > attempt.captureIdx,
                  match.range(at: attempt.captureIdx).location != NSNotFound else { continue }

            let captureRange = match.range(at: attempt.captureIdx)
            let rawCapture = originalNS.substring(with: captureRange)
            let cleanedCapture = cleanEventDetail(rawCapture)
            guard !cleanedCapture.isEmpty else { continue }

            let detail: String
            if let pref = attempt.prefix {
                // "Tema" + sustantivo en minúscula ("Tema banco", "Tema mindfulness").
                let lowerCapture = cleanedCapture.prefix(1).lowercased() + cleanedCapture.dropFirst()
                detail = "\(pref) \(lowerCapture)"
            } else {
                detail = cleanedCapture
            }

            // Stripped: conservamos todo lo que va ANTES del detalle (la
            // posición del capture group). Sin esto, patrones tipo
            // `\S+.{1,400}?\s+(llevar X)` matchean desde el inicio y
            // dejan strippedText vacío. Mantener el prefijo permite que
            // `adjustAmPm` (que usa strippedText para detectHourContext)
            // siga viendo el contexto del título principal ("gimnasio",
            // "terapia", "doctor"), no solo el detalle.
            let captureLoc = captureRange.location
            let stripped: String = {
                guard captureLoc > 0 else { return "" }
                let prefix = originalNS.substring(to: captureLoc)
                return prefix.trimmingCharacters(in: .whitespacesAndNewlines)
            }()
            let collapsed = stripped
                .components(separatedBy: .whitespacesAndNewlines)
                .filter { !$0.isEmpty }
                .joined(separator: " ")

            return (collapsed, detail)
        }

        return (userText, nil)
    }

    /// Limpia el texto extraído como detalle. Capitaliza primera letra,
    /// elimina puntuación trailing, conserva mayúsculas/acentos internos.
    private static func cleanEventDetail(_ raw: String) -> String {
        var d = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Strip "de " inicial si quedó huérfano (caso raro tras regex).
        if d.lowercased().hasPrefix("de ") {
            d = String(d.dropFirst(3))
        }
        // Strip fillers comunes.
        let fillers = [#"\bpor favor\b"#, #"\bporfa(vor)?\b"#]
        for pattern in fillers {
            d = d.replacingOccurrences(of: pattern, with: " ",
                                       options: [.regularExpression, .caseInsensitive])
        }
        d = d.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = d.first, first.isLowercase {
            d = first.uppercased() + d.dropFirst()
        }
        return d
    }

    // MARK: - Reminder offsets ("X minutos antes")

    /// Extrae los minutos de offset que el usuario dijo en frases tipo:
    ///   - "acuérdame 5 minutos antes" → 5
    ///   - "recuérdame cinco min antes" → 5
    ///   - "avísame media hora antes" → 30
    ///   - "una hora antes" → 60
    ///   - "10 min antes" → 10
    ///
    /// Devuelve `nil` si no encuentra patrón explícito. Limita el rango a
    /// [1, 24*60] minutos para evitar offsets absurdos. Si el usuario dice
    /// varias frases, se queda con la primera (no soportamos múltiples
    /// avisos por ahora).
    static func extractReminderOffset(from text: String) -> Int? {
        let lower = text.lowercased()

        // 1. Patrón numérico: "5 minutos antes", "10 min antes", "2 horas antes"
        let numericPattern = #"(\d{1,3})\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#
        if let regex = try? NSRegularExpression(pattern: numericPattern, options: [.caseInsensitive]) {
            let ns = lower as NSString
            if let match = regex.firstMatch(in: lower, range: NSRange(location: 0, length: ns.length)),
               match.numberOfRanges >= 3 {
                let valueStr = ns.substring(with: match.range(at: 1))
                let unit = ns.substring(with: match.range(at: 2))
                if let value = Int(valueStr) {
                    let mins = unit.hasPrefix("h") ? value * 60 : value
                    if mins >= 1 && mins <= 24 * 60 { return mins }
                }
            }
        }

        // 2. Patrón con número escrito: "media hora antes", "cinco minutos antes",
        //    "una hora antes", "quince min antes".
        let wordToNumber: [String: Int] = [
            "un": 1, "una": 1,
            "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
            "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
            "once": 11, "doce": 12, "quince": 15, "veinte": 20, "treinta": 30,
            "media": 30, "medio": 30
        ]
        let wordPattern = #"(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#
        if let regex = try? NSRegularExpression(pattern: wordPattern, options: [.caseInsensitive]) {
            let ns = lower as NSString
            if let match = regex.firstMatch(in: lower, range: NSRange(location: 0, length: ns.length)),
               match.numberOfRanges >= 3 {
                let word = ns.substring(with: match.range(at: 1))
                let unit = ns.substring(with: match.range(at: 2))
                if let value = wordToNumber[word] {
                    // Caso especial: "media hora" / "medio hora" = 30 min, no 30 horas.
                    let isHalfHour = (word == "media" || word == "medio")
                    let mins: Int
                    if isHalfHour {
                        mins = 30
                    } else {
                        mins = unit.hasPrefix("h") ? value * 60 : value
                    }
                    if mins >= 1 && mins <= 24 * 60 { return mins }
                }
            }
        }

        return nil
    }

    /// Extrae el offset Y la nota custom de una frase tipo "acuérdame N min
    /// antes de [acción]". El user spec lo pide así: "tengo partido tipo 3
    /// acuérdame 20 min antes de echar las zapatillas a la mochila" debe
    /// resultar en:
    ///   - evento "Partido" 15:00
    ///   - reminderOffset = 20 min
    ///   - reminderNote = "Echar las zapatillas a la mochila"
    ///
    /// Devuelve `(offsetMinutes, note?)`:
    ///   - `offsetMinutes` es el offset detectado (igual que extractReminderOffset).
    ///   - `note` es el texto LIMPIO después de "antes de" si existe, nil si no.
    ///
    /// Si no encuentra un patrón válido, devuelve `nil`. Si encuentra offset
    /// pero NO hay "de X" después, devuelve `(offset, nil)` (compatible con
    /// `extractReminderOffset` plano).
    static func extractReminderOffsetAndNote(from text: String) -> (offsetMinutes: Int, note: String?)? {
        guard let offset = extractReminderOffset(from: text) else { return nil }
        let lower = text.lowercased()
        let ns = lower as NSString
        let range = NSRange(location: 0, length: ns.length)
        // Buscamos "N min/hora antes de <captura>" hasta fin o puntuación.
        let patterns: [String] = [
            #"\d{1,3}\s+(?:min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+(.+?)\s*(?:$|[.,;!?])"#,
            #"(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(?:min|minutos?|h|hs|hrs?|horas?)\s+antes\s+de\s+(.+?)\s*(?:$|[.,;!?])"#,
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            guard let match = regex.firstMatch(in: lower, range: range),
                  match.numberOfRanges >= 2,
                  match.range(at: 1).location != NSNotFound else { continue }
            // Usamos el TEXTO ORIGINAL (no lower) para preservar mayúsculas.
            let originalNS = text as NSString
            let rawNote = originalNS.substring(with: match.range(at: 1))
            let cleanedNote = cleanReminderNote(rawNote)
            return (offset, cleanedNote.isEmpty ? nil : cleanedNote)
        }
        return (offset, nil)
    }

    /// Limpia el texto del reminder note. Capitaliza primera letra, strippea
    /// fillers comunes y artículos sueltos al inicio, conserva acentos y
    /// preposiciones legítimas en medio. NO aplica las reglas duras de
    /// cleanTitle (no es título de evento, es nota libre).
    private static func cleanReminderNote(_ raw: String) -> String {
        var note = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Quitar artículos sueltos al inicio si son redundantes: "de la
        // mochila" → "La mochila" se vería raro, pero el "de" inicial puede
        // ocurrir si el regex captura un overflow inesperado. Conservador:
        // solo trim el "de " inicial duplicado.
        if note.lowercased().hasPrefix("de ") {
            note = String(note.dropFirst(3))
        }
        // Strip fillers comunes residuales.
        let fillers = [#"\bpor favor\b"#, #"\bporfa(vor)?\b"#]
        for pattern in fillers {
            note = note.replacingOccurrences(of: pattern, with: " ",
                                             options: [.regularExpression, .caseInsensitive])
        }
        // Collapse whitespace + trim final.
        note = note.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }.joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // Capitalizar primera letra.
        if let first = note.first, first.isLowercase {
            note = first.uppercased() + note.dropFirst()
        }
        return note
    }

    // MARK: - Validation

    /// Resultado de validar una acción "create" antes de aplicarla al store.
    struct ValidationResult {
        let isValid: Bool
        let missingFields: Set<MissingField>
        let suggestedQuestion: String?
    }

    enum MissingField: String, Hashable {
        case title
        case date
        case time
    }

    /// Valida que una acción "createEvent" tenga lo mínimo para guardarse.
    /// Si falta algo, devuelve `isValid: false` + una pregunta concreta
    /// que el caller puede usar para pedir aclaración.
    static func validateCreateEvent(
        title: String,
        startTime: Date?
    ) -> ValidationResult {
        var missing: Set<MissingField> = []
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            missing.insert(.title)
        }
        if startTime == nil {
            missing.insert(.date)
            missing.insert(.time)
        }
        guard missing.isEmpty else {
            let question: String
            if missing.contains(.title) {
                question = "¿Qué quieres que agende?"
            } else if missing.contains(.date) && missing.contains(.time) {
                question = "¿Para qué día y a qué hora?"
            } else if missing.contains(.time) {
                question = "¿A qué hora?"
            } else {
                question = "¿Cuándo?"
            }
            return ValidationResult(isValid: false, missingFields: missing, suggestedQuestion: question)
        }
        return ValidationResult(isValid: true, missingFields: [], suggestedQuestion: nil)
    }

    // MARK: - Notification scheduling rule

    /// Decide si debe programarse una notificación local. Cuatro condiciones:
    ///   1. Es recordatorio (`isReminder == true`).
    ///   2. La hora todavía es futura.
    ///   3. El toggle global "Recordatorios" está ON.
    ///
    /// El caller también debe chequear permiso de iOS — eso requiere async
    /// y se hace fuera de esta capa pura.
    static func shouldScheduleNotification(
        isReminder: Bool,
        startTime: Date,
        remindersEnabledInSettings: Bool
    ) -> Bool {
        guard isReminder else { return false }
        guard startTime > Date() else { return false }
        guard remindersEnabledInSettings else { return false }
        return true
    }

    // MARK: - Duplicate detection (anti-basura)

    /// True si ya hay un evento "casi igual" en la lista — mismo título
    /// (case-insensitive, ignorando acentos básicos) + mismo día +
    /// hora dentro de ±10 min. Usado para evitar duplicar cuando el
    /// usuario repite un comando.
    static func isLikelyDuplicate(
        title: String,
        startTime: Date,
        existingEvents: [FocusEvent]
    ) -> Bool {
        let lowerTitle = title.lowercased().folding(options: .diacriticInsensitive, locale: .current)
        let cal = Calendar.current
        return existingEvents.contains { ev in
            let evTitleLower = ev.title.lowercased().folding(options: .diacriticInsensitive, locale: .current)
            guard evTitleLower == lowerTitle else { return false }
            guard cal.isDate(ev.startTime, inSameDayAs: startTime) else { return false }
            let diffMinutes = abs(ev.startTime.timeIntervalSince(startTime)) / 60
            return diffMinutes <= 10
        }
    }
}
