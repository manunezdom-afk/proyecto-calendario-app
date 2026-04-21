const PAIRS = [
  [/\bagend(a|á)lo\b/gi, 'agéndalo'], [/\bagendá\b/gi, 'agenda'],
  [/\bagregalo\b/gi, 'agrégalo'], [/\bagregá\b/gi, 'agrega'],
  [/\bbuscá\b/gi, 'busca'], [/\bbuscalo\b/gi, 'búscalo'],
  [/\bejecutá\b/gi, 'ejecuta'], [/\bejecutalo\b/gi, 'ejecútalo'],
  [/\bselecciona?lo\b/gi, 'selecciónalo'], [/\bseleccioná\b/gi, 'selecciona'],
  [/\bpedí\b/gi, 'pide'], [/\bpedilo\b/gi, 'pídelo'],
  [/\bconectá\b/gi, 'conecta'],
  [/\bpreferí\b/gi, 'prefiere'],
  [/\bincluí\b/gi, 'incluye'],
  [/\btenelo\b/gi, 'tenlo'], [/\btenélo\b/gi, 'tenlo'],
  [/\btratalos\b/gi, 'trátalos'],
  [/\bhacé\b/gi, 'haz'], [/\bhacelo\b/gi, 'hazlo'],
  [/\bproponé\b/gi, 'propón'], [/\bproponelo\b/gi, 'propónlo'],
  [/\bsumá\b/gi, 'suma'],
  [/\bavisá\b/gi, 'avisa'], [/\bavisame\b/gi, 'avísame'],
  [/\bsugerí\b/gi, 'sugiere'],
  [/\bdecile\b/gi, 'dile'], [/\bdecí\b/gi, 'di'],
  [/\bponé\b/gi, 'pon'], [/\bponelo\b/gi, 'ponlo'],
  [/\bdejá\b/gi, 'deja'], [/\bdejalo\b/gi, 'déjalo'],
  [/\bmové\b/gi, 'mueve'], [/\bmovelo\b/gi, 'muévelo'],
  [/\bborrá\b/gi, 'borra'], [/\bborralo\b/gi, 'bórralo'],
  [/\brevisá\b/gi, 'revisa'],
  [/\bmirá\b/gi, 'mira'],
  [/\bquerés\b/gi, 'quieres'], [/\bquer(é|e)s\b/gi, 'quieres'],
  [/\bpodés\b/gi, 'puedes'],
  [/\btenés\b/gi, 'tienes'],
  [/\bsabés\b/gi, 'sabes'],
  [/\bhacés\b/gi, 'haces'],
  [/\bvenís\b/gi, 'vienes'],
  [/\bsos\b/gi, 'eres'],
  [/\bvivís\b/gi, 'vives'],
  [/\breferís\b/gi, 'refieres'],
  [/\bpreferís\b/gi, 'prefieres'],
  [/\bsentís\b/gi, 'sientes'],
  [/\bmandás\b/gi, 'mandas'],
  [/\bpensás\b/gi, 'piensas'],
  [/\bmirás\b/gi, 'miras'],
  [/\bbuscás\b/gi, 'buscas'],
  [/\bnecesitás\b/gi, 'necesitas'],
  [/\bcreés\b/gi, 'crees'],
  [/\bdale\b/gi, 'claro'],
  [/\bche\b/gi, ''],
  [/\bacá\b/gi, 'aquí'],
  [/\ballá\b/gi, 'allí'],
  [/\bno tengo un evento\b/gi, 'no tienes un evento'],
  [/\bno tengo ningún evento\b/gi, 'no tienes ningún evento'],
  [/\btengo un evento\b/gi, 'tienes un evento'],
  [/\btengo una? (clase|reunión|tarea|cita|llamada)\b/gi, 'tienes una $1'],
  [/\bmi (clase|reunión|tarea|cita|llamada|agenda|calendario)\b/gi, 'tu $1'],
]

export function neutralizeSpanish(text) {
  if (!text) return text
  let out = text
  for (const [re, rep] of PAIRS) out = out.replace(re, rep)
  return out.replace(/\s+/g, ' ').trim()
}

export function safeParseAssistantJSON(rawText) {
  const txt = String(rawText || '').trim()
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no_json_object_found')
  const candidate = JSON.parse(m[0])
  if (!candidate || typeof candidate !== 'object') throw new Error('invalid_json_shape')
  if (typeof candidate.reply !== 'string') throw new Error('missing_reply')
  if (!Array.isArray(candidate.actions)) candidate.actions = []
  candidate.reply = neutralizeSpanish(candidate.reply)
  return candidate
}
