// Duraciones de eventos — FUENTE ÚNICA DE VERDAD.
//
// El contrato OpenAI usa estas reglas para distinguir una hora puntual
// de un bloque solicitado por el usuario. El prompt compartido explica
// la misma política; no hay reglas diferentes según proveedor.
//
// REGLA DE PRODUCTO (orden de cierre 2026-06-10): sin duración explícita
// del usuario NO se inventa término — durationMinutes: 0 / endTime: null,
// incluso para tipos "obvios" ("fútbol a las 5" y "doctor a las 11" son
// puntos, no bloques). La tabla de abajo es REFERENCIA y solo se aplica
// cuando el usuario pide explícitamente bloquear/reservar tiempo sin
// precisar cuánto ("bloquéame la tarde para estudiar").
//
// Este módulo centraliza:
//   1. La tabla tipo-de-evento → minutos de referencia.
//   2. El render de esa tabla para inyectar en CUALQUIER prompt.
//   3. Detectores deterministas (testeables sin LLM) de duración
//      explícita en el texto del usuario.
//
// Cambiar una duración de referencia = editar UNA línea acá.

/**
 * Tabla canónica: patrón (regex case-insensitive sobre el título o el
 * texto del usuario) → duración por defecto en minutos cuando el usuario
 * NO dio duración explícita. El orden importa: gana el primer match.
 */
export const DEFAULT_EVENT_DURATIONS = [
  { label: 'Standup / daily / check-in',           pattern: /\b(standup|stand-up|daily|check-?in)\b/i,                                          minutes: 15 },
  { label: 'Reunión 1:1',                          pattern: /\b(1:1|uno a uno|one on one)\b/i,                                                  minutes: 30 },
  { label: 'Llamada / call telefónica',            pattern: /\b(llamada|llamar|call|telefonear)\b/i,                                            minutes: 30 },
  { label: 'Reunión genérica / junta',             pattern: /\b(reuni[oó]n|junta|meet(ing)?)\b/i,                                               minutes: 45 },
  { label: 'Entrevista',                           pattern: /\bentrevista\b/i,                                                                  minutes: 60 },
  { label: 'Presentación / pitch / demo',          pattern: /\b(presentaci[oó]n|pitch|demo|review)\b/i,                                         minutes: 45 },
  { label: 'Gym / pesas / crossfit / yoga',        pattern: /\b(gym|gimnasio|pesas|crossfit|pilates|yoga|entrenar|entreno|entrenamiento)\b/i,   minutes: 60 },
  { label: 'Correr / caminar / nadar',             pattern: /\b(correr|trotar|caminar|nadar)\b/i,                                               minutes: 45 },
  { label: 'Fútbol / tenis / pádel / básquet',     pattern: /\b(f[uú]tbol|futbol|partido|tenis|p[aá]del|b[aá]squet|basquetbol|voleibol)\b/i,    minutes: 90 },
  { label: 'Desayuno / brunch',                    pattern: /\b(desayuno|desayunar|brunch)\b/i,                                                 minutes: 45 },
  { label: 'Almuerzo',                             pattern: /\b(almuerzo|almorzar)\b/i,                                                         minutes: 60 },
  { label: 'Café / tomar algo',                    pattern: /\b(caf[eé]|tomar algo)\b/i,                                                        minutes: 45 },
  { label: 'Cena',                                 pattern: /\b(cena|cenar)\b/i,                                                                minutes: 90 },
  { label: 'Clase / cátedra',                      pattern: /\b(clase|c[aá]tedra|catedra)\b/i,                                                  minutes: 90 },
  { label: 'Examen / prueba',                      pattern: /\b(examen|prueba|certamen|test)\b/i,                                               minutes: 90 },
  { label: 'Estudiar / repasar',                   pattern: /\b(estudiar|estudio|repasar|repaso)\b/i,                                           minutes: 60 },
  { label: 'Trabajar en / bloque de trabajo',      pattern: /\b(trabajar|trabajo en|bloque)\b/i,                                                minutes: 60 },
  { label: 'Leer / lectura',                       pattern: /\b(leer|lectura)\b/i,                                                              minutes: 45 },
  { label: 'Dentista / doctor / médico',           pattern: /\b(dentista|doctor|doctora|m[eé]dico|psic[oó]log[oa]|psiquiatra|kinesi[oó]log[oa]|consulta|control)\b/i, minutes: 45 },
  { label: 'Cine / película',                      pattern: /\b(cine|pel[ií]cula)\b/i,                                                          minutes: 120 },
  { label: 'Cumpleaños / fiesta / boda',           pattern: /\b(cumplea[ñn]os|cumple|fiesta|boda|matrimonio|carrete|asado)\b/i,                 minutes: 180 },
]

/**
 * Infiere la duración por defecto (minutos) para un título/texto de
 * evento, o `null` si el tipo no es reconocible. `null` significa:
 * NO inventar duración — el evento queda sin hora de término.
 */
export function inferDefaultDurationMinutes(titleOrText) {
  if (typeof titleOrText !== 'string' || !titleOrText.trim()) return null
  for (const row of DEFAULT_EVENT_DURATIONS) {
    if (row.pattern.test(titleOrText)) return row.minutes
  }
  return null
}

/**
 * True si el usuario expresó duración o hora de término EXPLÍCITA:
 *   "por 30 minutos", "durante 2 horas", "media hora", "de 5 a 7",
 *   "entre 5 y 7", "hasta las 9", "1h", "90 min".
 * Espejo del gate `userMentionedExplicitEndTime` del cliente iOS
 * (NovaActionNormalizer.swift) — mantener sincronizados.
 */
export function userMentionedExplicitDuration(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  const lower = text.toLowerCase()
  const patterns = [
    // "de X a Y" / "de las X a las Y" / "entre X y Y"
    /\bde\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s+a\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b/,
    /\bentre\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\s+y\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b/,
    // "hasta las X"
    /\bhasta\s+(?:la?s?\s+)?\d{1,2}(?::\d{2})?\b/,
    // "por/durante N min|horas"
    /\b(?:por|durante)\s+\d{1,3}\s*(?:h|hs|hrs?|horas?|min|minutos?)\b/,
    // "por una hora" / "por media hora" / "durante dos horas"
    /\b(?:por|durante)\s+(?:un|una|dos|tres|cuatro|cinco|seis|media|medio)\s+(?:hora|horas|min|minutos?)\b/,
    // "media hora" suelto como complemento de evento ("almuerzo media hora")
    /\bmedia\s+hora\b/,
    // "hora y media" / "una hora y media" ("gimnasio hora y media")
    /\b(?:una\s+)?hora\s+y\s+media\b/,
    // "siesta de 20 minutos" / "clase de 2 horas" — duración con "de"
    /\bde\s+\d{1,3}\s*(?:min|minutos?|h|hs|hrs?|horas?)\b/,
    // "1h" / "2 hrs" / "90 min" / "2 horas" como sufijo suelto.
    // Generoso a propósito: este detector se usa como GUARD que borra
    // duraciones no explícitas — un falso-allow es inocuo (el modelo ya
    // está instruido a mandar 0), un falso-deny destruye una duración
    // legítima del usuario.
    /\b\d{1,3}\s*(?:h|hs|hrs)\b/,
    /\b\d{1,3}\s+(?:min|minutos?|horas?)\b/,
    /\b(?:un|una|dos|tres|cuatro|cinco|seis|media)\s+(?:hora|horas|min|minutos?)\b/,
  ]
  return patterns.some(re => re.test(lower))
}

/**
 * True si el usuario pidió explícitamente RESERVAR/BLOQUEAR tiempo sin
 * precisar cuánto ("bloquéame la tarde para estudiar", "resérvame un
 * bloque para leer", "deja un bloque de gym"). Es la única situación en
 * que se permite aplicar la tabla de referencia como duración real.
 */
export function userAskedToBlockTime(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  const lower = text.toLowerCase()
  const patterns = [
    /\bbloqu[eé][a-z]*\b/,            // bloquea, bloquéame, bloquear
    /\breserv[a-z]*\b/,               // reserva, resérvame, reservar
    /\b(un|el)\s+bloque\b/,           // "deja un bloque", "agenda el bloque"
    /\bagenda(me)?\s+\d{1,3}\s*(min|minutos?|h|horas?)\b/, // "agenda 30 min para X"
    /\bd[eé]ja(me)?\s+(la\s+)?(mañana|manana|tarde|noche)\s+para\b/, // "deja la tarde para X"
  ]
  return patterns.some(re => re.test(lower))
}

/**
 * Render de la tabla para inyectar en un system prompt. Texto plano,
 * una línea por tipo. Único lugar donde la tabla se serializa — los
 * prompts NUNCA deben duplicarla a mano.
 */
export function renderDurationTableForPrompt() {
  return DEFAULT_EVENT_DURATIONS
    .map(r => `   - ${r.label}: ${r.minutes} min`)
    .join('\n')
}
