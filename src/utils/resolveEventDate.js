/**
 * resolveEventDate
 *
 * Convierte el campo `date` de un evento (que puede ser null, "Hoy",
 * "Mañana", "Pasado mañana" o "YYYY-MM-DD") a siempre un string YYYY-MM-DD.
 *
 * Esto permite comparar fechas de forma consistente en toda la app.
 */

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function resolveEventDate(ev) {
  const dateField = ev?.date

  // 1. Sin fecha → hoy
  if (!dateField) return isoDate(new Date())

  // 2. Ya es YYYY-MM-DD → devolver tal cual
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateField)) return dateField

  // 3. Strings relativos en español
  const today = new Date()
  const d = dateField.toLowerCase().trim()

  if (d === 'hoy') return isoDate(today)

  if (d === 'mañana' || d === 'manana') {
    const t = new Date(today); t.setDate(today.getDate() + 1); return isoDate(t)
  }

  if (d === 'pasado mañana' || d === 'pasado manana') {
    const t = new Date(today); t.setDate(today.getDate() + 2); return isoDate(t)
  }

  // 4. Fallback → hoy (para strings desconocidos como "Lunes", etc.)
  return isoDate(today)
}

/** Devuelve el YYYY-MM-DD de hoy */
export function todayISO() {
  return isoDate(new Date())
}
