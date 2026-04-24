// ── memoryInjection ──────────────────────────────────────────────────────
//
// Convierte las memorias que Nova aprendió sobre el usuario en un "subject"
// corto que el copy de una notificación puede inyectar. Ejemplo: si hay una
// memoria { category: 'relationship', subject: 'Ana', content: 'Su pareja
// es Ana' } y el usuario tiene un evento "Reunión" hoy, este módulo devuelve
// "Ana" para que el título de la push sea "Reunión con Ana en 10 min" en
// vez de un genérico "Reunión en 10 min".
//
// Reglas (deliberadamente conservadoras — es mejor no inyectar que inventar):
//
//   1. Fuente aceptada: categorías `relationship` y `fact`. Las rutinas
//      quedan fuera a propósito porque inyectar nombres de actividades en
//      títulos genera frases raras ("Gym con Crossfit"); el title ya
//      describe la actividad y la personalidad + momento bastan para dar
//      contexto. Relaciones (Ana, Juan) y hechos ("cardiólogo") sí aportan.
//
//   2. Match: una memoria aplica a un evento si alguna palabra "fuerte"
//      (≥ 4 letras, normalizada sin acentos) del `subject` o del `content`
//      aparece dentro del título del evento. El subject crudo tiene
//      preferencia sobre el content.
//
//   3. Si hay ≥ 2 candidatas distintas, no inyectamos nada — preferimos
//      la voz genérica que arriesgar un nombre equivocado.
//
//   4. Si el subject ya está contenido en el título, no aportamos nada y
//      devolvemos null (el copy builder igual resuelve bien ese caso,
//      pero evitamos pasar datos redundantes al payload).

const STOPWORDS = new Set([
  'de','del','la','el','los','las','y','a','en','para','por','con','un','una',
  'mi','tu','su','me','te','se','le','al','que','es','son','soy','está','están',
  'hoy','mañana','pasado','sin','por','pero',
])

const ALLOWED_CATEGORIES = new Set(['relationship', 'fact'])

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Tokens "fuertes" para matching: 3+ letras y no stopword. Mantener el
// umbral bajo porque nombres propios cortos (Ana, Leo, Eva) son muy
// comunes y necesitamos capturarlos. Los stopwords evitan falsos positivos.
function strongTokens(s) {
  return normalize(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

// Devuelve el "subject" a inyectar en el copy, o null si ninguna memoria
// matchea con confianza.
export function pickSubjectForEvent(event, memories) {
  if (!event?.title) return null
  if (!Array.isArray(memories) || memories.length === 0) return null

  const titleNorm = normalize(event.title)
  const titleTokens = new Set(titleNorm.split(' '))

  const candidates = []
  for (const m of memories) {
    if (!m || !ALLOWED_CATEGORIES.has(m.category)) continue

    const subjectRaw = String(m.subject || '').trim()
    const contentTokens = strongTokens(m.content)
    const subjectTokens = strongTokens(subjectRaw)

    // Match por subject: si el título contiene alguna palabra fuerte del
    // sujeto (p. ej. "Ana" contenida en "Reunión con Ana"), el sujeto crudo
    // es la forma preferida de referirse a la memoria.
    const subjectHit = subjectTokens.some((t) => titleTokens.has(t))
    if (subjectRaw && subjectHit) {
      candidates.push({ label: subjectRaw, source: 'subject', category: m.category })
      continue
    }

    // Match por content: el título comparte una palabra fuerte con la frase
    // aprendida ("crossfit" en la memoria de rutina, con el evento "Gym"
    // → el content tiene "gym" o "crossfit" y lo usamos como label).
    const contentHit = contentTokens.find((t) => titleTokens.has(t))
    if (contentHit) {
      const label = subjectRaw || contentHit
      candidates.push({ label, source: 'content', category: m.category })
    }
  }

  if (candidates.length === 0) return null

  // Dedup por label (case-insensitive). Si sobran 2+ etiquetas distintas,
  // la ambigüedad mata la inyección — preferimos el copy genérico.
  const byLabel = new Map()
  for (const c of candidates) {
    const key = normalize(c.label)
    if (!byLabel.has(key)) byLabel.set(key, c)
  }
  if (byLabel.size !== 1) return null

  const only = [...byLabel.values()][0]
  const label = only.label.trim()
  if (!label) return null

  // Si el label ya está literal en el título, el copy no gana nada al
  // "inyectar" — devolvemos null para no ensuciar el payload ni generar
  // frases como "Reunión con Ana con Ana".
  if (titleNorm.includes(normalize(label))) return null

  return label
}
