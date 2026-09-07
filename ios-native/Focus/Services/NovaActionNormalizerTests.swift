import Foundation

#if DEBUG

/// Baterías históricas del normalizador disponibles solo en Debug.
/// La validación de ejecución y regresiones vive en el target FocusTests.
/// Estas funciones conservan escenarios anteriores para diagnóstico manual.
///
/// **Cómo correr manualmente desde LLDB en Xcode**:
///   `po NovaActionNormalizerTests.runAll()`
///
/// Imprime en consola los casos que pasan/fallan. Si todos pasan, devuelve
/// "ALL TESTS PASSED ✓". Si alguno falla, devuelve la lista de fallidos.
///
/// Casos basados directamente en la sección "TEST SUITE MANUAL Y/O
/// AUTOMATIZABLE" del prompt de Martin — son los inputs reales que él
/// dice que deben funcionar.
enum NovaActionNormalizerTests {

    /// Reloj fijo para tests: HOY a las 06:00. Mantiene la fecha real (los
    /// labels today/mañana/weekday siguen correctos) pero fija la hora de la
    /// mañana, de modo que la resolución AM/PM es DETERMINISTA: a las 6 AM no
    /// dispara el night-context (≥19h) ni el future-first "hoy", así que las
    /// horas ambiguas se resuelven por la regla coloquial estable (8-12→AM,
    /// 1-7→PM). Esto elimina la flakiness de correr las suites en la tarde.
    private static var fixedTestNow: Date {
        Calendar.current.date(bySettingHour: 6, minute: 0, second: 0, of: Date()) ?? Date()
    }

    @discardableResult
    static func runAll() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        var failures: [String] = []

        // ───── Regresión 2026-06-12: parser LOCAL multi-intent ─────────
        // Título sucio + recordatorio perdido al segmentar mensajes con
        // varios eventos (path demo / sin sesión).
        if Thread.isMainThread {
            failures += MainActor.assumeIsolated {
                localMultiIntentRegressionFailures()
            }
        } else {
            failures.append("  ✗ local-multi-intent: runAll no corrió en main thread")
        }

        // ───── Regresión 2026-06-13: fallback logueado VISIBLE ──────────
        // El fallback al parser local estando logueado NUNCA debe ser
        // silencioso: cada error que hace fallback debe producir una nota
        // honesta no-vacía (antes los errores de servidor devolvían nil).
        fallbackVisibilityFailures(into: &failures)

        // ───── cleanTitle ──────────────────────────────────────────────

        check(
            label: "cleanTitle: 'ir a buscar a la agustina tipo 3 acuérdate' → 'Buscar a Agustina'",
            actual: NovaActionNormalizer.cleanTitle("ir a buscar a la agustina tipo 3 acuérdate"),
            expected: "Buscar a Agustina",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'salir a buscar a mi hermano en 5 min' → 'Buscar a mi hermano'",
            actual: NovaActionNormalizer.cleanTitle("salir a buscar a mi hermano en 5 min"),
            expected: "Buscar a mi hermano",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'ir a buscar a mi hermano en 10 minutos más' → 'Buscar a mi hermano'",
            actual: NovaActionNormalizer.cleanTitle("ir a buscar a mi hermano en 10 minutos más"),
            expected: "Buscar a mi hermano",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'hacer ejercicio en 20 min más' → 'Hacer ejercicio'",
            actual: NovaActionNormalizer.cleanTitle("hacer ejercicio en 20 min más"),
            expected: "Hacer ejercicio",
            failures: &failures
        )

        // BUG REPORTADO POR USUARIO (2026-05-14): "Tengo una comida a las 3:30 acuérdame
        // 20 minutos antes" terminó como evento titulado "Tengo una comida 20 minutos
        // antes". Esperado: "Comer" o "Comida" sin el sufijo de reminder ni "Tengo una".
        check(
            label: "cleanTitle: 'Tengo una comida 20 minutos antes' → 'Comida'",
            actual: NovaActionNormalizer.cleanTitle("Tengo una comida 20 minutos antes"),
            expected: "Comida",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'tengo que estudiar cálculo' → 'Estudiar cálculo'",
            actual: NovaActionNormalizer.cleanTitle("tengo que estudiar cálculo"),
            expected: "Estudiar cálculo",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'tengo reunión con Juan' → 'Reunión con Juan'",
            actual: NovaActionNormalizer.cleanTitle("tengo reunión con Juan"),
            expected: "Reunión con Juan",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Tengo una clase de lenguaje' → 'Clase de lenguaje'",
            actual: NovaActionNormalizer.cleanTitle("Tengo una clase de lenguaje"),
            expected: "Clase de lenguaje",
            failures: &failures
        )

        // Prefijos coloquiales adicionales (paso 3c expandido).
        check(
            label: "cleanTitle: 'Necesito ir al dentista' → 'Dentista'",
            actual: NovaActionNormalizer.cleanTitle("Necesito ir al dentista"),
            expected: "Dentista",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Quiero estudiar matemáticas' → 'Estudiar matemáticas'",
            actual: NovaActionNormalizer.cleanTitle("Quiero estudiar matemáticas"),
            expected: "Estudiar matemáticas",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Voy a comer con Pedro' → 'Comer con Pedro'",
            actual: NovaActionNormalizer.cleanTitle("Voy a comer con Pedro"),
            expected: "Comer con Pedro",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Me toca la reunión semanal' → 'Reunión semanal'",
            actual: NovaActionNormalizer.cleanTitle("Me toca la reunión semanal"),
            expected: "Reunión semanal",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Me agendaron entrevista con HR' → 'Entrevista con HR'",
            actual: NovaActionNormalizer.cleanTitle("Me agendaron entrevista con HR"),
            expected: "Entrevista con HR",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'tengo ganas de salir a correr' → 'Salir a correr'",
            actual: NovaActionNormalizer.cleanTitle("tengo ganas de salir a correr"),
            expected: "Salir a correr",
            failures: &failures
        )

        // No tocar título legítimo que CONTIENE 'tengo' pero no como prefijo.
        check(
            label: "cleanTitle: 'Reunión donde tengo que hablar' (intacto, no prefijo)",
            actual: NovaActionNormalizer.cleanTitle("Reunión donde tengo que hablar"),
            expected: "Reunión donde tengo que hablar",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'acuérdame llamar a Juan' → 'Llamar a Juan'",
            actual: NovaActionNormalizer.cleanTitle("acuérdame llamar a Juan"),
            expected: "Llamar a Juan",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'recuérdame pagar internet mañana' → 'Pagar internet'",
            actual: NovaActionNormalizer.cleanTitle("recuérdame pagar internet mañana"),
            expected: "Pagar internet",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'Recordatorio: comprar pan' → 'Comprar pan'",
            actual: NovaActionNormalizer.cleanTitle("Recordatorio: comprar pan"),
            expected: "Comprar pan",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'reunión con Juan a las 3' → 'Reunión con Juan'",
            actual: NovaActionNormalizer.cleanTitle("reunión con Juan a las 3"),
            expected: "Reunión con Juan",
            failures: &failures
        )

        // BUG REPORTADO POR USUARIO (2026-05-19): "Reunión hoy día a las cuatro
        // con Pedro" quedaba como "Reunión día con Pedro" porque el patrón
        // \bhoy\b strippeaba "hoy" dejando "día" suelto. "Hoy día" es expresión
        // compuesta — debe stripearse como unidad.
        check(
            label: "cleanTitle: 'Reunión hoy día a las cuatro con Pedro' → 'Reunión con Pedro'",
            actual: NovaActionNormalizer.cleanTitle("Reunión hoy día a las cuatro con Pedro"),
            expected: "Reunión con Pedro",
            failures: &failures
        )
        check(
            label: "cleanTitle: 'reunión hoy en día a las 3 con el equipo' → 'Reunión con el equipo'",
            actual: NovaActionNormalizer.cleanTitle("reunión hoy en día a las 3 con el equipo"),
            expected: "Reunión con el equipo",
            failures: &failures
        )
        check(
            label: "cleanTitle: 'clase el día de hoy a las 10' → 'Clase'",
            actual: NovaActionNormalizer.cleanTitle("clase el día de hoy a las 10"),
            expected: "Clase",
            failures: &failures
        )

        // Sanity: la frase "X minutos antes" se va del título.
        check(
            label: "cleanTitle: 'salir a buscar a mi hermano a las 10 acuérdame 5 minutos antes' → 'Buscar a mi hermano'",
            actual: NovaActionNormalizer.cleanTitle("salir a buscar a mi hermano a las 10 acuérdame 5 minutos antes"),
            expected: "Buscar a mi hermano",
            failures: &failures
        )

        check(
            label: "cleanTitle: 'reunión con Juan a las 3 recuérdame media hora antes' → 'Reunión con Juan'",
            actual: NovaActionNormalizer.cleanTitle("reunión con Juan a las 3 recuérdame media hora antes"),
            expected: "Reunión con Juan",
            failures: &failures
        )

        // ───── 8 CASOS OBLIGATORIOS BETA (2026-05-15) ──────────────────
        // Bugs reportados por usuario: Nova guardaba frases crudas como
        // título de evento. Esta tanda valida que el normalizer extrae
        // un título humano y limpio en cada uno de los 8 inputs reales.

        // Test 1: cumpleaños de Urrutia — sentence completa.
        // Expectativa alineada a la spec 2026-05-27 (step 8d): "cumpleaños
        // de Person" → "Cumpleaños Person" (drop del conector "de").
        check(
            label: "BETA-1: 'Tengo que salir al cumpleaños de Urrutia tipo nueve acuérdame 1 hora antes' → 'Cumpleaños Urrutia'",
            actual: NovaActionNormalizer.cleanTitle("Tengo que salir al cumpleaños de Urrutia tipo nueve acuérdame 1 hora antes"),
            expected: "Cumpleaños Urrutia",
            failures: &failures
        )

        // Test 1b: backend devolvió solo "Salir" — preferBetterTitle debe
        // reextraer del userText completo.
        check(
            label: "BETA-1b: preferBetterTitle(backend='Salir', user='Tengo que salir al cumpleaños...') → 'Cumpleaños Urrutia'",
            actual: NovaActionNormalizer.preferBetterTitle(
                backendCleaned: "Salir",
                userText: "Tengo que salir al cumpleaños de Urrutia tipo nueve acuérdame 1 hora antes"
            ),
            expected: "Cumpleaños Urrutia",
            failures: &failures
        )

        // Test 2: buscar a mi polola — sentence con doble hora y location
        check(
            label: "BETA-2: 'Tengo que ir a buscar a mi polola tipo 6 a su casa para estar tipo 6:30 acá acuérdame 20 minutos antes' → 'Buscar a mi polola'",
            actual: NovaActionNormalizer.cleanTitle("Tengo que ir a buscar a mi polola tipo 6 a su casa para estar tipo 6:30 acá acuérdame 20 minutos antes"),
            expected: "Buscar a mi polola",
            failures: &failures
        )

        // Test 3: agendar mañana
        check(
            label: "BETA-3: 'Para mañana quiero que agendes estudiar historia a las 12' → 'Estudiar historia'",
            actual: NovaActionNormalizer.cleanTitle("Para mañana quiero que agendes estudiar historia a las 12"),
            expected: "Estudiar historia",
            failures: &failures
        )

        // Test 4: recordatorio simple
        check(
            label: "BETA-4: 'Recuérdame llamar a mi papá a las 8' → 'Llamar a mi papá'",
            actual: NovaActionNormalizer.cleanTitle("Recuérdame llamar a mi papá a las 8"),
            expected: "Llamar a mi papá",
            failures: &failures
        )

        // Test 5: "luego tengo que seguir + gerund"
        check(
            label: "BETA-5: 'Luego tengo que seguir trabajando en Focus' → 'Trabajar en Focus'",
            actual: NovaActionNormalizer.cleanTitle("Luego tengo que seguir trabajando en Focus"),
            expected: "Trabajar en Focus",
            failures: &failures
        )

        // Test 6: motion + médico — debería caer en eventoPrefixPattern 4d
        check(
            label: "BETA-6: 'Tengo que salir al médico tipo 5' → 'Médico'",
            actual: NovaActionNormalizer.cleanTitle("Tengo que salir al médico tipo 5"),
            expected: "Médico",
            failures: &failures
        )

        // Test 7: ya viene limpio el sustantivo, solo strippear hora/recordatorio.
        // Igual que BETA-1: "de Person" → "Person" (spec 2026-05-27).
        check(
            label: "BETA-7: 'Cumpleaños de Urrutia tipo 9 acuérdame una hora antes' → 'Cumpleaños Urrutia'",
            actual: NovaActionNormalizer.cleanTitle("Cumpleaños de Urrutia tipo 9 acuérdame una hora antes"),
            expected: "Cumpleaños Urrutia",
            failures: &failures
        )

        // Test 8: title ya viene en formato correcto + hora numérica
        check(
            label: "BETA-8: 'Buscar a mi polola a las 6' → 'Buscar a mi polola'",
            actual: NovaActionNormalizer.cleanTitle("Buscar a mi polola a las 6"),
            expected: "Buscar a mi polola",
            failures: &failures
        )

        // EXTRA: regresiones puntuales del fix anterior (tipo + word)
        check(
            label: "BETA-extra: 'salir al cumpleaños tipo nueve' → 'Cumpleaños' (verifica tipo+word ya no es bug)",
            actual: NovaActionNormalizer.cleanTitle("salir al cumpleaños tipo nueve"),
            expected: "Cumpleaños",
            failures: &failures
        )

        check(
            label: "BETA-extra: 'tipo seis' como hora cuelga sola → '' (collapse vacío después)",
            actual: NovaActionNormalizer.cleanTitle("evento tipo seis"),
            expected: "Evento",
            failures: &failures
        )

        // ───── Reflexivos a infinitivo base (2026-05-13) ───────────────
        // El usuario: "si le digo dormirme a las 8 que el evento no se llame
        // dormirme sino dormir". Whitelist explícita normaliza la familia
        // común. Falsos positivos (palabras que terminan en -arme/-erme/
        // -irme sin ser verbos reflexivos) NO deben tocarse.

        check(
            label: "reflexive: 'dormirme a las 8' → 'Dormir'",
            actual: NovaActionNormalizer.cleanTitle("dormirme a las 8"),
            expected: "Dormir",
            failures: &failures
        )
        check(
            label: "reflexive: 'levantarme a las 7' → 'Levantar'",
            actual: NovaActionNormalizer.cleanTitle("levantarme a las 7"),
            expected: "Levantar",
            failures: &failures
        )
        check(
            label: "reflexive: 'ducharme a las 9' → 'Duchar'",
            actual: NovaActionNormalizer.cleanTitle("ducharme a las 9"),
            expected: "Duchar",
            failures: &failures
        )
        check(
            label: "reflexive: 'acostarme a las 11' → 'Acostar'",
            actual: NovaActionNormalizer.cleanTitle("acostarme a las 11"),
            expected: "Acostar",
            failures: &failures
        )
        check(
            label: "reflexive: 'prepararme para la reunión' → 'Preparar para la reunión'",
            actual: NovaActionNormalizer.cleanTitle("prepararme para la reunión"),
            expected: "Preparar para la reunión",
            failures: &failures
        )
        // Falsos positivos que NO deben tocarse:
        check(
            label: "reflexive (no match): 'firme el contrato' queda 'Firme el contrato'",
            actual: NovaActionNormalizer.cleanTitle("firme el contrato"),
            expected: "Firme el contrato",
            failures: &failures
        )
        check(
            label: "reflexive (no match): 'llamar a Carme' queda 'Llamar a Carme'",
            actual: NovaActionNormalizer.cleanTitle("llamar a Carme"),
            expected: "Llamar a Carme",
            failures: &failures
        )

        // BUG-USER 2026-05-18: "más tarde viene la agustina tipo 6 acuérdame
        // 20 min antes para prepararme" quedaba como título literal completo
        // en el reminder card. cleanTitle debe strippear leading "más tarde",
        // "20 min antes" Y trailing "para prepararme" (propósito personal).
        check(
            label: "BUG-2026-05-18: 'más tarde viene la agustina 20 min antes para prepararme' → 'Viene la agustina'",
            actual: NovaActionNormalizer.cleanTitle("más tarde viene la agustina 20 min antes para prepararme"),
            expected: "Viene la agustina",
            failures: &failures
        )
        check(
            label: "trailing 'para prepararme' se strippea",
            actual: NovaActionNormalizer.cleanTitle("salir a comprar para prepararme"),
            expected: "Salir a comprar",
            failures: &failures
        )
        check(
            label: "trailing 'para alistarme' se strippea",
            actual: NovaActionNormalizer.cleanTitle("buscar la mochila para alistarme"),
            expected: "Buscar la mochila",
            failures: &failures
        )

        // ───── extractReminderOffset ───────────────────────────────────

        check(
            label: "extractReminderOffset: 'acuérdame 5 minutos antes' → 5",
            actual: NovaActionNormalizer.extractReminderOffset(from: "acuérdame 5 minutos antes"),
            expected: 5,
            failures: &failures
        )

        check(
            label: "extractReminderOffset: 'recuérdame cinco minutos antes' → 5",
            actual: NovaActionNormalizer.extractReminderOffset(from: "recuérdame cinco minutos antes"),
            expected: 5,
            failures: &failures
        )

        check(
            label: "extractReminderOffset: 'avísame media hora antes' → 30",
            actual: NovaActionNormalizer.extractReminderOffset(from: "avísame media hora antes"),
            expected: 30,
            failures: &failures
        )

        check(
            label: "extractReminderOffset: 'una hora antes' → 60",
            actual: NovaActionNormalizer.extractReminderOffset(from: "una hora antes"),
            expected: 60,
            failures: &failures
        )

        check(
            label: "extractReminderOffset: 'tengo reunión mañana' → nil",
            actual: NovaActionNormalizer.extractReminderOffset(from: "tengo reunión mañana"),
            expected: nil as Int?,
            failures: &failures
        )

        // ───── isReminderTrigger ───────────────────────────────────────

        check(
            label: "isReminderTrigger: 'acuérdame llamar' → true",
            actual: NovaActionNormalizer.isReminderTrigger(in: "acuérdame llamar"),
            expected: true,
            failures: &failures
        )

        check(
            label: "isReminderTrigger: 'avísame en 5 minutos' → true",
            actual: NovaActionNormalizer.isReminderTrigger(in: "avísame en 5 minutos"),
            expected: true,
            failures: &failures
        )

        check(
            label: "isReminderTrigger: 'que no se me olvide pagar' → true",
            actual: NovaActionNormalizer.isReminderTrigger(in: "que no se me olvide pagar"),
            expected: true,
            failures: &failures
        )

        check(
            label: "isReminderTrigger: 'tengo reunión mañana' → false",
            actual: NovaActionNormalizer.isReminderTrigger(in: "tengo reunión mañana"),
            expected: false,
            failures: &failures
        )

        check(
            label: "isReminderTrigger: 'agenda dentista' → false",
            actual: NovaActionNormalizer.isReminderTrigger(in: "agenda dentista"),
            expected: false,
            failures: &failures
        )

        // ───── resolveEndTime ──────────────────────────────────────────

        let now = Date()
        let oneHour = now.addingTimeInterval(3600)

        // Cambio de criterio 2026-05-12: el rango explícito SIEMPRE gana,
        // incluso cuando isReminder=true. Antes "reunión de 5 a 6 acuérdame
        // 15 antes" perdía el rango — bajo el nuevo modelo, el aviso va como
        // chip dentro del mismo bloque y la duración real se respeta.
        let reminderWithRange = NovaActionNormalizer.resolveEndTime(
            startTime: now, providedEndTime: oneHour,
            hasExplicitEndTime: true, isReminder: true
        )
        check(
            label: "resolveEndTime: rango explícito gana aunque sea reminder",
            actual: reminderWithRange.endTime != nil,
            expected: true,
            failures: &failures
        )
        // Recordatorio SIN rango → nil (punto en el tiempo).
        let reminderPoint = NovaActionNormalizer.resolveEndTime(
            startTime: now, providedEndTime: nil,
            hasExplicitEndTime: false, isReminder: true
        )
        check(
            label: "resolveEndTime: reminder sin rango → nil",
            actual: reminderPoint.endTime,
            expected: nil as Date?,
            failures: &failures
        )

        let explicitRange = NovaActionNormalizer.resolveEndTime(
            startTime: now, providedEndTime: oneHour,
            hasExplicitEndTime: true, isReminder: false
        )
        check(
            label: "resolveEndTime: rango explícito se respeta",
            actual: explicitRange.endTime != nil,
            expected: true,
            failures: &failures
        )

        let noEnd = NovaActionNormalizer.resolveEndTime(
            startTime: now, providedEndTime: nil,
            hasExplicitEndTime: false, isReminder: false
        )
        check(
            label: "resolveEndTime: sin rango explícito → inferred",
            actual: noEnd.inferredDuration,
            expected: true,
            failures: &failures
        )

        // ───── shouldScheduleNotification ──────────────────────────────

        let future = Date().addingTimeInterval(60)
        let past = Date().addingTimeInterval(-60)

        check(
            label: "shouldSchedule: reminder + futuro + toggle ON → true",
            actual: NovaActionNormalizer.shouldScheduleNotification(
                isReminder: true, startTime: future, remindersEnabledInSettings: true
            ),
            expected: true,
            failures: &failures
        )

        check(
            label: "shouldSchedule: reminder + pasado → false",
            actual: NovaActionNormalizer.shouldScheduleNotification(
                isReminder: true, startTime: past, remindersEnabledInSettings: true
            ),
            expected: false,
            failures: &failures
        )

        check(
            label: "shouldSchedule: no-reminder + futuro → false",
            actual: NovaActionNormalizer.shouldScheduleNotification(
                isReminder: false, startTime: future, remindersEnabledInSettings: true
            ),
            expected: false,
            failures: &failures
        )

        check(
            label: "shouldSchedule: toggle OFF → false aunque sea reminder futuro",
            actual: NovaActionNormalizer.shouldScheduleNotification(
                isReminder: true, startTime: future, remindersEnabledInSettings: false
            ),
            expected: false,
            failures: &failures
        )

        // ───── parseAll (multi-intent) ─────────────────────────────────

        // Frase compuesta del bug report del usuario.
        let multi = NovaResponder.parseAll(
            "mañana despertarme a las 7:10 y luego tipo 8 salir de mi casa a mi clase llamada contenidos digitales"
        )
        check(
            label: "parseAll: frase con 'y luego' → 2 intents",
            actual: multi.count,
            expected: 2,
            failures: &failures
        )

        // Frase simple sin conectores → 1 intent.
        let single = NovaResponder.parseAll("acuérdame comprar pan mañana a las 10")
        check(
            label: "parseAll: frase sin conectores → 1 intent",
            actual: single.count,
            expected: 1,
            failures: &failures
        )

        // Conector "después" también separa.
        let after = NovaResponder.parseAll("despiértame a las 7 después recuérdame salir a las 8")
        check(
            label: "parseAll: 'después' separa → 2 intents",
            actual: after.count,
            expected: 2,
            failures: &failures
        )

        // Conector "también".
        let also = NovaResponder.parseAll("agenda reunión mañana a las 10 también recuérdame llamar a Juan")
        check(
            label: "parseAll: 'también' separa → 2 intents",
            actual: also.count,
            expected: 2,
            failures: &failures
        )

        // ───── Smart " y " split (con hora en ambos lados) ────────────

        // CASO DEL BUG REPORT — el caso real que motivó el fix.
        let bugCase = NovaResponder.parseAll(
            "seguir trabajo de mi papá a las 1 y comer a las 7"
        )
        check(
            label: "parseAll: 'seguir trabajo a las 1 y comer a las 7' → 2 intents",
            actual: bugCase.count,
            expected: 2,
            failures: &failures
        )

        let wakeAndLeave = NovaResponder.parseAll(
            "despertarme a las 7 y salir a las 8"
        )
        check(
            label: "parseAll: 'despertarme a las 7 y salir a las 8' → 2 intents",
            actual: wakeAndLeave.count,
            expected: 2,
            failures: &failures
        )

        let studyAndCall = NovaResponder.parseAll(
            "estudiar a las 5 y llamar a mi mamá a las 8"
        )
        check(
            label: "parseAll: 'estudiar a las 5 y llamar a las 8' → 2 intents",
            actual: studyAndCall.count,
            expected: 2,
            failures: &failures
        )

        // ───── Smart " y " NO-split (sin horas en ambos lados) ────────

        // "comprar pan y leche" debe quedar como 1 sola tarea — "y leche"
        // forma parte del título, no es una nueva acción.
        let breadMilk = NovaResponder.parseAll("comprar pan y leche")
        check(
            label: "parseAll: 'comprar pan y leche' → 1 intent (no split)",
            actual: breadMilk.count,
            expected: 1,
            failures: &failures
        )

        // "reunión con Juan y Pedro a las 5" — solo hay UNA hora (5), no
        // dos. " y Pedro" es parte del título de la reunión.
        let meetTwo = NovaResponder.parseAll("reunión con Juan y Pedro a las 5")
        check(
            label: "parseAll: 'reunión con Juan y Pedro a las 5' → 1 intent",
            actual: meetTwo.count,
            expected: 1,
            failures: &failures
        )

        // ───── AM/PM contextual por verbo (los 10 casos del usuario) ──

        // 1. "despertarme a las 7" → "Despertar" 07:00, recordatorio puntual.
        //    2026-05-13: el reflexivo -me se normaliza a infinitivo base —
        //    el evento se ve mejor como "Despertar" que como "Despertarme".
        checkAction(
            "case 1: despertarme a las 7",
            text: "despertarme a las 7",
            expectedTitle: "Despertar",
            expectedHour: 7,
            expectedReminder: true,
            failures: &failures
        )

        // 2. "levantarme a las 7" → "Levantar" 07:00 (idem: reflexivo a base).
        checkAction(
            "case 2: levantarme a las 7",
            text: "levantarme a las 7",
            expectedTitle: "Levantar",
            expectedHour: 7,
            expectedReminder: true,
            failures: &failures
        )

        // 3. "salir de mi casa a las 8 para la universidad" → "Salir de mi casa" 08:00
        checkAction(
            "case 3: salir de mi casa a las 8 para la universidad",
            text: "salir de mi casa a las 8 para la universidad",
            expectedTitle: "Salir de mi casa",
            expectedHour: 8,
            expectedReminder: nil,  // no chequeamos — el destino escolar fuerza AM, no reminder
            failures: &failures
        )

        // 4. "clase a las 8" → 08:00 (no 20:00)
        checkAction(
            "case 4: clase a las 8",
            text: "clase a las 8",
            expectedTitle: nil,
            expectedHour: 8,
            expectedReminder: nil,
            failures: &failures
        )

        // 5. "comer a las 7" → "Comer" 19:00
        checkAction(
            "case 5: comer a las 7",
            text: "comer a las 7",
            expectedTitle: "Comer",
            expectedHour: 19,
            expectedReminder: nil,
            failures: &failures
        )

        // 6. "cenar a las 8" → 20:00
        checkAction(
            "case 6: cenar a las 8",
            text: "cenar a las 8",
            expectedTitle: "Cenar",
            expectedHour: 20,
            expectedReminder: nil,
            failures: &failures
        )

        // 7. "almorzar a la 1" → 13:00
        checkAction(
            "case 7: almorzar a la 1",
            text: "almorzar a la 1",
            expectedTitle: "Almorzar",
            expectedHour: 13,
            expectedReminder: nil,
            failures: &failures
        )

        // 8. "seguir trabajo de mi papá a la 1 y comer a las 7" → 2 intents
        //    "Seguir trabajo de mi papá" 13:00 + "Comer" 19:00
        let case8 = runPipeline("seguir trabajo de mi papá a la 1 y comer a las 7")
        check(
            label: "case 8: 'seguir...a la 1 y comer a las 7' → 2 intents",
            actual: case8.count, expected: 2, failures: &failures
        )
        if case8.count == 2 {
            check(label: "case 8a: hora intent 1", actual: case8[0].hour, expected: 13, failures: &failures)
            check(label: "case 8b: hora intent 2", actual: case8[1].hour, expected: 19, failures: &failures)
        }

        // 9. "mañana despertarme a las 7 y salir a las 8" → 2 intents
        //    "Despertarme" mañana 07:00 + "Salir" mañana 08:00
        let case9 = runPipeline("mañana despertarme a las 7 y salir a las 8")
        check(
            label: "case 9: 'mañana despertarme...y salir...' → 2 intents",
            actual: case9.count, expected: 2, failures: &failures
        )
        if case9.count == 2 {
            check(label: "case 9a: hora intent 1 (despertarme)", actual: case9[0].hour, expected: 7, failures: &failures)
            check(label: "case 9b: hora intent 2 (salir)", actual: case9[1].hour, expected: 8, failures: &failures)
            check(label: "case 9a: intent 1 es recordatorio", actual: case9[0].isReminder, expected: true, failures: &failures)
        }

        // 10. "reunión a las 7" → 19:00 (regla coloquial 1-7 PM como safe default).
        checkAction(
            "case 10: reunión a las 7 (safe default)",
            text: "reunión a las 7",
            expectedTitle: nil,
            expectedHour: 19,
            expectedReminder: nil,
            failures: &failures
        )

        // ───── Overrides explícitos AM/PM ─────────────────────────────

        checkAction(
            "override AM: 'comer a las 7 de la mañana' → 07:00",
            text: "comer a las 7 de la mañana",
            expectedTitle: nil,
            expectedHour: 7,
            expectedReminder: nil,
            failures: &failures
        )

        checkAction(
            "override PM: 'despertarme a las 7 de la tarde' → 19:00",
            text: "despertarme a las 7 de la tarde",
            expectedTitle: nil,
            expectedHour: 19,
            expectedReminder: nil,
            failures: &failures
        )

        // ───── Edge: 'salir' SIN destino escolar no fuerza AM ────────

        checkAction(
            "edge: 'salir a las 6' sin contexto → 18:00 (colloquial PM)",
            text: "salir a las 6",
            expectedTitle: nil,
            expectedHour: 18,
            expectedReminder: nil,
            failures: &failures
        )

        // ───── Edge: 'salir' + universidad fuerza AM aunque sea hora 1-7 ──

        checkAction(
            "edge: 'salir a las 6 para la universidad' → 06:00",
            text: "salir a las 6 para la universidad",
            expectedTitle: "Salir",
            expectedHour: 6,
            expectedReminder: nil,
            failures: &failures
        )

        // ───── impliesPunctualReminder unit tests ─────────────────────

        check(
            label: "impliesPunctualReminder: 'despertarme a las 7' → true",
            actual: NovaActionNormalizer.impliesPunctualReminder(in: "despertarme a las 7"),
            expected: true, failures: &failures
        )
        check(
            label: "impliesPunctualReminder: 'levantarme mañana' → true",
            actual: NovaActionNormalizer.impliesPunctualReminder(in: "levantarme mañana"),
            expected: true, failures: &failures
        )
        check(
            label: "impliesPunctualReminder: 'reunión a las 7' → false",
            actual: NovaActionNormalizer.impliesPunctualReminder(in: "reunión a las 7"),
            expected: false, failures: &failures
        )
        check(
            label: "impliesPunctualReminder: 'comer a las 7' → true (extended)",
            actual: NovaActionNormalizer.impliesPunctualReminder(in: "comer a las 7"),
            expected: true, failures: &failures
        )

        // ───── FASE 8 — TESTS OBLIGATORIOS DEL BUG REPORT ─────────────

        // 1. "tengo que seguir trabajando a las 3:30 y comer a las 4"
        //    → 2 intents, HOY, 15:30 + 16:00, sin reunión, títulos limpios
        let bug1 = runPipeline("tengo que seguir trabajando a las 3:30 y comer a las 4")
        check(
            label: "bug1: 2 intents",
            actual: bug1.count, expected: 2, failures: &failures
        )
        if bug1.count == 2 {
            check(label: "bug1[0] title", actual: bug1[0].title, expected: "Trabajar", failures: &failures)
            check(label: "bug1[0] hour 15", actual: bug1[0].hour, expected: 15, failures: &failures)
            // El día depende de la hora a la que corren los tests. Si son
            // antes de 19:30, 15:30 cae hoy futuro; si son después, el
            // bumpea-a-mañana legítimo lo manda a tomorrow. AMBOS son
            // aceptables — el bug original era que caía a "otherDay" por
            // interpretación errónea de 3:30 → 03:30.
            check(label: "bug1[0] today o tomorrow (no otherDay)",
                  actual: bug1[0].day == .today || bug1[0].day == .tomorrow,
                  expected: true, failures: &failures)
            check(label: "bug1[0] no reunión", actual: bug1[0].section != .reunion, expected: true, failures: &failures)
            check(label: "bug1[0] es recordatorio", actual: bug1[0].isReminder, expected: true, failures: &failures)

            check(label: "bug1[1] title", actual: bug1[1].title, expected: "Comer", failures: &failures)
            check(label: "bug1[1] hour 16", actual: bug1[1].hour, expected: 16, failures: &failures)
            check(label: "bug1[1] today o tomorrow",
                  actual: bug1[1].day == .today || bug1[1].day == .tomorrow,
                  expected: true, failures: &failures)
            check(label: "bug1[1] no reunión", actual: bug1[1].section != .reunion, expected: true, failures: &failures)
        }

        // 2. "seguir trabajo de mi papá a la 1 y comer a las 7"
        //    → 13:00 + 19:00
        let bug2 = runPipeline("seguir trabajo de mi papá a la 1 y comer a las 7")
        check(label: "bug2: 2 intents", actual: bug2.count, expected: 2, failures: &failures)
        if bug2.count == 2 {
            check(label: "bug2[0] hour 13", actual: bug2[0].hour, expected: 13, failures: &failures)
            check(label: "bug2[0] no reunión", actual: bug2[0].section != .reunion, expected: true, failures: &failures)
            check(label: "bug2[1] hour 19", actual: bug2[1].hour, expected: 19, failures: &failures)
            check(label: "bug2[1] no reunión", actual: bug2[1].section != .reunion, expected: true, failures: &failures)
        }

        // 3. "mañana despertarme a las 7 y salir a las 8"
        //    → mañana 07:00 + mañana 08:00
        let bug3 = runPipeline("mañana despertarme a las 7 y salir a las 8")
        check(label: "bug3: 2 intents", actual: bug3.count, expected: 2, failures: &failures)
        if bug3.count == 2 {
            check(label: "bug3[0] mañana", actual: bug3[0].day, expected: .tomorrow, failures: &failures)
            check(label: "bug3[0] hour 7", actual: bug3[0].hour, expected: 7, failures: &failures)
            check(label: "bug3[1] mañana", actual: bug3[1].day, expected: .tomorrow, failures: &failures)
            check(label: "bug3[1] hour 8", actual: bug3[1].hour, expected: 8, failures: &failures)
        }

        // 4. "comprar pan y leche" → 1 tarea
        let bug4 = runPipeline("comprar pan y leche")
        check(label: "bug4: 1 intent", actual: bug4.count, expected: 1, failures: &failures)
        if let first = bug4.first {
            check(label: "bug4 kind = task", actual: first.kind, expected: .task, failures: &failures)
        }

        // 5. "reunión con Juan y Pedro a las 5" → 1 evento/reunión
        let bug5 = runPipeline("reunión con Juan y Pedro a las 5")
        check(label: "bug5: 1 intent", actual: bug5.count, expected: 1, failures: &failures)
        if let first = bug5.first {
            check(label: "bug5 section = reunión", actual: first.section, expected: .reunion, failures: &failures)
        }

        // 6. "comer a las 4" → 16:00, no reunión
        let bug6 = runPipeline("comer a las 4")
        if let first = bug6.first {
            check(label: "bug6 hour 16", actual: first.hour, expected: 16, failures: &failures)
            check(label: "bug6 no reunión", actual: first.section != .reunion, expected: true, failures: &failures)
        }

        // 7. "despertarme a las 7" → 07:00
        let bug7 = runPipeline("despertarme a las 7")
        if let first = bug7.first {
            check(label: "bug7 hour 7", actual: first.hour, expected: 7, failures: &failures)
        }

        // 8. "trabajar a las 3:30" → 15:30 (no reunión)
        let bug8 = runPipeline("trabajar a las 3:30")
        if let first = bug8.first {
            check(label: "bug8 hour 15", actual: first.hour, expected: 15, failures: &failures)
            check(label: "bug8 no reunión", actual: first.section != .reunion, expected: true, failures: &failures)
        }

        // Bonus: 'trabajar a las 3:30 de la mañana' → 03:30 (override AM)
        let bug8am = runPipeline("trabajar a las 3:30 de la mañana")
        if let first = bug8am.first {
            check(label: "bug8 AM override hour 3", actual: first.hour, expected: 3, failures: &failures)
        }

        // ───── BUG REPORT 2026-05-12 — HORAS EN PALABRAS ──────────────

        // Caso real iPhone: "necesito ir a buscar a mi hermano a las tres"
        // Antes: Nova preguntaba "¿Cuándo?" con título "Buscar a Mi hermano a Tres".
        // Esperado: "Buscar a mi hermano" hoy 15:00, sin preguntar.
        let wordBug = runPipeline("necesito ir a buscar a mi hermano a las tres")
        check(
            label: "wordBug: 1 intent (no clarify)",
            actual: wordBug.count, expected: 1, failures: &failures
        )
        if let first = wordBug.first {
            check(label: "wordBug kind ≠ clarify", actual: first.kind != .clarify, expected: true, failures: &failures)
            check(label: "wordBug title = 'Buscar a mi hermano'", actual: first.title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "wordBug hour 15", actual: first.hour, expected: 15, failures: &failures)
            check(label: "wordBug HOY", actual: first.day, expected: .today, failures: &failures)
        }

        // "despertarme a las siete" → 07:00
        let w1 = runPipeline("despertarme a las siete")
        if let first = w1.first {
            check(label: "word: despertarme a las siete → 7", actual: first.hour, expected: 7, failures: &failures)
        }

        // "comer a las siete" → 19:00
        let w2 = runPipeline("comer a las siete")
        if let first = w2.first {
            check(label: "word: comer a las siete → 19", actual: first.hour, expected: 19, failures: &failures)
        }

        // "clase a las ocho" → 08:00
        let w3 = runPipeline("clase a las ocho")
        if let first = w3.first {
            check(label: "word: clase a las ocho → 8", actual: first.hour, expected: 8, failures: &failures)
        }

        // "reunión a las tres de la tarde" → 15:00 (PM explícito)
        let w4 = runPipeline("reunión a las tres de la tarde")
        if let first = w4.first {
            check(label: "word: reunión a las tres de la tarde → 15", actual: first.hour, expected: 15, failures: &failures)
        }

        // "levantarme a las seis y media" → 06:30
        let w5 = runPipeline("levantarme a las seis y media")
        if let first = w5.first {
            check(label: "word: levantarme a las seis y media → hora 6", actual: first.hour, expected: 6, failures: &failures)
        }

        // "seguir trabajando a las tres y media y comer a las siete" → 2 intents
        // El " y " entre "tres" y "media" NO debe splittear (es time fragment).
        // El " y " entre "media" y "comer" SÍ debe splittear.
        let w6 = runPipeline("seguir trabajando a las tres y media y comer a las siete")
        check(label: "word multi: 2 intents", actual: w6.count, expected: 2, failures: &failures)
        if w6.count == 2 {
            check(label: "word multi[0] hour 15", actual: w6[0].hour, expected: 15, failures: &failures)
            check(label: "word multi[1] hour 19", actual: w6[1].hour, expected: 19, failures: &failures)
        }

        // "comprar pan y leche" → 1 tarea, no hora
        let w7 = runPipeline("comprar pan y leche")
        check(label: "word neg: 'comprar pan y leche' → 1 intent", actual: w7.count, expected: 1, failures: &failures)

        // "ir a buscar a la Agustina a las tres" → "Buscar a Agustina" (idiomático)
        // Para preservar el comportamiento idiomático cuando hay "la NombrePropio".
        let w8 = runPipeline("ir a buscar a la Agustina a las tres")
        if let first = w8.first {
            check(label: "word: 'ir a buscar a la Agustina' → 'Buscar a Agustina'", actual: first.title, expected: "Buscar a Agustina", failures: &failures)
            check(label: "word: hora 15", actual: first.hour, expected: 15, failures: &failures)
        }

        // hasTimeMarker para horas en palabras (sanity unit).
        // Necesitamos exponer esto para test — chequear via runPipeline si
        // detecta hora. Si no detecta, kind sería clarify o el intent no
        // tendría hour. Ya cubierto por wordBug arriba.

        // ───── MODELO UNIFICADO "bloque" 2026-05-12 ───────────────────

        // Bug del producto: antes los recordatorios aparecían como tarjeta
        // separada Y como bloque en timeline → duplicado. Ahora todo lo que
        // tiene hora es UN solo bloque con chip de offset opcional.

        // Bloque 1: "ir a buscar a mi hermano a las 6:30 y comer a las 8"
        //           → 2 bloques, ambos hoy, sin duplicados.
        let block1 = runPipeline("ir a buscar a mi hermano a las 6:30 y comer a las 8")
        check(label: "block1: 2 intents", actual: block1.count, expected: 2, failures: &failures)
        if block1.count == 2 {
            check(label: "block1[0] hour 18", actual: block1[0].hour, expected: 18, failures: &failures)
            check(label: "block1[0] minute 30", actual: block1[0].minute, expected: 30, failures: &failures)
            check(label: "block1[1] hour 20", actual: block1[1].hour, expected: 20, failures: &failures)
            check(label: "block1[0] sin offset", actual: block1[0].reminderOffsetMinutes, expected: nil, failures: &failures)
        }

        // Bloque 2: "ir a buscar a mi hermano a las 6:30 acuérdame 40 minutos antes"
        //           → 1 bloque con reminderOffsetMinutes = 40.
        let block2 = runPipeline("ir a buscar a mi hermano a las 6:30 acuérdame 40 minutos antes")
        check(label: "block2: 1 intent", actual: block2.count, expected: 1, failures: &failures)
        if let first = block2.first {
            check(label: "block2 hour 18", actual: first.hour, expected: 18, failures: &failures)
            check(label: "block2 minute 30", actual: first.minute, expected: 30, failures: &failures)
            check(label: "block2 offset = 40 min", actual: first.reminderOffsetMinutes, expected: 40, failures: &failures)
            check(label: "block2 title sin 'acuérdame'", actual: first.title, expected: "Buscar a mi hermano", failures: &failures)
        }

        // Bloque 3: "reunión con Juan de 5 a 6 acuérdame 15 minutos antes"
        //           → evento con duración + reminderOffsetMinutes = 15.
        let block3 = runPipeline("reunión con Juan de 5 a 6 acuérdame 15 minutos antes")
        check(label: "block3: 1 intent", actual: block3.count, expected: 1, failures: &failures)
        if let first = block3.first {
            check(label: "block3 hour 17 (start)", actual: first.hour, expected: 17, failures: &failures)
            check(label: "block3 endHour 18", actual: first.endHour, expected: 18, failures: &failures)
            check(label: "block3 offset = 15 min", actual: first.reminderOffsetMinutes, expected: 15, failures: &failures)
        }

        // Bloque 4: "comprar pan" → tarea (sin hora).
        let block4 = runPipeline("comprar pan")
        check(label: "block4: 1 intent", actual: block4.count, expected: 1, failures: &failures)
        if let first = block4.first {
            check(label: "block4 kind = task", actual: first.kind, expected: .task, failures: &failures)
        }

        // ───── BUG REPORT 2026-05-12 — INSTRUCCIÓN COMPLEJA ────────────

        // Bug iPhone: "tengo que ir a buscar a mi hermano en 20 min luego
        // salir a jugar fútbol a las 10 y llevar la pelota a las 11"
        // → Nova creó "Salir a jugar futbol que llevar la pelota" como
        // título concatenado. Esperamos 3 intents con títulos limpios.
        let complex = runPipeline("tengo que ir a buscar a mi hermano en 20 min luego salir a jugar fútbol a las 10 y llevar la pelota a las 11")
        check(label: "complex: 3 intents", actual: complex.count, expected: 3, failures: &failures)
        if complex.count == 3 {
            check(label: "complex[0] title 'Buscar a mi hermano'",
                  actual: complex[0].title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "complex[1] title 'Salir a jugar fútbol'",
                  actual: complex[1].title, expected: "Salir a jugar fútbol", failures: &failures)
            // Hora 10 → 10 AM si tests corren de día, 22 PM si corren de
            // noche (night-context rule). Ambas son interpretaciones
            // correctas del input "a las 10".
            let complexHour1 = complex[1].hour ?? -1
            check(label: "complex[1] hour ∈ {10, 22}",
                  actual: complexHour1 == 10 || complexHour1 == 22,
                  expected: true, failures: &failures)
            check(label: "complex[2] title 'Llevar la pelota' (NO concatenado)",
                  actual: complex[2].title, expected: "Llevar la pelota", failures: &failures)
            // Hora 11 → 11 AM si tests corren de día, 23 PM si corren de noche
            // (regla night-context aplica desde >=19h con runtime real). Ambas
            // son interpretaciones correctas del input "a las 11".
            let complexHour2 = complex[2].hour ?? -1
            check(label: "complex[2] hour ∈ {11, 23}",
                  actual: complexHour2 == 11 || complexHour2 == 23,
                  expected: true, failures: &failures)
            // Crítico: NO debe contener "que llevar" en ningún título.
            let hasBadConcatenation = complex.contains {
                $0.title.lowercased().contains("que llevar")
            }
            check(label: "complex: ningún título concatenado con 'que llevar'",
                  actual: hasBadConcatenation, expected: false, failures: &failures)
        }

        // Caso menor del mismo bug: "salir a jugar fútbol a las 10 y llevar
        // la pelota" → segundo segmento SIN hora (no debería splittear por
        // " y " porque smart split exige hora en ambos lados).
        let shortRelated = runPipeline("salir a jugar fútbol a las 10 y llevar la pelota")
        check(label: "shortRelated: 1 intent (no split, llevar no tiene hora)",
              actual: shortRelated.count, expected: 1, failures: &failures)

        // ───── BUG REPORT 2026-05-12 v2 — CASOS EXACTOS DEL USUARIO ───

        // Caso 1 (exacto): "en una hora voy a jugar fútbol, en dos horas
        // vuelvo y a las 12 me acuesto". Tiene 3 acciones con horarios
        // relativos en palabras ("en una hora", "en dos horas") + hora
        // ambigua "a las 12". El parser LOCAL no puede separarlas (smart
        // " y " split exige hora en dígitos en ambos lados); el detector
        // debe marcarla como compleja para forzar el backend.
        check(
            label: "caso1: isLikelyMultiAction true (en una hora…, en dos horas…, a las 12)",
            actual: NovaResponder.isLikelyMultiAction(
                "en una hora voy a jugar fútbol, en dos horas vuelvo y a las 12 me acuesto"
            ),
            expected: true,
            failures: &failures
        )

        // Caso 2 (exacto): "tengo que seguir trabajando a las 3:30 y comer
        // a las 4" — dos horas en dígitos, smart " y " split debe separar.
        let caso2 = runPipeline("tengo que seguir trabajando a las 3:30 y comer a las 4")
        check(label: "caso2: 2 intents", actual: caso2.count, expected: 2, failures: &failures)
        if caso2.count == 2 {
            check(label: "caso2[0] title 'Trabajar' (post 2026-05-15: seguir+gerund stripped)",
                  actual: caso2[0].title, expected: "Trabajar", failures: &failures)
            check(label: "caso2[0] hour 15", actual: caso2[0].hour, expected: 15, failures: &failures)
            check(label: "caso2[0] minute 30", actual: caso2[0].minute, expected: 30, failures: &failures)
            check(label: "caso2[0] no reunión", actual: caso2[0].section != .reunion, expected: true, failures: &failures)
            check(label: "caso2[1] title 'Comer'",
                  actual: caso2[1].title, expected: "Comer", failures: &failures)
            check(label: "caso2[1] hour 16", actual: caso2[1].hour, expected: 16, failures: &failures)
            check(label: "caso2[1] no reunión", actual: caso2[1].section != .reunion, expected: true, failures: &failures)
        }

        // Caso 3 (exacto): "necesito ir a buscar a mi hermano a las tres"
        // — hora en palabra, 1 acción. NO debe preguntar "¿cuándo?".
        let caso3 = runPipeline("necesito ir a buscar a mi hermano a las tres")
        check(label: "caso3: 1 intent (no clarify)",
              actual: caso3.count, expected: 1, failures: &failures)
        if let first = caso3.first {
            check(label: "caso3 NO es clarify",
                  actual: first.kind != .clarify, expected: true, failures: &failures)
            check(label: "caso3 title 'Buscar a mi hermano'",
                  actual: first.title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "caso3 hour 15", actual: first.hour, expected: 15, failures: &failures)
            check(label: "caso3 HOY", actual: first.day, expected: .today, failures: &failures)
        }

        // Caso 4 (exacto): "tengo que ir a buscar a mi hermano en 20 min
        // luego salir a jugar fútbol a las 10 y llevar la pelota a las 11"
        // → 3 intents con títulos limpios; NUNCA "Salir a jugar fútbol
        // que llevar la pelota" concatenado.
        let caso4 = runPipeline("tengo que ir a buscar a mi hermano en 20 min luego salir a jugar fútbol a las 10 y llevar la pelota a las 11")
        check(label: "caso4: 3 intents", actual: caso4.count, expected: 3, failures: &failures)
        if caso4.count == 3 {
            check(label: "caso4[0] title 'Buscar a mi hermano'",
                  actual: caso4[0].title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "caso4[1] title 'Salir a jugar fútbol'",
                  actual: caso4[1].title, expected: "Salir a jugar fútbol", failures: &failures)
            let caso4Hour1 = caso4[1].hour ?? -1
            check(label: "caso4[1] hour ∈ {10, 22}",
                  actual: caso4Hour1 == 10 || caso4Hour1 == 22,
                  expected: true, failures: &failures)
            check(label: "caso4[2] title 'Llevar la pelota'",
                  actual: caso4[2].title, expected: "Llevar la pelota", failures: &failures)
            // Hora 11 → 11 AM o 23 PM según runtime (night-context).
            let caso4Hour2 = caso4[2].hour ?? -1
            check(label: "caso4[2] hour ∈ {11, 23}",
                  actual: caso4Hour2 == 11 || caso4Hour2 == 23,
                  expected: true, failures: &failures)
            let badConcat = caso4.contains {
                let t = $0.title.lowercased()
                return t.contains("que llevar") || t.contains("fútbol que")
                    || t.contains("futbol que")
            }
            check(label: "caso4: ningún título concatenado",
                  actual: badConcat, expected: false, failures: &failures)
        }

        // AM/PM contextual reglas firmes del spec del usuario:
        // - despertarme a las 7 = 07:00
        // - clase a las 8 = 08:00
        // - comer a las 7 = 19:00
        // - trabajar a las 3:30 = 15:30
        // (cubiertas en `bug1`/`bug7`/`bug8`/`case4`/`case5`/`case1` arriba —
        //  añadimos asserts redundantes para que el bloque del usuario
        //  esté visible y verifiquemos cualquier regresión futura).
        let amTests: [(String, Int, Int)] = [
            ("despertarme a las 7", 7, 0),
            ("clase a las 8", 8, 0),
            ("comer a las 7", 19, 0),
            ("trabajar a las 3:30", 15, 30)
        ]
        for (text, h, m) in amTests {
            let r = runPipeline(text)
            if let first = r.first {
                check(label: "AM/PM '\(text)' hour=\(h)",
                      actual: first.hour, expected: h, failures: &failures)
                check(label: "AM/PM '\(text)' minute=\(m)",
                      actual: first.minute ?? 0, expected: m, failures: &failures)
            } else {
                let msg = "  ✗ AM/PM '\(text)' — pipeline devolvió 0 intents"
                print(msg); failures.append(msg)
            }
        }

        // ───── NIGHT CONTEXT — adjustAmPm con currentHour fijo ─────────
        //
        // Tests determinísticos del override de noche. El overload de
        // `adjustAmPm` permite inyectar `currentHour` y verificar la
        // interpretación nocturna sin depender del wall clock.
        //
        // Spec del usuario:
        // - 21:53 + "a las 11" → 23 (PM hoy)
        // - 21:53 + "a las 12" → 0 (medianoche próxima)
        // - 21:53 + "a las 9" → 9 (AM mañana — PM ya pasó)
        // - 14:00 + "a las 11" → 11 (mañana AM, regla coloquial)
        // - 14:00 + "a las 12 de la noche" → 0 (override PM/madrugada)

        let nightTests: [(Int, Int, String, Int, String)] = [
            // currentHour, hour, text, expected, label
            (21, 11, "ir a buscar a mi hermano a las 11",                 23, "21h + 11 → 23"),
            (21, 12, "a las 12 volver a casa",                            0,  "21h + 12 → 0 (medianoche)"),
            (22, 11, "a las 11 me acuesto",                               23, "22h + 11 → 23"),
            (21, 10, "a las 10",                                          22, "21h + 10 → 22"),
            (21, 9,  "a las 9",                                           9,  "21h + 9 → 9 (AM, PM ya pasó)"),
            (21, 8,  "a las 8",                                           8,  "21h + 8 → 8 AM"),
            // Marcador explícito 'mañana' apaga night-context
            (21, 10, "mañana a las 10",                                   10, "mañana suprime night-context"),
            (21, 11, "mañana a las 11",                                   11, "mañana suprime night-context"),
            // Día — comportamiento original (sin night-context)
            (14, 11, "ir a buscar a mi hermano a las 11",                 11, "14h + 11 → 11 AM (colloquial)"),
            (14, 3,  "a las 3",                                           15, "14h + 3 → 15 PM (colloquial 1-7)"),
            // School context — siempre AM aunque sea noche
            (21, 8,  "clase a las 8",                                     8,  "21h + 'clase a las 8' → 8 AM"),
            (21, 10, "tengo clase a las 10",                              10, "21h + 'tengo clase a las 10' → 10 AM"),
            // Verb context PM gana sobre night
            (21, 9,  "cenar a las 9",                                     21, "21h + 'cenar a las 9' → 21 PM"),
            // AM explícito gana sobre todo
            (21, 11, "a las 11 de la mañana",                             11, "AM explícito ignora noche"),
        ]
        for (ch, h, text, expected, label) in nightTests {
            let actual = NovaResponder.adjustAmPm(hour: h, in: text, currentHour: ch)
            check(label: "night: \(label)",
                  actual: actual, expected: expected, failures: &failures)
        }

        // Caso 2 del usuario, end-to-end via detector de complejidad:
        // "ir a buscar a mi hermano a las 11 y a las 12 volver a casa"
        // debe marcarse como complejo para que la app fuerce el backend.
        check(
            label: "caso2-v2: 'ir a buscar a las 11 y a las 12 volver a casa' isLikelyMultiAction true",
            actual: NovaResponder.isLikelyMultiAction(
                "ir a buscar a mi hermano a las 11 y a las 12 volver a casa"
            ),
            expected: true,
            failures: &failures
        )

        // ───── isLikelyMultiAction (gating de fallback local) ──────────

        // Caso real reportado el 2026-05-12: el parser local NO entiende
        // "en una hora", "en dos horas", ni la coma como separador, así
        // que terminaba creando un único evento basura "Voy a ir a jugar
        // fútbol — 12:00". El detector debe marcar la frase como compleja
        // para forzar el backend (IA fuerte).
        check(
            label: "isLikelyMultiAction: caso reportado 'en una hora… en dos horas… a las 12'",
            actual: NovaResponder.isLikelyMultiAction(
                "En una hora más te voy a ir a jugar fútbol, en dos horas más tengo que volver y más o menos a las 12 me tengo que acostar"
            ),
            expected: true,
            failures: &failures
        )

        // Spec del usuario — frases que SÍ deben gatear el backend:
        check(
            label: "isLikelyMultiAction: 'trabajar a las 3:30 y comer a las 4' (2 acciones+horas)",
            actual: NovaResponder.isLikelyMultiAction(
                "tengo que seguir trabajando a las 3:30 y comer a las 4"
            ),
            expected: true,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'mañana despiértame a las 7 y salir a las 8' (2 acciones+horas)",
            actual: NovaResponder.isLikelyMultiAction(
                "mañana despiértame a las 7 y salir a las 8"
            ),
            expected: true,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'jugar fútbol a las 10 y llevar la pelota a las 9:30'",
            actual: NovaResponder.isLikelyMultiAction(
                "jugar fútbol a las 10 y llevar la pelota a las 9:30"
            ),
            expected: true,
            failures: &failures
        )

        // Spec del usuario — frases SIMPLES que NO deben gatear el backend:
        check(
            label: "isLikelyMultiAction: 'buscar a mi hermano a las tres' (1 acción, 1 hora) → false",
            actual: NovaResponder.isLikelyMultiAction(
                "necesito ir a buscar a mi hermano a las tres"
            ),
            expected: false,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'comprar pan y leche' (sin horas, 'y' une objetos) → false",
            actual: NovaResponder.isLikelyMultiAction("comprar pan y leche"),
            expected: false,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'reunión con Juan y Pedro a las 5' (1 hora, 'y' une personas) → false",
            actual: NovaResponder.isLikelyMultiAction(
                "reunión con Juan y Pedro a las 5"
            ),
            expected: false,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'agenda dentista mañana a las 10' (simple) → false",
            actual: NovaResponder.isLikelyMultiAction("agenda dentista mañana a las 10"),
            expected: false,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'café' (vacía, sin hora) → false",
            actual: NovaResponder.isLikelyMultiAction("café"),
            expected: false,
            failures: &failures
        )

        // Conectores explícitos siempre disparan, aunque solo haya 1 hora:
        check(
            label: "isLikelyMultiAction: 'gym a las 7 y luego correr' (conector 'y luego')",
            actual: NovaResponder.isLikelyMultiAction("gym a las 7 y luego correr"),
            expected: true,
            failures: &failures
        )
        check(
            label: "isLikelyMultiAction: 'almuerzo, después siesta' (conector 'después')",
            actual: NovaResponder.isLikelyMultiAction("almuerzo, después siesta"),
            expected: true,
            failures: &failures
        )

        // ───── 7 CASOS OBLIGATORIOS DEL USUARIO (2026-05-13) ──────────
        //
        // Asegurar que cada caso real del spec tenga su test pipeline.
        // Algunos ya existían bajo otros nombres; los duplicamos acá con
        // el rótulo "user-caso-N" para que el bloque sea evidente al
        // leer la salida del runner.

        // Caso 1: "necesito ir a buscar a mi hermano a las tres"
        let u1 = runPipeline("necesito ir a buscar a mi hermano a las tres")
        check(label: "user-caso-1: 1 intent (no clarify)",
              actual: u1.count, expected: 1, failures: &failures)
        if let first = u1.first {
            check(label: "user-caso-1: kind ≠ clarify",
                  actual: first.kind != .clarify, expected: true, failures: &failures)
            check(label: "user-caso-1: title 'Buscar a mi hermano'",
                  actual: first.title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "user-caso-1: hour 15", actual: first.hour, expected: 15, failures: &failures)
            check(label: "user-caso-1: today", actual: first.day, expected: .today, failures: &failures)
        }

        // Caso 2: "ir a buscar a mi hermano a las 11 y a las 12 volver a casa"
        // — frase compleja, debe gatear backend.
        check(
            label: "user-caso-2: isLikelyMultiAction true",
            actual: NovaResponder.isLikelyMultiAction(
                "ir a buscar a mi hermano a las 11 y a las 12 volver a casa"
            ),
            expected: true,
            failures: &failures
        )
        // Determinista: adjustAmPm con currentHour fijo (21:53) cubre la
        // interpretación nocturna de "a las 11" y "a las 12".
        check(label: "user-caso-2: 21h + 'a las 11' → 23",
              actual: NovaResponder.adjustAmPm(
                  hour: 11, in: "ir a buscar a mi hermano a las 11", currentHour: 21
              ),
              expected: 23, failures: &failures)
        check(label: "user-caso-2: 21h + 'a las 12' → 0 (medianoche)",
              actual: NovaResponder.adjustAmPm(
                  hour: 12, in: "a las 12 volver a casa", currentHour: 21
              ),
              expected: 0, failures: &failures)

        // Caso 3: "en una hora voy a jugar fútbol, en dos horas vuelvo y a las 12 me acuesto"
        check(
            label: "user-caso-3: isLikelyMultiAction true",
            actual: NovaResponder.isLikelyMultiAction(
                "en una hora voy a jugar fútbol, en dos horas vuelvo y a las 12 me acuesto"
            ),
            expected: true,
            failures: &failures
        )

        // Caso 4: "tengo que seguir trabajando a las 3:30 y comer a las 4"
        let u4 = runPipeline("tengo que seguir trabajando a las 3:30 y comer a las 4")
        check(label: "user-caso-4: 2 intents",
              actual: u4.count, expected: 2, failures: &failures)
        if u4.count == 2 {
            check(label: "user-caso-4: [0] title 'Trabajar' (post 2026-05-15)",
                  actual: u4[0].title, expected: "Trabajar", failures: &failures)
            check(label: "user-caso-4: [0] hour 15", actual: u4[0].hour, expected: 15, failures: &failures)
            check(label: "user-caso-4: [0] minute 30", actual: u4[0].minute, expected: 30, failures: &failures)
            check(label: "user-caso-4: [0] no reunión",
                  actual: u4[0].section != .reunion, expected: true, failures: &failures)
            check(label: "user-caso-4: [1] title 'Comer'",
                  actual: u4[1].title, expected: "Comer", failures: &failures)
            check(label: "user-caso-4: [1] hour 16", actual: u4[1].hour, expected: 16, failures: &failures)
            check(label: "user-caso-4: [1] no reunión",
                  actual: u4[1].section != .reunion, expected: true, failures: &failures)
        }

        // Caso 5: "tengo que ir a buscar a mi hermano en 20 min luego salir a jugar fútbol a las 10 y llevar la pelota a las 11"
        let u5 = runPipeline("tengo que ir a buscar a mi hermano en 20 min luego salir a jugar fútbol a las 10 y llevar la pelota a las 11")
        check(label: "user-caso-5: 3 intents",
              actual: u5.count, expected: 3, failures: &failures)
        if u5.count == 3 {
            check(label: "user-caso-5: [0] title 'Buscar a mi hermano'",
                  actual: u5[0].title, expected: "Buscar a mi hermano", failures: &failures)
            check(label: "user-caso-5: [1] title 'Salir a jugar fútbol'",
                  actual: u5[1].title, expected: "Salir a jugar fútbol", failures: &failures)
            check(label: "user-caso-5: [2] title 'Llevar la pelota'",
                  actual: u5[2].title, expected: "Llevar la pelota", failures: &failures)
            // Crítico: ningún título con concatenación tipo "que llevar".
            let badConcat = u5.contains { t in
                t.title.lowercased().contains("que llevar") ||
                t.title.lowercased().contains("fútbol que")
            }
            check(label: "user-caso-5: ningún título concatenado",
                  actual: badConcat, expected: false, failures: &failures)
        }

        // Caso 6: "comprar pan y leche" → 1 tarea, no split
        let u6 = runPipeline("comprar pan y leche")
        check(label: "user-caso-6: 1 intent (tarea, no split)",
              actual: u6.count, expected: 1, failures: &failures)
        if let first = u6.first {
            check(label: "user-caso-6: kind = task",
                  actual: first.kind, expected: .task, failures: &failures)
        }

        // Caso 7: "reunión con Juan y Pedro a las 5" → 1 reunión
        let u7 = runPipeline("reunión con Juan y Pedro a las 5")
        check(label: "user-caso-7: 1 intent (no split)",
              actual: u7.count, expected: 1, failures: &failures)
        if let first = u7.first {
            check(label: "user-caso-7: section = reunion",
                  actual: first.section, expected: .reunion, failures: &failures)
        }

        // ═══════════════════════════════════════════════════════════════
        //  BETA SPEC: CASOS A-J (auditoría 2026-05-14)
        //
        //  Estos son los casos que el usuario exige que Nova maneje SÍ O SÍ
        //  antes de subir a beta. Cubren título limpio, AM/PM coherente,
        //  future-first, separación evento vs reminder, multi-acción.
        //
        //  Algunos casos dependen de currentHour real del simulator. Los
        //  marcados como "(non-deterministic hour)" no verifican la hora
        //  específica, sino que el intent sea correcto en estructura
        //  (título limpio, kind, día). Los tests específicos de hora
        //  llaman a `adjustAmPm(hour:, in:, currentHour:)` directo.
        // ═══════════════════════════════════════════════════════════════

        // ───── Caso A: evento + reminder mid-sentence ─────────────────
        // "tengo clases tipo 5:30 acuérdame de salir en 10 min"
        // → 2 intents: Clase 17:30 + Salir (reminder) en 10 min
        let casoA = runPipeline("tengo clases tipo 5:30 acuérdame de salir en 10 min")
        check(label: "casoA: 2 intents (evento + reminder)",
              actual: casoA.count, expected: 2, failures: &failures)
        if casoA.count == 2 {
            // Intent 1: Clase a las 17:30
            check(label: "casoA[0] title contains 'lase' (Clase/Clases)",
                  actual: casoA[0].title.lowercased().contains("lase"),
                  expected: true, failures: &failures)
            check(label: "casoA[0] hour 17",
                  actual: casoA[0].hour, expected: 17, failures: &failures)
            check(label: "casoA[0] minute 30",
                  actual: casoA[0].minute, expected: 30, failures: &failures)
            // Intent 2: Salir reminder (en 10 min relative)
            check(label: "casoA[1] title 'Salir'",
                  actual: casoA[1].title, expected: "Salir", failures: &failures)
            check(label: "casoA[1] isReminder",
                  actual: casoA[1].isReminder, expected: true, failures: &failures)
        }

        // ───── Caso B: doble acción con " y ", sequence context ───────
        // "tengo clases a las 5:30 de historia y salgo a las 7"
        // → 2 intents: Clase de historia 17:30 + Salir/Salgo 19:00
        let casoB = runPipeline("tengo clases a las 5:30 de historia y salgo a las 7")
        check(label: "casoB: 2 intents",
              actual: casoB.count, expected: 2, failures: &failures)
        if casoB.count == 2 {
            // "clases de historia" → "Clases" + subtítulo "Historia" (2026-06-13:
            // ahora separa el tema). La info debe estar preservada en título O
            // subtítulo.
            let casoBInfo = (casoB[0].title + " " + (casoB[0].subtitle ?? "")).lowercased()
            check(label: "casoB[0] preserva 'historia' (título o subtítulo)",
                  actual: casoBInfo.contains("historia"),
                  expected: true, failures: &failures)
            check(label: "casoB[0] hour 17",
                  actual: casoB[0].hour, expected: 17, failures: &failures)
            check(label: "casoB[0] minute 30",
                  actual: casoB[0].minute, expected: 30, failures: &failures)
            check(label: "casoB[1] hour 19 (PM por coloquial 1-7)",
                  actual: casoB[1].hour, expected: 19, failures: &failures)
            // CRÍTICO: el segundo evento NO debe quedar como 07:00 (mañana)
            check(label: "casoB[1] NO es 7 AM (future-first)",
                  actual: casoB[1].hour != 7, expected: true, failures: &failures)
        }

        // ───── Caso C: buscar a la X tipo N (sin "ir a") ──────────────
        // "buscar a la Agustina tipo 3 acuérdate"
        // → 1 intent reminder: "Buscar a Agustina" 15:00
        let casoC = runPipeline("buscar a la Agustina tipo 3 acuérdate")
        check(label: "casoC: 1 intent",
              actual: casoC.count, expected: 1, failures: &failures)
        if let first = casoC.first {
            check(label: "casoC title 'Buscar a Agustina'",
                  actual: first.title, expected: "Buscar a Agustina", failures: &failures)
            check(label: "casoC hour 15 (tipo 3 → PM)",
                  actual: first.hour, expected: 15, failures: &failures)
            check(label: "casoC isReminder (por 'acuérdate')",
                  actual: first.isReminder, expected: true, failures: &failures)
        }

        // ───── Caso D: reminder puntual relativo ──────────────────────
        // "recuérdame llamar a mi mamá en 20 minutos"
        // → 1 intent reminder: "Llamar a mi mamá" en +20 min
        let casoD = runPipeline("recuérdame llamar a mi mamá en 20 minutos")
        check(label: "casoD: 1 intent",
              actual: casoD.count, expected: 1, failures: &failures)
        if let first = casoD.first {
            check(label: "casoD title 'Llamar a mi mamá'",
                  actual: first.title, expected: "Llamar a mi mamá", failures: &failures)
            check(label: "casoD isReminder",
                  actual: first.isReminder, expected: true, failures: &failures)
            check(label: "casoD day = today (relative +20m)",
                  actual: first.day, expected: .today, failures: &failures)
        }

        // ───── Caso E: "mañana" respetado, AM 8 razonable ─────────────
        // "mañana tengo reunión a las 8"
        // → 1 event mañana 08:00, NO mover a hoy
        let casoE = runPipeline("mañana tengo reunión a las 8")
        check(label: "casoE: 1 intent",
              actual: casoE.count, expected: 1, failures: &failures)
        if let first = casoE.first {
            check(label: "casoE title 'Reunión'",
                  actual: first.title, expected: "Reunión", failures: &failures)
            check(label: "casoE hour 8 (AM, sin override night)",
                  actual: first.hour, expected: 8, failures: &failures)
            check(label: "casoE day = mañana",
                  actual: first.day, expected: .tomorrow, failures: &failures)
        }

        // ───── Caso F: future-first con "hoy" + "clase" + AM pasada ───
        // Llama `adjustAmPm` directamente para fijar currentHour.
        // "hoy tengo clase a las 7" a las 14:00 → 19:00, NO 07:00 (vencido)
        check(label: "casoF (hoy+clase+7, currentHour=14): 19",
              actual: NovaResponder.adjustAmPm(hour: 7, in: "hoy tengo clase a las 7", currentHour: 14),
              expected: 19, failures: &failures)
        // Mismo input a las 06:00 → 7 AM (futuro AM válido)
        check(label: "casoF (hoy+clase+7, currentHour=6): 7 AM",
              actual: NovaResponder.adjustAmPm(hour: 7, in: "hoy tengo clase a las 7", currentHour: 6),
              expected: 7, failures: &failures)
        // SIN "hoy" — "tengo clase a las 7" a las 14:00 → 7 AM (default escolar)
        check(label: "casoF (sin 'hoy', clase+7, currentHour=14): 7 AM",
              actual: NovaResponder.adjustAmPm(hour: 7, in: "tengo clase a las 7", currentHour: 14),
              expected: 7, failures: &failures)
        // "hoy clase a las 8" a las 14:00 → 20 PM (future-first)
        check(label: "casoF (hoy+clase+8, currentHour=14): 20",
              actual: NovaResponder.adjustAmPm(hour: 8, in: "hoy tengo clase a las 8", currentHour: 14),
              expected: 20, failures: &failures)
        // "hoy clase a las 8" a las 7:00 → 8 AM (futuro AM aún válido)
        check(label: "casoF (hoy+clase+8, currentHour=7): 8 AM",
              actual: NovaResponder.adjustAmPm(hour: 8, in: "hoy tengo clase a las 8", currentHour: 7),
              expected: 8, failures: &failures)

        // ───── Caso G: evento + tarea con conector " y después " ──────
        // "tengo dentista el viernes a las 4 y después comprar remedios"
        // → 2 intents: Dentista viernes 16:00 + Comprar remedios (task)
        let casoG = runPipeline("tengo dentista el viernes a las 4 y después comprar remedios")
        check(label: "casoG: 2 intents",
              actual: casoG.count, expected: 2, failures: &failures)
        if casoG.count == 2 {
            check(label: "casoG[0] title 'Dentista'",
                  actual: casoG[0].title, expected: "Dentista", failures: &failures)
            check(label: "casoG[0] hour 16",
                  actual: casoG[0].hour, expected: 16, failures: &failures)
            // El día depende de hoy: si hoy es jueves, viernes = tomorrow;
            // cualquier otro día, otherDay. Aceptamos ambos.
            let viernesOk = casoG[0].day == .otherDay || casoG[0].day == .tomorrow
            check(label: "casoG[0] day = viernes (tomorrow u otherDay)",
                  actual: viernesOk, expected: true, failures: &failures)
            check(label: "casoG[1] title contains 'remedios'",
                  actual: casoG[1].title.lowercased().contains("remedios"),
                  expected: true, failures: &failures)
            check(label: "casoG[1] kind = task (sin hora)",
                  actual: casoG[1].kind, expected: .task, failures: &failures)
        }

        // ───── Caso H: "antes de la clase" sin offset → clarify/task ───
        // "recuérdame antes de la clase comprar una bebida"
        // → 1 intent (no debe crear "Antes de la clase Comprar una bebida"
        //   como evento — extractReminderAttachIntent NO matchea sin offset
        //   numérico explícito y caemos al flujo normal: tarea o clarify).
        let casoH = runPipeline("recuérdame antes de la clase comprar una bebida")
        check(label: "casoH: 1 intent",
              actual: casoH.count, expected: 1, failures: &failures)
        if let first = casoH.first {
            // NO debe contener "antes de" en el título (basura)
            check(label: "casoH title NO contains 'antes de'",
                  actual: first.title.lowercased().contains("antes de"),
                  expected: false, failures: &failures)
        }

        // ───── Caso I: "el lunes" sin hora → task con dueDate ─────
        // "tengo prueba de historia el lunes"
        // → task del lunes. Cambio de diseño 2026-05-26 (50-case
        //   validation): antes era clarify pidiendo hora, pero eso
        //   frenaba el flujo del usuario. Ahora preferimos crear
        //   tarea del día y dejar que el usuario edite si quiere hora.
        let casoI = runPipeline("tengo prueba de historia el lunes")
        check(label: "casoI: 1 intent",
              actual: casoI.count, expected: 1, failures: &failures)
        if let first = casoI.first {
            check(label: "casoI kind = task (con dueDate)",
                  actual: first.kind, expected: .task, failures: &failures)
        }

        // ───── Caso J: timeframe "en la tarde" mapea a 16:00 ──────────
        // "acuérdame de estudiar mañana en la tarde"
        // → reminder "Estudiar" mañana 16:00 (NO 9:00)
        let casoJ = runPipeline("acuérdame de estudiar mañana en la tarde")
        check(label: "casoJ: 1 intent",
              actual: casoJ.count, expected: 1, failures: &failures)
        if let first = casoJ.first {
            check(label: "casoJ title 'Estudiar'",
                  actual: first.title, expected: "Estudiar", failures: &failures)
            check(label: "casoJ hour 16 (tarde)",
                  actual: first.hour, expected: 16, failures: &failures)
            check(label: "casoJ day = mañana",
                  actual: first.day, expected: .tomorrow, failures: &failures)
            check(label: "casoJ isReminder",
                  actual: first.isReminder, expected: true, failures: &failures)
        }

        // ───── defaultHourForTimeframe direct unit tests ──────────────
        check(label: "timeframe 'esta noche' → 20:00",
              actual: NovaResponder.defaultHourForTimeframe(in: "estudiar esta noche")?.0,
              expected: 20, failures: &failures)
        check(label: "timeframe 'en la tarde' → 16:00",
              actual: NovaResponder.defaultHourForTimeframe(in: "comer en la tarde")?.0,
              expected: 16, failures: &failures)
        check(label: "timeframe 'en la mañana' → 9:00",
              actual: NovaResponder.defaultHourForTimeframe(in: "salir en la mañana")?.0,
              expected: 9, failures: &failures)
        check(label: "timeframe 'al mediodía' → 12:00",
              actual: NovaResponder.defaultHourForTimeframe(in: "comer al mediodía")?.0,
              expected: 12, failures: &failures)
        check(label: "timeframe 'al final del día' → 21:00",
              actual: NovaResponder.defaultHourForTimeframe(in: "tarea al final del día")?.0,
              expected: 21, failures: &failures)
        check(label: "timeframe sin marcador → nil",
              actual: NovaResponder.defaultHourForTimeframe(in: "estudiar mañana") == nil,
              expected: true, failures: &failures)

        // ───── future-first NO sobre-aplica sin "hoy" ─────────────────
        // Caso de NO regresión: "clase a las 8" sin "hoy", currentHour=14
        // debe seguir siendo 8 AM (default escolar). El override solo
        // dispara con "hoy" explícito.
        check(label: "future-first NO sobre-aplica: 'clase a las 8' currentHour=14 → 8 AM",
              actual: NovaResponder.adjustAmPm(hour: 8, in: "tengo clase a las 8", currentHour: 14),
              expected: 8, failures: &failures)
        // "mañana clase a las 7" currentHour=14 → 7 AM (mañana es futuro)
        check(label: "future-first NO sobre-aplica con 'mañana': → 7 AM",
              actual: NovaResponder.adjustAmPm(hour: 7, in: "mañana tengo clase a las 7", currentHour: 14),
              expected: 7, failures: &failures)

        // ───── Reminder absoluto: el splitter NO debe partir ──────────
        // Bug fix: "ir a buscar a mi hermano a las 6:30 acuérdame 40 minutos antes"
        // debe seguir siendo UN solo intent (newBlock con offset).
        let regBlock = runPipeline("ir a buscar a mi hermano a las 6:30 acuérdame 40 minutos antes")
        check(label: "reminder absoluto: 1 intent (no split)",
              actual: regBlock.count, expected: 1, failures: &failures)

        // ═══════════════════════════════════════════════════════════════
        //  INTENT REFACTOR — Bug user 2026-05-15:
        //
        //  Nova interpretaba mensajes humanos como comandos rígidos de
        //  calendario. La fix incluye:
        //  - Strip "luego" y "seguir" en cleanTitle.
        //  - Gerundios → infinitivo ("trabajando" → "trabajar").
        //  - Mode classification en backend (chat_only / proposal / etc).
        //
        //  Estos tests cubren las piezas LOCALES (cleanTitle). El comportamiento
        //  chat_only/proposal vive en el backend (system prompt + Sonnet
        //  routing) y se valida manualmente con casos reales.
        // ═══════════════════════════════════════════════════════════════

        // Bug literal del user: "luego tengo que seguir trabajando con focus"
        // ANTES quedaba como título "Luego tengo que seguir trabajando con focus".
        // DESPUÉS debe quedar "Trabajar con focus".
        check(
            label: "intent-1: 'luego tengo que seguir trabajando con focus' → 'Trabajar con focus'",
            actual: NovaActionNormalizer.cleanTitle("luego tengo que seguir trabajando con focus"),
            expected: "Trabajar con focus",
            failures: &failures
        )

        // Variantes: solo "luego tengo que X"
        check(
            label: "intent-2: 'luego tengo que estudiar matemáticas' → 'Estudiar matemáticas'",
            actual: NovaActionNormalizer.cleanTitle("luego tengo que estudiar matemáticas"),
            expected: "Estudiar matemáticas",
            failures: &failures
        )

        // Solo "seguir + gerundio"
        check(
            label: "intent-3: 'tengo que seguir leyendo el libro' → 'Leer el libro'",
            actual: NovaActionNormalizer.cleanTitle("tengo que seguir leyendo el libro"),
            expected: "Leer el libro",
            failures: &failures
        )

        // Gerundio sin "seguir" — solo convertir gerund → infinitive
        check(
            label: "intent-4: 'tengo que ir corriendo al banco' → 'Ir correr al banco'",
            actual: NovaActionNormalizer.cleanTitle("tengo que ir corriendo al banco"),
            // El gerundio "corriendo" se convierte a infinitivo "correr".
            // "Ir corriendo" es coloquial pero queda como "Ir correr" —
            // imperfecto pero mejor que el literal.
            expected: "Ir correr al banco",
            failures: &failures
        )

        // "después tengo que X" — mismo patrón con "después"
        check(
            label: "intent-5: 'después tengo que llamar a Juan' → 'Llamar a Juan'",
            actual: NovaActionNormalizer.cleanTitle("después tengo que llamar a Juan"),
            expected: "Llamar a Juan",
            failures: &failures
        )

        // NO REGRESIÓN: "seguir" NO debe strippearse si NO es prefix
        // (ej. "ir a seguir trabajando" → mantener; "club seguir" → mantener).
        check(
            label: "intent-6 NO regresión: 'seguir' en medio del título no strippeado",
            actual: NovaActionNormalizer.cleanTitle("club de seguir"),
            // Si el regex agresivo strippeara "seguir" en cualquier posición,
            // "club de seguir" quedaría "Club de" o "Club de " — debemos
            // mantenerlo. El patrón requiere ^seguir al inicio.
            expected: "Club de seguir",
            failures: &failures
        )

        // Gerundios populares mapeados.
        check(label: "intent-gerund: 'estudiando' → 'Estudiar'",
              actual: NovaActionNormalizer.cleanTitle("estudiando para el examen"),
              expected: "Estudiar para el examen", failures: &failures)
        check(label: "intent-gerund: 'jugando fútbol' → 'Jugar fútbol'",
              actual: NovaActionNormalizer.cleanTitle("jugando fútbol con amigos"),
              expected: "Jugar fútbol con amigos", failures: &failures)
        check(label: "intent-gerund: 'cocinando' → 'Cocinar'",
              actual: NovaActionNormalizer.cleanTitle("cocinando pasta"),
              expected: "Cocinar pasta", failures: &failures)

        // ═══════════════════════════════════════════════════════════════
        //  BETA CLOSURE — Anti-basura, proposal mode, matching semántico
        //  (refactor 2026-05-15)
        //
        //  Estos tests validan las piezas LOCALES del refactor de Nova
        //  como IA conversacional. El comportamiento mode-classification
        //  end-to-end requiere backend real (Claude) — esos casos se
        //  prueban manualmente desde la app.
        // ═══════════════════════════════════════════════════════════════

        // ── Anti-basura: detección de input emocional/contextual ──────
        do {
            // Detector: estados emocionales
            check(label: "antibasura-1: 'estoy colapsado' es emocional",
                  actual: NovaActionValidator.isEmotionalOrContextual("estoy colapsado, no sé qué hacer"),
                  expected: true, failures: &failures)
            check(label: "antibasura-2: 'me siento cansado' es emocional",
                  actual: NovaActionValidator.isEmotionalOrContextual("me siento cansado pero tengo que avanzar"),
                  expected: true, failures: &failures)
            check(label: "antibasura-3: 'qué debería priorizar' es contextual",
                  actual: NovaActionValidator.isEmotionalOrContextual("qué debería priorizar"),
                  expected: true, failures: &failures)
            check(label: "antibasura-4: 'creo que debería estudiar' es contextual",
                  actual: NovaActionValidator.isEmotionalOrContextual("creo que debería estudiar antes de fútbol"),
                  expected: true, failures: &failures)
            // NO regresión: comandos directos NO se marcan
            check(label: "antibasura-5: 'agéndame estudiar mañana' NO es emocional",
                  actual: NovaActionValidator.isEmotionalOrContextual("agéndame estudiar mañana a las 12"),
                  expected: false, failures: &failures)
            check(label: "antibasura-6: 'reunión con Juan' NO es emocional",
                  actual: NovaActionValidator.isEmotionalOrContextual("reunión con Juan mañana a las 5"),
                  expected: false, failures: &failures)
        }

        // ── Anti-basura: degradación de add_event en input emocional ───
        do {
            // Caso A: input emocional + actions con add_event → degrade.
            let addEventAction: BackendAction = .addEvent(BackendEventCreate(
                title: "Saturación", timeString: "3:00 PM", endTimeString: nil,
                dateString: nil, section: nil, icon: nil,
                reminderOffsets: nil, reminderNotes: nil,
                location: nil, notes: nil, subtitle: nil
            ))
            let decision = NovaActionValidator.applyAntiBasura(
                userText: "estoy colapsado, no sé qué hacer",
                mode: "chat_with_action",
                actions: [addEventAction]
            )
            check(label: "antibasura-degrade-1: didDemote = true",
                  actual: decision.didDemote, expected: true, failures: &failures)
            check(label: "antibasura-degrade-1: safeActions vacío",
                  actual: decision.safeActions.count, expected: 0, failures: &failures)
            check(label: "antibasura-degrade-1: demoted 1 action",
                  actual: decision.demotedToProposal.count, expected: 1, failures: &failures)

            // Caso B: input directo + add_event → NO degrade.
            let directDecision = NovaActionValidator.applyAntiBasura(
                userText: "agéndame estudiar mañana a las 12",
                mode: "chat_with_action",
                actions: [addEventAction]
            )
            check(label: "antibasura-degrade-2: input directo NO degrade",
                  actual: directDecision.didDemote, expected: false, failures: &failures)
            check(label: "antibasura-degrade-2: safeActions intacto",
                  actual: directDecision.safeActions.count, expected: 1, failures: &failures)

            // Caso C: input emocional + edit_event → NO degrade (edits OK).
            let editAction: BackendAction = .editEvent(
                id: "abc", updates: BackendEventUpdates(
                    title: nil, timeString: nil, endTimeString: nil,
                    dateString: nil, location: nil,
                    reminderOffsets: [30], reminderNotes: nil
                )
            )
            let editDecision = NovaActionValidator.applyAntiBasura(
                userText: "creo que muevo lo de fútbol",
                mode: "chat_with_action",
                actions: [editAction]
            )
            check(label: "antibasura-degrade-3: edit no se degrada (acción clara)",
                  actual: editDecision.didDemote, expected: false, failures: &failures)
            check(label: "antibasura-degrade-3: edit pasa a safe",
                  actual: editDecision.safeActions.count, expected: 1, failures: &failures)
        }

        // ── Matching semántico: findEventByApproxTitle ───────────────
        do {
            // Crear eventos mock con títulos del spec.
            let now = Date()
            let cal = Calendar.current
            let arteId = UUID()
            let focusId = UUID()
            let futbolId = UUID()
            let arte = FocusEvent(
                id: arteId, title: "Clase de arte",
                startTime: cal.date(bySettingHour: 10, minute: 30, second: 0, of: now)!,
                endTime: cal.date(bySettingHour: 12, minute: 0, second: 0, of: now)!,
                section: .estudio
            )
            let focusEv = FocusEvent(
                id: focusId, title: "Trabajar con Focus",
                startTime: cal.date(bySettingHour: 13, minute: 0, second: 0, of: now)!,
                endTime: cal.date(bySettingHour: 14, minute: 0, second: 0, of: now)!,
                section: .foco
            )
            let futbol = FocusEvent(
                id: futbolId, title: "Salir a jugar fútbol",
                startTime: cal.date(bySettingHour: 15, minute: 0, second: 0, of: now)!,
                endTime: cal.date(bySettingHour: 16, minute: 30, second: 0, of: now)!,
                section: .descanso
            )
            let mockEvents = [arte, focusEv, futbol]

            check(label: "match-sem-1: 'futbol' → 'Salir a jugar fútbol'",
                  actual: NovaResponder.findEventByApproxTitle("futbol", in: mockEvents)?.id,
                  expected: futbolId as UUID?, failures: &failures)
            check(label: "match-sem-2: 'fútbol' (con tilde) → mismo",
                  actual: NovaResponder.findEventByApproxTitle("fútbol", in: mockEvents)?.id,
                  expected: futbolId as UUID?, failures: &failures)
            check(label: "match-sem-3: 'arte' → 'Clase de arte'",
                  actual: NovaResponder.findEventByApproxTitle("arte", in: mockEvents)?.id,
                  expected: arteId as UUID?, failures: &failures)
            check(label: "match-sem-4: 'focus' → 'Trabajar con Focus'",
                  actual: NovaResponder.findEventByApproxTitle("focus", in: mockEvents)?.id,
                  expected: focusId as UUID?, failures: &failures)
            // Frases más naturales
            check(label: "match-sem-5: 'el evento de fútbol' → futbol",
                  actual: NovaResponder.findEventByApproxTitle("el evento de fútbol", in: mockEvents)?.id,
                  expected: futbolId as UUID?, failures: &failures)
        }

        // ── Matching por referencia temporal: findEventByTimeReference ─
        do {
            let now = Date()
            let cal = Calendar.current
            let futbolId = UUID()
            let futbol = FocusEvent(
                id: futbolId, title: "Salir a jugar fútbol",
                startTime: cal.date(bySettingHour: 15, minute: 0, second: 0, of: now)!,
                endTime: cal.date(bySettingHour: 16, minute: 30, second: 0, of: now)!,
                section: .descanso
            )
            let mock = [futbol]
            // "a las 3" en contexto coloquial chileno → 15:00 PM.
            check(label: "match-time-1: 'el evento de las 3' → fútbol 15:00",
                  actual: NovaResponder.findEventByTimeReference("el evento de las 3", in: mock)?.id,
                  expected: futbolId as UUID?, failures: &failures)
            // Hora explícita PM
            check(label: "match-time-2: 'lo de las 15:00' → fútbol",
                  actual: NovaResponder.findEventByTimeReference("lo de las 15:00", in: mock)?.id,
                  expected: futbolId as UUID?, failures: &failures)
            // Sin match temporal
            check(label: "match-time-3: 'estoy cansado' (sin hora) → nil",
                  actual: NovaResponder.findEventByTimeReference("estoy cansado", in: mock) == nil,
                  expected: true, failures: &failures)
        }

        // ── Variante "antes al X" (contracción coloquial) ──────────────
        do {
            let intent = NovaResponder.extractReminderAttachIntent(
                from: "Ponle recordatorio media hora antes al fútbol"
            )
            check(label: "attach-al-1: 'antes al fútbol' matchea",
                  actual: intent != nil, expected: true, failures: &failures)
            if let i = intent {
                check(label: "attach-al-2: offset = 30 min",
                      actual: i.offsetMinutes, expected: 30, failures: &failures)
                check(label: "attach-al-3: activity = 'fútbol'",
                      actual: i.activity, expected: "fútbol", failures: &failures)
            }
        }

        // ── NovaService.Mode fallback ─────────────────────────────────
        do {
            // Si actions vacío + shouldAskUser=true → clarification.
            let m1 = NovaService.Mode.fallback(actions: [], shouldAskUser: true)
            check(label: "mode-fallback-1: empty + ask → clarification",
                  actual: m1, expected: .clarification, failures: &failures)
            // Si actions vacío + shouldAskUser=false → chatOnly.
            let m2 = NovaService.Mode.fallback(actions: [], shouldAskUser: false)
            check(label: "mode-fallback-2: empty + no ask → chatOnly",
                  actual: m2, expected: .chatOnly, failures: &failures)
            // Si actions presentes → chatWithAction.
            let addAction: BackendAction = .addEvent(BackendEventCreate(
                title: "Test", timeString: nil, endTimeString: nil, dateString: nil,
                section: nil, icon: nil, reminderOffsets: nil, reminderNotes: nil,
                location: nil, notes: nil, subtitle: nil
            ))
            let m3 = NovaService.Mode.fallback(actions: [addAction], shouldAskUser: false)
            check(label: "mode-fallback-3: con actions → chatWithAction",
                  actual: m3, expected: .chatWithAction, failures: &failures)
        }

        // ═══════════════════════════════════════════════════════════════
        //  NAMED REMINDERS — Spec del usuario (2026-05-15):
        //
        //  "Le digo a Nova que tengo un partido tipo 3 y que me acuerde
        //   20 min antes de echar las zapatillas a la mochila" debe crear:
        //   - Evento "Partido" 15:00
        //   - Reminder offset 20 min anclado al evento
        //   - Reminder note = "Echar las zapatillas a la mochila"
        //
        //  La notif a las 14:40 mostrará la nota como title y el evento
        //  padre como subtitle.
        // ═══════════════════════════════════════════════════════════════

        // 1. extractReminderOffsetAndNote — patrón principal del user
        if let detail = NovaActionNormalizer.extractReminderOffsetAndNote(
            from: "tengo partido tipo 3 acuérdame 20 min antes de echar las zapatillas a la mochila"
        ) {
            check(label: "named-1: offset = 20",
                  actual: detail.offsetMinutes, expected: 20, failures: &failures)
            check(label: "named-1: note = 'Echar las zapatillas a la mochila'",
                  actual: detail.note,
                  expected: "Echar las zapatillas a la mochila" as String?,
                  failures: &failures)
        } else {
            failures.append("  ✗ named-1: extractReminderOffsetAndNote devolvió nil")
        }

        // 2. extractReminderOffsetAndNote — sin "de X" trailing
        if let detail = NovaActionNormalizer.extractReminderOffsetAndNote(
            from: "acuérdame 10 min antes"
        ) {
            check(label: "named-2: offset = 10",
                  actual: detail.offsetMinutes, expected: 10, failures: &failures)
            check(label: "named-2: note = nil (sin 'de X')",
                  actual: detail.note == nil, expected: true, failures: &failures)
        } else {
            failures.append("  ✗ named-2: extractReminderOffsetAndNote devolvió nil")
        }

        // 3. extractReminderOffsetAndNote — número en palabra
        if let detail = NovaActionNormalizer.extractReminderOffsetAndNote(
            from: "recuérdame media hora antes de salir de casa"
        ) {
            check(label: "named-3: offset = 30 (media hora)",
                  actual: detail.offsetMinutes, expected: 30, failures: &failures)
            check(label: "named-3: note = 'Salir de casa'",
                  actual: detail.note,
                  expected: "Salir de casa" as String?,
                  failures: &failures)
        } else {
            failures.append("  ✗ named-3: extractReminderOffsetAndNote devolvió nil")
        }

        // 4. cleanTitle del input completo — título limpio sin "antes de X"
        check(
            label: "named-4: cleanTitle 'tengo partido...' → 'Partido' limpio",
            actual: NovaActionNormalizer.cleanTitle(
                "tengo partido tipo 3 acuérdame 20 min antes de echar las zapatillas a la mochila"
            ),
            expected: "Partido",
            failures: &failures
        )

        // 5. cleanTitle del input completo — el note NO debe quedar en title
        let cleanedTitle5 = NovaActionNormalizer.cleanTitle(
            "tengo partido tipo 3 acuérdame 20 min antes de echar las zapatillas a la mochila"
        ).lowercased()
        check(label: "named-5: title NO contiene 'echar'",
              actual: cleanedTitle5.contains("echar"), expected: false, failures: &failures)
        check(label: "named-5: title NO contiene 'zapatillas'",
              actual: cleanedTitle5.contains("zapatillas"), expected: false, failures: &failures)
        check(label: "named-5: title NO contiene 'antes'",
              actual: cleanedTitle5.contains("antes"), expected: false, failures: &failures)

        // 6. Caso parser → reminderNotes propagado a FocusEvent vía local
        //    flow. Probamos creando el evento directamente y verificando
        //    que la nota va al campo correcto.
        do {
            let event = FocusEvent(
                title: "Partido",
                startTime: Date().addingTimeInterval(3600),  // 1h en futuro
                endTime: Date().addingTimeInterval(7200),
                section: .personal,
                reminderOffsets: [20],
                reminderNotes: ["Echar las zapatillas a la mochila"]
            )
            check(label: "named-6: reminderOffsets [20]",
                  actual: event.reminderOffsets ?? [], expected: [20], failures: &failures)
            check(label: "named-6: reminderNote(at: 0) = 'Echar las zapatillas a la mochila'",
                  actual: event.reminderNote(at: 0),
                  expected: "Echar las zapatillas a la mochila" as String?,
                  failures: &failures)
            check(label: "named-6: reminderNote(at: 1) = nil (fuera de rango)",
                  actual: event.reminderNote(at: 1) == nil,
                  expected: true, failures: &failures)
        }

        // 7. cleanReminderNote helper — strip "de " redundante y capitalize
        if let detail = NovaActionNormalizer.extractReminderOffsetAndNote(
            from: "avísame 5 minutos antes de la reunión con el cliente"
        ) {
            // El "de la" inicial se trim porque la captura empieza después
            // de "antes de " ya. La nota efectiva es "la reunión con el
            // cliente" — el cleaner respeta artículos legítimos.
            check(label: "named-7: offset = 5",
                  actual: detail.offsetMinutes, expected: 5, failures: &failures)
            // Aceptamos cualquier variación que contenga "reunión con el cliente"
            let noteLower = (detail.note ?? "").lowercased()
            check(label: "named-7: note contiene 'reunión con el cliente'",
                  actual: noteLower.contains("reunión con el cliente"),
                  expected: true, failures: &failures)
        }

        // 8. Compatibilidad backward — evento con offsets pero SIN notes
        //    no debe crashear ni alucinar nota.
        do {
            let legacyEvent = FocusEvent(
                title: "Ducharme",
                startTime: Date().addingTimeInterval(3600),
                endTime: Date().addingTimeInterval(3900),
                section: .personal,
                reminderOffsets: [10]
                // sin reminderNotes
            )
            check(label: "named-8: backward-compat reminderNote(at: 0) = nil",
                  actual: legacyEvent.reminderNote(at: 0) == nil,
                  expected: true, failures: &failures)
        }

        // ═══════════════════════════════════════════════════════════════
        //  TOPIC FOCUS / MEMORIA TEMPORAL — User spec 2026-05-15:
        //
        //  "si estamos hablando de futbol y le pongo de las zapatillas, que
        //   no me pregunte para que evento es si es obvio que para el de
        //   futbol y no para el de arte"
        //
        //  La memoria local mantiene una lista de eventos discutidos en
        //  los últimos 30 min. La lista se ordena por recencia. Cuando el
        //  user pide algo ambiguo, se resuelve al primero.
        // ═══════════════════════════════════════════════════════════════

        // 1. NovaContext: discussedEvents vacío por default.
        do {
            let ctx = NovaContext()
            check(label: "topic-1: discussedEvents vacío por default",
                  actual: ctx.discussedEvents.isEmpty, expected: true, failures: &failures)
            check(label: "topic-1: topicEvent nil cuando lista vacía",
                  actual: ctx.topicEvent == nil, expected: true, failures: &failures)
        }

        // 2. DiscussedEvent.isFresh: < 30 min = fresh, ≥ 30 min = stale.
        do {
            let recent = DiscussedEvent(
                eventId: UUID(),
                title: "Partido",
                mentionedAt: Date().addingTimeInterval(-5 * 60)  // hace 5 min
            )
            let stale = DiscussedEvent(
                eventId: UUID(),
                title: "Muestra",
                mentionedAt: Date().addingTimeInterval(-31 * 60)  // hace 31 min
            )
            check(label: "topic-2: evento de hace 5 min es fresh",
                  actual: recent.isFresh, expected: true, failures: &failures)
            check(label: "topic-2: evento de hace 31 min NO es fresh",
                  actual: stale.isFresh, expected: false, failures: &failures)
        }

        // 3. freshDiscussedEvents filtra correctamente expirados.
        do {
            let recent = DiscussedEvent(
                eventId: UUID(), title: "Partido",
                mentionedAt: Date().addingTimeInterval(-5 * 60)
            )
            let stale = DiscussedEvent(
                eventId: UUID(), title: "Muestra",
                mentionedAt: Date().addingTimeInterval(-31 * 60)
            )
            let ctx = NovaContext(discussedEvents: [recent, stale])
            check(label: "topic-3: freshDiscussedEvents.count = 1",
                  actual: ctx.freshDiscussedEvents.count, expected: 1, failures: &failures)
            check(label: "topic-3: topicEvent es el fresco (Partido)",
                  actual: ctx.topicEvent?.title, expected: "Partido" as String?, failures: &failures)
        }

        // 4. Orden por recencia: el más reciente primero.
        do {
            let arteId = UUID()
            let partidoId = UUID()
            let partido = DiscussedEvent(
                eventId: partidoId, title: "Partido",
                mentionedAt: Date().addingTimeInterval(-10 * 60)  // hace 10 min
            )
            let arte = DiscussedEvent(
                eventId: arteId, title: "Muestra de arte",
                mentionedAt: Date().addingTimeInterval(-2 * 60)   // hace 2 min, más reciente
            )
            // Lista construida en orden de recencia (más reciente primero).
            let ctx = NovaContext(discussedEvents: [arte, partido])
            check(label: "topic-4: topicEvent es Arte (el más reciente)",
                  actual: ctx.topicEvent?.title, expected: "Muestra de arte" as String?, failures: &failures)
            check(label: "topic-4: segundo en lista es Partido",
                  actual: ctx.freshDiscussedEvents.dropFirst().first?.title,
                  expected: "Partido" as String?, failures: &failures)
        }

        // 5. detectAndPromoteMentions: el match más fuerte (substring de título
        //    en texto) promueve al evento al frente.
        do {
            // Para testear la lógica, usamos un store stub no es necesario —
            // testeamos la equivalencia del helper de detección: una nueva
            // entrada con eventId = matched aparece al frente.
            //
            // Aquí solo verificamos que múltiples mentions ordenan
            // correctamente. La lógica real vive en FocusDataStore.
            let arteId = UUID()
            let partidoId = UUID()
            var ctx = NovaContext()
            // Simulación manual del flujo de promoteDiscussedEvent.
            ctx.discussedEvents.insert(
                DiscussedEvent(eventId: partidoId, title: "Partido",
                               mentionedAt: Date().addingTimeInterval(-3)),
                at: 0
            )
            ctx.discussedEvents.insert(
                DiscussedEvent(eventId: arteId, title: "Muestra de arte",
                               mentionedAt: Date()),
                at: 0
            )
            check(label: "topic-5: tras dos mentions, topicEvent = Arte",
                  actual: ctx.topicEvent?.title,
                  expected: "Muestra de arte" as String?, failures: &failures)
            check(label: "topic-5: ambos eventos en discusión",
                  actual: ctx.freshDiscussedEvents.count, expected: 2, failures: &failures)
        }

        // 6. Cap de 5 items: no acumular indefinidamente.
        do {
            var ctx = NovaContext()
            // Insertar 7 mentions distintas, cada una al frente.
            for i in 0..<7 {
                let event = DiscussedEvent(
                    eventId: UUID(),
                    title: "Evento \(i)",
                    mentionedAt: Date().addingTimeInterval(-Double(i))
                )
                ctx.discussedEvents.insert(event, at: 0)
                // Cap manual del test — coincide con el cap de updateNovaContext.
                ctx.discussedEvents = Array(ctx.discussedEvents.prefix(5))
            }
            check(label: "topic-6: máximo 5 items en discusión",
                  actual: ctx.discussedEvents.count, expected: 5, failures: &failures)
        }

        // 7. Caso integración: extractReminderAttachIntent extrae offset+
        //    activity correctamente para el fallback de topic focus.
        if let intent = NovaResponder.extractReminderAttachIntent(
            from: "acuérdame 20 min antes de echar las zapatillas a la mochila"
        ) {
            check(label: "topic-7: offset = 20",
                  actual: intent.offsetMinutes, expected: 20, failures: &failures)
            check(label: "topic-7: activity = 'echar las zapatillas a la mochila'",
                  actual: intent.activity,
                  expected: "echar las zapatillas a la mochila",
                  failures: &failures)
            // El consumer (tryAttachReminderToExistingEvent) usará este
            // activity como reminderNote si cae al topic focus event.
        } else {
            failures.append("  ✗ topic-7: extractReminderAttachIntent devolvió nil")
        }

        // 8. Recordatorio SIN evento nombrado → solo offset (se ancla al
        //    topicEvent en el caller). Cubre el bug del path backend: el
        //    follow-up "acuérdame 25 min antes" tras crear un evento se
        //    resolvía mal (anclaba a un evento demo). Ahora es local +
        //    determinista vía extractBareReminderOffset + topicEvent.
        check(label: "topic-8: 'acuérdame 25 min antes' → offset 25",
              actual: NovaResponder.extractBareReminderOffset(from: "acuérdame 25 min antes"),
              expected: 25 as Int?, failures: &failures)
        check(label: "topic-8: 'avísame media hora antes' → offset 30",
              actual: NovaResponder.extractBareReminderOffset(from: "avísame media hora antes"),
              expected: 30 as Int?, failures: &failures)
        check(label: "topic-8: 'ponle aviso 15 min antes' → offset 15",
              actual: NovaResponder.extractBareReminderOffset(from: "ponle aviso 15 min antes"),
              expected: 15 as Int?, failures: &failures)
        // Con "antes de X" lo maneja extractReminderAttachIntent → bare = nil.
        check(label: "topic-8: con 'antes de X' → nil (lo toma attach-intent)",
              actual: NovaResponder.extractBareReminderOffset(from: "acuérdame 20 min antes de echar las zapatillas"),
              expected: nil as Int?, failures: &failures)
        // Sin trigger de recordatorio → nil.
        check(label: "topic-8: sin trigger → nil",
              actual: NovaResponder.extractBareReminderOffset(from: "qué tengo hoy"),
              expected: nil as Int?, failures: &failures)
        // Trigger pero sin "antes" (relativo "en N") → nil (no es aviso previo).
        check(label: "topic-8: 'acuérdame en 25 min' → nil (no 'antes')",
              actual: NovaResponder.extractBareReminderOffset(from: "acuérdame en 25 min"),
              expected: nil as Int?, failures: &failures)

        // ───── Validador post-IA ──────────────────────────────────────
        NovaActionValidatorTests.runAll(into: &failures)

        // ───── Regresión 2026-06-11: subtitle con targeting por evento ─
        // Bug del usuario: "si pongo dos eventos y solo a 1 le quiero
        // poner subtítulo le pone a los dos". Ejecuta el pipeline REAL
        // (applyBackendActions → makeEvent / applyUpdates) con el batch
        // exacto del escenario.
        if Thread.isMainThread {
            failures += MainActor.assumeIsolated {
                subtitleTargetingRegressionFailures()
            }
        } else {
            failures.append("  ✗ subtitle-targeting: runAll no corrió en main thread")
        }

        // ───── Attach-reminder: detectar "acuérdame N antes de X" ─────
        //
        // Spec del usuario: cuando dice "acuérdame N min antes de
        // ducharme" y existe un evento "Ducharme", debemos extraer
        // (offset=N, activity="ducharme") y luego usar fuzzy match para
        // encontrar el evento. NO crear basura.

        // 1. extractReminderAttachIntent — pattern matching

        if let intent = NovaResponder.extractReminderAttachIntent(
            from: "Acuérdame 10 minutos antes de ducharme"
        ) {
            check(label: "attach: offset 10 min",
                  actual: intent.offsetMinutes, expected: 10, failures: &failures)
            check(label: "attach: activity 'ducharme'",
                  actual: intent.activity, expected: "ducharme", failures: &failures)
        } else {
            let msg = "  ✗ attach: no extrajo intent de 'Acuérdame 10 minutos antes de ducharme'"
            print(msg); failures.append(msg)
        }

        // Caso B literal del spec del usuario
        if let intent = NovaResponder.extractReminderAttachIntent(
            from: "acuérdame 40 min antes de ir a buscar a mi hermano"
        ) {
            check(label: "attach-B: offset 40 min",
                  actual: intent.offsetMinutes, expected: 40, failures: &failures)
            check(label: "attach-B: activity contiene 'buscar a mi hermano' o similar",
                  actual: intent.activity.contains("hermano"),
                  expected: true, failures: &failures)
        } else {
            let msg = "  ✗ attach-B: no extrajo intent del caso 'mi hermano'"
            print(msg); failures.append(msg)
        }

        // Variantes que NO deben matchear: sin "antes de", sin trigger, etc.
        check(
            label: "attach: 'acuérdame comprar pan' sin 'antes de' → nil",
            actual: NovaResponder.extractReminderAttachIntent(
                from: "acuérdame comprar pan en 10 min"
            ) == nil,
            expected: true, failures: &failures
        )
        check(
            label: "attach: sin trigger 'acuérdame' → nil",
            actual: NovaResponder.extractReminderAttachIntent(
                from: "ducharme a las 10"
            ) == nil,
            expected: true, failures: &failures
        )

        // 2. findEventByApproxTitle — fuzzy match

        let mockDucharme = FocusEvent(
            title: "Ducharme",
            startTime: Date().addingTimeInterval(60 * 60),     // +1h
            section: .personal
        )
        let mockBuscarHermano = FocusEvent(
            title: "Buscar a mi hermano",
            startTime: Date().addingTimeInterval(60 * 60 * 2), // +2h
            section: .personal
        )
        let mockEvents = [mockDucharme, mockBuscarHermano]

        // Match exacto: "ducharme" → Ducharme
        if let m = NovaResponder.findEventByApproxTitle("ducharme", in: mockEvents) {
            check(label: "fuzzy: 'ducharme' → 'Ducharme' exacto",
                  actual: m.id, expected: mockDucharme.id, failures: &failures)
        } else {
            let msg = "  ✗ fuzzy: 'ducharme' no encontró el evento Ducharme"
            print(msg); failures.append(msg)
        }

        // Match con acentos / mayúsculas diferentes
        if let m = NovaResponder.findEventByApproxTitle("DUCHARME", in: mockEvents) {
            check(label: "fuzzy: 'DUCHARME' (mayúscula) → Ducharme",
                  actual: m.id, expected: mockDucharme.id, failures: &failures)
        }

        // Match substring: "ducha" matchea "Ducharme" (substring)
        if let m = NovaResponder.findEventByApproxTitle("ducha", in: mockEvents) {
            check(label: "fuzzy: 'ducha' → Ducharme (substring)",
                  actual: m.id, expected: mockDucharme.id, failures: &failures)
        } else {
            let msg = "  ✗ fuzzy: 'ducha' no encontró Ducharme via substring"
            print(msg); failures.append(msg)
        }

        // Match token overlap: "ir a buscar a mi hermano"
        if let m = NovaResponder.findEventByApproxTitle(
            "ir a buscar a mi hermano", in: mockEvents
        ) {
            check(label: "fuzzy: 'ir a buscar a mi hermano' → match exacto",
                  actual: m.id, expected: mockBuscarHermano.id, failures: &failures)
        } else {
            let msg = "  ✗ fuzzy: 'ir a buscar a mi hermano' no encontró el evento"
            print(msg); failures.append(msg)
        }

        // Match parcial: "buscar hermano" → "Buscar a mi hermano"
        if let m = NovaResponder.findEventByApproxTitle(
            "buscar hermano", in: mockEvents
        ) {
            check(label: "fuzzy: 'buscar hermano' → Buscar a mi hermano",
                  actual: m.id, expected: mockBuscarHermano.id, failures: &failures)
        } else {
            let msg = "  ✗ fuzzy: 'buscar hermano' no matcheó"
            print(msg); failures.append(msg)
        }

        // Sin match: "estudiar matemáticas" no debe matchear nada
        check(
            label: "fuzzy: 'estudiar matemáticas' sin match → nil",
            actual: NovaResponder.findEventByApproxTitle(
                "estudiar matemáticas", in: mockEvents
            ) == nil,
            expected: true, failures: &failures
        )

        // Empty events → nil
        check(
            label: "fuzzy: events vacío → nil",
            actual: NovaResponder.findEventByApproxTitle("ducharme", in: []) == nil,
            expected: true, failures: &failures
        )

        // ───── REMINDER ABSOLUTO (bug 2026-05-13) ────────────────────
        //
        // Patrón "[evento] a las X acuérdame a las Y" debe extraerse como
        // UN evento + UN aviso, no como dos acciones multi-intent.

        // Caso 1: "tengo clases a las 1:30 acuérdame a las 12:50"
        if let intent = NovaResponder.extractReminderAbsoluteIntent(
            from: "tengo clases a las 1:30 acuérdame a las 12:50"
        ), case let .newBlock(title, eh, em, rh, rm) = intent {
            check(label: "abs-1: title contiene 'clase'",
                  actual: title.lowercased().contains("clase"),
                  expected: true, failures: &failures)
            check(label: "abs-1: event hour 1", actual: eh, expected: 1, failures: &failures)
            check(label: "abs-1: event min 30", actual: em, expected: 30, failures: &failures)
            check(label: "abs-1: reminder hour 12", actual: rh, expected: 12, failures: &failures)
            check(label: "abs-1: reminder min 50", actual: rm, expected: 50, failures: &failures)
        } else {
            failures.append("  ✗ abs-1: 'tengo clases a las 1:30 acuérdame a las 12:50' no matcheó newBlock")
        }
        // Defensa: isLikelyMultiAction NO debe marcarlo complejo.
        check(
            label: "abs-1: isLikelyMultiAction false (no es multi-action)",
            actual: NovaResponder.isLikelyMultiAction(
                "tengo clases a las 1:30 acuérdame a las 12:50"
            ),
            expected: false, failures: &failures
        )

        // Caso 2: "reunión a las 5 avísame a las 4:30"
        if let intent = NovaResponder.extractReminderAbsoluteIntent(
            from: "reunión a las 5 avísame a las 4:30"
        ), case let .newBlock(title, eh, em, rh, rm) = intent {
            check(label: "abs-2: title contiene 'reunión'",
                  actual: title.lowercased().contains("reuni"),
                  expected: true, failures: &failures)
            check(label: "abs-2: event hour 5", actual: eh, expected: 5, failures: &failures)
            check(label: "abs-2: event min 0", actual: em, expected: 0, failures: &failures)
            check(label: "abs-2: reminder hour 4", actual: rh, expected: 4, failures: &failures)
            check(label: "abs-2: reminder min 30", actual: rm, expected: 30, failures: &failures)
        } else {
            failures.append("  ✗ abs-2: 'reunión a las 5 avísame a las 4:30' no matcheó newBlock")
        }
        check(
            label: "abs-2: isLikelyMultiAction false",
            actual: NovaResponder.isLikelyMultiAction(
                "reunión a las 5 avísame a las 4:30"
            ),
            expected: false, failures: &failures
        )

        // Caso 3: "ducharme a las 10 acuérdame a las 9:50"
        if let intent = NovaResponder.extractReminderAbsoluteIntent(
            from: "ducharme a las 10 acuérdame a las 9:50"
        ), case let .newBlock(title, eh, em, rh, rm) = intent {
            check(label: "abs-3: title contiene 'ducha'",
                  actual: title.lowercased().contains("ducha"),
                  expected: true, failures: &failures)
            check(label: "abs-3: event hour 10", actual: eh, expected: 10, failures: &failures)
            check(label: "abs-3: event min 0", actual: em, expected: 0, failures: &failures)
            check(label: "abs-3: reminder hour 9", actual: rh, expected: 9, failures: &failures)
            check(label: "abs-3: reminder min 50", actual: rm, expected: 50, failures: &failures)
        } else {
            failures.append("  ✗ abs-3: 'ducharme a las 10 acuérdame a las 9:50' no matcheó")
        }
        check(
            label: "abs-3: isLikelyMultiAction false",
            actual: NovaResponder.isLikelyMultiAction(
                "ducharme a las 10 acuérdame a las 9:50"
            ),
            expected: false, failures: &failures
        )

        // Caso 4: "tengo que seguir trabajando a las 3:30 y comer a las 4"
        // → NO es reminder absoluto (sin trigger 'acuérdame'). Sigue siendo
        //   multi-action → isLikelyMultiAction true. No regresión.
        check(
            label: "abs-4: 'trabajando a las 3:30 y comer a las 4' isLikelyMultiAction true",
            actual: NovaResponder.isLikelyMultiAction(
                "tengo que seguir trabajando a las 3:30 y comer a las 4"
            ),
            expected: true, failures: &failures
        )
        check(
            label: "abs-4: extractReminderAbsoluteIntent nil (sin trigger)",
            actual: NovaResponder.extractReminderAbsoluteIntent(
                from: "tengo que seguir trabajando a las 3:30 y comer a las 4"
            ) == nil,
            expected: true, failures: &failures
        )

        // Caso 5: "comprar pan y leche" — sin horas, sin reminder. No
        // toca el flow nuevo. Sigue siendo simple task (no multi-action).
        check(
            label: "abs-5: 'comprar pan y leche' extractor nil",
            actual: NovaResponder.extractReminderAbsoluteIntent(
                from: "comprar pan y leche"
            ) == nil,
            expected: true, failures: &failures
        )
        check(
            label: "abs-5: 'comprar pan y leche' isLikelyMultiAction false",
            actual: NovaResponder.isLikelyMultiAction("comprar pan y leche"),
            expected: false, failures: &failures
        )

        // Caso B (attach por absoluto): "acuérdame a las 9:50 de ducharme"
        if let intent = NovaResponder.extractReminderAbsoluteIntent(
            from: "acuérdame a las 9:50 de ducharme"
        ), case let .attachByAbsolute(activity, rh, rm) = intent {
            check(label: "abs-B: activity contiene 'ducha'",
                  actual: activity.lowercased().contains("ducha"),
                  expected: true, failures: &failures)
            check(label: "abs-B: reminder hour 9", actual: rh, expected: 9, failures: &failures)
            check(label: "abs-B: reminder min 50", actual: rm, expected: 50, failures: &failures)
        } else {
            failures.append("  ✗ abs-B: 'acuérdame a las 9:50 de ducharme' no matcheó attach")
        }

        // ───── resolveAbsoluteReminderHour: scoring AM/PM ─────────────
        //
        // Bug 2026-05-13 (Caso 1): "clases a las 1:30 acuérdame a las 12:50"
        // — el reminder "12:50" con school context forceAM se resolvía a
        // 0:50 (medianoche), dando offset ~12h 40min. Wrong. El scoring
        // smart debe elegir PM 12:50 (mediodía) → offset 40 min.
        //
        // Patrón: dado eventHour24 y rawReminderHour 1-12, devolver el
        // bracket (AM o PM) que produce offset positivo razonable.

        // Caso 1 literal: event 13:30, reminder cruda 12:50 → debe ser 12 (PM mediodía).
        check(
            label: "scoring abs-1: event=13:30 + reminder cruda 12:50 → 12 (PM mediodía)",
            actual: NovaResponder.resolveAbsoluteReminderHour(
                rawReminderHour: 12, rawReminderMin: 50,
                eventHour24: 13, eventMin: 30
            ),
            expected: 12, failures: &failures
        )
        // Caso 2: event 17:00, reminder cruda 4:30 → debe ser 16 (PM 4:30).
        check(
            label: "scoring abs-2: event=17:00 + reminder cruda 4:30 → 16 (PM)",
            actual: NovaResponder.resolveAbsoluteReminderHour(
                rawReminderHour: 4, rawReminderMin: 30,
                eventHour24: 17, eventMin: 0
            ),
            expected: 16, failures: &failures
        )
        // Caso 3: event 10:00 AM, reminder cruda 9:50 → debe ser 9 (AM).
        check(
            label: "scoring abs-3: event=10:00 AM + reminder cruda 9:50 → 9 (AM)",
            actual: NovaResponder.resolveAbsoluteReminderHour(
                rawReminderHour: 9, rawReminderMin: 50,
                eventHour24: 10, eventMin: 0
            ),
            expected: 9, failures: &failures
        )
        // Edge: reminder 24h literal (>12) — pasa tal cual.
        check(
            label: "scoring edge: reminder 16 (ya 24h) → 16",
            actual: NovaResponder.resolveAbsoluteReminderHour(
                rawReminderHour: 16, rawReminderMin: 0,
                eventHour24: 17, eventMin: 0
            ),
            expected: 16, failures: &failures
        )
        // Edge: event temprano (8 AM), reminder 12:50 → AM 0:50 da offset 7h10m,
        // PM 12:50 da offset NEGATIVO (-4h50m). AM gana.
        check(
            label: "scoring edge: event=8 AM + reminder 12:50 → 0 (AM noche)",
            actual: NovaResponder.resolveAbsoluteReminderHour(
                rawReminderHour: 12, rawReminderMin: 50,
                eventHour24: 8, eventMin: 0
            ),
            expected: 0, failures: &failures
        )

        // ───── Caso 7 (ambiguo): "acuérdame lo de mañana" ────────────
        //
        // Sin trigger de tiempo concreto, ni "antes de", ni hora absoluta.
        // El extractor de absoluto debe devolver nil. El de attach también.
        // El flujo cae al parser local que pedirá clarify — no a "no pude
        // separar" porque NO tiene 2 horas.

        check(
            label: "ambiguo: 'acuérdame lo de mañana' extract absoluto nil",
            actual: NovaResponder.extractReminderAbsoluteIntent(
                from: "acuérdame lo de mañana"
            ) == nil,
            expected: true, failures: &failures
        )
        check(
            label: "ambiguo: 'acuérdame lo de mañana' extract attach nil",
            actual: NovaResponder.extractReminderAttachIntent(
                from: "acuérdame lo de mañana"
            ) == nil,
            expected: true, failures: &failures
        )
        check(
            label: "ambiguo: 'acuérdame lo de mañana' isLikelyMultiAction false",
            actual: NovaResponder.isLikelyMultiAction("acuérdame lo de mañana"),
            expected: false, failures: &failures
        )

        // ───── REORDEN: 'a las X [verbo]' → '[verbo] a las X' ─────────
        //
        // Tras splitear por "luego/después", el segundo segmento puede
        // empezar con la hora ("a las 3 ducharme"). El parser local
        // entiende mejor si reordenamos a "ducharme a las 3".
        //
        // Bug del screenshot 2026-05-13:
        //   "ir a buscar a mi hermano a las 2 luego a las 3 ducharme"
        // splits a:
        //   1. "ir a buscar a mi hermano a las 2"  ✓ (parser OK)
        //   2. "a las 3 ducharme"  ← antes daba clarify, ahora reordena
        //                            a "ducharme a las 3" y parser OK.

        let reorderTest = NovaResponder.parseAll(
            "ir a buscar a mi hermano a las 2 luego a las 3 ducharme"
        )
        check(label: "reorden: 'a las 2 luego a las 3 ducharme' → 2 intents",
              actual: reorderTest.count, expected: 2, failures: &failures)

        let reorderResults = runPipeline(
            "ir a buscar a mi hermano a las 2 luego a las 3 ducharme"
        )
        check(label: "reorden runPipeline: 2 intents",
              actual: reorderResults.count, expected: 2, failures: &failures)
        if reorderResults.count == 2 {
            // Intent 1: "Buscar a mi hermano" hora 14 (PM colloquial)
            check(label: "reorden[0] title 'Buscar a mi hermano'",
                  actual: reorderResults[0].title,
                  expected: "Buscar a mi hermano", failures: &failures)
            check(label: "reorden[0] hour 14",
                  actual: reorderResults[0].hour, expected: 14, failures: &failures)
            // Intent 2: "Duchar" hora 15 (PM colloquial).
            // "Ducharme" → stripReflexiveMe → "Duchar" (reflejo correcto).
            check(label: "reorden[1] title 'Duchar'",
                  actual: reorderResults[1].title, expected: "Duchar", failures: &failures)
            check(label: "reorden[1] hour 15",
                  actual: reorderResults[1].hour, expected: 15, failures: &failures)
            // Crítico: ninguno debe ser .clarify
            check(label: "reorden[1] kind ≠ clarify",
                  actual: reorderResults[1].kind != .clarify,
                  expected: true, failures: &failures)
        }

        // Caso similar con palabras: "estudiar a las 5 luego a las 7 cenar"
        let reorderWords = runPipeline("estudiar a las 5 luego a las 7 cenar")
        check(label: "reorden-2: 'estudiar a las 5 luego a las 7 cenar' → 2 intents",
              actual: reorderWords.count, expected: 2, failures: &failures)
        if reorderWords.count == 2 {
            check(label: "reorden-2[0] hour 17 (estudiar PM)",
                  actual: reorderWords[0].hour, expected: 17, failures: &failures)
            check(label: "reorden-2[1] hour 19 (cenar PM por verbo)",
                  actual: reorderWords[1].hour, expected: 19, failures: &failures)
        }

        // ───── REGRESSION: school context AM solo en 6-12 ─────────────
        //
        // Antes del fix: "clase a las 1:30" → 1:30 AM (forceAM agresivo).
        // Después del fix: → 13:30 (school context no aplica para 1-5).
        check(
            label: "school-fix: 'clase a las 1:30' currentHour=14 → 13 (PM)",
            actual: NovaResponder.adjustAmPm(
                hour: 1, in: "clase a las 1:30", currentHour: 14
            ),
            expected: 13, failures: &failures
        )
        // Pero "clase a las 8" debe seguir siendo 8 AM (sin regresión).
        check(
            label: "school-fix: 'clase a las 8' currentHour=14 → 8 (AM)",
            actual: NovaResponder.adjustAmPm(
                hour: 8, in: "clase a las 8", currentHour: 14
            ),
            expected: 8, failures: &failures
        )
        // Y "clase a las 3" también PM (3 en 1-7 → +12).
        check(
            label: "school-fix: 'clase a las 3' currentHour=14 → 15 (PM)",
            actual: NovaResponder.adjustAmPm(
                hour: 3, in: "clase a las 3", currentHour: 14
            ),
            expected: 15, failures: &failures
        )

        // ───── FIX chat→Mi Día 2026-08-10: nunca crear en el pasado ────
        //
        // "acuérdame de tomar mis remedios a las 8" a las 21h resolvía
        // HOY 08:00 (pasado) → el recordatorio nacía vencido y Mi Día lo
        // escondía del timeline. `resolveNonPastStartTime` salta a la
        // próxima ocurrencia razonable. Helper puro con `now` inyectable
        // → determinista a cualquier hora que corra la suite.
        do {
            let cal = Calendar.current
            let todayStart = cal.startOfDay(for: Date())
            func at(_ h: Int, _ m: Int = 0, dayOffset: Int = 0) -> Date {
                let day = cal.date(byAdding: .day, value: dayOffset, to: todayStart)!
                return cal.date(bySettingHour: h, minute: m, second: 0, of: day)!
            }
            // 1. Noche (21h): "a las 8" resuelta 08:00 hoy → mañana 08:00.
            let r1 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(8), userText: "acuérdame de tomar mis remedios a las 8",
                now: at(21)
            )
            check(label: "rollForward: remedios 8 AM a las 21h → mañana 08:00",
                  actual: r1.startTime, expected: at(8, 0, dayOffset: 1), failures: &failures)
            check(label: "rollForward: remedios 8 AM a las 21h → didRoll",
                  actual: r1.didRollForward, expected: true, failures: &failures)
            // 2. Tarde (14h): "a las 8" resuelta 08:00 hoy → hoy 20:00 (PM).
            let r2 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(8), userText: "acuérdame de tomar mis remedios a las 8",
                now: at(14)
            )
            check(label: "rollForward: remedios 8 AM a las 14h → hoy 20:00",
                  actual: r2.startTime, expected: at(20), failures: &failures)
            // 3. AM explícito ("de la mañana") NO se convierte en PM → mañana.
            let r3 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(7), userText: "gimnasio a las 7 de la mañana",
                now: at(10)
            )
            check(label: "rollForward: '7 de la mañana' pasada → mañana 07:00 (no PM)",
                  actual: r3.startTime, expected: at(7, 0, dayOffset: 1), failures: &failures)
            // 4. Día explícito ("hoy") se respeta aunque quede en pasado.
            let r4 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(16), userText: "dentista hoy a las 4",
                now: at(20)
            )
            check(label: "rollForward: 'hoy a las 4' NO se mueve (día explícito)",
                  actual: r4.startTime, expected: at(16), failures: &failures)
            // 4b. Weekday explícito también ancla.
            let r4b = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(16), userText: "dentista el lunes a las 4",
                now: at(20)
            )
            check(label: "rollForward: weekday explícito NO se mueve",
                  actual: r4b.didRollForward, expected: false, failures: &failures)
            // 5. Hora futura queda intacta.
            let r5 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(17), userText: "reunión con Juan a las 5",
                now: at(10)
            )
            check(label: "rollForward: hora futura intacta",
                  actual: r5.startTime, expected: at(17), failures: &failures)
            // 6. Gracia: pasó hace 1 min → se considera "ahora", no se mueve.
            let r6 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(9), userText: "llamar a mamá a las 9",
                now: at(9, 1)
            )
            check(label: "rollForward: hace 1 min → dentro de gracia, intacta",
                  actual: r6.didRollForward, expected: false, failures: &failures)
            // 7. Contexto de mañana-del-día (verbo despertar) NUNCA sube a
            //    PM: "despertarme a las 7" a las 14h es mañana 07:00.
            let r7 = NovaActionNormalizer.resolveNonPastStartTime(
                startTime: at(7), userText: "recuérdame despertarme a las 7",
                now: at(14)
            )
            check(label: "rollForward: 'despertarme a las 7' → mañana 07:00 (no 19:00)",
                  actual: r7.startTime, expected: at(7, 0, dayOffset: 1), failures: &failures)
        }

        // ───── Resultado ───────────────────────────────────────────────

        if failures.isEmpty {
            return "✓ ALL TESTS PASSED"
        }
        return "✗ FAILURES (\(failures.count)):\n" + failures.joined(separator: "\n")
    }

    // MARK: - Helpers para tests de pipeline completo

    /// Tipo de intent ejecutado. Útil para chequear que "comprar pan y
    /// leche" devuelve `.task` (no event, no split) y que multi-intent
    /// con horas devuelve `.event` o `.reminder` según corresponda.
    enum ParsedKind: String, Equatable {
        case event
        case reminder
        case task
        case clarify
        case other
    }

    /// Resultado de pasar un texto por `parseAll` + `cleanTitle`. Replica
    /// lo que hace `applyLocalNovaIntent` antes de guardar el evento.
    private struct ParsedAction: Equatable {
        let kind: ParsedKind
        let title: String
        let hour: Int?
        let minute: Int?
        let endHour: Int?
        let day: DayLabel
        let section: EventSection?
        let isReminder: Bool
        /// Minutos antes del startTime extraídos de "acuérdame N antes".
        /// Permite testear que un mismo bloque conserva su offset sin
        /// crearse como ítem duplicado.
        let reminderOffsetMinutes: Int?
        /// Subtítulo / detalle anclado al evento. Resuelto con la misma
        /// lógica que usa `applyLocalNovaIntent`:
        /// 1º `extractEventDetail` (trailing detail del userText), si no
        /// hay → 2º `splitTitleSubtitle` (split "reunión de X"), si no
        /// hay → nil.
        let subtitle: String?
    }

    enum DayLabel: String, Equatable {
        case today, tomorrow, otherDay, none
    }

    /// Pasa el texto por el pipeline completo (parseAll → cleanTitle) y
    /// devuelve una lista de `ParsedAction`, uno por intent generado.
    /// Si el intent es `.clarify`, devuelve una acción tipo `.clarify` para
    /// que el test pueda chequear ese resultado también.
    private static func runPipeline(_ text: String) -> [ParsedAction] {
        let intents = NovaResponder.parseAll(text)
        // Detalle trailing del userText — resuelto una vez por input para
        // que TODOS los intents (createEvent, createTask) compartan el
        // mismo subtítulo si aplica. Coincide con la lógica que usan
        // `applyLocalNovaIntent.createEvent` y `makeEvent` (backend).
        let trailingDetail = NovaActionNormalizer.extractEventDetail(from: text).detail
        // Espejo de applyLocalNovaIntent: en multi-intent el detalle trailing
        // del texto completo NO se aplica (pertenece a un solo segmento).
        let isMulti = intents.count > 1
        return intents.compactMap { intent -> ParsedAction? in
            switch intent {
            case let .createEvent(rawTitle, when, explicitEnd, _, section, wantsReminder, _, segReminderOffset, _):
                let cleanedTitle = NovaActionNormalizer.cleanTitle(rawTitle)
                // Subtítulo: detalle trailing > split "Reunión de X" > nil.
                let (resolvedTitle, resolvedSubtitle): (String, String?) = {
                    if let detail = trailingDetail, !isMulti {
                        return (cleanedTitle, detail)
                    }
                    if let split = NovaActionNormalizer.splitTitleSubtitle(cleanedTitle) {
                        return (split.title, split.subtitle)
                    }
                    return (cleanedTitle, nil)
                }()
                let hour = when.map { Calendar.current.component(.hour, from: $0) }
                let minute = when.map { Calendar.current.component(.minute, from: $0) }
                let endHour = explicitEnd.map { Calendar.current.component(.hour, from: $0) }
                let day = dayLabel(for: when)
                // Detail-aware reminder suppression (user spec 2026-05-27):
                //   - Si el texto EMPIEZA con trigger ("recuérdame ...") →
                //     reminder kind (intención explícita del usuario).
                //   - Si NO empieza con trigger pero hay trailingDetail →
                //     el "acordarme" mid-sentence fue consumido por la
                //     extracción → kind=event (el evento PRINCIPAL es lo
                //     que va antes del trigger).
                //   - Si no hay detail → comportamiento clásico (cualquier
                //     trigger o verbo puntual marca reminder).
                let reminder: Bool = {
                    if NovaActionNormalizer.startsWithReminderTrigger(in: text) {
                        return true
                    }
                    if trailingDetail != nil { return false }
                    return wantsReminder
                        || NovaActionNormalizer.isReminderTrigger(in: text)
                        || NovaActionNormalizer.impliesPunctualReminder(in: text)
                }()
                // Offset PRE-EXTRAÍDO del segmento (multi-evento) gana sobre la
                // extracción del texto completo — espejo de applyLocalNovaIntent.
                let offset = segReminderOffset ?? NovaActionNormalizer.extractReminderOffset(from: text)
                return ParsedAction(
                    kind: reminder ? .reminder : .event,
                    title: resolvedTitle, hour: hour, minute: minute, endHour: endHour, day: day,
                    section: section, isReminder: reminder,
                    reminderOffsetMinutes: offset,
                    subtitle: resolvedSubtitle
                )
            case let .createTask(rawTitle, dueDate, _, wantsReminder):
                let title = NovaActionNormalizer.cleanTitle(rawTitle)
                let hour = dueDate.map { Calendar.current.component(.hour, from: $0) }
                let minute = dueDate.map { Calendar.current.component(.minute, from: $0) }
                let day = dayLabel(for: dueDate)
                let reminder = wantsReminder
                    || NovaActionNormalizer.isReminderTrigger(in: text)
                    || NovaActionNormalizer.impliesPunctualReminder(in: text)
                return ParsedAction(
                    kind: .task, title: title, hour: hour, minute: minute, endHour: nil, day: day,
                    section: nil, isReminder: reminder,
                    reminderOffsetMinutes: nil,
                    subtitle: trailingDetail
                )
            case .clarify:
                return ParsedAction(
                    kind: .clarify, title: "", hour: nil, minute: nil, endHour: nil, day: .none,
                    section: nil, isReminder: false,
                    reminderOffsetMinutes: nil,
                    subtitle: nil
                )
            default:
                return ParsedAction(
                    kind: .other, title: "", hour: nil, minute: nil, endHour: nil, day: .none,
                    section: nil, isReminder: false,
                    reminderOffsetMinutes: nil,
                    subtitle: nil
                )
            }
        }
    }

    /// Devuelve una etiqueta legible (today/tomorrow/otherDay/none) según
    /// la fecha dada. Hace los tests más fáciles de leer.
    private static func dayLabel(for date: Date?) -> DayLabel {
        guard let date else { return .none }
        let cal = Calendar.current
        if cal.isDateInToday(date) { return .today }
        if cal.isDateInTomorrow(date) { return .tomorrow }
        return .otherDay
    }

    /// Comprueba que un texto produce exactamente 1 intent con título / hora /
    /// flag de recordatorio esperados. Si `expectedTitle` o `expectedReminder`
    /// son `nil`, no se chequean.
    private static func checkAction(
        _ label: String,
        text: String,
        expectedTitle: String?,
        expectedHour: Int?,
        expectedReminder: Bool?,
        failures: inout [String]
    ) {
        let actions = runPipeline(text)
        guard let first = actions.first else {
            let msg = "  ✗ \(label) — pipeline devolvió 0 intents"
            print(msg); failures.append(msg)
            return
        }
        if actions.count != 1 {
            let msg = "  ⚠ \(label) — pipeline devolvió \(actions.count) intents (esperaba 1)"
            print(msg); failures.append(msg)
        }
        if let expectedTitle {
            check(label: "\(label) — title", actual: first.title, expected: expectedTitle, failures: &failures)
        }
        if let expectedHour {
            check(label: "\(label) — hour", actual: first.hour, expected: expectedHour, failures: &failures)
        }
        if let expectedReminder {
            check(label: "\(label) — isReminder", actual: first.isReminder, expected: expectedReminder, failures: &failures)
        }
    }

    private static func check<T: Equatable>(
        label: String,
        actual: T,
        expected: T,
        failures: inout [String]
    ) {
        if actual == expected {
            print("  ✓ \(label)")
        } else {
            let msg = "  ✗ \(label) — got \(actual), expected \(expected)"
            print(msg)
            failures.append(msg)
        }
    }

    // MARK: - 50-case validation pre-TestFlight

    /// Suite de validación pre-TestFlight: 50 frases reales de usuario
    /// chileno. Ejercita `NovaResponder.parseAll` + `cleanTitle` +
    /// `extractExplicitEndTime` + flags de fast path. NO toca el store
    /// (no crea eventos/tareas reales) ni llama al backend de IA.
    ///
    /// Cómo correr: setear `FOCUS_RUN_TESTS=50` y lanzar la app. Resultado
    /// se imprime y se guarda en `Documents/focus-validation-50.log`.
    ///
    /// Criterio de aprobación: 45/50 PASS mínimo, sin fails críticos en
    /// los casos {1, 2, 3, 6, 7, 11, 12, 21, 44}.
    @discardableResult
    static func runValidation50Cases() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        typealias K = ParsedKind
        typealias D = DayLabel
        struct Case {
            let id: Int
            let input: String
            let expectedKind: K
            let expectedHour: Int?
            let expectedHasEndHour: Bool?
            let expectedDay: D?
            let mustNotInventEndTime: Bool
            let isCritical: Bool
            let notes: String

            init(id: Int, input: String, expectedKind: K,
                 expectedHour: Int? = nil, expectedHasEndHour: Bool? = nil,
                 expectedDay: D? = nil,
                 mustNotInventEndTime: Bool = false, isCritical: Bool = false,
                 notes: String = "") {
                self.id = id
                self.input = input
                self.expectedKind = expectedKind
                self.expectedHour = expectedHour
                self.expectedHasEndHour = expectedHasEndHour
                self.expectedDay = expectedDay
                self.mustNotInventEndTime = mustNotInventEndTime
                self.isCritical = isCritical
                self.notes = notes
            }
        }

        var cases: [Case] = []
        // ── A: evento con hora de inicio sin término ─────────────────
        cases.append(Case(id: 1, input: "dentista hoy a las 4",
                 expectedKind: K.event, expectedHour: 16, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: true,
                 notes: "16:00 punto, NO 16:00–17:00"))
        cases.append(Case(id: 2, input: "mañana cumpleaños de Urrutia a las 6",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: true,
                 notes: "18:00 punto"))
        cases.append(Case(id: 3, input: "reunión con Juan a las 5",
                 expectedKind: K.event, expectedHour: 17, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: true,
                 notes: "17:00 punto"))
        cases.append(Case(id: 4, input: "prueba de historia el viernes a las 10",
                 expectedKind: K.event, expectedHour: 10, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "viernes 10:00 punto"))
        cases.append(Case(id: 5, input: "clase de teorías mañana a las 8",
                 expectedKind: K.event, expectedHour: 8, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "mañana 08:00 punto"))
        // ── B: rango horario explícito ───────────────────────────────
        cases.append(Case(id: 6, input: "reunión de 5 a 7",
                 expectedKind: K.event, expectedHour: 17, expectedHasEndHour: true,
                 expectedDay: D.today, mustNotInventEndTime: false, isCritical: true,
                 notes: "17:00–19:00 rango real"))
        cases.append(Case(id: 7, input: "clase a las 10 por dos horas",
                 expectedKind: K.event, expectedHour: 10, expectedHasEndHour: true,
                 mustNotInventEndTime: false, isCritical: true,
                 notes: "10:00–12:00 (día puede variar según heurística AM/PM)"))
        cases.append(Case(id: 8, input: "entreno de 6 a 8",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: true,
                 expectedDay: D.today, mustNotInventEndTime: false, isCritical: false,
                 notes: "18:00–20:00"))
        cases.append(Case(id: 9, input: "junta con mi grupo mañana de 3 a 4",
                 expectedKind: K.event, expectedHour: 15, expectedHasEndHour: true,
                 expectedDay: D.tomorrow, mustNotInventEndTime: false, isCritical: false,
                 notes: "mañana 15:00–16:00"))
        cases.append(Case(id: 10, input: "psiquiatra el jueves de 12 a 1",
                 expectedKind: K.event, expectedHour: 12, expectedHasEndHour: true,
                 isCritical: false,
                 notes: "jueves 12:00–13:00"))
        // ── C: sin hora → recordatorio/pendiente ─────────────────────
        cases.append(Case(id: 11, input: "fútbol hoy",
                 expectedKind: K.task, expectedDay: D.today, mustNotInventEndTime: true, isCritical: true,
                 notes: "tarea hoy, NO evento"))
        cases.append(Case(id: 12, input: "estudiar lenguaje mañana",
                 expectedKind: K.task, expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: true,
                 notes: "tarea mañana"))
        cases.append(Case(id: 13, input: "hacer trabajo de historia",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea sin fecha"))
        cases.append(Case(id: 14, input: "comprar pan",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea"))
        cases.append(Case(id: 15, input: "avisarle a mi profe que salí antes",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea"))
        cases.append(Case(id: 16, input: "mandarle mail a Juan Pablo hoy",
                 expectedKind: K.task, expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea hoy"))
        cases.append(Case(id: 17, input: "pagar la cuenta mañana",
                 expectedKind: K.task, expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea mañana"))
        cases.append(Case(id: 18, input: "llamar a mi mamá",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea"))
        cases.append(Case(id: 19, input: "ordenar mi pieza hoy",
                 expectedKind: K.task, expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea hoy"))
        cases.append(Case(id: 20, input: "subir el build de Focus",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea"))
        // ── D: preguntas → no crear nada ─────────────────────────────
        cases.append(Case(id: 21, input: "qué tengo hoy",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: true,
                 notes: "reviewToday, NO crear"))
        cases.append(Case(id: 22, input: "qué tengo mañana",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "review, NO crear"))
        cases.append(Case(id: 23, input: "qué me queda pendiente",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "reviewPending"))
        cases.append(Case(id: 24, input: "organizar mi día",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "organizeDay"))
        cases.append(Case(id: 25, input: "muéstrame mis pendientes de hoy",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "review"))
        // ── E: frases chilenas/ambiguas ──────────────────────────────
        cases.append(Case(id: 26, input: "mañana tipo 5 tengo que ir al doctor",
                 expectedKind: K.event, expectedHour: 17, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "tipo 5 = 17:00 aprox"))
        cases.append(Case(id: 27, input: "como a las 6 tengo cumpleaños",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "como a las 6 = 18:00"))
        cases.append(Case(id: 28, input: "hoy en la tarde estudiar para la prueba",
                 expectedKind: K.task, expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "franja sin hora exacta → tarea"))
        cases.append(Case(id: 29, input: "mañana en la mañana ir al banco",
                 expectedKind: K.task, expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "franja → tarea"))
        cases.append(Case(id: 30, input: "el viernes en la noche carrete",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "franja → tarea"))
        cases.append(Case(id: 31, input: "tengo prueba de comunicación el miércoles",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "día sin hora → tarea"))
        cases.append(Case(id: 32, input: "el lunes entregar portafolio",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "día sin hora → tarea"))
        cases.append(Case(id: 33, input: "mañana 8 gimnasio",
                 expectedKind: K.event, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "mañana evento (8 ó 20 según heurística AM/PM)"))
        cases.append(Case(id: 34, input: "a las 7 estudiar",
                 expectedKind: K.event, expectedHour: 19, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "7pm probable hoy"))
        cases.append(Case(id: 35, input: "hoy a las 9 terapia",
                 expectedKind: K.event, expectedHour: 21, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "hoy 21:00 (terapia ahora va a PM context per user spec 2026-05-27)"))
        // ── multicomandos (parseAll devuelve >1) ─────────────────────
        cases.append(Case(id: 36, input: "mañana a las 6 tengo cumpleaños de Urrutia y comprar regalo",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "1er intent: evento; idealmente +1 tarea regalo"))
        cases.append(Case(id: 37, input: "hoy estudiar lenguaje y mandar mail a Juan Pablo",
                 expectedKind: K.task, expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "tareas, no eventos"))
        cases.append(Case(id: 38, input: "mañana dentista a las 4 y después estudiar",
                 expectedKind: K.event, expectedHour: 16, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "evento + tarea"))
        cases.append(Case(id: 39, input: "reunión con grupo de 3 a 5 y después gym",
                 expectedKind: K.event, expectedHour: 15, expectedHasEndHour: true,
                 expectedDay: D.today, mustNotInventEndTime: false, isCritical: false,
                 notes: "rango real + tarea gym"))
        cases.append(Case(id: 40, input: "el jueves prueba a las 10 y entregar trabajo",
                 expectedKind: K.event, expectedHour: 10, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "evento + tarea"))
        // ── queries / edición ────────────────────────────────────────
        cases.append(Case(id: 41, input: "no tengo nada hoy?",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "consulta, NO crear"))
        cases.append(Case(id: 42, input: "borra el dentista de hoy",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "deleteEventByActivity"))
        cases.append(Case(id: 43, input: "cambia la reunión de las 5 a las 6",
                 expectedKind: K.other, mustNotInventEndTime: false, isCritical: false,
                 notes: "rescheduleByActivity"))
        // ── recordatorios explícitos ─────────────────────────────────
        cases.append(Case(id: 44, input: "recuerdame tomar agua a las 8",
                 expectedKind: K.reminder, expectedHour: 8, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: true,
                 notes: "reminder con hora puntual, NO evento 1h"))
        cases.append(Case(id: 45, input: "recuérdame llamar a mi papá mañana a las 11",
                 expectedKind: K.reminder, expectedHour: 11, expectedHasEndHour: false,
                 expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "reminder mañana 11:00"))
        cases.append(Case(id: 46, input: "pon una alarma para estudiar a las 7",
                 expectedKind: K.reminder, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "reminder con hora (7 ó 19 según heurística AM/PM, NO evento 1h)"))
        // ── preparación / sin hora ───────────────────────────────────
        cases.append(Case(id: 47, input: "necesito preparar la prueba del lunes",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea"))
        cases.append(Case(id: 48, input: "tengo que salir antes de teoría de comunicación",
                 expectedKind: K.task, mustNotInventEndTime: true, isCritical: false,
                 notes: "tarea sin hora"))
        cases.append(Case(id: 49, input: "mañana tengo clases",
                 expectedKind: K.task, expectedDay: D.tomorrow, mustNotInventEndTime: true, isCritical: false,
                 notes: "día sin hora → tarea o clarify"))
        cases.append(Case(id: 50, input: "agenda almuerzo con mi papá mañana",
                 expectedKind: K.clarify, mustNotInventEndTime: true, isCritical: false,
                 notes: "activo 'agenda' + día sin hora → pregunta hora (PendingClarification)"))
        // ── F: recurrencia (sanity check 2026-05-26) ─────────────────
        cases.append(Case(id: 51, input: "todos los martes a las 8 am tengo clases de matemática",
                 expectedKind: K.event, expectedHour: 8, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "evento recurrente martes 08:00 — verifica recurrencia weeklyOn"))
        cases.append(Case(id: 52, input: "todos los lunes a las 6 reunión con el equipo",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "evento recurrente lunes 18:00 (AM/PM: 6pm noche)"))
        cases.append(Case(id: 53, input: "todos los días a las 7 meditación",
                 expectedKind: K.event, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "evento daily (7 ó 19 según heurística AM/PM)"))
        cases.append(Case(id: 54, input: "miércoles y viernes a las 6 entreno",
                 expectedKind: K.event, expectedHour: 18, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "multiWeekday miércoles+viernes 18:00"))
        // Caso real reportado por usuario 2026-05-26
        cases.append(Case(id: 55, input: "acuerdame que para todos los lunes a las 10 tengo clases de matematica",
                 expectedKind: K.reminder, expectedHour: 10, expectedHasEndHour: false,
                 mustNotInventEndTime: true, isCritical: false,
                 notes: "evento recurrente lunes 10 con acuérdame — debe expandir todas las semanas, no solo 1"))
        // Casos del bug Mi Día reportado 2026-05-27: hora sin fecha → hoy, no preguntar
        cases.append(Case(id: 56, input: "reunión de mindfulness con cristina a las 5",
                 expectedKind: K.event, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: true,
                 notes: "Mi Día: hora 5 sin fecha → HOY 17:00, no preguntar"))
        cases.append(Case(id: 57, input: "reunión con cristina a las 5",
                 expectedKind: K.event, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "hora sin fecha → hoy"))
        cases.append(Case(id: 58, input: "recuérdame llamar a cristina a las 5",
                 expectedKind: K.reminder, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "reminder hora sin fecha → hoy"))
        cases.append(Case(id: 59, input: "tengo que salir al cumpleaños de Urrutia a las 8",
                 expectedKind: K.event, expectedHasEndHour: false,
                 expectedDay: D.today, mustNotInventEndTime: true, isCritical: false,
                 notes: "título debe ser Cumpleaños Urrutia, no Salir; hoy"))
        var out = "===== NOVA 50-CASE VALIDATION =====\n"
        out += "Fecha: \(Date())\n\n"
        var passCount = 0
        var failCount = 0
        var criticalFails: [Int] = []
        var rows: [String] = []

        for c in cases {
            let actions = runPipeline(c.input)
            let first = actions.first
            var problems: [String] = []
            let actualKind = first?.kind ?? .other
            let actualHour = first?.hour
            let actualEndHour = first?.endHour
            let actualDay = first?.day ?? .none

            // 1) kind
            if actualKind != c.expectedKind {
                problems.append("kind=\(actualKind) (esperado \(c.expectedKind))")
            }
            // 2) hour
            if let eh = c.expectedHour {
                if actualHour != eh {
                    problems.append("hour=\(String(describing: actualHour)) (esperado \(eh))")
                }
            }
            // 3) endHour: si mustNotInventEndTime → endHour debe ser nil
            if c.mustNotInventEndTime, actualEndHour != nil {
                problems.append("endHour=\(actualEndHour!) (esperado nil, NO inventar)")
            }
            // 4) endHour visible cuando se espera (rango real)
            if let hasEnd = c.expectedHasEndHour {
                let actualHasEnd = (actualEndHour != nil)
                if actualHasEnd != hasEnd {
                    problems.append("hasEndHour=\(actualHasEnd) (esperado \(hasEnd))")
                }
            }
            // 5) day si se especifica
            if let ed = c.expectedDay, actualDay != ed {
                problems.append("day=\(actualDay) (esperado \(ed))")
            }

            let pass = problems.isEmpty
            if pass {
                passCount += 1
                rows.append(String(format: "  %2d ✓ PASS | %@ → %@ title=%@ h=%@ end=%@ day=%@",
                                   c.id, c.input,
                                   String(describing: actualKind),
                                   first?.title ?? "",
                                   String(describing: actualHour),
                                   String(describing: actualEndHour),
                                   String(describing: actualDay)))
            } else {
                failCount += 1
                if c.isCritical { criticalFails.append(c.id) }
                rows.append(String(format: "  %2d ✗ FAIL%@ | %@ → %@ — %@",
                                   c.id,
                                   c.isCritical ? "🔴" : "",
                                   c.input,
                                   String(describing: actualKind),
                                   problems.joined(separator: "; ")))
            }
        }

        out += "RESULTADO: \(passCount)/\(cases.count) PASS  (\(failCount) FAIL)\n"
        if !criticalFails.isEmpty {
            out += "🔴 CRITICAL FAILS: \(criticalFails.map(String.init).joined(separator: ", "))\n"
            out += "    → NO LISTO para TestFlight (criterio: 0 críticos)\n"
        } else if passCount >= 45 {
            out += "✅ LISTO para TestFlight (≥45/50 sin críticos)\n"
        } else {
            out += "⚠️  NO LISTO (<45/50)\n"
        }
        out += "\n--- DETALLE POR CASO ---\n"
        out += rows.joined(separator: "\n")
        out += "\n===== END =====\n"
        return out
    }

    // MARK: - 50-case validation SUBTITLE / detail extraction (2026-05-27)

    /// Suite de 50 frases reales del user spec del 2026-05-27. Cada caso
    /// chequea que Nova:
    ///   - extrae correctamente el evento principal (kind, hora, día);
    ///   - conserva el detalle/subtítulo como `subtitle` (NO lo pierde
    ///     ni lo mete en el título);
    ///   - normaliza "Cumpleaños de Person" → "Cumpleaños Person";
    ///   - no convierte un evento con hora en recordatorio genérico.
    ///
    /// Cómo correr: setear `FOCUS_RUN_TESTS=subtitle50` (o agregar el arg
    /// `--run-subtitle-50` al scheme) y lanzar la app. Resultado se
    /// imprime y se guarda en `Documents/focus-validation-subtitle50.log`.
    /// Suite final de aceptación para beta — 50 peticiones reales (fáciles,
    /// difíciles, ambiguas, habladas/coloquiales, multi-intent). Es el gate:
    /// debe pasar 50/50 antes de cerrar beta. Canónico decidido 2026-06-01:
    /// - Conservar posesivos ("buscar a mi hermano", "almuerzo con mi papá").
    /// - "cumpleaños de Persona" → "Cumpleaños Persona" (drop "de").
    /// - "clase de X" / "prueba de X" → conservar "de".
    /// - Preparativos/contexto trailing → subtítulo, no tarea.
    /// Flag: `--run-50-final` o `FOCUS_RUN_TESTS=final50`.
    @discardableResult
    static func runValidation50FinalCases() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        typealias K = ParsedKind
        typealias D = DayLabel
        struct Case {
            let id: Int
            let input: String
            let expectedKind: K
            let expectedTitleLower: String?
            let expectedSubtitlePrefix: String?
            let expectedHour: Int?
            let expectedDay: D?
            let expectedCount: Int?
            let notes: String
            init(id: Int, input: String, expectedKind: K, expectedTitleLower: String?,
                 expectedSubtitlePrefix: String?, expectedHour: Int? = nil,
                 expectedDay: D? = nil, expectedCount: Int? = nil, notes: String = "") {
                self.id = id; self.input = input; self.expectedKind = expectedKind
                self.expectedTitleLower = expectedTitleLower
                self.expectedSubtitlePrefix = expectedSubtitlePrefix
                self.expectedHour = expectedHour; self.expectedDay = expectedDay
                self.expectedCount = expectedCount; self.notes = notes
            }
        }
        var cases: [Case] = []
        // ── 1-8: FÁCILES (evento simple, sin subtítulo) ──────────────
        cases.append(Case(id: 1, input: "dentista a las 4", expectedKind: K.event, expectedTitleLower: "dentista", expectedSubtitlePrefix: "", expectedHour: 16, expectedDay: D.today))
        cases.append(Case(id: 2, input: "reunión con Juan a las 3", expectedKind: K.event, expectedTitleLower: "reunión con juan", expectedSubtitlePrefix: "", expectedHour: 15, expectedDay: D.today))
        cases.append(Case(id: 3, input: "gimnasio a las 7 de la mañana", expectedKind: K.event, expectedTitleLower: "gimnasio", expectedSubtitlePrefix: "", expectedHour: 7, expectedDay: D.tomorrow, notes: "7am ya pasó hoy → mañana"))
        cases.append(Case(id: 4, input: "almuerzo a la 1", expectedKind: K.event, expectedTitleLower: "almuerzo", expectedSubtitlePrefix: "", expectedHour: 13, expectedDay: D.today))
        // 2026-06-13: "clase de X" ahora separa tema → "Clase" + sub "Historia"
        // (canónico del spec; antes quedaba "Clase de Historia" en el título).
        cases.append(Case(id: 5, input: "clase de historia a las 10", expectedKind: K.event, expectedTitleLower: "clase", expectedSubtitlePrefix: "Historia", expectedHour: 10, expectedDay: D.today))
        cases.append(Case(id: 6, input: "cita médica el jueves a las 9 de la mañana", expectedKind: K.event, expectedTitleLower: "cita médica", expectedSubtitlePrefix: "", expectedHour: 9, notes: "valida fix 'de la mañana' residual"))
        cases.append(Case(id: 7, input: "café con Sofía a las 6", expectedKind: K.event, expectedTitleLower: "café con sofía", expectedSubtitlePrefix: "", expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 8, input: "partido el sábado a las 5", expectedKind: K.event, expectedTitleLower: "partido", expectedSubtitlePrefix: "", expectedHour: 17))
        // ── 9-16: PREP / SUBTÍTULO ───────────────────────────────────
        cases.append(Case(id: 9, input: "fútbol a las 5 llevar la pelota", expectedKind: K.event, expectedTitleLower: "fútbol", expectedSubtitlePrefix: "llevar la pelota", expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 10, input: "partido a las 7 llevar botines", expectedKind: K.event, expectedTitleLower: "partido", expectedSubtitlePrefix: "llevar botines", expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 11, input: "reunión de marketing a las 4", expectedKind: K.event, expectedTitleLower: "reunión", expectedSubtitlePrefix: "marketing", expectedHour: 16, expectedDay: D.today))
        cases.append(Case(id: 12, input: "prueba de historia el lunes a las 11 estudiar antes", expectedKind: K.event, expectedTitleLower: "prueba de historia", expectedSubtitlePrefix: "estudiar antes", expectedHour: 11))
        cases.append(Case(id: 13, input: "entrenamiento a las 6 llevar agua y toalla", expectedKind: K.event, expectedTitleLower: "entrenamiento", expectedSubtitlePrefix: "llevar agua y toalla", expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 14, input: "clase de redacción a las 12 imprimir pauta", expectedKind: K.event, expectedTitleLower: "clase de redacción", expectedSubtitlePrefix: "imprimir pauta", expectedHour: 12, expectedDay: D.today))
        cases.append(Case(id: 15, input: "cumpleaños de Urrutia a las 9 comprar regalo", expectedKind: K.event, expectedTitleLower: "cumpleaños urrutia", expectedSubtitlePrefix: "comprar regalo", expectedHour: 21, expectedDay: D.today))
        cases.append(Case(id: 16, input: "estudiar a las 8 de la noche llevar apuntes", expectedKind: K.event, expectedTitleLower: "estudiar", expectedSubtitlePrefix: "llevar apuntes", expectedHour: 20, expectedDay: D.today))
        // ── 17-21: POSESIVOS (conservar "mi") ────────────────────────
        cases.append(Case(id: 17, input: "buscar a mi hermano a las 4", expectedKind: K.event, expectedTitleLower: "buscar a mi hermano", expectedSubtitlePrefix: "", expectedHour: 16, expectedDay: D.today, notes: "conservar mi"))
        cases.append(Case(id: 18, input: "almuerzo con mi papá a la 1 hablar del proyecto", expectedKind: K.event, expectedTitleLower: "almuerzo con mi papá", expectedSubtitlePrefix: "hablar del proyecto", expectedHour: 13, expectedDay: D.today, notes: "conservar mi"))
        cases.append(Case(id: 19, input: "ir a buscar a mi polola tipo 6", expectedKind: K.event, expectedTitleLower: "buscar a mi polola", expectedSubtitlePrefix: "", expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 20, input: "pasar por mi abuela a las 5", expectedKind: K.event, expectedTitleLower: "pasar por mi abuela", expectedSubtitlePrefix: "", expectedHour: 17, expectedDay: D.today, notes: "conservar mi"))
        cases.append(Case(id: 21, input: "comida con mi mamá a las 8 llevar postre", expectedKind: K.event, expectedTitleLower: "comida con mi mamá", expectedSubtitlePrefix: "llevar postre", expectedHour: 20, expectedDay: D.today, notes: "conservar mi"))
        // ── 22-27: MULTI-INTENT ──────────────────────────────────────
        cases.append(Case(id: 22, input: "dentista a las 4 y comprar remedios a las 5", expectedKind: K.event, expectedTitleLower: "dentista", expectedSubtitlePrefix: "", expectedHour: 16, expectedDay: D.today, expectedCount: 2))
        cases.append(Case(id: 23, input: "fútbol a las 5 y volver a las 7", expectedKind: K.event, expectedTitleLower: "fútbol", expectedSubtitlePrefix: "", expectedHour: 17, expectedDay: D.today, expectedCount: 2))
        cases.append(Case(id: 24, input: "tengo dentista el viernes a las 4 y después comprar remedios", expectedKind: K.event, expectedTitleLower: "dentista", expectedSubtitlePrefix: "", expectedHour: 16, expectedCount: 2, notes: "casoG: 'y después', primer evento con hora no debe volverse clarify"))
        cases.append(Case(id: 25, input: "gym a las 7 de la mañana y reunión a las 9", expectedKind: K.event, expectedTitleLower: "gym", expectedSubtitlePrefix: "", expectedHour: 7, expectedDay: D.tomorrow, expectedCount: 2))
        cases.append(Case(id: 26, input: "comprar pan y leche", expectedKind: K.task, expectedTitleLower: nil, expectedSubtitlePrefix: nil, expectedCount: 1, notes: "no splitear lista de compras"))
        cases.append(Case(id: 27, input: "estudiar a las 3 y salir a correr a las 6", expectedKind: K.event, expectedTitleLower: "estudiar", expectedSubtitlePrefix: "", expectedHour: 15, expectedDay: D.today, expectedCount: 2))
        // ── 28-31: AMBIGUO → CLARIFY ─────────────────────────────────
        cases.append(Case(id: 28, input: "mañana tengo cumpleaños de Urrutia", expectedKind: K.clarify, expectedTitleLower: nil, expectedSubtitlePrefix: nil, notes: "social sin hora → preguntar"))
        cases.append(Case(id: 29, input: "el lunes gimnasio a las 6 de la tarde", expectedKind: K.event, expectedTitleLower: "gimnasio", expectedSubtitlePrefix: "", expectedHour: 18))
        cases.append(Case(id: 30, input: "agenda una reunión algún día con cristina", expectedKind: K.clarify, expectedTitleLower: nil, expectedSubtitlePrefix: nil, notes: "día vago → preguntar"))
        cases.append(Case(id: 31, input: "comprar regalo para la fiesta", expectedKind: K.task, expectedTitleLower: "comprar regalo para la fiesta", expectedSubtitlePrefix: nil, notes: "over-cap: 'para la fiesta' no debe volverse 'para Fiesta'"))
        // ── 32-40: HABLADO / COLOQUIAL ───────────────────────────────
        cases.append(Case(id: 32, input: "oye porfa agéndame gym mañana a las 6 de la tarde", expectedKind: K.event, expectedTitleLower: "gym", expectedSubtitlePrefix: "", expectedHour: 18, expectedDay: D.tomorrow))
        cases.append(Case(id: 33, input: "tengo q jugar counter a la 1 más o menos", expectedKind: K.event, expectedTitleLower: "jugar counter", expectedSubtitlePrefix: "", expectedHour: 13, expectedDay: D.today))
        cases.append(Case(id: 34, input: "dale ponme una reunión con el equipo a las 4", expectedKind: K.event, expectedTitleLower: "reunión con el equipo", expectedSubtitlePrefix: "", expectedHour: 16, expectedDay: D.today, notes: "over-cap: 'con el equipo' no debe volverse 'con Equipo'"))
        cases.append(Case(id: 35, input: "necesito ir al banco tipo 3", expectedKind: K.event, expectedTitleLower: "banco", expectedSubtitlePrefix: "", expectedHour: 15, expectedDay: D.today, notes: "parser limpia 'ir al' → Banco"))
        cases.append(Case(id: 36, input: "tengo una reunión de mindfulness a las 5 con cristina", expectedKind: K.event, expectedTitleLower: "reunión", expectedSubtitlePrefix: "mindfulness con cristina", expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 37, input: "mañana gym a las 7 de la mañana", expectedKind: K.event, expectedTitleLower: "gym", expectedSubtitlePrefix: "", expectedHour: 7, expectedDay: D.tomorrow))
        cases.append(Case(id: 38, input: "acuérdame comprar pan a las 6", expectedKind: K.reminder, expectedTitleLower: "comprar pan", expectedSubtitlePrefix: nil, expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 39, input: "recuérdame llamar al dentista mañana a las 10", expectedKind: K.reminder, expectedTitleLower: "llamar al dentista", expectedSubtitlePrefix: nil, expectedHour: 10, expectedDay: D.tomorrow))
        cases.append(Case(id: 40, input: "tengo entrenamiento a las 7 de la tarde llevar canilleras", expectedKind: K.event, expectedTitleLower: "entrenamiento", expectedSubtitlePrefix: "llevar canilleras", expectedHour: 19, expectedDay: D.today))
        // ── 41-45: RECURRENTE / DÍAS ─────────────────────────────────
        cases.append(Case(id: 41, input: "todos los lunes gimnasio a las 7 de la mañana", expectedKind: K.event, expectedTitleLower: "gimnasio", expectedSubtitlePrefix: "", expectedHour: 7))
        cases.append(Case(id: 42, input: "gym de lunes a viernes a las 8 de la mañana", expectedKind: K.event, expectedTitleLower: "gym", expectedSubtitlePrefix: "", expectedHour: 8))
        cases.append(Case(id: 43, input: "el miércoles reunión a las 10 revisar números", expectedKind: K.event, expectedTitleLower: "reunión", expectedSubtitlePrefix: "revisar números", expectedHour: 10))
        cases.append(Case(id: 44, input: "supermercado a las 7 comprar leche", expectedKind: K.event, expectedTitleLower: "supermercado", expectedSubtitlePrefix: "comprar leche", expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 45, input: "banco a las 12 llevar carnet", expectedKind: K.event, expectedTitleLower: "banco", expectedSubtitlePrefix: "llevar carnet", expectedHour: 12, expectedDay: D.today))
        // ── 46-50: QUERIES / EDICIÓN / TAREAS ────────────────────────
        cases.append(Case(id: 46, input: "qué tengo hoy", expectedKind: K.other, expectedTitleLower: nil, expectedSubtitlePrefix: nil, notes: "review, no crear"))
        cases.append(Case(id: 47, input: "borra el dentista", expectedKind: K.other, expectedTitleLower: nil, expectedSubtitlePrefix: nil, notes: "delete, no crear"))
        cases.append(Case(id: 48, input: "cambia fútbol a las 6", expectedKind: K.other, expectedTitleLower: nil, expectedSubtitlePrefix: nil, notes: "reschedule, no duplicar"))
        cases.append(Case(id: 49, input: "comprar pan", expectedKind: K.task, expectedTitleLower: "comprar pan", expectedSubtitlePrefix: nil, notes: "sin hora → tarea"))
        cases.append(Case(id: 50, input: "tengo que pagar la cuenta de la luz", expectedKind: K.task, expectedTitleLower: "pagar la cuenta de la luz", expectedSubtitlePrefix: nil, notes: "over-cap: 'de la luz' no debe volverse 'de Luz'"))

        var out = "===== NOVA 50-FINAL VALIDATION (beta gate \(Date())) =====\n\n"
        var passCount = 0
        var failCount = 0
        var failedIds: [Int] = []
        var rows: [String] = []
        for c in cases {
            let actions = runPipeline(c.input)
            let first = actions.first
            var problems: [String] = []
            let actualKind = first?.kind ?? .other
            let actualTitle = first?.title ?? ""
            let actualSubtitle = first?.subtitle ?? ""
            let actualHour = first?.hour
            let actualDay = first?.day ?? .none
            if actualKind != c.expectedKind {
                problems.append("kind=\(actualKind) (esp \(c.expectedKind))")
            }
            if let et = c.expectedTitleLower, actualTitle.lowercased() != et {
                problems.append("title=\"\(actualTitle)\" (esp \"\(et)\")")
            }
            if let es = c.expectedSubtitlePrefix {
                if es.isEmpty {
                    if !actualSubtitle.isEmpty { problems.append("subtitle=\"\(actualSubtitle)\" (esp vacío)") }
                } else if !actualSubtitle.lowercased().contains(es.lowercased()) {
                    problems.append("subtitle=\"\(actualSubtitle)\" (esp contiene \"\(es)\")")
                }
            }
            if let eh = c.expectedHour, actualHour != eh {
                problems.append("hour=\(String(describing: actualHour)) (esp \(eh))")
            }
            if let ed = c.expectedDay, actualDay != ed {
                problems.append("day=\(actualDay) (esp \(ed))")
            }
            if let ec = c.expectedCount, actions.count != ec {
                problems.append("count=\(actions.count) (esp \(ec))")
            }
            let pass = problems.isEmpty
            if pass { passCount += 1 } else { failCount += 1; failedIds.append(c.id) }
            let mark = pass ? "✓ PASS" : "✗ FAIL"
            let allActions = actions.count > 1
                ? "  [" + actions.map { "\($0.kind):\($0.title.isEmpty ? "∅" : $0.title)@h\(String(describing: $0.hour))" }.joined(separator: " | ") + "]"
                : ""
            rows.append(String(format: "%3d %@ | \"%@\" → kind=%@ title=\"%@\" sub=\"%@\" h=%@ day=%@ n=%d%@%@",
                               c.id, mark, c.input, "\(actualKind)", actualTitle, actualSubtitle,
                               String(describing: actualHour), "\(actualDay)", actions.count,
                               allActions,
                               problems.isEmpty ? "" : "  ⟵ " + problems.joined(separator: "; ")))
        }
        out += "RESULTADO: \(passCount)/\(cases.count) PASS  (\(failCount) FAIL)\n"
        if failCount > 0 { out += "FALLIDOS: \(failedIds.map(String.init).joined(separator: ", "))\n" }
        out += "\n--- DETALLE ---\n" + rows.joined(separator: "\n") + "\n===== END =====\n"
        return out
    }

    @discardableResult
    static func runValidationSubtitle50Cases() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        typealias K = ParsedKind
        typealias D = DayLabel
        struct Case {
            let id: Int
            let input: String
            let expectedKind: K
            /// Si != nil, comprueba que el título coincida exactamente
            /// (case-insensitive). Si nil, no se chequea el título.
            let expectedTitleLower: String?
            /// Si != nil, comprueba que `subtitle` esté presente y empiece
            /// con este texto (case-insensitive). Si nil, no se chequea.
            /// Si == "" (vacío), comprueba que `subtitle` sea nil/vacío.
            let expectedSubtitlePrefix: String?
            let expectedHour: Int?
            let expectedDay: D?
            let notes: String

            init(id: Int, input: String, expectedKind: K,
                 expectedTitleLower: String?,
                 expectedSubtitlePrefix: String?,
                 expectedHour: Int? = nil,
                 expectedDay: D? = nil,
                 notes: String = "") {
                self.id = id
                self.input = input
                self.expectedKind = expectedKind
                self.expectedTitleLower = expectedTitleLower
                self.expectedSubtitlePrefix = expectedSubtitlePrefix
                self.expectedHour = expectedHour
                self.expectedDay = expectedDay
                self.notes = notes
            }
        }

        var cases: [Case] = []
        // ── 1-5: futbol/deporte con detail "llevar X" ────────────────
        cases.append(Case(id: 1,
            input: "futbol a las 5 acordarme de llevar la pelota",
            expectedKind: K.event,
            expectedTitleLower: "futbol",
            expectedSubtitlePrefix: "llevar la pelota",
            expectedHour: 17, expectedDay: D.today,
            notes: "MAIN BUG: detail Llevar la pelota"))
        cases.append(Case(id: 2,
            input: "fútbol a las 5 llevar la pelota",
            expectedKind: K.event,
            expectedTitleLower: "fútbol",
            expectedSubtitlePrefix: "llevar la pelota",
            expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 3,
            input: "partido a las 7 llevar botines",
            expectedKind: K.event,
            expectedTitleLower: "partido",
            expectedSubtitlePrefix: "llevar botines",
            expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 4,
            input: "entrenamiento a las 6 llevar agua",
            expectedKind: K.event,
            expectedTitleLower: "entrenamiento",
            expectedSubtitlePrefix: "llevar agua",
            expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 5,
            input: "gimnasio a las 8 llevar audífonos",
            expectedKind: K.event,
            expectedTitleLower: "gimnasio",
            expectedSubtitlePrefix: "llevar audífonos",
            expectedDay: D.today,
            notes: "hour 8 o 20 según AM/PM"))
        // ── 6-10: reunión / llamada con persona y/o tópico ───────────
        cases.append(Case(id: 6,
            input: "reunión de mindfulness con cristina a las 5",
            expectedKind: K.event,
            expectedTitleLower: "reunión",
            expectedSubtitlePrefix: "mindfulness con cristina",
            expectedHour: 17, expectedDay: D.today,
            notes: "split reunión + subtítulo Mindfulness con Cristina"))
        cases.append(Case(id: 7,
            input: "mindfulness con cristina a las 5",
            expectedKind: K.event,
            expectedTitleLower: "mindfulness con cristina",
            expectedSubtitlePrefix: "",
            expectedHour: 17, expectedDay: D.today,
            notes: "sin subtítulo"))
        cases.append(Case(id: 8,
            input: "reunión con cristina a las 5",
            expectedKind: K.event,
            expectedTitleLower: "reunión con cristina",
            expectedSubtitlePrefix: "",
            expectedHour: 17, expectedDay: D.today,
            notes: "NO debe splitear con"))
        cases.append(Case(id: 9,
            input: "llamada con cristina a las 5 hablar de mindfulness",
            expectedKind: K.event,
            expectedTitleLower: "llamada con cristina",
            expectedSubtitlePrefix: "hablar de mindfulness",
            expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 10,
            input: "llamar a cristina a las 5 por el tema mindfulness",
            expectedKind: K.event,
            expectedTitleLower: "llamar a cristina",
            expectedSubtitlePrefix: "tema mindfulness",
            expectedHour: 17, expectedDay: D.today,
            notes: "por el tema → Tema mindfulness"))
        // ── 11-15: cumpleaños / fiesta ───────────────────────────────
        cases.append(Case(id: 11,
            input: "cumpleaños de Urrutia a las 8 comprar regalo",
            expectedKind: K.event,
            expectedTitleLower: "cumpleaños urrutia",
            expectedSubtitlePrefix: "comprar regalo",
            expectedHour: 20, expectedDay: D.today,
            notes: "drop 'de' en cumpleaños de Person"))
        cases.append(Case(id: 12,
            input: "salir al cumpleaños de Urrutia a las 8",
            expectedKind: K.event,
            expectedTitleLower: "cumpleaños urrutia",
            expectedSubtitlePrefix: "",
            expectedHour: 20, expectedDay: D.today,
            notes: "strip 'salir al' + drop 'de'"))
        cases.append(Case(id: 13,
            input: "cumple de la Cata a las 9 llevar copete",
            expectedKind: K.event,
            expectedTitleLower: "cumple cata",
            expectedSubtitlePrefix: "llevar copete",
            expectedHour: 21, expectedDay: D.today,
            notes: "drop 'de la' + capitalize Cata"))
        cases.append(Case(id: 14,
            input: "asado donde Juan a las 7 llevar bebidas",
            expectedKind: K.event,
            expectedTitleLower: "asado donde juan",
            expectedSubtitlePrefix: "llevar bebidas",
            expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 15,
            input: "junta con los cabros a las 6 llevar cartas",
            expectedKind: K.event,
            expectedTitleLower: "junta con los cabros",
            expectedSubtitlePrefix: "llevar cartas",
            expectedHour: 18, expectedDay: D.today))
        // ── 16-20: clase / prueba / entrega ──────────────────────────
        cases.append(Case(id: 16,
            input: "clase de contenidos digitales a las 10 llevar computador",
            expectedKind: K.event,
            expectedTitleLower: "clase de contenidos digitales",
            expectedSubtitlePrefix: "llevar computador",
            expectedHour: 10, expectedDay: D.today,
            notes: "clase de X NO splitea"))
        cases.append(Case(id: 17,
            input: "clase de redacción a las 12 imprimir pauta",
            expectedKind: K.event,
            expectedTitleLower: "clase de redacción",
            expectedSubtitlePrefix: "imprimir pauta",
            expectedHour: 12, expectedDay: D.today))
        cases.append(Case(id: 18,
            input: "prueba de teorías a las 3 estudiar antes",
            expectedKind: K.event,
            expectedTitleLower: "prueba de teorías",
            expectedSubtitlePrefix: "estudiar antes",
            expectedHour: 15, expectedDay: D.today))
        cases.append(Case(id: 19,
            input: "entrega de portafolio a las 11 revisar ortografía",
            expectedKind: K.event,
            expectedTitleLower: "entrega de portafolio",
            expectedSubtitlePrefix: "revisar ortografía",
            expectedHour: 11, expectedDay: D.today))
        cases.append(Case(id: 20,
            input: "reunión con Juan Pablo a las 4 llevar certificado",
            expectedKind: K.event,
            expectedTitleLower: "reunión con juan pablo",
            expectedSubtitlePrefix: "llevar certificado",
            expectedHour: 16, expectedDay: D.today))
        // ── 21-25: salud / personal ──────────────────────────────────
        cases.append(Case(id: 21,
            input: "psiquiatra a las 5 pedir certificado",
            expectedKind: K.event,
            expectedTitleLower: "psiquiatra",
            expectedSubtitlePrefix: "pedir certificado",
            expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 22,
            input: "terapia a las 6 hablar de la universidad",
            expectedKind: K.event,
            expectedTitleLower: "terapia",
            expectedSubtitlePrefix: "hablar de la universidad",
            expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 23,
            input: "dentista a las 9 llevar radiografía",
            expectedKind: K.event,
            expectedTitleLower: "dentista",
            expectedSubtitlePrefix: "llevar radiografía",
            expectedHour: 9, expectedDay: D.today))
        cases.append(Case(id: 24,
            input: "doctor a las 8 no olvidar exámenes",
            expectedKind: K.event,
            expectedTitleLower: "doctor",
            expectedSubtitlePrefix: "no olvidar exámenes",
            expectedDay: D.today,
            notes: "hour 8 o 20"))
        cases.append(Case(id: 25,
            input: "almuerzo con mi papá a las 2 hablar del proyecto",
            expectedKind: K.event,
            expectedTitleLower: "almuerzo con mi papá",
            expectedSubtitlePrefix: "hablar del proyecto",
            expectedHour: 14, expectedDay: D.today,
            notes: "conserva 'mi' + subtitle Hablar del proyecto"))
        // ── 26-30: comidas / sociales / trabajo ──────────────────────
        cases.append(Case(id: 26,
            input: "comida con mi mamá a las 8 llevar postre",
            expectedKind: K.event,
            expectedTitleLower: "comida con mi mamá",
            expectedSubtitlePrefix: "llevar postre",
            expectedHour: 20, expectedDay: D.today))
        cases.append(Case(id: 27,
            input: "café con la Cata a las 5 llevar libro",
            expectedKind: K.event,
            expectedTitleLower: "café con cata",
            expectedSubtitlePrefix: "llevar libro",
            expectedHour: 17, expectedDay: D.today))
        cases.append(Case(id: 28,
            input: "reunión Focus a las 6 revisar bugs",
            expectedKind: K.event,
            expectedTitleLower: "reunión focus",
            expectedSubtitlePrefix: "revisar bugs",
            expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 29,
            input: "trabajar en Nova a las 7 arreglar subtítulos",
            expectedKind: K.event,
            expectedTitleLower: "trabajar en nova",
            expectedSubtitlePrefix: "arreglar subtítulos",
            expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 30,
            input: "llamada con Claude a las 4 revisar TestFlight",
            expectedKind: K.event,
            expectedTitleLower: "llamada con claude",
            expectedSubtitlePrefix: "revisar testflight",
            expectedHour: 16, expectedDay: D.today))
        // ── 31-36: con día diferente (mañana / día semana) ───────────
        cases.append(Case(id: 31,
            input: "mañana fútbol a las 5 llevar pelota",
            expectedKind: K.event,
            expectedTitleLower: "fútbol",
            expectedSubtitlePrefix: "llevar pelota",
            expectedHour: 17, expectedDay: D.tomorrow))
        cases.append(Case(id: 32,
            input: "mañana reunión con cristina a las 5 hablar de mindfulness",
            expectedKind: K.event,
            expectedTitleLower: "reunión con cristina",
            expectedSubtitlePrefix: "hablar de mindfulness",
            expectedHour: 17, expectedDay: D.tomorrow))
        cases.append(Case(id: 33,
            input: "mañana cumpleaños de Urrutia a las 8 comprar regalo",
            expectedKind: K.event,
            expectedTitleLower: "cumpleaños urrutia",
            expectedSubtitlePrefix: "comprar regalo",
            expectedHour: 20, expectedDay: D.tomorrow))
        cases.append(Case(id: 34,
            input: "el viernes partido a las 7 llevar botines",
            expectedKind: K.event,
            expectedTitleLower: "partido",
            expectedSubtitlePrefix: "llevar botines",
            expectedHour: 19,
            notes: "próximo viernes"))
        cases.append(Case(id: 35,
            input: "el lunes clase a las 10 llevar computador",
            expectedKind: K.event,
            expectedTitleLower: "clase",
            expectedSubtitlePrefix: "llevar computador",
            expectedHour: 10,
            notes: "próximo lunes"))
        cases.append(Case(id: 36,
            input: "el sábado asado a las 8 llevar bebidas",
            expectedKind: K.event,
            expectedTitleLower: "asado",
            expectedSubtitlePrefix: "llevar bebidas",
            expectedHour: 20,
            notes: "próximo sábado"))
        // ── 37-42: recordatorios explícitos / verbos puntuales ──────
        cases.append(Case(id: 37,
            input: "recuérdame a las 5 llevar la pelota",
            expectedKind: K.reminder,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            expectedHour: 17, expectedDay: D.today,
            notes: "reminder Llevar la pelota — title libre"))
        cases.append(Case(id: 38,
            input: "recuérdame comprar regalo a las 6",
            expectedKind: K.reminder,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            expectedHour: 18, expectedDay: D.today))
        cases.append(Case(id: 39,
            input: "acuérdame llamar a mi mamá a las 7",
            expectedKind: K.reminder,
            expectedTitleLower: "llamar a mi mamá",
            expectedSubtitlePrefix: nil,
            expectedHour: 19, expectedDay: D.today,
            notes: "conserva 'mi' antes de mamá"))
        cases.append(Case(id: 40,
            input: "recordarme mandar mail a Juan Pablo a las 4",
            expectedKind: K.reminder,
            expectedTitleLower: "mandar mail a juan pablo",
            expectedSubtitlePrefix: nil,
            expectedHour: 16, expectedDay: D.today))
        cases.append(Case(id: 41,
            input: "tengo que pagar la cuenta a las 8",
            expectedKind: K.reminder,
            expectedTitleLower: "pagar la cuenta",
            expectedSubtitlePrefix: nil,
            notes: "user spec dice 'Recordatorio Pagar la cuenta'"))
        cases.append(Case(id: 42,
            input: "comprar remedios a las 5",
            expectedKind: K.event,
            expectedTitleLower: "comprar remedios",
            expectedSubtitlePrefix: nil,
            expectedHour: 17, expectedDay: D.today,
            notes: "comprar es el título (no detail) cuando va al inicio"))
        // ── 43-45: lugares con detail ────────────────────────────────
        cases.append(Case(id: 43,
            input: "ir a la farmacia a las 6 comprar remedios",
            expectedKind: K.event,
            expectedTitleLower: "farmacia",
            expectedSubtitlePrefix: "comprar remedios",
            expectedHour: 18, expectedDay: D.today,
            notes: "strip 'ir a la' + subtitle Comprar remedios"))
        cases.append(Case(id: 44,
            input: "supermercado a las 7 comprar leche",
            expectedKind: K.event,
            expectedTitleLower: "supermercado",
            expectedSubtitlePrefix: "comprar leche",
            expectedHour: 19, expectedDay: D.today))
        cases.append(Case(id: 45,
            input: "banco a las 12 llevar carnet",
            expectedKind: K.event,
            expectedTitleLower: "banco",
            expectedSubtitlePrefix: "llevar carnet",
            expectedHour: 12, expectedDay: D.today))
        // ── 46-50: queries / edición / clarify ───────────────────────
        cases.append(Case(id: 46,
            input: "qué tengo hoy",
            expectedKind: K.other,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            notes: "reviewToday, NO crear"))
        cases.append(Case(id: 47,
            input: "qué me queda pendiente",
            expectedKind: K.other,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            notes: "reviewPending"))
        cases.append(Case(id: 48,
            input: "borra fútbol",
            expectedKind: K.other,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            notes: "delete, NO crear"))
        cases.append(Case(id: 49,
            input: "cambia fútbol a las 6",
            expectedKind: K.other,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            notes: "reschedule, NO duplicar"))
        cases.append(Case(id: 50,
            input: "agenda una reunión algún día con cristina",
            expectedKind: K.clarify,
            expectedTitleLower: nil,
            expectedSubtitlePrefix: nil,
            notes: "ambiguo → preguntar fecha/hora"))
        // BUG-USER 2026-05-27 16:30 — orden distinto: "a las N" entre el
        // topic y "con persona". Reportado con screenshot.
        cases.append(Case(id: 51,
            input: "tengo una reunión de mindfulness a las 5 con cristina",
            expectedKind: K.event,
            expectedTitleLower: "reunión",
            expectedSubtitlePrefix: "mindfulness con cristina",
            expectedHour: 17, expectedDay: D.today,
            notes: "BUG-USER: 'tengo una' prefix + 'a las 5' entre topic y 'con X'"))
        // BUG-USER 2026-05-28 — "tengo q jugar counter a la 1 más o menos"
        // dejaba título "Q jugar counter más o menos". Debe limpiar "q"
        // (=que) y "más o menos" (aproximación).
        cases.append(Case(id: 52,
            input: "tengo q jugar counter a la 1 más o menos",
            expectedKind: K.event,
            expectedTitleLower: "jugar counter",
            expectedSubtitlePrefix: "",
            expectedHour: 13, expectedDay: D.today,
            notes: "BUG-USER: 'tengo q' → strip que; 'más o menos' → strip"))
        cases.append(Case(id: 53,
            input: "tengo q jugar counter más o menos a las 2",
            expectedKind: K.event,
            expectedTitleLower: "jugar counter",
            expectedSubtitlePrefix: "",
            expectedHour: 14, expectedDay: D.today,
            notes: "BUG-USER variante: 'más o menos' antes de la hora"))

        var out = "===== NOVA SUBTITLE-50 VALIDATION (user spec 2026-05-27) =====\n"
        out += "Fecha: \(Date())\n\n"
        var passCount = 0
        var failCount = 0
        var failedIds: [Int] = []
        var rows: [String] = []

        for c in cases {
            let actions = runPipeline(c.input)
            let first = actions.first
            var problems: [String] = []
            let actualKind = first?.kind ?? .other
            let actualTitle = first?.title ?? ""
            let actualSubtitle = first?.subtitle ?? ""
            let actualHour = first?.hour
            let actualDay = first?.day ?? .none

            // 1) kind
            if actualKind != c.expectedKind {
                problems.append("kind=\(actualKind) (esperado \(c.expectedKind))")
            }
            // 2) title (case-insensitive exact)
            if let expectedTitleLower = c.expectedTitleLower {
                if actualTitle.lowercased() != expectedTitleLower {
                    problems.append("title=\"\(actualTitle)\" (esperado lowercase \"\(expectedTitleLower)\")")
                }
            }
            // 3) subtitle (case-insensitive prefix, o vacío)
            if let expected = c.expectedSubtitlePrefix {
                if expected.isEmpty {
                    if !actualSubtitle.isEmpty {
                        problems.append("subtitle=\"\(actualSubtitle)\" (esperado vacío)")
                    }
                } else {
                    if !actualSubtitle.lowercased().contains(expected.lowercased()) {
                        problems.append("subtitle=\"\(actualSubtitle)\" (esperado contiene \"\(expected)\")")
                    }
                }
            }
            // 4) hour si se especifica
            if let eh = c.expectedHour, actualHour != eh {
                problems.append("hour=\(String(describing: actualHour)) (esperado \(eh))")
            }
            // 5) day si se especifica
            if let ed = c.expectedDay, actualDay != ed {
                problems.append("day=\(actualDay) (esperado \(ed))")
            }

            let pass = problems.isEmpty
            if pass {
                passCount += 1
                rows.append(String(format: "  %2d ✓ PASS | \"%@\" → kind=%@ title=\"%@\" sub=\"%@\" h=%@ day=%@",
                                   c.id, c.input,
                                   String(describing: actualKind),
                                   actualTitle, actualSubtitle,
                                   String(describing: actualHour),
                                   String(describing: actualDay)))
            } else {
                failCount += 1
                failedIds.append(c.id)
                rows.append(String(format: "  %2d ✗ FAIL | \"%@\" → kind=%@ title=\"%@\" sub=\"%@\" — %@",
                                   c.id, c.input,
                                   String(describing: actualKind),
                                   actualTitle, actualSubtitle,
                                   problems.joined(separator: "; ")))
            }
        }

        out += "RESULTADO: \(passCount)/\(cases.count) PASS  (\(failCount) FAIL)\n"
        if failCount == 0 {
            out += "✅ TODOS PASS — Nova conserva subtítulos correctamente.\n"
        } else {
            out += "FAILS: \(failedIds.map(String.init).joined(separator: ", "))\n"
            out += "    → NO LISTO para TestFlight si quedan casos críticos.\n"
        }
        out += "\n--- DETALLE POR CASO ---\n"
        out += rows.joined(separator: "\n")
        out += "\n===== END =====\n"
        return out
    }

    // MARK: - Memory validation suite (Phase 1-3 wire-up, 2026-05-27)

    /// Suite que valida la wiring de NovaMemoryStore — pattern de
    /// aprendizaje, expansión de aliases y comandos directos.
    /// Idempotente: limpia el store al final.
    @discardableResult
    static func runValidationMemoryCases() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        var out = "===== NOVA MEMORY VALIDATION =====\n"
        out += "Fecha: \(Date())\n\n"
        var passCount = 0
        var failCount = 0
        var rows: [String] = []

        // Snapshot del estado actual del store para restaurar al final.
        // Evita contaminar la memoria real del usuario al correr tests.
        let snapshotIds = NovaMemoryStore.shared.activeMemories.map { $0.id }
        defer {
            // Eliminar SOLO las memorias creadas durante el test.
            let after = NovaMemoryStore.shared.activeMemories.map { $0.id }
            for id in after where !snapshotIds.contains(id) {
                NovaMemoryStore.shared.delete(id: id)
            }
        }

        func record(_ id: Int, _ label: String, _ passed: Bool, _ detail: String) {
            if passed {
                passCount += 1
                rows.append(String(format: "  %2d ✓ PASS | %@ — %@", id, label, detail))
            } else {
                failCount += 1
                rows.append(String(format: "  %2d ✗ FAIL | %@ — %@", id, label, detail))
            }
        }

        // M1: aprendizaje patrón "X es mi Y"
        let learn1 = NovaMemoryStore.shared.tryLearnFromUserText("Juan Pablo es mi coordinador")
        record(1, "learn 'X es mi Y'",
               learn1?.category == .personAlias && learn1?.key == "juan pablo",
               "category=\(learn1?.category.rawValue ?? "nil") key=\(learn1?.key ?? "nil")")

        // M2: aprendizaje "cuando diga X me refiero a Y"
        let learn2 = NovaMemoryStore.shared.tryLearnFromUserText(
            "cuando diga teorías me refiero a Teorías de la Comunicación"
        )
        record(2, "learn 'cuando diga X me refiero a Y'",
               learn2?.category == .courseAlias && learn2?.key == "teorías",
               "category=\(learn2?.category.rawValue ?? "nil") key=\(learn2?.key ?? "nil") value=\(learn2?.value ?? "")")

        // M3: aprendizaje "X se llama Y"
        let learn3 = NovaMemoryStore.shared.tryLearnFromUserText("mi mamá se llama Susana")
        record(3, "learn 'X se llama Y'",
               learn3?.category == .personAlias && learn3?.key == "susana",
               "category=\(learn3?.category.rawValue ?? "nil") key=\(learn3?.key ?? "nil")")

        // M4: aprendizaje "tengo un Y llamado X"
        let learn4 = NovaMemoryStore.shared.tryLearnFromUserText("tengo un hijo llamado Diego")
        record(4, "learn 'tengo un Y llamado X'",
               learn4?.category == .personAlias && learn4?.key == "diego",
               "category=\(learn4?.category.rawValue ?? "nil") key=\(learn4?.key ?? "nil")")

        // M5: aprendizaje "mi Y es X" (orden invertido)
        let learn5 = NovaMemoryStore.shared.tryLearnFromUserText("mi jefe es Roberto Silva")
        record(5, "learn 'mi Y es X'",
               learn5?.category == .personAlias && learn5?.key == "roberto silva",
               "category=\(learn5?.category.rawValue ?? "nil") key=\(learn5?.key ?? "nil")")

        // M6: aprendizaje "prefiero ..."
        let learn6 = NovaMemoryStore.shared.tryLearnFromUserText("prefiero pendientes sin hora")
        record(6, "learn 'prefiero X'",
               learn6?.category == .preference,
               "category=\(learn6?.category.rawValue ?? "nil")")

        // M7: aprendizaje "no me gusta X"
        let learn7 = NovaMemoryStore.shared.tryLearnFromUserText("no me gusta tener reuniones en la mañana")
        record(7, "learn 'no me gusta X'",
               learn7?.category == .preference,
               "category=\(learn7?.category.rawValue ?? "nil")")

        // M8: NO aprende cuando no hay patrón
        let learn8 = NovaMemoryStore.shared.tryLearnFromUserText("hola, cómo estás")
        record(8, "ignore non-pattern text",
               learn8 == nil,
               "result=\(learn8 == nil ? "nil ✓" : "unexpected match")")

        // M9: expansión de courseAlias
        // (depende de M2 que guardó "teorías" → "Teorías de la Comunicación")
        let expanded = NovaMemoryStore.shared.expandAliases(
            in: "tengo prueba de teorías el viernes"
        )
        record(9, "expandAliases courseAlias",
               expanded.contains("Teorías de la Comunicación"),
               "result=\"\(expanded)\"")

        // M10: NO expande personAlias (preserva nombre propio en texto)
        let expanded2 = NovaMemoryStore.shared.expandAliases(in: "reunión con Juan Pablo")
        record(10, "do NOT expand personAlias",
               !expanded2.contains("coordinador"),
               "result=\"\(expanded2)\"")

        // M11: memoryContextLine genera línea de contexto
        let ctx = NovaMemoryStore.shared.memoryContextLine(
            for: "tengo reunión con Juan Pablo", limit: 5
        )
        record(11, "memoryContextLine produces text",
               ctx != nil && ctx!.contains("Juan Pablo"),
               "ctx=\(ctx ?? "nil")")

        // M12: relevantMemories filtra por substring
        let rel = NovaMemoryStore.shared.relevantMemories(for: "estudiar para teorías")
        record(12, "relevantMemories filters by key",
               rel.contains { $0.key == "teorías" },
               "found=\(rel.map { $0.key }.joined(separator: ","))")

        // M13: passivelyLearnFromEvent — captura persona desde título
        NovaMemoryStore.shared.passivelyLearnFromEvent(title: "Cumpleaños de Urrutia")
        let urrutia = NovaMemoryStore.shared.activeMemories.first { $0.key == "urrutia" }
        record(13, "passivelyLearnFromEvent('Cumpleaños de Urrutia')",
               urrutia != nil,
               "urrutia memory found=\(urrutia != nil)")

        // M14: passivelyLearnFromEvent NO captura "papá" / "mamá"
        let beforeCount = NovaMemoryStore.shared.activeMemories.count
        NovaMemoryStore.shared.passivelyLearnFromEvent(title: "Almuerzo con papá")
        let afterCount = NovaMemoryStore.shared.activeMemories.count
        record(14, "passive learn skips family words",
               afterCount == beforeCount,
               "before=\(beforeCount) after=\(afterCount)")

        // M15: allActiveMemoriesHuman incluye todas las memorias activas creadas
        let humans = NovaMemoryStore.shared.allActiveMemoriesHuman()
        let createdHere = humans.filter { !snapshotIds.contains($0.id) }
        record(15, "allActiveMemoriesHuman returns created entries",
               createdHere.count >= 7,
               "count=\(createdHere.count)")

        // M16: BUG-USER 2026-05-27 16:45 — "la agustina es mi polola"
        //      pattern 'X es mi Y' debe match con "la X" como key, "polola"
        //      en personRoles list.
        let learn16 = NovaMemoryStore.shared.tryLearnFromUserText("la agustina es mi polola")
        record(16, "BUG-USER 'la agustina es mi polola'",
               learn16?.category == .personAlias,
               "category=\(learn16?.category.rawValue ?? "nil") key=\(learn16?.key ?? "nil") value=\(learn16?.value ?? "nil")")

        // M17: variante sin "la" — "agustina es mi polola"
        let learn17 = NovaMemoryStore.shared.tryLearnFromUserText("agustina es mi polola")
        record(17, "'agustina es mi polola' (sin 'la')",
               learn17?.category == .personAlias,
               "category=\(learn17?.category.rawValue ?? "nil") key=\(learn17?.key ?? "nil")")

        // M18: variante con "Cristina es mi novia"
        let learn18 = NovaMemoryStore.shared.tryLearnFromUserText("Cristina es mi novia")
        record(18, "'Cristina es mi novia'",
               learn18?.category == .personAlias,
               "category=\(learn18?.category.rawValue ?? "nil") key=\(learn18?.key ?? "nil")")

        out += "RESULTADO: \(passCount)/\(passCount + failCount) PASS  (\(failCount) FAIL)\n"
        if failCount == 0 {
            out += "✅ TODOS PASS — memoria de Nova funciona end-to-end.\n"
        } else {
            out += "⚠️  Hay fallos — revisar wiring.\n"
        }
        out += "\n--- DETALLE POR CASO ---\n"
        out += rows.joined(separator: "\n")
        out += "\n===== END =====\n"
        return out
    }

    // MARK: - Regresión: subtitle con targeting por evento (2026-06-11)

    /// Reproduce el escenario exacto del bug reportado contra el pipeline
    /// real del store: dos `add_event` en un batch (subtitle solo en uno)
    /// + un `edit_event` posterior con `updates.subtitle`. Antes del fix:
    /// el detalle trailing del userText ("llevar las zapatillas...") se
    /// untaba como subtítulo de AMBOS eventos, y el edit de subtitle se
    /// descartaba en silencio. Limpia los eventos creados al terminar.
    @MainActor
    private static func subtitleTargetingRegressionFailures() -> [String] {
        var fails: [String] = []
        func check(_ label: String, _ ok: Bool, _ detail: String = "") {
            if ok {
                print("  ✓ \(label)")
            } else {
                let msg = "  ✗ \(label)\(detail.isEmpty ? "" : " — \(detail)")"
                print(msg)
                fails.append(msg)
            }
        }

        let store = FocusDataStore()
        let userText = "mañana gym a las 7 y clase a las 10, acuérdame de llevar las zapatillas al gym"
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        let tomorrowISO = fmt.string(from: tomorrow)

        func create(_ title: String, time: String, subtitle: String?) -> BackendEventCreate {
            BackendEventCreate(
                title: title, timeString: time, endTimeString: nil,
                dateString: tomorrowISO, section: "focus", icon: "event",
                reminderOffsets: nil, reminderNotes: nil,
                location: nil, notes: nil, subtitle: subtitle
            )
        }

        // 1. Batch de creación: el backend manda subtitle SOLO para Gym.
        let outcome = store.applyBackendActions(
            [
                .addEvent(create("Gym", time: "7:00 AM", subtitle: "Llevar zapatillas")),
                .addEvent(create("Clase", time: "10:00 AM", subtitle: nil)),
            ],
            userText: userText
        )
        let gym = outcome.createdEvents.first { $0.title.lowercased().contains("gym") }
        let clase = outcome.createdEvents.first { $0.title.lowercased().contains("clase") }
        check("subtitle-targeting: batch creó 2 eventos",
              outcome.createdEvents.count == 2,
              "creó \(outcome.createdEvents.count): \(outcome.createdEvents.map(\.title)) ignored=\(outcome.ignored)")
        check("subtitle-targeting: Gym conserva el subtitle del backend",
              gym?.subtitle == "Llevar zapatillas",
              "subtitle=\(gym?.subtitle ?? "nil")")
        check("subtitle-targeting: Clase NO hereda el detalle del userText",
              clase != nil && clase?.subtitle == nil,
              "subtitle=\(clase?.subtitle ?? "nil")")
        // El "acuérdame …" mid-sentence pertenece a UN segmento: NINGÚN
        // evento del batch debe quedar marcado como recordatorio (finding 3).
        check("subtitle-targeting: Gym NO es recordatorio",
              gym != nil && gym?.isReminder != true,
              "isReminder=\(String(describing: gym?.isReminder))")
        check("subtitle-targeting: Clase NO es recordatorio",
              clase != nil && clase?.isReminder != true,
              "isReminder=\(String(describing: clase?.isReminder))")

        // 2. Edit posterior: "ponle subtítulo matemáticas a la clase".
        if let clase {
            let updates = BackendEventUpdates(
                title: nil, timeString: nil, endTimeString: nil,
                dateString: nil, location: nil,
                reminderOffsets: nil, reminderNotes: nil,
                subtitle: "Matemáticas"
            )
            _ = store.applyBackendActions(
                [.editEvent(id: clase.id.uuidString, updates: updates)],
                userText: "ponle subtítulo matemáticas a la clase"
            )
            let claseAfter = store.events.first { $0.id == clase.id }
            check("subtitle-targeting: edit_event aplica updates.subtitle",
                  claseAfter?.subtitle == "Matemáticas",
                  "subtitle=\(claseAfter?.subtitle ?? "nil")")
            if let gymId = gym?.id {
                let gymAfter = store.events.first { $0.id == gymId }
                check("subtitle-targeting: el edit NO toca el otro evento",
                      gymAfter?.subtitle == "Llevar zapatillas",
                      "subtitle=\(gymAfter?.subtitle ?? "nil")")
            }
        }

        // 3. Limpieza: no dejar los eventos de prueba en el estado real.
        for ev in outcome.createdEvents {
            store.deleteEvent(ev.id)
        }
        return fails
    }

    // MARK: - Batería integral: eventos + subtítulos + recordatorios (2026-06-13)

    /// Expectativa de UN ítem creado por un caso de la batería.
    /// `key` = substring (lowercased) que debe contener el título. Los demás
    /// campos se chequean SOLO si están seteados (sentinelas explícitos).
    private struct BatExp {
        let key: String
        var hour: Int? = nil          // chequea hora si != nil
        var subHas: String? = nil     // título-subtítulo debe CONTENER esto
        var noSub: Bool = false       // subtítulo debe ser nil/vacío
        var offset: Int? = nil        // reminderOffsets.first == esto
        var noOffset: Bool = false    // sin reminderOffsets
        var isTask: Bool = false      // es tarea (sin hora), no evento
    }

    private struct BatCase {
        let input: String
        let expect: [BatExp]
        init(_ input: String, _ expect: [BatExp]) { self.input = input; self.expect = expect }
    }

    /// Batería integral del user spec 2026-06-13: 35 peticiones complejas
    /// (multi-evento, recordatorios distintos por evento, subtítulos,
    /// subtítulos en multi-evento, notas de recordatorio, recurrencia) + 15
    /// simples cotidianas. Corre el PIPELINE LOCAL REAL (parseAll →
    /// applyLocalNovaIntent) sobre un store efímero y verifica por evento:
    /// título limpio (sin coma/trigger residual), hora, subtítulo (presencia/
    /// anclaje) y offset de recordatorio (por-evento, no el primero del texto).
    @discardableResult
    static func runEventReminderBattery() -> String {
        NovaResponder.testReferenceDate = fixedTestNow
        defer { NovaResponder.testReferenceDate = nil }
        guard Thread.isMainThread else { return "BATERÍA: requiere main thread\n" }

        return MainActor.assumeIsolated { () -> String in
            let cases = batteryCases()
            var pass = 0, fail = 0
            var rows: [String] = []

            for (i, c) in cases.enumerated() {
                let n = i + 1
                let store = FocusDataStore()
                for ev in store.events { store.deleteEvent(ev.id) }
                for t in store.tasks { store.deleteTask(t.id) }
                let before = Set(store.events.map(\.id))
                let beforeTasks = Set(store.tasks.map(\.id))
                let intents = NovaResponder.parseAll(c.input)
                for it in intents {
                    _ = store.applyLocalNovaIntent(it, userText: c.input, isMultiIntent: intents.count > 1)
                }
                let createdEvents = store.events.filter { !before.contains($0.id) }
                let createdTasks = store.tasks.filter { !beforeTasks.contains($0.id) }

                var problems: [String] = []

                // 1. Conteo de ítems creados == esperado.
                let totalCreated = createdEvents.count + createdTasks.count
                if totalCreated != c.expect.count {
                    problems.append("conteo \(totalCreated)≠\(c.expect.count)")
                }

                // 2. Ningún título con basura (coma colgante / trigger residual).
                for ev in createdEvents {
                    let tl = ev.title.lowercased()
                    if ev.title.contains(" ,") || tl.contains("acuérdame") || tl.contains("acuerdame") || tl.contains("recuérdame") || tl.contains("recuerdame") {
                        problems.append("título sucio '\(ev.title)'")
                    }
                }

                // 3. Cada expectativa debe matchear un ítem creado.
                for exp in c.expect {
                    if exp.isTask {
                        guard let t = createdTasks.first(where: { $0.title.lowercased().contains(exp.key) }) else {
                            problems.append("falta tarea '\(exp.key)'"); continue
                        }
                        _ = t
                        continue
                    }
                    guard let ev = createdEvents.first(where: {
                        $0.title.lowercased().contains(exp.key) || ($0.subtitle ?? "").lowercased().contains(exp.key)
                    }) else {
                        problems.append("falta evento '\(exp.key)'"); continue
                    }
                    if let h = exp.hour {
                        let gotH = Calendar.current.component(.hour, from: ev.startTime)
                        if gotH != h { problems.append("'\(exp.key)' hora \(gotH)≠\(h)") }
                    }
                    if let sh = exp.subHas {
                        // La info debe estar PRESERVADA (en título o subtítulo) —
                        // el parser local a veces deja "X de Y" en el título y eso
                        // es aceptable; lo que NO se permite es perder la info.
                        let hay = (ev.title + " " + (ev.subtitle ?? "")).lowercased()
                        if !hay.contains(sh.lowercased()) { problems.append("'\(exp.key)' info '\(sh)' perdida (título='\(ev.title)' sub='\(ev.subtitle ?? "nil")')") }
                    }
                    if exp.noSub {
                        if let s = ev.subtitle, !s.isEmpty { problems.append("'\(exp.key)' subtítulo inesperado '\(s)'") }
                    }
                    if let off = exp.offset {
                        let got = ev.reminderOffsets?.first
                        if got != off { problems.append("'\(exp.key)' offset \(String(describing: got))≠\(off)") }
                    }
                    if exp.noOffset {
                        if let offs = ev.reminderOffsets, !offs.isEmpty { problems.append("'\(exp.key)' offset inesperado \(offs)") }
                    }
                }

                if problems.isEmpty {
                    pass += 1
                    rows.append("  \(n) ✓ | \(c.input.prefix(60))")
                } else {
                    fail += 1
                    let got = createdEvents.sorted { $0.startTime < $1.startTime }.map { "\($0.title)·h\(Calendar.current.component(.hour, from: $0.startTime))·off\($0.reminderOffsets?.first.map(String.init) ?? "-")·sub[\($0.subtitle ?? "-")]" }.joined(separator: " ")
                        + createdTasks.map { " TASK[\($0.title)]" }.joined()
                    rows.append("  \(n) ✗ FAIL | \(c.input.prefix(55)) → \(got) ⟵ \(problems.joined(separator: "; "))")
                }

                for ev in createdEvents { store.deleteEvent(ev.id) }
                for t in createdTasks { store.deleteTask(t.id) }
            }

            // Guard del short-circuit absoluto (bug "10/11 h antes" 2026-06-13):
            // en multi-evento con offset RELATIVO, extractReminderAbsoluteIntent
            // NO debe matchear (si no, malinterpreta "a las 9" como aviso
            // absoluto, calcula ~10 h y pierde la reunión). Un recordatorio
            // absoluto PURO ("acuérdame a las 6:30") SÍ debe seguir detectándose.
            let gAbs1 = NovaResponder.extractReminderAbsoluteIntent(
                from: "gym a las 7 acuerdame 30 min antes y reunion a las 9 acuerdame una hora antes") == nil
            let gAbs2 = NovaResponder.extractReminderAbsoluteIntent(
                from: "futbol a las 7 acuerdame a las 6:30") != nil
            if gAbs1 { pass += 1; rows.append("  G1 ✓ | multi-evento+relativo NO dispara aviso absoluto") }
            else { fail += 1; rows.append("  G1 ✗ FAIL | absoluteIntent disparó en multi-evento (bug 10h)") }
            if gAbs2 { pass += 1; rows.append("  G2 ✓ | aviso absoluto puro SÍ se detecta") }
            else { fail += 1; rows.append("  G2 ✗ FAIL | aviso absoluto puro dejó de detectarse") }

            var out = "===== BATERÍA EVENTOS+SUBTÍTULOS+RECORDATORIOS =====\n"
            out += "RESULTADO: \(pass)/\(pass + fail) PASS  (\(fail) FAIL)\n"
            out += fail == 0 ? "✅ TODOS PASS\n" : "⚠️  Hay fallos\n"
            out += "\n--- DETALLE ---\n" + rows.joined(separator: "\n") + "\n===== END =====\n"
            return out
        }
    }

    /// Los 50 casos (35 complejos + 15 simples). Horas con marcador explícito
    /// (de la mañana/tarde/noche) cuando importa, para que la expectativa sea
    /// determinista e independiente de la regla coloquial.
    private static func batteryCases() -> [BatCase] {
        return [
            // ───────── 35 COMPLEJAS ─────────
            // Multi-evento con recordatorios DISTINTOS por evento (el bug).
            BatCase("gym a las 7 de la mañana acuérdame 30 min antes y reunión a las 9 de la mañana acuérdame una hora antes",
                    [BatExp(key: "gym", hour: 7, offset: 30), BatExp(key: "reunión", hour: 9, offset: 60)]),
            BatCase("dentista a las 8 de la mañana acuérdame 30 min antes y almuerzo a la 1 de la tarde acuérdame 15 min antes",
                    [BatExp(key: "dentista", hour: 8, offset: 30), BatExp(key: "almuerzo", hour: 13, offset: 15)]),
            BatCase("clase a las 10 de la mañana acuérdame 15 min antes y gym a las 6 de la tarde acuérdame 10 min antes",
                    [BatExp(key: "clase", hour: 10, offset: 15), BatExp(key: "gym", hour: 18, offset: 10)]),
            BatCase("partido a las 3 de la tarde acuérdame una hora antes y cena a las 9 de la noche acuérdame dos horas antes",
                    [BatExp(key: "partido", hour: 15, offset: 60), BatExp(key: "cena", hour: 21, offset: 120)]),
            BatCase("reunión a las 11 de la mañana acuérdame 5 min antes y terapia a las 5 de la tarde acuérdame media hora antes",
                    [BatExp(key: "reunión", hour: 11, offset: 5), BatExp(key: "terapia", hour: 17, offset: 30)]),
            // Subtítulos en evento único.
            BatCase("gym pierna a las 7 de la mañana", [BatExp(key: "gym", hour: 7, subHas: "pierna")]),
            BatCase("reunión de mindfulness a las 8 de la noche", [BatExp(key: "reunión", hour: 20, subHas: "mindfulness")]),
            BatCase("clase de álgebra a las 10 de la mañana", [BatExp(key: "clase", hour: 10, subHas: "álgebra")]),
            BatCase("terapia de ansiedad a las 4 de la tarde", [BatExp(key: "terapia", hour: 16, subHas: "ansiedad")]),
            BatCase("entrenamiento de espalda a las 8 de la mañana", [BatExp(key: "entrenamiento", hour: 8, subHas: "espalda")]),
            // Subtítulos en MULTI-evento (targeting por evento).
            BatCase("clase de álgebra a las 10 de la mañana y clase de historia a las 12 de la tarde",
                    [BatExp(key: "álgebra", hour: 10), BatExp(key: "historia", hour: 12)]),
            BatCase("gym pierna a las 7 de la mañana y gym brazo a las 6 de la tarde",
                    [BatExp(key: "pierna", hour: 7), BatExp(key: "brazo", hour: 18)]),
            // Detalle/recordatorio anclado al evento que nombra.
            BatCase("dentista a las 4 de la tarde y comprar remedios a las 5 de la tarde, acuérdame de llevar la receta al dentista",
                    [BatExp(key: "dentista", hour: 16, subHas: "receta"), BatExp(key: "remedios", hour: 17, noSub: true)]),
            BatCase("fútbol a las 5 de la tarde acuérdame de llevar la pelota",
                    [BatExp(key: "fútbol", hour: 17, subHas: "pelota")]),
            BatCase("reunión con Cristina a las 4 de la tarde revisar el portafolio",
                    [BatExp(key: "cristina", hour: 16, subHas: "portafolio")]),
            // Recordatorio con nota custom ("N antes de X") → offset + nota.
            BatCase("partido a las 3 de la tarde acuérdame 20 min antes de echar las zapatillas",
                    [BatExp(key: "partido", hour: 15, offset: 20)]),
            // Recordatorio compartido "de cada uno" / "de ambos".
            BatCase("partido a las 3 de la tarde y cena a las 9 de la noche, acuérdame 30 min antes de cada uno",
                    [BatExp(key: "partido", hour: 15, offset: 30), BatExp(key: "cena", hour: 21, offset: 30)]),
            BatCase("clase a las 10 de la mañana y reunión a las 4 de la tarde, avísame 15 min antes de ambas",
                    [BatExp(key: "clase", hour: 10, offset: 15), BatExp(key: "reunión", hour: 16, offset: 15)]),
            // Triple multi-evento.
            BatCase("gym a las 7 de la mañana, desayuno a las 8 de la mañana y reunión a las 10 de la mañana",
                    [BatExp(key: "gym", hour: 7), BatExp(key: "desayuno", hour: 8), BatExp(key: "reunión", hour: 10)]),
            // Multi-evento, solo UNO con recordatorio.
            BatCase("dentista a las 9 de la mañana y gym a las 6 de la tarde acuérdame 30 min antes",
                    [BatExp(key: "dentista", hour: 9, noOffset: true), BatExp(key: "gym", hour: 18, offset: 30)]),
            BatCase("reunión a las 2 de la tarde acuérdame 10 min antes y café con Ana a las 5 de la tarde",
                    [BatExp(key: "reunión", hour: 14, offset: 10), BatExp(key: "café", hour: 17, noOffset: true)]),
            // Offsets en palabras.
            BatCase("reunión a las 5 de la tarde acuérdame media hora antes", [BatExp(key: "reunión", hour: 17, offset: 30)]),
            BatCase("clase a las 11 de la mañana acuérdame una hora antes", [BatExp(key: "clase", hour: 11, offset: 60)]),
            BatCase("examen a las 9 de la mañana acuérdame dos horas antes", [BatExp(key: "examen", hour: 9, offset: 120)]),
            BatCase("vuelo a las 6 de la mañana acuérdame tres horas antes", [BatExp(key: "vuelo", hour: 6, offset: 180)]),
            // Evento + tarea en un mensaje.
            BatCase("reunión a las 3 de la tarde y comprar pan",
                    [BatExp(key: "reunión", hour: 15), BatExp(key: "pan", isTask: true)]),
            BatCase("gym a las 7 de la mañana y llamar al banco",
                    [BatExp(key: "gym", hour: 7), BatExp(key: "llamar", isTask: true)]),
            // Subtítulo + recordatorio juntos.
            BatCase("clase de cálculo a las 10 de la mañana acuérdame 15 min antes",
                    [BatExp(key: "clase", hour: 10, subHas: "cálculo", offset: 15)]),
            BatCase("reunión de proyecto a las 4 de la tarde acuérdame 20 min antes",
                    [BatExp(key: "reunión", hour: 16, subHas: "proyecto", offset: 20)]),
            // Multi-evento con subtítulo en uno y recordatorio en el otro.
            BatCase("gym pierna a las 7 de la mañana y reunión a las 9 de la mañana acuérdame 30 min antes",
                    [BatExp(key: "gym", hour: 7, subHas: "pierna"), BatExp(key: "reunión", hour: 9, offset: 30)]),
            // Hora explícita 24h.
            BatCase("reunión a las 14:30", [BatExp(key: "reunión", hour: 14)]),
            BatCase("gym a las 19:00 acuérdame 30 min antes", [BatExp(key: "gym", hour: 19, offset: 30)]),
            // Recurrencia con recordatorio.
            BatCase("todos los lunes clase a las 10 de la mañana acuérdame 15 min antes",
                    [BatExp(key: "clase", hour: 10, offset: 15)]),
            // Dos eventos mismo tipo, distinto subtítulo y hora.
            BatCase("reunión de marketing a las 9 de la mañana y reunión de ventas a las 3 de la tarde",
                    [BatExp(key: "marketing", hour: 9), BatExp(key: "ventas", hour: 15)]),
            // Evento de noche con recordatorio largo.
            BatCase("cena con Pedro a las 9 de la noche acuérdame una hora antes",
                    [BatExp(key: "cena", hour: 21, subHas: "pedro", offset: 60)]),

            // ───────── 15 SIMPLES (cotidianas) ─────────
            BatCase("dentista mañana a las 4 de la tarde", [BatExp(key: "dentista", hour: 16)]),
            BatCase("gym a las 6 de la tarde", [BatExp(key: "gym", hour: 18)]),
            BatCase("reunión a las 3 de la tarde", [BatExp(key: "reunión", hour: 15)]),
            BatCase("almuerzo a la 1 de la tarde", [BatExp(key: "almuerzo", hour: 13)]),
            BatCase("cena a las 8 de la noche", [BatExp(key: "cena", hour: 20)]),
            BatCase("comprar pan", [BatExp(key: "pan", isTask: true)]),
            BatCase("llamar a Juan", [BatExp(key: "llamar", isTask: true)]),
            BatCase("clase a las 10 de la mañana", [BatExp(key: "clase", hour: 10)]),
            BatCase("estudiar a las 9 de la noche", [BatExp(key: "estudiar", hour: 21)]),
            BatCase("café con Pedro a las 5 de la tarde", [BatExp(key: "café", hour: 17)]),
            BatCase("médico a las 11 de la mañana", [BatExp(key: "médico", hour: 11)]),
            BatCase("yoga a las 7 de la mañana", [BatExp(key: "yoga", hour: 7)]),
            BatCase("reunión con Ana a las 2 de la tarde", [BatExp(key: "ana", hour: 14)]),
            BatCase("desayuno a las 8 de la mañana", [BatExp(key: "desayuno", hour: 8)]),
            BatCase("comprar leche", [BatExp(key: "leche", isTask: true)]),
        ]
    }

    // MARK: - Regresión: fallback logueado visible (2026-06-13)

    /// Verifica que NINGÚN error que dispara fallback al parser local deje al
    /// usuario sin aviso (loggedInFallbackNote no-vacía). Antes los errores de
    /// servidor (timeout/serviceUnavailable/server/...) caían en silencio.
    private static func fallbackVisibilityFailures(into failures: inout [String]) {
        func check(_ label: String, _ ok: Bool, _ detail: String = "") {
            if ok { print("  ✓ \(label)") }
            else {
                let msg = "  ✗ \(label)\(detail.isEmpty ? "" : " — \(detail)")"
                print(msg); failures.append(msg)
            }
        }
        // Errores que SÍ hacen fallback → nota visible obligatoria.
        let recoverable: [(String, NovaServiceError)] = [
            ("unauthorized", .unauthorized),
            ("quotaExceeded", .quotaExceeded(message: nil)),
            ("offline", .offline),
            ("timeout", .timeout),
            ("serviceUnavailable", .serviceUnavailable),
            ("badLLMOutput", .badLLMOutput),
            ("invalidResponse", .invalidResponse),
            ("server", .server(status: 500)),
        ]
        for (name, err) in recoverable {
            check("fallback-visible: \(name) tiene nota honesta no-vacía",
                  !err.loggedInFallbackNote.isEmpty && err.canFallbackToLocal,
                  "note='\(err.loggedInFallbackNote)' canFallback=\(err.canFallbackToLocal)")
            // La nota debe dejar claro que NO es la IA real (menciona respaldo
            // local / sesión / conexión), no un "Listo" que parezca normal.
            let n = err.loggedInFallbackNote.lowercased()
            check("fallback-visible: \(name) deja claro que es respaldo/local",
                  n.contains("local") || n.contains("sesión") || n.contains("conexión") || n.contains("límite"),
                  "note='\(err.loggedInFallbackNote)'")
        }
        // Errores client-side que NO hacen fallback → sin nota.
        for (name, err) in [("emptyMessage", NovaServiceError.emptyMessage), ("messageTooLong", .messageTooLong)] {
            check("fallback-visible: \(name) no hace fallback",
                  !err.canFallbackToLocal && err.loggedInFallbackNote.isEmpty,
                  "canFallback=\(err.canFallbackToLocal)")
        }
    }

    // MARK: - Regresión: parser LOCAL multi-intent (2026-06-12)

    /// Reproduce el bug del parser local (modo demo / sin sesión): al
    /// segmentar un mensaje con varios eventos, el segundo título salía
    /// sucio (coma colgante + residuo del trigger de recordatorio) para la
    /// clase de inputs "X a las N, acuérdame de Y", y el "acuérdame de … al
    /// dentista" se perdía sin anclarse al evento que nombra. Corre el path
    /// REAL (NovaResponder.parseAll → applyLocalNovaIntent) y limpia al final.
    @MainActor
    private static func localMultiIntentRegressionFailures() -> [String] {
        var fails: [String] = []
        func check(_ label: String, _ ok: Bool, _ detail: String = "") {
            if ok {
                print("  ✓ \(label)")
            } else {
                let msg = "  ✗ \(label)\(detail.isEmpty ? "" : " — \(detail)")"
                print(msg)
                fails.append(msg)
            }
        }

        // Helper: corre el path local real y devuelve los eventos creados.
        // Sanea fixtures preexistentes (de corridas previas persistidas en
        // UserDefaults) para que el guard anti-duplicado no bloquee la
        // creación.
        func runLocal(_ text: String) -> (store: FocusDataStore, events: [FocusEvent], replies: [String], intentCount: Int) {
            let store = FocusDataStore()
            let fixtureNeedles = ["dentista", "comprar remedios", "remedios"]
            for ev in store.events where fixtureNeedles.contains(where: { ev.title.lowercased().contains($0) }) {
                store.deleteEvent(ev.id)
            }
            let before = Set(store.events.map(\.id))
            let intents = NovaResponder.parseAll(text)
            var replies: [String] = []
            for intent in intents {
                if let r = store.applyLocalNovaIntent(
                    intent, userText: text, isMultiIntent: intents.count > 1
                ) { replies.append(r) }
            }
            let created = store.events
                .filter { !before.contains($0.id) }
                .sorted { $0.startTime < $1.startTime }
            return (store, created, replies, intents.count)
        }

        // ── Caso 1: el input exacto del bug reportado.
        let (store1, evs1, replies1, ic1) = runLocal(
            "dentista a las 4 y comprar remedios a las 5, acuérdame de llevar la receta al dentista"
        )
        let dentista = evs1.first { $0.title.lowercased().contains("dentista") }
        let remedios = evs1.first { $0.title.lowercased().contains("remedios") }
        check("local-multi: crea 2 eventos", evs1.count == 2,
              "creó \(evs1.count) (intents=\(ic1)) titles=\(evs1.map(\.title)) replies=\(replies1)")
        check("local-multi: título 2 LIMPIO ('Comprar remedios')",
              remedios?.title == "Comprar remedios",
              "title='\(remedios?.title ?? "nil")'")
        check("local-multi: sin coma/trigger colgante en ningún título",
              evs1.allSatisfy { !$0.title.contains(",") && !$0.title.lowercased().contains("acuérdame") && !$0.title.lowercased().contains("acuerdame") },
              "titles=\(evs1.map(\.title))")
        // El recordatorio "…al dentista" se ancla al Dentista, no a Remedios.
        check("local-multi: detalle anclado al Dentista",
              dentista?.subtitle?.lowercased().contains("receta") == true,
              "dentista.sub='\(dentista?.subtitle ?? "nil")'")
        check("local-multi: el detalle NO contamina Comprar remedios",
              remedios?.subtitle == nil,
              "remedios.sub='\(remedios?.subtitle ?? "nil")'")
        for ev in evs1 { store1.deleteEvent(ev.id) }

        // ── Caso 2: el bug ORIGINAL no debe reaparecer — un detalle SIN
        // referencia explícita no se filtra a ningún evento.
        let (store2, evs2, _, _) = runLocal("dentista a las 4 y comprar remedios a las 5")
        let dent2 = evs2.first { $0.title.lowercased().contains("dentista") }
        let rem2 = evs2.first { $0.title.lowercased().contains("remedios") }
        check("local-multi: bug original sigue arreglado (Dentista sin subtítulo ajeno)",
              dent2?.subtitle == nil,
              "dentista.sub='\(dent2?.subtitle ?? "nil")'")
        check("local-multi: Comprar remedios sin subtítulo auto-referencial",
              rem2?.subtitle == nil,
              "remedios.sub='\(rem2?.subtitle ?? "nil")'")
        for ev in evs2 { store2.deleteEvent(ev.id) }

        // ── Caso 3 (unidad): cleanTitle limpia la clase coma+trigger aunque
        // lo que siga NO sea un verbo de detalle reconocido.
        check("cleanTitle: 'comprar remedios a las 5, acuérdame de algo' → 'Comprar remedios'",
              NovaActionNormalizer.cleanTitle("comprar remedios a las 5, acuérdame de algo") == "Comprar remedios",
              "='\(NovaActionNormalizer.cleanTitle("comprar remedios a las 5, acuérdame de algo"))'")
        // ── Caso 4 (unidad): trigger SIN coma al inicio NO se trunca de más.
        check("cleanTitle: 'hoy recuérdame llamar a Juan' → 'Llamar a Juan'",
              NovaActionNormalizer.cleanTitle("hoy recuérdame llamar a Juan") == "Llamar a Juan",
              "='\(NovaActionNormalizer.cleanTitle("hoy recuérdame llamar a Juan"))'")

        return fails
    }
}

#endif
