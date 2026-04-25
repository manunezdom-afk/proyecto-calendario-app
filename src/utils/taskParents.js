// Mapa local tarea hija → tarea padre.
//
// La tabla `tasks` en Supabase no tiene columna para una jerarquía padre↔hijo.
// Para no forzar una migración mientras se consolida el patrón, persistimos
// la relación en localStorage por usuario (mismo enfoque que taskLinks.js,
// que liga tarea↔evento). El hook useTasks superpone `parentTaskId` al
// hidratar, y el timeline de Mi Día agrupa visualmente las hijas bajo su
// padre — análogo a como ya cuelga subtareas debajo de eventos.
//
// Cuando una tarea hija pierde a su padre (porque el padre fue eliminado),
// la entrada queda como huérfana en localStorage. El render filtra eso
// chequeando que el padre exista en la lista de tareas vivas — la tarea
// hija reaparece standalone y la entrada huérfana se purga la próxima vez
// que toquemos esta tarea (delete/clear).

function keyFor(userId) {
  return userId ? `focus_task_parents_${userId}` : 'focus_task_parents'
}

export function getTaskParents(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveTaskParents(parents, userId) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(parents)) } catch {}
}

export function setTaskParent(taskId, parentTaskId, userId) {
  if (!taskId || !parentTaskId) return
  if (taskId === parentTaskId) return // sanity: ninguna tarea es su propio padre
  const parents = getTaskParents(userId)
  if (parents[taskId] === parentTaskId) return
  parents[taskId] = parentTaskId
  saveTaskParents(parents, userId)
}

export function clearTaskParent(taskId, userId) {
  if (!taskId) return
  const parents = getTaskParents(userId)
  if (!(taskId in parents)) return
  delete parents[taskId]
  saveTaskParents(parents, userId)
}

export function getParentTaskId(taskId, userId) {
  return getTaskParents(userId)[taskId] || null
}
