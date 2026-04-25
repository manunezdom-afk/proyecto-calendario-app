// Normaliza input coloquial / SMS / voseo ANTES de pasarlo al parser de eventos.
//
// Filosofía: mínima invasión. Sólo expandimos abreviaciones inequívocas
// (xq → porque), completamos voseo de comando (agendá → agenda) y limpiamos
// puntuación basura. NO corregimos ortografía libremente, NO traducimos
// dialectos completos, NO tocamos nombres propios ni mayúsculas internas.
//
// Esto se aplica SOLO al texto que va al parser determinista (QuickAdd /
// importación de horarios). El input de chat a Nova no pasa por aquí — Claude
// recibe el texto crudo y se encarga vía system prompt.

// ── Abreviaciones SMS / chat (límite de palabra para no romper nombres) ──────
//
// Cada par es [regex, reemplazo]. Importante: muchos casos requieren mirar
// contexto previo o siguiente para no romper palabras legítimas (ej. "x" es
// "por" sólo cuando va aislada; "tngo" siempre es "tengo").
const ABBREV_PAIRS = [
  // Conectores y relativos comunes en chat
  [/\bxq\b/gi,    'porque'],
  [/\bpq\b/gi,    'porque'],
  [/\bporq\b/gi,  'porque'],
  [/\bxfa\b/gi,    'por favor'],
  [/\bxfvr\b/gi,   'por favor'],
  [/\bporfa\b/gi,  'por favor'],
  [/\bporfis\b/gi, 'por favor'],
  // "x" sólo en patrones inequívocos para no romper nombres ni "5x".
  [/\bx\s+favor\b/gi, 'por favor'],
  [/\bx\s+ej(?:emplo)?\b/gi, 'por ejemplo'],
  [/\btb\b/gi,    'también'],
  [/\btmb\b/gi,   'también'],
  [/\btmbn\b/gi,  'también'],
  [/\btbn\b/gi,   'también'],
  [/\bpa\b/gi,    'para'],
  [/\bdsps\b/gi,  'después'],
  [/\bdespues\b/gi, 'después'],

  // Tener / verbos truncados (sólo abreviaciones claras de 1ª persona; el
  // intent prefix stripping del parser remueve estos verbos después).
  [/\btngo\b/gi,    'tengo'],
  [/\btng\b/gi,     'tengo'],
  [/\bnecesto\b/gi, 'necesito'],
  [/\bquero\b/gi,   'quiero'],

  // Tiempo (CRÍTICO — alimenta al extractor de fecha/hora)
  [/\bmñn\b/gi,    'mañana'],
  [/\bmñna\b/gi,   'mañana'],
  [/\bmñ\b/gi,     'mañana'],
  [/\bmanana\b/gi, 'mañana'],   // sin ñ
  [/\bma[ñn]na\b/gi, 'mañana'], // "mañna", "manna"
  [/\bpsdo\s+ma[ñn]ana\b/gi, 'pasado mañana'],
  [/\bhy\b/gi,    'hoy'],
  [/\baora\b/gi,  'ahora'],
  [/\bayr\b/gi,   'ayer'],
  [/\banoxe\b/gi, 'anoche'],

  // Días de la semana — formas con punto siempre se expanden. Las formas
  // sin punto que colisionan con palabras comunes ("mar", "sab", "dom")
  // sólo se expanden en contexto inequívoco: precedidas por "el/este/
  // próximo" o seguidas por hora/"que viene".
  [/\blun\./gi,    'lunes'],
  [/\bmart?\./gi,  'martes'],
  [/\bmierc?\./gi, 'miércoles'],
  [/\bmierc\b/gi,  'miércoles'],
  [/\bjue\./gi,    'jueves'],
  [/\bvier?\./gi,  'viernes'],
  [/\bvier\b/gi,   'viernes'],
  [/\bsab\./gi,    'sábado'],
  [/\bdom\./gi,    'domingo'],
  // Contexto "el/este/próximo X":
  [/(\b(?:el|este|pr[oó]ximo|del)\s+)mar\b/gi, '$1martes'],
  [/(\b(?:el|este|pr[oó]ximo|del)\s+)sab\b/gi, '$1sábado'],
  [/(\b(?:el|este|pr[oó]ximo|del)\s+)dom\b/gi, '$1domingo'],
  // Contexto "X N" o "X que viene":
  [/\bmar\b(?=\s+(?:\d{1,2}|que\s+viene|pr[oó]ximo|a\s+las))/gi, 'martes'],
  [/\bsab\b(?=\s+(?:\d{1,2}|que\s+viene|pr[oó]ximo|a\s+las))/gi, 'sábado'],
  [/\bdom\b(?=\s+(?:\d{1,2}|que\s+viene|pr[oó]ximo|a\s+las))/gi, 'domingo'],
  [/\bfinde\b/gi,  'fin de semana'],

  // Meses (forma corta) — exigimos punto para evitar colisiones con verbos
  // y palabras comunes ("ago" = primera persona de "hago", "abr" = raíz de
  // "abrir", "may" = nombre propio, etc.).
  [/\bene\./gi,   'enero'],
  [/\bfeb\./gi,   'febrero'],
  [/\bmzo\./gi,   'marzo'],
  [/\babr\./gi,   'abril'],
  [/\bmay\./gi,   'mayo'],
  [/\bjun\./gi,   'junio'],
  [/\bjul\./gi,   'julio'],
  [/\bago\./gi,   'agosto'],
  [/\bsept?\./gi, 'septiembre'],
  [/\boct\./gi,   'octubre'],
  [/\bnov\./gi,   'noviembre'],
  [/\bdic\./gi,   'diciembre'],

  // Unidades de tiempo
  [/\b(\d+)\s*hrs?\b/gi, '$1 horas'],
  [/\b(\d+)\s*mins?\b/gi, '$1 minutos'],
  [/\bhr\b/gi,   'hora'],
  [/\bhrs\b/gi,  'horas'],
  [/\bmin\b/gi,  'minutos'],
  [/\bmts\b/gi,  'minutos'],

  // Vocabulario de calendario (typos y abreviaciones frecuentes)
  [/\bdent[ií]?st\b/gi, 'dentista'],
  [/\bdnt\b/gi,     'dentista'],
  [/\bdr\.?\s+/gi,  'doctor '],
  [/\bdra\.?\s+/gi, 'doctora '],
  [/\bcumple\b/gi,  'cumpleaños'],
  [/\bbday\b/gi,    'cumpleaños'],
  [/\bappt\b/gi,    'cita'],
  [/\boficna\b/gi,  'oficina'],
  [/\boficnia\b/gi, 'oficina'],
  [/\breunon\b/gi,  'reunión'],
  [/\breunoin\b/gi, 'reunión'],
  [/\bmkt\b/gi,     'marketing'],
  [/\brrhh\b/gi,    'recursos humanos'],
  [/\brecordame\b/gi, 'recuérdame'],
  [/\brecordá(?:me)?\b/gi, m => /me$/.test(m) ? 'recuérdame' : 'recuerda'],

  // Voseo de comando (input) → forma neutra. Sólo conjugaciones imperativas
  // y de 2ª persona en voseo. NO tocamos cosas como "agendalo" si ya está
  // en forma común (sin acento) — sólo el voseo inequívoco.
  [/\bagend[aá]me\b/gi,    'agéndame'],
  [/\bagendalo\b/gi,       'agéndalo'],
  [/\bponéme?\b/gi,        'ponme'],
  [/\bmandá(?:me)?\b/gi,   'manda'],
  [/\bmovelo\b/gi,         'muévelo'],
  [/\bmové\b/gi,           'mueve'],
  [/\bborrá(?:lo)?\b/gi,   m => /lo$/.test(m) ? 'bórralo' : 'borra'],
  [/\bbuscá(?:me)?\b/gi,   m => /me$/.test(m) ? 'búscame' : 'busca'],
  [/\bavisá(?:me)?\b/gi,   m => /me$/.test(m) ? 'avísame' : 'avisa'],
  // "dale ..." sólo al inicio del input es un imperativo de "venga, agendá X".
  [/^\s*dale[,!]?\s+/i,    'agenda '],
  [/\bagregá(?:me)?\b/gi,  m => /me$/.test(m) ? 'agrégame' : 'agrega'],

  // Preposiciones colapsadas (chat / SMS)
  [/\bdla\b/gi,   'de la'],
  [/\bd\s+(?=la|el|los|las|un[ao]?s?)\b/gi, 'de '],
  [/\bcn\b/gi,    'con'],
  [/\bsn\b/gi,    'sin'],
]

// ── Tipos coloquiales: aproximaciones que el parser entiende mejor en forma
// canónica. Ej: "casi las 5" → "tipo las 5"; "5 y pico" → "5 y media".
const APPROX_PAIRS = [
  // "5 y pico", "las 5 y pico" → "5 y media" (heurística: pico ≈ +30 min)
  [/\b(\d{1,2}(?::\d{2})?)\s+y\s+(?:pico|algo|tantos)\b/gi, '$1 y media'],
  // "casi las X", "casi a las X" → "tipo las X" (parser ya soporta "tipo")
  [/\bcasi\s+(?:a\s+)?las?\s+(\d{1,2}(?::\d{2})?)/gi, 'tipo las $1'],
  // "como las X" sin "a" — el parser ya soporta "como a las X", normalizamos
  [/\bcomo\s+las?\s+(\d{1,2}(?::\d{2})?)/gi, 'como a las $1'],
  // "alrededor de las X" → "a eso de las X"
  [/\balrededor\s+de\s+las?\s+(\d{1,2}(?::\d{2})?)/gi, 'a eso de las $1'],
  // "en torno a las X" → "a eso de las X"
  [/\ben\s+torno\s+a\s+las?\s+(\d{1,2}(?::\d{2})?)/gi, 'a eso de las $1'],
  // "sobre las X" (España) → "a eso de las X"
  [/\bsobre\s+las?\s+(\d{1,2}(?::\d{2})?)/gi, 'a eso de las $1'],
  // "5pm" / "5 pm" / "5p.m." sin "a las" — añadir "a las " si no está
  [/(?<!\d|\d:)\b(\d{1,2})(?::(\d{2}))?\s*p\.?\s*m\.?\b/gi, (_m, h, mn) =>
    `a las ${h}${mn ? ':' + mn : ''} de la tarde`,
  ],
  [/(?<!\d|\d:)\b(\d{1,2})(?::(\d{2}))?\s*a\.?\s*m\.?\b/gi, (_m, h, mn) =>
    `a las ${h}${mn ? ':' + mn : ''} de la mañana`,
  ],
]

// ── Limpieza de puntuación / repeticiones ─────────────────────────────────
function cleanupNoise(text) {
  return text
    // Múltiples signos de exclamación/pregunta → uno solo
    .replace(/([!?¡¿])\1{1,}/g, '$1')
    // Letras repetidas exageradas: "buenoooo" → "bueno", "siiiii" → "si".
    // Sólo colapsamos 3+ a 1 — ningún término legítimo en español tiene
    // 3+ letras iguales seguidas, así que esto no toca "calle" ni "creer".
    .replace(/([a-záéíóúñ])\1{2,}/gi, '$1')
    // Espacios alrededor de dos puntos en horas: "5 : 30" → "5:30"
    .replace(/(\d)\s*:\s*(\d)/g, '$1:$2')
    // Espacios duplicados
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Punto de entrada principal ─────────────────────────────────────────────
//
// Recibe texto crudo del usuario y devuelve una versión "limpia" donde:
//   · Las abreviaciones SMS más comunes están expandidas.
//   · Voseo imperativo está en forma neutra.
//   · Aproximaciones coloquiales ("casi", "y pico", "5pm") están en forma
//     que el parser determinista ya entiende.
//   · La puntuación está saneada.
//
// La transformación es idempotente: aplicar dos veces da el mismo resultado.
export function normalizeColloquial(rawText) {
  if (!rawText) return ''
  let out = String(rawText)

  // 1. Limpieza superficial primero (saca ruido para que los regex pasen)
  out = cleanupNoise(out)

  // 2. Abreviaciones (varias pasadas porque algunas se desbloquean tras otras)
  for (let i = 0; i < 2; i++) {
    let before = out
    for (const [re, rep] of ABBREV_PAIRS) {
      out = typeof rep === 'function' ? out.replace(re, rep) : out.replace(re, rep)
    }
    if (out === before) break
  }

  // 3. Aproximaciones temporales — corren después porque algunas dependen de
  // que "mñn" ya esté expandido a "mañana" para no romperse.
  for (const [re, rep] of APPROX_PAIRS) {
    out = typeof rep === 'function' ? out.replace(re, rep) : out.replace(re, rep)
  }

  // 4. Limpieza final (espacios que pudieron quedar tras los reemplazos)
  return cleanupNoise(out)
}
