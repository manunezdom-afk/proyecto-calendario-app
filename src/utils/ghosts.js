// Ghost content — visible solo para usuarios nuevos como demo visual.
// Desaparece en cuanto el usuario crea su primer evento o tarea real
// (o cuando Nova los sustituye por propuestas reales).
//
// Los ghosts se renderizan con el mismo estilo que el contenido real
// (colores, sombras, bordes sólidos). Un pill "EJEMPLO" los identifica
// para que el usuario entienda que son placeholders, no data suya.

const KEY = 'focus_ghosts_dismissed'

export function ghostsDismissed() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function dismissGhosts() {
  try { localStorage.setItem(KEY, '1') } catch {}
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Eventos ghost para Calendario + Mi Día.
// Los campos siguen el schema de un evento real (title, time, date, section, icon).
// El flag `isGhost: true` permite filtrar en delete/edit handlers.
export function buildGhostEvents() {
  const date = todayISO()
  return [
    {
      id: 'ghost-ev-1',
      title: 'Sesión de trabajo profundo',
      time: '9:00 AM',
      date,
      section: 'focus',
      icon: 'psychology',
      description: 'Ejemplo — así se verán tus eventos.',
      isGhost: true,
    },
    {
      id: 'ghost-ev-2',
      title: 'Almuerzo sin pantallas',
      time: '12:30 PM',
      date,
      section: 'focus',
      icon: 'restaurant',
      isGhost: true,
    },
    {
      id: 'ghost-ev-3',
      title: 'Revisar tareas de la semana',
      time: '4:00 PM',
      date,
      section: 'evening',
      icon: 'checklist',
      isGhost: true,
    },
  ]
}

// Tareas ghost para Tareas.
export function buildGhostTasks() {
  return [
    { id: 'ghost-tk-1', label: 'Terminar propuesta para cliente', priority: 'Alta',  category: 'hoy',       done: false, isGhost: true },
    { id: 'ghost-tk-2', label: 'Responder mails pendientes',      priority: 'Media', category: 'hoy',       done: false, isGhost: true },
    { id: 'ghost-tk-3', label: 'Revisar presupuesto mensual',     priority: 'Baja',  category: 'semana',    done: false, isGhost: true },
  ]
}

// Blocks ghost para la timeline de PlannerView (estructura de "Mi Día").
export function buildGhostBlocks() {
  return [
    {
      id: 'ghost-1',
      time: '09:00',
      type: 'confirmed',
      title: 'Sesión de trabajo profundo',
      description: 'Así se verán tus eventos en Mi Día.',
      isGhost: true,
    },
    {
      id: 'ghost-2',
      time: '12:30',
      type: 'confirmed',
      title: 'Almuerzo sin pantallas',
      isGhost: true,
    },
    {
      id: 'ghost-3',
      time: '16:00',
      type: 'confirmed',
      title: 'Revisar tareas de la semana',
      isGhost: true,
    },
  ]
}
