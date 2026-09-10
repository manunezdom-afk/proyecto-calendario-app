import SwiftUI
import Combine
import Foundation
import WidgetKit
import CryptoKit

/// Quick action que el usuario puede tocar en la pestaña Acciones de Nova.
/// Cubre el ciclo del día (planificar / agregar / revisar / cerrar) más el
/// flujo de calendario externo (importar / exportar — V1 informativo).
enum NovaQuickAction: String, CaseIterable, Identifiable {
    case organizar
    case crearTarea
    case crearEvento
    case revisarPendientes
    case prepararManana
    case cerrarDia
    case importarCalendario
    case exportarCalendario

    var id: String { rawValue }

    var label: String {
        switch self {
        case .organizar:          return "Organizar mi día"
        case .crearTarea:         return "Crear tarea"
        case .crearEvento:        return "Crear evento"
        case .revisarPendientes:  return "Revisar pendientes"
        case .prepararManana:     return "Preparar mañana"
        case .cerrarDia:          return "Cerrar el día"
        case .importarCalendario: return "Importar calendario"
        case .exportarCalendario: return "Exportar calendario"
        }
    }

    var subtitle: String {
        switch self {
        case .organizar:          return "Acomodo bloques de hoy con tus prioridades."
        case .crearTarea:         return "Anoto una tarea con prioridad y categoría."
        case .crearEvento:        return "Agendo un bloque o reunión en tu día."
        case .revisarPendientes:  return "Repaso lo que quedó sin horario o decisión."
        case .prepararManana:     return "Reviso lo que viene y dejo el día armado."
        case .cerrarDia:          return "Reviso lo hecho y limpio lo que no resolviste."
        case .importarCalendario: return "Traer eventos de Google, Apple o un .ics."
        case .exportarCalendario: return "Sacar tu agenda como .ics o a otro calendario."
        }
    }

    var symbol: String {
        switch self {
        case .organizar:          return "sparkles"
        case .crearTarea:         return "checkmark.circle"
        case .crearEvento:        return "calendar.badge.plus"
        case .revisarPendientes:  return "tray.full"
        case .prepararManana:     return "moon.stars"
        case .cerrarDia:          return "checkmark.seal"
        case .importarCalendario: return "square.and.arrow.down"
        case .exportarCalendario: return "square.and.arrow.up"
        }
    }

    var userText: String { label }

    var novaReply: String {
        switch self {
        case .organizar:
            return "Cuéntame qué quieres priorizar y revisamos tu día juntos."
        case .crearTarea:
            return "Dime qué tarea quieres crear y la agendo con prioridad y categoría. Ej: \"Entregar TP de Programación el viernes\"."
        case .crearEvento:
            return "Cuéntame qué evento, qué día y a qué hora. Puedes decirme \"acuérdame 10 minutos antes\" si quieres aviso."
        case .revisarPendientes:
            return "Cuéntame qué pendientes te están pesando hoy y los priorizamos."
        case .prepararManana:
            return "Cuéntame qué quieres dejar listo para mañana y armamos un plan corto."
        case .cerrarDia:
            return "Cuéntame cómo te fue hoy y revisamos qué dejar listo para mañana."
        case .importarCalendario:
            return "Puedo ayudarte a traer tus eventos desde Google Calendar, Apple Calendar o un archivo .ics. Cuando conectemos la integración, revisaré conflictos, tareas sin horario y bloques disponibles."
        case .exportarCalendario:
            return "Cuando conectemos la exportación, vas a poder mandar tu agenda como .ics o sincronizarla a Google/Apple Calendar. Por ahora solo guardamos local en tu iPhone."
        }
    }
}

// MARK: - Nova intents (estructurados, mock-friendly)

/// Hint de recurrencia detectada en el texto del usuario. Por ahora la app NO
/// soporta recurrencia nativa — solo se usa para que Nova responda con honestidad
/// ("la recurrencia queda para próxima versión") en vez de prometer y fallar.
enum RecurrenceHint: Hashable {
    case daily
    case weekly
    case weeklyOn(label: String)            // "los lunes", "los miércoles"
    case biweeklyOn(label: String)          // "lunes de por medio" / "cada 2 viernes"
    case everyNDays(n: Int)                 // "día por medio" → 2, "cada 3 días" → 3
    case weekdays                           // "de lunes a viernes" / "días hábiles"
    case multiWeekday(weekdays: [Int], label: String)  // "miércoles y viernes" → [4, 6]
    case monthly
    case unspecified                        // "recurrente" sin frecuencia explícita

    var label: String {
        switch self {
        case .daily:                          return "todos los días"
        case .weekly:                         return "cada semana"
        case .weeklyOn(let label):            return "todos \(label)"
        case .biweeklyOn(let label):          return label
        case .everyNDays(let n):              return n == 2 ? "día por medio" : "cada \(n) días"
        case .weekdays:                       return "de lunes a viernes"
        case .multiWeekday(_, let label):     return label
        case .monthly:                        return "cada mes"
        case .unspecified:                    return "recurrente"
        }
    }
}

/// Lo que Nova entendió del mensaje del usuario. La interpretación es local
/// (sin IA real); cuando se conecte el backend, este enum se mantiene y solo
/// cambia el parser.
enum NovaIntent: Hashable {
    /// Crear tarea con título, opcional fecha límite, opcional recurrencia,
    /// opcional flag "acuérdame".
    case createTask(title: String, dueDate: Date?, recurrence: RecurrenceHint?, wantsReminder: Bool)
    /// Crear evento. `when` es opcional — si no lo extrajimos, Nova pide
    /// aclaración. `section` también opcional con default `.reunion`.
    /// `endTime` es no-nil solo cuando el usuario dio hora-fin explícita
    /// ("de 3 a 4", "hasta las 4", "por 1h"). Si es nil, el evento se
    /// muestra como punto en el tiempo.
    /// `recurrence` no-nil → caller expande N instancias locales (weekly →
    /// 8 semanas, daily → 14 días, monthly → 3 meses). Hint del parser para
    /// frases tipo "todos los lunes a las 5 clase de lenguaje".
    case createEvent(
        title: String,
        when: Date?,
        endTime: Date?,
        location: String?,
        section: EventSection?,
        wantsReminder: Bool,
        recurrence: RecurrenceHint? = nil,
        // Offset/nota de aviso PRE-EXTRAÍDOS del SEGMENTO de este evento
        // (no del userText completo). Clave para multi-evento: "gym a las 7
        // acuérdame 30 antes y reunión a las 9 acuérdame 1 hora antes" debe
        // dar 30 al gym y 60 a la reunión. `parseAll` los inyecta por
        // segmento; nil → el caller extrae del userText (single-intent).
        reminderOffset: Int? = nil,
        reminderNote: String? = nil
    )
    /// Corregir el último ítem creado (evento o tarea). Resuelto desde
    /// `NovaContext.lastEventId` / `lastTaskId`.
    case correctLastEvent(modifier: EventCorrection)
    /// Convertir el último evento en tarea (mismo título, sin hora).
    case convertLastToTask
    /// Borrar el último ítem creado (evento o tarea).
    case deleteLastItem
    /// Borrar un evento existente identificado por título aproximado. Ej:
    /// "borra lo de estudiar comunicación" / "elimina fútbol". El caller
    /// (`applyLocalNovaIntent`) resuelve el evento usando
    /// `findEventByApproxTitle`.
    case deleteEventByActivity(activity: String)
    /// Cambiar la hora de un evento existente por título aproximado. Ej:
    /// "mueve fútbol a las 5" / "cambia clase de arte a las 11".
    case rescheduleEventByActivity(activity: String, hour: Int, minute: Int)
    /// Agregar / cambiar la alerta de un evento existente sin crear uno nuevo.
    /// Ej: "ponle recordatorio media hora antes al fútbol" /
    /// "el recordatorio del fútbol es 30 min antes" /
    /// "agrégale aviso 1 hora antes a la reunión".
    /// `applyLocalNovaIntent` resuelve el evento con `findEventByApproxTitle`
    /// y actualiza `reminderOffsets` reemplazando cualquier alerta previa.
    case attachReminderToEvent(activity: String, offsetMinutes: Int, note: String?)
    /// Propuesta de plan de acción desde texto largo. El usuario pegó una
    /// lista de varias responsabilidades (ej. "Acciones tuyas: 1. Hablar
    /// con... 2. Revisar... 3. Enviar..."). Nova NO ejecuta — guarda la
    /// propuesta en `pendingActionPlan` y devuelve un resumen humano. El
    /// siguiente turno con "sí, agrégalo" / "dale" dispara
    /// `.confirmActionPlan` que crea las tareas reales.
    case proposeActionPlan(actions: [ProposedTaskAction])
    /// Usuario aceptó la propuesta del turno anterior (almacenada en
    /// `pendingActionPlan`). Crea N tareas con notas + subtasks + prioridad.
    case confirmActionPlan
    /// Anotar una corrección sobre una tarea existente. Ej: "la planilla
    /// no era para profesores, era para Juan". El handler busca la tarea
    /// con `subject` (fuzzy match) y agrega/actualiza la nota con la
    /// corrección. Sin modificar el título visible (que ya está OK).
    case annotateTaskCorrection(subject: String, correctionNote: String)
    /// Anotar una dependencia entre dos cosas: "antes de mandar el correo
    /// necesito la planilla". El handler busca ambas tareas (fuzzy) y
    /// agrega una nota explicando el orden. No reordena automáticamente.
    case annotateDependency(prerequisite: String, dependent: String)
    /// Organizar el día → genera sugerencias en la Bandeja.
    case organizeDay
    /// Revisar tareas pendientes → resumen inline.
    case reviewPending
    /// Vista general del día: eventos del timeline + tareas pendientes.
    /// Se activa con "¿qué tengo hoy?" / "¿qué sigue?".
    case reviewToday
    /// Pregunta sobre cómo borrar ejemplos demo.
    case askAboutDemo
    /// Saludo / acuse simple. La respuesta es variada (no siempre la misma).
    case smallTalk(reply: String)
    /// Texto no entendible — pedimos una aclaración con razón específica.
    case clarify(reason: ClarifyReason)

    enum ClarifyReason: Hashable {
        case taskNeedsTitle
        case eventNeedsTitle
        case eventNeedsTime(title: String, partialDate: Date)
        case eventNeedsDateTime(title: String)
        case noContext                  // "agéndalo" sin contexto previo
        case unclear
    }
}

/// Modificador para `correctLastEvent`. Soporta cambios sin re-crear el ítem.
enum EventCorrection: Hashable {
    case shiftDays(offset: Int)            // "no, mañana" → +1; "no, ayer" → -1
    case setTime(hour: Int, minute: Int)   // "cámbialo a las 18"
    case setLocation(String)               // "en sala H013"
    case setTitle(String)                  // "era con Pedro" → cambia título
}

// MARK: - Contexto de sesión de Nova (memoria corta)

/// Evento que estuvo en discusión recientemente. Forma parte de
/// `NovaContext.discussedEvents` para resolver referencias implícitas.
///
/// Ejemplo de uso (user spec 2026-05-15):
///   Turno 1: "tengo partido el sábado tipo 3" → discussedEvents = [Partido].
///   Turno 2: "acuérdame 20 min antes de echar las zapatillas a la mochila"
///     → Sin match exacto del activity contra eventos. Pero discussedEvents[0]
///       es Partido (recién hablamos de eso) → anclar reminder a Partido
///       con note "Echar las zapatillas a la mochila". NO preguntar
///       "¿a qué evento?" — es obvio dado el contexto.
struct DiscussedEvent: Equatable, Hashable {
    let eventId: UUID
    let title: String
    /// Cuándo fue la última vez que el user habló de este evento (creó,
    /// editó o lo mencionó por título/fuzzy match).
    let mentionedAt: Date

    /// Tiempo de vida del topic focus: 30 minutos sin mención. Después
    /// asumimos que el user cambió de tema y limpiamos.
    var isFresh: Bool {
        Date().timeIntervalSince(mentionedAt) < 30 * 60
    }
}

/// Propuesta de tarea generada al extraer un plan de acción desde texto
/// largo. NO se aplica directamente — se muestra al usuario como
/// resumen y se aplica solo si confirma con "sí, agrégalo".
///
/// Diseño: el título es el visible en la lista de tareas y debe ser
/// DISCRETO (sin exponer detalles médicos sensibles). Las notas guardan
/// el detalle original. Las subtasks expanden pasos concretos.
struct ProposedTaskAction: Equatable, Hashable {
    var title: String
    var notes: String?
    var priority: TaskPriority
    var category: TaskCategory
    var subtasks: [String]
}

/// Memoria local de la última interacción con Nova. Permite resolver
/// referencias tipo "agéndalo como tarea recurrente" — "lo" remite al título
/// más reciente. NO se persiste en disco: vive solo en RAM durante la sesión.
struct NovaContext: Equatable {
    var lastInputText: String?
    var lastTitle: String?
    var lastDate: Date?
    var lastLocation: String?
    var lastSection: EventSection?
    var lastIntentKind: Kind?
    var lastEventId: UUID?
    var lastTaskId: UUID?
    /// Aclaración pendiente cuando Nova preguntó algo y la acción NO se llegó
    /// a ejecutar. El siguiente turno corto (ej. "a las 20", "en 20 minutos",
    /// "sí", "mañana") puede usarlo para completar la acción sin que el
    /// usuario tenga que repetir título/contexto. Auto-expira a los 10 min.
    var pendingClarification: PendingClarification?
    /// Eventos discutidos recientemente, ordenados por recencia (más
    /// reciente primero). Max 5 entradas. Permite que reminders y
    /// referencias ambiguas se resuelvan al evento "en foco" sin
    /// preguntarle al user a qué evento se refiere.
    ///
    /// Se promueven (movidos al frente) cuando el user CREA, EDITA o
    /// MENCIONA un evento (por título fuzzy match). Auto-expira por
    /// item después de 30 min sin actividad.
    var discussedEvents: [DiscussedEvent] = []
    /// Plan de acción propuesto pero NO confirmado. Lo guardamos cuando
    /// Nova detecta texto largo con varias acciones y le pregunta al
    /// usuario si quiere convertirlas en tareas. Una respuesta afirmativa
    /// corta ("sí, agrégalo", "dale", "agrégalas") en el siguiente turno
    /// lo ejecuta. Expira por contexto (10 min) o cuando el usuario cambia
    /// claramente de tema.
    var pendingActionPlan: [ProposedTaskAction]?
    var updatedAt: Date = Date()

    enum Kind: Hashable {
        case task
        case event
    }

    var isFresh: Bool {
        // Contexto válido por 10 minutos. Después se trata como "sin contexto".
        Date().timeIntervalSince(updatedAt) < 600
    }

    /// Helper: pending solo es "vivo" si existe, no expiró y el contexto
    /// general es fresco. Lo usamos para decidir si resolver follow-ups.
    var pendingIsActive: Bool {
        guard let p = pendingClarification else { return false }
        return Date() < p.expiresAt && isFresh
    }

    /// Eventos discutidos NO expirados, ordenados por recencia.
    var freshDiscussedEvents: [DiscussedEvent] {
        discussedEvents.filter { $0.isFresh }
    }

    /// El evento más recientemente discutido (si está vivo). Punto de
    /// entrada principal para resolución implícita de reminders.
    var topicEvent: DiscussedEvent? {
        freshDiscussedEvents.first
    }
}

/// Aclaración pendiente: Nova preguntó algo y la acción no se ejecutó.
/// Persiste durante 10 minutos para que el usuario pueda responder corto
/// y completar la acción.
///
/// Ejemplo:
///   Usuario: "tengo parcial el jueves"
///   Nova:    "¿A qué hora?"  → save PendingClarification(kind=.event,
///            proposedTitle="Parcial", proposedDate=jueves,
///            missingFields=[.time])
///   Usuario: "a las 3"      → parse detecta pending, completa con time=15:00.
struct PendingClarification: Equatable {
    /// Mensaje original que originó la aclaración.
    var originalInput: String
    /// Tipo de acción que Nova quería crear (en su mejor interpretación).
    var kind: Kind
    /// Título limpio listo para usar (si Nova ya lo había extraído).
    var proposedTitle: String?
    /// Fecha tentativa (puede ser solo el día si falta la hora).
    var proposedDate: Date?
    /// Sección detectada por keywords del texto original.
    var proposedSection: EventSection?
    /// Ubicación si Nova la había extraído.
    var proposedLocation: String?
    /// `true` cuando el usuario dijo "acuérdame/recuérdame": la acción
    /// completada debe ser un recordatorio puntual, no un evento con rango.
    var wantsReminder: Bool
    /// Lista de campos que faltan completar para ejecutar la acción.
    var missingFields: Set<MissingField>
    /// La pregunta exacta que Nova hizo. Útil para debugging y UI.
    var questionAsked: String?
    /// Surface que originó la aclaración (inline Mi Día o chat).
    var source: Source
    /// Cuándo se creó.
    var createdAt: Date
    /// Auto-expiración: 10 minutos después de createdAt.
    var expiresAt: Date

    enum Kind: String, Hashable {
        case event
        case task
        case reminder
        /// Indeterminado: pedimos al usuario que aclare entre evento o tarea.
        case ambiguous
    }

    enum MissingField: String, Hashable {
        case title
        case date
        case time
        case duration
        case targetItem
        case actionType
    }

    enum Source: String, Hashable {
        case inlineMiDia
        case novaChat
    }

    init(
        originalInput: String,
        kind: Kind,
        proposedTitle: String? = nil,
        proposedDate: Date? = nil,
        proposedSection: EventSection? = nil,
        proposedLocation: String? = nil,
        wantsReminder: Bool = false,
        missingFields: Set<MissingField> = [],
        questionAsked: String? = nil,
        source: Source = .inlineMiDia,
        createdAt: Date = Date(),
        expiresAt: Date? = nil
    ) {
        self.originalInput = originalInput
        self.kind = kind
        self.proposedTitle = proposedTitle
        self.proposedDate = proposedDate
        self.proposedSection = proposedSection
        self.proposedLocation = proposedLocation
        self.wantsReminder = wantsReminder
        self.missingFields = missingFields
        self.questionAsked = questionAsked
        self.source = source
        self.createdAt = createdAt
        self.expiresAt = expiresAt ?? createdAt.addingTimeInterval(600)
    }
}

/// Responde a texto libre. Tiene 2 caras:
/// - `parse(_:context:)` → `NovaIntent` estructurado (para Mi Día inline).
/// - `reply(to:)` → string variado para el chat completo.
///
/// Reglas de parsing en español natural (sin IA real):
/// - **Verbos de tarea** (explícitos): "tengo que", "recordarme", "recuérdame",
///   "comprar", "llamar", "responder", "estudiar X" (sin contexto de hora),
///   "preparar", "revisar", "crea tarea", "anota".
/// - **Verbos de evento**: "agenda", "agéndame", "agéndalo", "salir a",
///   "ir a", "buscar a", "juntarme con", "reunión con", "tengo clase",
///   "tengo prueba", "tengo parcial", "clase de", "tengo evento".
/// - **Tiempo**: "hoy" / "mañana" / "pasado mañana" / día de la semana /
///   "esta tarde" / "esta noche".
/// - **Hora**: "a las HH(:MM)", "HH:MM" suelto, **"tipo N"** (colloquial,
///   default PM 13–18h para N=1–6, etc.), "HHam/pm".
/// - **Lugar**: " en <X>" al final del texto.
/// - **Sección**: heurística por palabras (parcial → estudio, buscar →
///   personal, reunión → reunión, gym → descanso, etc.).
/// - **Recurrencia**: "todos los X", "cada semana", "diario" → `RecurrenceHint`.
/// - **Contexto**: si el texto arranca con "agéndalo"/"y X"/etc. y hay un
///   `NovaContext` reciente, completamos campos faltantes (título, fecha) con
///   los del último intent.
enum NovaResponder {

    // MARK: - Reloj de referencia (test seam)

    #if DEBUG
    /// Reloj inyectable SOLO para tests. nil = usa `Date()` real. La
    /// resolución AM/PM de horas ambiguas (1..12 sin am/pm) mira la hora
    /// ACTUAL (night-context ≥19h, future-first "hoy"), así que correr las
    /// suites en la tarde flipaba horas a PM y las volvía flaky. Fijar este
    /// reloj a una hora de mañana las hace deterministas. Resetear tras usar.
    nonisolated(unsafe) static var testReferenceDate: Date?
    nonisolated(unsafe) static var testTimeZone: TimeZone?
    #endif

    /// Hora "ahora" para toda resolución de fecha/hora del parser. En
    /// producción es `Date()`; en tests DEBUG puede fijarse vía
    /// `testReferenceDate` para eliminar la dependencia del reloj del
    /// simulador. Producción RELEASE nunca ve el override.
    static var referenceNow: Date {
        #if DEBUG
        return testReferenceDate ?? Date()
        #else
        return Date()
        #endif
    }

    static var referenceCalendar: Calendar {
        #if DEBUG
        return NovaTimeFormatter.calendar(timezone: testTimeZone ?? .current)
        #else
        return NovaTimeFormatter.calendar()
        #endif
    }

    // MARK: Public API

    /// Detecta si una frase parece tener MÚLTIPLES acciones que el parser
    /// local NO puede separar con confianza.
    ///
    /// El parser local maneja bien:
    ///   - conectores explícitos ("y luego", "luego", "después")
    ///   - " y " cuando AMBOS lados tienen una hora numérica
    ///
    /// Pero falla con:
    ///   - números en palabras ("en una hora", "en dos horas")
    ///   - cláusulas separadas por comas en vez de conectores
    ///   - referencias temporales borrosas ("más o menos a las 12")
    ///   - 3+ acciones encadenadas en una sola oración
    ///
    /// Para esos casos preferimos forzar el backend (IA fuerte). Si el
    /// backend está caído, mostramos pregunta humana — NO ejecutamos el
    /// parser local, que acabaría creando UN evento con título sucio y
    /// hora arbitraria (caso reportado por el usuario el 2026-05-12:
    /// "en una hora más voy a jugar fútbol, en dos horas más tengo que
    /// volver y más o menos a las 12 me tengo que acostar" terminaba como
    /// "Voy a ir a jugar fútbol — 12:00").
    ///
    /// Heurística amplia: prefiere falsos positivos (mandar al backend de
    /// más) sobre falsos negativos (crear basura).
    static func isLikelyMultiAction(_ text: String) -> Bool {
        let lower = text.lowercased()

        // 0) Defensa: si el texto matchea el patrón "evento + reminder
        //    absoluto" ("tengo clase a las 1:30 acuérdame a las 12:50",
        //    "ducharme a las 10 acuérdame a las 9:50"), NO es complejo —
        //    es UN evento con UN aviso. El caller ya lo atajará localmente
        //    vía `tryReminderAbsoluteFlow`, pero esta defensa garantiza
        //    que NUNCA se marque como multi-acción aunque tenga dos horas.
        if extractReminderAbsoluteIntent(from: text) != nil { return false }

        // 1) Conectores fuertes ya son señal clara de múltiples acciones.
        let strongHints = [
            " y luego ", " y después ", " y despues ",
            " luego ", " después de eso ", " despues de eso ",
            " después ", " despues ",
            " también ", " tambien ",
            " además ", " ademas ",
            " más tarde ", " mas tarde ",
            // Evento + recordatorio en la misma frase (beta-12, caso real).
            // Espejo del backend `detectComplexInput` — sin esto el cliente
            // no marca como multi y el fallback local arma un solo evento.
            " y recuérdame ", " y recuerdame ", " y recordame ",
            " y acuérdame ", " y acuerdame ", " y acordame ",
            " y avísame ", " y avisame ",
            " y que no se me olvide ", " y que no se olvide ",
            " y no te olvides ", " y no olvides ", " y no me dejes olvidar ",
            " y ponme ", " y ponle "
        ]
        for hint in strongHints where lower.contains(hint) { return true }

        // 1b) Coexistencia evento + recordatorio SIN conector "y". Espejo de
        //     la regla 1b del backend. Si la frase tiene un verbo de evento
        //     ("tengo", "voy a", "agéndame", "ponme") Y un trigger de
        //     recordatorio en posiciones separadas (≥12 chars de distancia
        //     entre uno y otro), son dos cláusulas distintas. La distancia
        //     12 es proxy de "no es la misma cláusula": "recuérdame llamar
        //     a mamá" tiene trigger al inicio y nada de evento → no matchea
        //     porque eventVerbRe no encuentra "tengo/voy a".
        let reminderPattern = #"\b(recu[eé]rdame|acu[eé]rdame|acordame|av[ií]same|recordame)\b"#
        let eventVerbPattern = #"\b(tengo|tenemos|agenda|agendame|ag[eé]ndame|agendarme|ponme|ponle|crea|cr[eé]ame|me\s+toca|tengo\s+que|voy\s+a)\b"#
        if let rRe = try? NSRegularExpression(pattern: reminderPattern, options: [.caseInsensitive]),
           let eRe = try? NSRegularExpression(pattern: eventVerbPattern, options: [.caseInsensitive]) {
            let fullRange = NSRange(location: 0, length: (lower as NSString).length)
            if let rMatch = rRe.firstMatch(in: lower, options: [], range: fullRange),
               let eMatch = eRe.firstMatch(in: lower, options: [], range: fullRange) {
                let distance = abs(rMatch.range.location - eMatch.range.location)
                if distance > 12 { return true }
            }
        }

        // 2) Contar marcadores temporales. ≥2 hits → casi seguro multi.
        // Soporta números EN PALABRAS (una/dos/tres) que el hour pattern
        // del parser local no maneja en `applySmartYSplit`.
        let timePatterns: [String] = [
            // "en N min/horas" — N en palabra o dígito
            #"\ben\s+(una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|\d{1,3})\s*(min|minutos?|h|hs|hrs?|horas?)\b"#,
            // "a la(s) N" / "a la N" — dígito
            #"\ba la(s)?\s+\d{1,2}(:\d{2})?\b"#,
            // "a la(s) N" — palabra
            #"\ba la(s)?\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b"#,
            // "tipo N" / "tipo las N"
            #"\btipo\s+(la(s)?\s+)?\d{1,2}(:\d{2})?\b"#,
            // HH:MM standalone
            #"(?<!\d)\d{1,2}:\d{2}(?!\d)"#
        ]
        var timeHits = 0
        let ns = lower as NSString
        let range = NSRange(location: 0, length: ns.length)
        for pattern in timePatterns {
            guard let re = try? NSRegularExpression(
                pattern: pattern, options: [.caseInsensitive]
            ) else { continue }
            timeHits += re.numberOfMatches(in: lower, options: [], range: range)
            if timeHits >= 2 { return true }
        }

        // 3) Comas con verbo+tiempo en cada cláusula. Heurística simple:
        // 1+ coma + al menos 1 marcador temporal + texto largo.
        if text.count >= 70, text.contains(","), timeHits >= 1 {
            return true
        }

        // 4) Texto muy largo + alguna conjunción → probable múltiple.
        if text.count >= 120 && (lower.contains(" y ") || lower.contains(",")) {
            return true
        }

        return false
    }

    // MARK: - Reminder attach (asociar aviso a evento existente)

    /// Resultado de detectar la intención "agregame un aviso N minutos antes
    /// de [evento existente]". `activity` es el texto crudo después de
    /// "antes de" — luego se busca un evento por título aproximado.
    struct ReminderAttachIntent {
        let offsetMinutes: Int
        let activity: String
    }

    /// Detecta el patrón "acuérdame/recuérdame/avísame N min antes de X".
    /// Devuelve `(offset, activity)` si matchea, nil en caso contrario.
    ///
    /// Esto NO crea un evento — solo extrae la intención. El caller decide
    /// si encuentra el evento existente (entonces hace edit) o pide
    /// confirmación al usuario.
    static func extractReminderAttachIntent(from text: String) -> ReminderAttachIntent? {
        let lower = text.lowercased()
        // 1. Trigger de recordatorio — incluimos también las formas
        //    "ponle/ponme/agrégale/agregale + recordatorio" porque son
        //    expresiones equivalentes que el usuario usa naturalmente.
        //    Sin esto "Ponle recordatorio media hora antes al fútbol"
        //    no matcheaba el flujo de attach-reminder y caía a parser
        //    genérico (que creaba evento nuevo o pedía aclaración).
        let hasTrigger = matchesAny(lower, [
            "acuérdame", "acuerdame", "acordame",
            "recuérdame", "recuerdame", "recordame",
            "avísame", "avisame",
            "ponle recordatorio", "ponme recordatorio",
            "agrégale recordatorio", "agregale recordatorio",
            "agrégame recordatorio", "agregame recordatorio",
            "ponle aviso", "ponme aviso", "agrégale aviso", "agregale aviso",
        ])
        guard hasTrigger else { return nil }

        // 2. Cantidad de minutos/horas antes
        guard let offset = NovaActionNormalizer.extractReminderOffset(from: lower),
              offset > 0 else { return nil }

        // 3. Extraer "antes de X" — captura todo después de "antes de" hasta
        // el final del segmento (puntuación o fin).
        // Soporta "antes de", "antes del", "antes de la/el/los/las".
        // Pattern acepta "antes de(l) X" Y "antes al X" — el "al" es
        // contracción coloquial común ("antes al fútbol"). NO permitimos
        // "antes a X" suelto: eso colisiona con "antes a las 5" donde
        // "a las 5" sería capturado erróneamente. Solo "antes de" /
        // "antes del" / "antes al" son válidos.
        let activityPattern = #"\bantes (?:de(?:l)?|al)\s+(?:(?:la|el|los|las|mi|tu|su)\s+)?(.+?)\s*(?:$|[.,;!?]|\bpor favor\b)"#
        guard let regex = try? NSRegularExpression(
            pattern: activityPattern,
            options: [.caseInsensitive]
        ) else { return nil }
        let ns = lower as NSString
        let range = NSRange(location: 0, length: ns.length)
        guard let match = regex.firstMatch(in: lower, options: [], range: range),
              match.numberOfRanges >= 2,
              match.range(at: 1).location != NSNotFound else { return nil }
        let activity = ns.substring(with: match.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activity.isEmpty else { return nil }
        return ReminderAttachIntent(offsetMinutes: offset, activity: activity)
    }

    /// Detecta un recordatorio relativo "N min/h antes" SIN evento nombrado
    /// ni hora absoluta — el follow-up natural tras crear un evento
    /// ("psicóloga mañana a las 4" → "acuérdame 25 min antes"). Devuelve solo
    /// el offset; el caller lo ancla al evento en foco (`topicEvent`).
    ///
    /// Devuelve nil si:
    ///  - no hay trigger de recordatorio + offset válido, o
    ///  - hay un "antes de X" explícito → eso lo maneja
    ///    `extractReminderAttachIntent` (que además extrae la nota).
    /// El guard contra `extractReminderAttachIntent` lo hace robusto al orden
    /// de llamada y fácil de testear en aislamiento.
    static func extractBareReminderOffset(from text: String) -> Int? {
        let lower = text.lowercased()
        let hasTrigger = matchesAny(lower, [
            "acuérdame", "acuerdame", "acordame",
            "recuérdame", "recuerdame", "recordame",
            "avísame", "avisame",
            "ponle recordatorio", "ponme recordatorio",
            "agrégale recordatorio", "agregale recordatorio",
            "agrégame recordatorio", "agregame recordatorio",
            "ponle aviso", "ponme aviso", "agrégale aviso", "agregale aviso",
        ])
        guard hasTrigger else { return nil }
        guard let offset = NovaActionNormalizer.extractReminderOffset(from: lower),
              offset > 0 else { return nil }
        // Si hay un "antes de X", lo maneja extractReminderAttachIntent.
        if extractReminderAttachIntent(from: text) != nil { return nil }
        return offset
    }

    /// Patrón "[evento] a las X, acuérdame a las Y" — el usuario describe
    /// UN bloque con su hora Y un aviso absoluto. Diferente de
    /// `extractReminderAttachIntent` que captura "N min antes de X".
    enum ReminderAbsoluteIntent {
        /// Frase del estilo "tengo clase a las 1:30 acuérdame a las 12:50".
        /// El caller crea un nuevo evento con `reminderOffsets` calculado.
        case newBlock(
            rawTitle: String,
            eventHour: Int, eventMinute: Int,
            reminderHour: Int, reminderMinute: Int
        )
        /// Frase del estilo "acuérdame a las 9:50 de ducharme" — solo hay
        /// trigger + tiempo absoluto + actividad. El caller hace fuzzy
        /// match contra eventos existentes.
        case attachByAbsolute(
            activity: String,
            reminderHour: Int, reminderMinute: Int
        )
    }

    /// Detecta los patrones de "reminder absoluto":
    /// A. "[evento] a las X(:M)[, y]? [trigger] a las Y(:M)" → newBlock
    /// B. "[trigger] a las Y(:M) (de|del|para) [evento]" → attachByAbsolute
    ///
    /// Devuelve nil si no es ninguno de los dos patrones. Importante: si
    /// la frase tiene MÁS de dos horas distintas o conectores fuertes de
    /// múltiples acciones ("luego", "después de eso"), no consideramos
    /// que sea un reminder-absoluto (más seguro caer al flujo normal).
    static func extractReminderAbsoluteIntent(from text: String) -> ReminderAbsoluteIntent? {
        let lower = text.lowercased()
        // 1. Debe haber un trigger explícito de recordatorio.
        let triggers = [
            "acuérdame", "acuerdame", "acordame",
            "recuérdame", "recuerdame", "recordame",
            "avísame", "avisame"
        ]
        var foundTrigger: String? = nil
        for t in triggers {
            if lower.range(of: t) != nil { foundTrigger = t; break }
        }
        guard let trigger = foundTrigger else { return nil }

        // GUARD (bug real 2026-06-13): si el usuario dio un offset RELATIVO
        // ("30 min antes", "una hora antes", "media hora antes"), el aviso NO
        // es absoluto — lo maneja el flujo normal (relativo y, en multi-evento,
        // por-segmento). Sin esto, "gym a las 7 acuérdame 30 min antes y
        // reunión a las 9 acuérdame una hora antes" se malinterpretaba como
        // UN evento@7 con aviso absoluto@9 (= ~10-11 h antes) y se perdía la
        // reunión. extractReminderOffset detecta el patrón relativo.
        if NovaActionNormalizer.extractReminderOffset(from: text) != nil { return nil }

        // GUARD: dos triggers de recordatorio (uno por evento) ⇒ multi-evento,
        // no un evento+aviso absoluto. Dejar al flujo multi-intent.
        let triggerHits = triggers.reduce(0) { acc, t in
            acc + (lower.components(separatedBy: t).count - 1)
        }
        if triggerHits >= 2 { return nil }

        // 2. Encontrar TODAS las menciones de hora en formato "a la(s) H(:M)".
        //    Solo dígitos por simplicidad — palabras se pueden agregar después
        //    si los testers lo piden.
        let hourPattern = #"\ba la?s?\s+(\d{1,2})(?::(\d{2}))?\b"#
        guard let regex = try? NSRegularExpression(pattern: hourPattern, options: [.caseInsensitive]) else {
            return nil
        }
        let ns = lower as NSString
        let allRange = NSRange(location: 0, length: ns.length)
        let matches = regex.matches(in: lower, options: [], range: allRange)
        guard !matches.isEmpty else { return nil }

        // Conectores fuertes que sugieren múltiples ACCIONES (no
        // evento+reminder). Si aparece uno, devolvemos nil y dejamos
        // que el flujo normal de multi-intent maneje.
        let strongMultiHints = [
            " y luego ", " luego ", " después de eso ", " despues de eso ",
            " también ", " además "
        ]
        for h in strongMultiHints where lower.contains(h) { return nil }

        // 3. Helper: parsea un match de hora a (h, m, locStart).
        //    locStart es la posición UTF16 del inicio del match en `lower`.
        func parse(_ m: NSTextCheckingResult) -> (h: Int, m: Int, locStart: Int, range: NSRange)? {
            guard m.numberOfRanges >= 2, m.range(at: 1).location != NSNotFound else {
                return nil
            }
            let hStr = ns.substring(with: m.range(at: 1))
            guard let h = Int(hStr) else { return nil }
            var mm = 0
            if m.numberOfRanges >= 3, m.range(at: 2).location != NSNotFound {
                let mStr = ns.substring(with: m.range(at: 2))
                mm = Int(mStr) ?? 0
            }
            guard h <= 23, mm <= 59 else { return nil }
            return (h, mm, m.range.location, m.range)
        }

        // Posición UTF16 del trigger en `lower` (consistente con NSRange).
        let triggerNSLoc = (lower as NSString).range(of: trigger).location
        guard triggerNSLoc != NSNotFound else { return nil }

        let parsedTimes = matches.compactMap(parse)
        guard !parsedTimes.isEmpty else { return nil }

        // 4. Separar tiempos ANTES del trigger (candidatos a event) y
        //    DESPUÉS (candidatos a reminder). En el patrón típico:
        //    "[evento] a las X TRIGGER a las Y" → X antes, Y después.
        //    Para "TRIGGER a las Y de [evento]" → solo Y después.
        let timesBefore = parsedTimes.filter { $0.locStart < triggerNSLoc }
        let timesAfter  = parsedTimes.filter { $0.locStart >= triggerNSLoc }

        // 5. Reminder = primer tiempo DESPUÉS del trigger.
        guard let reminder = timesAfter.first else { return nil }
        // Demasiados tiempos después → ambiguo, abort.
        if timesAfter.count > 1 { return nil }

        // 6. Si hay tiempo antes → Caso A (nuevo evento). Si no → Caso B
        //    (attach a existing buscando "de X" después del reminder).
        if let eventTime = timesBefore.last {
            // Demasiados tiempos antes → ambiguo (3+ acciones), abort.
            if timesBefore.count > 1 { return nil }

            // Título = texto desde inicio hasta el match de event.
            let titleEnd = eventTime.range.location
            var rawTitle = ns.substring(with: NSRange(location: 0, length: titleEnd))
            // Limpiar fillers iniciales típicos: "tengo", "hay", "tengo que".
            let stripPrefixes = [
                "tengo que ", "tengo ", "necesito ", "hay ",
                "agenda ", "agéndame ", "agendame ",
                "ponme ", "crea ",
            ]
            var changed = true
            while changed {
                changed = false
                for p in stripPrefixes
                    where rawTitle.lowercased().hasPrefix(p) {
                    rawTitle = String(rawTitle.dropFirst(p.count))
                    changed = true
                    break
                }
                rawTitle = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            rawTitle = rawTitle
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: ",;:."))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !rawTitle.isEmpty else { return nil }
            return .newBlock(
                rawTitle: rawTitle,
                eventHour: eventTime.h, eventMinute: eventTime.m,
                reminderHour: reminder.h, reminderMinute: reminder.m
            )
        }

        // Caso B — solo hay una hora (la del reminder). Buscar "de/del/para X"
        // después de la hora reminder para extraer la activity.
        let activityPattern = #"\b(?:de|del|para)\s+(?:(?:la|el|los|las|mi|tu|su)\s+)?(.+?)\s*(?:$|[.,;!?])"#
        guard let aRegex = try? NSRegularExpression(
            pattern: activityPattern, options: [.caseInsensitive]
        ) else { return nil }
        // Buscar después del reminder match (que ya está después del trigger).
        let searchStart = reminder.range.location + reminder.range.length
        let searchRange = NSRange(location: searchStart, length: ns.length - searchStart)
        guard searchRange.length > 0,
              let aMatch = aRegex.firstMatch(in: lower, options: [], range: searchRange),
              aMatch.numberOfRanges >= 2,
              aMatch.range(at: 1).location != NSNotFound else {
            return nil
        }
        let activity = ns.substring(with: aMatch.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activity.isEmpty else { return nil }
        return .attachByAbsolute(
            activity: activity,
            reminderHour: reminder.h, reminderMinute: reminder.m
        )
    }

    /// Decide en qué bracket AM/PM cae el `rawReminderHour` (1..12) dado
    /// el evento ya resuelto a 24h. Razonamiento: el reminder DEBE quedar
    /// antes del evento Y a una distancia razonable (típicamente 0..4 h).
    ///
    /// Caso típico que esto resuelve: "clase a las 1:30 acuérdame a las
    /// 12:50". El evento queda 13:30 (PM via colloquial). El reminder
    /// crudo "12:50" sin contexto sería 0:50 AM por la regla "forceAM 12
    /// → 0", lo cual da un offset de ~12.7 h (sin sentido). Con el
    /// scoring, comparamos AM y PM bracket y elegimos el que produce un
    /// offset positivo razonable.
    ///
    /// - Parameter rawReminderHour: hora cruda 0..12 del reminder.
    /// - Parameter rawReminderMin: minutos crudos del reminder.
    /// - Parameter eventHour24: hora del evento ya resuelta a 24h.
    /// - Parameter eventMin: minutos del evento.
    /// - Returns: hora 24h del reminder que produce el mejor offset.
    ///   Si reminder es >12 (ya en 24h literal), retorna eso tal cual.
    static func resolveAbsoluteReminderHour(
        rawReminderHour: Int,
        rawReminderMin: Int,
        eventHour24: Int,
        eventMin: Int
    ) -> Int {
        // 24h literal — no hay ambigüedad.
        if rawReminderHour > 12 { return rawReminderHour }
        // 0 ya es explícito (0..0 medianoche). Solo aplicamos scoring
        // para 1..12.
        if rawReminderHour == 0 { return 0 }

        // Caso 12 es especial: AM = 0 (medianoche), PM = 12 (mediodía).
        let amCandidate = rawReminderHour == 12 ? 0 : rawReminderHour
        let pmCandidate = rawReminderHour == 12 ? 12 : rawReminderHour + 12

        let eventMinutes = eventHour24 * 60 + eventMin
        let amMinutes = amCandidate * 60 + rawReminderMin
        let pmMinutes = pmCandidate * 60 + rawReminderMin

        let amOffset = eventMinutes - amMinutes
        let pmOffset = eventMinutes - pmMinutes

        // Scoring: el mejor offset es:
        //   - Positivo (reminder antes del evento).
        //   - Pequeño (≤ 4 h ≈ 240 min) — típico aviso anticipado.
        //
        // Reglas:
        //   - offset negativo (reminder después del evento) → penalización grande.
        //   - offset > 4 h → penalización media (el usuario podría querer
        //     un aviso muy anticipado, pero es atípico).
        //   - offset ≤ 4 h → score = offset (cuanto menor, mejor).
        func score(_ offset: Int) -> Int {
            if offset <= 0 { return 1_000_000 + abs(offset) }
            if offset > 240 { return 100_000 + offset }
            return offset
        }

        return score(amOffset) <= score(pmOffset) ? amCandidate : pmCandidate
    }

    /// Busca un evento cuyo título coincida aproximadamente con `activity`.
    /// Estrategia: normaliza ambos (sin acentos, lowercase, sin puntuación),
    /// prueba match exacto → substring en cualquier dirección → token
    /// overlap (≥1 palabra significativa de ≥3 chars).
    ///
    /// Si hay múltiples candidatos, prefiere score más alto; en empate,
    /// prefiere el más cercano FUTURO (un evento ya pasado matchea peor que
    /// uno por venir). Pensado para "acuérdame N min antes de ducharme"
    /// donde el usuario habla del próximo evento del día.
    static func findEventByApproxTitle(
        _ activity: String,
        in events: [FocusEvent]
    ) -> FocusEvent? {
        let normTarget = normalizeForFuzzy(activity)
        guard !normTarget.isEmpty else { return nil }
        let targetTokens = Set(normTarget.split(separator: " ")
                                  .map(String.init)
                                  .filter { $0.count >= 3 })

        let candidates: [(score: Int, event: FocusEvent)] = events.compactMap { event in
            let normTitle = normalizeForFuzzy(event.title)
            guard !normTitle.isEmpty else { return nil }
            // Match exacto
            if normTitle == normTarget { return (100, event) }
            // Substring (target dentro de title) — "ducha" matchea "ducha matutina"
            if normTitle.contains(normTarget) { return (80, event) }
            // Substring (title dentro de target) — "ducharme" matchea con activity "ducharme rápido"
            if normTarget.contains(normTitle) { return (75, event) }
            // Token overlap — al menos una palabra de 3+ chars compartida
            let titleTokens = Set(normTitle.split(separator: " ")
                                     .map(String.init)
                                     .filter { $0.count >= 3 })
            let intersect = targetTokens.intersection(titleTokens).count
            if intersect >= 1 {
                return (50 + intersect * 10, event)
            }
            return nil
        }

        guard !candidates.isEmpty else { return nil }
        let now = Date()
        let sorted = candidates.sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            let aFuture = a.event.startTime > now
            let bFuture = b.event.startTime > now
            if aFuture != bFuture { return aFuture }
            return abs(a.event.startTime.timeIntervalSinceNow)
                < abs(b.event.startTime.timeIntervalSinceNow)
        }
        return sorted.first?.event
    }

    /// Busca un evento que matchee por **referencia temporal** dentro
    /// del texto. Útil para "el evento de las 3" / "lo de las 7" /
    /// "la reunión de las 5". Cuando el user nombra una hora sin
    /// nombrar el evento, intentamos resolver al evento que arranca
    /// en ese horario.
    ///
    /// Estrategia:
    /// 1. Extrae horas mencionadas en el texto vía `extractHourMinute`.
    /// 2. Busca eventos cuya `startTime` esté dentro de ±15 min de la
    ///    hora extraída.
    /// 3. Si hay 1 match → devuelve. Si hay 0 o ≥2 → nil (el caller
    ///    pide aclaración).
    ///
    /// Pensado para ser usado por `tryAttachReminderToExistingEvent`
    /// como segundo intento cuando el title-matching falla.
    static func findEventByTimeReference(
        _ text: String,
        in events: [FocusEvent]
    ) -> FocusEvent? {
        // Normalizamos variantes coloquiales antes de extraer la hora:
        //   "de las X" / "el evento de las X" → "a las X" (el extractor
        //   espera "a las X" como anchor). Permite frases tipo "el
        //   evento de las 3", "lo de las 7", "la reunión de las 5".
        var lower = text.lowercased()
        lower = lower.replacingOccurrences(
            of: #"\bde\s+(la|las)\s+(\d{1,2})\b"#,
            with: "a las $2",
            options: .regularExpression
        )
        // Reusamos el extractor del parser (NovaResponder.extractHourMinute
        // está expuesto al mismo módulo).
        guard let (hour, minute) = NovaResponder.extractHourMinute(from: lower) else {
            return nil
        }
        let cal = Calendar.current
        let now = Date()
        let candidates = events.filter { ev in
            let evH = cal.component(.hour, from: ev.startTime)
            let evM = cal.component(.minute, from: ev.startTime)
            let evMinutes = evH * 60 + evM
            let targetMinutes = hour * 60 + minute
            return abs(evMinutes - targetMinutes) <= 15
        }
        // Si hay varios, prefiere el más FUTURO (no estamos hablando
        // de un evento que ya pasó si hay opción).
        guard !candidates.isEmpty else { return nil }
        if candidates.count == 1 { return candidates.first }
        let sorted = candidates.sorted { a, b in
            let aFuture = a.startTime > now
            let bFuture = b.startTime > now
            if aFuture != bFuture { return aFuture }
            return abs(a.startTime.timeIntervalSinceNow)
                < abs(b.startTime.timeIntervalSinceNow)
        }
        return sorted.first
    }

    /// Normaliza un string para fuzzy match: sin acentos, lowercase, sin
    /// puntuación, colapsa espacios.
    static func normalizeForFuzzy(_ text: String) -> String {
        let folded = text.folding(
            options: .diacriticInsensitive,
            locale: Locale(identifier: "es")
        ).lowercased()
        let allowed = CharacterSet.letters.union(.decimalDigits).union(.whitespaces)
        let scrubbed = folded.unicodeScalars
            .map { allowed.contains($0) ? Character($0) : " " }
        return String(scrubbed)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Parser multi-intent: separa frases compuestas por conectores
    /// fuertes ("y luego", "luego", "después", "también", "además") y
    /// parsea cada segmento como un intent independiente.
    ///
    /// Conservador: NO splittea por " y " solo — es demasiado ambiguo
    /// ("café y té"). Solo conectores que en español neutro siempre
    /// indican una nueva acción.
    ///
    /// Si el texto NO tiene conectores, devuelve `[parse(text)]` para
    /// compatibilidad con callers que esperan un solo intent.
    ///
    /// Heurística clave: si el primer segmento tiene un marcador temporal
    /// global ("mañana", "hoy", "el lunes") y un segmento posterior NO,
    /// le prepende ese marcador antes de parsear. Así:
    ///   "mañana despertarme a las 7:10 y luego tipo 8 salir de mi casa"
    /// segmento 1: "mañana despertarme a las 7:10" → Despertarme mañana 07:10
    /// segmento 2: "mañana tipo 8 salir de mi casa" → Salir de mi casa mañana 08:00
    /// Inyecta en un intent `.createEvent` el offset/nota de recordatorio
    /// extraído de SU PROPIO segmento. Sin esto, cada evento de un mensaje
    /// multi-evento heredaba el PRIMER offset del texto completo ("gym 30 antes
    /// y reunión 1 hora antes" → ambos 30). `groupOffset` es el aviso GRUPAL
    /// ("...antes de cada uno/ambos") que se aplica a los eventos sin offset
    /// propio. No-op para intents no-createEvent.
    private static func injectSegmentReminder(_ intent: NovaIntent, segment: String, groupOffset: Int? = nil) -> NovaIntent {
        guard case .createEvent(let t, let w, let e, let l, let s, let wr, let rec, _, _) = intent else {
            return intent
        }
        let rem = NovaActionNormalizer.extractReminderOffsetAndNote(from: segment)
        return .createEvent(
            title: t, when: w, endTime: e, location: l, section: s,
            wantsReminder: wr, recurrence: rec,
            reminderOffset: rem?.offsetMinutes ?? groupOffset, reminderNote: rem?.note
        )
    }

    /// Detecta un recordatorio GRUPAL ("...acuérdame 30 min antes de cada
    /// uno / de ambos / de los dos / de cada clase") y devuelve (offset,
    /// textoSinLaClausula). El offset se aplica a TODOS los eventos del
    /// mensaje; la cláusula se remueve para que no contamine el último evento
    /// ni se pierda su segmento. nil si no hay directiva grupal.
    private static func extractAndStripGroupReminder(_ text: String) -> (offset: Int, cleaned: String)? {
        let lower = text.lowercased()
        // Debe mencionar un destinatario grupal explícito.
        let groupTargets = ["de cada uno", "de cada una", "de ambos", "de ambas",
                            "de los dos", "de las dos",
                            "de cada clase", "de cada evento", "de cada reunión",
                            "de cada reunion", "de cada partido", "de cada sesión",
                            "de cada sesion", "para ambos", "para ambas",
                            "para cada uno", "para los dos"]
        guard groupTargets.contains(where: { lower.contains($0) }) else { return nil }
        guard let off = NovaActionNormalizer.extractReminderOffset(from: text) else { return nil }
        // Remover la cláusula completa: "(y)? (acuérdame/avísame/recuérdame)?
        // N (min|hora)s antes (de|para) <grupo>" — y la coma previa si quedó.
        let unit = "(?:min|minutos?|h|hs|hrs?|horas?)"
        let num = "(?:\\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)"
        let verb = "(?:ac[uú]erdame|acuerdame|recu[eé]rdame|recuerdame|av[ií]same|avisame)"
        let target = "(?:de|para)\\s+(?:cada\\s+\\w+|ambos|ambas|los\\s+dos|las\\s+dos)"
        let clause = "\\s*,?\\s*(?:y\\s+)?(?:\(verb)\\s+)?\(num)\\s+\(unit)\\s+antes\\s+\(target)\\b"
        var cleaned = text
        if let regex = try? NSRegularExpression(pattern: clause, options: [.caseInsensitive]) {
            let ns = cleaned as NSString
            cleaned = regex.stringByReplacingMatches(
                in: cleaned, range: NSRange(location: 0, length: ns.length), withTemplate: ""
            ).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return (off, cleaned)
    }

    static func parseAll(_ text: String, context: NovaContext = NovaContext()) -> [NovaIntent] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Recordatorio GRUPAL ("...acuérdame 30 min antes de cada uno/ambos/
        // los dos"): lo extraemos del texto COMPLETO y removemos su cláusula
        // ANTES de segmentar — así no contamina ni descarta el último evento.
        // El offset se aplica a todos los eventos sin offset propio.
        var groupOffset: Int? = nil
        var workingText = trimmed
        if let g = extractAndStripGroupReminder(trimmed) {
            groupOffset = g.offset
            workingText = g.cleaned
        }

        var segments = splitOnStrongConnectors(workingText)

        // Detección de reminder compartido LEGACY (último segmento ES la
        // directiva): "...y recuérdame N min antes de cada clase". Solo aplica
        // si extractAndStripGroupReminder no lo cubrió ya.
        var sharedReminderSuffix: String? = nil
        if groupOffset == nil, let last = segments.last,
           let suffix = extractGroupReminderSuffix(from: last) {
            sharedReminderSuffix = suffix
            segments = Array(segments.dropLast())
        }
        guard segments.count > 1 else {
            // Si solo queda 1 segmento + shared reminder, appendamos y parseamos.
            if let suffix = sharedReminderSuffix, let only = segments.first {
                let seg = "\(only) \(suffix)"
                return [injectSegmentReminder(parse(seg, context: context), segment: seg, groupOffset: groupOffset)]
            }
            let only = segments.first ?? workingText
            return [injectSegmentReminder(parse(only, context: context), segment: only, groupOffset: groupOffset)]
        }

        var inheritedDayMarker: String? = nil
        let fullLower = (segments.first ?? "").lowercased()
        // Marcador de recurrencia global ("todos los lunes" / "todos los días"
        // / "de lunes a viernes"). Si el primer segmento lo tiene y los demás
        // no, lo herendan. Sin esto, "todos los lunes a las 5 lenguaje, a las
        // 6 arte" creaba lenguaje recurrente pero arte como evento único.
        let inheritedRecurrenceMarker: String? = {
            let candidates = [
                "todos los lunes", "todos los martes",
                "todos los miércoles", "todos los miercoles",
                "todos los jueves", "todos los viernes",
                "todos los sábados", "todos los sabados",
                "todos los domingos",
                "todos los días", "todos los dias",
                "de lunes a viernes",
                "día por medio", "dia por medio",
                "lunes de por medio", "martes de por medio",
                "miércoles de por medio", "miercoles de por medio",
                "jueves de por medio", "viernes de por medio"
            ]
            for c in candidates where fullLower.contains(c) {
                return c
            }
            return nil
        }()

        var intents: [NovaIntent] = []
        for (i, seg) in segments.enumerated() {
            var workingSeg = seg
            if let ownDay = dayMarker(in: seg.lowercased()) { inheritedDayMarker = ownDay }
            // Si el segmento 2+ no tiene su propio marcador de día pero
            // el texto global sí, lo prependemos. Sin esto, "tipo 8" en
            // el segmento 2 perdería el "mañana" del segmento 1.
            if i > 0, let day = inheritedDayMarker {
                let segLower = workingSeg.lowercased()
                let hasOwnDay = dayMarker(in: segLower) != nil
                if !hasOwnDay {
                    workingSeg = "\(day) \(workingSeg)"
                }
            }
            // Heredar marcador de recurrencia si el segmento no trae el suyo.
            if i > 0, let rec = inheritedRecurrenceMarker {
                let segLower = workingSeg.lowercased()
                let alreadyHasRec = segLower.contains("todos los") || segLower.contains("cada ")
                    || segLower.contains("de por medio") || segLower.contains("día por medio")
                    || segLower.contains("dia por medio")
                if !alreadyHasRec {
                    workingSeg = "\(rec) \(workingSeg)"
                }
            }
            // Reordenamiento estructural: "a las X [verbo]" → "[verbo] a las X".
            // Patrón típico tras splitear por "luego/después": "a las 3 ducharme"
            // queda con la hora al principio y el parser no extrae bien el
            // título. Si invertimos el orden, "ducharme a las 3" matchea los
            // patrones de event/chore triggers normalmente.
            workingSeg = reorderTimeFirstSegment(workingSeg)
            // Si hay reminder compartido, lo appendamos antes de parsear.
            if let suffix = sharedReminderSuffix {
                workingSeg = "\(workingSeg) \(suffix)"
            }
            // Inyectamos el offset/nota de recordatorio de ESTE segmento para
            // que cada evento del lote use su propio aviso (no el primero).
            // groupOffset cubre los eventos sin offset propio en avisos grupales.
            intents.append(injectSegmentReminder(parse(workingSeg, context: context), segment: workingSeg, groupOffset: groupOffset))
        }
        return intents
    }

    /// Si el segmento es una directiva de reminder COMPARTIDA (aplica al
    /// grupo entero), devuelve un suffix que se appendará a cada segmento
    /// previo. Ejemplos:
    ///   "y recuérdame 15 min antes de cada clase" → "acuérdame 15 min antes"
    ///   "y avísame 30 minutos antes" → "avísame 30 minutos antes"
    /// Si no es una directiva grupal (típico reminder single-event), devuelve nil.
    private static func extractGroupReminderSuffix(from segment: String) -> String? {
        let lower = segment.lowercased()
        // Solo aplica si menciona "cada/los/las" — indica que el reminder es para varios eventos.
        let isGroupDirective = lower.contains("cada clase") || lower.contains("cada evento")
            || lower.contains("cada reunión") || lower.contains("cada reunion")
            || lower.contains("cada uno") || lower.contains("cada una")
            || lower.contains("cada bloque") || lower.contains("cada sesión") || lower.contains("cada sesion")
            || lower.contains("cada partido") || lower.contains("cada entrenamiento")
        guard isGroupDirective else { return nil }
        // Extraer el N + unidad. Reutilizamos extractReminderOffset que ya
        // hace todo el trabajo en NovaActionNormalizer.
        guard let mins = NovaActionNormalizer.extractReminderOffset(from: segment) else { return nil }
        // Reconstruir un suffix simple y canónico para los segmentos previos.
        if mins % 60 == 0 && mins >= 60 {
            return "acuérdame \(mins / 60) horas antes"
        }
        return "acuérdame \(mins) min antes"
    }

    /// Si el segmento comienza con "a la(s) HH(:MM)" seguido de un verbo
    /// (presumiblemente la acción), reordena moviendo la hora al final.
    /// Ej: "a las 3 ducharme" → "ducharme a las 3". Sin cambios si la
    /// estructura no matchea — la mayoría de frases bien formadas
    /// ("ducharme a las 3", "agenda dentista mañana 10") pasan tal cual.
    private static func reorderTimeFirstSegment(_ seg: String) -> String {
        let trimmed = seg.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = #"^(a la?s?\s+\d{1,2}(?::\d{2})?)\s+(\S.*)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(location: 0, length: (trimmed as NSString).length)
              ),
              match.numberOfRanges >= 3,
              match.range(at: 1).location != NSNotFound,
              match.range(at: 2).location != NSNotFound
        else { return seg }
        let ns = trimmed as NSString
        let timePart = ns.substring(with: match.range(at: 1))
        let restPart = ns.substring(with: match.range(at: 2))
        // Heurística: el "resto" debe parecer un verbo / acción (no otra
        // hora ni filler). Aceptamos si empieza con letra y tiene ≥ 3 chars.
        guard let firstChar = restPart.first,
              firstChar.isLetter,
              restPart.count >= 3
        else { return seg }
        return "\(restPart) \(timePart)"
    }

    /// Conectores fuertes que indican una nueva acción dentro de la misma
    /// frase. Ordenados por longitud descendente — los más largos primero
    /// para que "y luego" gane sobre "luego" cuando coexisten.
    private static let strongConnectors: [String] = [
        " y luego ",
        " y después ",
        " y despues ",
        " y además ",
        " y ademas ",
        " y también ",
        " y tambien ",
        " luego ",
        " después de eso ",
        " despues de eso ",
        " después ",   // OJO: "después de" se mantiene como conector → split antes del "de"
        " despues ",
        " además ",
        " ademas ",
        " también ",
        " tambien "
    ]

    /// Splittea el texto en segmentos por conectores fuertes. Cada conector
    /// se reemplaza por un marker único y luego se separa por ese marker.
    ///
    /// **Bonus: split por " y " SOLO si ambos lados tienen su propia hora**.
    /// Esto cubre el caso "seguir trabajo a las 1 y comer a las 7" → 2 intents
    /// SIN romper casos sin hora propia tipo "comprar pan y leche" o
    /// "reunión con Juan y Pedro a las 5" (donde " y " forma parte del título).
    ///
    /// Heurística: para cada `" y "` ocurrencia, miramos si HAY un patrón de
    /// hora ANTES del " y " (en lo que sería el segmento izquierdo) Y
    /// DESPUÉS del " y " (en el segmento derecho). Si ambos tienen hora,
    /// es split seguro. Si solo uno o ninguno, NO split.
    ///
    /// Devuelve segmentos no vacíos, trimeados.
    private static func splitOnStrongConnectors(_ text: String) -> [String] {
        let marker = "‖SEG‖"
        var working = text
        // Primera pasada: conectores explícitos siempre splittean.
        for connector in strongConnectors {
            working = working.replacingOccurrences(
                of: connector,
                with: marker,
                options: [.caseInsensitive]
            )
        }
        // Pasada 1b: trigger de recordatorio mid-sentence preserva el trigger.
        // "tengo clase a las 5 acuérdame de salir" → ["tengo clase a las 5",
        // "acuérdame de salir"]. Distinto a `strongConnectors` que CONSUME el
        // conector — acá lo CONSERVAMOS para que el segmento 2 mantenga el
        // trigger y se interprete como reminder.
        working = applyReminderTriggerSplit(working, marker: marker)
        // Pasada 2: " y " con heurística de hora-en-ambos-lados.
        working = applySmartYSplit(working, marker: marker)
        // Pasada 2b: comas entre eventos con hora ("gym a las 7, desayuno a
        // las 8 y reunión a las 10") — separa la lista en eventos.
        working = applySmartCommaSplit(working, marker: marker)
        // Pasada 2c: " y <verbo-tarea>" tras un evento con hora ("reunión a
        // las 3 y comprar pan") — separa el evento de la tarea.
        working = applyEventTaskYSplit(working, marker: marker)
        return working
            .components(separatedBy: marker)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Split en comas cuando AMBOS lados tienen su propia hora (lista de
    /// eventos). No toca listas sin horas ("pan, leche, huevos") ni cláusulas
    /// trailing sin hora ("reunión a las 3, importante").
    private static func applySmartCommaSplit(_ text: String, marker: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: ",\\s+") else { return text }
        let hourRegex = try? NSRegularExpression(pattern: hourMarkerPattern, options: [.caseInsensitive])
        let lower = text.lowercased()
        let lowerNS = lower as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
        guard !matches.isEmpty else { return text }
        var result = text
        func hasHour(_ s: String) -> Bool {
            hourRegex?.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
        }
        for match in matches.reversed() {
            let left = lowerNS.substring(to: match.range.location)
            let right = lowerNS.substring(from: match.range.location + match.range.length)
            if hasHour(left) && hasHour(right) {
                result = (result as NSString).replacingCharacters(in: match.range, with: marker)
            }
        }
        return result
    }

    /// Split " y <verbo-tarea>" cuando el lado izquierdo tiene hora (un
    /// evento) y el derecho empieza con un verbo de tarea SIN hora propia.
    /// Separa "reunión a las 3 y comprar pan" → evento + tarea. NO rompe
    /// "comprar pan y leche" (izq sin hora) ni "Juan y Pedro a las 5".
    private static func applyEventTaskYSplit(_ text: String, marker: String) -> String {
        let taskVerbs = "comprar|llamar|pagar|mandar|enviar|recoger|sacar|devolver|imprimir|firmar|reservar|responder|contestar|cancelar|cotizar|depositar|retirar|avisarle|escribirle"
        guard let regex = try? NSRegularExpression(
            pattern: "\\s+y\\s+(?=(?:\(taskVerbs))\\b)", options: [.caseInsensitive]
        ) else { return text }
        let hourRegex = try? NSRegularExpression(pattern: hourMarkerPattern, options: [.caseInsensitive])
        let lower = text.lowercased()
        let lowerNS = lower as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
        guard !matches.isEmpty else { return text }
        var result = text
        func hasHour(_ s: String) -> Bool {
            hourRegex?.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
        }
        for match in matches.reversed() {
            let left = lowerNS.substring(to: match.range.location)
            let right = lowerNS.substring(from: match.range.location + match.range.length)
            // Izquierda con hora (evento), derecha SIN hora (tarea pura).
            if hasHour(left) && !hasHour(right) {
                result = (result as NSString).replacingCharacters(in: match.range, with: marker)
            }
        }
        return result
    }

    /// Splittea cuando aparece un trigger de recordatorio mid-sentence,
    /// **preservando** el trigger en el segmento siguiente. Cubre el caso
    /// del usuario (Caso A del spec):
    ///   "tengo clases tipo 5:30 acuérdame de salir en 10 min"
    /// debe partirse a:
    ///   - "tengo clases tipo 5:30" (evento clase)
    ///   - "acuérdame de salir en 10 min" (reminder salir +10m)
    ///
    /// Solo activa cuando el trigger aparece DESPUÉS del primer caracter
    /// (no al inicio) y va seguido de una acción reconocible — para no
    /// romper frases simples tipo "acuérdame llamar a mamá".
    private static func applyReminderTriggerSplit(_ text: String, marker: String) -> String {
        let triggers = [
            "acuérdame", "acuerdame", "acordame",
            "acuérdate", "acuerdate",
            "recuérdame", "recuerdame", "recordame",
            "avísame", "avisame",
        ]
        var result = text
        // Para cada trigger, busca su PRIMERA ocurrencia que no esté al
        // inicio. Si está precedida por al menos N caracteres de "contenido"
        // (no solo whitespace/markers), inserta marker antes del trigger.
        // Procesamos en orden de longitud descendente para evitar matches
        // parciales (recuérdame vs recordame).
        let sortedTriggers = triggers.sorted { $0.count > $1.count }
        for trigger in sortedTriggers {
            let lower = result.lowercased()
            let triggerPattern = "\\b" + NSRegularExpression.escapedPattern(for: trigger) + "\\b"
            guard let regex = try? NSRegularExpression(pattern: triggerPattern, options: [.caseInsensitive]) else {
                continue
            }
            let ns = lower as NSString
            let range = NSRange(location: 0, length: ns.length)
            guard let match = regex.firstMatch(in: lower, options: [], range: range) else { continue }
            // Si el trigger empieza dentro de los primeros 4 chars del texto
            // (después de trim), no es mid-sentence — es el inicio de la
            // intención. NO splitear.
            let leftBeforeTrigger = ns.substring(
                with: NSRange(location: 0, length: match.range.location)
            ).trimmingCharacters(in: .whitespacesAndNewlines)
            if leftBeforeTrigger.count < 8 { continue }
            // El segmento izquierdo debe tener al menos UN marcador de
            // hora — si no, probablemente es una sola frase larga.
            let hourRegex = try? NSRegularExpression(pattern: hourMarkerPattern, options: [.caseInsensitive])
            let hasHourLeft = hourRegex?.firstMatch(
                in: leftBeforeTrigger,
                range: NSRange(location: 0, length: (leftBeforeTrigger as NSString).length)
            ) != nil
            // Si la izquierda no tiene hora, es probable que el trigger sea
            // parte de la intención principal — NO splitear.
            if !hasHourLeft { continue }
            // Excepción crítica: NO splitear cuando el trigger introduce un
            // OFFSET DE AVISO ("acuérdame 40 minutos antes", "recuérdame
            // media hora antes", "acuérdame a las 12:50") — esos son
            // modificadores del mismo bloque, no acciones separadas.
            //   - "X a las 6:30 acuérdame 40 minutos antes" → 1 evento + offset
            //   - "X a las 6:30 acuérdame de salir en 10 min" → 2 acciones
            let rightAfterTrigger = ns.substring(
                from: match.range.location + match.range.length
            )
            let rightLower = rightAfterTrigger.trimmingCharacters(in: .whitespacesAndNewlines)
            // Excepción: el trigger AL FINAL ("buscar a la Agustina tipo 3
            // acuérdate") es solo una confirmación tonal, no una acción
            // nueva. Sin contenido sustantivo después no hay segmento 2.
            // Threshold conservador: <6 chars de "right" → NO splitear.
            if rightLower.count < 6 { continue }
            // Patrones que indican "modificador de offset", no acción nueva:
            //   - "N min/hora antes [de X]"
            //   - "palabra-numérica min/hora antes [de X]"
            //   - "a las HH(:MM)" (reminder absoluto)
            let offsetPatterns: [String] = [
                #"^\s*\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#,
                #"^\s*(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|media|medio)\s+(min|minutos?|h|hs|hrs?|horas?)\s+antes\b"#,
                #"^\s*a la?s?\s+\d{1,2}(:\d{2})?\b"#,
            ]
            var looksLikeOffset = false
            for pattern in offsetPatterns {
                if rightLower.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                    looksLikeOffset = true
                    break
                }
            }
            if looksLikeOffset { continue }
            // Excepción adicional (user spec 2026-05-27): si el trigger va
            // seguido de "de <verbo-de-detalle>" (llevar/comprar/traer/etc.)
            // o de "no olvidar X", entonces es un DETALLE del evento previo,
            // NO una acción separada. Caso central:
            //   "futbol a las 5 acordarme de llevar la pelota"
            //     → seg1 evento Fútbol + subtítulo "Llevar la pelota"
            //   debe quedar como UN solo ítem, no dos.
            //
            // El extractor `NovaActionNormalizer.extractEventDetail` re-captura
            // ese mismo span desde el `userText` original para usarlo como
            // subtitle del evento principal.
            let detailVerbAlt = "llevar(?:me)?|comprar(?:me)?|traer(?:me)?|preparar(?:me)?|hablar|imprimir|estudiar|revisar(?:me)?|pedir(?:me)?|arreglar(?:me)?|mandar(?:me)?|hacer|firmar|entregar(?:me)?|enviar(?:me)?|sacar(?:me)?|cargar|recoger|terminar|finalizar"
            let detailFollowupPatterns: [String] = [
                "^\\s*de\\s+(?:\(detailVerbAlt))\\s+",
                "^\\s*(?:no\\s+olvidar(?:me)?)\\s+",
                "^\\s*por\\s+el\\s+tema\\b",
            ]
            var looksLikeDetail = false
            for pattern in detailFollowupPatterns {
                if rightLower.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                    looksLikeDetail = true
                    break
                }
            }
            if looksLikeDetail { continue }
            // Inserta marker justo antes del trigger.
            let resultNs = result as NSString
            result = resultNs.replacingCharacters(
                in: NSRange(location: match.range.location, length: 0),
                with: marker + " "
            )
            // Solo splitamos por el PRIMER trigger encontrado; bajar a uno
            // solo split mantiene baja la complejidad para beta. Si hay
            // 3 acciones encadenadas con triggers, el backend las maneja.
            break
        }
        return result
    }

    /// Patrón regex que detecta una **hora** en español. Cubre:
    ///   - "a las 7", "a las 13:30"
    ///   - "a la 1" (singular)
    ///   - "tipo 5", "tipo las 8"
    ///   - "07:00", "13:45"
    ///   - "en 5 minutos", "en 1 hora"
    /// Excluye cosas como "1 manzana" o "2 personas" — requiere preposición
    /// o ":" o "minutos/horas" cerca.
    private static let hourMarkerPattern: String = {
        let core = #"(a la(s)?\s+\d{1,2}(:\d{2})?(\s*(am|pm|hrs?|hs))?)"#
        let bare = #"(\b\d{1,2}:\d{2}\b)"#
        let tipo = #"(\btipo\s+(la(s)?\s+)?\d{1,2}(:\d{2})?\b)"#
        let relative = #"(\ben\s+\d{1,3}\s*(min|minutos?|h|hs|hrs?|horas?)\b)"#
        // Horas en PALABRAS — "a las tres", "a la una", "tipo cuatro". El
        // smart " y " split necesita reconocerlas para que
        // "estudiar a las cinco y llamar a las ocho" splittee correctamente.
        let words = #"(\b(?:a la?s?|tipo (?:las? )?|como a la?s?|a eso de la?s?)\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b)"#
        return "(\(core)|\(bare)|\(tipo)|\(relative)|\(words))"
    }()

    /// Palabras de minuto que pueden seguir a "[hora-palabra] y" para formar
    /// expresiones como "a las tres y media", "cinco y cuarto", "siete y
    /// treinta". Cuando el smart " y " split encuentra una " y " seguida por
    /// alguna de estas palabras, NO debe splittear — la " y " forma parte
    /// de la expresión de tiempo, no es un conector entre acciones.
    private static let minuteFollowupWords = "(?:media|cuarto|diez|quince|veinte|veinticinco|treinta)"

    /// Split por " y " inteligente. Pasa por TODAS las ocurrencias de
    /// `\b y \b` del texto y, para cada una, evalúa si ambos lados tienen
    /// su propia hora. Si sí → reemplaza por el marker. Si no → respeta
    /// el "y" como parte del título.
    ///
    /// Ejemplos:
    /// - "seguir trabajo a las 1 y comer a las 7" → SPLIT (hora en ambos)
    /// - "comprar pan y leche" → NO SPLIT (sin horas)
    /// - "reunión con Juan y Pedro a las 5" → NO SPLIT (solo derecha tiene hora)
    /// - "despertarme a las 7 y salir a las 8" → SPLIT
    private static func applySmartYSplit(_ text: String, marker: String) -> String {
        let lower = text.lowercased()
        // Buscar TODAS las ocurrencias de " y " (con espacios). EXCLUYE las
        // que son parte de expresión de hora ("tres y media", "cinco y cuarto",
        // "siete y veinte") usando negative lookahead — ese " y " no separa
        // acciones, es parte del time fragment.
        let yConnectorPattern = "\\s+y\\s+(?!\(minuteFollowupWords)\\b)"
        guard let regex = try? NSRegularExpression(
            pattern: yConnectorPattern, options: [.caseInsensitive]
        ) else { return text }

        let ns = text as NSString
        let lowerNS = lower as NSString
        let range = NSRange(location: 0, length: ns.length)
        let matches = regex.matches(in: text, options: [], range: range)

        guard !matches.isEmpty else { return text }

        // Para cada match, decidir si separa. Procesamos en REVERSO para
        // que los offsets no se invaliden al reemplazar.
        var result = text
        let hourRegex = try? NSRegularExpression(
            pattern: hourMarkerPattern, options: [.caseInsensitive]
        )
        for match in matches.reversed() {
            let leftSegment = lowerNS.substring(with: NSRange(
                location: 0, length: match.range.location
            ))
            let rightSegment = lowerNS.substring(with: NSRange(
                location: match.range.location + match.range.length,
                length: lowerNS.length - (match.range.location + match.range.length)
            ))
            let leftHasHour = hourRegex?.firstMatch(
                in: leftSegment,
                range: NSRange(location: 0, length: (leftSegment as NSString).length)
            ) != nil
            let rightHasHour = hourRegex?.firstMatch(
                in: rightSegment,
                range: NSRange(location: 0, length: (rightSegment as NSString).length)
            ) != nil
            if leftHasHour && rightHasHour {
                // Split seguro.
                result = (result as NSString).replacingCharacters(
                    in: match.range, with: marker
                )
            }
        }
        return result
    }

    /// Parser principal. `context` permite resolver referencias como
    /// "agéndalo X" o "y X" en base al último intent.
    static func parse(_ text: String, context: NovaContext = NovaContext()) -> NovaIntent {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        if invalidTemporalInput(lower) { return .clarify(reason: .unclear) }

        // ──────────────────────────────────────────────────────────────
        // -2. Confirmación de plan de acción pendiente. Si el turno
        //     anterior generó una propuesta y el usuario contesta
        //     afirmativamente corto ("sí, agrégalo", "dale", "agrégalas",
        //     "ok", "perfecto"), creamos las tareas. Se chequea ANTES de
        //     todo lo demás para que respuestas cortas no caigan al
        //     flujo de createTask con título "sí".
        // ──────────────────────────────────────────────────────────────
        if let plan = context.pendingActionPlan, !plan.isEmpty, context.isFresh {
            if matchesAffirmativeConfirmation(lower) {
                return .confirmActionPlan
            }
            // Distribución temporal del plan ("organízamelo para hoy y mañana",
            // "para hoy", "para mañana"). Es una confirmación + directiva de
            // distribución; el handler de `.confirmActionPlan` mira userText
            // para decidir cómo repartir.
            let distributionTriggers = [
                "organízamelo", "organizamelo", "organízalo", "organizalo",
                "ordéname", "ordename", "repártelo", "repartelo", "reparte",
                "agrégalas para", "agregalas para",
                "para hoy y mañana", "para hoy y manana",
                "para mañana", "para manana",
                "para hoy",
                "ponlas para", "déjalas para", "dejalas para",
                "distribúyelas", "distribuyelas"
            ]
            if matchesAny(lower, distributionTriggers) {
                return .confirmActionPlan
            }
            if matchesAny(lower, ["no", "cancela", "déjalo", "dejalo", "olvídalo", "olvidalo"]),
               lower.count <= 30 {
                // Cancela la propuesta; devolvemos smalltalk neutro.
                return .smallTalk(reply: "Listo, lo dejo así. Si más tarde quieres retomar la lista, pégamela de nuevo y la organizamos.")
            }
        }

        // ──────────────────────────────────────────────────────────────
        // -1.5. Detector de PLAN DE ACCIÓN: texto largo con múltiples
        //       acciones independientes (3+ líneas con verbos imperativos
        //       o frases separadas claramente). Nova NO ejecuta — propone.
        //       Antes este input caía al createEvent / createTask y se
        //       mezclaba como un único bloque gigante o se ignoraba.
        // ──────────────────────────────────────────────────────────────
        if let actions = detectActionPlan(text: trimmed), actions.count >= 3 {
            return .proposeActionPlan(actions: actions)
        }
        let baseWantsReminder = matches(lower, [
            "acuérdame", "acuerdame", "acordame",
            "acuérdate", "acuerdate",
            "acuérdalo", "acuerdalo",
            "acordarme",
            "recuérdame", "recuerdame", "recordame", "recordarme",
            "no olvides", "no te olvides",
            "que no se me olvide", "que me acuerde",
            // Agregados 2026-05-26 (caso 46 del 50-test): "pon alarma"
            // / "ponme alarma" / "alarma para" → recordatorio puntual,
            // no evento horario.
            "pon una alarma", "pon alarma", "ponme alarma", "ponme una alarma",
            "alarma para", "alarma a las"
        ])
        // Obligación con hora puntual ("tengo que X a las N", "necesito X
        // a las N", "debo X a las N") → recordatorio, **salvo** cuando el
        // verbo siguiente es de actividad/movimiento claro ("ir", "asistir",
        // "llegar", "estar"). "tengo que ir al doctor a las 5" es un
        // evento real, no un recordatorio puntual. Cubre caso 26 del 50-test.
        let activityObligationPattern = #"\b(?:tengo que|necesito|debo)\s+(?:ir|asistir|llegar|estar|salir|venir|volver|pasar)\b"#
        let hasActivityObligation = lower.range(
            of: activityObligationPattern,
            options: [.regularExpression]
        ) != nil
        let isObligationWithTime = hasTimeMarker(lower)
            && matchesAny(lower, ["tengo que ", "necesito ", "debo "])
            && !hasActivityObligation
        // Verbos puntuales (despertar/levantar/amanecer) — implican momento,
        // no duración. Centralizado en NovaActionNormalizer.
        let isPunctualVerb = NovaActionNormalizer.impliesPunctualReminder(in: lower)
        let wantsReminder = baseWantsReminder || isObligationWithTime || isPunctualVerb

        // ──────────────────────────────────────────────────────────────
        // -1. Memoria corta: si Nova preguntó algo (pendingClarification
        //     activo), tratamos la respuesta como follow-up para completar
        //     la acción original.
        //
        //     Cubre casos:
        //       "tengo parcial el jueves" → "¿A qué hora?" → "a las 3"
        //       "recuérdame llamar a Juan" → "¿Cuándo?" → "mañana a las 5"
        //       "agenda reunión con Pedro" → "¿Día y hora?" → "mañana 17:00"
        //       "buscar agustina en 20" → "¿20:00 o +20 min?" → "+20 min"
        //
        //     Si el follow-up resuelve la acción, devolvemos el intent
        //     completo. Si no resuelve (texto largo, nueva acción), caemos
        //     al flujo normal.
        // ──────────────────────────────────────────────────────────────
        if context.pendingIsActive,
           let pending = context.pendingClarification,
           let resolved = resolvePendingFollowUp(
               trimmed: trimmed,
               lower: lower,
               wantsReminder: wantsReminder,
               pending: pending
           ) {
            return resolved
        }

        // ──────────────────────────────────────────────────────────────
        // -0.5. Corrección semántica sobre TAREA: "la planilla no era
        //       para profesores, era para Juan". Detección PREVIA a la
        //       sección 0 (correctLastEvent) porque ahí "no era ..., era
        //       ..." caía como deleteLastItem por isCorrectionStart.
        // ──────────────────────────────────────────────────────────────
        if let taskCorrection = detectTaskCorrection(text: trimmed, lower: lower) {
            return taskCorrection
        }

        // ──────────────────────────────────────────────────────────────
        // -0.4. Dependencia entre tareas: "antes de mandar el correo
        //       necesito la planilla". También antes de sección 0 porque
        //       "antes de" puede aparentar corrección.
        // ──────────────────────────────────────────────────────────────
        if let dependency = detectDependency(text: trimmed, lower: lower) {
            return dependency
        }

        // ──────────────────────────────────────────────────────────────
        // 0. Correcciones al último intent: "no, mañana", "ponlo como tarea",
        //    "cámbialo a las 18", "en sala H013". Requieren contexto fresco.
        //    **Excepción**: queries tipo "no tengo nada hoy" o
        //    "qué tengo / muéstrame" caen como reviewToday (sección 3a),
        //    no como corrección — el "no" inicial no es negación de la
        //    propuesta previa. Cubre caso 41 del 50-test.
        // ──────────────────────────────────────────────────────────────
        let looksLikeQuery = matches(lower, [
            "qué tengo", "que tengo", "no tengo nada",
            "muéstrame", "muestrame", "qué hay", "que hay",
            "ver mi día", "ver mi dia"
        ])
        if isCorrectionStart(lower), context.isFresh, !looksLikeQuery {
            // "bórralo" / "elimínalo" / "no, bórralo".
            if matches(lower, ["bórralo", "borralo", "elimínalo", "eliminalo", "borrar", "elimina eso"]) {
                return .deleteLastItem
            }
            // "ponlo como tarea" / "pásalo a tarea" → convertir.
            if matches(lower, ["como tarea", "ponlo como tarea", "pásalo a tarea", "pasalo a tarea", "convierte en tarea"]) {
                return .convertLastToTask
            }
            // "era con Pedro" / "no era Juan, era Pedro" / "era X" → cambia título.
            // Buscamos "era " + texto restante (limpiamos posibles "no era X,").
            if let newTitle = extractTitleAfterEra(lower: lower, original: trimmed) {
                return .correctLastEvent(modifier: .setTitle(newTitle))
            }
            // "no, mañana" / "no mañana" / "mejor mañana" / "ponlo mañana".
            if (lower.contains("mañana") || lower.contains("manana"))
                && !lower.contains("pasado mañana") && !lower.contains("pasado manana") {
                return .correctLastEvent(modifier: .shiftDays(offset: 1))
            }
            // "no, hoy" / "mejor hoy" (cuando contexto está en otro día).
            if lower.contains("hoy") {
                // Compute offset: cuántos días entre lastDate y hoy.
                if let lastDate = context.lastDate {
                    let cal = Calendar.current
                    let comps = cal.dateComponents([.day], from: cal.startOfDay(for: lastDate), to: cal.startOfDay(for: Date()))
                    let offset = comps.day ?? 0
                    if offset != 0 {
                        return .correctLastEvent(modifier: .shiftDays(offset: offset))
                    }
                }
            }
            // "cámbialo a las 18" / "ponlo a las 18".
            if let (h, m) = extractHourMinute(from: lower) {
                return .correctLastEvent(modifier: .setTime(hour: h, minute: m))
            }
            // "en sala H013" como corrección sola.
            if let loc = extractLocation(from: trimmed) {
                return .correctLastEvent(modifier: .setLocation(loc))
            }
            // "no" sin más → clarify.
            return .clarify(reason: .noContext)
        }

        // ──────────────────────────────────────────────────────────────
        // 1. Referencias al contexto: "agéndalo", "agéndalo como tarea X",
        //    "agéndame eso", "ponlo como tarea", "y como tarea recurrente".
        //    Solo válidas si hay contexto fresco con un título.
        // ──────────────────────────────────────────────────────────────
        if isContextReference(lower), context.isFresh, let lastTitle = context.lastTitle {
            // ¿El usuario quiere CAMBIAR el tipo (a tarea) o solo confirmar?
            if matchesAny(lower, ["tarea", "como tarea", "pendiente", "anótalo"]) {
                let recurrence = detectRecurrence(lower)
                return .createTask(
                    title: lastTitle,
                    dueDate: context.lastDate,
                    recurrence: recurrence,
                    wantsReminder: wantsReminder
                )
            }
            // Si menciona "evento" o no menciona tipo → tratar como evento.
            let when = extractDateTime(from: lower) ?? context.lastDate
            let location = extractLocation(from: trimmed) ?? context.lastLocation
            let section = context.lastSection ?? detectSection(in: lower)
            if when == nil {
                return .clarify(reason: .eventNeedsDateTime(title: lastTitle))
            }
            let explicitEnd = when.flatMap { extractExplicitEndTime(from: lower, startTime: $0) }
            return .createEvent(
                title: lastTitle,
                when: when,
                endTime: explicitEnd,
                location: location,
                section: section,
                wantsReminder: wantsReminder
            )
        }

        // Explicit commitments share the normal execution/persistence boundary.
        // Context continuations above retain precedence; never strip the action verb.
        if let title = NovaLocalRoutingPolicy.scheduledCommitmentTitle(trimmed) {
            guard let when = extractDateTime(from: lower) else {
                return .clarify(reason: .eventNeedsDateTime(title: title))
            }
            return .createEvent(title: title, when: when, endTime: nil,
                                location: nil, section: guessSection(for: title), wantsReminder: false)
        }

        // ──────────────────────────────────────────────────────────────
        // 2. Borrar ejemplos / demo — siempre redirige a Ajustes.
        // ──────────────────────────────────────────────────────────────
        if matches(lower, [
            "borra ejemplo", "borrar ejemplo", "quita ejemplo", "quitar ejemplo",
            "limpia ejemplo", "limpiar ejemplo",
            "borra demo", "quita demo", "limpia demo",
            "borra los ejemplo", "quita los ejemplo",
            "borrar datos demo", "borrar datos local"
        ]) {
            return .askAboutDemo
        }

        // ──────────────────────────────────────────────────────────────
        // 2-bis. Reagendar evento existente por título: "mueve fútbol a
        //        las 5", "cambia clase de arte a las 11". Detección early
        //        para que NO caiga al createEvent y termine duplicando.
        // ──────────────────────────────────────────────────────────────
        if let reschedule = detectRescheduleByActivity(text: trimmed, lower: lower) {
            return reschedule
        }

        // ──────────────────────────────────────────────────────────────
        // 2-quater. Atribuir reminder a evento existente: "ponle
        //           recordatorio media hora antes al fútbol", "el
        //           recordatorio del fútbol es media hora antes".
        //           Sin esto, "ponle recordatorio ... al fútbol" caía a
        //           createEvent y duplicaba ("Ponle recordatorio").
        //           Detección antes que el flujo de createEvent.
        // ──────────────────────────────────────────────────────────────
        if let attach = detectAttachReminderToEvent(text: trimmed, lower: lower) {
            return attach
        }

        // 2-quintus / 2-sextus se MOVIERON a sección -0.5 / -0.4 para
        // ganarle a sección 0 (correctLastEvent), que con "no era / era"
        // disparaba un deleteLastItem incorrecto.

        // ──────────────────────────────────────────────────────────────
        // 2-ter. Borrar evento existente por título: "borra lo de
        //        estudiar comunicación", "elimina fútbol". Antes esto
        //        caía al createTask y creaba una tarea con ese título.
        // ──────────────────────────────────────────────────────────────
        if let deletion = detectDeleteByActivity(text: trimmed, lower: lower) {
            return deletion
        }

        // ──────────────────────────────────────────────────────────────
        // 3a. Vista general del día (eventos + tareas).
        // ──────────────────────────────────────────────────────────────
        if matches(lower, [
            "qué tengo hoy", "que tengo hoy",
            "qué hay hoy", "que hay hoy",
            "qué tengo agendado", "que tengo agendado",
            "qué sigue", "que sigue", "qué hago ahora", "que hago ahora",
            "qué más tengo", "que mas tengo",
            // Agregados 2026-05-26 (casos 22, 41 del 50-test):
            "qué tengo mañana", "que tengo mañana", "que tengo manana",
            "qué hay mañana", "que hay mañana",
            "no tengo nada hoy", "no tengo nada mañana",
            "muéstrame mis pendientes", "muestrame mis pendientes",
            "muéstrame mi día", "muestrame mi dia", "muéstrame el día",
            "ver mi día", "ver mi dia",
            "qué tengo en el día", "que tengo en el dia"
        ]) {
            return .reviewToday
        }

        // ──────────────────────────────────────────────────────────────
        // 3b. Revisar solo tareas pendientes.
        // ──────────────────────────────────────────────────────────────
        if matches(lower, [
            "revisa pendientes", "revisar pendientes",
            "qué tengo pendiente", "que tengo pendiente",
            "qué me queda pendiente", "que me queda pendiente",
            "qué me falta", "que me falta",
            "qué pendientes tengo", "que pendientes tengo",
            "qué cosas tengo pendiente", "que cosas tengo pendiente",
            "qué cosas tengo pendientes", "que cosas tengo pendientes",
            "qué tengo que hacer", "que tengo que hacer"
        ]) {
            return .reviewPending
        }

        // ──────────────────────────────────────────────────────────────
        // 4. Organizar el día.
        // ──────────────────────────────────────────────────────────────
        if matches(lower, [
            "organiza mi día", "organiza mi dia",
            "organiza el día", "organiza el dia",
            "organízame", "organizame",
            "planifica mi día", "planifica mi dia",
            "ordena mi día", "ordena mi dia",
            "ordéname el día", "ordename el dia",
            "ordéname la tarde", "ordename la tarde",
            "ordéname la mañana", "ordename la manana",
            "arma mi día", "arma mi dia",
            "ármame el día", "armame el dia",
            "acomoda mi día", "acomoda mi dia",
            // Agregados 2026-05-26 (caso 24 del 50-test):
            "organizar mi día", "organizar mi dia",
            "organizar el día", "organizar el dia",
            "ayúdame a organizar", "ayudame a organizar",
            "ordenar mi día", "ordenar mi dia"
        ]) {
            return .organizeDay
        }

        // ──────────────────────────────────────────────────────────────
        // 4.5. Chat emocional / pedido de ayuda. Si el texto expresa
        //      estado interior (estrés, cansancio, abrumo) o pide ayuda
        //      genérica, respondemos como chat humano antes de caer al
        //      flujo de createTask. Sin este chequeo, "me siento cansado
        //      pero tengo que avanzar" caía como tarea "Avanzar igual".
        // ──────────────────────────────────────────────────────────────
        if let emotional = detectEmotionalChat(lower) {
            return .smallTalk(reply: emotional)
        }

        // ──────────────────────────────────────────────────────────────
        // 5. Tarea explícita: "tengo que X", "recordarme/recuérdame X",
        //    "anota tarea X", "crea tarea X", verbos de quehacer
        //    ("comprar X", "llamar X", "responder X", "preparar X",
        //    "revisar X") cuando NO hay hora explícita.
        // ──────────────────────────────────────────────────────────────
        if let title = extractAfter(trimmed, triggers: [
            "crea tarea", "crea una tarea",
            "nueva tarea", "agrega tarea", "agregar tarea",
            "anota tarea", "anota:", "tarea:"
        ], allowedTrailingPunct: ":.") {
            if title.isEmpty { return .clarify(reason: .taskNeedsTitle) }
            let when = extractDateTime(from: lower)
            let recurrence = detectRecurrence(lower)
            return .createTask(
                title: cleanTaskTitle(title, when: when),
                dueDate: when,
                recurrence: recurrence,
                wantsReminder: wantsReminder
            )
        }

        // "tengo que X" / "recordarme X" / "recuérdame X" / "avísame X" → tarea
        let taskActionTriggers = [
            "tengo que ", "recordarme ", "recuérdame ", "recuerdame ",
            "no olvides ", "no olvidar ",
            "avísame ", "avisame ", "avísame que ", "avisame que "
        ]
        if let title = extractAfter(trimmed, triggers: taskActionTriggers) {
            if title.isEmpty { return .clarify(reason: .taskNeedsTitle) }
            // Si después del trigger hay hora explícita ("recuérdame buscar a
            // la Agustina tipo 20"), es un RECORDATORIO PUNTUAL (evento con
            // isReminder=true), no una tarea sin hora. Caer al flujo de
            // evento más abajo — sección 6 lo capturará por el verbo
            // ("buscar a ") y sección 8 por la hora libre. wantsReminder ya
            // está seteado por matching ("recuérdame").
            if !hasTimeMarker(lower) {
                let when = extractDateTime(from: lower)
                let recurrence = detectRecurrence(lower)
                return .createTask(
                    title: cleanTaskTitle(title, when: when),
                    dueDate: when,
                    recurrence: recurrence,
                    wantsReminder: wantsReminder
                )
            }
            // hasTimeMarker: continúa al flujo de evento abajo.
        }

        // ──────────────────────────────────────────────────────────────
        // 5.5. Rango horario explícito sin verbo trigger.
        //      "reunión de 5 a 7", "entreno de 6 a 8", "psiquiatra el
        //      jueves de 12 a 1". El patrón "de N a M" es señal suficiente
        //      de evento aunque el sustantivo no esté en eventTriggers.
        //      Detección early para no caer a clarify cuando hay un
        //      rango horario explícito claro. (Casos 6, 8, 10 del 50-test.)
        // ──────────────────────────────────────────────────────────────
        let hasNumericRange = lower.range(
            of: #"\bde\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s+a\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b"#,
            options: .regularExpression
        ) != nil
        if hasNumericRange, let when = extractDateTime(from: lower) {
            // Título: strippeamos el rango "de N a M" y la palabra de día.
            var titleRaw = stripDateTimeMarkers(stripLocationMarker(trimmed))
            // Quitar el "de N a M" residual (el strip anterior puede no
            // cubrir todas las variantes — ej. "de 5 a 7" sin "a las").
            let rangePattern = #"\bde\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s+a\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b"#
            titleRaw = titleRaw.replacingOccurrences(
                of: rangePattern, with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
            titleRaw = stripFillers(titleRaw)
            let title = cleanupTitle(titleRaw)
            if !title.isEmpty {
                let location = extractLocation(from: trimmed)
                let section = detectSection(in: lower)
                let recurrence = detectRecurrence(lower)
                let explicitEnd = extractExplicitEndTime(from: lower, startTime: when)
                return .createEvent(
                    title: title, when: when, endTime: explicitEnd,
                    location: location, section: section,
                    wantsReminder: wantsReminder, recurrence: recurrence
                )
            }
        }

        // ──────────────────────────────────────────────────────────────
        // 6. Evento — verbos amplios para capturar lenguaje natural
        //    incluyendo informal ("salir a", "buscar a", "ir a").
        // ──────────────────────────────────────────────────────────────
        let eventTriggers = [
            "agenda", "agéndame", "agendame", "agendar",
            "agéndalo", "agendalo", "agéndala", "agendala",
            "ponme ", "ponme un ", "ponme una ", "ponme el ", "ponme la ",
            "crea evento", "crea un evento", "nuevo evento", "agrega evento",
            "reunión con", "reunion con",
            "tengo reunión", "tengo reunion",
            "tengo clase", "clase de", "clase con",
            "tengo prueba", "tengo parcial", "tengo examen", "tengo final",
            "tengo entrega",
            "tengo evento", "tengo cita", "tengo turno",
            "tengo médico", "tengo medico", "tengo doctor",
            "tengo dentista", "tengo terapia", "tengo kinesiólogo", "tengo kinesiologo",
            "tengo psicólogo", "tengo psicologo", "tengo psiquiatra",
            "salir a ", "salir con ", "salgo con ",
            "ir a ", "voy a ", "vamos a ",
            // Agregados 2026-05-26 (caso 29 del 50-test): "ir al X" / "voy
            // al X" — la contracción "al" no matcheaba "a " trigger.
            "ir al ", "voy al ", "vamos al ",
            "buscar a ", "ir a buscar ",
            "juntarme con ", "juntarnos con ", "junta con ", "me junto con ",
            "almuerzo con ", "cena con ", "desayuno con ", "café con "
        ]
        if matchesAny(lower, eventTriggers) {
            var title = extractEventTitle(trimmed, triggers: eventTriggers)
            let when = extractDateTime(from: lower)
            let location = extractLocation(from: trimmed)
            let section = detectSection(in: lower)
            let recurrence = detectRecurrence(lower)
            // Recovery: los triggers "tengo dentista/doctor/..." INCLUYEN el
            // sustantivo médico, así que extractEventTitle lo consume y deja el
            // título vacío. Sin esto, "tengo dentista el viernes a las 4 y
            // después comprar remedios" perdía el dentista (caía a clarify
            // vacío). Recuperamos el sustantivo del trigger.
            if title.isEmpty {
                let medicalNouns = ["dentista", "doctor", "médico", "medico",
                    "terapia", "cita", "turno", "kinesiólogo", "kinesiologo",
                    "psicólogo", "psicologo", "psiquiatra"]
                if let noun = medicalNouns.first(where: {
                    lower.range(of: "\\btengo \($0)\\b",
                                options: [.regularExpression, .caseInsensitive]) != nil
                }) {
                    title = noun.prefix(1).uppercased() + noun.dropFirst()
                }
            }
            if title.isEmpty {
                return .clarify(reason: .eventNeedsTitle)
            }
            // Distinguir trigger ACTIVO (usuario quiere AGENDAR un evento
            // ahora — debe preguntar hora si falta) vs PASIVO (usuario
            // describe una obligación pasiva — task con dueDate basta).
            // - Activos: "agenda", "agéndame", "ponme", "crea evento",
            //   "nuevo evento", "agrega evento". El usuario invoca a Nova
            //   a CREAR algo. Si falta hora, Nova debe preguntar →
            //   clarify(.eventNeedsTime/.eventNeedsDateTime) → guarda
            //   pending → user responde "a las 8" → completa el evento.
            // - Pasivos: "tengo X", "X con persona". El usuario menciona.
            //   Sin hora se trata como task (no requiere pregunta).
            let activeTriggers = [
                "agenda", "agéndame", "agendame", "agendar",
                "agéndalo", "agendalo", "agéndala", "agendala",
                "ponme", "crea evento", "crea un evento",
                "nuevo evento", "agrega evento"
            ]
            // Citas profesionales que típicamente requieren hora específica:
            // si el usuario las menciona sin hora, mejor preguntar que
            // crear task ambiguo. Cubre casos B "tengo dentista" del prompt.
            let medicalCueTriggers = [
                "tengo médico", "tengo medico", "tengo doctor",
                "tengo dentista", "tengo terapia",
                "tengo cita", "tengo turno",
                "tengo kinesiólogo", "tengo kinesiologo",
                "tengo psicólogo", "tengo psicologo", "tengo psiquiatra"
            ]
            let isActiveTrigger = matchesAny(lower, activeTriggers)
            let isMedicalCue = matchesAny(lower, medicalCueTriggers)
            let needsExactTime = isActiveTrigger || isMedicalCue

            if let partial = when {
                let hasExactTime = hasExactTimeMarker(lower)
                if !hasExactTime {
                    if needsExactTime {
                        // Appointment or explicit scheduling without a time → preguntar hora explícita.
                        // Caller persiste PendingClarification para que el
                        // siguiente turno "a las 8" complete el evento.
                        // Solo activos ("agenda reunión mañana") activan
                        // esto — médicos con día ya proveen contexto OK.
                        return .clarify(reason: .eventNeedsTime(
                            title: title, partialDate: partial
                        ))
                    }
                    // Pasivo o médico + día sin hora → task del día (sin
                    // freezar). "tengo dentista mañana" → task mañana es
                    // razonable, el usuario completará con hora después.
                    return .createTask(
                        title: cleanTaskTitle(title, when: partial),
                        dueDate: partial, recurrence: recurrence,
                        wantsReminder: wantsReminder
                    )
                }
                let explicitEnd = extractExplicitEndTime(from: lower, startTime: partial)
                return .createEvent(
                    title: title,
                    when: partial,
                    endTime: explicitEnd,
                    location: location,
                    section: section,
                    wantsReminder: wantsReminder,
                    recurrence: recurrence
                )
            }
            // Sin fecha tampoco.
            if needsExactTime {
                // "agenda reunión" / "tengo dentista" sin nada → preguntar día+hora.
                return .clarify(reason: .eventNeedsDateTime(title: title))
            }
            return .createTask(
                title: cleanTaskTitle(title, when: nil),
                dueDate: nil, recurrence: recurrence,
                wantsReminder: wantsReminder
            )
        }

        // ──────────────────────────────────────────────────────────────
        // 7. Quehaceres con verbo + complemento, sin "tengo que" explícito.
        //    Ej: "comprar materiales mañana", "llamar al dentista".
        //    Si hay hora → evento; si solo día o nada → tarea.
        // ──────────────────────────────────────────────────────────────
        let choreVerbs = [
            "comprar ", "llamar ", "responder ", "estudiar ",
            "preparar ", "revisar ", "leer ", "escribir ",
            "mandar ", "enviar ", "pagar ", "ordenar ", "limpiar ",
            // Agregados 2026-05-26 (50-case validation: 13, 15, 20):
            "hacer ", "avisar ", "avisarle ", "subir ",
            "terminar ", "entregar ", "buscar ", "armar ",
            "mandarle ", "enviarle ", "decirle ", "contarle "
            // NOTA (2026-05-27): "bajar " removido — extractAfter usa
            // búsqueda de substring (no word-bounded), por lo que "bajar "
            // matchea dentro de "trabajar en …" → seccion 7 toma el verbo
            // incorrecto y descarta "trabajar" del título. "Bajar" como
            // chore es raro; los pocos casos los maneja la sección 8.
        ]
        // Pre-check (user spec 2026-05-27): si el chore verb está al FINAL
        // como detalle de un evento previo ("cumpleaños de Urrutia a las 8
        // comprar regalo"), NO lo usemos como verbo principal — el
        // `extractEventDetail` ya lo capturará como subtítulo y queremos
        // que la sección 8 (evento puntual con hora) extraiga el título
        // verdadero ("Cumpleaños Urrutia"). Sin este guard, la sección 7
        // se quedaba con "Comprar regalo" como evento y perdía el evento real.
        //
        // Salvaguarda: SOLO skip cuando hay HORA EXACTA. Sin hora exacta
        // (solo franja "en la tarde"), el chore verb ES el evento principal
        // (la franja no construye un evento horario). Caso #28 legacy:
        // "hoy en la tarde estudiar para la prueba" → task estudiar, NO
        // clarify por falta de título.
        let shouldSkipChoreVerbs: Bool = {
            guard NovaActionNormalizer.extractEventDetail(from: trimmed).detail != nil else {
                return false
            }
            guard hasExactTimeMarker(lower) else { return false }
            let lowerForChore = trimmed.lowercased()
            for verb in choreVerbs {
                if let rng = lowerForChore.range(of: verb) {
                    let prefixCount = lowerForChore[..<rng.lowerBound]
                        .components(separatedBy: .whitespaces)
                        .filter { !$0.isEmpty }
                        .count
                    // ≥2 palabras antes del chore verb = es detalle, no
                    // verbo principal. "comprar pan" (0 palabras antes) →
                    // chore verb principal. "supermercado a las 7 comprar
                    // leche" (4 palabras antes) → detalle.
                    if prefixCount >= 2 { return true }
                }
            }
            return false
        }()
        if !shouldSkipChoreVerbs, let title = extractAfter(trimmed, triggers: choreVerbs) {
            if title.isEmpty { return .clarify(reason: .taskNeedsTitle) }
            let when = extractDateTime(from: lower)
            // Usar hora **exacta** (no franja). "hoy en la tarde estudiar"
            // tiene franja pero no hora — debe ser tarea, no evento 9am
            // inventado. Cubre caso 28 del 50-test.
            let hasExplicitTime = hasExactTimeMarker(lower)
            // Reconstruir el título incluyendo el verbo de chore (ej. "Comprar materiales").
            let verbUsed = firstMatchingTrigger(in: trimmed, triggers: choreVerbs) ?? ""
            let fullTitle = cleanTaskTitle(
                verbUsed.trimmingCharacters(in: .whitespacesAndNewlines) + " " + title,
                when: when
            )
            if hasExplicitTime, let date = when {
                let location = extractLocation(from: trimmed)
                let explicitEnd = extractExplicitEndTime(from: lower, startTime: date)
                let recurrence = detectRecurrence(lower)
                return .createEvent(
                    title: fullTitle,
                    when: date,
                    endTime: explicitEnd,
                    location: location,
                    section: .personal,
                    wantsReminder: wantsReminder,
                    recurrence: recurrence
                )
            }
            let recurrence = detectRecurrence(lower)
            return .createTask(title: fullTitle, dueDate: when, recurrence: recurrence, wantsReminder: wantsReminder)
        }

        // ──────────────────────────────────────────────────────────────
        // 7.5. Sustantivos comunes que SON la actividad sin verbo.
        //      "fútbol hoy", "gimnasio mañana", "carrete el viernes",
        //      "almuerzo con mi papá mañana". Si hay día pero NO hora →
        //      tarea con dueDate. Si hay hora exacta → evento. Cubre
        //      casos 11, 30, 50 del 50-test.
        // ──────────────────────────────────────────────────────────────
        let nounActivities = [
            "fútbol", "futbol", "tenis", "básquetbol", "basquetbol", "baloncesto",
            "natación", "natacion", "yoga", "pilates", "gym", "gimnasio",
            "entreno", "entrenamiento", "trote",
            "carrete", "fiesta", "previa", "junta",
            "almuerzo", "cena", "desayuno", "once", "merienda",
            "clases", "clase"
        ]
        let nounPattern = nounActivities.joined(separator: "|")
        let nounRegex = "\\b(\(nounPattern))\\b"
        if lower.range(of: nounRegex, options: [.regularExpression]) != nil {
            let when = extractDateTime(from: lower)
            // Hora exacta solamente: "carrete el viernes en la noche" tiene
            // franja pero no hora → task del día, no evento 9am inventado.
            let hasExplicitTime = hasExactTimeMarker(lower)
            // Encontrar el sustantivo concreto para usarlo de título.
            let foundNoun: String? = nounActivities.first(where: { noun in
                lower.range(of: "\\b\(noun)\\b", options: [.regularExpression]) != nil
            })
            let nounTitle = foundNoun.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? "Actividad"
            // Título COMPLETO (cabeza + calificador): "gym pierna" → "Gym
            // pierna" para que el subtítulo NO se pierda (downstream lo separa
            // con splitTitleSubtitle → Gym + Pierna). Si la limpieza deja solo
            // la cabeza ("gym a las 6"), cae al nounTitle. No tocamos el path
            // de tarea (sin hora) para no alterar "fútbol hoy".
            let fullTitle = NovaActionNormalizer.cleanTitle(trimmed)
            let eventTitle = fullTitle.lowercased().hasPrefix(foundNoun ?? "∅") ? fullTitle : nounTitle
            if hasExplicitTime, let date = when {
                // Hora explícita → evento puntual.
                let location = extractLocation(from: trimmed)
                let section = detectSection(in: lower)
                let explicitEnd = extractExplicitEndTime(from: lower, startTime: date)
                return .createEvent(
                    title: eventTitle, when: date, endTime: explicitEnd,
                    location: location, section: section,
                    wantsReminder: wantsReminder, recurrence: nil
                )
            }
            // Sin hora exacta (o sin marcador) → tarea con dueDate del día.
            // "fútbol hoy" / "gimnasio mañana" / "almuerzo con mi papá mañana".
            let dueDate = when
            return .createTask(
                title: nounTitle, dueDate: dueDate,
                recurrence: nil, wantsReminder: wantsReminder
            )
        }

        // ──────────────────────────────────────────────────────────────
        // 8. Solo hora/fecha sin verbo, en frases cortas → asumir evento.
        //    Ej: "mañana 12 con Juan" → evento "Con Juan" mañana 12:00.
        //
        //    Si Nova preguntó algo antes (clarify) y guardó `pendingTitle`,
        //    completamos la acción con ese título — esto resuelve el flujo:
        //      "ir a buscar agustina en 20"
        //      → "¿20:00 o en 20 min?"
        //      → "a las 20" → crea «Buscar a Agustina» hoy 20:00.
        // ──────────────────────────────────────────────────────────────
        if let when = extractDateTime(from: lower), hasTimeMarker(lower) {
            // Limpieza completa del título: además de stripDateTime y
            // stripLocation, también quitamos triggers de recordatorio
            // ("acuérdame", "recuérdame", "no olvides") y fillers
            // ("porfa", "agéndame") para que "acuérdame probar
            // notificación en 1 minuto" devuelva título "Probar notificación"
            // y no "Acuérdame probar notificación".
            var titleRaw = stripDateTimeMarkers(stripLocationMarker(trimmed))
            titleRaw = stripReminderTriggers(titleRaw)
            titleRaw = stripFillers(titleRaw)
            let title = cleanupTitle(titleRaw)
            let location = extractLocation(from: trimmed)
            let section = detectSection(in: lower)
            let recurrence = detectRecurrence(lower)
            if title.isEmpty {
                if context.pendingIsActive, let pending = context.pendingClarification,
                   let proposedTitle = pending.proposedTitle, !proposedTitle.isEmpty {
                    let explicitEnd = extractExplicitEndTime(from: lower, startTime: when)
                    return .createEvent(
                        title: proposedTitle,
                        when: when,
                        endTime: explicitEnd,
                        location: location ?? pending.proposedLocation ?? context.lastLocation,
                        section: section ?? pending.proposedSection ?? context.lastSection,
                        wantsReminder: wantsReminder || pending.wantsReminder,
                        recurrence: recurrence
                    )
                }
                return .clarify(reason: .eventNeedsTitle)
            }
            let explicitEnd = extractExplicitEndTime(from: lower, startTime: when)
            return .createEvent(
                title: title,
                when: when,
                endTime: explicitEnd,
                location: location,
                section: section,
                wantsReminder: wantsReminder,
                recurrence: recurrence
            )
        }

        // ──────────────────────────────────────────────────────────────
        // 9. Small talk.
        // ──────────────────────────────────────────────────────────────
        if matches(lower, ["hola", "buenas", "buen día", "buen dia", "qué tal", "que tal"]) {
            return .smallTalk(reply: randomGreeting())
        }
        if matches(lower, [
            "gracias", "perfecto", "dale", "ok ", "listo",
            "genial", "buenísimo", "buenisimo"
        ]) || lower == "ok" {
            return .smallTalk(reply: randomAcknowledgment())
        }

        // 10. Sin pistas → clarify. Chat emocional ya se chequeó en
        //     sección 4.5 — no lo repetimos acá.
        return .clarify(reason: .unclear)
    }

    /// Si el texto incluye un selector de tema ("de la universidad",
    /// "del trabajo", "de la casa", etc.), devuelve la lista de keywords
    /// fuzzy + label humana. Usado por reviewPending para filtrar tareas.
    /// Conservador: solo 3 temas comunes con vocabulario rico — universidad,
    /// trabajo, personal/familia. Si no matchea ninguno, devuelve nil.
    static func topicKeywords(in lower: String) -> (label: String, keywords: [String])? {
        let universityTriggers = [
            "de la universidad", "de la u", "de la facultad", "de la facu",
            "del colegio", "de la escuela", "de los ramos", "del ramo",
            "de mis clases", "de las clases", "del curso", "de los cursos",
            "del semestre", "de mis profesores", "de los profesores"
        ]
        let workTriggers = [
            "del trabajo", "de la pega", "de la oficina", "del laburo",
            "de mi equipo", "del proyecto"
        ]
        let personalTriggers = [
            "de la casa", "del hogar", "de la familia", "de mis hijos",
            "personales", "de lo personal", "para mí", "para mi"
        ]
        if universityTriggers.contains(where: { lower.contains($0) }) {
            return ("universidad", [
                "universidad", "facultad", "facu", "ramo", "ramos",
                "clase", "clases", "asignatura", "profesor", "profesores",
                "canvas", "asistencia", "notas", "nota", "planilla",
                "certificado", "examen", "parcial", "entrega", "tp",
                "trabajo grupal", "trabajos grupales", "estudiar",
                "comunicación", "lenguaje", "arte", "matemáticas",
                "cálculo", "calculo", "química", "quimica", "física",
                "fisica", "biología", "biologia", "juan"  // del caso real
            ])
        }
        if workTriggers.contains(where: { lower.contains($0) }) {
            return ("trabajo", [
                "trabajo", "oficina", "pega", "laburo", "jefe", "jefa",
                "equipo", "proyecto", "reunión", "reunion", "meeting",
                "cliente", "deadline", "entrega", "stand-up", "standup",
                "review", "presentación", "presentacion"
            ])
        }
        if personalTriggers.contains(where: { lower.contains($0) }) {
            return ("lo personal", [
                "casa", "familia", "hijos", "pareja", "amigo", "amiga",
                "hermano", "hermana", "padre", "madre", "papá", "papa",
                "mamá", "mama", "personal", "salud", "doctor", "médico",
                "medico", "cita", "compra", "compras", "regalo"
            ])
        }
        return nil
    }

    /// Detecta estado emocional o pedido de ayuda general en lenguaje
    /// natural. Devuelve un reply empático si matchea, nil si no.
    /// Mantener conservador: solo palabras claras de estado interior.
    private static func detectEmotionalChat(_ lower: String) -> String? {
        let burnoutMarkers = [
            "colapsado", "colapsada", "agotado", "agotada",
            "abrumado", "abrumada", "estresado", "estresada",
            "saturado", "saturada", "quemado", "quemada",
            "no doy más", "no doy mas", "no puedo más", "no puedo mas",
            "estoy mal", "estoy peor"
        ]
        let tiredMarkers = [
            "cansado", "cansada", "exhausto", "exhausta",
            "sin energía", "sin energia", "sin pilas",
            "muerto de sueño", "muerto de sueno"
        ]
        let stuckMarkers = [
            "no sé qué hacer", "no se que hacer",
            "no sé por dónde", "no se por donde",
            "no sé qué priorizar", "no se que priorizar",
            "ayúdame a", "ayudame a",
            "qué debería hacer", "que deberia hacer"
        ]
        let containsAny: ([String]) -> Bool = { triggers in
            triggers.contains { lower.contains($0) }
        }
        if containsAny(burnoutMarkers) {
            return Self.pick([
                "Te escucho. Cuéntame qué tienes encima hoy y vemos qué se puede mover. Si quieres, partimos por 2 prioridades concretas.",
                "Vamos por partes. Dime las 2-3 cosas más urgentes y empezamos por una sola. Lo demás puede esperar.",
                "Tranquilo, lo vemos juntos. ¿Qué te pesa más ahora mismo: las clases, una entrega, algo pendiente con alguien?"
            ])
        }
        if containsAny(tiredMarkers) {
            return Self.pick([
                "Entiendo. Si vas a avanzar igual, mejor con un bloque corto y realista. Dime una sola cosa para hoy y la dejamos lista.",
                "Te entiendo. ¿Qué necesitas mover sí o sí hoy? Lo demás lo posponemos sin culpa.",
                "Si estás cansado, mejor poco y bien. ¿Hay una sola tarea que sí o sí tiene que pasar hoy?"
            ])
        }
        if containsAny(stuckMarkers) {
            return Self.pick([
                "Cuéntame qué tienes pendiente y lo ordenamos por urgencia. Puedo proponerte un plan.",
                "Dime 2 o 3 cosas que tienes encima y empezamos por la más importante.",
                "Cuéntame lo que tienes y vemos qué hacer primero."
            ])
        }
        return nil
    }

    /// String libre para el chat. Reusa `parse` para entender el mensaje y
    /// elige una respuesta variada en base al intent. Distinto del flujo
    /// inline: acá no ejecutamos acciones, solo respondemos textualmente.
    static func reply(to text: String, context: NovaContext = NovaContext()) -> String {
        let intent = parse(text, context: context)
        switch intent {
        case .createTask(let title, let dueDate, let recurrence, let wantsReminder):
            let recBit = recurrence.map { " (\($0.label) — la recurrencia queda preparada para más adelante)" } ?? ""
            let dueBit = dueDate.map { " para el \(DateFormatters.weekdayDay.string(from: $0).lowercased())" } ?? ""
            // Si el usuario dijo "acuérdame" + tarea, le explicamos por qué no habrá
            // notif: las tareas no envían aviso. Mensaje honesto, no promesa futura.
            let remBit = wantsReminder ? " Como tarea no envía aviso al iPhone — si quieres que te avise, mejor agéndalo como evento con hora." : ""
            return Self.pick([
                "Anoto «\(title)»\(dueBit) como tarea\(recBit).\(remBit)",
                "Listo, agrego «\(title)»\(dueBit) a tus pendientes\(recBit).\(remBit)",
                "La meto como tarea\(dueBit)\(recBit). Si quieres cambiar la prioridad, dime.\(remBit)"
            ])
        case .createEvent(let title, let when, _, let location, let section, _, _, _, _):
            let timeBit = when.map { "el \(DateFormatters.weekdayDay.string(from: $0).lowercased()) a las \(DateFormatters.hourMinute.string(from: $0))" } ?? "cuando me digas"
            let placeBit = location.map { " en \($0)" } ?? ""
            let sectionBit = section.map { " (\($0.displayName.lowercased()))" } ?? ""
            // Antes el copy decía "Las notificaciones inteligentes están en
            // preparación" — mentira: el evento creado con "acuérdame" SÍ
            // programa notificación local. Mejor decir nada extra acá: el
            // path local que crea el evento (`applyLocalNovaIntent`) confirma
            // explícitamente "con aviso N min antes" cuando hay offset, y la
            // notif igualmente dispara al startTime si no.
            return Self.pick([
                "Agendo «\(title)»\(placeBit) \(timeBit)\(sectionBit).",
                "Listo, evento «\(title)» \(timeBit)\(placeBit)\(sectionBit).",
                "Va «\(title)» \(timeBit)\(placeBit)\(sectionBit). Si quieres cambiar algo, dime."
            ])
        case .correctLastEvent(let modifier):
            switch modifier {
            case .shiftDays(let off) where off == 1:
                return "Perfecto, lo muevo para mañana."
            case .shiftDays:
                return "Listo, cambio el día."
            case .setTime(let h, let m):
                return "Cambio la hora a \(String(format: "%02d:%02d", h, m))."
            case .setLocation(let loc):
                return "Anoto la ubicación: \(loc)."
            case .setTitle(let newTitle):
                return "Actualizo el título a «\(newTitle)»."
            }
        case .convertLastToTask:
            return "Lo paso a tareas."
        case .deleteLastItem:
            return "Listo, lo elimino."
        case .deleteEventByActivity(let activity):
            return "Borro «\(activity)» de tu agenda."
        case .rescheduleEventByActivity(let activity, let hour, let minute):
            return "Muevo «\(activity)» a las \(String(format: "%02d:%02d", hour, minute))."
        case .attachReminderToEvent(let activity, let offsetMinutes, _):
            let offsetLabel = offsetMinutes < 60
                ? "\(offsetMinutes) min antes"
                : (offsetMinutes % 60 == 0 ? "\(offsetMinutes/60) h antes" : "\(offsetMinutes/60) h \(offsetMinutes%60) min antes")
            return "Pongo aviso \(offsetLabel) en «\(activity)»."
        case .proposeActionPlan(let actions):
            return "Tengo \(actions.count) acciones para anotar. Confírmame «sí, agrégalas» y las dejo en tu lista."
        case .confirmActionPlan:
            return "Anoto las tareas que te propuse."
        case .annotateTaskCorrection(let subject, _):
            return "Anoto la corrección sobre «\(subject)»."
        case .annotateDependency(let prerequisite, let dependent):
            return "Anoto que primero hay que «\(prerequisite)» antes de «\(dependent)»."
        case .organizeDay:
            return Self.pick([
                "Cuéntame qué quieres lograr hoy y armamos el día juntos.",
                "Dime tus 2 o 3 prioridades de hoy y las acomodamos.",
                "¿Qué tienes pendiente y qué te urge? Lo ordenamos."
            ])
        case .reviewPending:
            return Self.pick([
                "Tus pendientes están en Mi Día → «Pendientes de hoy».",
                "Mira «Pendientes de hoy» en Mi Día. Si quieres que los reorganice, dime «organiza mi día».",
                "Lo tienes todo arriba en Mi Día. ¿Los priorizamos por urgencia?"
            ])
        case .reviewToday:
            return Self.pick([
                "Mira Mi Día para ver tu agenda completa de hoy.",
                "Tu timeline está arriba en Mi Día. ¿Quieres que te ayude a organizarlo?",
                "Lo tienes todo en Mi Día. ¿Hay algo que quieras mover o priorizar?"
            ])
        case .askAboutDemo:
            return "Los ejemplos solo aparecen mientras no tengas datos tuyos. Apenas crees tu primer evento o tarea, se reemplazan automáticamente. Si quieres borrar todo, ve a Ajustes → Datos locales."
        case .smallTalk(let reply):
            return reply
        case .clarify(.taskNeedsTitle):
            return "Cuéntame qué tarea quieres anotar. Por ejemplo: «crea tarea estudiar cálculo»."
        case .clarify(.eventNeedsTitle):
            return "¿Qué quieres agendar? Dime el nombre del evento y, si lo tienes, día y hora. Ej: «agenda reunión con Juan mañana a las 12»."
        case .clarify(.eventNeedsTime(let title, let date)):
            let day = DateFormatters.weekdayDay.string(from: date).lowercased()
            return "Tengo «\(title)» para el \(day). ¿A qué hora lo dejo? Si es por la tarde, dime «a las 5 PM» o «a las 17:00»."
        case .clarify(.eventNeedsDateTime(let title)):
            return "Tengo «\(title)» listo para agendar. Dime el día y la hora — por ejemplo «mañana a las 17» o «el lunes a las 9 AM»."
        case .clarify(.noContext):
            return "Cuéntame un poco más — ¿quieres que agende algo nuevo, edite un bloque que ya tienes, o que te ayude a ordenar el día?"
        case .clarify(.unclear):
            return Self.pick([
                "Cuéntame con más detalle qué quieres. Puedo crearte una tarea, agendar un evento, o ayudarte a ordenar el día — dime cuál encaja.",
                "Dime un poco más y lo armo. Por ejemplo: «crea tarea estudiar cálculo», «agenda fútbol mañana a las 5» u «organiza mi día».",
                "Me falta contexto para hacerlo bien. ¿Quieres que lo deje como tarea, como evento con hora, o que te ayude a ordenar el día?"
            ])
        }
    }

    // MARK: - Variations (chat más vivo, menos repetitivo)

    private static func randomGreeting() -> String {
        Self.pick([
            "Hola. ¿Qué necesitas hoy?",
            "Aquí estoy. ¿En qué te ayudo?",
            "Hola. Dime qué hacer y lo armo."
        ])
    }

    private static func randomAcknowledgment() -> String {
        Self.pick([
            "Listo. Si cambias de idea, dime.",
            "Perfecto. Cualquier cosa estoy aquí.",
            "Bien. Lo dejo así."
        ])
    }

    private static func pick(_ options: [String]) -> String {
        options.randomElement() ?? options.first ?? ""
    }

    // MARK: - Heurísticas de parsing

    /// Detecta "borra/elimina/quita X" donde X es el nombre aproximado de un
    /// evento existente. Devuelve nil si el remainder es un pronombre contextual
    /// (manejado en step 0), o si menciona "demo/ejemplo" (manejado en step 2).
    ///
    /// Antes (BUG-USER 2026-05-19): "borra lo de estudiar comunicación" caía al
    /// flujo de createTask y terminaba creando una tarea con ese título — el
    /// opuesto de lo pedido. Ahora se devuelve un intent dedicado que el
    /// `applyLocalNovaIntent` resuelve vía fuzzy-match contra eventos reales.
    static func detectDeleteByActivity(text: String, lower: String) -> NovaIntent? {
        // Patrón: comando borra/elimina/quita/saca + (opcional artículo) + sustantivo
        let pattern = #"^\s*(?:b[oó]rra(?:me|le|lo)?|elimina(?:me|le|lo)?|qu[ií]ta(?:me|le|lo)?|s[aá]ca(?:me|le|lo)?|borrar|eliminar|quitar|sacar)\s+(?:lo\s+de\s+|la\s+|el\s+|los\s+|las\s+)?(.+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              match.numberOfRanges >= 2 else { return nil }
        let remainder = ns.substring(with: match.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let rmLower = remainder.lowercased()
        // Pronombres puros → step 0 ya los maneja como deleteLastItem.
        let pronouns: Set<String> = ["lo", "eso", "esto", "ese", "esa", "aquello", "todo", "esos"]
        if pronouns.contains(rmLower) { return nil }
        // Demo/ejemplo → step 2 ya los maneja.
        if rmLower.contains("ejemplo") || rmLower.contains("demo") { return nil }
        // Limpiar título con el mismo pipeline que usamos para crear.
        let activity = NovaActionNormalizer.cleanTitle(remainder)
        guard !activity.isEmpty else { return nil }
        return .deleteEventByActivity(activity: activity)
    }

    /// Detecta "mueve/cambia/pasa X a las Y" donde X es título aproximado de un
    /// evento existente. Sin esta detección, el flujo caía al createEvent y
    /// duplicaba (BUG-USER 2026-05-19: "mueve fútbol a las 5" → creó "Mueve
    /// fútbol" 17:00 en vez de mover el existente).
    static func detectRescheduleByActivity(text: String, lower: String) -> NovaIntent? {
        let leadingVerbs: [String] = [
            "muévelo", "muevelo", "muévela", "muevela",
            "mueve",
            "cámbialo", "cambialo", "cámbiale", "cambiale",
            "cambia",
            "pasa", "p[aá]sala", "pasala", "p[aá]salo", "pasalo",
            "edita", "ed[ií]tale", "editale",
            "reagenda", "reag[eé]ndame", "reagendame"
        ]
        // Encontrar el verbo de inicio (case-insensitive, word boundary).
        var matchedVerb: String? = nil
        for v in leadingVerbs {
            let vPattern = "^\\s*" + v + "\\b"
            if lower.range(of: vPattern, options: .regularExpression) != nil {
                matchedVerb = v
                break
            }
        }
        guard let verb = matchedVerb else { return nil }
        // Sustraer la parte después del verbo.
        let verbRegex = "^\\s*" + verb + "\\s+"
        guard let verbRange = lower.range(of: verbRegex, options: .regularExpression) else { return nil }
        let afterVerbLower = String(lower[verbRange.upperBound...])
        let afterVerbOriginal = String(text[verbRange.upperBound...])
        // Encontrar el anchor temporal "a las/a la/para las/para la".
        let timeAnchorRegex = #"\b(?:a\s+la?s?|para\s+la?s?|para\s+el)\s+"#
        guard let anchorRange = afterVerbLower.range(of: timeAnchorRegex, options: .regularExpression) else { return nil }
        let activityPart = String(afterVerbOriginal[..<anchorRange.lowerBound])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activityPart.isEmpty else { return nil }
        // Extraer la hora del trailing.
        let timePart = String(afterVerbLower[anchorRange.lowerBound...])
        guard let (h, m) = extractHourMinute(from: timePart) else { return nil }
        // Limpiar el título de la actividad.
        let activity = NovaActionNormalizer.cleanTitle(activityPart)
        guard !activity.isEmpty else { return nil }
        return .rescheduleEventByActivity(activity: activity, hour: h, minute: m)
    }

    /// Detecta si el turno responde afirmativamente a una propuesta
    /// pendiente. Conservador: solo respuestas cortas y claras.
    /// "sí, agrégalas como tareas" / "dale" / "perfecto" / "agrégalo" /
    /// "ok, agrégalas" → true. "sí pero" / textos largos → false (caller
    /// debe seguir parseo normal).
    static func matchesAffirmativeConfirmation(_ lower: String) -> Bool {
        let trimmed = lower.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 60 else { return false }
        let triggers: [String] = [
            "sí", "si,", "si.", "sí.", "sí,",
            "sí, agré", "si, agre", "sí, agrega", "si, agrega",
            "sí, dale", "si, dale",
            "agrégalo", "agregalo", "agrégalas", "agregalas",
            "agrégala", "agregala", "agrégame", "agregame",
            "agrégalas como tareas", "agregalas como tareas",
            "agrégalo como tareas", "agregalo como tareas",
            "dale", "dale nomás", "dale nomas",
            "ok,", "ok.", "okey", "okay",
            "listo,", "listo.", "perfecto", "bueno,",
            "hazlo", "hacelo", "hagámoslo", "hagamoslo",
            "confirma", "confirmar"
        ]
        if triggers.contains(where: { trimmed.hasPrefix($0) }) { return true }
        // "sí" solo, o "si" solo.
        if trimmed == "sí" || trimmed == "si" || trimmed == "sii" || trimmed == "ok" || trimmed == "dale" {
            return true
        }
        return false
    }

    /// Detecta si `text` contiene una lista de acciones independientes
    /// (típicamente pegada por el usuario desde un correo/Notion/chat).
    /// Heurística: 3+ líneas no vacías que arrancan con verbo imperativo
    /// O 3+ enunciados separados por saltos / "; " / "1." "2.". Devuelve
    /// las acciones extraídas o nil si no parece plan.
    ///
    /// NO toca títulos sensibles aquí — eso lo hace `proposedTaskFromLine`.
    static func detectActionPlan(text: String) -> [ProposedTaskAction]? {
        // Primer corte: si tiene <30 caracteres O no contiene ningún
        // separador → no es plan.
        guard text.count >= 30 else { return nil }
        let hasMultipleLines = text.contains("\n")
        let hasNumberedList = text.range(of: #"(?m)^\s*\d+[\.\)]\s"#, options: .regularExpression) != nil
        let hasBulletList = text.range(of: #"(?m)^\s*[\u{2022}\-\*]\s"#, options: .regularExpression) != nil
        guard hasMultipleLines || hasNumberedList || hasBulletList else { return nil }

        // Split por líneas; ignorar líneas vacías o headers ("Acciones tuyas:" / "Lista:").
        let rawLines = text.components(separatedBy: CharacterSet.newlines)
        var lines: [String] = []
        for line in rawLines {
            let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedLine.isEmpty { continue }
            // Ignorar headers tipo "Acciones tuyas:", "Pendientes:", "Lista:".
            let isHeader = trimmedLine.range(
                of: #"^(?:acciones|pendientes|lista|tareas|to-?do|hacer|notas)\b.*:?\s*$"#,
                options: [.regularExpression, .caseInsensitive]
            ) != nil
            if isHeader { continue }
            // Quitar marcadores de bullet/número del inicio.
            let cleaned = trimmedLine
                .replacingOccurrences(
                    of: #"^\s*(?:\d+[\.\)]|[\u{2022}\-\*])\s*"#,
                    with: "",
                    options: .regularExpression
                )
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if cleaned.count >= 6 {
                lines.append(cleaned)
            }
        }
        guard lines.count >= 3 else { return nil }

        // Verificar que al menos 3 líneas tengan estructura de acción
        // (verbo imperativo / infinitivo al inicio o cerca). Si no, no es
        // un plan — puede ser un párrafo común.
        let actionVerbs: [String] = [
            "hablar", "revisar", "enviar", "escribir", "evaluar", "conversar",
            "preparar", "llamar", "pedir", "mandar", "estudiar", "leer",
            "comprar", "buscar", "agendar", "anotar", "investigar", "armar",
            "ordenar", "limpiar", "completar", "terminar", "responder",
            "decidir", "elegir", "planificar", "planear", "organizar",
            "contactar", "coordinar", "confirmar", "revisarse", "iniciar"
        ]
        let linesWithVerb = lines.filter { line in
            let lowerLine = line.lowercased()
            return actionVerbs.contains { verb in
                lowerLine.hasPrefix(verb) || lowerLine.hasPrefix(verb + "se ")
                    || lowerLine.contains(" " + verb + " ")
            }
        }
        guard linesWithVerb.count >= max(3, lines.count / 2) else { return nil }

        // Convertir cada línea en ProposedTaskAction.
        var actions: [ProposedTaskAction] = []
        for line in lines {
            if let action = proposedTaskFromLine(line) {
                actions.append(action)
            }
            if actions.count >= 12 { break }  // cap defensivo
        }
        return actions.isEmpty ? nil : actions
    }

    /// Convierte una línea de plan en ProposedTaskAction. Hace:
    /// - Extrae verbo + objeto principal como título corto.
    /// - El resto va a notas.
    /// - Detecta referencias sensibles (psiquiatra, terapia, medicamentos)
    ///   y usa título genérico ("Pedir certificado médico") con el detalle
    ///   en notas.
    /// - Asigna prioridad/categoría heurística.
    static func proposedTaskFromLine(_ line: String) -> ProposedTaskAction? {
        let trimmedLine = line.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!? "))
        guard !trimmedLine.isEmpty else { return nil }
        let lower = trimmedLine.lowercased()

        // Detección sensitive — "psiquiatra/psicólogo/medicamentos" en un
        // texto sobre certificado/salud → título genérico discreto.
        let mentionsTherapist = lower.contains("psiquiatra") || lower.contains("psicologo")
            || lower.contains("psicólogo") || lower.contains("psicóloga")
        let mentionsCertificate = lower.contains("certificado") || lower.contains("certificate")
        let mentionsMedication = lower.contains("medicamento") || lower.contains("medicación")
            || lower.contains("medicacion") || lower.contains("tratamiento")

        let title: String
        let notes: String?
        if mentionsTherapist && (mentionsCertificate || mentionsMedication) {
            title = "Pedir certificado médico"
            notes = trimmedLine
        } else {
            // Heurística simple: cortar la línea en la primera coma fuerte,
            // o en " para que" / " con el fin de" / " porque", para que el
            // título quede breve. Si la línea es corta (≤ 70 chars), usar
            // toda la línea como título.
            if trimmedLine.count <= 70 {
                title = capitalizeFirstSpanish(trimmedLine)
                notes = nil
            } else {
                let cutMarkers = [
                    ", para ", " para que ", " con el fin de ", " porque ",
                    ", con copia", ", mencionando", ", incluyendo"
                ]
                var cutIndex: String.Index? = nil
                for marker in cutMarkers {
                    if let r = trimmedLine.range(of: marker) {
                        if cutIndex == nil || r.lowerBound < cutIndex! {
                            cutIndex = r.lowerBound
                        }
                    }
                }
                if let idx = cutIndex {
                    title = capitalizeFirstSpanish(String(trimmedLine[..<idx]))
                    notes = String(trimmedLine[idx...])
                        .trimmingCharacters(in: CharacterSet(charactersIn: " ,."))
                } else {
                    // Cortar en la palabra ≤ 60 chars manteniendo verbo + obj.
                    let words = trimmedLine.split(separator: " ")
                    var built = ""
                    for w in words {
                        if (built.count + w.count + 1) > 60 { break }
                        if !built.isEmpty { built += " " }
                        built += String(w)
                    }
                    title = capitalizeFirstSpanish(built)
                    notes = trimmedLine
                }
            }
        }

        // Prioridad heurística:
        let priority: TaskPriority
        if lower.contains("urgente") || lower.contains("importante") || lower.contains("urgentemente")
            || mentionsCertificate || lower.contains("enviar") || lower.contains("entregar") {
            priority = .alta
        } else if lower.contains("evaluar") || lower.contains("conversar") || lower.contains("decidir") {
            priority = .media
        } else {
            priority = .alta  // default alta para acciones de un plan
        }

        // Categoría heurística. TaskCategory representa urgencia
        // (hoy/semana/algunDia). Para el plan extraction usamos .hoy
        // porque:
        //   1. La beta no tiene una vista dedicada para tareas de "esta
        //      semana", así que .semana las dejaba invisibles.
        //   2. Las tareas de un plan suelen ser cosas en las que el user
        //      quiere trabajar pronto, no archivar.
        //   3. Si el usuario quiere postergar, el comando "qué me queda
        //      pendiente" las muestra y puede moverlas.
        let category: TaskCategory = .hoy

        return ProposedTaskAction(
            title: title,
            notes: notes,
            priority: priority,
            category: category,
            subtasks: []
        )
    }

    /// Capitaliza primera letra respetando acentos.
    private static func capitalizeFirstSpanish(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }

    /// Detecta frases que ATRIBUYEN un reminder a un evento existente sin
    /// crear uno nuevo. Ej:
    ///   - "ponle recordatorio media hora antes al fútbol"
    ///   - "agrégale aviso 30 min antes a la reunión"
    ///   - "el recordatorio del fútbol es media hora antes"
    ///   - "cambia el aviso de la reunión a 1 hora antes"
    ///
    /// Para que matchee, el texto debe:
    /// 1. Tener un verbo de attach (ponle/pon/agrégale/agrega/cambia + recordatorio/aviso/alerta)
    ///    O ser de la forma "el (recordatorio|aviso) (de|del) Y es X antes".
    /// 2. Tener un offset extraíble ("X min antes", "media hora antes").
    /// 3. Tener un activity name después del marcador "al/del/a la/de la".
    ///
    /// Si cualquier paso falla → nil → caller cae al createEvent normal.
    /// El caller resuelve el evento con `findEventByApproxTitle`; si no
    /// encuentra match, devuelve mensaje claro al usuario en vez de crear
    /// un duplicado.
    static func detectAttachReminderToEvent(text: String, lower: String) -> NovaIntent? {
        // Paso 1: identificar verbo de attach + activity.
        // Probamos 3 formas en orden de especificidad.
        let activityRaw: String?
        // Forma A: "el (recordatorio|aviso|alerta) (de|del) <activity> es ..."
        // Captura group 1 = activity hasta " es ".
        let formA = #"el\s+(?:recordatorio|aviso|alerta)\s+(?:de\s+la|de\s+los|de\s+las|de|del)\s+(.+?)\s+es\s+"#
        if let m = firstCaptureGroup(in: lower, pattern: formA, captureGroupIndex: 1) {
            activityRaw = m
        } else {
            // Forma B: "(ponle|pon|agrégale|agregale|agrega|métele|metele|cambia|cámbiale|cambiale)
            //           (el|un)?\s*(recordatorio|aviso|alerta|alarma) ... (al|del|a la|a los|a las|de la|de) <activity>"
            // Captura el activity como TODO lo que viene después de "al/del/a la/de la/de".
            let formB = #"(?:ponle|pon|agr[eé]gale|agregale|agrega|m[eé]tele|metele|p[oó]ngale|pongale|cambia|c[aá]mbiale|cambiale)\s+(?:el\s+|un\s+|una\s+)?(?:recordatorio|aviso|alerta|alarma)\b.*?\b(?:al|del|de\s+la|de\s+los|de\s+las|a\s+la|a\s+los|a\s+las|de)\s+(.+?)\s*$"#
            if let m = firstCaptureGroup(in: lower, pattern: formB, captureGroupIndex: 1) {
                activityRaw = m
            } else {
                activityRaw = nil
            }
        }
        guard let rawActivity = activityRaw, !rawActivity.isEmpty else { return nil }

        // Paso 2: offset numérico.
        guard let offset = NovaActionNormalizer.extractReminderOffset(from: text) else { return nil }

        // Paso 3: limpiar activity. cleanTitle también remueve "X min antes" si
        // el regex de form-B capturó algo como "fútbol 30 min antes" (raro pero
        // posible cuando el orden de la frase invierte).
        let activity = NovaActionNormalizer.cleanTitle(rawActivity)
        guard !activity.isEmpty else { return nil }

        // Paso 4: nota custom (opcional). Solo si el patrón "antes de <X>"
        // está presente — ej. "ponle aviso 30 min antes de salir al fútbol"
        // → note="Salir". Hoy no es común para attach, pero lo soportamos.
        let note: String?
        if let detail = NovaActionNormalizer.extractReminderOffsetAndNote(from: text),
           detail.offsetMinutes == offset {
            note = detail.note
        } else {
            note = nil
        }
        return .attachReminderToEvent(activity: activity, offsetMinutes: offset, note: note)
    }

    /// Detecta "la X no era [old], era [new]" / "el X no era para [old],
    /// era para [new]" / "X no era con [old], era con [new]". Captura el
    /// sujeto X (lo que el user quiere corregir) y la corrección.
    /// Conservador: requiere "no era" + "era" en la misma oración.
    static func detectTaskCorrection(text: String, lower: String) -> NovaIntent? {
        // Patrón flexible. Captura el sujeto (entre "la/el" y "no era"),
        // y la nueva info (después de "era ").
        let patterns: [String] = [
            #"^\s*(?:la|el|los|las)\s+(.+?)\s+no\s+era\s+(?:para|con|de)?\s*(.+?),\s*era\s+(?:para|con|de)?\s*(.+?)\s*$"#,
            #"^\s*(.+?)\s+no\s+era\s+(?:para|con|de)?\s*(.+?),\s*era\s+(?:para|con|de)?\s*(.+?)\s*$"#
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let ns = text as NSString
            guard let m = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
                  m.numberOfRanges >= 4 else { continue }
            let subject = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
            let oldValue = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
            let newValue = ns.substring(with: m.range(at: 3)).trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?"))
            if subject.isEmpty || oldValue.isEmpty || newValue.isEmpty { continue }
            // Filtrar falsos positivos: sujetos muy genéricos / pronombres.
            let pronouns: Set<String> = ["eso", "esto", "ese", "esa", "aquello"]
            if pronouns.contains(subject.lowercased()) { continue }
            let correctionNote = "Era para \(newValue), no para \(oldValue)."
            return .annotateTaskCorrection(subject: subject, correctionNote: correctionNote)
        }
        return nil
    }

    /// Detecta "antes de [acción] necesito/tengo que [prerrequisito]" o
    /// "primero [prerrequisito], después [acción]". Captura los 2 títulos
    /// para anotar una dependencia informativa.
    static func detectDependency(text: String, lower: String) -> NovaIntent? {
        // Patrón A: "antes de X (necesito|tengo que|debo) Y".
        let patternA = #"^\s*antes\s+de\s+(.+?),?\s+(?:necesito|tengo\s+que|debo|hay\s+que|necesitamos)\s+(.+?)\s*$"#
        if let regex = try? NSRegularExpression(pattern: patternA, options: [.caseInsensitive]) {
            let ns = text as NSString
            if let m = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
               m.numberOfRanges >= 3 {
                let dependent = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                let prereq = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?"))
                if !dependent.isEmpty && !prereq.isEmpty {
                    return .annotateDependency(prerequisite: prereq, dependent: dependent)
                }
            }
        }
        // Patrón B: "primero X, después Y" / "primero X antes de Y".
        let patternB = #"^\s*primero\s+(.+?),?\s+(?:despu[eé]s|luego|antes\s+de)\s+(.+?)\s*$"#
        if let regex = try? NSRegularExpression(pattern: patternB, options: [.caseInsensitive]) {
            let ns = text as NSString
            if let m = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
               m.numberOfRanges >= 3 {
                let prereq = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                let dependent = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?"))
                if !dependent.isEmpty && !prereq.isEmpty {
                    return .annotateDependency(prerequisite: prereq, dependent: dependent)
                }
            }
        }
        return nil
    }

    /// Helper genérico: corre `pattern` contra `text` (case-insensitive) y
    /// devuelve el capture group N como String trimmed. Usado por los
    /// detectores que comparten lógica similar.
    private static func firstCaptureGroup(in text: String, pattern: String, captureGroupIndex: Int) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              match.numberOfRanges > captureGroupIndex,
              match.range(at: captureGroupIndex).location != NSNotFound else { return nil }
        let captured = ns.substring(with: match.range(at: captureGroupIndex))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return captured.isEmpty ? nil : captured
    }

    private static func matches(_ text: String, _ keywords: [String]) -> Bool {
        keywords.contains { text.contains($0) }
    }

    /// Busca un trigger respetando word-boundary al inicio. Sin esto,
    /// `text.contains("ir a ")` matcheaba dentro de "dormir a las" (substring
    /// "ir a " a partir de la "i" de "mir") y disparaba el flujo de evento
    /// con título incorrecto. Las pruebas pre-beta (TEST 17) lo evidenciaron:
    /// "recuérdame dormir a las 11" terminaba como evento "Ir" 11:00.
    ///
    /// Reglas:
    /// - Si el trigger arranca en posición 0 → OK.
    /// - Si el carácter anterior es letra (a-z incluyendo acentos)
    ///   → NO matchea (bordería intra-palabra).
    /// - Si es espacio, puntuación o cualquier otro → OK.
    ///
    /// Triggers que TERMINAN con un espacio (ej. "ir a ") ya garantizan
    /// bordería al final por el espacio explícito.
    private static func firstWordBoundedRange(of trigger: String, in lower: String) -> Range<String.Index>? {
        var searchStart = lower.startIndex
        while let range = lower.range(of: trigger, range: searchStart..<lower.endIndex) {
            if range.lowerBound == lower.startIndex {
                return range
            }
            let prev = lower[lower.index(before: range.lowerBound)]
            if !prev.isLetter {
                return range
            }
            // Avanzar el search start un carácter para evitar bucle infinito y
            // probar el siguiente posible match.
            searchStart = lower.index(after: range.lowerBound)
        }
        return nil
    }

    private static func matchesAny(_ text: String, _ triggers: [String]) -> Bool {
        let lower = text.lowercased()
        return triggers.contains { firstWordBoundedRange(of: $0, in: lower) != nil }
    }

    /// Encuentra el trigger que matchea en `text` respetando word-boundary.
    /// Prioriza:
    /// 1. Posición más temprana en el texto.
    /// 2. Si empatan en posición → trigger MÁS LARGO (más específico).
    /// Eso asegura que "ir a buscar " (12 chars) gane sobre "ir a " (5 chars)
    /// cuando ambos matchean en posición 0.
    private static func firstMatchingTrigger(in text: String, triggers: [String]) -> String? {
        let lower = text.lowercased()
        var best: (trigger: String, position: String.Index, length: Int)?
        for trigger in triggers {
            guard let range = firstWordBoundedRange(of: trigger, in: lower) else { continue }
            let position = range.lowerBound
            let length = trigger.count
            if let current = best {
                if position < current.position {
                    best = (trigger, position, length)
                } else if position == current.position && length > current.length {
                    best = (trigger, position, length)
                }
            } else {
                best = (trigger, position, length)
            }
        }
        return best?.trigger
    }

    /// True si el texto arranca como corrección del último intent
    /// ("no, mañana", "mejor X", "ponlo X", "bórralo", "era X").
    private static func isCorrectionStart(_ lower: String) -> Bool {
        lower == "no" ||
        lower.hasPrefix("no,") || lower.hasPrefix("no ") ||
        lower.hasPrefix("mejor ") ||
        lower.hasPrefix("cámbialo") || lower.hasPrefix("cambialo") ||
        lower.hasPrefix("cámbiale") || lower.hasPrefix("cambiale") ||
        lower.hasPrefix("ponlo ") || lower.hasPrefix("ponla ") ||
        lower.hasPrefix("pásalo ") || lower.hasPrefix("pasalo ") ||
        lower.hasPrefix("muévelo") || lower.hasPrefix("muevelo") ||
        // Borrado del último item
        lower == "bórralo" || lower == "borralo" ||
        lower == "elimínalo" || lower == "eliminalo" ||
        lower == "borrar" || lower.hasPrefix("borrar ") ||
        lower.hasPrefix("elimina ") ||
        // Correcciones de identidad ("era X", "no era Juan, era Pedro")
        lower.hasPrefix("era ") || lower.contains(" era ") ||
        // Cambio de tipo
        lower.hasPrefix("agrégale") || lower.hasPrefix("agregale") ||
        lower.hasPrefix("añádele") || lower.hasPrefix("añadele")
    }

    /// True si el texto arranca con una referencia al ítem mencionado antes
    /// ("agéndalo", "agéndame eso", "ponlo como", "y X").
    private static func isContextReference(_ lower: String) -> Bool {
        let starters = [
            "agéndalo", "agendalo", "agéndala", "agendala",
            "agéndame eso", "agendame eso",
            "ponlo como", "ponla como",
            "déjalo como", "dejalo como",
            "y como tarea", "y como evento",
            "y agéndalo", "y agendalo",
            "y dejalo", "y déjalo"
        ]
        return starters.contains { lower.hasPrefix($0) || lower.contains(" \($0) ") }
    }

    // MARK: - Recurrence

    static func detectRecurrence(_ lower: String) -> RecurrenceHint? {
        // 1) Day-by-day: "día por medio" / "cada 2 días" / "cada N días".
        if matches(lower, ["día por medio", "dia por medio", "cada dos días", "cada dos dias", "cada 2 días", "cada 2 dias"]) {
            return .everyNDays(n: 2)
        }
        if let n = extractEveryNDays(lower), n >= 2 && n <= 30 {
            return .everyNDays(n: n)
        }

        // 2) Weekdays: "de lunes a viernes" / "días hábiles" / "entre semana".
        if matches(lower, [
            "de lunes a viernes", "lunes a viernes",
            "días de semana", "dias de semana",
            "entre semana", "todos los días hábiles", "todos los dias habiles",
            "días hábiles", "dias habiles"
        ]) {
            return .weekdays
        }

        // 3) Biweekly por día: "lunes de por medio" / "cada dos miércoles" / "cada 2 viernes".
        let weekdayLabels: [(String, String)] = [
            ("lunes", "lunes"),
            ("martes", "martes"),
            ("miércoles", "miércoles"), ("miercoles", "miércoles"),
            ("jueves", "jueves"),
            ("viernes", "viernes"),
            ("sábados", "sábados"), ("sabados", "sábados"),
            ("sábado", "sábados"), ("sabado", "sábados"),
            ("domingos", "domingos"), ("domingo", "domingos")
        ]
        for (token, normalized) in weekdayLabels {
            // "lunes de por medio" / "los lunes de por medio".
            if lower.contains("\(token) de por medio") || lower.contains("\(token)s de por medio") {
                return .biweeklyOn(label: "los \(normalized) de por medio")
            }
            // "cada dos lunes" / "cada 2 lunes".
            if lower.contains("cada dos \(token)") || lower.contains("cada 2 \(token)") {
                return .biweeklyOn(label: "cada dos \(normalized)")
            }
        }
        // Bi-weekly genérica ("cada dos semanas" / "cada 2 semanas") sin día.
        if matches(lower, ["cada dos semanas", "cada 2 semanas", "cada quince días", "cada quince dias", "cada 15 días", "cada 15 dias"]) {
            return .biweeklyOn(label: "cada dos semanas")
        }

        // 4) Multi-weekday: "lunes y miércoles" / "miércoles y viernes" /
        //    "lunes, miércoles y viernes" / "todos los miércoles y viernes".
        if let multi = detectMultiWeekday(lower) {
            return multi
        }

        // 5) Plain daily.
        if matches(lower, ["todos los días", "todos los dias", "diariamente", "cada día", "cada dia"]) {
            return .daily
        }

        // 6) Plain weekly.
        if matches(lower, ["cada semana", "semanal", "todas las semanas"]) {
            return .weekly
        }

        // 7) Weekly on a single weekday: "todos los lunes" / "los lunes" + verbo.
        let weekdayMap: [(String, String)] = [
            ("todos los lunes", "los lunes"),
            ("todos los martes", "los martes"),
            ("todos los miércoles", "los miércoles"),
            ("todos los miercoles", "los miércoles"),
            ("todos los jueves", "los jueves"),
            ("todos los viernes", "los viernes"),
            ("todos los sábados", "los sábados"),
            ("todos los sabados", "los sábados"),
            ("todos los domingos", "los domingos")
        ]
        for (trigger, label) in weekdayMap where lower.contains(trigger) {
            return .weeklyOn(label: label)
        }
        if matches(lower, ["cada mes", "mensual", "mensualmente"]) {
            return .monthly
        }
        if matches(lower, ["recurrente"]) {
            return .unspecified
        }
        return nil
    }

    /// "cada N días" donde N es 2-30. Devuelve N o nil si no matchea.
    private static func extractEveryNDays(_ lower: String) -> Int? {
        let pattern = #"\bcada\s+(\d{1,2})\s+d[ií]as\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = lower as NSString
        guard let m = regex.firstMatch(in: lower, range: NSRange(location: 0, length: ns.length)),
              m.numberOfRanges >= 2 else { return nil }
        return Int(ns.substring(with: m.range(at: 1)))
    }

    /// Detecta múltiples días de la semana mencionados juntos:
    /// "miércoles y viernes", "lunes, miércoles y viernes",
    /// "todos los martes y jueves". Devuelve `.multiWeekday` con los
    /// `Calendar.component(.weekday)` (1=domingo, 2=lunes...) o nil.
    private static func detectMultiWeekday(_ lower: String) -> RecurrenceHint? {
        // Map de tokens a weekday-num + label normalizada.
        let weekdayTokens: [(token: String, num: Int, label: String)] = [
            ("lunes", 2, "lunes"),
            ("martes", 3, "martes"),
            ("miércoles", 4, "miércoles"), ("miercoles", 4, "miércoles"),
            ("jueves", 5, "jueves"),
            ("viernes", 6, "viernes"),
            ("sábados", 7, "sábado"), ("sabados", 7, "sábado"),
            ("sábado", 7, "sábado"), ("sabado", 7, "sábado"),
            ("domingos", 1, "domingo"), ("domingo", 1, "domingo")
        ]
        // Para evitar falsos positivos: solo si la frase contiene "y "
        // entre días, o lista con comas + "y".
        let hasConjunction = lower.contains(" y ")
        let hasComma = lower.contains(",")
        guard hasConjunction || hasComma else { return nil }

        var found: [(Int, String, Range<String.Index>)] = []
        for (token, num, label) in weekdayTokens {
            // Buscar el token rodeado por bordería de palabra. Usamos un
            // regex simple para evitar matches dentro de otras palabras.
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: token) + "\\b"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let ns = lower as NSString
            if let m = regex.firstMatch(in: lower, range: NSRange(location: 0, length: ns.length)) {
                if let r = Range(m.range, in: lower) {
                    // Evitar duplicados: si ya tenemos este weekday num, omitir.
                    if !found.contains(where: { $0.0 == num }) {
                        found.append((num, label, r))
                    }
                }
            }
        }
        guard found.count >= 2 else { return nil }
        // Ordenar por posición en el texto.
        found.sort { $0.2.lowerBound < $1.2.lowerBound }
        let weekdays = found.map { $0.0 }
        let labels = found.map { $0.1 }
        let labelText: String
        if labels.count == 2 {
            labelText = "los \(labels[0]) y \(labels[1])"
        } else {
            let head = labels.dropLast().joined(separator: ", ")
            labelText = "los \(head) y \(labels.last!)"
        }
        return .multiWeekday(weekdays: weekdays, label: labelText)
    }

    // MARK: - Sección por palabra-clave

    /// Wrapper público para que el caller (Mi Día) pueda guessear la sección
    /// del texto original sin acceder a internals. Usado al guardar
    /// `pendingSection` cuando Nova devuelve un clarify.
    static func guessSection(for text: String) -> EventSection? {
        detectSection(in: text.lowercased())
    }

    private static func detectSection(in lower: String) -> EventSection? {
        if matches(lower, [
            "parcial", "examen", "final", "prueba",
            "clase", "estudiar", "estudio", "tp ", "tarea de ",
            "entrega", "presentación", "presentacion", "tesis",
            "universidad", "colegio", "facultad", "liceo"
        ]) {
            return .estudio
        }
        // "reunión/reunion" SOLO match al inicio de palabra para no atrapar
        // frases tangenciales. Antes el match era substring → "comer en la
        // reunión" caía acá. Ahora usamos `matchesAny` con espacio explícito
        // o anclas.
        if matches(lower, [
            "reunión", "reunion", "review", "1:1", "1on1",
            "meet", " call ", "llamada", "stand up", "standup", "stand-up",
            "demo"
        ]) {
            return .reunion
        }
        if matches(lower, [
            "amigo", "amiga", "amigas", "amigos",
            "familia", "mamá", "papá", "mama", "papa",
            "hermano", "hermana", "hijo", "hija",
            "salir ", "buscar a ", "buscar al ", "buscar la ", "buscar el ",
            "juntarme", "juntarnos", "junta con", "me junto",
            // Comidas — "comer/almorzar/cenar/desayunar/once" siempre son
            // personal salvo que mencionen "reunión" (ya manejado arriba).
            "comer", "comida", "comerme",
            "almuerzo", "almorzar",
            "cena", "cenar",
            "desayuno", "desayunar",
            "tomar once", " once ",
            "café con", "cafe con", "merendar",
            "novia", "novio", "pareja"
        ]) {
            return .personal
        }
        // "Foco" cubre bloques de trabajo profundo. "trabajar/trabajo/
        // trabajando" sin reunión → foco (es un bloque dedicado de trabajo
        // del usuario). Excluye "trabajo de mi papá/mamá" → personal (visita
        // a familia).
        if lower.contains("trabajo de mi ") || lower.contains("trabajo de mama")
            || lower.contains("trabajo de papa") || lower.contains("trabajo de mamá")
            || lower.contains("trabajo de papá") {
            return .personal
        }
        if matches(lower, [
            "foco profundo", "deep work", "concentrar", "concentrarme",
            "trabajar", "trabajando", " trabajo", "pega ", "oficina",
            "responder mail", "revisar mail", "preparar entrega"
        ]) {
            return .foco
        }
        // Entrenamiento/deporte → sección .entrenamiento (NO descanso). Antes
        // gym/correr/yoga caían en .descanso y la tarjeta mostraba "Descanso"
        // (☕) en vez de "Entrenamiento" — bug reportado 2026-06-13.
        if matches(lower, [
            "gym", "gimnasio", "correr", "yoga", "pilates", "running", "trotar", "trote",
            "entrenar", "entreno", "entrenamiento", "spinning", "crossfit",
            "natación", "natacion", "nadar", "pesas", "fútbol", "futbol", "partido",
            "básquet", "basquet", "tenis", "padel", "pádel", "ciclismo", "bici", "boxeo"
        ]) {
            return .entrenamiento
        }
        // Descanso real (no deporte): siesta, pausa, descanso.
        if matches(lower, ["siesta", "pausa", "descanso", "descansar", "relajar"]) {
            return .descanso
        }
        return nil
    }

    // MARK: - Time markers

    /// Si el texto incluye un rango/duración explícita ("de 3 a 4",
    /// "hasta las 4", "por 1 hora"), devuelve el endTime calculado a partir
    /// del start. `nil` cuando el usuario solo dio hora de inicio.
    private static func extractExplicitEndTime(from lower: String, startTime: Date) -> Date? {
        let cal = Calendar.current
        // Caso 1: "de HH a HH(:MM)" / "de las HH a las HH"
        if let endH = firstCaptureInt(
            lower,
            pattern: #"de (la?s? )?\d{1,2}(:\d{2})? a (la?s? )?(\d{1,2})(:\d{2})?"#,
            group: 4
        ), endH >= 0, endH < 24 {
            let endM = firstCaptureInt(
                lower,
                pattern: #"de (la?s? )?\d{1,2}(:\d{2})? a (la?s? )?\d{1,2}:(\d{2})"#,
                group: 4
            ) ?? 0
            let dayStart = cal.startOfDay(for: startTime)
            let resolvedEndH = adjustAmPm(hour: endH, in: lower)
            return cal.date(bySettingHour: resolvedEndH, minute: endM, second: 0, of: dayStart)
        }
        // Caso 2: "hasta las HH(:MM)"
        if let endH = firstCaptureInt(lower, pattern: #"hasta (la?s? )?(\d{1,2})"#, group: 2),
           endH >= 0, endH < 24 {
            let endM = firstCaptureInt(lower, pattern: #"hasta (la?s? )?\d{1,2}:(\d{2})"#, group: 2) ?? 0
            let dayStart = cal.startOfDay(for: startTime)
            let resolvedEndH = adjustAmPm(hour: endH, in: lower)
            return cal.date(bySettingHour: resolvedEndH, minute: endM, second: 0, of: dayStart)
        }
        // Caso 3: "por N hora(s)/minuto(s)" / "durante N hora(s)"
        if let hours = firstCaptureInt(lower, pattern: #"(?:por|durante) (\d{1,2})\s?(h|horas?|hr|hrs)"#, group: 1) {
            return cal.date(byAdding: .hour, value: hours, to: startTime)
        }
        if let mins = firstCaptureInt(lower, pattern: #"(?:por|durante) (\d{1,3})\s?(min|minutos?)"#, group: 1) {
            return cal.date(byAdding: .minute, value: mins, to: startTime)
        }
        // Caso 4: "por <palabra> hora(s)" — "por dos horas", "por media hora",
        // "por una hora y media". Soporta números escritos en palabras y
        // medias horas explícitas. Indispensable para "clase a las 10 por
        // dos horas" — sin esto el evento se crea como punto en vez de rango.
        let wordToHours: [(pattern: String, hours: Int, minutes: Int)] = [
            ("media", 0, 30),
            ("una", 1, 0), ("un", 1, 0),
            ("dos", 2, 0), ("tres", 3, 0), ("cuatro", 4, 0),
            ("cinco", 5, 0), ("seis", 6, 0), ("siete", 7, 0),
            ("ocho", 8, 0), ("nueve", 9, 0), ("diez", 10, 0)
        ]
        for entry in wordToHours {
            let pattern = "(?:por|durante)\\s+\(entry.pattern)\\s+(?:hora|horas)"
            if lower.range(of: pattern, options: [.regularExpression]) != nil {
                let totalMins = entry.hours * 60 + entry.minutes
                return cal.date(byAdding: .minute, value: totalMins, to: startTime)
            }
        }
        return nil
    }

    /// True si el texto incluye marcador explícito de hora (no solo día).
    private static func hasTimeMarker(_ lower: String) -> Bool {
        if firstCaptureInt(lower, pattern: #"a la?s? (\d{1,2})"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\b(\d{1,2}):(\d{2})\b"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\btipo\s+(?:las?\s+)?(\d{1,2})"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\b(\d{1,2})\s*(am|pm|hs|hrs?)\b"#, group: 1) != nil { return true }
        // Horas en PALABRAS — "a las tres", "a la una", "tipo tres", "como a
        // las cuatro", "a las tres y media", etc. Antes hasTimeMarker
        // ignoraba estas frases y por eso "necesito ir a buscar a mi
        // hermano a las tres" caía a `clarify(¿Cuándo?)`.
        let wordHourPattern = #"\b(?:a la?s?|tipo (?:las? )?|como a la?s?|a eso de la?s?|cerca de la?s?|alrededor de la?s?)\s+"# + hourWordsRegex + #"\b"#
        if lower.range(of: wordHourPattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return true
        }
        // "en N minutos" / "en N min" / "en N h" / "en N hora(s)" / "en N hrs"
        if lower.range(
            of: #"\ben\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\b"#,
            options: .regularExpression
        ) != nil { return true }
        // "en N" suelto (sin unidad) — coloquial. Tratado como minutos por
        // `extractDateTime`. Si está en la frase, hay marcador de tiempo.
        if lower.range(
            of: #"\ben\s+\d{1,3}\b(?!\s*(?:min|hora|hr|hs|h\b))"#,
            options: .regularExpression
        ) != nil { return true }
        if matches(lower, [
            "esta tarde", "esta noche", "esta mañana", "esta manana",
            "al mediodía", "al mediodia", "al atardecer",
            "en la tarde", "en la noche", "en la mañana", "en la manana",
            "después de almuerzo", "despues de almuerzo",
            "después del almuerzo", "despues del almuerzo",
            "después del trabajo", "despues del trabajo",
            "al final del día", "al final del dia",
            "al amanecer"
        ]) {
            return true
        }
        return false
    }

    /// Versión estricta de `hasTimeMarker`: solo true cuando hay **hora
    /// exacta** explícita, NO franja coloquial ("en la tarde", "esta
    /// noche"). Las franjas son señal de día con contexto, pero el usuario
    /// no dijo una hora concreta — convertirlas en evento horario inventa
    /// hora 9am o similar. Mejor crear tarea con dueDate del día.
    ///
    /// Usado por flujos que necesitan distinguir "comprar pan a las 5"
    /// (evento horario) de "comprar pan en la tarde" (tarea del día).
    /// Cubre casos 28, 30 del 50-test.
    private static func hasExactTimeMarker(_ lower: String) -> Bool {
        if firstCaptureInt(lower, pattern: #"a la?s? (\d{1,2})"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\b(\d{1,2}):(\d{2})\b"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\btipo\s+(?:las?\s+)?(\d{1,2})"#, group: 1) != nil { return true }
        if firstCaptureInt(lower, pattern: #"\b(\d{1,2})\s*(am|pm|hs|hrs?)\b"#, group: 1) != nil { return true }
        let wordHourPattern = #"\b(?:a la?s?|tipo (?:las? )?|como a la?s?|a eso de la?s?|cerca de la?s?|alrededor de la?s?)\s+"# + hourWordsRegex + #"\b"#
        if lower.range(of: wordHourPattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return true
        }
        if lower.range(
            of: #"\ben\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\b"#,
            options: .regularExpression
        ) != nil { return true }
        // Heurística "DÍA NÚMERO ACTIVIDAD": "mañana 8 gimnasio", "hoy 17 gym".
        // El número solo después de "hoy/mañana/lunes/martes/..." se trata como hora.
        // Cubre caso 33 del 50-test.
        let dayNumPattern = #"\b(?:hoy|mañana|manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\b(?!\s*(?:min|hora|hr|hs|h\b|:\d))"#
        if lower.range(of: dayNumPattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return true
        }
        return false
    }

    /// True si la fecha es exactamente 9:00 — nuestro default cuando hay día
    /// pero no hora explícita. Lo usamos para detectar "evento sin hora".
    private static func isAtDayDefault(_ date: Date) -> Bool {
        let cal = Calendar.current
        let hour = cal.component(.hour, from: date)
        let minute = cal.component(.minute, from: date)
        return hour == 9 && minute == 0
    }

    // MARK: - Title cleanup

    private static func cleanTaskTitle(_ raw: String, when: Date?) -> String {
        var title = raw
        // Limpieza ampliada: temporal + recordatorio + fillers + ubicación,
        // luego normalizar artículos antes de nombres propios.
        title = stripDateTimeMarkers(title)
        title = stripReminderTriggers(title)
        title = stripFillers(title)
        title = stripLocationMarker(title)
        title = normalizeProperNounsAfterArticles(title)
        // Quitar muletillas pegadas al inicio.
        let stopPrefixes = [
            "que ", "de ", "el ", "la ", "los ", "las ",
            "para ", "a "
        ]
        title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
        var changed = true
        while changed {
            changed = false
            for prefix in stopPrefixes where title.lowercased().hasPrefix(prefix) {
                title = String(title.dropFirst(prefix.count))
                changed = true
            }
            title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return cleanupTitle(title)
    }

    /// Extrae el texto después del PRIMER trigger encontrado (case-insensitive).
    /// Devuelve `nil` si ningún trigger matchea, "" si matchea pero no hay texto
    /// después.
    private static func extractAfter(
        _ text: String,
        triggers: [String],
        allowedTrailingPunct: String = ""
    ) -> String? {
        let lower = text.lowercased()
        var bestIndex: String.Index?
        var bestEnd: String.Index?
        for trigger in triggers {
            if let range = lower.range(of: trigger),
               bestIndex == nil || range.lowerBound < bestIndex! {
                bestIndex = range.lowerBound
                bestEnd = range.upperBound
            }
        }
        guard let end = bestEnd else { return nil }
        var after = String(text[end...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if !allowedTrailingPunct.isEmpty {
            after = after.trimmingCharacters(in: CharacterSet(charactersIn: allowedTrailingPunct))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return after
    }

    /// Triggers cuyo verbo queremos CONSERVAR en el título final (porque tiene
    /// sentido semántico para el usuario): "Buscar a Agustina", "Salir con Juan".
    private static let keptInTitleTriggers: Set<String> = [
        "buscar a ", "ir a buscar ",
        "salir a ", "salir con ", "salgo con ",
        "ir a ", "voy a ", "vamos a ",
        "juntarme con ", "juntarnos con ", "junta con ", "me junto con ",
        "almuerzo con ", "cena con ", "desayuno con ", "café con ",
        "reunión con", "reunion con",
        "clase de", "clase con",
        "pasar a ", "pasar por "
    ]

    /// Triggers tipo "tengo X" donde X es la palabra clave que se vuelve título.
    /// "tengo clase" → "Clase". "tengo médico" → "Médico".
    private static let tengoLikeTriggers: Set<String> = [
        "tengo reunión", "tengo reunion",
        "tengo clase",
        "tengo prueba", "tengo parcial", "tengo examen", "tengo final",
        "tengo entrega",
        "tengo evento", "tengo cita", "tengo turno",
        "tengo médico", "tengo medico", "tengo doctor"
    ]

    private static func extractEventTitle(_ text: String, triggers: [String]) -> String {
        let lower = text.lowercased()
        guard let matchedTrigger = firstMatchingTrigger(in: text, triggers: triggers) else {
            return ""
        }
        let matchedLower = matchedTrigger.lowercased()

        // Caso A: verbo "kept" (mantenemos el verbo en el título reconstruido).
        if keptInTitleTriggers.contains(matchedLower) {
            // "buscar a la agustina tipo 3" → after trigger: "la agustina tipo 3"
            // → limpieza → "Agustina" → reconstruir: "Buscar a Agustina".
            let afterRaw = extractAfter(text, triggers: [matchedTrigger]) ?? ""
            var rest = afterRaw
            rest = stripDateTimeMarkers(rest)
            rest = stripReminderTriggers(rest)
            rest = stripFillers(rest)
            rest = stripLocationMarker(rest)
            rest = normalizeProperNounsAfterArticles(rest)
            rest = stripLeadingArticle(rest)
            rest = rest.trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))

            // Normalización de verbo "ir a buscar":
            //   - "ir a buscar a la Agustina" → "Buscar a Agustina" (idiomático;
            //     "la X" es nombre propio en español familiar, decir "ir a"
            //     resulta redundante).
            //   - "ir a buscar a mi hermano" → "Ir a buscar a mi hermano"
            //     (mantenemos el verbo; "Buscar a mi hermano" suena seco).
            //   - "ir a buscar pan" → "Ir a buscar pan" (sin nombre propio,
            //     mantenemos el verbo).
            //
            // Heurística: solo acortamos a "Buscar a" cuando el rest empieza
            // con artículo definido (la/las/el/los/al) — eso señala nombre
            // propio en español familiar.
            let trimmedTriggerLower = matchedLower.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedVerb: String
            // Check based on AFTER-RAW (no después de la limpieza). Si el
            // usuario dijo "a la Agustina", afterRaw conserva "a la" aun cuando
            // normalizeProperNounsAfterArticles ya haya quitado el "la" de
            // `rest`. Eso preserva la lógica de acortamiento solo cuando hubo
            // artículo definido en el original.
            let afterRawHasDefiniteArticle = afterRaw.lowercased().range(
                of: #"^\s*a\s+(la|las|el|los)\s+"#,
                options: .regularExpression
            ) != nil
            let afterRawStartsWithAl = afterRaw.lowercased().hasPrefix("al ")
            if trimmedTriggerLower == "ir a buscar"
                && (afterRawHasDefiniteArticle || afterRawStartsWithAl) {
                normalizedVerb = "Buscar a"
                // Strip leading "a (la/las/el/los) " — caso normal antes de
                // normalizeProperNounsAfterArticles. También strip simplemente
                // "a " — caso post-normalize (la X → X queda como "a X").
                // Sin esto el concat queda "Buscar a a Agustina".
                let leadingPrefixes = ["a la ", "a las ", "a el ", "a los ", "al ", "a "]
                for p in leadingPrefixes where rest.lowercased().hasPrefix(p) {
                    rest = String(rest.dropFirst(p.count))
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    break
                }
            } else {
                normalizedVerb = capitalizeFirst(trimmedTriggerLower)
            }

            // Capitalizar primera palabra de `rest` si es minúscula y no es
            // una preposición/artículo — captura "agustina" → "Agustina"
            // cuando no fue normalizado por el artículo previo.
            //
            // PERO si el trigger termina en " a" (ej. "salir a", "ir a") y
            // rest empieza con un verbo en infinitivo (-ar/-er/-ir), NO
            // capitalizamos — es un segundo verbo, no nombre propio.
            //   "salir a jugar fútbol" → "Salir a jugar fútbol" (NO "Jugar")
            //   "ir a comprar pan"     → "Ir a comprar pan"     (NO "Comprar")
            let isInfinitiveAfterTriggerA = trimmedTriggerLower.hasSuffix(" a")
                && (rest.range(of: #"^\w+(?:ar|er|ir)\b"#, options: .regularExpression) != nil)
            if !isInfinitiveAfterTriggerA {
                rest = capitalizeFirstNounIfLower(rest)
            }

            if rest.isEmpty { return normalizedVerb }

            // Edge: si el trigger termina en " a" (ej. "salir a", "ir a") y
            // el `rest` arranca con un número, el "a" del trigger era parte
            // de "a las N" (hora), no preposición de destino. Reparamos:
            //
            //   - "salir a las 8"                 → "Salir"
            //   - "ir a las 7"                    → "Ir"
            //   - "salir a las 6 para la universidad" → "Salir para Universidad"
            //
            // (la limpieza de destino final corre en NovaActionNormalizer.cleanTitle).
            let restStartsWithHour = rest.range(
                of: #"^\d{1,2}(:\d{2})?\b"#,
                options: .regularExpression
            ) != nil
            if restStartsWithHour && trimmedTriggerLower.hasSuffix(" a") {
                let verbOnly = String(trimmedTriggerLower.dropLast(2))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let verbCap = capitalizeFirst(verbOnly)
                // Strip el número (la hora) del comienzo del rest, lo que
                // quede es el destino/contexto real.
                let withoutHour = rest.replacingOccurrences(
                    of: #"^\d{1,2}(:\d{2})?\s*"#,
                    with: "",
                    options: .regularExpression
                ).trimmingCharacters(in: .whitespacesAndNewlines)
                if withoutHour.isEmpty {
                    return verbCap
                }
                return "\(verbCap) \(withoutHour)"
            }

            return "\(normalizedVerb) \(rest)"
        }

        // Caso B: trigger tipo "tengo X" — el título es X + qualifier opcional.
        //
        // "tengo clase" → "Clase". "tengo clase de historia" → "Clase de historia".
        // "tengo reunión con Juan" → "Reunión con Juan". Preservar el qualifier
        // es crítico cuando el usuario tiene varios eventos del mismo tipo
        // (dos clases en el día → necesitamos distinguir lenguaje vs historia).
        if tengoLikeTriggers.contains(matchedLower) {
            let keyword = matchedLower
                .replacingOccurrences(of: "tengo ", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            // Buscar texto restante DESPUÉS del trigger en el original.
            // Usamos `lower` para el match-by-substring; `text` (original)
            // para preservar mayúsculas del qualifier.
            let triggerRange = lower.range(of: matchedLower)
            if let triggerRange {
                let afterIdx = triggerRange.upperBound
                let afterText = String(text[afterIdx...])
                let qualifier = extractTengoQualifier(in: afterText)
                if !qualifier.isEmpty {
                    return "\(capitalizeFirst(keyword)) \(qualifier)"
                }
            }
            return capitalizeFirst(keyword)
        }

        // Caso C: trigger es comando ("agenda", "ponme", "crea evento") → strip
        // y limpieza estándar de lo que queda.
        guard var raw = extractAfter(text, triggers: [matchedTrigger], allowedTrailingPunct: ":.") else {
            return ""
        }
        raw = stripDateTimeMarkers(raw)
        raw = stripReminderTriggers(raw)
        raw = stripFillers(raw)
        raw = stripLocationMarker(raw)
        raw = normalizeProperNounsAfterArticles(raw)
        raw = stripLeadingArticle(raw)
        raw = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
        return cleanupTitle(raw)
    }

    /// Extrae el qualifier de una frase tipo "tengo X [qualifier]".
    /// Limpia marcadores temporales y devuelve "de Y" o "con Y" si los hay.
    ///
    /// Ejemplos:
    ///   "s a las 5:30 de historia"           → "de historia"
    ///   " con Juan a las 3"                  → "con Juan"
    ///   " a las 8:30"                        → ""
    ///   " de matemáticas el viernes"         → "de matemáticas"
    ///
    /// Excluye explícitamente "de la mañana/tarde/noche" (son hora-period,
    /// no qualifiers semánticos). También excluye "con Juan a las 3"
    /// donde "a las 3" debe strippearse antes para no contaminar el match.
    private static func extractTengoQualifier(in text: String) -> String {
        // Strip temporal markers ANTES de buscar qualifier.
        var clean = text.lowercased()
        let temporalPatterns: [String] = [
            #"\ba la?s? \d{1,2}(:\d{2})?(\s*(am|pm|hrs?))?\b"#,
            #"\b\d{1,2}:\d{2}\b"#,
            #"\btipo (las? )?\d{1,2}(:\d{2})?\b"#,
            #"\bde la (mañana|manana|tarde|noche|madrugada)\b"#,
            #"\b(hoy|mañana|manana|pasado mañana|pasado manana)\b"#,
            #"\bel (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b"#,
            #"\ben la (mañana|manana|tarde|noche)\b"#,
            #"\bal mediod[ií]a\b"#,
        ]
        for pattern in temporalPatterns {
            clean = clean.replacingOccurrences(of: pattern, with: " ",
                                                options: [.regularExpression, .caseInsensitive])
        }
        // Buscar "de <palabra>" — qualifier de TEMA (clase de X).
        if let regex = try? NSRegularExpression(
            pattern: #"\bde\s+([a-záéíóúñ]+)\b"#,
            options: [.caseInsensitive]
        ) {
            let ns = clean as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let match = regex.firstMatch(in: clean, range: range),
               match.numberOfRanges >= 2 {
                let topic = ns.substring(with: match.range(at: 1))
                // Excluir prepositions/articles que puedan haber colado.
                let blacklist: Set<String> = ["la", "el", "los", "las", "un", "una", "lo"]
                if !blacklist.contains(topic) {
                    return "de \(topic)"
                }
            }
        }
        // Buscar "con <Nombre>" — qualifier de PARTICIPANTE.
        if let regex = try? NSRegularExpression(
            pattern: #"\bcon\s+([a-záéíóúñ]+)\b"#,
            options: [.caseInsensitive]
        ) {
            let ns = clean as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let match = regex.firstMatch(in: clean, range: range),
               match.numberOfRanges >= 2 {
                let person = ns.substring(with: match.range(at: 1))
                let blacklist: Set<String> = ["la", "el", "los", "las", "un", "una"]
                if !blacklist.contains(person) {
                    return "con \(capitalizeFirst(person))"
                }
            }
        }
        return ""
    }

    /// "la agustina" → "Agustina". "el carlos" → "Carlos". Solo si el artículo
    /// va al inicio del texto y la siguiente palabra es una letra simple.
    private static func stripLeadingArticle(_ text: String) -> String {
        let lower = text.lowercased()
        // Solo singular ("la "/"el ") — son típicos de nombres propios
        // coloquiales ("la Cata", "el Juan") que normalizamos a sin
        // artículo. "los"/"las" SE CONSERVAN porque suelen ir con
        // sustantivos comunes plurales ("los cabros", "las tías") que
        // pierden naturalidad si se les quita el artículo.
        for article in ["la ", "el "] {
            if lower.hasPrefix(article) {
                let dropped = String(text.dropFirst(article.count))
                return capitalizeFirst(dropped)
            }
        }
        return text
    }

    /// Capitaliza solo la primera letra de un texto multi-palabra.
    private static func capitalizeFirst(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }

    /// Capitaliza solo la primera letra y normaliza espacios.
    private static func cleanupTitle(_ raw: String) -> String {
        var collapsed = raw
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        // Strip "tengo (que)" como prefijo residual. Aparece tras strippear
        // marcadores temporales: "tengo entrenamiento" → "Entrenamiento".
        // "tengo que avanzar" ya lo captura el flujo de createTask en
        // sección 5 — aquí solo cubrimos restos.
        if let regex = try? NSRegularExpression(pattern: #"^\s*tengo(?:\s+que)?\s+"#, options: [.caseInsensitive]) {
            let ns = collapsed as NSString
            collapsed = regex.stringByReplacingMatches(
                in: collapsed,
                range: NSRange(location: 0, length: ns.length),
                withTemplate: ""
            )
        }
        // Strip conjunciones colgantes al inicio ("y viernes ..." después de
        // strippear "todos los miércoles" deja "y viernes ..."): mejor consumir
        // hasta la siguiente palabra de contenido.
        if let regex = try? NSRegularExpression(pattern: #"^\s*(?:y|o)\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\s*"#, options: [.caseInsensitive]) {
            let ns = collapsed as NSString
            collapsed = regex.stringByReplacingMatches(
                in: collapsed,
                range: NSRange(location: 0, length: ns.length),
                withTemplate: ""
            )
        }
        collapsed = collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = collapsed.first else { return collapsed }
        return first.uppercased() + collapsed.dropFirst()
    }

    /// Capitaliza la primera palabra de `text` SOLO si es un sustantivo (no
    /// preposición ni artículo). Captura "agustina" → "Agustina" cuando no
    /// hubo artículo previo que dispare `normalizeProperNounsAfterArticles`.
    /// Conservador: si la palabra es preposición/artículo conocida, queda
    /// como está (otro paso del pipeline ya la habrá manejado).
    private static func capitalizeFirstNounIfLower(_ text: String) -> String {
        let prepositionsAndArticles: Set<String> = [
            "a", "con", "de", "del", "para", "por", "en", "y", "o",
            "el", "la", "los", "las", "un", "una", "unos", "unas",
            "al",
            // Posesivos — "mi hermano" no debe quedar "Mi hermano". "Mi/Tu/
            // Su" capitalizado se ve raro en mitad de un título.
            "mi", "mis", "tu", "tus", "su", "sus",
            "nuestro", "nuestra", "nuestros", "nuestras",
            "vuestro", "vuestra", "vuestros", "vuestras"
        ]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        let parts = trimmed.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
        guard let firstWord = parts.first else { return trimmed }
        let firstStr = String(firstWord)
        if prepositionsAndArticles.contains(firstStr.lowercased()) { return trimmed }
        guard let firstChar = firstStr.first, firstChar.isLowercase else { return trimmed }
        let cap = firstStr.prefix(1).uppercased() + firstStr.dropFirst()
        if parts.count > 1 {
            return cap + " " + String(parts[1])
        }
        return cap
    }

    private static let dateTimeMarkerPatterns: [String] = [
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
        // Hora explícita "a las HH(:MM)(am|pm|hrs)" — el orden importa, va antes de "tipo".
        #"\ba la?s? \d{1,2}(:\d{2})?\s*(am|pm|hrs?|de la (mañana|manana|tarde|noche))?\b"#,
        #"\b\d{1,2}:\d{2}\b"#,
        // Hora coloquial: "tipo 3", "tipo las 3", "como a las 3", "a eso de las 3",
        // "cerca de las 3", "alrededor de las 3".
        #"\btipo (las? )?\d{1,2}(:\d{2})?\b"#,
        #"\bcomo a la?s? \d{1,2}(:\d{2})?\b"#,
        #"\b(a eso de|cerca de|alrededor de|por) la?s? \d{1,2}(:\d{2})?\b"#,
        // Hora en PALABRAS — "a las tres", "a la una", "a las tres y media",
        // "a las tres y cuarto", "a las tres treinta", "tipo tres", "como a
        // las tres". Va junto con sus sufijos opcionales ("de la mañana/tarde"
        // y minutos como palabra). El orden importa: ANTES que el patrón
        // genérico de artículos para que "a las tres" no quede como "a Tres".
        #"\b(a la?s?|tipo (las? )?|como a la?s?|a eso de la?s?|cerca de la?s?|alrededor de la?s?)\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(\s+y\s+(media|cuarto|diez|quince|veinte|veinticinco|treinta))?(\s+(treinta|quince))?(\s+de la (mañana|manana|tarde|noche))?\b"#,
        // Relativo "en N minutos" / "en N horas" — orden importa: va ANTES
        // que "en N" suelto para que se consuma con la unidad.
        #"\ben\s+\d{1,3}\s+(min|minutos?|h|hs|hrs?|horas?)\b"#,
        // "N hrs" / "N hs" sueltos (24h, ej. "20 hrs").
        #"\b\d{1,2}\s*hrs?\b"#,
        #"\b\d{1,2}\s*hs\b"#,
        // "en N" suelto (sin unidad) — cuando "en" + número aparece pegado
        // a una acción, es un horario o un offset; en cualquier caso, no debe
        // quedar en el título. Se procesa al final para no comerse "en N min".
        #"\ben\s+\d{1,2}\b"#
    ]

    /// Frases que activan recordatorio. Las quitamos del título porque no son
    /// parte de la acción, son metadata ("acuérdame" = "manda notificación").
    /// Patrones para strippear triggers de recordatorio del texto al
    /// extraer título. CONSUMEN el conector opcional "de"/"que" para no
    /// dejar partícula huérfana ("acuérdame de salir" → " salir", no
    /// " de salir").
    private static let reminderTriggerPatterns: [String] = [
        #"\bacu(é|e)rdame( (de|que))?\b"#,
        #"\bacu(é|e)rdate( (de|que))?\b"#,
        #"\bacu(é|e)rdalo( (de|que))?\b"#,
        #"\bacordarme( (de|que))?\b"#,
        #"\bacordame( (de|que))?\b"#,
        #"\brecu(é|e)rdame( (de|que))?\b"#,
        #"\brecuerdame( (de|que))?\b"#,
        #"\brecordame( (de|que))?\b"#,
        #"\brecordarme( (de|que))?\b"#,
        #"\bno (te )?olvides( de)?\b"#,
        #"\bque no se me olvide\b"#,
        #"\bque me acuerde\b"#,
        #"\bav(í|i)same( (de|que))?\b"#
    ]

    /// Fillers que se quitan del título por amabilidad ("porfa", "oye"…).
    /// También verbos de "agenda" que solo añaden ruido al título real.
    /// "Necesito"/"debo" son obligación → no son parte de la acción, se
    /// quitan para que el título quede limpio ("necesito ir a buscar a mi
    /// hermano" → "Ir a buscar a mi hermano").
    private static let fillerPatterns: [String] = [
        #"\bporfa(vor)?\b"#,
        #"\bpor favor\b"#,
        #"\boye\b"#,
        #"\bhey\b"#,
        #"\bdale\b"#,
        #"\bponme\b"#,
        #"\btengo que\b"#,
        #"\bnecesito\b"#,
        #"\bdebo\b"#,
        #"\bagéndame\b"#, #"\bagendame\b"#,
        #"\bagéndalo\b"#, #"\bagendalo\b"#,
        // "antes del viernes" → marcador de deadline, lo quitamos del título
        // (queda como nota futura cuando implementemos deadlines de tarea).
        #"\bantes del? (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b"#
    ]

    private static func stripDateTimeMarkers(_ text: String) -> String {
        replaceAll(in: text, patterns: dateTimeMarkerPatterns)
    }

    private static func stripReminderTriggers(_ text: String) -> String {
        replaceAll(in: text, patterns: reminderTriggerPatterns)
    }

    private static func stripFillers(_ text: String) -> String {
        replaceAll(in: text, patterns: fillerPatterns)
    }

    private static func replaceAll(in text: String, patterns: [String]) -> String {
        var out = text
        for pattern in patterns {
            out = out.replacingOccurrences(
                of: pattern,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }
        return out
    }

    /// Quita artículos antes de nombres propios y los capitaliza:
    /// "a la agustina" → "a Agustina"; "con el carlos" → "con Carlos".
    /// Conservador — solo casos donde el artículo precede a palabra
    /// minúscula simple (sin números ni puntuación).
    ///
    /// Preposiciones soportadas: "a", "con", "de", "para". Excluye "por"
    /// porque típicamente introduce CONTEXTO sustantivo común ("por el
    /// tema", "por la mañana", "por el trabajo"), no nombre propio.
    /// Si capitalizamos esos casos rompemos el step 8h que strippea
    /// "por el tema X" como detalle.
    ///
    /// Sustantivos comunes que NO son nombres propios (skip-list) —
    /// evita "a Comer", "a Tema", "con Casa" del contexto coloquial.
    private static let nonProperNounsAfterArticle: Set<String> = [
        "tema", "trabajo", "casa", "oficina", "universidad", "colegio",
        "escuela", "liceo", "facu", "facultad", "gym", "gimnasio",
        "comida", "almuerzo", "cena", "desayuno", "merienda", "once",
        "comer", "almorzar", "cenar", "desayunar",
        "mañana", "manana", "tarde", "noche", "mediodía", "mediodia",
        "proyecto", "ramo", "curso", "clase", "clases", "prueba",
        "tarea", "tareas", "examen", "parcial", "final", "entrega",
        // Sustantivos comunes frecuentes en contexto de eventos — evitan el
        // over-cap "con Equipo" / "de Luz" / "para Fiesta" (común tratado como
        // nombre propio). Los nombres reales el usuario los escribe ya en
        // mayúscula y el regex (solo minúsculas) no los toca, así que ampliar
        // esta lista es seguro.
        "equipo", "luz", "fiesta", "cuenta", "agua", "gas", "internet",
        "super", "mall", "cine", "banco", "farmacia", "supermercado",
        "auto", "perro", "gato", "ropa", "plata", "pega", "jefe", "jefa",
        "sol", "playa", "parque", "calle", "plaza", "hospital", "clínica",
        "clinica", "doctor", "dentista", "torta", "regalo", "pelo", "pieza",
        "pan", "leche", "carne", "fruta", "verdura", "bencina", "estacionamiento"
    ]

    private static func normalizeProperNounsAfterArticles(_ text: String) -> String {
        let pattern = #"\b(a|con|de|para) (la|las|el|los) ([a-záéíóúñ]+)\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return text
        }
        let ns = text as NSString
        var result = text
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
        // Iterar en reversa para no invalidar rangos al reemplazar.
        for match in matches.reversed() {
            guard match.numberOfRanges >= 4 else { continue }
            let prepRange = match.range(at: 1)
            let nounRange = match.range(at: 3)
            let prep = ns.substring(with: prepRange)
            let noun = ns.substring(with: nounRange)
            // Skip si el sustantivo es común (no nombre propio).
            if nonProperNounsAfterArticle.contains(noun.lowercased()) { continue }
            let capitalized = noun.prefix(1).uppercased() + noun.dropFirst()
            let replacement = "\(prep) \(capitalized)"
            result = (result as NSString).replacingCharacters(in: match.range, with: replacement)
        }
        return result
    }

    private static func stripLocationMarker(_ text: String) -> String {
        // " en <X>" hasta fin o coma/punto. Lo quitamos del título — PERO
        // solo cuando X empieza en MINÚSCULA. Si empieza en mayúscula
        // ("Nova", "Google", "Slack"), es típicamente un nombre propio /
        // producto que forma parte del título, no una ubicación física
        // ("trabajar en Nova" debe quedar como título "Trabajar en Nova",
        // no "Trabajar"). User spec 2026-05-27.
        //
        // Lookahead `(?=[a-záéíóúñ])` exige el primer carácter del noun
        // después de "en " en minúsculas. Sin case-insensitive flag para
        // que la lookahead respete la caja real.
        text.replacingOccurrences(
            of: #" en (?=[a-záéíóúñ])[^.,;\n]+"#,
            with: "",
            options: [.regularExpression]
        )
    }

    /// A morning period is not the relative day "tomorrow".
    private static func dayMarker(in text: String) -> String? {
        let stripped = text.replacingOccurrences(of: #"\b(?:esta|en la|por la|de la) ma(?:ñ|n)ana\b"#,
                                                   with: "", options: .regularExpression)
        for pattern in [#"\bpasado ma(?:ñ|n)ana\b"#, #"\bma(?:ñ|n)ana\b"#,
                        #"\bhoy\b"#, #"\b(?:el )?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b"#,
                        #"\b\d{4}-\d{1,2}-\d{1,2}\b"#, #"\b\d{1,2}/\d{1,2}(?:/\d{4})?\b"#,
                        #"\b\d{1,2} de [a-z]+(?: de \d{4})?\b"#] {
            if let range = stripped.range(of: pattern, options: .regularExpression) { return String(stripped[range]) }
        }
        return nil
    }

    private static func explicitCivilDay(in text: String, calendar: Calendar, now: Date) -> (mentioned: Bool, date: Date?) {
        let patterns = [#"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"#,
                        #"\b(\d{1,2})/(\d{1,2})(?:/(\d{4}))?\b"#,
                        #"\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de (\d{4}))?\b"#]
        let months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        for (index, pattern) in patterns.enumerated() {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { continue }
            let ns = text as NSString
            func capture(_ n: Int) -> String? {
                let range = match.range(at: n)
                return range.location == NSNotFound ? nil : ns.substring(with: range)
            }
            let year = index == 0 ? Int(capture(1) ?? "") : (Int(capture(3) ?? "") ?? calendar.component(.year, from: now))
            let month = index == 2 ? months.firstIndex(of: capture(2) ?? "").map { $0 + 1 } : Int(capture(2) ?? "")
            let day = Int(capture(index == 0 ? 3 : 1) ?? "")
            guard let year, let month, let day else { return (true, nil) }
            let iso = String(format: "%04d-%02d-%02d", year, month, day)
            return (true, NovaTimeFormatter.parseISODate(iso, timezone: calendar.timeZone))
        }
        return (false, nil)
    }

    static func invalidTemporalInput(_ text: String) -> Bool {
        let lower = text.lowercased()
        let explicit = explicitCivilDay(in: lower, calendar: referenceCalendar, now: referenceNow)
        if explicit.mentioned && explicit.date == nil { return true }
        if let regex = try? NSRegularExpression(pattern: #"\b(\d{1,2}):(\d{2})\b"#) {
            let ns = lower as NSString
            for match in regex.matches(in: lower, range: NSRange(location: 0, length: ns.length)) {
                let hour = Int(ns.substring(with: match.range(at: 1))) ?? 24
                let minute = Int(ns.substring(with: match.range(at: 2))) ?? 60
                if hour >= 24 || minute >= 60 { return true }
            }
        }
        if lower.range(of: #"\b(?:0|00|1[3-9]|2\d)(?::\d{2})?\s*(?:am|pm)\b"#, options: .regularExpression) != nil { return true }
        // Reject nonexistent or repeated civil hours instead of normalizing them.
        if extractHourMinute(from: lower) != nil && extractDateTime(from: lower) == nil { return true }
        return false
    }

    /// Devuelve fecha+hora si el texto incluye marcador temporal. Si solo hay
    /// hora sin día, asume hoy (o mañana si la hora ya pasó). Si solo hay día
    /// sin hora, asume 9:00 (lo usamos como flag de "necesita hora").
    private static func extractDateTime(from lower: String) -> Date? {
        let cal = referenceCalendar
        let now = referenceNow

        // Offset relativo a "ahora". Tres patrones, en orden:
        //   "en N minutos" / "en N min"  → +N minutos (explícito)
        //   "en N horas"   / "en N h"    → +N horas   (explícito)
        //   "en N"         (sin unidad)  → +N minutos (regla coloquial:
        //     "ir a buscar agustina en 20" / "salgo en 20" / "te llamo en 5"
        //     siempre significa minutos. Si el usuario quería 20:00 dice "a
        //     las 20", "tipo 20", "20 hrs" o "20:00".)
        if let mins = firstCaptureInt(
            lower,
            pattern: #"\ben\s+(\d{1,3})\s+(min|minutos?)\b"#,
            group: 1
        ), mins > 0, mins <= 720 {
            return cal.date(byAdding: .minute, value: mins, to: now)
        }
        if let hours = firstCaptureInt(
            lower,
            pattern: #"\ben\s+(\d{1,2})\s+(h|hs|hrs?|horas?)\b"#,
            group: 1
        ), hours > 0, hours <= 12 {
            return cal.date(byAdding: .hour, value: hours, to: now)
        }
        // "en N" suelto sin unidad. Default a minutos. Aceptamos 1..180
        // (3h) — más allá empieza a sonar a hora del día y dudoso.
        if let mins = firstCaptureInt(
            lower,
            pattern: #"\ben\s+(\d{1,3})\b(?!\s*(?:min|hora|hr|hs|h\b))"#,
            group: 1
        ), mins > 0, mins <= 180 {
            return cal.date(byAdding: .minute, value: mins, to: now)
        }

        let explicit = explicitCivilDay(in: lower, calendar: cal, now: now)
        if explicit.mentioned && explicit.date == nil { return nil }
        var dayBase = explicit.date
        let marker = dayMarker(in: lower) ?? ""
        if dayBase == nil {
            if marker.hasPrefix("pasado ") {
                dayBase = cal.date(byAdding: .day, value: 2, to: now)
            } else if marker == "mañana" || marker == "manana" {
                dayBase = cal.date(byAdding: .day, value: 1, to: now)
            } else if let target = nextWeekday(in: lower, calendar: cal, from: now) {
                dayBase = target
            } else if marker == "hoy" || lower.range(of: #"\b(?:esta|en la|por la|de la) (?:ma[ñn]ana|tarde|noche)\b"#, options: .regularExpression) != nil
                        || defaultHourForTimeframe(in: lower) != nil {
                dayBase = now
            }
        }

        // Hora explícita
        let hm = extractHourMinute(from: lower)

        if dayBase == nil && hm == nil { return nil }

        var base = dayBase ?? now
        if let (h, m) = hm {
            let start = cal.startOfDay(for: base)
            guard let resolved = NovaTimeFormatter.civilDate(on: start, hour: h, minute: m, calendar: cal) else { return nil }
            base = resolved
            // Política Mi Día (user spec 2026-05-27): si NO se dio día
            // explícito, mantenemos HOY aunque la hora ya haya pasado.
            // "dentista a las 9" a las 17:00 → hoy 09:00 (en pasado),
            // no mañana 09:00. La timeline muestra "TERMINADO" para
            // pasados pero el ítem queda en el día correcto. Si el
            // usuario quiere mañana, dice "mañana a las 9".
            //
            // Removido el bump-to-tomorrow cuando gap > 4h — generaba
            // sorpresa para el caso típico de eventos cotidianos
            // (dentista, asado, cumpleaños) tras la hora actual.
            return base
        }
        // Día sin hora explícita: si el usuario nombró una FRANJA HORARIA
        // ("en la tarde", "esta noche", "al mediodía"), usamos esa franja
        // como hora default. Sin esto, "estudiar mañana en la tarde" caía
        // a 09:00 (mañana) — al revés de lo que dijo el usuario.
        if let (h, m) = defaultHourForTimeframe(in: lower) {
            let start = cal.startOfDay(for: base)
            return NovaTimeFormatter.civilDate(on: start, hour: h, minute: m, calendar: cal)
        }
        // Día sin franja → 9:00 (placeholder; el caller debería detectarlo
        // como "necesita hora" vía `isAtDayDefault`).
        let start = cal.startOfDay(for: base)
        return NovaTimeFormatter.civilDate(on: start, hour: 9, minute: 0, calendar: cal)
    }

    /// Default hour para franjas horarias coloquiales cuando el usuario NO
    /// dio una hora numérica. Cubre los marcadores que también se usan en
    /// `extractDateTime` para detectar día. Mapeo:
    ///   - "mañana" / "esta mañana" / "en la mañana" → 09:00
    ///   - "al mediodía" → 12:00
    ///   - "después de almuerzo" → 15:00
    ///   - "tarde" / "esta tarde" / "en la tarde" → 16:00
    ///   - "después del trabajo" → 19:00
    ///   - "noche" / "esta noche" / "en la noche" → 20:00
    ///   - "al final del día" → 21:00
    static func defaultHourForTimeframe(in lower: String) -> (Int, Int)? {
        if lower.contains("al mediod") {
            return (12, 0)  // 12:00
        }
        if lower.contains("al final del d") {
            return (21, 0)
        }
        if lower.contains("después del trabajo") || lower.contains("despues del trabajo") {
            return (19, 0)
        }
        if lower.contains("después de almuerzo") || lower.contains("despues de almuerzo") {
            return (15, 0)
        }
        if lower.contains("esta noche") || lower.contains("en la noche")
            || lower.contains("por la noche") || lower.contains("en la madrugada") {
            return (20, 0)
        }
        if lower.contains("esta tarde") || lower.contains("en la tarde")
            || lower.contains("por la tarde") {
            return (16, 0)
        }
        if lower.contains("esta mañana") || lower.contains("esta manana")
            || lower.contains("en la mañana") || lower.contains("en la manana")
            || lower.contains("por la mañana") || lower.contains("por la manana") {
            return (9, 0)
        }
        return nil
    }

    /// Extrae el nuevo título de frases como "era con Pedro", "era Pedro",
    /// "no era Juan, era Pedro". Devuelve `nil` si no encuentra patrón claro.
    /// Requiere que aparezca la palabra "era" seguida de texto.
    private static func extractTitleAfterEra(lower: String, original: String) -> String? {
        // Patrón: "era con X" o "era X". Tomamos lo que viene después del
        // ÚLTIMO "era" para casos como "no era Juan, era Pedro".
        guard let range = lower.range(of: " era ", options: .backwards)
                ?? lower.range(of: "era ", options: .backwards) else { return nil }
        let afterStart = original.index(original.startIndex, offsetBy: lower.distance(from: lower.startIndex, to: range.upperBound))
        guard afterStart < original.endIndex else { return nil }
        var after = String(original[afterStart...]).trimmingCharacters(in: .whitespacesAndNewlines)
        // Limpiar: si empieza con "con ", quitar para que el título sea solo el nombre.
        let conPrefix = "con "
        if after.lowercased().hasPrefix(conPrefix) {
            after = String(after.dropFirst(conPrefix.count))
        }
        after = after.trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !after.isEmpty else { return nil }
        // Reconstruir "Con Pedro" si había "con" inicialmente.
        if lower.contains("era con ") || lower.contains(" era con ") {
            return "Con " + cleanupTitle(after)
        }
        return cleanupTitle(after)
    }

    /// Verbos que implican acción cercana hoy mismo. Cuando aparecen en el
    /// texto y no hay día explícito, asumimos hoy (no bumpear a mañana).
    private static func isImminentActivity(_ lower: String) -> Bool {
        matches(lower, [
            "ir a ", "voy a ", "vamos a ",
            "salir a ", "salir con ", "salgo ",
            "buscar a ", "ir a buscar ",
            "pasar a ", "pasar por ",
            "juntarme con ", "me junto",
            "acuérdame", "acuerdame", "recuérdame", "recuerdame"
        ])
    }

    private static func nextWeekday(in text: String, calendar: Calendar, from: Date) -> Date? {
        let map: [(String, Int)] = [
            ("domingo", 1),
            ("lunes", 2),
            ("martes", 3),
            ("miércoles", 4), ("miercoles", 4),
            ("jueves", 5),
            ("viernes", 6),
            ("sábado", 7), ("sabado", 7)
        ]
        for (name, weekday) in map {
            if text.contains(name) {
                // Próxima ocurrencia de ese weekday desde "from".
                var comps = DateComponents()
                comps.weekday = weekday
                if let next = calendar.nextDate(
                    after: from,
                    matching: comps,
                    matchingPolicy: .nextTime
                ) {
                    return next
                }
            }
        }
        return nil
    }

    private static func extractHourMinute(from text: String) -> (Int, Int)? {
        // 1) "a las 14:30" / "a la 1:00" (también "a eso de las 14:30").
        //    Cuando la hora está en 1..12 SIN modificador (am/pm, "de la tarde",
        //    etc.) hay que aplicar `adjustAmPm` también — antes "a las 3:30"
        //    se devolvía como (3, 30) literal y caía a 03:30 aunque el contexto
        //    (verbo "trabajar/comer/etc") dijera tarde. Para hours 13..23 el
        //    valor es 24h y se mantiene literal.
        if let h = firstCaptureInt(text, pattern: #"(?:a la?s?|eso de las?|cerca de las?|alrededor de las?) (\d{1,2}):(\d{2})"#, group: 1),
           let m = firstCaptureInt(text, pattern: #"(?:a la?s?|eso de las?|cerca de las?|alrededor de las?) (\d{1,2}):(\d{2})"#, group: 2),
           h < 24, m < 60 {
            let resolvedH = h <= 12 ? adjustAmPm(hour: h, in: text) : h
            return (resolvedH, m)
        }
        // 1b) Horas en PALABRAS — "a las tres", "a la una", "a las siete y media",
        //     "a las tres y cuarto", "a las tres treinta", "tipo tres", "como a
        //     las tres", "a eso de las cuatro". Usuario habla por voz y
        //     transcripción mete los números como palabras → el parser los
        //     ignoraba antes y mandaba a `clarify(¿Cuándo?)`. Soporta también
        //     "y media" (+30), "y cuarto" (+15), "y treinta", "y quince".
        if let (h, m) = extractWordHourMinute(from: text) {
            let resolvedH = h <= 12 ? adjustAmPm(hour: h, in: text) : h
            return (resolvedH, m)
        }
        // 1c) Rango "de N a M" / "de las N a las M" / "entre N y M" — captura
        //     el N INICIAL como start time. El endTime se calcula aparte en
        //     `extractExplicitEndTime`. Sin este caso, "reunión de 5 a 6"
        //     caía a clarify(¿Cuándo?) porque el "5" no tenía prefix "a las".
        if let h = firstCaptureInt(
            text,
            pattern: #"\bde (?:la?s? )?(\d{1,2})(?::\d{2})?\s+(?:a|hasta)\s+(?:la?s? )?\d{1,2}"#,
            group: 1
        ), h < 24 {
            let m = firstCaptureInt(
                text,
                pattern: #"\bde (?:la?s? )?\d{1,2}:(\d{2})\s+(?:a|hasta)"#,
                group: 1
            ) ?? 0
            let resolvedH = h <= 12 ? adjustAmPm(hour: h, in: text) : h
            return (resolvedH, m)
        }
        if let h = firstCaptureInt(
            text,
            pattern: #"\bentre (?:la?s? )?(\d{1,2})(?::\d{2})?\s+y\s+(?:la?s? )?\d{1,2}"#,
            group: 1
        ), h < 24 {
            let m = firstCaptureInt(
                text,
                pattern: #"\bentre (?:la?s? )?\d{1,2}:(\d{2})\s+y"#,
                group: 1
            ) ?? 0
            let resolvedH = h <= 12 ? adjustAmPm(hour: h, in: text) : h
            return (resolvedH, m)
        }
        // 2) "a las 12" / "a la 1" / "a eso de las 3" / "cerca de las 3"
        if let h = firstCaptureInt(text, pattern: #"(?:a la?s?|eso de las?|cerca de las?|alrededor de las?) (\d{1,2})\b"#, group: 1), h < 24 {
            return (adjustAmPm(hour: h, in: text), 0)
        }
        // 2b) "DÍA N actividad" — "mañana 8 gimnasio", "hoy 7 estudiar",
        //     "el lunes 9 reunión". El N pegado al día sin "a las" es
        //     interpretación coloquial chilena de hora. Cubre caso 33
        //     del 50-test. Requiere que NO haya unidad temporal después
        //     (para no chocar con "en 8 min").
        let dayHourPattern = #"\b(?:hoy|mañana|manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\b(?!\s*(?:min|hora|hr|hs|h\b|:\d|am|pm))"#
        if let h = firstCaptureInt(text, pattern: dayHourPattern, group: 1), h < 24 {
            return (adjustAmPm(hour: h, in: text), 0)
        }
        // 3) "14:30" suelto. Igual que (1): si h <= 12, contexto puede
        //    moverlo a PM. "salir a las 7:00" sin "am" → si el contexto dice
        //    mañana queda 07:00, si dice tarde queda 19:00, sino regla
        //    coloquial 1-7 → PM.
        if let h = firstCaptureInt(text, pattern: #"\b(\d{1,2}):(\d{2})\b"#, group: 1),
           let m = firstCaptureInt(text, pattern: #"\b(\d{1,2}):(\d{2})\b"#, group: 2),
           h < 24, m < 60 {
            let resolvedH = h <= 12 ? adjustAmPm(hour: h, in: text) : h
            return (resolvedH, m)
        }
        // 4) "tipo N" / "tipo las N" — colloquial Chilean.
        //    Default a PM para N=1..11 (uso social diurno), salvo que el
        //    texto diga explícitamente "de la mañana".
        if let n = firstCaptureInt(text, pattern: #"\btipo\s+(?:las?\s+)?(\d{1,2})"#, group: 1),
           n >= 0, n < 24 {
            return (resolveTipoHour(n, in: text), 0)
        }
        // 5) "3pm" / "8am" / "12 pm"
        if let n = firstCaptureInt(text, pattern: #"\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b"#, group: 1),
           n >= 0, n <= 12 {
            let isPM = text.range(of: #"\b\d{1,2}\s*(pm|p\.m\.)\b"#, options: .regularExpression) != nil
            if n == 12 {
                return isPM ? (12, 0) : (0, 0)
            }
            return isPM ? (n + 12, 0) : (n, 0)
        }
        // 5b) Notación 24h coloquial: "20 hrs", "20 hs", "20:00 hrs", "8 hrs"
        //     — el número se toma literal (no se aplica adjustAmPm). Solo
        //     0..23 son válidos.
        if let n = firstCaptureInt(text, pattern: #"\b(\d{1,2})\s*hrs?\b"#, group: 1),
           n >= 0, n < 24 {
            return (n, 0)
        }
        if let n = firstCaptureInt(text, pattern: #"\b(\d{1,2})\s*hs\b"#, group: 1),
           n >= 0, n < 24 {
            return (n, 0)
        }
        // 6) "esta tarde" / "esta noche" / "al mediodía"
        if text.contains("esta noche") { return (20, 0) }
        if text.contains("esta tarde") { return (16, 0) }
        if text.contains("al mediodía") || text.contains("al mediodia") { return (12, 0) }
        if text.contains("esta mañana") || text.contains("esta manana") { return (9, 0) }
        // 7) Marcadores naturales coloquiales sin "esta":
        //    "en la tarde", "en la noche", "en la mañana".
        if text.contains("en la noche") { return (20, 0) }
        if text.contains("en la tarde") { return (16, 0) }
        if text.contains("en la mañana") || text.contains("en la manana") { return (9, 0) }
        // 8) Referencias a comidas/momentos: "después de almuerzo" → 15:00
        //    (post-comida típica). "después del trabajo" → 18:00.
        //    "al final del día" → 18:00. "al amanecer" → 7:00.
        if text.contains("después de almuerzo") || text.contains("despues de almuerzo")
            || text.contains("después de almorzar") || text.contains("despues de almorzar")
            || text.contains("después del almuerzo") || text.contains("despues del almuerzo") {
            return (15, 0)
        }
        if text.contains("después del trabajo") || text.contains("despues del trabajo") {
            return (18, 0)
        }
        if text.contains("al final del día") || text.contains("al final del dia") { return (18, 0) }
        if text.contains("al amanecer") { return (7, 0) }
        return nil
    }

    /// Mapa de palabras de hora en español a entero (1..12). El usuario
    /// dicta "a las tres" por voz y la transcripción mete números como
    /// palabras — antes el parser ignoraba estas frases y caía a
    /// `clarify(¿Cuándo?)`. Soporta los 12 numerales + variantes "una/uno".
    private static let hourWords: [String: Int] = [
        "una": 1, "uno": 1,
        "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
        "seis": 6, "siete": 7, "ocho": 8, "nueve": 9,
        "diez": 10, "once": 11, "doce": 12
    ]

    /// Regex pattern union de las palabras-hora (1..12). Se usa en varios
    /// lugares: extractHourMinute, hasTimeMarker, stripDateTimeMarkers.
    private static let hourWordsRegex: String =
        "(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)"

    /// Extrae (hora, minuto) de frases con NÚMERO ESCRITO EN PALABRAS.
    /// Soporta:
    ///   - "a las tres" → (3, 0)
    ///   - "a la una" → (1, 0)
    ///   - "tipo tres" → (3, 0)
    ///   - "como a las tres" → (3, 0)
    ///   - "a eso de las cuatro" → (4, 0)
    ///   - "a las tres y media" → (3, 30)
    ///   - "a las tres y cuarto" → (3, 15)
    ///   - "a las tres treinta" → (3, 30)
    ///   - "a las tres quince" → (3, 15)
    ///   - "a las tres y diez" → (3, 10)  (minutos como palabra cardinal)
    private static func extractWordHourMinute(from text: String) -> (Int, Int)? {
        // Prefijos: "a la(s)", "tipo (las)", "como a las", "a eso de las",
        // "cerca de las", "alrededor de las".
        let prefix = #"(?:a la?s?|tipo (?:las? )?|como a la?s?|a eso de la?s?|cerca de la?s?|alrededor de la?s?)"#

        // Patrón completo: prefijo + hour-word + (opcional " y media/cuarto"
        // | " y diez/quince/veinte/veinticinco/treinta" | " treinta/quince").
        let combined = "\(prefix)\\s+\(hourWordsRegex)" +
            #"(?:\s+y\s+(media|cuarto|diez|quince|veinte|veinticinco|treinta))?"# +
            #"(?:\s+(treinta|quince))?"# +
            #"\b"#

        guard let regex = try? NSRegularExpression(
            pattern: combined,
            options: [.caseInsensitive]
        ) else { return nil }

        let ns = text as NSString
        guard let match = regex.firstMatch(
            in: text,
            range: NSRange(location: 0, length: ns.length)
        ) else { return nil }

        let hourWord = ns.substring(with: match.range(at: 1)).lowercased()
        guard let h = hourWords[hourWord] else { return nil }

        var m = 0
        if match.range(at: 2).location != NSNotFound {
            let minuteWord = ns.substring(with: match.range(at: 2)).lowercased()
            m = minuteWordToInt(minuteWord) ?? 0
        } else if match.range(at: 3).location != NSNotFound {
            let minuteWord = ns.substring(with: match.range(at: 3)).lowercased()
            m = minuteWordToInt(minuteWord) ?? 0
        }
        return (h, m)
    }

    /// Convierte "media"/"cuarto"/cardinales-de-minutos → entero.
    private static func minuteWordToInt(_ word: String) -> Int? {
        switch word {
        case "media": return 30
        case "cuarto": return 15
        case "diez": return 10
        case "quince": return 15
        case "veinte": return 20
        case "veinticinco": return 25
        case "treinta": return 30
        default: return nil
        }
    }

    /// "tipo 3" → 15. "tipo 8 de la mañana" → 8. "tipo 12" → 12.
    private static func resolveTipoHour(_ n: Int, in text: String) -> Int {
        let isMorning = text.contains("de la mañana") || text.contains("de la manana") || text.contains(" am")
        let isAfternoon = text.contains("de la tarde") || text.contains("de la noche") || text.contains(" pm")
        if isMorning { return n == 12 ? 0 : n }
        if isAfternoon, n < 12 { return n + 12 }

        // Verb context override antes de la regla coloquial (igual que adjustAmPm).
        switch detectHourContext(in: text) {
        case .forceAM:
            // Solo horas típicas de mañana (6-12). Para 1-5 con school
            // context (e.g. "tipo 1 en la clase"), la lectura típica es PM
            // de tarde — fall-through a colloquial.
            if n >= 6 && n <= 12 {
                return n == 12 ? 0 : n
            }
            break
        case .forcePM:
            if n == 0 { return 12 }
            if n == 12 { return 12 }
            return n < 12 ? n + 12 : n
        case .neutral:
            break
        }

        if n == 0 { return 12 }
        if n == 12 { return 12 }
        if n >= 13 { return n }  // ya en formato 24h
        // 1..11 sin modificador → asumir PM (uso social común).
        return n + 12
    }

    /// Ajusta hora N=1..12 cuando no hay marcador AM/PM. Regla coloquial
    /// para español chileno/latino, refinada con **contexto de verbo**:
    ///
    /// - Marcador explícito "am"/"de la mañana"/"madrugada" → AM (mantener hora).
    /// - Marcador explícito "pm"/"de la tarde"/"de la noche" → PM (+12).
    /// - **Verbo de mañana** (despertar, levantar, amanecer, desayunar) →
    ///   forzar AM ("despertarme a las 7" = 07:00, no 19:00).
    /// - **Verbo de comida/noche** (cenar, comer, almorzar, once) → forzar PM
    ///   ("cenar a las 8" = 20:00, "comer a las 7" = 19:00).
    /// - **Acción matinal** ("salir/ir/entrar" + universidad/colegio/escuela
    ///   /clase/facultad) → forzar AM ("salir a las 6 para la universidad" = 06:00).
    /// - Sin contexto:
    ///   - 1..7 → PM (uso social/diurno típico).
    ///   - 8..11 → AM (típico horario laboral/escolar de mañana).
    ///   - 12 → 12:00 (mediodía).
    static func adjustAmPm(hour: Int, in text: String) -> Int {
        adjustAmPm(
            hour: hour,
            in: text,
            currentHour: Calendar.current.component(.hour, from: referenceNow)
        )
    }

    /// Overload con `currentHour` explícito — usado por tests para hacer
    /// la regla de noche determinista. Producción siempre llama el wrapper
    /// que toma `Date()` real.
    static func adjustAmPm(hour: Int, in text: String, currentHour: Int) -> Int {
        guard hour <= 12 else { return hour }
        // User spec 2026-05-27: el SUBTÍTULO (parte trailing capturada por
        // `extractEventDetail`) NO debe influir en AM/PM del evento
        // principal. Caso real: "terapia a las 6 hablar de la universidad"
        // — la "universidad" en el detalle fuerza forceAM por la regla
        // school context y resulta en 06:00 cuando el usuario espera
        // 18:00 (terapia es PM context). Strippeamos el detalle antes
        // de pasar a detectHourContext.
        let workingText = NovaActionNormalizer
            .extractEventDetail(from: text)
            .strippedText

        // 1) AM explícito.
        if text.range(of: #"\b\d{1,2}\s*(am|a\.m\.)\b"#, options: .regularExpression) != nil
            || text.contains("de la mañana") || text.contains("de la manana")
            || text.contains("madrugada") {
            return hour == 12 ? 0 : hour
        }

        // 2) PM explícito.
        if text.range(of: #"\b\d{1,2}\s*(pm|p\.m\.)\b"#, options: .regularExpression) != nil
            || text.contains("de la tarde") || text.contains("de la noche") {
            return hour == 12 ? 12 : hour + 12
        }

        // 3) Verb context override antes de la regla coloquial. Usa el
        //    texto SIN el detalle trailing — eso evita que palabras del
        //    subtítulo ("hablar de la universidad" → "universidad" como
        //    school context) fuercen AM cuando el evento principal
        //    ("terapia") implica PM.
        switch detectHourContext(in: workingText) {
        case .forceAM:
            // School/morning override SOLO aplica a horas típicas de mañana
            // (6-12). Para 1-5, la frase "clase a las 1:30" suele ser una
            // clase de TARDE — no debe colapsar a 01:30. En esos casos
            // dejamos pasar a la regla coloquial 1-7 → PM más abajo.
            if hour >= 6 && hour <= 12 {
                // "Clase a las 12" → 12:00 NOON, no 00:00 medianoche.
                // Sólo cuando el usuario dice "12 am" explícito caemos a 0.
                let amHour = (hour == 12) ? 12 : hour
                // ──────────────────────────────────────────────────────
                // FUTURE-FIRST OVERRIDE (Caso F del spec):
                // "hoy tengo clase a las 7" a las 14:00 → 19:00, NO 07:00.
                //
                // Cuando el usuario dice EXPLÍCITAMENTE "hoy" y la versión
                // AM ya pasó, preferimos la PM equivalente si está en el
                // futuro. Sin "hoy" explícito mantenemos AM (default
                // escolar matutino — "clase a las 8" normalmente es 8 AM
                // aunque sean las 14).
                //
                // El threshold del nightContext (≥19h) ya cubre noche;
                // este override cubre la franja 7-18h cuando "hoy" es
                // explícito.
                // ──────────────────────────────────────────────────────
                let lowerText = text.lowercased()
                let saysExplicitToday = lowerText.range(of: #"\bhoy\b"#, options: .regularExpression) != nil
                if saysExplicitToday && hour >= 6 && hour <= 11 && amHour < currentHour {
                    let pmHour = hour + 12
                    if pmHour > currentHour {
                        return pmHour
                    }
                }
                return amHour
            }
            // hour ∈ 1..5 con school context → fall-through a colloquial
            break
        case .forcePM:
            return hour == 12 ? 12 : hour + 12
        case .neutral:
            break
        }

        // 4) NIGHT CONTEXT — si son ≥19h (noche) y el usuario dijo una
        // hora pequeña SIN marcador explícito de día ("mañana", "hoy",
        // weekday), probablemente se refiere a "esta noche / madrugada"
        // y no a la mañana siguiente. El usuario que a las 21:53 dice
        // "a las 11" quiere 23:00, no 11:00 AM de mañana.
        //
        // Reglas:
        //   - "a las 12" → 0 (medianoche próxima)
        //   - "a las N" con N ∈ [1, 11]: si N+12 está en el FUTURO del
        //     mismo día (> currentHour), interpretar como PM hoy.
        //     Si N+12 ya pasó → caer a regla coloquial.
        //
        // Ejemplos a las 21 (currentHour=21):
        //   "a las 11" → 11+12=23 > 21 → 23 ✓
        //   "a las 10" → 10+12=22 > 21 → 22 ✓
        //   "a las 9"  → 9+12=21 > 21 falso → coloquial 9 AM
        //   "a las 12" → 0 (medianoche)
        let lowerForDay = text.lowercased()
        let hasExplicitDayMarker = lowerForDay.contains("mañana")
            || lowerForDay.contains("manana")
            || lowerForDay.contains("hoy")
            || lowerForDay.range(
                of: #"\b(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)\b"#,
                options: .regularExpression
            ) != nil
        if !hasExplicitDayMarker, currentHour >= 19 {
            if hour == 12 { return 0 }
            if hour >= 1 && hour <= 11 {
                let pmHour = hour + 12
                if pmHour > currentHour { return pmHour }
            }
        }

        // 5) Sin marcador → regla coloquial chilena/latina.
        if hour >= 1 && hour <= 7 { return hour + 12 }   // 1→13, 3→15, 7→19
        return hour                                        // 8..12 quedan AM
    }

    /// Resultado de inspeccionar el segmento de texto buscando verbos /
    /// contextos que fuercen la hora a AM o PM cuando no hay marcador
    /// explícito ("am"/"pm"/"de la mañana"/"de la tarde").
    private enum HourContext {
        case forceAM
        case forcePM
        case neutral
    }

    /// Detecta verbos y contextos que desambiguan horas 1..12 cuando no hay
    /// marcador AM/PM explícito. Mantener conservador — solo verbos cuyo
    /// significado temporal es claro y no se solapa con otros usos.
    ///
    /// - **AM**: despertar, levantar, amanecer, desayunar.
    /// - **AM por destino**: "salir/ir/entrar" + clase/universidad/colegio/
    ///   escuela/facultad. NO incluye "trabajo/oficina" porque "salir del
    ///   trabajo a las 5" debe leerse como 17:00, no 05:00.
    /// - **PM**: cenar, comer, almorzar, once (la comida chilena, no el
    ///   número).
    private static func detectHourContext(in text: String) -> HourContext {
        let lower = text.lowercased()

        // 1) Verbos AM fuertes (despertar / levantar / amanecer / desayunar).
        let amVerbPattern = #"\b(despertar(me|te|se|nos|los)?|despertame|despertarnos|despierto|despierta|levantar(me|te|se|nos|los)?|levantame|levantarnos|levanto|levanta|amanecer|amanezca|amanezco|desayunar|desayuno|desayunamos)\b"#
        if lower.range(of: amVerbPattern, options: .regularExpression) != nil {
            return .forceAM
        }

        // 2) Acción matinal de desplazamiento + destino educacional, O
        //    SOLO palabra educacional (default morning). Casos:
        //    - "salir a la universidad a las 8" → forceAM
        //    - "ir a clase a las 9" → forceAM
        //    - "clase a las 8" → forceAM (sin verbo, default morning class)
        //
        //    Hacer forceAM con solo hasSchoolWord protege el caso "clase a
        //    las 8" para que la nueva regla de noche (≥19h) NO lo bumpee
        //    a 20:00. En español académico, una clase mencionada sin más
        //    contexto se asume diurna.
        _ = lower.range(  // hasMorningAction se conserva para futuras reglas
            of: #"\b(salir|salgo|sale|ir|voy|vamos|entrar|entro|entra)\b"#,
            options: .regularExpression
        ) != nil
        let hasSchoolWord = lower.range(
            of: #"\b(clase|clases|universidad|colegio|escuela|facultad|liceo|preescolar)\b"#,
            options: .regularExpression
        ) != nil
        if hasSchoolWord {
            return .forceAM
        }

        // 3) Verbos PM fuertes — comidas (almuerzo o cena). En español
        //    latino "comer" se usa tanto para almuerzo como cena → siempre
        //    PM. Excluimos formas como "como" / "come" (tercera/primera
        //    persona indicativo) porque "como" es preposición ambigua.
        let pmVerbPattern = #"\b(cenar|cenando|cenamos|cena|comer|comiendo|comamos|comida|almorzar|almorzando|almorzamos|almuerzo|almuerza|tomar\s+once)\b"#
        if lower.range(of: pmVerbPattern, options: .regularExpression) != nil {
            return .forcePM
        }

        // 4) Verbos / sustantivos PM por contexto vespertino-nocturno:
        //    - dormir/acostarse → noche
        //    - gym/gimnasio/entrenar/entrenamiento → casi siempre tarde
        //    - fútbol/partido/futbol → casi siempre tarde (los matches AM
        //      son raros y el usuario los marcaría con "am" explícito)
        //    - "salida"/"trago"/"copas"/"after"/"bar" → tarde-noche
        //    - Eventos sociales con hora coloquial: cumpleaños/cumple/fiesta/
        //      asado/junta/cena/comida/almuerzo (cuando se nombra como SUSTANTIVO,
        //      no como verbo) → tarde/noche. User spec 2026-05-27.
        //    - Citas: doctor/terapia/médico → tarde por defecto. NO incluye
        //      dentista (típicamente 9 AM) ni psiquiatra (cubierto por
        //      regla coloquial 1-7 → PM cuando aplica).
        //
        //    Mantener la lista corta y solo cubre verbos cuyo significado
        //    temporal en español rioplatense/chileno es claramente vespertino.
        //    Bug fix beta: "recuérdame dormir a las 11" caía como 11:00 AM.
        let pmContextPattern = #"\b(dormir|durmiendo|duermo|duerme|acostar(me|te|se|nos)?|gym|gimnasio|entrenar|entrenando|entrenamiento|f[uú]tbol|futbol|partido|correr|trotar|running|salir\s+a\s+correr|salir\s+a\s+trotar|cumplea[nñ]os|cumple|fiesta|carrete|previa|asado|junta|cena|comida|almuerzo|caf[eé]|doctor|doctora|m[eé]dico|m[eé]dica|terapia|aniversario)\b"#
        if lower.range(of: pmContextPattern, options: .regularExpression) != nil {
            return .forcePM
        }

        return .neutral
    }

    private static func firstCaptureInt(_ text: String, pattern: String, group: Int) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        let range = NSRange(location: 0, length: ns.length)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > group else { return nil }
        let r = match.range(at: group)
        guard r.location != NSNotFound else { return nil }
        return Int(ns.substring(with: r))
    }

    // MARK: - Pending clarification resolution

    /// Intenta resolver el siguiente turno usando un pending guardado por
    /// una clarify previa. Devuelve `nil` cuando el follow-up NO parece
    /// estar respondiendo a la pregunta (el caller debe fall-through).
    ///
    /// Heurísticas (en orden):
    /// 1. "no" / "cancela" / "déjalo" → cancelar pending, devolver smalltalk
    ///    suave ("Listo, lo dejo así.").
    /// 2. "sí" / "dale" / "confirma" → ejecutar acción si pending tiene
    ///    título + fecha + hora. Si falta algo, pedir lo que falta.
    /// 3. Solo hora ("a las 3" / "20:00" / "en 20 minutos"):
    ///       - Si pending.proposedDate existe, combinar hora con esa fecha.
    ///       - Si no, usar hoy (extractDateTime default).
    /// 4. Solo día ("mañana", "viernes"):
    ///       - Si pending.proposedTime ya estaba (por extractDateTime), crear.
    ///       - Si no, actualizar pending y volver a preguntar hora.
    /// 5. Día + hora juntos ("mañana a las 5") → crear con ambos.
    /// 6. Si el input claramente es una acción nueva (event trigger,
    ///    "tengo que", saludo), devolvemos nil para que el flujo normal lo
    ///    capture y descarte el pending.
    private static func resolvePendingFollowUp(
        trimmed: String,
        lower: String,
        wantsReminder: Bool,
        pending: PendingClarification
    ) -> NovaIntent? {
        // 6. Detección temprana de "nueva acción" — si el usuario claramente
        //    quiere hacer algo distinto (event trigger explícito, "tengo que",
        //    "crea tarea"), abandonamos el pending y dejamos que el flujo
        //    normal procese.
        if hasNewActionMarkers(lower) {
            return nil
        }

        // 1. Cancelación explícita.
        if isPendingCancel(lower) {
            return .smallTalk(reply: "Listo, lo dejo así.")
        }

        // 2. Confirmación afirmativa.
        if isPendingConfirm(lower) {
            if pending.missingFields.contains(.date) {
                return .smallTalk(reply: pending.questionAsked ?? "¿Para qué día lo quieres?")
            }
            return completePendingAsEvent(
                pending: pending,
                when: pending.proposedDate,
                wantsReminder: wantsReminder
            )
        }

        // 3-5. Extraer fecha/hora del follow-up y combinarla con pending.
        let extracted = extractDateTime(from: lower)
        let dayExplicit = hasExplicitDayMarker(lower)
        let timeExplicit = hasTimeMarker(lower)

        // Si el follow-up no aporta hora ni día y no es confirmación, no
        // hay forma de completar — devolvemos nil para fall-through.
        if !timeExplicit && !dayExplicit && extracted == nil {
            return nil
        }

        // Combinar: el día viene del input si fue explícito; si no, del
        // pending; si tampoco, hoy. La hora viene del input si fue explícita;
        // si no, del pending.proposedDate (sus h:m); si tampoco, default 9:00.
        let cal = Calendar.current
        let resolvedDate: Date? = combineDateAndTime(
            extracted: extracted,
            dayWasExplicit: dayExplicit,
            timeWasExplicit: timeExplicit,
            pendingDate: pending.proposedDate
        )

        guard let when = resolvedDate else {
            return nil
        }

        // Si después de combinar todavía no tenemos hora real (porque el
        // pending tampoco la tenía y el input solo aportó día), devolvemos
        // clarify pidiendo hora.
        if !timeExplicit && !pendingHadTime(pending: pending) {
            // El usuario eligió día; ahora falta hora.
            return .clarify(reason: .eventNeedsTime(title: pending.proposedTitle ?? "Tarea", partialDate: when))
        }

        _ = cal  // silenciar warning si no se usa más abajo
        return completePendingAsEvent(
            pending: pending,
            when: when,
            wantsReminder: wantsReminder
        )
    }

    /// Combina la fecha/hora del input con la del pending según qué fue
    /// explícito. Implementa la regla: input gana sobre pending para los
    /// campos que el input proveyó; pending llena los huecos.
    private static func combineDateAndTime(
        extracted: Date?,
        dayWasExplicit: Bool,
        timeWasExplicit: Bool,
        pendingDate: Date?
    ) -> Date? {
        let cal = referenceCalendar
        // Caso fácil: input trae día+hora explícitos → usar input tal cual.
        if dayWasExplicit && timeWasExplicit, let extracted {
            return extracted
        }
        // Caso fácil 2: input trae solo hora, pending tiene día → tomar
        // día del pending y hora del input.
        if timeWasExplicit, let extracted, let pendingDate {
            let h = cal.component(.hour, from: extracted)
            let m = cal.component(.minute, from: extracted)
            let baseDay = cal.startOfDay(for: pendingDate)
            return NovaTimeFormatter.civilDate(on: baseDay, hour: h, minute: m, calendar: cal)
        }
        // Solo hora, sin pending → usar `extracted` (será hoy + h:m).
        if timeWasExplicit, let extracted {
            return extracted
        }
        // Solo día, pending tiene hora → cambiar el día del pending al nuevo.
        if dayWasExplicit, let extracted, let pendingDate {
            let h = cal.component(.hour, from: pendingDate)
            let m = cal.component(.minute, from: pendingDate)
            let baseDay = cal.startOfDay(for: extracted)
            return NovaTimeFormatter.civilDate(on: baseDay, hour: h, minute: m, calendar: cal)
        }
        // Solo día, sin pending o pending sin hora → devolver día (con 9:00
        // default que viene de extractDateTime). Caller decidirá si pide hora.
        if dayWasExplicit {
            return extracted
        }
        // Ninguno explícito → no hay nada para combinar.
        return extracted
    }

    /// Missing-field metadata distinguishes a requested 09:00 from a default.
    private static func pendingHadTime(pending: PendingClarification) -> Bool {
        pending.proposedDate != nil && !pending.missingFields.contains(.time)
    }

    static func hasExplicitDayMarker(_ lower: String) -> Bool {
        dayMarker(in: lower) != nil
    }

    /// True si el input parece arrancar una nueva acción (no completar el
    /// pending). Detección conservadora: solo descartamos pending si el
    /// usuario claramente empezó algo nuevo.
    private static func hasNewActionMarkers(_ lower: String) -> Bool {
        let eventStarters = [
            "agenda ", "agéndame", "agendame", "agendar ",
            "crea evento", "crea un evento", "nuevo evento",
            "tengo reunión", "tengo reunion", "tengo clase",
            "tengo prueba", "tengo parcial", "tengo examen", "tengo final",
            "tengo entrega", "tengo cita", "tengo turno", "tengo médico",
            "tengo medico", "tengo doctor", "tengo evento",
            "salir a ", "salir con ", "ir a ", "voy a ",
            "buscar a ", "ir a buscar ",
            "reunión con ", "reunion con ",
            "juntarme con ", "almuerzo con ", "cena con ",
            "tengo que ", "crea tarea", "nueva tarea",
            "comprar ", "llamar ", "estudiar ", "leer ", "escribir ",
            "organiza mi día", "organiza el día",
            "qué tengo", "que tengo", "qué sigue", "que sigue"
        ]
        return matchesAny(lower, eventStarters)
    }

    /// Patrones de respuesta afirmativa corta.
    private static func isPendingConfirm(_ lower: String) -> Bool {
        let confirm: Set<String> = [
            "sí", "si", "sí.", "si.", "sí!", "si!",
            "dale", "dale!",
            "confirma", "confírma", "confírmalo", "confirmalo",
            "ok", "okay", "vale", "perfecto", "listo",
            "claro", "claro que sí", "claro que si",
            "así está bien", "asi esta bien", "así es", "asi es"
        ]
        return confirm.contains(lower)
    }

    /// Patrones de cancelación corta.
    private static func isPendingCancel(_ lower: String) -> Bool {
        let cancel: Set<String> = [
            "no", "no,", "no.",
            "cancela", "cancelar", "cancélalo", "cancelalo",
            "déjalo", "dejalo", "déjalo así", "dejalo asi",
            "olvídalo", "olvidalo", "olvídate", "olvidate",
            "no importa", "nada", "mejor no"
        ]
        return cancel.contains(lower)
    }

    /// Construye un `NovaIntent` usando el pending + when final.
    /// - pending.kind == .task → createTask con dueDate=when.
    /// - resto → createEvent (con isReminder según wantsReminder).
    private static func completePendingAsEvent(
        pending: PendingClarification,
        when: Date?,
        wantsReminder: Bool
    ) -> NovaIntent {
        let title = pending.proposedTitle ?? "Recordatorio"
        let combinedReminder = wantsReminder || pending.wantsReminder

        // Tarea explícita: respetar el kind original del pending.
        if pending.kind == .task {
            return .createTask(
                title: title,
                dueDate: when,
                recurrence: nil,
                wantsReminder: combinedReminder
            )
        }

        // Sin fecha resuelta no podemos crear evento — pedir hora.
        guard let when else {
            return .clarify(reason: .eventNeedsTime(title: title, partialDate: Date()))
        }

        return .createEvent(
            title: title,
            when: when,
            endTime: nil,
            location: pending.proposedLocation,
            section: pending.proposedSection,
            wantsReminder: combinedReminder
        )
    }

    private static func extractLocation(from text: String) -> String? {
        // Busca " en <X>" donde X termina en fin/coma/punto/salto-de-línea.
        // Acepta tildes y mayúsculas (case-insensitive).
        guard let range = text.range(
            of: #"(?i)(^|\s)en\s+([^.,;\n]+)"#,
            options: .regularExpression
        ) else { return nil }
        let chunk = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        // Quita el prefijo "en " (puede tener acento por ejemplo "En ")
        let withoutPrefix = chunk
            .replacingOccurrences(of: #"^(?i)en\s+"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !withoutPrefix.isEmpty else { return nil }
        // Rechazo de "ubicaciones" que son en realidad expresiones horarias:
        // "en 20" / "en 20 minutos" / "en 2 horas" / "en 20 hrs" — son tiempo,
        // no lugar. Sin este filtro, FocusEvent.location quedaría con "20".
        if withoutPrefix.range(
            of: #"^\d{1,3}(\s+(min|minutos?|h|hs|hrs?|horas?))?$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil {
            return nil
        }
        return cleanupTitle(withoutPrefix)
    }

}

/// Store central de la app. Carga desde persistencia local con fallback a demo state.
///
/// Persistencia:
/// - `events` / `tasks`: inician vacíos por diseño (la UI muestra ejemplos hasta que el
///   usuario cree el primero). Si hay datos guardados, se cargan.
/// - `suggestions` / `novaMessages`: fallback a DemoDataProvider si no hay datos guardados,
///   para que la app tenga vida desde el primer launch.
/// - `settings`: fallback a `.defaults`.
///
/// Guardado: solo en mutaciones explícitas (helpers `persist*()`). Nunca en computed
/// properties ni en cada body render — evita loops de SwiftUI.
@MainActor
final class FocusDataStore: ObservableObject {
    @Published var events: [FocusEvent]
    /// Eventos del calendario del iPhone (EventKit, `source: .apple`).
    /// Array SEPARADO de `events` a propósito: `SupabaseSyncService` lee
    /// `events` y jamás debe subir a la nube un evento que no es de Focus.
    /// Solo se mergean en la capa de lectura (`eventsFor(date:)`). No se
    /// persisten — se re-fetchean del sistema en cada launch/refresh.
    @Published private(set) var systemEvents: [FocusEvent] = []
    @Published var tasks: [FocusTask]
    @Published var suggestions: [NovaSuggestion]
    @Published var novaMessages: [NovaMessage]
    @Published var settings: AppSettings
    /// Memoria de sesión para Nova. NO persiste a disco — se reinicia con
    /// cada launch. Permite resolver "agéndalo X" o "y X" usando el último
    /// intent procesado.
    @Published var novaContext: NovaContext = NovaContext()
    /// True mientras Nova "tipea" la respuesta. Se usa en el Chat para
    /// mostrar el indicador de 3 puntos.
    @Published var isNovaTyping: Bool = false

    // MARK: - Sync state (Bloque 3 — Supabase events/tasks)

    /// Credenciales para sync. `FocusApp` las inyecta cada vez que cambia
    /// `AuthStore.state`. Cuando es nil → modo demo o logged-out → NO sync.
    /// Cuando hay valor → store dispara fetch + upserts en background.
    struct SyncCredentials: Equatable {
        let accessToken: String
        let userId: UUID
    }
    @Published var syncCredentials: SyncCredentials? = nil
    /// Changes when the data owner changes, including signing out. Async Nova,
    /// sync and notification work must check this before applying results.
    private(set) var accountGeneration = UUID()
    private var activeAccountID: UUID?
    private var outbox = FocusSyncOutbox()
    private var recoveryEventIDs: [UUID: UUID] = [:]
    private var recoveryTaskIDs: [UUID: UUID] = [:]
    private var novaAppliedActionIDs: Set<String> = []
    private var currentNovaActionID: String?
    private var syncTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var retryAttempt = 0
    private let syncTransport: FocusSyncTransport
    private let schedulesNotifications: Bool
    private let novaTransport: (NovaService.Request) async throws -> NovaService.Result
    @Published private(set) var pendingSyncCount = 0
    @Published private(set) var localSaveError: String?
    @Published private(set) var notificationPermissionDenied = false
    var localPersistenceError: String? { localSaveError }
    @Published private(set) var hasUnassignedLegacyData = FocusLocalStore.hasUnassignedLegacyData

    /// Estado visible para Ajustes → "Sincronización".
    enum SyncState: Equatable {
        case demo                       // Sin sesión → no sync
        case loggedOut                  // Logueado pero credenciales aún no llegan
        case idle                       // Logueado, no hay sync corriendo
        case syncing                    // Hay fetch/upsert activo
        case error(String)              // Última sync falló
    }
    @Published var syncState: SyncState = .demo
    @Published var lastSyncAt: Date? = nil
    /// Títulos de ítems demo descartados por el usuario. **Sí persisten** a
    /// disco — si el usuario hace swipe-borrar a un ejemplo, no debe volver
    /// a aparecer al reabrir la app. Solo aplica cuando `!hasUserData`.
    @Published var dismissedDemoEventTitles: Set<String>
    @Published var dismissedDemoTaskTitles: Set<String>

    /// IDs de items que el usuario borró localmente pero cuya soft-delete
    /// remota puede haber fallado (sin red, error transitorio). Persiste a
    /// disco; en cada `fetchRemoteAndMerge` reintentamos la soft-delete y,
    /// si el remoto todavía devuelve el ítem, lo excluimos del merge así
    /// no "revive" en la UI.
    @Published private(set) var pendingDeleteEventIds: Set<UUID>
    @Published private(set) var pendingDeleteTaskIds: Set<UUID>

    init(syncTransport: FocusSyncTransport = .live, restoreAccount: Bool = true, schedulesNotifications: Bool = true,
         novaTransport: @escaping (NovaService.Request) async throws -> NovaService.Result = NovaService.send) {
        self.syncTransport = syncTransport
        self.novaTransport = novaTransport
        self.schedulesNotifications = schedulesNotifications
        var shouldRestore = restoreAccount
        #if DEBUG
        if CommandLine.arguments.contains("--ui-testing") {
            shouldRestore = false
            FocusLocalStore.activateAccount(nil)
            if CommandLine.arguments.contains("--reset-fixture") { FocusLocalStore.clearAll() }
        }
        #endif
        let accountID = shouldRestore ? KeychainStore.get(.userId).flatMap(UUID.init(uuidString:)) : nil
        self.activeAccountID = accountID
        FocusLocalStore.activateAccount(accountID)
        let snapshot = FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)
        self.events = snapshot?.events ?? FocusLocalStore.load([FocusEvent].self, forKey: .events) ?? []
        self.tasks = snapshot?.tasks ?? FocusLocalStore.load([FocusTask].self, forKey: .tasks) ?? []
        self.outbox = snapshot?.outbox ?? FocusSyncOutbox()
        self.recoveryEventIDs = snapshot?.recoveryEventIDs ?? [:]
        self.recoveryTaskIDs = snapshot?.recoveryTaskIDs ?? [:]
        self.novaAppliedActionIDs = snapshot?.novaAppliedActionIDs ?? []
        self.pendingSyncCount = self.outbox.mutations.count

        // Sugerencias: NO pre-seedeamos demo en el store. Las demos viven
        // solo como fallback dinámico en `displaySuggestions` cuando no hay
        // datos del usuario. Esto evita que queden "stale" referenciando
        // tareas/eventos inexistentes.
        //
        // Migración (one-shot): si el usuario tiene sugerencias persistidas
        // que coinciden por título con el seed demo legacy y siguen en
        // `.pending`, las purgamos. Las creadas por quick actions de Nova
        // (organizar, preparar mañana, etc.) tienen títulos distintos y
        // sobreviven.
        let legacyDemoSeedTitles = Set(DemoDataProvider.shared.suggestions().map(\.title))
        var loadedSuggestions = FocusLocalStore.load([NovaSuggestion].self, forKey: .suggestions) ?? []
        loadedSuggestions.removeAll { sug in
            legacyDemoSeedTitles.contains(sug.title) && sug.status == .pending
        }
        self.suggestions = loadedSuggestions

        // Chat arranca vacío para que aparezca el empty-state estilo Gemini
        // ("¿Qué quieres ordenar?" + chips). El mensaje de bienvenida vive
        // solo en la UI cuando no hay historial.
        self.novaMessages = FocusLocalStore.load([NovaMessage].self, forKey: .novaMessages) ?? []
        self.settings = FocusLocalStore.load(AppSettings.self, forKey: .settings)
            ?? .defaults

        // Descartes de demo: cargar persistidos para que sobrevivan al cierre
        // de app. Si el usuario borró un ejemplo, no debe volver al reabrir.
        let storedDismissedEvents = FocusLocalStore.load([String].self, forKey: .dismissedDemoEvents) ?? []
        let storedDismissedTasks = FocusLocalStore.load([String].self, forKey: .dismissedDemoTasks) ?? []
        self.dismissedDemoEventTitles = Set(storedDismissedEvents)
        self.dismissedDemoTaskTitles = Set(storedDismissedTasks)

        // Cola persistente de soft-deletes pendientes. Si la app se mata
        // antes de confirmar el delete remoto, lo retomamos en el próximo
        // fetch+merge.
        let pendingEvtIds = FocusLocalStore.load([UUID].self, forKey: .pendingDeleteEvents) ?? []
        let pendingTaskIds = FocusLocalStore.load([UUID].self, forKey: .pendingDeleteTasks) ?? []
        self.pendingDeleteEventIds = Set(snapshot?.outbox.mutations.filter { $0.entity == .event && $0.operation == .delete }.map(\.id) ?? pendingEvtIds)
        self.pendingDeleteTaskIds = Set(snapshot?.outbox.mutations.filter { $0.entity == .task && $0.operation == .delete }.map(\.id) ?? pendingTaskIds)

        // Calendario del iPhone: fetch inicial (no-op si el toggle está off
        // o falta permiso) + re-fetch cuando el calendario del sistema
        // cambie por fuera (editar en la app Calendario, invite entrante…).
        SystemCalendarService.shared.onStoreChanged = { [weak self] in
            self?.refreshSystemEvents()
        }
        NovaMemoryStore.shared.reloadForCurrentAccount()
        refreshSystemEvents()
    }

    // MARK: - Calendario del sistema (EventKit, read-only)

    /// Re-fetchea los eventos del iPhone para la ventana visible
    /// (ayer → +45 días). Barato: query síncrona de EventKit (~ms).
    /// Si el toggle está off o no hay permiso, vacía el array.
    func refreshSystemEvents() {
        guard settings.systemCalendarOn, SystemCalendarService.shared.isAuthorized else {
            if !systemEvents.isEmpty { systemEvents = [] }
            syncWidgetSnapshot()
            return
        }
        let cal = Calendar.current
        let todayStart = cal.startOfDay(for: Date())
        let windowStart = cal.date(byAdding: .day, value: -1, to: todayStart) ?? todayStart
        let windowEnd = cal.date(byAdding: .day, value: 45, to: todayStart) ?? todayStart
        systemEvents = SystemCalendarService.shared.events(from: windowStart, to: windowEnd)
        syncWidgetSnapshot()
    }

    private func persistPendingDeleteEvents() {
        FocusLocalStore.save(Array(pendingDeleteEventIds), forKey: .pendingDeleteEvents)
    }
    private func persistPendingDeleteTasks() {
        FocusLocalStore.save(Array(pendingDeleteTaskIds), forKey: .pendingDeleteTasks)
    }

    private func persistDismissedDemoEvents() {
        FocusLocalStore.save(Array(dismissedDemoEventTitles), forKey: .dismissedDemoEvents)
    }
    private func persistDismissedDemoTasks() {
        FocusLocalStore.save(Array(dismissedDemoTaskTitles), forKey: .dismissedDemoTasks)
    }

    func dismissDemoEvent(title: String) {
        dismissedDemoEventTitles.insert(title)
        persistDismissedDemoEvents()
    }
    func dismissDemoTask(title: String) {
        dismissedDemoTaskTitles.insert(title)
        persistDismissedDemoTasks()
    }

    // MARK: - Explicit recovery

    private var legacyImportKey: String { FocusLocalStore.scopedStorageKey(for: "legacyImported") }
    private var guestImportKey: String { FocusLocalStore.scopedStorageKey(for: "guestImported") }

    var legacyRecoveryCount: Int {
        guard !UserDefaults.standard.bool(forKey: legacyImportKey) else { return 0 }
        let source = FocusLocalStore.legacyRecoverySnapshot()
        return recoverableEvents(source.events).count + recoverableTasks(source.tasks).count
    }

    var guestRecoveryCount: Int {
        guard activeAccountID != nil, !UserDefaults.standard.bool(forKey: guestImportKey),
              let source = FocusLocalStore.guestRecoverySnapshot() else { return 0 }
        return recoverableEvents(source.events).count + recoverableTasks(source.tasks).count
    }

    @discardableResult
    func importLegacyDataIntoCurrentAccount() -> Bool {
        guard !UserDefaults.standard.bool(forKey: legacyImportKey) else { return true }
        return importRecoveredData(FocusLocalStore.legacyRecoverySnapshot(), marker: legacyImportKey)
    }

    @discardableResult
    func importGuestDataIntoCurrentAccount() -> Bool {
        guard activeAccountID != nil else { return false }
        guard !UserDefaults.standard.bool(forKey: guestImportKey) else { return true }
        guard let source = FocusLocalStore.guestRecoverySnapshot() else { return false }
        return importRecoveredData(source, marker: guestImportKey)
    }

    private func recoverableEvents(_ source: [FocusEvent]) -> [FocusEvent] {
        var seen = Set(events.map(\.id))
        return source.filter { event in
            let destination = recoveryEventIDs[event.id] ?? event.id
            guard !event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !seen.contains(event.id) else { return false }
            return seen.insert(destination).inserted
        }
    }

    private func recoverableTasks(_ source: [FocusTask]) -> [FocusTask] {
        var seen = Set(tasks.map(\.id))
        return source.filter { task in
            let destination = recoveryTaskIDs[task.id] ?? task.id
            guard !task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !seen.contains(task.id) else { return false }
            return seen.insert(destination).inserted
        }
    }

    private func importRecoveredData(_ source: FocusSyncSnapshot, marker: String) -> Bool {
        let incomingEvents = recoverableEvents(source.events)
        let incomingTasks = recoverableTasks(source.tasks)
        guard commitLocalMutation({
            // Cloud primary keys are global across owners. Recovered records get
            // destination-owned IDs, persisted in the same transaction as data.
            // Repeating an import or recovering another source reuses the mapping.
            let currentEvents = Set(events.map(\.id))
            let currentTasks = Set(tasks.map(\.id))
            for event in source.events where recoveryEventIDs[event.id] == nil {
                recoveryEventIDs[event.id] = currentEvents.contains(event.id) || activeAccountID == nil ? event.id : UUID()
            }
            for task in source.tasks where recoveryTaskIDs[task.id] == nil {
                recoveryTaskIDs[task.id] = currentTasks.contains(task.id) || activeAccountID == nil ? task.id : UUID()
            }
            for original in incomingEvents {
                let copy = FocusEvent(
                    id: recoveryEventIDs[original.id] ?? original.id,
                    title: original.title, notes: original.notes, startTime: original.startTime,
                    endTime: original.endTime, section: original.section, status: original.status,
                    location: original.location, featured: original.featured,
                    linkedTaskIds: original.linkedTaskIds.map { recoveryTaskIDs[$0] ?? $0 },
                    source: original.source, externalCalendarId: original.externalCalendarId,
                    externalEventId: original.externalEventId, url: original.url,
                    lastSyncedAt: original.lastSyncedAt, isReminder: original.isReminder,
                    inferredDuration: original.inferredDuration, reminderOffsets: original.reminderOffsets,
                    reminderNotes: original.reminderNotes, subtitle: original.subtitle
                )
                events.append(copy)
                enqueueSync(.event, id: copy.id, operation: .upsert)
            }
            for original in incomingTasks {
                let copy = FocusTask(
                    id: recoveryTaskIDs[original.id] ?? original.id, title: original.title,
                    notes: original.notes, done: original.done, doneAt: original.doneAt,
                    priority: original.priority, category: original.category,
                    dueDate: original.dueDate, dueTime: original.dueTime, subtasks: original.subtasks,
                    linkedEventId: original.linkedEventId.map { recoveryEventIDs[$0] ?? $0 },
                    parentTaskId: original.parentTaskId.map { recoveryTaskIDs[$0] ?? $0 }
                )
                tasks.append(copy)
                enqueueSync(.task, id: copy.id, operation: .upsert)
            }
            events.sort { $0.startTime < $1.startTime }
        }) else { return false }
        UserDefaults.standard.set(true, forKey: marker)
        objectWillChange.send()
        requestSync()
        resyncAllLocalNotifications()
        return true
    }

    // MARK: - Nova context (memoria de sesión)

    /// Actualiza el contexto después de procesar un intent. Permite que el
    /// siguiente turno resuelva referencias ("agéndalo como tarea") sin
    /// pedirle al usuario que repita.
    ///
    /// **Topic focus**: si pasamos `eventId`, lo PROMOVEMOS al frente de
    /// `discussedEvents` — eso permite que un reminder pedido en el
    /// siguiente turno se resuelva implícitamente a este evento.
    /// Conservamos los otros items discutidos para que el user pueda
    /// volver a un tema anterior sin perder contexto. Cap en 5 items.
    func updateNovaContext(
        from input: String,
        title: String,
        date: Date? = nil,
        location: String? = nil,
        section: EventSection? = nil,
        kind: NovaContext.Kind,
        eventId: UUID? = nil,
        taskId: UUID? = nil
    ) {
        var newDiscussed = novaContext.discussedEvents.filter { $0.isFresh }
        if let eid = eventId {
            // Remueve duplicados y reinsertala adelante con timestamp nuevo.
            newDiscussed.removeAll { $0.eventId == eid }
            newDiscussed.insert(
                DiscussedEvent(eventId: eid, title: title, mentionedAt: Date()),
                at: 0
            )
            newDiscussed = Array(newDiscussed.prefix(5))
        }
        novaContext = NovaContext(
            lastInputText: input,
            lastTitle: title,
            lastDate: date,
            lastLocation: location,
            lastSection: section,
            lastIntentKind: kind,
            lastEventId: eventId,
            lastTaskId: taskId,
            pendingClarification: nil,
            discussedEvents: newDiscussed,
            updatedAt: Date()
        )
    }

    /// Promueve un evento al frente de `discussedEvents` sin cambiar el
    /// resto del contexto. Útil cuando el user MENCIONA un evento
    /// existente (sin crearlo/editarlo) — eso también lo pone "en foco"
    /// para resolución de futuras referencias ambiguas.
    func promoteDiscussedEvent(eventId: UUID, title: String) {
        var ctx = novaContext
        var newDiscussed = ctx.discussedEvents.filter { $0.isFresh }
        newDiscussed.removeAll { $0.eventId == eventId }
        newDiscussed.insert(
            DiscussedEvent(eventId: eventId, title: title, mentionedAt: Date()),
            at: 0
        )
        ctx.discussedEvents = Array(newDiscussed.prefix(5))
        ctx.updatedAt = Date()
        novaContext = ctx
    }

    /// Detecta menciones de eventos existentes en el texto del user y
    /// promueve cada match al frente de `discussedEvents`. Llamar antes
    /// de procesar el intent — así el parser ya tiene el topic focus
    /// correcto para resolver referencias implícitas en el MISMO turno.
    ///
    /// Match: substring case-insensitive entre el texto y title de cada
    /// evento. Mínimo 4 chars de overlap para evitar falsos positivos
    /// (palabras cortas como "ir", "de" no cuentan).
    func detectAndPromoteMentions(in userText: String) {
        let lowerText = userText.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
        for event in events {
            let lowerTitle = event.title.lowercased()
                .folding(options: .diacriticInsensitive, locale: .current)
            guard !lowerTitle.isEmpty, lowerTitle.count >= 4 else { continue }
            // Match A: el título entero aparece en el texto.
            // Match B: ≥1 palabra "fuerte" del título (≥4 chars) aparece en el texto.
            let directMatch = lowerText.contains(lowerTitle)
            let wordMatch: Bool = {
                let words = lowerTitle.split(separator: " ")
                    .map(String.init)
                    .filter { $0.count >= 4 && !["clase", "evento", "tarea", "reunion"].contains($0) }
                return words.contains { lowerText.contains($0) }
            }()
            if directMatch || wordMatch {
                promoteDiscussedEvent(eventId: event.id, title: event.title)
            }
        }
    }

    /// Guarda una aclaración pendiente. El siguiente turno del usuario
    /// (corto: solo hora, solo día, "sí", "no", etc.) puede usar este
    /// pending para completar la acción sin perder contexto.
    func setPendingClarification(_ pending: PendingClarification) {
        var ctx = novaContext
        ctx.pendingClarification = pending
        ctx.updatedAt = Date()
        novaContext = ctx
    }

    /// Limpia solo el pending sin tocar el resto del contexto.
    func clearPendingClarification() {
        guard novaContext.pendingClarification != nil else { return }
        var ctx = novaContext
        ctx.pendingClarification = nil
        novaContext = ctx
    }

    func clearNovaContext() {
        novaContext = NovaContext()
    }

    // MARK: - Sync coordination (called by FocusApp on auth changes)

    /// An account switch loads a separate local partition. Guest/legacy data is
    /// never uploaded implicitly to whichever account signs in next.
    func applyAuthChange(accessToken: String?, userId: UUID?) {
        let nextAccount = (accessToken != nil) ? userId : nil
        if nextAccount != activeAccountID {
            accountGeneration = UUID()
            syncTask?.cancel()
            syncTask = nil
            retryTask?.cancel()
            retryTask = nil
            retryAttempt = 0
            cancelNovaRequest()
            activeAccountID = nextAccount
            FocusLocalStore.activateAccount(nextAccount)
            loadCurrentAccount()
            NovaMemoryStore.shared.reloadForCurrentAccount()
            let generation = accountGeneration
            Task { [weak self] in
                guard let self, self.accountGeneration == generation else { return }
                await LocalNotificationService.shared.cancelAllReminders()
                guard self.accountGeneration == generation else { return }
                self.resyncAllLocalNotifications()
            }
        }
        guard let accessToken, let userId else {
            syncCredentials = nil
            syncState = .demo
            return
        }
        let credentials = SyncCredentials(accessToken: accessToken, userId: userId)
        let changed = syncCredentials != credentials
        syncCredentials = credentials
        if changed {
            retryTask?.cancel()
            retryTask = nil
            syncState = .idle
            requestSync()
        }
    }

    private func loadCurrentAccount() {
        let snapshot = FocusLocalStore.load(FocusSyncSnapshot.self, forKey: .syncSnapshot)
        events = snapshot?.events ?? []
        tasks = snapshot?.tasks ?? []
        outbox = snapshot?.outbox ?? FocusSyncOutbox()
        recoveryEventIDs = snapshot?.recoveryEventIDs ?? [:]
        recoveryTaskIDs = snapshot?.recoveryTaskIDs ?? [:]
        novaAppliedActionIDs = snapshot?.novaAppliedActionIDs ?? []
        pendingSyncCount = outbox.mutations.count
        pendingDeleteEventIds = Set(outbox.mutations.filter { $0.entity == .event && $0.operation == .delete }.map(\.id))
        pendingDeleteTaskIds = Set(outbox.mutations.filter { $0.entity == .task && $0.operation == .delete }.map(\.id))
        suggestions = FocusLocalStore.load([NovaSuggestion].self, forKey: .suggestions) ?? []
        novaMessages = FocusLocalStore.load([NovaMessage].self, forKey: .novaMessages) ?? []
        settings = FocusLocalStore.load(AppSettings.self, forKey: .settings) ?? .defaults
        dismissedDemoEventTitles = Set(FocusLocalStore.load([String].self, forKey: .dismissedDemoEvents) ?? [])
        dismissedDemoTaskTitles = Set(FocusLocalStore.load([String].self, forKey: .dismissedDemoTasks) ?? [])
        novaContext = NovaContext()
        lastSyncAt = nil
        localSaveError = nil
        notificationPermissionDenied = false
        systemEvents = []
        refreshSystemEvents()
        syncWidgetSnapshot()
    }

    private func requestSync() {
        guard syncCredentials != nil else { return }
        Task { [weak self] in await self?.fetchRemoteAndMerge() }
    }

    /// A single worker uploads queued changes in order before reading remote
    /// rows. New edits during a request keep their revision and are drained next.
    func fetchRemoteAndMerge() async {
        guard syncCredentials != nil else { return }
        if let current = syncTask {
            await current.value
            return
        }
        retryTask?.cancel()
        retryTask = nil
        let generation = accountGeneration
        let worker = Task { [weak self] in
            guard let self else { return }
            await self.runSync(generation: generation)
        }
        syncTask = worker
        await worker.value
        guard accountGeneration == generation else { return }
        syncTask = nil
    }

    private func runSync(generation: UUID) async {
        guard let credentials = syncCredentials else { return }
        syncState = .syncing
        do {
            repeat {
                while let mutation = outbox.mutations.first {
                    try Task.checkCancellation()
                    guard accountGeneration == generation else { return }
                    // Capture current data with its queued revision before await.
                    switch (mutation.entity, mutation.operation) {
                    case (.event, .upsert):
                        if let event = events.first(where: { $0.id == mutation.id }) {
                            try await syncTransport.upsertEvent(RemoteFocusEvent(local: event, userId: credentials.userId), credentials.accessToken)
                        }
                    case (.task, .upsert):
                        if let task = tasks.first(where: { $0.id == mutation.id }) {
                            try await syncTransport.upsertTask(RemoteFocusTask(local: task, userId: credentials.userId), credentials.accessToken)
                        }
                    case (.event, .delete):
                        try await syncTransport.deleteEvent(mutation.id, credentials.accessToken)
                    case (.task, .delete):
                        try await syncTransport.deleteTask(mutation.id, credentials.accessToken)
                    }
                    try Task.checkCancellation()
                    guard accountGeneration == generation else { return }
                    outbox.acknowledge(mutation)
                    refreshPendingDeletes()
                    persistSyncSnapshot()
                }
                async let remoteEvents = syncTransport.fetchEvents(credentials.accessToken, credentials.userId.uuidString)
                async let remoteTasks = syncTransport.fetchTasks(credentials.accessToken, credentials.userId.uuidString)
                let (incomingEvents, incomingTasks) = try await (remoteEvents, remoteTasks)
                try Task.checkCancellation()
                guard accountGeneration == generation else { return }
                mergeRemoteEvents(incomingEvents.filter { $0.userId == credentials.userId })
                mergeRemoteTasks(incomingTasks.filter { $0.userId == credentials.userId })
                // A mutation made while fetching is protected by the outbox and
                // will be uploaded before a subsequent remote reconciliation.
            } while !outbox.mutations.isEmpty
            guard accountGeneration == generation else { return }
            lastSyncAt = Date()
            retryAttempt = 0
            syncState = .idle
        } catch is CancellationError {
            // Ownership changed or the user cleared local data.
        } catch {
            guard accountGeneration == generation else { return }
            syncState = .error("Tus cambios están guardados en este iPhone. Reintentaremos la sincronización cuando haya conexión.")
            scheduleRetry(generation: generation)
        }
    }

    private func scheduleRetry(generation: UUID) {
        retryAttempt = min(retryAttempt + 1, 6)
        let seconds = min(60, 1 << retryAttempt)
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000) }
            catch { return }
            guard let self, self.accountGeneration == generation else { return }
            self.retryTask = nil
            await self.fetchRemoteAndMerge()
        }
    }

    private func mergeRemoteEvents(_ remote: [RemoteFocusEvent]) {
        var byId = Dictionary(events.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        for row in remote {
            guard !outbox.contains(.event, id: row.id) else { continue }
            if row.deletedAt != nil {
                byId.removeValue(forKey: row.id)
                LocalNotificationService.shared.cancelReminder(eventId: row.id)
            } else if var event = row.toLocal() {
                // These fields are not represented in the current server schema.
                // Keep them locally until a versioned server migration supports them.
                if let prior = byId[row.id] {
                    event.status = prior.status
                    event.featured = prior.featured
                    event.linkedTaskIds = prior.linkedTaskIds
                }
                byId[row.id] = event
            }
        }
        events = byId.values.sorted { $0.startTime < $1.startTime }
        persistEvents()
        resyncAllLocalNotifications()
    }

    private func mergeRemoteTasks(_ remote: [RemoteFocusTask]) {
        var byId = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        for row in remote {
            guard !outbox.contains(.task, id: row.id) else { continue }
            if row.deletedAt != nil {
                byId.removeValue(forKey: row.id)
            } else {
                var task = row.toLocal()
                task.parentTaskId = byId[row.id]?.parentTaskId
                byId[row.id] = task
            }
        }
        tasks = byId.values.sorted { $0.id.uuidString < $1.id.uuidString }
        persistTasks()
    }

    private func enqueueSync(_ entity: FocusSyncOutbox.Entity, id: UUID, operation: FocusSyncOutbox.Operation) {
        // Account-owned edits remain queued even while a token is being refreshed.
        // Guest edits live in their own partition and never enter a user's cloud.
        if activeAccountID != nil { outbox.enqueue(entity, id: id, operation: operation) }
        refreshPendingDeletes()
    }

    private func refreshPendingDeletes() {
        pendingSyncCount = outbox.mutations.count
        pendingDeleteEventIds = Set(outbox.mutations.filter { $0.entity == .event && $0.operation == .delete }.map(\.id))
        pendingDeleteTaskIds = Set(outbox.mutations.filter { $0.entity == .task && $0.operation == .delete }.map(\.id))
    }

    @discardableResult
    private func persistSyncSnapshot() -> Bool {
        let saved = FocusLocalStore.saveSync(FocusSyncSnapshot(events: events, tasks: tasks, outbox: outbox, recoveryEventIDs: recoveryEventIDs, recoveryTaskIDs: recoveryTaskIDs, novaAppliedActionIDs: novaAppliedActionIDs), forKey: .syncSnapshot)
        localSaveError = saved ? nil : "No pudimos guardar el cambio. Revisa el espacio disponible en tu iPhone e inténtalo de nuevo."
        if let localSaveError { syncState = .error(localSaveError) }
        return saved
    }

    // MARK: - Historial conversacional (compartido chat ↔ Mi Día)

    /// Registra un turno de la conversación INLINE de Mi Día en el mismo
    /// historial (`novaMessages`) que usa el chat dedicado. Antes el composer
    /// de Mi Día solo LEÍA `novaMessages` (vía `recentNovaHistory()`) pero
    /// nunca escribía → el backend recibía `history: []` para los turnos de
    /// Mi Día y no podía resolver referencias entre turnos ("muévela",
    /// "ponle…", "esa llamada"). Bug de memoria reportado 2026-06-13.
    /// Al unificar el historial, la memoria multi-turno funciona igual en
    /// el chat y en Mi Día, y el contexto es continuo entre ambas superficies.
    func recordInlineNovaTurn(userText: String, assistantReply: String) {
        let u = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        novaMessages.append(NovaMessage(role: .user, content: u))
        let a = assistantReply.trimmingCharacters(in: .whitespacesAndNewlines)
        if !a.isEmpty {
            novaMessages.append(NovaMessage(role: .nova, content: a))
        }
        persistNovaMessages()
    }

    // MARK: - Persistencia (privado)

    @discardableResult
    private func persistEvents() -> Bool {
        let saved = persistSyncSnapshot()
        syncWidgetSnapshot()
        return saved
    }

    // MARK: - Widget snapshot (App Group)

    /// Hex por sección — espejo de Theme.Colors.section* (el widget no
    /// comparte el target, así que viaja como string en el snapshot).
    private static let widgetSectionHex: [EventSection: String] = [
        .foco: "2563EB", .reunion: "6366F1", .personal: "06B6D4",
        .estudio: "8B5CF6", .descanso: "0D9488",
        .entrenamiento: "16A34A", .reminder: "D97706",
    ]

    /// Escribe el snapshot de eventos de HOY (propios + calendario del
    /// iPhone) al App Group y pide a WidgetKit que refresque. Formato JSON
    /// mínimo: t=título, s/e=epoch inicio/fin, c=hex. Se llama en cada
    /// persistEvents() y refreshSystemEvents() — barato (pocos KB).
    func syncWidgetSnapshot() {
        guard let defaults = UserDefaults(suiteName: "group.me.usefocus.app") else { return }
        let cal = Calendar.current
        let today = (events + systemEvents)
            .filter { cal.isDateInToday($0.startTime) }
            .sorted { $0.startTime < $1.startTime }
            .prefix(12)
        let payload: [[String: Any]] = today.map { ev in
            var item: [String: Any] = [
                "t": ev.title,
                "s": ev.startTime.timeIntervalSince1970,
                "c": Self.widgetSectionHex[ev.section] ?? "2563EB",
            ]
            if let end = ev.endTime { item["e"] = end.timeIntervalSince1970 }
            return item
        }
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            defaults.set(data, forKey: "widget.events.v1")
        }
        WidgetCenter.shared.reloadAllTimelines()
    }
    @discardableResult
    private func persistTasks() -> Bool { persistSyncSnapshot() }
    private func persistSuggestions()  { FocusLocalStore.save(suggestions, forKey: .suggestions) }
    private func persistNovaMessages() { FocusLocalStore.save(novaMessages, forKey: .novaMessages) }
    @discardableResult
    private func persistSettings() -> Bool { FocusLocalStore.saveSync(settings, forKey: .settings) }

    // MARK: - Estado: usuario ya creó algo?

    var hasUserData: Bool {
        !events.isEmpty || !tasks.isEmpty
    }

    var hasUserEvents: Bool {
        !events.isEmpty
    }

    var hasUserTasks: Bool {
        !tasks.isEmpty
    }

    /// True solo cuando el usuario NO está logueado — sin `syncCredentials`,
    /// la app está en modo demo. Los ejemplos del Calendario/Mi Día/Tareas
    /// SOLO deben aparecer en este modo. Un usuario logueado con 0 ítems
    /// debe ver estado vacío real, NO eventos demo falsos.
    var isInDemoMode: Bool {
        syncCredentials == nil
    }

    // MARK: - Eventos

    func eventsFor(date target: Date) -> [FocusEvent] {
        let cal = Calendar.current
        // Merge de lectura: eventos de Focus + calendario del iPhone
        // (read-only). El array `systemEvents` está vacío si el toggle
        // está off, así que el caso común no paga nada.
        return (events + systemEvents)
            .filter { cal.isDate($0.startTime, inSameDayAs: target) }
            .sorted { $0.startTime < $1.startTime }
    }

    func todayEvents() -> [FocusEvent] {
        eventsFor(date: Date())
    }

    /// Recordatorios puntuales de hoy cuya hora ya pasó y NO fueron
    /// "completados" (eliminar = completar — V1 sin estado done para
    /// eventos). Los usamos para mostrar una sección "Vencidos" en
    /// Mi Día separada del timeline regular.
    func overdueRemindersToday() -> [FocusEvent] {
        let now = Date()
        return todayEvents().filter { event in
            event.isReminder == true && event.startTime < now
        }
    }

    /// Eventos de hoy que NO son recordatorios vencidos — el timeline
    /// "normal" de Mi Día y Calendario.
    func upcomingAndCurrentEventsToday() -> [FocusEvent] {
        let now = Date()
        return todayEvents().filter { event in
            // Recordatorio vencido → fuera del timeline normal.
            if event.isReminder == true, event.startTime < now {
                return false
            }
            return true
        }
    }

    var nextBlock: FocusEvent? {
        let now = Date()
        return upcomingAndCurrentEventsToday().first { event in
            // Para recordatorios usamos solo startTime (no endTime interno
            // de 5min que mentía y los hacía aparecer como "próximo bloque"
            // hasta 5 min después de su hora real).
            if event.isReminder == true {
                return event.startTime >= now
            }
            return (event.endTime ?? event.startTime) >= now
        }
    }

    /// Mutations become visible as successful only after their data and outbox
    /// are atomically on disk. A failed write restores the previous UI state.
    private func commitLocalMutation(_ mutation: () -> Void) -> Bool {
        let previous = FocusSyncSnapshot(events: events, tasks: tasks, outbox: outbox, recoveryEventIDs: recoveryEventIDs, recoveryTaskIDs: recoveryTaskIDs, novaAppliedActionIDs: novaAppliedActionIDs)
        mutation()
        if let currentNovaActionID { novaAppliedActionIDs.insert(currentNovaActionID) }
        guard persistSyncSnapshot() else {
            events = previous.events
            tasks = previous.tasks
            outbox = previous.outbox
            recoveryEventIDs = previous.recoveryEventIDs ?? [:]
            recoveryTaskIDs = previous.recoveryTaskIDs ?? [:]
            novaAppliedActionIDs = previous.novaAppliedActionIDs ?? []
            refreshPendingDeletes()
            HapticManager.shared.warning()
            return false
        }
        syncWidgetSnapshot()
        return true
    }

    @discardableResult
    func addEvent(_ event: FocusEvent) -> Bool {
        guard !events.contains(where: { $0.id == event.id }) else { return false }
        guard commitLocalMutation({
            events.append(event)
            events.sort { $0.startTime < $1.startTime }
            enqueueSync(.event, id: event.id, operation: .upsert)
        }) else { return false }
        FocusTelemetry.recordFirstItem()
        if event.isReminder == true || !(event.reminderOffsets?.isEmpty ?? true) {
            FocusTelemetry.record(.reminderCreated)
        }
        requestSync()
        syncLocalNotification(for: event)
        HapticManager.shared.success()
        if settings.novaMemoryEnabled { NovaMemoryStore.shared.passivelyLearnFromEvent(title: event.title) }
        return true
    }

    @discardableResult
    func deleteEvent(_ id: UUID) -> Bool {
        guard events.contains(where: { $0.id == id && $0.effectiveSource == .local }) else { return false }
        guard commitLocalMutation({
            events.removeAll { $0.id == id }
            enqueueSync(.event, id: id, operation: .delete)
        }) else { return false }
        cleanupStaleSuggestions()
        requestSync()
        LocalNotificationService.shared.cancelReminder(eventId: id)
        resyncAllLocalNotifications()
        return true
    }

    struct EventDeletionReceipt: Identifiable {
        let id = UUID()
        let event: FocusEvent
        let generation: UUID
        let expiresAt: Date
    }

    func deleteEventWithUndo(_ id: UUID) -> EventDeletionReceipt? {
        guard let event = events.first(where: { $0.id == id && $0.effectiveSource == .local }),
              deleteEvent(id) else { return nil }
        return EventDeletionReceipt(event: event, generation: accountGeneration,
                                    expiresAt: Date().addingTimeInterval(10))
    }

    @discardableResult
    func undoEventDeletion(_ receipt: EventDeletionReceipt) -> Bool {
        guard receipt.generation == accountGeneration, Date() <= receipt.expiresAt,
              !events.contains(where: { $0.id == receipt.event.id }) else { return false }
        // Same ID and a newer outbox revision supersede a queued or in-flight
        // delete. Supabase upsert clears its tombstone; replay cannot duplicate it.
        return addEvent(receipt.event)
    }

    @discardableResult
    func updateEvent(_ event: FocusEvent) -> Bool {
        guard let index = events.firstIndex(where: { $0.id == event.id }) else { return false }
        guard commitLocalMutation({
            events[index] = event
            events.sort { $0.startTime < $1.startTime }
            enqueueSync(.event, id: event.id, operation: .upsert)
        }) else { return false }
        requestSync()
        syncLocalNotification(for: event)
        HapticManager.shared.tick()
        return true
    }

    /// Re-sincroniza la notificación local para `event`. Tres ramas:
    /// - (`isReminder == true` ∨ tiene `reminderOffsets`) + `startTime > now`
    ///   + permisos OK + toggle ON → programa (idempotente).
    /// - Cualquier otro caso → cancela la pendiente si existía (cubre el
    ///   flujo "evento dejó de ser recordatorio" o "se movió al pasado").
    ///
    /// Cambio 2026-05-13: ahora también programamos cuando el evento tiene
    /// `reminderOffsets` aunque NO sea `isReminder`. Caso típico: usuario
    /// tiene "Ducharme" 10:00 (evento regular) y le pide a Nova "acuérdame
    /// 10 min antes" → seteamos reminderOffsets=[10]. Antes esto entraba
    /// al guard y se cancelaba la notif.
    ///
    /// Si el toggle está apagado o falta permiso, cancelamos cualquier
    /// pendiente sobrante — así el usuario que apaga el switch deja de ver
    /// alertas inmediatamente.
    private func syncLocalNotification(for event: FocusEvent) {
        resyncAllLocalNotifications()
    }

    /// One global window protects the nearest 64 alerts across all events and
    /// offsets. Reconciliation replaces stale requests and refills freed slots.
    private func resyncAllLocalNotifications() {
        guard schedulesNotifications else {
            notificationPermissionDenied = false
            return
        }
        if !settings.remindersEnabled { notificationPermissionDenied = false }
        let generation = accountGeneration
        let snapshot = settings.remindersEnabled ? events : []
        Task { [weak self] in
            guard let self, self.accountGeneration == generation,
                  (self.settings.remindersEnabled ? self.events : []) == snapshot else { return }
            if LocalNotificationService.plannedWindow(events: snapshot, now: Date()).isEmpty {
                self.notificationPermissionDenied = false
                await LocalNotificationService.shared.synchronizeReminders(for: [])
                return
            }
            let status = await LocalNotificationService.shared.currentStatus()
            guard self.accountGeneration == generation,
                  self.settings.remindersEnabled, self.events == snapshot else { return }
            let resolved = status == .notDetermined
                ? await LocalNotificationService.shared.requestAuthorization() : status
            guard self.accountGeneration == generation,
                  self.settings.remindersEnabled, self.events == snapshot else { return }
            self.notificationPermissionDenied = resolved == .denied
            if resolved == .authorized || resolved == .provisional || resolved == .ephemeral {
                await LocalNotificationService.shared.synchronizeReminders(for: snapshot)
            } else {
                await LocalNotificationService.shared.synchronizeReminders(for: [])
            }
        }
    }

    /// Expande una recurrencia local a una lista de fechas concretas.
    /// Conservador para beta — N fijo por tipo, sin RRULE real:
    ///   - daily / everyNDays: 14 ocurrencias (~2 semanas)
    ///   - weekly / weeklyOn / biweeklyOn / unspecified: 8 ocurrencias
    ///   - weekdays / multiWeekday: 4 semanas de cobertura (~20 fechas)
    ///   - monthly: 3 ocurrencias
    /// Cada `FocusEvent` resultante es independiente — el usuario puede
    /// editar/borrar uno sin que afecte al resto. Trade-off consciente:
    /// editar la "serie" entera requiere editar uno por uno.
    func expandLocalRecurrenceDates(start: Date, recurrence: RecurrenceHint) -> [Date] {
        // Counts ampliados 2026-05-26 — el usuario espera que "todos los
        // lunes" cubra el semestre o más, no solo 2 meses. Estos valores
        // generan datos razonables sin saturar el storage local.
        switch recurrence {
        case .daily:
            // Mes completo de meditación/hábito diario.
            return makeFixedSeries(start: start, component: .day, increment: 1, count: 30)
        case .weekly, .weeklyOn, .unspecified:
            // 6 meses de clases semanales (típico semestre académico).
            return makeFixedSeries(start: start, component: .weekOfYear, increment: 1, count: 26)
        case .biweeklyOn:
            // ~6 meses con cadencia quincenal.
            return makeFixedSeries(start: start, component: .weekOfYear, increment: 2, count: 13)
        case .everyNDays(let n):
            let safeN = max(1, min(n, 30))
            // Cubre 60 días.
            return makeFixedSeries(start: start, component: .day, increment: safeN, count: max(14, 60 / safeN))
        case .weekdays:
            // 60 días naturales, ~44 días hábiles (~2 meses laborales).
            return expandWeekdayPattern(start: start, weekdays: [2, 3, 4, 5, 6], spanDays: 60)
        case .multiWeekday(let weekdays, _):
            // ~3 meses.
            return expandWeekdayPattern(start: start, weekdays: weekdays, spanDays: 90)
        case .monthly:
            // Semestre completo (6 meses).
            return makeFixedSeries(start: start, component: .month, increment: 1, count: 6)
        }
        // Silencia warning de exhaustividad si Swift detecta unreachable
        // (no se da hoy porque todos los casos retornan).
    }

    /// Serie aritmética simple: start, start+inc, start+2*inc, ...
    private func makeFixedSeries(start: Date, component: Calendar.Component, increment: Int, count: Int) -> [Date] {
        let cal = Calendar.current
        var dates: [Date] = [start]
        var cursor = start
        for _ in 1..<count {
            guard let next = cal.date(byAdding: component, value: increment, to: cursor) else { break }
            dates.append(next)
            cursor = next
        }
        return dates
    }

    /// Expande un patrón "días específicos de la semana" sobre N días
    /// calendar. La hora se preserva del `start`. Incluye `start` si
    /// su weekday está en la lista.
    /// Mapeo Calendar.weekday: 1=domingo, 2=lunes, 3=martes, ..., 7=sábado.
    private func expandWeekdayPattern(start: Date, weekdays: [Int], spanDays: Int) -> [Date] {
        let cal = Calendar.current
        let hour = cal.component(.hour, from: start)
        let minute = cal.component(.minute, from: start)
        let startDay = cal.startOfDay(for: start)
        var result: [Date] = []
        for offset in 0..<spanDays {
            guard let day = cal.date(byAdding: .day, value: offset, to: startDay) else { continue }
            let wd = cal.component(.weekday, from: day)
            guard weekdays.contains(wd) else { continue }
            guard let dt = cal.date(bySettingHour: hour, minute: minute, second: 0, of: day) else { continue }
            // Si el primer match cae antes que `start` (mismo día pero hora ya
            // pasada), saltamos para no agendar en el pasado.
            if dt < start && offset == 0 { continue }
            result.append(dt)
        }
        return result.isEmpty ? [start] : result
    }

    /// Llamado por `FocusApp` al arrancar — asegura que recordatorios
    /// futuros tengan sus notificaciones programadas. iOS no garantiza
    /// persistir notificaciones locales tras reinstalar la app, así que
    /// esto cubre el caso. Idempotente: identifiers estables por id.
    func bootstrapLocalNotifications() {
        resyncAllLocalNotifications()
    }

    // MARK: - Tareas

    func tasksIn(_ category: TaskCategory) -> [FocusTask] {
        tasks.filter { $0.category == category }
    }

    var pendingTodayTasks: [FocusTask] {
        tasks.filter { $0.category == .hoy && !$0.done }
    }

    @discardableResult
    func toggleTask(_ id: UUID) -> Bool {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return false }
        guard commitLocalMutation({
            tasks[index].done.toggle()
            tasks[index].doneAt = tasks[index].done ? Date() : nil
            enqueueSync(.task, id: id, operation: .upsert)
        }) else { return false }
        requestSync()
        if tasks[index].done {
            FocusTelemetry.record(.taskCompleted)
            HapticManager.shared.success()
        } else { HapticManager.shared.tick() }
        return true
    }

    @discardableResult
    func toggleSubtask(taskId: UUID, subtaskId: UUID) -> Bool {
        guard let taskIndex = tasks.firstIndex(where: { $0.id == taskId }),
              let subtaskIndex = tasks[taskIndex].subtasks.firstIndex(where: { $0.id == subtaskId }) else { return false }
        guard commitLocalMutation({
            tasks[taskIndex].subtasks[subtaskIndex].isCompleted.toggle()
            enqueueSync(.task, id: taskId, operation: .upsert)
        }) else { return false }
        requestSync()
        HapticManager.shared.tick()
        return true
    }

    @discardableResult
    func addTask(_ task: FocusTask) -> Bool {
        guard FocusConfig.tasksEnabled, !tasks.contains(where: { $0.id == task.id }) else { return false }
        guard commitLocalMutation({
            tasks.insert(task, at: 0)
            enqueueSync(.task, id: task.id, operation: .upsert)
        }) else { return false }
        FocusTelemetry.recordFirstItem()
        requestSync()
        HapticManager.shared.success()
        return true
    }

    @discardableResult
    func deleteTask(_ id: UUID) -> Bool {
        guard tasks.contains(where: { $0.id == id }) else { return false }
        guard commitLocalMutation({
            tasks.removeAll { $0.id == id }
            enqueueSync(.task, id: id, operation: .delete)
        }) else { return false }
        cleanupStaleSuggestions()
        requestSync()
        HapticManager.shared.tick()
        return true
    }

    @discardableResult
    func updateTask(_ task: FocusTask) -> Bool {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return false }
        guard commitLocalMutation({
            tasks[index] = task
            enqueueSync(.task, id: task.id, operation: .upsert)
        }) else { return false }
        requestSync()
        HapticManager.shared.tick()
        return true
    }

    // MARK: - Sugerencias

    /// Sugerencias visibles en la Bandeja:
    /// 1. Filtra del store las que referencian items que ya no existen.
    /// 2. Si quedan, las muestra.
    /// 3. Si NO quedan y el usuario NO tiene datos reales todavía
    ///    (modo demo limpio), cae a las sugerencias de ejemplo dinámicas.
    /// 4. Si NO quedan y el usuario YA creó algo real, vacío total.
    var displaySuggestions: [NovaSuggestion] {
        let valid = suggestions.filter { sug in
            if let id = sug.relatedTaskId, !tasks.contains(where: { $0.id == id }) {
                return false
            }
            if let id = sug.relatedEventId, !events.contains(where: { $0.id == id }) {
                return false
            }
            return true
        }
        if !valid.isEmpty { return valid }
        if hasUserData { return [] }
        // Solo mostrar sugerencias demo en modo demo (no logueado). Una
        // cuenta real sin ítems propios ve vacío real.
        guard isInDemoMode else { return [] }
        return DemoDataProvider.shared.suggestions()
    }

    /// Pendientes que se muestran a la UI (incluye fallback de demo). Es lo
    /// que usan el badge de Nova y el chevron en Mi Día.
    var pendingDisplaySuggestions: [NovaSuggestion] {
        displaySuggestions.filter { $0.status == .pending }
    }

    /// Solo las pendientes REALES del store (sin fallback). Para lógica
    /// interna que no quiere mezclar demo.
    var pendingSuggestions: [NovaSuggestion] {
        suggestions.filter { $0.status == .pending }
    }

    /// Elimina del store cualquier sugerencia que referencia un task/event
    /// que ya no existe. Llamada después de borrar items o resetear demo
    /// para mantener la Bandeja consistente.
    func cleanupStaleSuggestions() {
        let before = suggestions.count
        suggestions.removeAll { sug in
            if let id = sug.relatedTaskId, !tasks.contains(where: { $0.id == id }) {
                return true
            }
            if let id = sug.relatedEventId, !events.contains(where: { $0.id == id }) {
                return true
            }
            return false
        }
        if suggestions.count != before { persistSuggestions() }
    }

    func updateSuggestion(_ id: UUID, status: SuggestionStatus) {
        guard let idx = suggestions.firstIndex(where: { $0.id == id }) else { return }
        suggestions[idx].status = status
        suggestions[idx].resolvedAt = Date()
        persistSuggestions()
        if status == .approved {
            HapticManager.shared.success()
        } else {
            HapticManager.shared.tick()
        }
    }

    /// Agrega una sugerencia nueva a la bandeja (pending). Persiste.
    func addSuggestion(_ suggestion: NovaSuggestion) {
        suggestions.insert(suggestion, at: 0)
        persistSuggestions()
    }

    /// Resultado de aprobar una sugerencia — la UI usa esto para mostrar el
    /// toast correcto ("Evento creado", "Tarea creada", "Sugerencia aprobada").
    enum SuggestionApprovalResult {
        case eventCreated(FocusEvent)
        case taskCreated(FocusTask)
        case acknowledged
    }

    /// Aprueba una sugerencia y, según su tipo, crea la entidad asociada:
    /// - `.schedule` → evento real en la agenda.
    /// - `.task` → tarea en pendientes.
    /// - resto → solo cambia estado a `.approved`.
    /// Retorna el resultado para que la UI muestre feedback adecuado.
    @discardableResult
    func approveSuggestion(_ id: UUID) -> SuggestionApprovalResult {
        guard let idx = suggestions.firstIndex(where: { $0.id == id }) else {
            return .acknowledged
        }
        let sug = suggestions[idx]
        suggestions[idx].status = .approved
        suggestions[idx].resolvedAt = Date()
        persistSuggestions()
        HapticManager.shared.success()

        switch sug.kind {
        case .schedule:
            // Crea un evento en la próxima hora redonda con 1h de duración.
            // Es ad-hoc: cuando Nova real esté conectada, la propuesta vendrá
            // con startTime/endTime sugeridos.
            let cal = Calendar.current
            let now = Date()
            let nextHour = cal.date(
                bySettingHour: cal.component(.hour, from: now) + 1,
                minute: 0,
                second: 0,
                of: now
            ) ?? now
            let endHour = cal.date(byAdding: .hour, value: 1, to: nextHour) ?? nextHour
            let event = FocusEvent(
                title: sug.suggestedAction,
                notes: sug.detail,
                startTime: nextHour,
                endTime: endHour,
                section: .foco
            )
            addEvent(event)
            suggestions[idx].relatedEventId = event.id
            persistSuggestions()
            return .eventCreated(event)

        case .task:
            let task = FocusTask(
                title: sug.suggestedAction,
                notes: sug.detail,
                priority: sug.priority == .high ? .alta : .media,
                category: .hoy
            )
            addTask(task)
            suggestions[idx].relatedTaskId = task.id
            persistSuggestions()
            return .taskCreated(task)

        case .rebalance, .break_, .prep:
            return .acknowledged
        }
    }

    // MARK: - Nova — backend actions

    /// Resultado de aplicar `[BackendAction]` al store. La UI usa esto para
    /// mostrar resúmenes claros ("Evento creado", "Tarea actualizada", etc.)
    /// y para saber a qué pantalla saltar.
    struct NovaApplyOutcome {
        /// True cuando se ejecutó al menos una mutación real (excluye
        /// `remember` que es transparente). Si es false, el caller debe
        /// mostrar solo el `reply` textual del backend.
        var didMutate: Bool = false
        /// Resumen humano de la última mutación, listo para inline response.
        var summary: String? = nil
        /// Detalle multilínea con bullets de TODOS los items creados (cuando
        /// hubo más de uno). Se rinde en `InlineNovaResponse.details`.
        var details: String? = nil
        /// Acciones ignoradas/strippadas — para diagnóstico en logs.
        var ignored: [String] = []
        /// ID del evento creado o editado en esta tanda (si aplica). Para
        /// que el caller pueda saltar a Calendario / abrir detail.
        var primaryEventId: UUID? = nil
        /// ID de la tarea creada o editada en esta tanda (si aplica).
        var primaryTaskId: UUID? = nil
        /// Si la acción primaria fue un recordatorio puntual.
        var primaryIsReminder: Bool = false
        /// Items creados en esta tanda, para componer resumen multi-action
        /// uniforme al final ("Listo. Te dejé 3 bloques para hoy: …").
        var createdEvents: [FocusEvent] = []
        var createdTasks: [FocusTask] = []
    }

    /// Aplica una secuencia de `BackendAction` al store. Cada mutación
    /// pasa por los métodos existentes (`addEvent`, `updateEvent`, ...)
    /// que ya sincronizan con Supabase. Diseñado para correr en main actor
    /// (este store ya es @MainActor).
    ///
    /// Reglas:
    /// - `add_recurring_event` se expande localmente a N `addEvent` (1..count).
    /// - `edit_event` / `delete_event` con id que no matchea ningún evento
    ///   local quedan registrados en `ignored` (no crashea).
    /// - `remember` se ignora en V1 (no hay memory store local todavía).
    /// - `unsupported(typeName)` queda registrado en `ignored`.
    func applyBackendActions(
        _ actions: [BackendAction],
        userText: String,
        actionIDs: [String] = [],
        reviewedTiming: Bool = false
    ) -> NovaApplyOutcome {
        var outcome = NovaApplyOutcome()
        let validation = NovaActionValidator.validate(actions: actions, userText: userText)
        guard !validation.shouldAsk else {
            outcome.ignored = ["invalid_batch"]
            return outcome
        }
        // Validate all references before the first mutation, so a stale proposal
        // cannot leave half an edit/delete batch applied.
        for (index, action) in actions.enumerated() {
            if actionIDs.indices.contains(index), novaAppliedActionIDs.contains(actionIDs[index]) { continue }
            switch action {
            case .editEvent(let raw, _), .deleteEvent(let raw):
                guard let id = parseEventId(raw), var event = events.first(where: { $0.id == id }) else {
                    outcome.ignored = ["event_not_found"]
                    return outcome
                }
                if case .editEvent(_, let updates) = action, !applyUpdates(updates, to: &event) {
                    outcome.ignored = ["invalid_event_update"]
                    return outcome
                }
            case .toggleTask(let raw), .deleteTask(let raw), .completeTask(let raw, _), .editTask(let raw, _):
                guard let id = parseEventId(raw), var task = tasks.first(where: { $0.id == id }) else {
                    outcome.ignored = ["task_not_found"]
                    return outcome
                }
                if case .editTask(_, let updates) = action, !applyTaskUpdates(updates, to: &task) {
                    outcome.ignored = ["invalid_task_update"]
                    return outcome
                }
            default: break
            }
        }

        // Cuántas CREACIONES trae el batch. Con 2+ eventos en un mismo
        // mensaje, el detalle trailing extraído del userText completo
        // pertenece a UN solo segmento — sin este flag se filtraba como
        // subtitle/aviso de TODOS los eventos del lote (mismo bug que el
        // path local ya guarda con isMultiIntent).
        let creationCount = actions.reduce(0) { count, action in
            switch action {
            case .addEvent, .addRecurringEvent: return count + 1
            default: return count
            }
        }
        let isMultiEventBatch = creationCount > 1

        actionLoop: for (index, action) in actions.enumerated() {
            let receipt = actionIDs.indices.contains(index) ? actionIDs[index] : nil
            if let receipt, novaAppliedActionIDs.contains(receipt) {
                outcome.summary = outcome.summary ?? "Esos cambios ya estaban aplicados."
                continue
            }
            // Entity and recurring-series writes commit the receipt in the same
            // atomic snapshot as their complete data and outbox mutations.
            switch action {
            case .addEvent, .addRecurringEvent, .editEvent, .deleteEvent, .addTask, .editTask, .completeTask, .toggleTask, .deleteTask:
                currentNovaActionID = receipt
            default: currentNovaActionID = nil
            }
            defer { currentNovaActionID = nil }
            let ignoredBefore = outcome.ignored.count
            switch action {
            case .addEvent(let payload):
                // Gate: si el usuario NO mencionó hora alguna en su texto
                // ("fútbol hoy", "estudiar mañana", "comprar pan"), no
                // creamos evento horario aunque el backend nos lo pida.
                // El modelo IA suele inventar una hora (típicamente 9 AM
                // o el horario "razonable" del verbo). En el spec del
                // producto, sin hora explícita = tarea/pendiente.
                if payload.timeString == nil || payload.timeString?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
                    if !FocusConfig.tasksEnabled {
                        // SOLO-EVENTOS (fix 2026-08-10): degradar a tarea acá
                        // era mentira — `addTask` es no-op con el flag off y
                        // el summary decía "Tarea agregada" sin que existiera
                        // en ninguna superficie. Dejamos pending para que el
                        // follow-up con hora cree el evento; la respuesta
                        // visible la pone el reply del backend (su prompt
                        // SOLO-EVENTOS ya pide la hora en estos casos).
                        let cleaned = NovaActionNormalizer.cleanTitle(payload.title)
                        if !cleaned.isEmpty {
                            setPendingClarification(PendingClarification(
                                originalInput: userText,
                                kind: .event,
                                proposedTitle: cleaned,
                                proposedDate: NovaTimeFormatter.parseISODate(payload.dateString),
                                proposedSection: NovaResponder.guessSection(for: userText),
                                wantsReminder: false,
                                missingFields: [.time],
                                questionAsked: "¿A qué hora lo agendo?",
                                source: .novaChat
                            ))
                        }
                        outcome.ignored.append("add_event(no_time_tasks_disabled)")
                    } else if let task = makeTaskFromTimelessEventPayload(payload) {
                        if tasks.contains(where: { !$0.done && NovaResponder.normalizeForFuzzy($0.title) == NovaResponder.normalizeForFuzzy(task.title) && $0.dueDate == task.dueDate }) {
                            outcome.summary = "Ya tenías «\(task.title)» en tus pendientes."
                            outcome.ignored.append("add_event(duplicate_task)")
                            continue
                        }
                        guard addTask(task) else {
                            outcome.ignored.append("persistence_failed")
                            break actionLoop
                        }
                        outcome.didMutate = true
                        outcome.summary = "Tarea «\(task.title)» agregada."
                        outcome.primaryTaskId = task.id
                        outcome.createdTasks.append(task)
                        updateNovaContext(
                            from: userText,
                            title: task.title,
                            date: task.dueDate,
                            kind: .task,
                            taskId: task.id
                        )
                    } else {
                        outcome.ignored.append("add_event(no_time_to_task_invalid)")
                    }
                } else if !reviewedTiming, !isMultiEventBatch, let localRecurrence = NovaResponder.detectRecurrence(userText.lowercased()),
                          let backendRecur = makeBackendRecurrence(
                              from: localRecurrence,
                              firstDateString: payload.dateString,
                              firstTimeString: payload.timeString
                          ) {
                    // Backend devolvió `addEvent` simple para una frase con
                    // recurrencia explícita ("todos los lunes a las 10").
                    // El modelo IA no siempre invoca `addRecurringEvent`;
                    // expandimos local detectando recurrence en userText.
                    // Cubre caso del usuario 2026-05-26: "todos los lunes
                    // tengo clases" creaba solo 1 evento. Ahora N (12 weekly).
                    guard let created = expandRecurringEvent(
                        payload: payload,
                        recurrence: backendRecur,
                        userText: userText,
                        isMultiEventBatch: isMultiEventBatch,
                        reviewedTiming: reviewedTiming
                    ) else {
                        outcome.ignored.append(localSaveError == nil ? "invalid_recurrence" : "persistence_failed")
                        break actionLoop
                    }
                    if !created.isEmpty {
                        outcome.didMutate = true
                        outcome.summary = "Listo. Te dejé «\(payload.title)» todos \(localRecurrence.label) (\(created.count) próximas)."
                        outcome.primaryEventId = created.first?.id
                        outcome.primaryIsReminder = created.first?.isReminder == true
                        outcome.createdEvents.append(contentsOf: created)
                        if let firstEvent = created.first {
                            updateNovaContext(
                                from: userText,
                                title: firstEvent.title,
                                date: firstEvent.startTime,
                                location: firstEvent.location,
                                section: firstEvent.section,
                                kind: .event,
                                eventId: firstEvent.id
                            )
                        }
                    } else {
                        outcome.summary = "Ya tenías esas ocurrencias en tu agenda."
                    }
                } else if let event = makeEvent(from: payload, userText: userText, isMultiEventBatch: isMultiEventBatch, reviewedTiming: reviewedTiming) {
                    // Anti-duplicado en el path del backend. El local path
                    // ya tenía esta defensa; ahora la centralizamos también
                    // acá para casos donde el backend genere la acción
                    // (retry, doble tap, sesión recuperada).
                    if NovaActionNormalizer.isLikelyDuplicate(
                        title: event.title,
                        startTime: event.startTime,
                        existingEvents: events
                    ) {
                        outcome.summary = "Ya tenías «\(event.title)» a esa hora — no lo dupliqué."
                        outcome.ignored.append("add_event(duplicate)")
                    } else {
                        guard addEvent(event) else {
                            outcome.ignored.append("persistence_failed")
                            break actionLoop
                        }
                        outcome.didMutate = true
                        outcome.summary = summaryForCreatedEvent(event)
                        outcome.primaryEventId = event.id
                        outcome.primaryIsReminder = event.isReminder == true
                        outcome.createdEvents.append(event)
                        updateNovaContext(
                            from: userText,
                            title: event.title,
                            date: event.startTime,
                            location: event.location,
                            section: event.section,
                            kind: .event,
                            eventId: event.id
                        )
                    }
                } else {
                    outcome.ignored.append("add_event(invalid)")
                }

            case .addRecurringEvent(let payload, let recurrence):
                guard let created = expandRecurringEvent(payload: payload, recurrence: recurrence, userText: userText, isMultiEventBatch: isMultiEventBatch, reviewedTiming: reviewedTiming) else {
                    outcome.ignored.append(localSaveError == nil ? "invalid_recurrence" : "persistence_failed")
                    break actionLoop
                }
                if !created.isEmpty {
                    outcome.didMutate = true
                    outcome.summary = "Agendé \(created.count) instancia\(created.count == 1 ? "" : "s") de «\(payload.title)»."
                    outcome.primaryEventId = created.first?.id
                    outcome.createdEvents.append(contentsOf: created)
                    updateNovaContext(
                        from: userText,
                        title: payload.title,
                        date: created.first?.startTime,
                        section: created.first?.section,
                        kind: .event,
                        eventId: created.first?.id
                    )
                } else {
                    outcome.summary = "Ya tenías esas ocurrencias en tu agenda."
                }

            case .editEvent(let idString, let updates):
                guard let id = parseEventId(idString),
                      var event = events.first(where: { $0.id == id }) else {
                    outcome.ignored.append("edit_event(id_not_found)")
                    continue
                }
                guard applyUpdates(updates, to: &event) else {
                    outcome.ignored.append("edit_event(invalid_time)")
                    break actionLoop
                }
                guard updateEvent(event) else {
                    outcome.ignored.append("persistence_failed")
                    break actionLoop
                }
                outcome.didMutate = true
                outcome.summary = "Actualicé «\(event.title)»."
                outcome.primaryEventId = event.id
                updateNovaContext(
                    from: userText,
                    title: event.title,
                    date: event.startTime,
                    location: event.location,
                    section: event.section,
                    kind: .event,
                    eventId: event.id
                )

            case .deleteEvent(let idString):
                guard let id = parseEventId(idString),
                      let event = events.first(where: { $0.id == id }) else {
                    outcome.ignored.append("delete_event(id_not_found)")
                    continue
                }
                let title = event.title
                guard deleteEvent(id) else {
                    outcome.ignored.append("persistence_failed")
                    break actionLoop
                }
                outcome.didMutate = true
                outcome.summary = "Eliminé «\(title)»."
                clearNovaContext()

            case .addTask(let payload):
                // SOLO-EVENTOS (fix 2026-08-10): el backend no debería emitir
                // add_task con el prompt actual, pero si llega, no fingimos
                // haberla guardado (`addTask` es no-op con el flag off).
                guard FocusConfig.tasksEnabled else {
                    outcome.ignored.append("add_task(tasks_disabled)")
                    continue
                }
                if let task = makeTask(from: payload) {
                    if tasks.contains(where: { !$0.done && NovaResponder.normalizeForFuzzy($0.title) == NovaResponder.normalizeForFuzzy(task.title) && $0.dueDate == task.dueDate }) {
                        outcome.summary = "Ya tenías «\(task.title)» en tus pendientes."
                        outcome.ignored.append("add_task(duplicate)")
                        continue
                    }
                    guard addTask(task) else {
                        outcome.ignored.append("persistence_failed")
                        break actionLoop
                    }
                    outcome.didMutate = true
                    outcome.summary = "Tarea «\(task.title)» agregada."
                    outcome.primaryTaskId = task.id
                    outcome.createdTasks.append(task)
                    updateNovaContext(
                        from: userText,
                        title: task.title,
                        date: task.dueDate,
                        kind: .task,
                        taskId: task.id
                    )
                } else {
                    outcome.ignored.append("add_task(invalid)")
                }

            case .completeTask(let idString, let done):
                guard let id = parseEventId(idString), var task = tasks.first(where: { $0.id == id }) else { continue }
                task.done = done
                task.doneAt = done ? (task.doneAt ?? Date()) : nil
                guard updateTask(task) else { outcome.ignored.append("persistence_failed"); break actionLoop }
                outcome.didMutate = true
                outcome.summary = done ? "Completé «\(task.title)»." : "«\(task.title)» vuelve a estar pendiente."
                outcome.primaryTaskId = id

            case .editTask(let idString, let updates):
                guard let id = parseEventId(idString), var task = tasks.first(where: { $0.id == id }), applyTaskUpdates(updates, to: &task) else { continue }
                guard updateTask(task) else { outcome.ignored.append("persistence_failed"); break actionLoop }
                outcome.didMutate = true
                outcome.summary = "Actualicé «\(task.title)»."
                outcome.primaryTaskId = id

            case .toggleTask(let idString):
                guard let id = parseEventId(idString),
                      tasks.contains(where: { $0.id == id }) else {
                    outcome.ignored.append("toggle_task(id_not_found)")
                    continue
                }
                guard toggleTask(id) else {
                    outcome.ignored.append("persistence_failed")
                    break actionLoop
                }
                outcome.didMutate = true
                outcome.summary = "Tarea actualizada."
                outcome.primaryTaskId = id

            case .deleteTask(let idString):
                guard let id = parseEventId(idString),
                      let task = tasks.first(where: { $0.id == id }) else {
                    outcome.ignored.append("delete_task(id_not_found)")
                    continue
                }
                let title = task.title
                guard deleteTask(id) else {
                    outcome.ignored.append("persistence_failed")
                    break actionLoop
                }
                outcome.didMutate = true
                outcome.summary = "Tarea «\(title)» eliminada."
                clearNovaContext()

            case .remember:
                // V1: memoria no se persiste local todavía. Se ignora
                // silenciosamente (es transparente para el usuario).
                outcome.ignored.append("remember(skipped_v1)")

            case .saveMemory(let key, let value, let categoryStr):
                guard settings.novaMemoryEnabled else {
                    outcome.ignored.append("save_memory(disabled)")
                    continue
                }
                // V2 (2026-05-27): el LLM (OpenAI w/ reasoning) detectó
                // memoria personal. Persistimos en NovaMemoryStore.
                let category = NovaMemoryCategory(rawValue: categoryStr) ?? .preference
                let saved = NovaMemoryStore.shared.upsert(NovaMemory(
                    category: category,
                    key: key,
                    value: value,
                    confidence: 0.95,
                    source: "llm_openai"
                ))
                guard NovaMemoryStore.shared.lastPersistenceSucceeded else {
                    outcome.ignored.append("memory_persistence_failed")
                    break actionLoop
                }
                outcome.didMutate = true
                // Si el backend ya armó un userConfirmationText (reply),
                // ese gana — usamos solo summary genérico como fallback.
                if (outcome.summary ?? "").isEmpty {
                    outcome.summary = "Listo, guardé eso."
                }
                HapticManager.shared.success()
                _ = saved

            case .forgetMemory(let key):
                // V2: el user pidió olvidar algo. "__all__" = clear total.
                if key == "__all__" {
                    NovaMemoryStore.shared.clearAll()
                    guard NovaMemoryStore.shared.lastPersistenceSucceeded else {
                        outcome.ignored.append("memory_persistence_failed")
                        break actionLoop
                    }
                    outcome.didMutate = true
                    if (outcome.summary ?? "").isEmpty {
                        outcome.summary = "Listo, borré todas las memorias."
                    }
                } else {
                    let matches = NovaMemoryStore.shared.allActiveMemoriesHuman(maxEntries: 100)
                        .filter { $0.text.lowercased().contains(key.lowercased()) }
                    for m in matches {
                        NovaMemoryStore.shared.deactivate(id: m.id)
                        if !NovaMemoryStore.shared.lastPersistenceSucceeded {
                            outcome.ignored.append("memory_persistence_failed")
                            break actionLoop
                        }
                    }
                    outcome.didMutate = outcome.didMutate || !matches.isEmpty
                    if (outcome.summary ?? "").isEmpty {
                        outcome.summary = matches.isEmpty
                            ? "No tenía nada sobre «\(key)»."
                            : "Listo, olvidé eso."
                    }
                }

            case .unsupported(let typeName):
                outcome.ignored.append("unsupported(\(typeName))")
            }
            if let receipt, outcome.ignored.count == ignoredBefore, !novaAppliedActionIDs.contains(receipt) {
                novaAppliedActionIDs.insert(receipt)
                if !persistSyncSnapshot() {
                    novaAppliedActionIDs.remove(receipt)
                    outcome.ignored.append("receipt_persistence_failed")
                    break actionLoop
                }
            }
        }

        // Si el backend devolvió MÚLTIPLES creaciones, sobreescribir el
        // summary/details con una composición humana uniforme. Antes el
        // summary quedaba con la ÚLTIMA acción solamente — confuso cuando
        // se crearon 2 o 3 ítems.
        let totalCreated = outcome.createdEvents.count + outcome.createdTasks.count
        if totalCreated >= 2 {
            let (sum, det) = composeMultiOutcome(outcome.createdEvents, outcome.createdTasks)
            outcome.summary = sum
            outcome.details = det
        }

        return outcome
    }

    /// Compone summary humano + bullets para multi-action del backend.
    /// Mismo formato que `composeMultiIntentMessage` del local path —
    /// modelo unificado "bloque" + chip de offset cuando aplique.
    private func composeMultiOutcome(
        _ events: [FocusEvent],
        _ tasks: [FocusTask]
    ) -> (String, String?) {
        let cal = Calendar.current
        let dates = events.map { $0.startTime } + tasks.compactMap { $0.dueDate }
        let sameDay: Bool = {
            guard let first = dates.first else { return false }
            return dates.allSatisfy { cal.isDate($0, inSameDayAs: first) }
        }()
        let dayLabel: String? = {
            guard sameDay, let d = dates.first else { return nil }
            if cal.isDateInToday(d) { return "hoy" }
            if cal.isDateInTomorrow(d) { return "mañana" }
            return DateFormatters.weekdayDay.string(from: d).lowercased()
        }()
        let dayBit = dayLabel.map { " para \($0)" } ?? ""

        let blocksCount = events.count
        let tasksCount = tasks.count
        let header: String
        switch (blocksCount, tasksCount) {
        case (let b, 0) where b >= 2:
            header = "Listo. Te dejé \(b) bloques\(dayBit)."
        case (0, let t) where t >= 2:
            header = "Listo. Anoté \(t) tareas\(dayBit)."
        default:
            var parts: [String] = []
            if blocksCount > 0 { parts.append("\(blocksCount) bloque\(blocksCount == 1 ? "" : "s")") }
            if tasksCount > 0  { parts.append("\(tasksCount) tarea\(tasksCount == 1 ? "" : "s")") }
            header = "Listo. Te dejé \(parts.joined(separator: " y "))\(dayBit)."
        }

        var bullets: [String] = []
        let sortedEvents = events.sorted { $0.startTime < $1.startTime }
        for ev in sortedEvents {
            let time = DateFormatters.hourMinute.string(from: ev.startTime)
            var line: String
            if sameDay {
                line = "• \(ev.title) — \(time)"
            } else {
                let day = cal.isDateInToday(ev.startTime) ? "hoy"
                    : cal.isDateInTomorrow(ev.startTime) ? "mañana"
                    : DateFormatters.weekdayDay.string(from: ev.startTime).lowercased()
                line = "• \(ev.title) — \(day) \(time)"
            }
            if let mins = ev.reminderOffsets?.first {
                let offsetLabel = mins < 60
                    ? "\(mins) min antes"
                    : (mins % 60 == 0 ? "\(mins/60) h antes" : "\(mins/60) h \(mins%60) min antes")
                line += "  🔔 \(offsetLabel)"
            }
            bullets.append(line)
        }
        for t in tasks {
            bullets.append("• \(t.title)")
        }
        let details = bullets.isEmpty ? nil : bullets.joined(separator: "\n")
        return (header, details)
    }

    /// Crea un `FocusEvent` desde el payload del backend. Resuelve fecha/hora,
    /// section, isReminder, inferredDuration. Devuelve nil si no se puede
    /// armar una hora válida.
    private func makeEvent(
        from payload: BackendEventCreate,
        userText: String,
        isMultiEventBatch: Bool = false,
        reviewedTiming: Bool = false
    ) -> FocusEvent? {
        // The validated remote plan already contains semantic presentation.
        // Never re-extract words/details from the utterance after that boundary.
        let rawTitle = payload.title
        let presentation = NovaActionNormalizer.semanticPresentation(title: rawTitle, subtitle: payload.subtitle)
        let cleanedTitle = presentation.title
        NovaRouteTrace.normalized(beforeTitle: rawTitle, afterTitle: cleanedTitle,
            beforeSubtitle: payload.subtitle, afterSubtitle: presentation.subtitle)
        guard !cleanedTitle.isEmpty else { return nil }

        let cal = Calendar.current
        guard let startTime = NovaTimeFormatter.resolveDate(
            dateString: payload.dateString,
            timeString: payload.timeString
        ) else { return nil }

        // Detalle trailing del userText ("fútbol a las 5 acuérdame de llevar
        // la pelota" → "Llevar la pelota"). Se computa UNA vez y se reusa en
        // PASO 2 (supresión de recordatorio) y en la resolución de subtítulo.
        let trailingDetail = NovaActionNormalizer
            .extractEventDetail(from: userText).detail

        // PASO 2: Decidir isReminder via normalizer. Señales POR-PAYLOAD
        // (prefijo "Recordatorio:" del título, icon=alarm del backend) o el
        // trigger al INICIO ("recuérdame …") fuerzan recordatorio. Pero un
        // trigger mid-sentence ("gym a las 7 … acuérdame de llevar las
        // zapatillas al gym") pertenece a UN segmento: si fue consumido como
        // subtítulo (trailingDetail != nil) o el mensaje crea varios eventos
        // (isMultiEventBatch), NO marcamos el evento como recordatorio — antes
        // se "untaba" a TODOS los eventos del lote (mismo guard que el path
        // local en applyLocalNovaIntent; review 2026-06-11).
        let backendIcon = payload.icon ?? ""
        let isReminderHint: Bool = {
            if rawTitle.lowercased().hasPrefix("recordatorio")
                || backendIcon.lowercased() == "alarm" {
                return true
            }
            if NovaActionNormalizer.startsWithReminderTrigger(in: userText) {
                return true
            }
            if isMultiEventBatch || trailingDetail != nil {
                return false
            }
            return NovaActionNormalizer.isReminderTrigger(in: userText)
                || NovaActionNormalizer.impliesPunctualReminder(in: userText)
        }()

        // PASO 3: Preserve a time range the user reviewed and confirmed.
        // Automatic captures still require explicit duration in the message.
        // Bug histórico: el modelo IA inventaba `endTimeString` =
        // `startTime + 1h` aunque el usuario solo dijera "dentista a las 4",
        // y la app respetaba ese rango como real, mostrando "16:00–17:00".
        // El gate `userMentionedExplicitEndTime` (parser local) bloquea esa
        // alucinación: si el texto no contiene "de X a Y", "hasta las X",
        // "por N horas" o "durante N min", se ignora el endTime del backend
        // y el evento queda como punto en el tiempo (`inferredDuration=true`).
        var explicitEnd: Date? = nil
        if reviewedTiming || NovaActionNormalizer.userMentionedExplicitEndTime(in: userText),
           let endStr = payload.endTimeString,
           !endStr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let end = NovaTimeFormatter.resolveDate(
                dateString: payload.dateString,
                timeString: endStr
           ),
           end > startTime {
            explicitEnd = end
        }

        // The validated plan owns its civil date. Never move an explicit
        // backend date to another day or change AM to PM during persistence.

        // PASO 4: Sección. Si isReminder → .reminder. Si no, primero icon
        // del backend, luego heurística sobre el TÍTULO LIMPIO.
        let section: EventSection
        if isReminderHint {
            section = .reminder
        } else if let iconBased = sectionFromIcon(backendIcon) {
            section = iconBased
        } else {
            // Default a .personal (no .reunion). guessSection puede devolver
            // nil cuando el título no tiene triggers fuertes; en ese caso
            // tratamos el evento como "personal" — es el catch-all menos
            // dañino. La categoría "reunion" antes era el default y eso
            // hacía que "comer a las 4" terminara como reunión en el
            // calendario, lo que confundía al usuario.
            section = NovaResponder.guessSection(for: cleanedTitle) ?? .personal
        }

        // PASO 5: endTime via normalizer. Centralizado para que el visible
        // endTime sea consistente con el local path.
        let endResolution = NovaActionNormalizer.resolveEndTime(
            startTime: startTime,
            providedEndTime: explicitEnd,
            hasExplicitEndTime: explicitEnd != nil,
            isReminder: isReminderHint
        )
        // Para storage interno: si endTime es nil, ponemos start+5min
        // como padding para que el evento ordene bien en el calendario.
        // La UI usa `inferredDuration`/`isReminder` para decidir si
        // mostrar rango o punto.
        let endTime: Date
        let isReminderFlag: Bool?
        let inferredFlag: Bool?
        if let resolved = endResolution.endTime {
            endTime = resolved
            isReminderFlag = nil
            inferredFlag = false
        } else if isReminderHint {
            endTime = cal.date(byAdding: .minute, value: 5, to: startTime) ?? startTime
            isReminderFlag = true
            inferredFlag = nil
        } else {
            endTime = cal.date(byAdding: .minute, value: 5, to: startTime) ?? startTime
            isReminderFlag = nil
            inferredFlag = endResolution.inferredDuration
        }

        // PASO 6: Offsets de aviso + notas custom. Prioridad:
        //   1. Si el backend devolvió `reminderOffsets`/`reminderNotes`,
        //      usamos esos (single source of truth cuando hay IA).
        //   2. Si no, intentamos extraer del userText con el normalizer.
        //      Caso del user spec: "tengo partido tipo 3 acuérdame 20 min
        //      antes de echar las zapatillas a la mochila" extrae offset=20
        //      Y note="Echar las zapatillas a la mochila".
        //   3. Si tampoco, queda nil → notif al startTime.
        let resolvedOffsets: [Int]?
        let resolvedNotes: [String]?
        if let fromBackend = payload.reminderOffsets, !fromBackend.isEmpty {
            resolvedOffsets = fromBackend
            resolvedNotes = payload.reminderNotes
        } else if !isMultiEventBatch,
                  let extracted = NovaActionNormalizer.extractReminderOffsetAndNote(from: userText) {
            resolvedOffsets = [extracted.offsetMinutes]
            if let note = extracted.note, !note.isEmpty {
                resolvedNotes = [note]
            } else {
                resolvedNotes = nil
            }
        } else {
            resolvedOffsets = nil
            resolvedNotes = nil
        }

        let finalTitle = cleanedTitle
        let finalSubtitle = presentation.subtitle

        return FocusEvent(
            title: finalTitle,
            notes: payload.notes,
            startTime: startTime,
            endTime: endTime,
            section: section,
            location: payload.location,
            isReminder: isReminderFlag,
            inferredDuration: inferredFlag,
            reminderOffsets: resolvedOffsets,
            reminderNotes: resolvedNotes,
            subtitle: finalSubtitle
        )
    }

    /// Convierte un `BackendEventCreate` en `FocusTask` cuando el usuario
    /// NO dio hora explícita. Caso "fútbol hoy", "estudiar lenguaje mañana":
    /// el backend pide crear evento horario inventando una hora, pero el
    /// producto prefiere clasificarlo como pendiente del día.
    ///
    /// Mapea:
    ///   - `title` → limpiado vía normalizer
    ///   - `dateString` → `dueDate` (solo fecha, sin hora; `dueTime = nil`)
    ///   - sin fecha → `dueDate = nil`, `category = .algunDia`
    ///   - hoy → `category = .hoy`; mañana o más → `.semana` (default)
    ///   - prioridad → `.media`
    private func makeTaskFromTimelessEventPayload(_ payload: BackendEventCreate) -> FocusTask? {
        let rawTitle = payload.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedTitle = NovaActionNormalizer.cleanTitle(rawTitle)
        guard !cleanedTitle.isEmpty else { return nil }

        let cal = Calendar.current
        let dueDate: Date? = {
            guard let dateStr = payload.dateString,
                  let parsed = NovaTimeFormatter.parseISODate(dateStr) else { return nil }
            // Forzar al inicio del día — no queremos arrastrar timestamp.
            return cal.startOfDay(for: parsed)
        }()
        let category: TaskCategory = {
            guard let due = dueDate else { return .algunDia }
            if cal.isDateInToday(due) { return .hoy }
            return .semana
        }()
        return FocusTask(
            title: cleanedTitle,
            priority: .media,
            category: category,
            dueDate: dueDate,
            dueTime: nil
        )
    }

    /// Crea un `FocusTask` desde el payload del backend.
    private func makeTask(from payload: BackendTaskCreate) -> FocusTask? {
        // Limpiar el label via normalizer — backend puede devolver
        // "tengo que estudiar cálculo" sin strip de "tengo que".
        let rawLabel = payload.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedTitle = NovaActionNormalizer.cleanTitle(rawLabel)
        guard !cleanedTitle.isEmpty else { return nil }
        let priority = TaskPriority.fromBackendLabel(payload.priority)
        let dueDate = payload.dateString.flatMap { NovaTimeFormatter.parseISODate($0) }.map { Calendar.current.startOfDay(for: $0) }
        let category: TaskCategory = dueDate.map { Calendar.current.isDateInToday($0) ? .hoy : .semana }
            ?? TaskCategory.fromBackendLabel(payload.category)
        let linkedEventId = payload.linkedEventId.flatMap(parseEventId(_:))
        let parentTaskId = payload.parentTaskId.flatMap(parseEventId(_:))
        return FocusTask(
            title: cleanedTitle,
            priority: priority,
            category: category,
            dueDate: dueDate,
            dueTime: nil,
            linkedEventId: linkedEventId,
            parentTaskId: parentTaskId
        )
    }

    /// Aplica updates parciales a un evento. Solo toca los campos
    /// presentes en `BackendEventUpdates`.
    private func applyTaskUpdates(_ updates: BackendTaskUpdates, to task: inout FocusTask) -> Bool {
        guard updates.label != nil || updates.date != nil || updates.time != nil || updates.priority != nil
            || updates.done != nil || updates.clearsDate || updates.clearsTime else { return false }
        if let label = updates.label {
            let title = label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty, title.count <= 160 else { return false }
            task.title = title
        }
        if updates.clearsDate { task.dueDate = nil; task.dueTime = nil }
        if let date = updates.date {
            guard let parsed = NovaTimeFormatter.parseISODate(date) else { return false }
            task.dueDate = parsed
        }
        if updates.clearsTime { task.dueTime = nil }
        if let time = updates.time {
            guard let day = task.dueDate,
                  let parsed = NovaTimeFormatter.resolveDate(dateString: NovaTimeFormatter.formatISODate(from: day), timeString: time) else { return false }
            task.dueTime = parsed
        } else if updates.date != nil, let oldTime = task.dueTime, let day = task.dueDate {
            guard let moved = NovaTimeFormatter.resolveDate(dateString: NovaTimeFormatter.formatISODate(from: day), timeString: NovaTimeFormatter.formatHourMinute(from: oldTime)) else { return false }
            task.dueTime = moved
        }
        if let priority = updates.priority {
            guard ["alta", "media", "baja", "high", "medium", "low"].contains(priority.lowercased()) else { return false }
            task.priority = .fromBackendLabel(priority)
        }
        if let done = updates.done { task.done = done; task.doneAt = done ? (task.doneAt ?? Date()) : nil }
        return true
    }

    private func applyUpdates(_ updates: BackendEventUpdates, to event: inout FocusEvent) -> Bool {
        guard updates.title != nil || updates.dateString != nil || updates.timeString != nil
            || updates.endTimeString != nil || updates.location != nil || updates.reminderOffsets != nil
            || updates.subtitle != nil else { return false }
        if let title = updates.title, title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        if let newTitle = updates.title?.trimmingCharacters(in: .whitespacesAndNewlines),
           !newTitle.isEmpty {
            event.title = newTitle
        }
        let cal = NovaTimeFormatter.calendar()
        if updates.dateString != nil || updates.timeString != nil || updates.endTimeString != nil {
            let date = updates.dateString ?? NovaTimeFormatter.formatISODate(from: event.startTime)
            let time = updates.timeString ?? NovaTimeFormatter.formatHourMinute(from: event.startTime)
            guard let newStart = NovaTimeFormatter.resolveDate(dateString: date, timeString: time) else { return false }
            let oldStart = event.startTime
            if let end = updates.endTimeString {
                guard let newEnd = NovaTimeFormatter.resolveDate(dateString: date, timeString: end), newEnd > newStart else { return false }
                event.endTime = newEnd
                event.inferredDuration = false
            } else if let oldEnd = event.endTime, event.inferredDuration != true {
                let duration = oldEnd.timeIntervalSince(oldStart)
                guard duration > 0 else { return false }
                event.endTime = newStart.addingTimeInterval(duration)
            } else {
                event.endTime = cal.date(byAdding: .minute, value: 5, to: newStart)
            }
            event.startTime = newStart
        }
        if let loc = updates.location?.trimmingCharacters(in: .whitespacesAndNewlines) {
            event.location = loc.isEmpty ? nil : loc
        }
        if let newOffsets = updates.reminderOffsets {
            event.reminderOffsets = newOffsets
            // Si el update trae notes paralelas, las preservamos. Si no, dejamos
            // las viejas (puede que el backend solo actualice offsets sin tocar
            // las notas existentes).
            if let newNotes = updates.reminderNotes {
                event.reminderNotes = newNotes
            }
        }
        // Subtitle editable: nil = no tocar; "" explícito = quitar el actual
        // ("quítale el subtítulo al gym").
        if let newSubtitle = updates.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines) {
            event.subtitle = newSubtitle.isEmpty ? nil : newSubtitle
        }
        return true
    }

    /// Expande un `add_recurring_event` a N `addEvent` locales. Conservador:
    /// máximo 31 instancias por acción (límite del backend).
    /// Convierte un `RecurrenceHint` detectado localmente desde el texto
    /// del usuario a un `BackendRecurrence` compatible con
    /// `expandRecurringEvent`. Necesario cuando el backend devolvió un
    /// `addEvent` simple para una frase que claramente tiene recurrencia
    /// ("todos los lunes", "todos los días", "de lunes a viernes"). Sin
    /// esto, la app creaba un solo evento.
    ///
    /// Limitaciones: hints que no mapean a {daily, weekdays, weekly} se
    /// devuelven como `nil` (biweekly, monthly, multiWeekday, everyNDays).
    /// El backend NO soporta esos patterns todavía en `expandRecurringEvent`;
    /// el local path los maneja, pero no este fallback. Para esos, el
    /// usuario verá un solo evento — aceptable hasta que el backend los
    /// agregue.
    private func makeBackendRecurrence(
        from hint: RecurrenceHint,
        firstDateString: String?,
        firstTimeString: String?
    ) -> BackendRecurrence? {
        let cal = Calendar.current
        // Calcular weekday Swift (1=dom..7=sáb) a partir del primer date.
        let weekdaySwift: Int? = {
            guard let dateStr = firstDateString,
                  let date = NovaTimeFormatter.resolveDate(
                      dateString: dateStr,
                      timeString: firstTimeString
                  )
            else { return nil }
            return cal.component(.weekday, from: date)
        }()
        // backend weekday: 0=dom, ..., 6=sáb. Swift weekday: 1=dom..7=sáb.
        // → backend = (swift - 1) en rango 0..6.
        let weekdayBackend: Int? = weekdaySwift.map { ($0 - 1) % 7 }

        switch hint {
        case .daily, .unspecified:
            return BackendRecurrence(
                pattern: "daily", weekday: nil,
                count: 14, startDate: firstDateString
            )
        case .weekdays:
            return BackendRecurrence(
                pattern: "weekdays", weekday: nil,
                count: 22, startDate: firstDateString
            )
        case .weekly:
            return BackendRecurrence(
                pattern: "weekly", weekday: weekdayBackend,
                count: 12, startDate: firstDateString
            )
        case .weeklyOn:
            return BackendRecurrence(
                pattern: "weekly", weekday: weekdayBackend,
                count: 12, startDate: firstDateString
            )
        case .biweeklyOn, .everyNDays, .multiWeekday, .monthly:
            // Patterns no soportados por el backend expander; el local
            // path (createEvent intent path) sí los maneja.
            return nil
        }
    }

    /// Prepare every occurrence before a single durable commit. No partial
    /// series or completed receipt can survive a rejected date or disk write.
    private func expandRecurringEvent(
        payload: BackendEventCreate,
        recurrence: BackendRecurrence,
        userText: String,
        isMultiEventBatch: Bool = false,
        reviewedTiming: Bool = false
    ) -> [FocusEvent]? {
        let cal = NovaTimeFormatter.calendar()
        guard let firstStart = NovaTimeFormatter.resolveDate(
            dateString: recurrence.startDate ?? payload.dateString,
            timeString: payload.timeString
        ) else { return nil }
        let pattern = recurrence.pattern.lowercased()
        let limit: Int
        let stride: Int
        switch pattern {
        case "daily": limit = min(recurrence.count ?? 30, 60); stride = 1
        case "weekdays": limit = min(recurrence.count ?? 44, 60); stride = 1
        case "weekly": limit = min(recurrence.count ?? 26, 52); stride = 7
        default: return nil
        }
        guard limit > 0 else { return nil }
        var current = firstStart
        if pattern == "weekly", let target = recurrence.weekday {
            guard (0...6).contains(target) else { return nil }
            let offset = (target + 1 - cal.component(.weekday, from: current) + 7) % 7
            guard let aligned = cal.date(byAdding: .day, value: offset, to: current) else { return nil }
            current = aligned
        }
        var planned: [FocusEvent] = []
        var safety = 0
        while planned.count < limit && safety < 200 {
            safety += 1
            let weekday = cal.component(.weekday, from: current)
            if pattern != "weekdays" || (weekday != 1 && weekday != 7) {
                let single = BackendEventCreate(title: payload.title, timeString: payload.timeString,
                    endTimeString: payload.endTimeString, dateString: NovaTimeFormatter.formatISODate(from: current),
                    section: payload.section, icon: payload.icon, reminderOffsets: payload.reminderOffsets,
                    reminderNotes: payload.reminderNotes, location: payload.location, notes: payload.notes, subtitle: payload.subtitle)
                guard let event = makeEvent(from: single, userText: userText,
                    isMultiEventBatch: isMultiEventBatch, reviewedTiming: reviewedTiming) else { return nil }
                planned.append(event)
            }
            if planned.count < limit {
                guard let next = cal.date(byAdding: .day, value: stride, to: current) else { return nil }
                current = next
            }
        }
        guard planned.count == limit else { return nil }
        return commitPreparedNovaEvents(planned)
    }

    /// The same transaction is used for local and remote recurring creations.
    private func commitPreparedNovaEvents(_ planned: [FocusEvent]) -> [FocusEvent]? {
        var newEvents: [FocusEvent] = []
        for event in planned {
            if !NovaActionNormalizer.isLikelyDuplicate(title: event.title, startTime: event.startTime,
                                                       existingEvents: events + newEvents) {
                newEvents.append(event)
            }
        }
        guard commitLocalMutation({
            events.append(contentsOf: newEvents)
            events.sort { $0.startTime < $1.startTime }
            for event in newEvents { enqueueSync(.event, id: event.id, operation: .upsert) }
        }) else { return nil }
        if !newEvents.isEmpty {
            FocusTelemetry.recordFirstItem()
            if newEvents.contains(where: { $0.isReminder == true || !($0.reminderOffsets?.isEmpty ?? true) }) {
                FocusTelemetry.record(.reminderCreated)
            }
            requestSync()
            resyncAllLocalNotifications()
            HapticManager.shared.success()
            if settings.novaMemoryEnabled {
                for title in Set(newEvents.map(\.title)) { NovaMemoryStore.shared.passivelyLearnFromEvent(title: title) }
            }
        }
        return newEvents
    }

    /// Mapeo conservador del `icon` del backend a `EventSection`.
    private func sectionFromIcon(_ icon: String) -> EventSection? {
        let key = icon.lowercased()
        // Familia deporte/entrenamiento (directions_run, sports_*, pool…) →
        // .entrenamiento. Bug 2026-06-13: solo "fitness_center" matcheaba.
        if key.hasPrefix("sports_") { return .entrenamiento }
        switch key {
        case "fitness_center", "directions_run", "directions_bike",
             "directions_walk", "pool", "hiking", "sports":
                                        return .entrenamiento
        case "groups":                  return .reunion
        case "menu_book":               return .estudio
        case "work":                    return .foco
        case "alarm":                   return .reminder
        case "local_hospital",
             "shopping_cart", "cake",
             "flight", "account_balance",
             "restaurant":              return .personal
        case "event":                   return .reunion
        default:                        return nil
        }
    }

    /// Mensaje humano de confirmación al crear UN evento desde el backend.
    /// Bajo el modelo unificado "todo con hora = bloque" usamos "bloque" en
    /// vez de mezclar "evento"/"recordatorio". Más simple para el usuario.
    private func summaryForCreatedEvent(_ event: FocusEvent) -> String {
        let cal = Calendar.current
        let dayLabel: String
        if cal.isDateInToday(event.startTime) { dayLabel = "hoy" }
        else if cal.isDateInTomorrow(event.startTime) { dayLabel = "mañana" }
        else { dayLabel = "el \(DateFormatters.weekdayDay.string(from: event.startTime).lowercased())" }
        let timeLabel = DateFormatters.hourMinute.string(from: event.startTime)
        return "Listo, \(event.title) \(dayLabel) a las \(timeLabel)."
    }

    /// Parsea un `id` string del backend a UUID. Si no es UUID válido,
    /// devolvemos nil (el caller registra en `ignored`).
    private func parseEventId(_ raw: String) -> UUID? {
        UUID(uuidString: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: - Nova

    struct NovaPendingProposal: Identifiable {
        let id = UUID()
        let summary: String
        let actionLabels: [String]
        fileprivate let actions: [BackendAction]
        fileprivate let localIntents: [NovaIntent]
        fileprivate let userText: String
        fileprivate let generation: UUID
        fileprivate var reviewedEvents: [FocusEvent] = []
        fileprivate var reviewedTasks: [FocusTask] = []
        fileprivate var localDeletionActions: [Int: BackendAction] = [:]
        fileprivate var actionIDs: [String] = []
        fileprivate var reviewedMemories: [NovaMemory]? = nil
        fileprivate var reviewedPlan: [ProposedTaskAction]? = nil
    }

    private struct PendingNovaRequest: Codable {
        let id: UUID
        let textDigest: String
        let createdAt: Date
    }
    private var lastNovaSubmission: (text: String, timestamp: Date)?

    /// Retry identity contains no extra copy of a prompt and is scoped by the
    /// same local partition as the user's conversation and data.
    func prepareNovaRequestID(for text: String) -> UUID? {
        let digest = SHA256.hash(data: Data(text.trimmingCharacters(in: .whitespacesAndNewlines).utf8))
            .map { String(format: "%02x", $0) }.joined()
        if let pending = FocusLocalStore.load(PendingNovaRequest.self, forKey: .novaPendingRequest),
           pending.textDigest == digest, Date().timeIntervalSince(pending.createdAt) < 24 * 60 * 60 {
            return pending.id
        }
        let pending = PendingNovaRequest(id: UUID(), textDigest: digest, createdAt: Date())
        guard FocusLocalStore.saveSync(pending, forKey: .novaPendingRequest) else { return nil }
        return pending.id
    }

    @Published private(set) var novaPendingProposal: NovaPendingProposal?
    @Published private(set) var novaErrorMessage: String?
    @Published private(set) var novaLastFailedInput: String?
    private var novaRequestTask: Task<Void, Never>?
    private var novaRequestID: UUID?

    func cancelNovaRequest(preservingProposal: Bool = false) {
        novaRequestTask?.cancel()
        novaRequestTask = nil
        novaRequestID = nil
        if !preservingProposal { novaPendingProposal = nil }
        novaErrorMessage = nil
        novaLastFailedInput = nil
        lastNovaSubmission = nil
        currentNovaActionID = nil
        FocusLocalStore.clear(.novaPendingRequest)
        isNovaTyping = false
    }

    func retryNovaMessage() {
        guard let text = novaLastFailedInput else { return }
        sendNovaMessage(text, retrying: true)
    }

    func cancelNovaProposal() {
        guard novaPendingProposal != nil else { return }
        novaPendingProposal = nil
        FocusLocalStore.clear(.novaPendingRequest)
        appendNovaReply("De acuerdo. No apliqué la propuesta.")
    }

    func confirmNovaProposal() {
        guard !isNovaTyping, let proposal = novaPendingProposal else { return }
        novaPendingProposal = nil
        guard proposal.generation == accountGeneration else { return }
        if let memories = proposal.reviewedMemories, memories != NovaMemoryStore.shared.activeMemories {
            failNova("La memoria cambió desde que revisaste la propuesta. Vuelve a pedir el cambio para revisarlo.", input: proposal.userText)
            return
        }
        if let plan = proposal.reviewedPlan { novaContext.pendingActionPlan = plan }
        guard proposal.reviewedEvents.allSatisfy({ reviewed in events.first(where: { $0.id == reviewed.id }) == reviewed }),
              proposal.reviewedTasks.allSatisfy({ reviewed in tasks.first(where: { $0.id == reviewed.id }) == reviewed }) else {
            failNova("Los elementos cambiaron desde que revisaste la propuesta. Vuelve a pedir el cambio para confirmar la versión actual.", input: proposal.userText)
            FocusLocalStore.clear(.novaPendingRequest)
            return
        }
        if proposal.localIntents.isEmpty {
            executeNovaActions(proposal.actions, userText: proposal.userText, actionIDs: proposal.actionIDs, reviewedTiming: true)
        } else {
            executeLocalNovaIntents(proposal.localIntents, userText: proposal.userText, confirmed: true,
                                   frozenDeletions: proposal.localDeletionActions)
        }
        if novaErrorMessage == nil { FocusLocalStore.clear(.novaPendingRequest) }
    }

    private func appendNovaReply(_ reply: String, actionLabels: [String] = []) {
        novaMessages.append(NovaMessage(role: .nova, content: reply, actionLabels: actionLabels))
        persistNovaMessages()
    }

    private func failNova(_ message: String, input: String) {
        FocusTelemetry.record(.novaActionFailure)
        novaErrorMessage = message
        novaLastFailedInput = input
        appendNovaReply(message)
    }

    /// Both capture surfaces use this single execution boundary. A reply is
    /// a plan until its mode, arguments and account snapshot have been checked.
    func sendNovaMessage(_ text: String) { sendNovaMessage(text, retrying: false) }

    private func sendNovaMessage(_ text: String, retrying: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isNovaTyping else { return }
        guard trimmed.count <= 4000 else {
            novaErrorMessage = "El mensaje es demasiado largo. Acórtalo un poco."
            return
        }
        if novaPendingProposal != nil {
            let answer = trimmed.lowercased().trimmingCharacters(in: .punctuationCharacters)
            if ["sí", "si", "confirmar", "confirmo", "aplicar", "hazlo"].contains(answer) {
                confirmNovaProposal()
                return
            }
            if ["no", "cancelar", "cancela", "descartar"].contains(answer) {
                cancelNovaProposal()
                return
            }
        }
        if let proposal = novaPendingProposal,
           !proposal.reviewedEvents.allSatisfy({ reviewed in events.first(where: { $0.id == reviewed.id }) == reviewed }) {
            failNova("Los eventos cambiaron desde la propuesta. Conservé tus cambios; descarta esa propuesta y pide un plan nuevo.", input: trimmed)
            return
        }
        let pendingProposalContext = novaPendingProposal.flatMap { proposal in
            proposal.localIntents.isEmpty
                ? NovaService.PendingProposal(id: proposal.id.uuidString, originalRequest: proposal.userText, actions: proposal.actions)
                : nil
        }
        if novaPendingProposal != nil && pendingProposalContext == nil {
            appendNovaReply("Esta propuesta se puede aplicar o descartar. Para pedir otra, descártala primero.")
            return
        }
        if let pending = pendingProposalContext,
           NovaService.PendingProposal.appending(trimmed, to: pending.originalRequest) == nil {
            failNova("La propuesta llegó al límite de ajustes. La conservé sin aplicar; descártala y pide una planificación nueva con todos tus requisitos.", input: trimmed)
            return
        }
        if !retrying, let last = lastNovaSubmission, last.text == trimmed,
           Date().timeIntervalSince(last.timestamp) < 0.8 { return }
        lastNovaSubmission = (trimmed, Date())
        if let pending = FocusLocalStore.load(PendingNovaRequest.self, forKey: .novaPendingRequest) {
            let digest = SHA256.hash(data: Data(trimmed.utf8)).map { String(format: "%02x", $0) }.joined()
            if pending.textDigest != digest { FocusLocalStore.clear(.novaPendingRequest) }
        }
        novaErrorMessage = nil
        novaLastFailedInput = nil
        FocusTelemetry.record(.novaRequest)
        let history = novaMessages.suffix(12).map {
            NovaService.HistoryEntry(role: $0.role == .user ? .user : .assistant, content: $0.content)
        }
        novaMessages.append(NovaMessage(role: .user, content: trimmed))
        persistNovaMessages()
        HapticManager.shared.tap()

        if NovaResponder.invalidTemporalInput(trimmed) {
            appendNovaReply("Esa fecha u hora no es válida o coincide con un cambio de horario. Dime una fecha y hora exactas antes de guardar.")
            return
        }
        if NovaActionValidator.requiresLocationTrigger(trimmed) {
            let base = trimmed.replacingOccurrences(of: #"(?i)\s+(?:cuando|al)\s+(?:lleg|sal|volv).*$"#, with: "", options: .regularExpression)
            let title = NovaActionNormalizer.cleanTitle(base)
            setPendingClarification(PendingClarification(
                originalInput: base, kind: .reminder, proposedTitle: title, wantsReminder: true,
                missingFields: [.time], questionAsked: "¿A qué hora quieres que te avise?", source: .novaChat
            ))
            appendNovaReply("Los avisos por ubicación todavía no están disponibles. ¿A qué hora quieres que te avise?")
            return
        }
        if pendingProposalContext == nil, let memoryReply = handleMemoryCommand(trimmed: trimmed) {
            appendNovaReply(memoryReply)
            return
        }
        if NovaMemoryPrivacy.isSensitive(trimmed), !NovaMemoryPrivacy.canRemember(trimmed, userText: trimmed),
           trimmed.range(of: #"(?i)^(?:.+ es mi .+|mi .+ (?:es|se llama) .+|(?:prefiero|me gusta|no me gusta) .+)$"#, options: .regularExpression) != nil {
            appendNovaReply("Entendido. No guardaré esa información en tu memoria.")
            return
        }
        let expanded = settings.novaMemoryEnabled
            ? NovaMemoryStore.shared.expandAliases(in: trimmed) : trimmed
        let intents = pendingProposalContext == nil ? NovaResponder.parseAll(expanded, context: novaContext) : []
        // Learning a personal fact must not swallow another instruction.
        if pendingProposalContext == nil, settings.novaMemoryEnabled, intents.count == 1,
           !NovaActionNormalizer.userMentionedAnyTimeOfDay(in: trimmed),
           !trimmed.lowercased().contains(" y ") {
            if let learned = NovaMemoryStore.shared.tryLearnFromUserText(trimmed) {
                appendNovaReply(replyForLearnedMemory(learned))
                return
            }
            if !NovaMemoryStore.shared.lastPersistenceSucceeded {
                failNova("No pude guardar la memoria en este iPhone. Inténtalo de nuevo.", input: trimmed)
                return
            }
        }
        if pendingProposalContext != nil && syncCredentials == nil {
            failNova("Necesitas conexión y una sesión para ajustar esta propuesta. La conservé sin aplicar.", input: trimmed)
            return
        }
        let localDecision = NovaLocalRoutingPolicy.decide(trimmed,
            hasPendingClarification: novaContext.pendingIsActive)
        let exactDeletion: Bool = {
            guard intents.count == 1, case .deleteEventByActivity(let activity) = intents[0] else { return false }
            let matches = events.filter { $0.title.compare(activity, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
            return matches.count == 1 && trimmed.range(of: #"(?i)^(?:borra|elimina)\s+(?:lo de\s+)?"# + NSRegularExpression.escapedPattern(for: activity) + #"$"#, options: .regularExpression) != nil
        }()
        let canExecuteLocally = pendingProposalContext == nil && (localDecision.permitsLocalMutation || exactDeletion)
            && intents.count == 1
        NovaRouteTrace.selected(canExecuteLocally ? localDecision
            : .init(route: .remoteAI, reason: "semantic_interpretation_required"))
        if canExecuteLocally {
            executeLocalNovaIntents(intents, userText: trimmed)
            return
        }
        guard syncCredentials != nil else {
            failNova("Para entender bien esta frase necesito la IA. Inicia sesión y vuelve a enviarla; también puedes crear el pendiente manualmente.", input: trimmed)
            return
        }
        if let first = intents.first, case .clarify(let reason) = first,
           let pending = buildChatPendingClarification(from: reason, userText: trimmed) {
            setPendingClarification(pending)
        }
        detectAndPromoteMentions(in: trimmed)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let horizon = calendar.date(byAdding: .day, value: 45, to: today) ?? today
        let discussedIDs = Set(novaContext.freshDiscussedEvents.map(\.eventId))
        let contextEvents = events.filter {
            $0.status != .done && $0.status != .cancelled &&
            (($0.startTime >= today && $0.startTime <= horizon) || discussedIDs.contains($0.id))
        }.sorted { $0.startTime < $1.startTime }
        let discussedIds = novaContext.freshDiscussedEvents.map(\.eventId)
        let generation = accountGeneration
        guard let credentials = syncCredentials else { return }
        guard NovaAIConsent.granted else {
            failNova("Para usar la IA, revisa y acepta cómo se procesan tus mensajes en Ajustes.", input: trimmed)
            return
        }
        guard let requestID = prepareNovaRequestID(for: trimmed) else {
            failNova("No pude guardar la solicitud en este iPhone. Libera espacio e inténtalo de nuevo.", input: trimmed)
            return
        }
        let sentEvents = Array(contextEvents.prefix(80))
        let sentTasks = Array(tasks.filter { !$0.done }.prefix(50))
        isNovaTyping = true
        novaRequestID = requestID
        novaRequestTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.novaRequestID == requestID {
                    self.isNovaTyping = false
                    self.novaRequestTask = nil
                    self.novaRequestID = nil
                }
            }
            do {
                let result = try await self.novaTransport(NovaService.Request(
                    message: trimmed, events: sentEvents,
                    tasks: sentTasks, history: history,
                    accessToken: credentials.accessToken,
                    personality: NovaService.Personality(rawValue: self.settings.novaPersonality.rawValue) ?? .focus,
                    surface: .novaChat, discussedEventIds: discussedIds,
                    userMemories: self.settings.novaMemoryEnabled
                        ? NovaMemoryStore.shared.contextForRequest(trimmed) : [], requestID: requestID,
                    pendingProposal: pendingProposalContext
                ))
                guard !Task.isCancelled, self.accountGeneration == generation,
                      self.novaRequestID == requestID else { return }
                guard self.novaTargetsUnchanged(result, requestID: requestID, sentEvents: sentEvents, sentTasks: sentTasks) else {
                    self.failNova("Los elementos cambiaron mientras preparaba la respuesta. Conservé tus cambios; vuelve a pedir la acción para usar la versión actual.", input: trimmed)
                    FocusLocalStore.clear(.novaPendingRequest)
                    return
                }
                self.receiveNovaResult(result, userText: trimmed)
            } catch {
                guard !Task.isCancelled, self.accountGeneration == generation,
                      self.novaRequestID == requestID else { return }
                if let error = error as? NovaServiceError,
                   case .completedRetryableRequest(let completedID) = error, completedID == requestID {
                    // Only a verified terminal response releases this identity.
                    // A fresh paid attempt still requires the user's retry tap.
                    FocusLocalStore.clear(.novaPendingRequest)
                }
                let message = (error as? NovaServiceError)?.errorDescription
                    ?? "No pude terminar la solicitud. Vuelve a intentarlo."
                self.failNova(message, input: trimmed)
            }
        }
    }

    private func novaTargetsUnchanged(_ result: NovaService.Result, requestID: UUID,
                                      sentEvents: [FocusEvent], sentTasks: [FocusTask]) -> Bool {
        let actions = result.mode == .proposal ? result.proposedActions : result.actions
        for (index, action) in actions.enumerated() {
            if novaAppliedActionIDs.contains(requestID.uuidString.lowercased() + ":" + String(index)) { continue }
            switch action {
            case .editEvent(let raw, _), .deleteEvent(let raw):
                guard let id = UUID(uuidString: raw), let sent = sentEvents.first(where: { $0.id == id }),
                      events.first(where: { $0.id == id }) == sent else { return false }
            case .editTask(let raw, _), .completeTask(let raw, _), .toggleTask(let raw), .deleteTask(let raw):
                guard let id = UUID(uuidString: raw), let sent = sentTasks.first(where: { $0.id == id }),
                      tasks.first(where: { $0.id == id }) == sent else { return false }
            default: break
            }
        }
        return true
    }

    func receiveNovaResult(_ result: NovaService.Result, userText: String) {
        defer {
            if novaErrorMessage == nil && novaPendingProposal == nil { FocusLocalStore.clear(.novaPendingRequest) }
        }
        let replacedProposal: NovaPendingProposal?
        if let replacedID = result.replacesProposalId {
            guard result.mode == .proposal, let pending = novaPendingProposal,
                  pending.id.uuidString.lowercased() == replacedID.lowercased() else {
                failNova("La propuesta cambió mientras la ajustaba. Conservé la versión actual; vuelve a pedir el cambio.", input: userText)
                return
            }
            replacedProposal = pending
        } else { replacedProposal = nil }
        if result.mode == .proposal, novaPendingProposal != nil, replacedProposal == nil {
            failNova("No pude verificar el ajuste de la propuesta. Conservé la anterior sin aplicar; vuelve a intentarlo.", input: userText)
            return
        }
        if result.smartActionsBlocked {
            failNova("\(AssistantBrand.displayName) no pudo aplicar los cambios en este momento. No se guardó ninguna acción de esta respuesta. Puedes crear o editar tus pendientes manualmente.", input: userText)
            return
        }
        if (result.mode == .chatOnly || result.mode == .clarification || result.shouldAskUser || !result.confidence.isFinite || result.confidence < 0.55),
           NovaService.claimsExecutedMutation(result.reply) {
            failNova("La respuesta anunció cambios sin una acción verificable. No guardé ningún cambio de esa respuesta.", input: userText)
            return
        }
        if result.shouldAskUser || !result.confidence.isFinite || result.confidence < 0.55 || result.mode == .clarification {
            appendNovaReply(!result.actions.isEmpty || result.reply.isEmpty
                ? "Necesito confirmar los detalles antes de guardar. Dime qué quieres crear o cambiar y para cuándo."
                : result.reply)
            return
        }
        if result.mode == .chatOnly {
            guard result.actions.isEmpty else {
                failNova("La respuesta no fue clara. No apliqué cambios; vuelve a intentarlo.", input: userText)
                return
            }
            appendNovaReply(result.reply)
            return
        }
        guard novaPendingProposal == nil || result.mode == .proposal else {
            failNova("El ajuste necesita una propuesta para revisar. Conservé la anterior sin aplicar.", input: userText)
            return
        }
        let candidates = result.mode == .proposal ? result.proposedActions : result.actions
        let validation = NovaActionValidator.validate(actions: candidates, userText: userText)
        guard !validation.shouldAsk else {
            failNova(validation.suggestedQuestion ?? "No pude preparar esos cambios con seguridad.", input: userText)
            return
        }
        let actions = validation.safeActions
        let actionIDs = result.requestId.flatMap(UUID.init(uuidString:)).map { id in
            actions.indices.map { id.uuidString.lowercased() + ":" + String($0) }
        } ?? []
        guard !actions.isEmpty else {
            failNova("No pude preparar una acción para esa solicitud. Inténtalo de nuevo con el nombre y la fecha.", input: userText)
            return
        }
        let requiresReview = result.mode == .proposal
            || actions.contains(where: NovaActionValidator.isDestructive)
            || NovaActionValidator.isEmotionalOrContextual(userText)
        if requiresReview {
            let proposalRequest: String
            if let replacedProposal {
                guard let combined = NovaService.PendingProposal.appending(userText, to: replacedProposal.userText) else {
                    failNova("La propuesta llegó al límite de ajustes. La conservé sin aplicar; descártala y pide una planificación nueva con todos tus requisitos.", input: userText)
                    return
                }
                proposalRequest = combined
            } else { proposalRequest = userText }
            novaPendingProposal = NovaPendingProposal(
                summary: "Revisa estos cambios antes de aplicarlos.",
                actionLabels: actions.map(novaActionLabel), actions: actions,
                localIntents: [], userText: proposalRequest, generation: accountGeneration,
                reviewedEvents: reviewedEvents(for: actions), reviewedTasks: reviewedTasks(for: actions),
                actionIDs: actionIDs,
                reviewedMemories: actions.contains(where: { if case .forgetMemory = $0 { return true }; return false }) ? NovaMemoryStore.shared.activeMemories : nil
            )
            appendNovaReply("Preparé una propuesta. Revisa los cambios y pulsa Aplicar para confirmarlos.")
            return
        }
        executeNovaActions(actions, userText: userText, actionIDs: actionIDs)
        if novaErrorMessage == nil { FocusLocalStore.clear(.novaPendingRequest) }
        if novaErrorMessage == nil, let question = result.followUpQuestion, !question.isEmpty,
           !NovaService.claimsExecutedMutation(question) {
            appendNovaReply(question)
        }
    }

    private func novaActionLabel(_ action: BackendAction) -> String {
        switch action {
        case .addEvent(let event), .addRecurringEvent(let event, _):
            let timeRange = [event.timeString, event.endTimeString].compactMap { $0 }.joined(separator: "–")
            let details = [event.dateString, timeRange.isEmpty ? nil : timeRange].compactMap { $0 }.joined(separator: " · ")
            let label = "Crear: \(event.title)" + (details.isEmpty ? "" : " · " + details)
            guard case .addRecurringEvent(_, let recurrence) = action else { return label }
            let pattern = recurrence.pattern.lowercased()
            let frequency = pattern == "daily" ? "cada día" : pattern == "weekdays" ? "de lunes a viernes" : "cada semana"
            let count = min(recurrence.count ?? (pattern == "daily" ? 30 : pattern == "weekdays" ? 44 : 26), pattern == "weekly" ? 52 : 60)
            let weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
            let weekday = recurrence.weekday.flatMap { weekdays.indices.contains($0) ? weekdays[$0] : nil }
            let recurrenceDetails = [frequency, weekday, recurrence.startDate.map { "desde \($0)" }, "\(count) próximas"].compactMap { $0 }.joined(separator: " · ")
            return label + " · " + recurrenceDetails
        case .addTask(let task): return "Añadir tarea: \(task.label)"
        case .editEvent(let id, let updates):
            let name = events.first { $0.id.uuidString.lowercased() == id.lowercased() }?.title ?? "evento"
            let changes = [updates.title, updates.dateString, updates.timeString.map { "inicio \($0)" }, updates.endTimeString.map { "término \($0)" }, updates.subtitle, updates.location].compactMap { $0 }.joined(separator: " · ")
            return "Editar \(name): \(changes)"
        case .deleteEvent(let id):
            guard let event = events.first(where: { $0.id.uuidString.lowercased() == id.lowercased() }) else { return "Eliminar evento" }
            return "Eliminar: \(event.title) · \(DateFormatters.shortDayMonth.string(from: event.startTime)) · \(DateFormatters.hourMinute.string(from: event.startTime))"
        case .deleteTask(let id): return "Eliminar: \(tasks.first { $0.id.uuidString.lowercased() == id.lowercased() }?.title ?? "tarea")"
        case .completeTask(let id, let done):
            let name = tasks.first { $0.id.uuidString.lowercased() == id.lowercased() }?.title ?? "tarea"
            return "\(done ? "Completar" : "Volver a pendiente"): \(name)"
        case .editTask(let id, let updates):
            let name = tasks.first { $0.id.uuidString.lowercased() == id.lowercased() }?.title ?? "tarea"
            let changes = [updates.label, updates.date, updates.time, updates.priority,
                updates.clearsDate ? "Sin fecha" : nil, updates.clearsTime ? "Sin hora" : nil,
                updates.done.map { $0 ? "Completada" : "Pendiente" }].compactMap { $0 }.joined(separator: " · ")
            return "Editar \(name): \(changes)"
        case .toggleTask: return "Cambiar el estado de la tarea"
        case .saveMemory: return "Guardar una preferencia"
        case .forgetMemory: return "Olvidar información guardada"
        case .remember, .unsupported: return "Acción no disponible"
        }
    }

    private func reviewedEvents(for actions: [BackendAction]) -> [FocusEvent] {
        actions.compactMap { action in
            switch action {
            case .editEvent(let raw, _), .deleteEvent(let raw): return events.first { $0.id.uuidString.lowercased() == raw.lowercased() }
            default: return nil
            }
        }
    }

    private func reviewedTasks(for actions: [BackendAction]) -> [FocusTask] {
        actions.compactMap { action in
            switch action {
            case .editTask(let raw, _), .completeTask(let raw, _), .toggleTask(let raw), .deleteTask(let raw): return tasks.first { $0.id.uuidString.lowercased() == raw.lowercased() }
            default: return nil
            }
        }
    }

    private func executeNovaActions(_ actions: [BackendAction], userText: String, actionIDs: [String] = [], reviewedTiming: Bool = false) {
        let validation = NovaActionValidator.validate(actions: actions, userText: userText)
        guard !validation.shouldAsk else {
            failNova("No pude validar todos los cambios. No apliqué la propuesta.", input: userText)
            return
        }
        let outcome = applyBackendActions(validation.safeActions, userText: userText, actionIDs: actionIDs, reviewedTiming: reviewedTiming)
        if outcome.ignored.contains(where: { $0.contains("persistence_failed") }) {
            let receipt = [outcome.summary, outcome.details].compactMap { $0 }.joined(separator: "\n")
            let failure = outcome.didMutate
                ? receipt + "\nNo pude guardar el resto. Al reintentar, conservaré los cambios ya guardados."
                : "No pude guardar los cambios en este iPhone. Inténtalo de nuevo."
            failNova(failure, input: userText)
            return
        }
        if outcome.didMutate {
            FocusTelemetry.record(.novaActionSuccess)
            appendNovaReply([outcome.summary, outcome.details,
                outcome.ignored.isEmpty ? nil : "Algunos cambios no se pudieron aplicar. Revisa tus pendientes antes de repetirlos."]
                .compactMap { $0 }.joined(separator: "\n"), actionLabels: outcome.createdTasks.map(\.title) + outcome.createdEvents.map(\.title))
        } else if let summary = outcome.summary {
            appendNovaReply(summary)
        } else {
            failNova("No pude aplicar los cambios. Revisa los datos e inténtalo de nuevo.", input: userText)
        }
    }

    private func executeLocalNovaIntents(_ intents: [NovaIntent], userText: String, confirmed: Bool = false,
                                        frozenDeletions: [Int: BackendAction] = [:]) {
        guard !intents.isEmpty else {
            failNova("No pude interpretar la solicitud. Prueba con una tarea o un evento con fecha y hora.", input: userText)
            return
        }
        if intents.count == 1, case .clarify(let reason) = intents[0] {
            if let pending = buildChatPendingClarification(from: reason, userText: userText) {
                setPendingClarification(pending)
            }
            appendNovaReply(NovaResponder.reply(to: userText, context: novaContext))
            return
        }
        let pending = novaContext.pendingIsActive ? novaContext.pendingClarification : nil
        let dayIsExplicit = NovaResponder.hasExplicitDayMarker(userText.lowercased())
            || pending.map { NovaResponder.hasExplicitDayMarker($0.originalInput.lowercased()) } == true
        if !confirmed, !dayIsExplicit,
           let pastIntent = intents.first(where: {
               if case .createEvent(_, let date?, _, _, _, _, let recurrence, _, _) = $0 {
                   return recurrence == nil && date < NovaResponder.referenceNow
               }
               return false
           }) {
            guard intents.count == 1,
                  case .createEvent(let title, let date, _, let location, let section, let wantsReminder, _, _, _) = pastIntent else {
                appendNovaReply("Una de esas horas ya pasó y falta el día. Dime el día de cada evento; todavía no guardé los cambios.")
                return
            }
            let question = "Esa hora ya pasó hoy. ¿Quieres «\(title)» hoy o mañana a esa misma hora?"
            setPendingClarification(PendingClarification(
                originalInput: [pending?.originalInput, userText].compactMap { $0 }.joined(separator: " "),
                kind: wantsReminder ? .reminder : .event, proposedTitle: title, proposedDate: date,
                proposedSection: section, proposedLocation: location, wantsReminder: wantsReminder,
                missingFields: [.date], questionAsked: question, source: .novaChat
            ))
            appendNovaReply(question)
            return
        }
        if !confirmed, NovaActionValidator.isEmotionalOrContextual(userText), intents.contains(where: {
            if case .createEvent = $0 { return true }
            if case .createTask = $0 { return true }
            return false
        }) {
            appendNovaReply("Podemos pensarlo antes de agendar. Si decides hacerlo, dime qué quieres añadir y para cuándo.")
            return
        }
        if intents.count == 1, case .proposeActionPlan(let plan) = intents[0] {
            novaContext.pendingActionPlan = plan
            novaContext.updatedAt = Date()
            novaPendingProposal = NovaPendingProposal(summary: "Revisa estas tareas.",
                actionLabels: plan.map { $0.title }, actions: [], localIntents: [.confirmActionPlan],
                userText: userText, generation: accountGeneration, reviewedPlan: plan)
            appendNovaReply("Preparé tus tareas. Revisa la propuesta antes de añadirlas.")
            return
        }
        var localDeletionActions: [Int: BackendAction] = [:]
        for (index, intent) in intents.enumerated() {
            let deletion: BackendAction?
            switch intent {
            case .deleteLastItem:
                if let id = novaContext.lastEventId { deletion = .deleteEvent(id: id.uuidString) }
                else if let id = novaContext.lastTaskId { deletion = .deleteTask(id: id.uuidString) }
                else { deletion = nil }
            case .deleteEventByActivity(let activity):
                deletion = NovaResponder.findEventByApproxTitle(activity, in: events).map { .deleteEvent(id: $0.id.uuidString) }
            default: deletion = nil
            }
            if let deletion { localDeletionActions[index] = deletion }
        }
        let deletions = localDeletionActions.keys.sorted().compactMap { localDeletionActions[$0] }
        if !confirmed, !deletions.isEmpty {
            novaPendingProposal = NovaPendingProposal(
                summary: "Confirma qué quieres eliminar.", actionLabels: deletions.map(novaActionLabel),
                actions: [], localIntents: intents, userText: userText, generation: accountGeneration,
                reviewedEvents: reviewedEvents(for: deletions), reviewedTasks: reviewedTasks(for: deletions),
                localDeletionActions: localDeletionActions
            )
            appendNovaReply("Revisa los elementos que voy a eliminar y confirma la propuesta.")
            return
        }
        if intents.count > 1, intents.contains(where: { if case .clarify = $0 { return true }; return false }) {
            appendNovaReply("Una parte necesita más información. Dime el día y la hora de cada evento; todavía no guardé los cambios.")
            return
        }
        let eventsBefore = events
        let tasksBefore = tasks
        var replies: [String] = []
        for (index, intent) in intents.enumerated() {
            if let deletion = frozenDeletions[index] {
                let outcome = applyBackendActions([deletion], userText: userText)
                guard outcome.didMutate, let summary = outcome.summary else {
                    failNova("No pude guardar la eliminación. Revisa tus pendientes antes de repetirla.", input: userText)
                    return
                }
                replies.append(summary)
                continue
            }
            if let reply = applyLocalNovaIntent(intent, userText: userText, isMultiIntent: intents.count > 1) {
                if reply.hasPrefix("No pude guardar") {
                    failNova(reply, input: userText)
                    return
                }
                replies.append(reply)
            }
        }
        if events != eventsBefore || tasks != tasksBefore { FocusTelemetry.record(.novaActionSuccess) }
        if replies.isEmpty {
            failNova("No pude resolver esa solicitud en este iPhone. Puedes crear el pendiente manualmente o volver a intentarlo con conexión.", input: userText)
        } else {
            appendNovaReply(replies.joined(separator: "\n"))
        }
    }

    /// Snapshot atómico de las credenciales — leemos en main actor y
    /// devolvemos un valor inmutable para usar dentro del Task sin
    /// data race.
    @MainActor
    private func syncCredentialsSnapshot() -> SyncCredentials? {
        syncCredentials
    }

    /// Convierte un `NovaServiceError` recuperable en una frase humana
    /// para mostrar al final del mensaje de Nova en el chat.
    /// Analiza el día real del usuario y devuelve un resumen humano. Solo
    /// crea una `NovaSuggestion` cuando hay una recomendación CONCRETA
    /// (gaps largos, eventos back-to-back, día vacío sustancial). Si no
    /// hay nada accionable, devuelve solo texto — preserva la credibilidad
    /// de la Bandeja, que no se llena de sugerencias de relleno.
    fileprivate func summarizeAndSuggest(forDayOrganization userText: String) -> String {
        let cal = Calendar.current
        let now = Date()
        let todayStart = cal.startOfDay(for: now)
        let todayEnd = cal.date(byAdding: .day, value: 1, to: todayStart) ?? now

        let todayEvents = events
            .filter { $0.startTime >= todayStart && $0.startTime < todayEnd }
            .sorted { $0.startTime < $1.startTime }

        let pending = tasks.filter { $0.category == .hoy && !$0.done }

        // Caso 1: día completamente vacío.
        if todayEvents.isEmpty && pending.isEmpty {
            return "Tu día está despejado. Cuando tengas algo, dímelo y lo agendamos."
        }

        // Caso 2: solo tareas sin hora.
        if todayEvents.isEmpty && !pending.isEmpty {
            let topThree = pending.prefix(3).map { "• \($0.title)" }.joined(separator: "\n")
            return "No tienes eventos hoy. Tienes \(pending.count) tarea\(pending.count == 1 ? "" : "s") pendiente\(pending.count == 1 ? "" : "s"):\n\(topThree)"
        }

        // Detectar bloques back-to-back: dos eventos con < 15 min de gap.
        var backToBackPairs: [(FocusEvent, FocusEvent, Int)] = []
        for i in 1..<todayEvents.count {
            let prev = todayEvents[i - 1]
            let curr = todayEvents[i]
            guard let prevEnd = prev.endTime else { continue }
            let gapMinutes = Int(curr.startTime.timeIntervalSince(prevEnd) / 60)
            if gapMinutes >= 0, gapMinutes < 15 {
                backToBackPairs.append((prev, curr, gapMinutes))
            }
        }

        // Detectar primer hueco grande (≥ 90 min) tras "ahora" y antes de
        // que termine el día — buen candidato para foco profundo.
        var firstBigGap: (start: Date, minutes: Int)? = nil
        var cursor = max(now, todayStart)
        for event in todayEvents where event.startTime > cursor {
            let gapMinutes = Int(event.startTime.timeIntervalSince(cursor) / 60)
            if gapMinutes >= 90 {
                firstBigGap = (cursor, gapMinutes)
                break
            }
            cursor = max(cursor, event.endTime ?? event.startTime)
        }

        // Construir resumen base.
        let firstEventLabel: String? = todayEvents
            .first(where: { $0.startTime > now })
            .map { ev in
                let hh = DateFormatters.hourMinute.string(from: ev.startTime)
                return "\(ev.title) a las \(hh)"
            }
        var summaryLines: [String] = []
        summaryLines.append("Hoy tienes \(todayEvents.count) evento\(todayEvents.count == 1 ? "" : "s")\(pending.isEmpty ? "" : " y \(pending.count) tarea\(pending.count == 1 ? "" : "s")") .")
        if let next = firstEventLabel {
            summaryLines.append("Próximo: \(next).")
        }

        // Decidir si CREAR una sugerencia concreta:
        if let (a, b, gap) = backToBackPairs.first {
            // Sugerir respiro entre los dos eventos pegados.
            let when = DateFormatters.hourMinute.string(from: a.endTime ?? a.startTime)
            addSuggestion(NovaSuggestion(
                title: "Respiro entre eventos",
                detail: "«\(a.title)» y «\(b.title)» están a \(gap) min de distancia. Podemos mover el segundo 15 min o agregar un buffer corto a las \(when).",
                kind: .break_,
                priority: .high,
                suggestedAction: "Mover «\(b.title)» 15 min"
            ))
            summaryLines.append("Dejé una sugerencia en la Bandeja para que respires entre bloques.")
        } else if let gap = firstBigGap, gap.minutes >= 90 {
            // Avisar del hueco libre sin imponer un "bloque de foco" — el
            // usuario decide qué hacer. Mantenemos la detección pero el
            // copy es neutral.
            let when = DateFormatters.hourMinute.string(from: gap.start)
            let hours = gap.minutes / 60
            let mins = gap.minutes % 60
            let durLabel = hours > 0 ? "\(hours)h\(mins > 0 ? " \(mins)m" : "")" : "\(mins) min"
            addSuggestion(NovaSuggestion(
                title: "Tienes un hueco libre",
                detail: "Quedan \(durLabel) sin nada agendado desde las \(when). Si quieres aprovecharlo, dime qué hacer.",
                kind: .schedule,
                priority: .normal,
                suggestedAction: "Usar el hueco de \(when)"
            ))
            summaryLines.append("Dejé un aviso en la Bandeja sobre ese hueco.")
        }
        // Si no detectamos nada accionable, NO creamos sugerencia — solo
        // damos el resumen. Eso preserva la credibilidad de la Bandeja.

        return summaryLines.joined(separator: " ")
    }

    /// True cuando un intent local debe short-circuit el flujo del backend.
    /// Misma lógica que `MiDiaView.shouldShortCircuit` — duplicada acá para
    /// que el chat la pueda usar sin acoplar State a SwiftUI.
    func shouldShortCircuitLocally(_ intent: NovaIntent) -> Bool {
        switch intent {
        case .correctLastEvent, .deleteLastItem, .convertLastToTask:
            return true
        case .organizeDay, .reviewPending, .reviewToday, .askAboutDemo:
            return true
        case .smallTalk:
            return true
        case .deleteEventByActivity, .rescheduleEventByActivity, .attachReminderToEvent:
            // Operaciones sobre eventos existentes (resueltas por
            // fuzzy match local). El backend no tiene visibilidad de
            // los IDs locales, así que estos intents SIEMPRE se
            // resuelven local.
            return true
        case .proposeActionPlan, .confirmActionPlan:
            // Extracción de plan + confirmación: local, conservador.
            // El backend podría hacer mejor parseo, pero hasta tenerlo
            // mejor que el local, el local da una experiencia consistente.
            return true
        case .annotateTaskCorrection, .annotateDependency:
            // Operaciones sobre tareas existentes (resueltas con fuzzy
            // match local). El backend no tiene visibilidad de IDs locales.
            return true
        case .createEvent, .createTask:
            // V2 (2026-05-28) — user spec "que use GPT con razonamiento":
            // La creación de eventos/tareas NUEVOS ahora va al LLM (GPT-5
            // con reasoning). El parser local producía basura tipo
            // "Q jugar counter más o menos" para "tengo q jugar counter a
            // la 1 más o menos". GPT entiende "q"="que", "más o menos"=
            // hora aproximada → título limpio "Jugar Counter".
            //
            // ÚNICA excepción: si hay un pending follow-up activo (Nova
            // preguntó "¿a qué hora?" y el user respondió "a las 5"), el
            // backend GPT NO tiene ese contexto local → resolvemos local.
            return novaContext.pendingIsActive
        default:
            return false
        }
    }

    /// Ejecuta un intent local del parser y devuelve el texto que el chat
    /// debe mostrar. Usado por `sendNovaMessage` cuando short-circuit-ea
    /// el backend (correcciones al último ítem, follow-ups de pending,
    /// comandos meta, confirmaciones cortas).
    ///
    /// Side effects: dispara `addEvent`/`updateEvent`/`deleteEvent`/`addTask`/
    /// `addSuggestion` etc. — todos los métodos que ya sincronizan Supabase.
    /// Devuelve nil si el intent no debería ejecutarse acá (caller fall-through).
    func applyLocalNovaIntent(_ intent: NovaIntent, userText: String, isMultiIntent: Bool = false) -> String? {
        switch intent {
        case .createEvent(let rawTitle, let when, let rawExplicitEnd, let location, let section, let wantsReminder, let recurrence, let segReminderOffset, let segReminderNote):
            guard let rawDate = when else { return nil }
            // Day ambiguity is resolved before execution. Preserve the exact
            // civil date and range the user reviewed or explicitly selected.
            let date = rawDate
            let explicitEnd = rawExplicitEnd
            // PASO 1: Limpiar título via normalizer (mismo pipeline que
            // backend path → consistencia 100%).
            let cleanedTitle = NovaActionNormalizer.cleanTitle(rawTitle)
            guard !cleanedTitle.isEmpty else { return nil }

            // PASO 1.5: resolver subtítulo. Dos fuentes (prioridad arriba):
            //   1. Detalle trailing del userText
            //      ("futbol a las 5 acordarme de llevar la pelota" →
            //       subtitle "Llevar la pelota"). Es la fuente principal
            //       en post-2026-05-27 para no perder contexto humano.
            //   2. Split "Reunión de X" del cleanedTitle
            //      ("Reunión de mindfulness con Cristina" → title
            //       "Reunión", subtitle "Mindfulness con Cristina").
            //
            //   Si ambos existen, el detalle trailing gana porque proviene
            //   directamente del texto del usuario y suele ser más rico.
            let trailingDetail = NovaActionNormalizer
                .extractEventDetail(from: userText).detail
            let (title, eventSubtitle): (String, String?) = {
                if let detail = trailingDetail {
                    // Single-intent: el detalle es de ESTE (único) evento.
                    if !isMultiIntent {
                        return (cleanedTitle, detail)
                    }
                    // Multi-intent: el detalle trailing del userText completo
                    // pertenece a UN solo segmento. Antes se suprimía para
                    // TODOS (sin esto "dentista a las 4 y comprar remedios a
                    // las 5" ponía "comprar remedios" como subtítulo del
                    // dentista). Ahora lo anclamos SOLO al evento que el
                    // detalle nombra explícitamente ("...al dentista" →
                    // "Dentista"); para el resto se sigue suprimiendo. Sin
                    // referencia explícita ("comprar remedios") nadie lo
                    // recibe — el guard original se mantiene (fix 2026-06-12).
                    if NovaActionNormalizer.detailTargetsTitle(detail: detail, title: cleanedTitle) {
                        return (cleanedTitle, detail)
                    }
                }
                if let split = NovaActionNormalizer.splitTitleSubtitle(cleanedTitle) {
                    return (split.title, split.subtitle)
                }
                return (cleanedTitle, nil)
            }()

            // PASO 2: isReminder unificado — del intent (wantsReminder)
            // O detectado en userText (trigger explícito "acuérdame" o
            // verbo puntual implícito tipo "despertarme/levantarme").
            //
            // Detail-aware suppression (user spec 2026-05-27):
            //   - Si el userText EMPIEZA con trigger ("recuérdame …") →
            //     reminder (intención explícita).
            //   - Si NO empieza con trigger pero hay `trailingDetail` →
            //     el trigger mid-sentence fue consumido por la extracción
            //     → NO se marca el evento como reminder (caso "futbol a
            //     las 5 acordarme de llevar la pelota": evento Fútbol +
            //     subtítulo Llevar la pelota, NO recordatorio).
            //   - Si no hay detail → comportamiento clásico (cualquier
            //     trigger o verbo puntual marca reminder).
            let isReminderHint: Bool = {
                if NovaActionNormalizer.startsWithReminderTrigger(in: userText) {
                    return true
                }
                if trailingDetail != nil { return false }
                return wantsReminder
                    || NovaActionNormalizer.isReminderTrigger(in: userText)
                    || NovaActionNormalizer.impliesPunctualReminder(in: userText)
            }()

            // PASO 3: endTime via normalizer (centralizado).
            let endResolution = NovaActionNormalizer.resolveEndTime(
                startTime: date,
                providedEndTime: explicitEnd,
                hasExplicitEndTime: explicitEnd != nil && (explicitEnd ?? date) > date,
                isReminder: isReminderHint
            )

            // Internamente padeamos endTime 5min para ordenamiento;
            // flags decide qué muestra la UI.
            let cal = Calendar.current
            let end: Date
            let isReminderFlag: Bool?
            let inferredFlag: Bool?
            if let resolved = endResolution.endTime {
                end = resolved
                isReminderFlag = nil
                inferredFlag = false
            } else if isReminderHint {
                end = cal.date(byAdding: .minute, value: 5, to: date) ?? date
                isReminderFlag = true
                inferredFlag = nil
            } else {
                end = cal.date(byAdding: .minute, value: 5, to: date) ?? date
                isReminderFlag = nil
                inferredFlag = endResolution.inferredDuration
            }
            // Section default neutral (.personal) en vez de .reunion — antes
            // todo lo que no tenía sección detectada caía como "Reunión"
            // visualmente, lo que era engañoso para "seguir trabajando" o
            // "comer". Si no hay nada en el título que detecte sección,
            // .personal es honesto y neutro.
            let effectiveSection: EventSection = isReminderHint
                ? (section ?? .reminder)
                : (section ?? NovaResponder.guessSection(for: title) ?? .personal)

            // PASO 4: anti-duplicado — si ya hay un evento casi igual,
            // no crear nuevo. Evita basura cuando el usuario repite un
            // comando.
            if NovaActionNormalizer.isLikelyDuplicate(
                title: title,
                startTime: date,
                existingEvents: events
            ) {
                return "Ya tenía «\(title)» agendado a esa hora — no lo duplico."
            }

            // PASO 5: Offsets + notas custom.
            //   "X min antes" → offset.
            //   "X min antes de Y" → offset + note "Y" (acción concreta que
            //   el user quiere recordar; va anclada al evento padre).
            // PRIORIDAD: el offset/nota PRE-EXTRAÍDO del SEGMENTO de este
            // evento (parseAll lo inyecta por-segmento). Solo si no vino
            // (single-intent o caller que no pasó por parseAll) extraemos del
            // userText completo. Esto arregla el bug multi-evento donde el
            // primer offset del texto se aplicaba a TODOS los eventos.
            let extractedOffsets: [Int]?
            let extractedNotes: [String]?
            if let segOffset = segReminderOffset {
                extractedOffsets = [segOffset]
                extractedNotes = (segReminderNote?.isEmpty == false) ? [segReminderNote!] : nil
            } else if !isMultiIntent, let detail = NovaActionNormalizer.extractReminderOffsetAndNote(from: userText) {
                extractedOffsets = [detail.offsetMinutes]
                if let note = detail.note, !note.isEmpty {
                    extractedNotes = [note]
                } else {
                    extractedNotes = nil
                }
            } else {
                extractedOffsets = nil
                extractedNotes = nil
            }

            // PASO 6: si hay recurrencia, calcular las fechas de las N
            // ocurrencias futuras y crear un evento por cada una. Estable
            // para beta: NO usa modelo de recurrencia real (cada evento
            // es independiente). Pro: ediciones individuales sin lógica
            // de "este evento o toda la serie". Contra: si el usuario
            // quiere cancelar la serie completa, hoy hay que borrar uno
            // por uno. Aceptable para beta v1.
            let occurrences: [Date]
            if let recurrence {
                occurrences = expandLocalRecurrenceDates(start: date, recurrence: recurrence)
            } else {
                occurrences = [date]
            }

            let sourceHour = cal.component(.hour, from: date)
            let sourceMinute = cal.component(.minute, from: date)
            var planned: [FocusEvent] = []
            for candidate in occurrences {
                guard let startDate = NovaTimeFormatter.civilDate(on: candidate, hour: sourceHour, minute: sourceMinute, calendar: cal) else {
                    return "No pude guardar la serie: una hora no existe o se repite por el cambio de horario. Elige otra hora."
                }
                let duration = end.timeIntervalSince(date)
                planned.append(FocusEvent(title: title, startTime: startDate,
                    endTime: startDate.addingTimeInterval(duration), section: effectiveSection,
                    location: location, isReminder: isReminderFlag, inferredDuration: inferredFlag,
                    reminderOffsets: extractedOffsets, reminderNotes: extractedNotes, subtitle: eventSubtitle))
            }
            guard let created = commitPreparedNovaEvents(planned) else {
                return "No pude guardar la serie. No añadí ninguno de esos eventos. Inténtalo de nuevo."
            }
            guard let firstEventId = created.first?.id else { return "Ya tenías esas ocurrencias en tu agenda." }
            updateNovaContext(
                from: userText,
                title: title,
                date: date,
                location: location,
                section: effectiveSection,
                kind: .event,
                eventId: firstEventId
            )
            let timeLabel = DateFormatters.hourMinute.string(from: date)
            let dayLabel: String = {
                if cal.isDateInToday(date) { return "hoy" }
                if cal.isDateInTomorrow(date) { return "mañana" }
                return "el \(DateFormatters.weekdayDay.string(from: date).lowercased())"
            }()
            // Texto base de confirmación.
            let recurrenceBit: String
            if let recurrence, occurrences.count > 1 {
                recurrenceBit = " (\(recurrence.label), \(occurrences.count) próximas)"
            } else {
                recurrenceBit = ""
            }
            // Copy unificado: "bloque" en vez de mezclar "recordatorio" /
            // "evento". El chip 🔔 dentro del bloque comunica el offset.
            if let mins = extractedOffsets?.first {
                let offsetLabel = mins < 60
                    ? "\(mins) min antes"
                    : (mins % 60 == 0 ? "\(mins/60) h antes" : "\(mins/60) h \(mins%60) min antes")
                if let note = extractedNotes?.first, !note.isEmpty {
                    return "Listo. Te dejé «\(title)» \(dayLabel) a las \(timeLabel)\(recurrenceBit) con un aviso guardado \(offsetLabel) para «\(note)»."
                }
                return "Listo. Te dejé «\(title)» \(dayLabel) a las \(timeLabel)\(recurrenceBit) con aviso \(offsetLabel)."
            }
            return "Listo. Te dejé «\(title)» \(dayLabel) a las \(timeLabel)\(recurrenceBit)."

        case .createTask(let rawTitle, let dueDate, _, let wantsReminder):
            // Mismo pipeline de limpieza para tareas.
            let title = NovaActionNormalizer.cleanTitle(rawTitle)
            guard !title.isEmpty else { return nil }
            // SOLO-EVENTOS (fix 2026-08-10): con tasksEnabled=false,
            // `addTask` es no-op — pero este path seguía respondiendo
            // "Anoto «X» como tarea" y el ítem no existía en ninguna
            // superficie (misma familia del bug chat→Mi Día: Nova afirma
            // algo que no quedó guardado). Mismo redirect que Mi Día
            // inline: pedimos la hora y dejamos pending para que el
            // follow-up ("a las 5") lo cree como evento real.
            guard FocusConfig.tasksEnabled else {
                setPendingClarification(PendingClarification(
                    originalInput: userText,
                    kind: wantsReminder ? .reminder : .event,
                    proposedTitle: title,
                    proposedDate: dueDate,
                    proposedSection: NovaResponder.guessSection(for: userText),
                    wantsReminder: wantsReminder,
                    missingFields: [.time],
                    questionAsked: "¿A qué hora lo agendo?",
                    source: .novaChat
                ))
                return "¿A qué hora agendo «\(title)»? Dime la hora y lo dejo como bloque en tu día."
            }
            let category: TaskCategory = {
                guard let dueDate else { return .hoy }
                let cal = Calendar.current
                if cal.isDateInToday(dueDate) { return .hoy }
                if let diff = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: dueDate)).day,
                   diff >= 1 && diff <= 7 { return .semana }
                return .algunDia
            }()
            let dateOnly = dueDate.map { Calendar.current.startOfDay(for: $0) }
            if tasks.contains(where: { !$0.done && NovaResponder.normalizeForFuzzy($0.title) == NovaResponder.normalizeForFuzzy(title) && $0.dueDate == dateOnly }) {
                return "Ya tenías «\(title)» en tus pendientes."
            }
            let task = FocusTask(title: title, priority: .media, category: category, dueDate: dateOnly)
            guard addTask(task) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            updateNovaContext(from: userText, title: title, date: dueDate, kind: .task, taskId: task.id)
            let dueBit: String = {
                guard let dueDate else { return "" }
                let cal = Calendar.current
                if cal.isDateInToday(dueDate) { return " para hoy" }
                if cal.isDateInTomorrow(dueDate) { return " para mañana" }
                return " para el " + DateFormatters.weekdayDay.string(from: dueDate).lowercased()
            }()
            let remBit = wantsReminder ? " Dime una hora si quieres recibir un aviso." : ""
            return "Anoto «\(title)»\(dueBit) como tarea.\(remBit)"

        case .correctLastEvent(let modifier):
            guard let eventId = novaContext.lastEventId,
                  var event = events.first(where: { $0.id == eventId }) else {
                return "Para corregir necesito un evento reciente como referencia. Dime el nombre del evento que quieres cambiar (ej. «mueve fútbol a las 6») y lo edito directo."
            }
            let cal = Calendar.current
            switch modifier {
            case .shiftDays(let offset):
                if let newStart = cal.date(byAdding: .day, value: offset, to: event.startTime) {
                    event.startTime = newStart
                }
                if let oldEnd = event.endTime,
                   let newEnd = cal.date(byAdding: .day, value: offset, to: oldEnd) {
                    event.endTime = newEnd
                }
            case .setTime(let h, let m):
                let day = cal.startOfDay(for: event.startTime)
                guard let newStart = NovaTimeFormatter.civilDate(on: day, hour: h, minute: m, calendar: cal) else {
                    return "No pude guardar esa hora: no existe o se repite por el cambio de horario. Elige otra hora."
                }
                do {
                    // Preservar la naturaleza del evento al cambiar la hora.
                    // Antes: `endTime = newStart + 1h` SIEMPRE — convertía un
                    // recordatorio puntual ("dentista a las 4") en bloque de
                    // 1h apenas el usuario dijera "muévelo a las 6". Mismo
                    // fix que aplicamos en MiDiaView.correctLastEvent.
                    let oldStart = event.startTime
                    let wasPointInTime = event.displayAsPointInTime
                    event.startTime = newStart
                    if wasPointInTime {
                        event.endTime = cal.date(byAdding: .minute, value: 5, to: newStart)
                    } else if let oldEnd = event.endTime {
                        let delta = oldEnd.timeIntervalSince(oldStart)
                        event.endTime = newStart.addingTimeInterval(delta)
                    }
                }
            case .setLocation(let loc):
                event.location = loc
            case .setTitle(let newTitle):
                event.title = newTitle
            }
            guard updateEvent(event) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            updateNovaContext(
                from: userText,
                title: event.title,
                date: event.startTime,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let timeLabel = DateFormatters.hourMinute.string(from: event.startTime)
            let dayLabel = DateFormatters.weekdayDay.string(from: event.startTime).lowercased()
            return "Listo, moví «\(event.title)» al \(dayLabel) \(timeLabel)."

        case .convertLastToTask:
            let title = novaContext.lastTitle ?? "Nueva tarea"
            let task = FocusTask(title: title, priority: .media, category: .hoy)
            guard addTask(task) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            if let eventId = novaContext.lastEventId {
                guard deleteEvent(eventId) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            }
            updateNovaContext(from: userText, title: title, kind: .task, taskId: task.id)
            return "Lo paso a tareas. «\(title)» quedó en tus pendientes de hoy."

        case .deleteLastItem:
            if let eventId = novaContext.lastEventId,
               let event = events.first(where: { $0.id == eventId }) {
                let title = event.title
                guard deleteEvent(eventId) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
                clearNovaContext()
                return "Eliminado. «\(title)» se borró del calendario."
            }
            if let taskId = novaContext.lastTaskId,
               let task = tasks.first(where: { $0.id == taskId }) {
                let title = task.title
                guard deleteTask(taskId) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
                clearNovaContext()
                return "Eliminada. «\(title)» se borró de pendientes."
            }
            return "Para borrar el último ítem necesito un evento o tarea reciente como referencia. Si quieres borrar algo específico, dime «borra X» y lo encuentro por su nombre."

        case .deleteEventByActivity(let activity):
            // Buscar evento por título aproximado. Si no aparece, devolver
            // mensaje honesto en vez de crear basura.
            if let event = NovaResponder.findEventByApproxTitle(activity, in: events) {
                let title = event.title
                guard deleteEvent(event.id) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
                clearNovaContext()
                return "Eliminado. «\(title)» se borró del calendario."
            }
            return "Busqué «\(activity)» y no lo veo en tu agenda. ¿Lo tienes con otro nombre? Si me dices el título exacto lo borro. También puedes revisar el Calendario para ver tus bloques."

        case .attachReminderToEvent(let activity, let offsetMinutes, let note):
            // Atribuir el aviso al evento existente. Si no encuentra match,
            // mensaje claro — NO crear evento nuevo (era el bug que
            // generaba duplicados).
            guard let event = NovaResponder.findEventByApproxTitle(activity, in: events) else {
                let offsetLabel = offsetMinutes < 60 ? "\(offsetMinutes) min antes" : "\(offsetMinutes/60) h antes"
                return "Para ponerle aviso a «\(activity)» primero necesito ese evento en tu agenda. Si me das día y hora lo creo y le pongo el aviso \(offsetLabel) de una. Ej: «agenda \(activity) mañana a las 18 con aviso \(offsetLabel)»."
            }
            // Reemplazar offsets — no acumular. Si el user dice "30 min antes",
            // queremos UNA notif a -30 min, no las viejas + la nueva.
            // `syncLocalNotification` cancela las pendientes anteriores por id
            // antes de programar la nueva, así que no hay duplicados.
            var updated = event
            updated.reminderOffsets = [offsetMinutes]
            if let note, !note.isEmpty {
                updated.reminderNotes = [note]
            } else {
                updated.reminderNotes = nil
            }
            guard updateEvent(updated) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            updateNovaContext(
                from: userText,
                title: event.title,
                date: event.startTime,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let offsetLabel = offsetMinutes < 60
                ? "\(offsetMinutes) min antes"
                : (offsetMinutes % 60 == 0 ? "\(offsetMinutes/60) h antes" : "\(offsetMinutes/60) h \(offsetMinutes%60) min antes")
            if let note, !note.isEmpty {
                return "Guardé un aviso \(offsetLabel) de «\(event.title)» para «\(note)»."
            }
            return "Guardé un aviso \(offsetLabel) de «\(event.title)»."

        case .rescheduleEventByActivity(let activity, let hour, let minute):
            // Buscar evento existente; si no aparece NO creamos uno nuevo
            // (era el bug). Devolver mensaje claro al usuario.
            guard let event = NovaResponder.findEventByApproxTitle(activity, in: events) else {
                let timeStr = String(format: "%02d:%02d", hour, minute)
                return "No tengo «\(activity)» en tu agenda como para moverlo. ¿Quieres que lo cree nuevo a las \(timeStr)? Dime «agenda \(activity) hoy a las \(timeStr)» y lo dejo listo."
            }
            // Construir la nueva fecha — mismo día que el evento original.
            let cal = Calendar.current
            let originalStart = event.startTime
            guard let newStart = cal.date(
                bySettingHour: hour, minute: minute, second: 0, of: originalStart
            ) else {
                return "Hubo un detalle con la hora. ¿Puedes decírmela en formato 24h, por ejemplo «a las 17:00»? Así muevo «\(event.title)» sin problema."
            }
            // Si el evento tiene endTime, conservar la duración.
            let newEnd: Date?
            if let oldEnd = event.endTime {
                let duration = oldEnd.timeIntervalSince(originalStart)
                newEnd = newStart.addingTimeInterval(duration)
            } else {
                newEnd = nil
            }
            // Aplicar la edición vía updateEvent (preserva id y sync).
            var updated = event
            updated.startTime = newStart
            if let newEnd = newEnd {
                updated.endTime = newEnd
            }
            guard updateEvent(updated) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            updateNovaContext(
                from: userText,
                title: event.title,
                date: newStart,
                location: event.location,
                section: event.section,
                kind: .event,
                eventId: event.id
            )
            let timeLabel = DateFormatters.hourMinute.string(from: newStart)
            return "Listo. Moví «\(event.title)» a las \(timeLabel)."

        case .organizeDay:
            // Análisis REAL del día — no inventamos sugerencias genéricas.
            // Si no hay datos suficientes para una recomendación verdadera,
            // contestamos con un resumen y NO ensuciamos la Bandeja.
            return summarizeAndSuggest(forDayOrganization: userText)

        case .reviewPending:
            let allPending = pendingTodayTasks
            // Filtro por tema si el usuario lo indicó ("...de la universidad",
            // "...del trabajo", "...de la casa"). Usamos keywords fuzzy contra
            // el title + notes de cada tarea.
            let topicKeywords = NovaResponder.topicKeywords(in: userText.lowercased())
            let pending: [FocusTask]
            let topicLabel: String?
            if let kw = topicKeywords {
                topicLabel = kw.label
                pending = allPending.filter { task in
                    let haystack = (task.title + " " + (task.notes ?? "")).lowercased()
                    return kw.keywords.contains { haystack.contains($0) }
                }
            } else {
                topicLabel = nil
                pending = allPending
            }
            if pending.isEmpty {
                if let label = topicLabel {
                    return "No tienes pendientes de \(label) en tu lista de hoy. ¿Quieres que te muestre todas las tareas pendientes, o agrego algo nuevo?"
                }
                return "Tu lista de pendientes de hoy está limpia. Buen momento para enfocarte en algo importante — dime si quieres que organicemos lo que viene."
            }
            let preview = pending.prefix(5).map { "• \($0.title)" }.joined(separator: "\n")
            let count = pending.count
            let header: String
            if let label = topicLabel {
                header = count == 1
                    ? "Tienes 1 pendiente de \(label):"
                    : "Tienes \(count) pendientes de \(label):"
            } else {
                header = count == 1
                    ? "Tienes 1 pendiente hoy:"
                    : "Tienes \(count) pendientes hoy:"
            }
            return "\(header)\n\(preview)"

        case .reviewToday:
            // Eventos visibles para el usuario — incluye demo en modo demo.
            // Sin esto, la primera experiencia del usuario nuevo era:
            // ve 3 eventos en Mi Día (los demos) pero Nova responde
            // "nada agendado" — contradicción confusa que rompe la beta.
            let evts: [FocusEvent]
            if hasUserEvents {
                evts = todayEvents().sorted { $0.startTime < $1.startTime }
            } else if isInDemoMode {
                evts = DemoDataProvider.shared.exampleTodayEvents()
                    .filter { !dismissedDemoEventTitles.contains($0.title) }
                    .sorted { $0.startTime < $1.startTime }
            } else {
                evts = []
            }
            let pending = pendingTodayTasks
            if evts.isEmpty && pending.isEmpty {
                return "Tu día está despejado. Si quieres armar un plan, dime qué tienes en mente y lo agendamos. También puedo crearte una tarea rápida si hay algo pendiente."
            }
            let fmt = DateFormatter()
            fmt.dateFormat = "HH:mm"
            fmt.locale = Locale(identifier: "es")
            var lines: [String] = []
            for e in evts {
                lines.append("• \(fmt.string(from: e.startTime)) — \(e.title)")
            }
            if !pending.isEmpty {
                let label = pending.count == 1 ? "1 tarea pendiente" : "\(pending.count) tareas pendientes"
                lines.append("+ \(label)")
            }
            let header = evts.count == 1 ? "Tienes 1 evento hoy:" : "Tienes \(evts.count) eventos hoy:"
            return "\(header)\n\(lines.joined(separator: "\n"))"

        case .askAboutDemo:
            return "Los ejemplos solo aparecen mientras no tengas datos tuyos. Apenas creas tu primer evento o tarea, se reemplazan automáticamente."

        case .annotateTaskCorrection(let subject, let correctionNote):
            // Fuzzy match contra todas las tareas activas. Si encontramos
            // 1 sola → update notes. Si encontramos varias → mencionamos
            // las opciones para que el usuario elija (no editamos a ciegas).
            let activeTasks = tasks.filter { !$0.done }
            let subjectLower = subject.lowercased()
                .trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?"))
            let matches = activeTasks.filter { task in
                let haystack = task.title.lowercased() + " " + (task.notes ?? "").lowercased()
                // Match si TODO token del subject aparece en haystack.
                let tokens = subjectLower.split(separator: " ").filter { $0.count >= 3 }
                guard !tokens.isEmpty else {
                    return haystack.contains(subjectLower)
                }
                return tokens.allSatisfy { haystack.contains($0) }
            }
            if matches.isEmpty {
                return "Busqué una tarea sobre «\(subject)» y no la veo en tu lista. ¿Quieres que la cree con esa corrección anotada? Dime «crea tarea \(subject)» y la dejo lista."
            }
            if matches.count > 1 {
                let titles = matches.prefix(3).map { "• \($0.title)" }.joined(separator: "\n")
                return "Tengo varias tareas relacionadas con «\(subject)»:\n\(titles)\n¿En cuál anoto la corrección? Dime el título tal como aparece."
            }
            var task = matches[0]
            let existing = task.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            task.notes = existing.isEmpty
                ? correctionNote
                : "\(existing)\n\(correctionNote)"
            guard updateTask(task) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
            return "Listo, anoté la corrección en «\(task.title)»: \(correctionNote)"

        case .annotateDependency(let prerequisite, let dependent):
            // Buscamos las 2 tareas. Anotamos en la dependiente que
            // "primero hay que X". No reordenamos automáticamente.
            let activeTasks = tasks.filter { !$0.done }
            let prereqMatches = activeTasks.filter { task in
                let h = task.title.lowercased() + " " + (task.notes ?? "").lowercased()
                return prerequisite.lowercased().split(separator: " ")
                    .filter { $0.count >= 3 }
                    .allSatisfy { h.contains($0) }
            }
            let dependentMatches = activeTasks.filter { task in
                let h = task.title.lowercased() + " " + (task.notes ?? "").lowercased()
                return dependent.lowercased().split(separator: " ")
                    .filter { $0.count >= 3 }
                    .allSatisfy { h.contains($0) }
            }
            if let dep = dependentMatches.first {
                var task = dep
                let prereqNote = "Primero: \(prerequisite)."
                let existing = task.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                task.notes = existing.isEmpty ? prereqNote : "\(existing)\n\(prereqNote)"
                guard updateTask(task) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
                let prereqFound = prereqMatches.first != nil
                if prereqFound {
                    return "Anotado. Antes de «\(dep.title)» va «\(prerequisite)»."
                }
                return "Anotado en «\(dep.title)»: primero «\(prerequisite)»."
            }
            return "Para anotar la dependencia necesito tener «\(dependent)» como tarea. Si quieres, dime «crea tarea \(dependent)» y de inmediato le agrego que primero va «\(prerequisite)»."

        case .proposeActionPlan(let actions):
            // Guardar la propuesta para que el siguiente "sí, agrégalo"
            // la ejecute. NO crear nada hasta confirmación explícita —
            // la regla de producto es que textos largos no se ejecutan solos.
            novaContext.pendingActionPlan = actions
            novaContext.updatedAt = Date()
            let bullets = actions.enumerated().map { idx, action in
                "\(idx + 1). \(action.title)"
            }.joined(separator: "\n")
            let count = actions.count
            return "Entendí \(count) acciones. Te las puedo organizar como tareas:\n\(bullets)\n\n¿Las agrego a tu lista? Responde «sí, agrégalas» y las creo."

        case .confirmActionPlan:
            guard let plan = novaContext.pendingActionPlan, !plan.isEmpty else {
                return "No tengo una lista propuesta esperando confirmación. Pégame tus acciones (una por línea) y te las organizo como tareas listas para confirmar."
            }
            // Decidir distribución según userText:
            //   "para hoy y mañana" → primera mitad hoy, segunda mañana
            //   "para mañana" → todas mañana
            //   "para hoy" / "sí, agrégalas" / default → todas hoy
            let lower = userText.lowercased()
            enum PlanDistribution { case allToday, allTomorrow, splitTodayTomorrow }
            let distribution: PlanDistribution
            if lower.contains("para hoy y mañana") || lower.contains("para hoy y manana")
                || lower.contains("entre hoy y mañana") || lower.contains("entre hoy y manana")
                || lower.contains("repart") || lower.contains("distribu") {
                distribution = .splitTodayTomorrow
            } else if (lower.contains("para mañana") || lower.contains("para manana"))
                       && !(lower.contains("para hoy")) {
                distribution = .allTomorrow
            } else {
                distribution = .allToday
            }
            let cal = Calendar.current
            let tomorrowDate = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Date()))
            let splitAt: Int = {
                guard distribution == .splitTodayTomorrow else { return plan.count }
                return Int(ceil(Double(plan.count) / 2.0))
            }()
            var todayTitles: [String] = []
            var tomorrowTitles: [String] = []
            for (idx, action) in plan.enumerated() {
                let subtasksModels = action.subtasks
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .map { FocusSubtask(title: $0) }
                let goesTomorrow: Bool
                switch distribution {
                case .allToday:           goesTomorrow = false
                case .allTomorrow:        goesTomorrow = true
                case .splitTodayTomorrow: goesTomorrow = idx >= splitAt
                }
                let category: TaskCategory = goesTomorrow ? .semana : .hoy
                let dueDate: Date? = goesTomorrow ? tomorrowDate : nil
                let task = FocusTask(
                    title: action.title,
                    notes: action.notes,
                    priority: action.priority,
                    category: category,
                    dueDate: dueDate,
                    subtasks: subtasksModels
                )
                guard addTask(task) else { return "No pude guardar este cambio. Inténtalo de nuevo." }
                if goesTomorrow {
                    tomorrowTitles.append(action.title)
                } else {
                    todayTitles.append(action.title)
                }
            }
            novaContext.pendingActionPlan = nil
            novaContext.updatedAt = Date()
            switch distribution {
            case .allToday:
                return plan.count == 1
                    ? "Listo, creé 1 tarea en tu lista de hoy."
                    : "Listo, creé \(plan.count) tareas en tu lista de hoy. Dime si quieres mover alguna a otra fecha."
            case .allTomorrow:
                return plan.count == 1
                    ? "Listo, dejé 1 tarea para mañana."
                    : "Listo, dejé \(plan.count) tareas para mañana."
            case .splitTodayTomorrow:
                let hoyList = todayTitles.map { "• \($0)" }.joined(separator: "\n")
                let mañList = tomorrowTitles.map { "• \($0)" }.joined(separator: "\n")
                return "Las repartí entre hoy y mañana:\nHoy:\n\(hoyList)\n\nMañana:\n\(mañList)"
            }

        case .smallTalk(let reply):
            return reply

        case .clarify:
            // No short-circuit en clarify — el caller decide si llamar al
            // backend para que pregunte mejor o usar el local responder.
            return nil
        }
    }

    /// Construye un PendingClarification para el chat a partir de un
    /// ClarifyReason del parser local. Espejo de `buildPendingClarification`
    /// de MiDiaView, pero con `source: .novaChat`.
    private func buildChatPendingClarification(
        from reason: NovaIntent.ClarifyReason,
        userText: String
    ) -> PendingClarification? {
        let lower = userText.lowercased()
        let wantsReminder = lower.contains("acu") || lower.contains("recu")
        let section = NovaResponder.guessSection(for: userText)
        switch reason {
        case .eventNeedsTime(let title, let date):
            return PendingClarification(
                originalInput: userText,
                kind: wantsReminder ? .reminder : .event,
                proposedTitle: title,
                proposedDate: date,
                proposedSection: section,
                wantsReminder: wantsReminder,
                missingFields: [.time],
                questionAsked: "¿A qué hora?",
                source: .novaChat
            )
        case .eventNeedsDateTime(let title):
            return PendingClarification(
                originalInput: userText,
                kind: wantsReminder ? .reminder : .event,
                proposedTitle: title,
                proposedDate: nil,
                proposedSection: section,
                wantsReminder: wantsReminder,
                missingFields: [.date, .time],
                questionAsked: "¿Para qué día y hora?",
                source: .novaChat
            )
        case .taskNeedsTitle, .eventNeedsTitle, .noContext, .unclear:
            return nil
        }
    }

    @MainActor
    private func fallbackNoteForChat(error: NovaServiceError) -> String? {
        // Política 2026-06-13 (user spec): el fallback local estando LOGUEADO
        // NUNCA debe ser silencioso. Antes los errores de servidor
        // (timeout/serviceUnavailable/server/...) devolvían nil → parecía que
        // Nova funcionó cuando en realidad cayó al parser local. Ahora SIEMPRE
        // mostramos una nota honesta que deja claro que se usó el respaldo
        // local, no la IA real. El texto vive en NovaServiceError.
        // emptyMessage/messageTooLong no llegan acá (no hacen fallback).
        let note = error.loggedInFallbackNote
        return note.isEmpty ? nil : "(\(note))"
    }

    func runQuickAction(_ action: NovaQuickAction) { sendNovaMessage(action.userText) }

    // MARK: - Memoria (comandos directos de chat)

    /// Genera el texto de confirmación humano cuando Nova ACABA de
    /// aprender una memoria. La idea es que el user sienta "ah, lo
    /// recordó" sin tener que ver acción técnica. Cada categoría usa
    /// formato distinto para que se lea natural.
    func replyForLearnedMemory(_ memory: NovaMemory) -> String {
        switch memory.category {
        case .personAlias:
            // value tiene formato "Nombre (rol)" o "Nombre". Extraemos
            // el rol para frase natural si está disponible.
            if let openParen = memory.value.firstIndex(of: "("),
               let closeParen = memory.value.lastIndex(of: ")") {
                let name = memory.value[..<openParen]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let role = memory.value[memory.value.index(after: openParen)..<closeParen]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if role.lowercased().hasPrefix("mi ") {
                    // "mi coordinador" / "mi hijo" — ya viene con posesivo.
                    return "Listo, guardé que \(name) es \(role.lowercased())."
                } else {
                    // "coordinador" / "polola" — agregamos "tu".
                    return "Listo, guardé que \(name) es tu \(role.lowercased())."
                }
            }
            return "Listo, guardé que \(memory.value) es persona conocida."
        case .courseAlias:
            return "Listo, ya sé que cuando digas «\(memory.key)» te refieres a \(memory.value)."
        case .preference:
            return "Anotado. Lo tomo en cuenta para próximas sugerencias."
        case .schedulingRule:
            return "Listo, voy a respetar esa regla cuando agende cosas."
        case .appBehaviorRule:
            return "Listo, lo aplico de ahora en adelante."
        case .projectContext:
            return "Listo, lo agrego al contexto de tus proyectos."
        case .academicContext:
            return "Listo, lo guardo en tu contexto académico."
        }
    }

    /// Si `trimmed` es un comando directo sobre la memoria de Nova
    /// ("qué sabes de mí", "qué recuerdas", "olvida X", "olvida todo"),
    /// devuelve el reply listo para mostrar. Caller debería abortar el
    /// procesamiento normal y mostrar este texto.
    ///
    /// Devuelve `nil` si NO es un comando de memoria → caller continúa
    /// con parse/backend normal.
    func handleMemoryCommand(trimmed: String) -> String? {
        let lower = trimmed.lowercased()

        // 1) Lectura: "¿qué sabes de mí?" / "qué recuerdas" / "muéstrame tu memoria"
        let readPatterns = [
            "qué sabes de mí", "que sabes de mi", "qué sabes de mi",
            "qué recuerdas", "que recuerdas",
            "muéstrame tu memoria", "muestrame tu memoria",
            "qué tienes guardado", "que tienes guardado",
            "qué tienes en memoria", "que tienes en memoria"
        ]
        if readPatterns.contains(where: { lower.contains($0) }) {
            guard settings.novaMemoryEnabled else { return "La memoria está desactivada. Puedes activarla en Ajustes." }
            let memories = NovaMemoryStore.shared.allActiveMemoriesHuman(maxEntries: 20)
            guard !memories.isEmpty else {
                return "Todavía no tengo nada guardado. Cuéntame cosas sobre ti — quiénes son las personas importantes, qué ramos llevas, qué prefieres — y voy memorizando."
            }
            let bullets = memories.map { "• \($0.text)" }.joined(separator: "\n")
            return "Esto es lo que recuerdo de ti:\n\(bullets)\n\nSi algo está mal o ya no aplica, dime «olvida X»."
        }

        // 2) Borrado individual: "olvida X" / "olvídate de X" / "borra de tu memoria X"
        let forgetPatterns: [String] = [
            #"^olvid[aá](?:te de)?\s+(.+)$"#,
            #"^borra de tu memoria\s+(.+)$"#,
            #"^quita de tu memoria\s+(.+)$"#,
            #"^elimina de tu memoria\s+(.+)$"#
        ]
        for pattern in forgetPatterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let ns = trimmed as NSString
            let range = NSRange(location: 0, length: ns.length)
            guard let match = regex.firstMatch(in: trimmed, range: range),
                  match.numberOfRanges >= 2 else { continue }
            let target = ns.substring(with: match.range(at: 1))
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡ "))
            // Caso especial: "olvida todo" / "todo" → clear all.
            if ["todo", "todas", "toda", "todos"].contains(target.lowercased()) {
                let action = BackendAction.forgetMemory(key: "__all__")
                novaPendingProposal = NovaPendingProposal(summary: "Confirma si quieres borrar tus memorias.",
                    actionLabels: ["Olvidar todas las memorias guardadas"], actions: [action], localIntents: [],
                    userText: trimmed, generation: accountGeneration,
                    reviewedMemories: NovaMemoryStore.shared.activeMemories)
                return "Revisa y confirma si quieres olvidar todas las memorias guardadas."
            }
            // Buscar memorias cuya key o value contenga `target`.
            let lowerTarget = target.lowercased()
            let matches = NovaMemoryStore.shared.allActiveMemoriesHuman(maxEntries: 100)
                .filter { $0.text.lowercased().contains(lowerTarget) }
            guard !matches.isEmpty else {
                return "No tengo nada guardado sobre «\(target)»."
            }
            for m in matches {
                NovaMemoryStore.shared.deactivate(id: m.id)
                if !NovaMemoryStore.shared.lastPersistenceSucceeded { return "No pude guardar el borrado de memoria. Inténtalo de nuevo." }
            }
            let label = matches.count == 1 ? "una memoria" : "\(matches.count) memorias"
            return "Listo, olvidé \(label) relacionada\(matches.count == 1 ? "" : "s") con «\(target)»."
        }

        return nil
    }

    // MARK: - Ajustes

    @discardableResult
    func updateSettings(_ mutator: (inout AppSettings) -> Void) -> Bool {
        let before = settings.remindersEnabled
        var copy = settings
        mutator(&copy)
        // One canonical reminder preference; the legacy mirror remains encoded
        // for compatibility with previous versions and imported settings.
        copy.notificationsEnabled = copy.remindersEnabled
        guard FocusLocalStore.saveSync(copy, forKey: .settings) else {
            localSaveError = "No pudimos guardar el ajuste. Revisa el espacio disponible en tu iPhone e inténtalo de nuevo."
            HapticManager.shared.warning()
            return false
        }
        localSaveError = nil
        settings = copy
        if !settings.remindersEnabled { notificationPermissionDenied = false }
        HapticManager.shared.tick()
        if before != settings.remindersEnabled {
            if settings.remindersEnabled {
                resyncAllLocalNotifications()
            } else {
                let generation = accountGeneration
                Task { [weak self] in
                    guard let self, self.accountGeneration == generation,
                          !self.settings.remindersEnabled else { return }
                    await LocalNotificationService.shared.cancelAllReminders()
                }
            }
        }
        return true
    }

    // MARK: - Reset / borrar datos locales

    /// Vuelve al estado inicial con datos de ejemplo (in-memory + disk).
    /// Equivale a "como cuando instalaste la app por primera vez".
    /// **Importante**: NO pre-seedeamos sugerencias en el store. Las demos
    /// vuelven a aparecer como fallback dinámico vía `displaySuggestions`.
    /// También se limpian los descartes de demo — al restablecer, los
    /// ejemplos vuelven a estar visibles.
    func resetToDemoState() {
        clearAllLocalData()
    }

    /// Clears the active partition only, including memory, widget state and
    /// pending writes. Other accounts and unassigned recovery data stay isolated.
    func clearAllLocalData() {
        accountGeneration = UUID()
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
        cancelNovaRequest()
        FocusLocalStore.clearAll()
        NovaMemoryStore.shared.clearAll()
        events = []
        tasks = []
        outbox = FocusSyncOutbox()
        recoveryEventIDs = [:]
        recoveryTaskIDs = [:]
        novaAppliedActionIDs = []
        refreshPendingDeletes()
        suggestions = []
        novaMessages = []
        settings = .defaults
        novaContext = NovaContext()
        systemEvents = []
        dismissedDemoEventTitles = []
        dismissedDemoTaskTitles = []
        lastSyncAt = nil
        notificationPermissionDenied = false
        syncState = syncCredentials == nil ? .demo : .idle
        syncWidgetSnapshot()
        Task { await LocalNotificationService.shared.cancelAllReminders() }
        HapticManager.shared.success()
    }

}

/// Memoria persistente de Nova — versión local (UserDefaults) que se
/// usa antes de implementar tabla Supabase. Guarda preferencias, alias
/// y reglas útiles del usuario que mejoran futuras interpretaciones.
///
/// Diseño: tipo enum-categorizado + key/value. Cada `NovaMemory` tiene
/// categoría (preference, person_alias, course_alias, etc.), key (la
/// frase del usuario o el alias), value (la expansión / valor real),
/// timestamps y un flag isActive.
///
/// Persistencia: UserDefaults JSON-encoded array bajo
/// `focus.v1.nova.memories`. Tope ~200 entradas; al pasarlo, se
/// purgan las más antiguas inactivas. Migrable a Supabase en C5/C6
/// con misma forma.
///
/// NO guardar info sensible (salud, ubicación, financiero) salvo que
/// el usuario lo pida explícitamente. Por defecto los handlers que
/// agregan memorias filtran categorías permitidas.
enum NovaMemoryCategory: String, Codable, CaseIterable {
    case preference          // "prefiero pendientes sin hora"
    case personAlias         // "Juan Pablo = mi coordinador"
    case courseAlias         // "teorías = Teorías de la Comunicación"
    case projectContext      // "Focus, Kairos, Spark son mis proyectos"
    case schedulingRule      // "mis clases suelen ser en la mañana"
    case academicContext     // "mi universidad usa ramos"
    case appBehaviorRule     // "no inventes duración de 1 hora"
}

/// Una entrada de memoria persistente.
struct NovaMemory: Codable, Equatable, Identifiable {
    var id: UUID
    var category: NovaMemoryCategory
    /// Clave de búsqueda — keyword o frase que el usuario suele decir
    /// (ej. "teorías", "Juan Pablo", "fútbol"). Lowercased para match.
    var key: String
    /// Valor / expansión asociada (ej. "Teorías de la Comunicación",
    /// "Juan Pablo Barros, coordinador").
    var value: String
    /// 0.0–1.0. Cuándo viene de un alias explícito ("cuando diga X me
    /// refiero a Y") confidence = 1.0. Cuando viene de inferencia
    /// pasiva, < 1.0.
    var confidence: Double
    /// "user_explicit", "inferred", "system_default".
    var source: String
    var createdAt: Date
    var updatedAt: Date
    var lastUsedAt: Date?
    var isActive: Bool

    init(
        id: UUID = UUID(),
        category: NovaMemoryCategory,
        key: String,
        value: String,
        confidence: Double = 1.0,
        source: String = "user_explicit",
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        lastUsedAt: Date? = nil,
        isActive: Bool = true
    ) {
        self.id = id
        self.category = category
        self.key = key.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        self.value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        self.confidence = max(0, min(1, confidence))
        self.source = source
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastUsedAt = lastUsedAt
        self.isActive = isActive
    }
}

/// Store local de NovaMemory. Singleton para acceso desde
/// FocusDataStore. Persistencia inmediata en UserDefaults.
final class NovaMemoryStore {
    static let shared = NovaMemoryStore()

    private var userDefaultsKey: String { FocusLocalStore.scopedStorageKey(for: "focus.v1.nova.memories") }
    private let maxEntries = 200
    private var cache: [NovaMemory] = []
    private var committedCache: [NovaMemory] = []
    private(set) var lastPersistenceSucceeded = true

    private init() {
        loadFromDisk()
    }

    func reloadForCurrentAccount() {
        cache = []
        loadFromDisk()
    }

    // MARK: - CRUD básico

    /// Devuelve todas las memorias activas, ordenadas por recencia.
    var activeMemories: [NovaMemory] {
        cache.filter { $0.isActive }
            .sorted { ($0.lastUsedAt ?? $0.updatedAt) > ($1.lastUsedAt ?? $1.updatedAt) }
    }

    /// Inserta o actualiza una memoria por (category, key). Si ya existía
    /// una con la misma clave en la misma categoría, actualiza value +
    /// confidence (toma el mayor) + updatedAt. Devuelve la versión final.
    @discardableResult
    func upsert(_ memory: NovaMemory) -> NovaMemory {
        let normalizedKey = memory.key.lowercased()
        if let existingIdx = cache.firstIndex(where: {
            $0.category == memory.category && $0.key == normalizedKey
        }) {
            var existing = cache[existingIdx]
            existing.value = memory.value
            existing.confidence = max(existing.confidence, memory.confidence)
            existing.source = memory.source
            existing.updatedAt = Date()
            existing.isActive = true
            cache[existingIdx] = existing
            saveToDisk()
            return existing
        }
        let newMem = memory
        cache.insert(newMem, at: 0)
        purgeIfNeeded()
        saveToDisk()
        return newMem
    }

    /// Marca como inactiva (soft-delete). Para hard-delete usar `delete`.
    func deactivate(id: UUID) {
        guard let idx = cache.firstIndex(where: { $0.id == id }) else { return }
        cache[idx].isActive = false
        cache[idx].updatedAt = Date()
        saveToDisk()
    }

    func delete(id: UUID) {
        cache.removeAll { $0.id == id }
        saveToDisk()
    }

    func clearAll() {
        cache.removeAll()
        saveToDisk()
    }

    // MARK: - Búsqueda relevante

    /// Devuelve memorias cuya `key` aparece como substring en el texto
    /// dado (case-insensitive). Ordenadas por confidence × recencia.
    /// Usado para enriquecer el contexto al interpretar un mensaje.
    func relevantMemories(for text: String, limit: Int = 5) -> [NovaMemory] {
        let lower = text.lowercased()
        let matches = activeMemories.filter { mem in
            !mem.key.isEmpty && lower.contains(mem.key)
        }
        return Array(matches.prefix(limit))
    }

    /// Busca el value de una memoria por categoría + key exacta (lower).
    /// Útil para expandir un alias: "teorías" → "Teorías de la Comunicación".
    func valueFor(category: NovaMemoryCategory, key: String) -> String? {
        let normalized = key.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let match = cache.first {
            $0.isActive && $0.category == category && $0.key == normalized
        }
        if let match {
            touchLastUsed(id: match.id)
            return match.value
        }
        return nil
    }

    /// Marca una memoria como recientemente usada (mueve lastUsedAt).
    /// Usado por relevantMemories cuando una memoria informa una
    /// interpretación → la sube en el ranking.
    func touchLastUsed(id: UUID) {
        guard let idx = cache.firstIndex(where: { $0.id == id }) else { return }
        cache[idx].lastUsedAt = Date()
        // Capture and persist under the same account before a transition.
        saveToDisk()
    }

    // MARK: - Persistencia

    private func loadFromDisk() {
        if let saved = FocusLocalStore.load([NovaMemory].self, forKey: .novaMemories) {
            cache = saved
            committedCache = saved
            lastPersistenceSucceeded = true
            return
        }
        defer { committedCache = cache; lastPersistenceSucceeded = true }
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey) else {
            cache = []
            return
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            cache = try decoder.decode([NovaMemory].self, from: data)
        } catch {
            debugLog("[NovaMemory] load failed: \(error). Reset cache.")
            cache = []
        }
    }

    private func saveToDisk() {
        lastPersistenceSucceeded = FocusLocalStore.saveSync(cache, forKey: .novaMemories)
        if lastPersistenceSucceeded { committedCache = cache }
        else { cache = committedCache }
    }

    private func learn(_ memory: NovaMemory) -> NovaMemory? {
        let saved = upsert(memory)
        return lastPersistenceSucceeded ? saved : nil
    }

    /// Only relevant, bounded, non-sensitive context leaves this device.
    func contextForRequest(_ text: String) -> [String] {
        let stopWords: Set<String> = ["para", "como", "tengo", "quiero", "mañana", "hoy", "esta", "esto", "hacer", "puedes", "recuerda"]
        func tokens(_ value: String) -> Set<String> {
            Set(value.lowercased().folding(options: .diacriticInsensitive, locale: .current)
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { $0.count >= 4 && !stopWords.contains($0) })
        }
        let query = tokens(text)
        var remaining = 1600
        return activeMemories.filter {
            !NovaMemoryPrivacy.isSensitive($0.key + " " + $0.value)
                && !query.intersection(tokens($0.key + " " + $0.value)).isEmpty
        }.prefix(8).compactMap { memory in
            let line = String((memory.key + ": " + memory.value).prefix(240))
            guard line.count <= remaining else { return nil }
            remaining -= line.count
            return line
        }
    }

    private func purgeIfNeeded() {
        guard cache.count > maxEntries else { return }
        // Borrar inactivas más antiguas primero.
        cache.sort { (a, b) -> Bool in
            if a.isActive != b.isActive { return a.isActive }  // activas primero
            return a.updatedAt > b.updatedAt  // recientes primero
        }
        cache = Array(cache.prefix(maxEntries))
    }
}

// MARK: - Detección de alias en el texto del usuario

extension NovaMemoryStore {
    /// Intenta detectar si el usuario está enseñándole a Nova un alias
    /// con frases tipo:
    ///   "cuando diga teorías me refiero a Teorías de la Comunicación"
    ///   "Juan Pablo es mi coordinador"
    ///   "Urrutia es mi amigo"
    ///   "prefiero que los eventos sin hora queden como pendientes"
    ///
    /// Si detecta un alias claro, lo guarda y devuelve el NovaMemory
    /// creado. Sin coincidencia retorna nil — el caller deja seguir
    /// el flujo normal.
    @discardableResult
    func tryLearnFromUserText(_ text: String) -> NovaMemory? {
        lastPersistenceSucceeded = true
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, NovaMemoryPrivacy.canRemember(trimmed, userText: trimmed) else { return nil }
        let lower = trimmed.lowercased()

        // Patrón 1: "cuando diga X me refiero a Y" / "cuando digo X me refiero a Y"
        let pattern1 = #"cuando dig[oa]\s+(.+?)\s+me refiero a\s+(.+)$"#
        if let regex = try? NSRegularExpression(pattern: pattern1, options: [.caseInsensitive]),
           let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(trimmed.startIndex..., in: trimmed)
           ),
           match.numberOfRanges >= 3,
           let r1 = Range(match.range(at: 1), in: trimmed),
           let r2 = Range(match.range(at: 2), in: trimmed) {
            let key = String(trimmed[r1])
            let value = String(trimmed[r2])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            // Heurística para clasificar:
            // - si contiene "ramo/clase/curso/teoría/historia/lenguaje" → courseAlias
            // - si parece nombre propio → personAlias
            // - default → preference
            let cat: NovaMemoryCategory = inferCategoryFromValue(value, originalKey: key)
            return learn(NovaMemory(
                category: cat, key: key, value: value,
                confidence: 1.0, source: "user_explicit"
            ))
        }

        // Patrón 2: "X es mi Y" — "Juan Pablo es mi coordinador",
        // "Urrutia es mi amigo", "la agustina es mi polola",
        // "Cristina es mi novia".
        //
        // Tres condiciones para tratarlo como personAlias:
        //   (a) role en personRoles ampliada — cubre familia, pareja,
        //       trabajo, estudios, vecinos, mascotas.
        //   (b) O bien `key` empieza con "la "/"el " (típico chileno
        //       coloquial para nombres propios: "la Cata", "el Juan").
        //   (c) O bien `key` empieza con mayúscula (nombre propio claro).
        //
        // En cualquiera de los tres casos, strippeamos "la "/"el " del key
        // y lo capitalizamos antes de guardar.
        let pattern2 = #"^(.+?)\s+es mi\s+(.+)$"#
        if let regex = try? NSRegularExpression(pattern: pattern2, options: [.caseInsensitive]),
           let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(trimmed.startIndex..., in: trimmed)
           ),
           match.numberOfRanges >= 3,
           let r1 = Range(match.range(at: 1), in: trimmed),
           let r2 = Range(match.range(at: 2), in: trimmed) {
            let rawKey = String(trimmed[r1])
            let role = String(trimmed[r2])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))

            // Lista AMPLIADA de roles personales (Spanish + chileno).
            let personRoles: Set<String> = [
                // familia directa
                "papá", "papa", "mamá", "mama", "padre", "madre",
                "hermano", "hermana", "hijo", "hija",
                // familia extendida
                "tío", "tia", "tía", "tio", "primo", "prima",
                "abuelo", "abuela", "sobrino", "sobrina",
                "cuñado", "cuñada", "cunado", "cunada",
                "suegro", "suegra", "ahijado", "ahijada",
                // pareja
                "esposo", "esposa", "marido", "señora",
                "novio", "novia", "pareja",
                "polola", "pololo",  // chileno
                "compañero", "compañera",  // pareja informal
                // amistad
                "amigo", "amiga", "amix", "mejor amigo", "mejor amiga",
                "vecino", "vecina", "compadre", "comadre",
                // trabajo
                "jefe", "jefa", "coordinador", "coordinadora",
                "asesor", "asesora", "mentor", "mentora",
                "colega", "asistente", "secretario", "secretaria",
                "socio", "socia", "supervisor", "supervisora",
                // estudios
                "profesor", "profesora", "profe",
                "maestro", "maestra", "tutor", "tutora",
                // salud
                "doctor", "doctora", "psicólogo", "psicologa",
                "psicóloga", "psicologo", "kinesiólogo", "kinesiologo",
                "psiquiatra", "terapeuta",
                // mascotas
                "perro", "perra", "gato", "gata", "mascota"
            ]
            let roleLower = role.lowercased()
            // Match exacto del rol O substring (cubre "profesor de historia",
            // "mejor amiga del colegio", etc.).
            let isKnownRole = personRoles.contains(roleLower)
                || personRoles.contains { roleLower.hasPrefix($0 + " ") || roleLower.hasPrefix($0 + ",") }
                || personRoles.contains { roleLower.contains(" " + $0 + " ") || roleLower.hasSuffix(" " + $0) }

            // Strip "la "/"el " del key (chileno coloquial: "la Cata" → "Cata").
            let cleanKey: String = {
                var k = rawKey
                if let r = k.range(of: #"^(?:la|el|las|los)\s+"#,
                                    options: [.regularExpression, .caseInsensitive]) {
                    k = String(k[r.upperBound...])
                }
                return k.trimmingCharacters(in: .whitespacesAndNewlines)
            }()

            // Determinar si key parece nombre propio.
            let cleanKeyHadArticle = cleanKey != rawKey
            let keyStartsUpper = cleanKey.first?.isUppercase ?? false
            let looksLikePerson = isKnownRole || cleanKeyHadArticle || keyStartsUpper

            if looksLikePerson && !cleanKey.isEmpty {
                let displayName = cleanKey.prefix(1).uppercased() + cleanKey.dropFirst()
                return learn(NovaMemory(
                    category: .personAlias,
                    key: cleanKey.lowercased(),
                    value: "\(displayName) (\(role))",
                    confidence: 0.9, source: "user_explicit"
                ))
            }
        }

        // Patrón 3: "prefiero ..." → preference
        if lower.hasPrefix("prefiero ") || lower.hasPrefix("me gusta ") {
            return learn(NovaMemory(
                category: .preference, key: trimmed, value: trimmed,
                confidence: 0.8, source: "user_explicit"
            ))
        }

        // Patrón 4 (Phase 3 — 2026-05-27): "X se llama Y" / "Y se llama X"
        // Captura nombres propios. Ej: "mi mamá se llama Susana".
        let pattern4 = #"^(.+?)\s+se llama\s+(.+)$"#
        if let regex = try? NSRegularExpression(pattern: pattern4, options: [.caseInsensitive]),
           let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(trimmed.startIndex..., in: trimmed)
           ),
           match.numberOfRanges >= 3,
           let r1 = Range(match.range(at: 1), in: trimmed),
           let r2 = Range(match.range(at: 2), in: trimmed) {
            let entity = String(trimmed[r1])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            let name = String(trimmed[r2])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            // Si "entity" empieza con "mi/tu/su" → relación familiar/profesional.
            // Guardamos doble: nombre → entity, entity → nombre (resolución
            // bidireccional sencilla).
            return learn(NovaMemory(
                category: .personAlias,
                key: name.lowercased(),
                value: "\(name) (\(entity))",
                confidence: 0.95, source: "user_explicit"
            ))
        }

        // Patrón 5: "tengo un/una Y llamado/a X" — "tengo un hijo llamado Diego"
        let pattern5 = #"^tengo\s+(?:un|una)\s+(.+?)\s+llamad[oa]\s+(.+)$"#
        if let regex = try? NSRegularExpression(pattern: pattern5, options: [.caseInsensitive]),
           let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(trimmed.startIndex..., in: trimmed)
           ),
           match.numberOfRanges >= 3,
           let r1 = Range(match.range(at: 1), in: trimmed),
           let r2 = Range(match.range(at: 2), in: trimmed) {
            let role = String(trimmed[r1])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            let name = String(trimmed[r2])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            return learn(NovaMemory(
                category: .personAlias,
                key: name.lowercased(),
                value: "\(name) (mi \(role))",
                confidence: 0.95, source: "user_explicit"
            ))
        }

        // Patrón 6: "mi Y es X" — variant of "X es mi Y" pero invertido.
        // "mi coordinador es Juan Pablo" → personAlias(Juan Pablo, "Juan Pablo (mi coordinador)").
        let pattern6 = #"^mi\s+(.+?)\s+es\s+(.+)$"#
        if let regex = try? NSRegularExpression(pattern: pattern6, options: [.caseInsensitive]),
           let match = regex.firstMatch(
                in: trimmed,
                range: NSRange(trimmed.startIndex..., in: trimmed)
           ),
           match.numberOfRanges >= 3,
           let r1 = Range(match.range(at: 1), in: trimmed),
           let r2 = Range(match.range(at: 2), in: trimmed) {
            let role = String(trimmed[r1])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            let name = String(trimmed[r2])
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?¿¡"))
            // Solo si name parece nombre propio (mayúscula al inicio o
            // varias palabras).
            if let first = name.first, first.isUppercase {
                return learn(NovaMemory(
                    category: .personAlias,
                    key: name.lowercased(),
                    value: "\(name) (mi \(role))",
                    confidence: 0.9, source: "user_explicit"
                ))
            }
        }

        // Patrón 7: "no me gusta X" / "no quiero X" → preference negativa.
        if lower.hasPrefix("no me gusta ") || lower.hasPrefix("no quiero ") || lower.hasPrefix("odio ") {
            return learn(NovaMemory(
                category: .preference,
                key: trimmed.lowercased(),
                value: trimmed,
                confidence: 0.85, source: "user_explicit"
            ))
        }

        return nil
    }

    // MARK: - Inferencia pasiva desde eventos (Phase 3)

    /// Llamado tras crear un evento: si el título contiene "con [Nombre]"
    /// y el nombre se ve como nombre propio, registra alias suave (low
    /// confidence). El usuario puede ratificar después con "X es mi Y".
    ///
    /// Ej: usuario crea "Cumpleaños de Urrutia" → guardamos personAlias
    /// suave para "Urrutia". Próxima vez que diga "Urrutia" Nova tiene
    /// señal de que es una persona conocida.
    func passivelyLearnFromEvent(title: String) {
        guard !NovaMemoryPrivacy.isSensitive(title) else { return }
        let lowerTitle = title.lowercased()
        // Patrón A: "[noun] con [Name]"
        if let regex = try? NSRegularExpression(
            pattern: #"\bcon\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)"#,
            options: []
        ) {
            let ns = title as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let m = regex.firstMatch(in: title, range: range),
               m.numberOfRanges >= 2 {
                let name = ns.substring(with: m.range(at: 1))
                // Skip familia (papá/mamá/etc) — esos no son personas únicas.
                let familyWords: Set<String> = ["papá", "mamá", "papa", "mama",
                    "hermano", "hermana", "hijo", "hija", "padre", "madre",
                    "tío", "tía", "tio", "tia", "primo", "prima", "abuelo",
                    "abuela", "novio", "novia", "esposo", "esposa", "amigo",
                    "amiga", "polola", "pololo", "jefe", "jefa"]
                if !familyWords.contains(name.lowercased()) {
                    upsert(NovaMemory(
                        category: .personAlias,
                        key: name.lowercased(),
                        value: name,
                        confidence: 0.4, source: "inferred_event"
                    ))
                }
            }
        }
        // Patrón B: "[noun] de [Name]" (cumpleaños de Urrutia, etc).
        // Solo cuando la palabra inicial es un evento social (cumpleaños,
        // cumple, fiesta, asado) — evita falsos positivos en "clase de
        // historia", "prueba de matemáticas", etc.
        let socialEvents = ["cumpleaños", "cumple", "fiesta", "asado", "matrimonio", "boda", "aniversario"]
        let socialRegexPart = socialEvents.joined(separator: "|")
        // El `de\s+(?:la\s+|el\s+)?` opcional: matches "de ", "de la ",
        // "de el "; SIN "la/el" sigue capturando ("cumpleaños de Urrutia"
        // → "Urrutia"; "cumpleaños de la Cata" → "Cata"; "cumpleaños Cata"
        // → "Cata"). Sin el "?" intermedio, "de Urrutia" sin la/el fallaba.
        if let regex = try? NSRegularExpression(
            pattern: "\\b(?:\(socialRegexPart))\\s+(?:de\\s+(?:la\\s+|el\\s+)?)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)",
            options: [.caseInsensitive]
        ) {
            let ns = title as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let m = regex.firstMatch(in: title, range: range),
               m.numberOfRanges >= 2 {
                let name = ns.substring(with: m.range(at: 1))
                let familyWords: Set<String> = ["papá", "mamá", "papa", "mama"]
                if !familyWords.contains(name.lowercased()) {
                    upsert(NovaMemory(
                        category: .personAlias,
                        key: name.lowercased(),
                        value: name,
                        confidence: 0.45, source: "inferred_social_event"
                    ))
                }
            }
        }
        _ = lowerTitle  // evitar warning unused
    }

    private func inferCategoryFromValue(_ value: String, originalKey: String) -> NovaMemoryCategory {
        let v = value.lowercased()
        let courseHints = ["teoría", "teoria", "historia", "lenguaje", "matemática",
                           "matematica", "literatura", "filosofía", "filosofia",
                           "comunicación", "comunicacion", "ramo", "clase", "curso"]
        if courseHints.contains(where: v.contains) {
            return .courseAlias
        }
        // Si el value parece nombre propio + apellido (2+ palabras capitalizadas)
        // y la key es corto → personAlias.
        let words = value.split(separator: " ")
        let capitalizedCount = words.filter { $0.first?.isUppercase ?? false }.count
        if capitalizedCount >= 2 && originalKey.count <= 20 {
            return .personAlias
        }
        return .preference
    }
}

// MARK: - Memory READ helpers (Phase 1 — wire-up 2026-05-27)

extension NovaMemoryStore {
    /// Sustituye en `text` cada `key` de courseAlias por su `value`.
    /// Solo aplica para courseAlias — los personAlias no se sustituyen
    /// (queremos preservar el nombre propio en el título; el rol se
    /// inyecta como contexto al backend, no se sustituye en el texto).
    ///
    /// Word-boundary case-insensitive. Devuelve el texto modificado.
    /// Si no hay match, devuelve el texto original sin tocar.
    ///
    /// Ejemplo:
    ///   Memoria: courseAlias("teorías" → "Teorías de la Comunicación")
    ///   Input:   "tengo prueba de teorías el viernes"
    ///   Output:  "tengo prueba de Teorías de la Comunicación el viernes"
    func expandAliases(in text: String) -> String {
        let courseAliases = cache.filter { $0.isActive && $0.category == .courseAlias }
        guard !courseAliases.isEmpty else { return text }
        var result = text
        for alias in courseAliases {
            guard !alias.key.isEmpty else { continue }
            let escapedKey = NSRegularExpression.escapedPattern(for: alias.key)
            let pattern = "\\b\(escapedKey)\\b"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let ns = result as NSString
            let range = NSRange(location: 0, length: ns.length)
            let before = result
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: NSRegularExpression.escapedTemplate(for: alias.value))
            if result != before {
                touchLastUsed(id: alias.id)
            }
        }
        return result
    }

    /// Devuelve una sola línea de "contexto" listo para inyectar al backend
    /// como un turno previo del chat. Formato humano:
    ///   "Recuerdo de turnos anteriores: Juan Pablo es tu coordinador;
    ///   teorías = Teorías de la Comunicación; prefieres pendientes sin hora."
    ///
    /// Limita a `limit` memorias (top-N por confidence + recencia) para no
    /// inundar el prompt. Solo memorias relevantes al `text` actual o, si
    /// no hay match específico, las top-N por recencia global.
    ///
    /// Devuelve `nil` si no hay memorias activas — caller no agrega entry.
    func memoryContextLine(for text: String, limit: Int = 8) -> String? {
        let relevant = relevantMemories(for: text, limit: limit)
        let pool = relevant.isEmpty
            ? Array(activeMemories.prefix(limit))
            : relevant
        guard !pool.isEmpty else { return nil }
        let fragments: [String] = pool.compactMap { mem in
            switch mem.category {
            case .personAlias:
                return mem.value
            case .courseAlias:
                return "\(mem.key) = \(mem.value)"
            case .preference, .schedulingRule, .appBehaviorRule:
                return mem.value
            case .projectContext, .academicContext:
                return mem.value
            }
        }
        guard !fragments.isEmpty else { return nil }
        return "Recuerdo de turnos anteriores: \(fragments.joined(separator: "; "))."
    }

    /// Devuelve TODAS las memorias activas como texto humano (sin filtro
    /// por relevancia). Usado por comando "¿qué sabes de mí?" y por la
    /// vista "Mi memoria con Nova" en Ajustes.
    func allActiveMemoriesHuman(maxEntries: Int = 50) -> [(category: NovaMemoryCategory, text: String, id: UUID)] {
        Array(activeMemories.prefix(maxEntries)).map { mem in
            let line: String
            switch mem.category {
            case .personAlias:    line = mem.value
            case .courseAlias:    line = "\(mem.key) → \(mem.value)"
            case .preference:     line = mem.value
            case .schedulingRule: line = mem.value
            case .appBehaviorRule:line = mem.value
            case .projectContext: line = mem.value
            case .academicContext:line = mem.value
            }
            return (mem.category, line, mem.id)
        }
    }
}
