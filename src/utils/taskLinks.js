// Mapa local tarea → evento.
//
// Cuando Nova detecta subtareas asociadas a un evento (ej: los puntos a
// preparar para una reunión de las 18:00), queremos que esas tareas queden
// visualmente ancladas debajo del bloque del evento en Mi Día, no flotando
// sueltas en la pestaña Tareas.
//
// Como la tabla `tasks` en Supabase no tiene columna para el evento vinculado
// y no queremos forzar una migración, persistimos la relación en localStorage
// por usuario. El hook useTasks superpone `linkedEventId` al hidratar, y la
// timeline del planner lee ese campo para renderizar subtareas en contexto.

function keyFor(userId) {
  return userId ? `focus_task_links_${userId}` : 'focus_task_links'
}

export function getTaskLinks(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveTaskLinks(links, userId) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(links)) } catch {}
}

export function setTaskLink(taskId, eventId, userId) {
  if (!taskId || !eventId) return
  const links = getTaskLinks(userId)
  if (links[taskId] === eventId) return
  links[taskId] = eventId
  saveTaskLinks(links, userId)
}

export function clearTaskLink(taskId, userId) {
  if (!taskId) return
  const links = getTaskLinks(userId)
  if (!(taskId in links)) return
  delete links[taskId]
  saveTaskLinks(links, userId)
}

export function getLinkedEventId(taskId, userId) {
  return getTaskLinks(userId)[taskId] || null
}
