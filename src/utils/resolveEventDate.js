/**
 * resolveEventDate
 *
 * Devuelve siempre un string YYYY-MM-DD (o null si no hay forma de
 * inferirlo) para un evento. Antes esto caía silenciosamente a "hoy"
 * cuando el campo `date` faltaba, era inválido o venía como string
 * relativo ("Hoy"/"Mañana"). Esa ruta era la culpable de eventos
 * fantasma que reaparecían cada día — un evento creado el lunes con
 * date=null seguía mostrándose el martes, miércoles, jueves… porque
 * el filtro `resolveEventDate(ev) === todayISO()` matcheaba siempre.
 *
 * Ahora la función es PURA: si no hay un YYYY-MM-DD útil, intenta
 * recuperar la fecha de creación incrustada en el `id` del evento
 * (todos nuestros ids llevan un Date.now() en milisegundos). Solo
 * cuando ni siquiera hay timestamp en el id devolvemos null y el
 * caller decide qué hacer (los filtros simplemente lo descartarán).
 */

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

// Extrae el Date.now() embebido en el id ("evt-1735593600000-xyz",
// "evt-imp-1735593600000-…", "1735593600000-0.4").
// Buscamos cualquier secuencia de 13 dígitos (ms desde 1970) y la
// validamos con un Date — si no es razonable (NaN), descartamos.
export function idToTimestampMs(id) {
  if (!id || typeof id !== 'string') return null
  const m = id.match(/(\d{13,})/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  // Sanity: rechazar timestamps anteriores al 2010 o posteriores al 2100,
  // que serían numéricamente válidos pero claramente basura.
  const MIN = Date.UTC(2010, 0, 1)
  const MAX = Date.UTC(2100, 0, 1)
  if (n < MIN || n > MAX) return null
  return n
}

function isoFromIdTimestamp(id) {
  const ms = idToTimestampMs(id)
  if (ms === null) return null
  return isoDate(new Date(ms))
}

export function resolveEventDate(ev) {
  const dateField = ev?.date

  // 1. Ya es YYYY-MM-DD → devolver tal cual (camino feliz, ~99% de eventos).
  if (typeof dateField === 'string' && ISO_RE.test(dateField)) return dateField

  // 2. Strings relativos en español ("Hoy", "Mañana", "Pasado mañana").
  //    Datos viejos: el parser actual ya guarda ISO, pero hubo un período
  //    en que QuickAddSheet/Nova metían "Hoy" literal en el campo date.
  //    Esos eventos quedaron drifting con la "verdadera hoy". Para no
  //    seguir el drift, los anclamos al día en que se crearon (id).
  //    Si no podemos recuperar la creación, último recurso: hoy.
  if (typeof dateField === 'string') {
    const idIso = isoFromIdTimestamp(ev?.id)
    if (idIso) return idIso
    const d = dateField.toLowerCase().trim()
    if (d === 'hoy') return isoDate(new Date())
    if (d === 'mañana' || d === 'manana') {
      const t = new Date(); t.setDate(t.getDate() + 1); return isoDate(t)
    }
    if (d === 'pasado mañana' || d === 'pasado manana') {
      const t = new Date(); t.setDate(t.getDate() + 2); return isoDate(t)
    }
  }

  // 3. Sin fecha válida → intentar derivar del id. null si no se puede.
  return isoFromIdTimestamp(ev?.id)
}

/** Devuelve el YYYY-MM-DD de hoy (zona horaria local). */
export function todayISO() {
  return isoDate(new Date())
}
