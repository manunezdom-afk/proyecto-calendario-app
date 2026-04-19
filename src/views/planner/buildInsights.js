import { todayISO } from '../../utils/dateHelpers'
import { currentHour } from './plannerHelpers'

// Construye hasta 2 insights personalizados para mostrar en el planner.
// Se basa en (1) cantidad y tipo de eventos del día, (2) cronotipo/hora actual,
// (3) rol del usuario. Devuelve una lista ya ordenada por relevancia.
export function buildInsights(events, profile) {
  const today = todayISO()
  const todayEvents = events.filter((e) => !e.date || e.date === today)
  const eveningCount = todayEvents.filter((e) => e.section === 'evening').length
  const meetingCount = todayEvents.filter((e) =>
    /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title)
  ).length
  const h = currentHour()

  const { role, chronotype } = profile
  const roleLabel = {
    student: 'estudiar',
    worker: 'trabajar',
    freelance: 'producir',
    other: 'concentrarte',
  }[role] ?? 'concentrarte'

  const insights = []

  if (meetingCount >= 3) {
    insights.push({
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      icon: 'groups',
      label: 'REUNIONES',
      text: `${meetingCount} reuniones hoy. Bloquea al menos 30 min de recuperación entre ellas para mantener el foco.`,
    })
  } else if (meetingCount > 0) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'groups',
      label: 'AGENDA',
      text: `${meetingCount} reunión${meetingCount > 1 ? 'es' : ''} programada${meetingCount > 1 ? 's' : ''}. Prepara los puntos clave antes de entrar.`,
    })
  }

  if (eveningCount >= 2) {
    insights.push({
      color: 'text-secondary',
      bg: 'bg-secondary/5',
      icon: 'nights_stay',
      label: 'TARDE OCUPADA',
      text: 'Tu tarde está cargada. Resuelve lo urgente antes del mediodía para llegar sin presión.',
    })
  }

  if (todayEvents.length === 0) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'spa',
      label: 'ESPACIO LIBRE',
      text: `Sin eventos agendados. Día ideal para ${roleLabel} profundo sin interrupciones. Usa Time Blocking.`,
    })
  } else if (todayEvents.length <= 2) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'self_improvement',
      label: 'AGENDA LIGERA',
      text: `Pocos eventos hoy. Aprovecha los bloques libres para ${roleLabel} con máxima concentración.`,
    })
  }

  if (chronotype === 'night' && h < 13) {
    insights.push({
      color: 'text-outline',
      bg: 'bg-surface-container-low',
      icon: 'bedtime',
      label: 'TU MOMENTO',
      text: 'Aún no es tu pico de energía. Haz tareas rutinarias ahora y guarda lo difícil para la noche.',
    })
  } else if (chronotype === 'morning' && h > 14) {
    insights.push({
      color: 'text-outline',
      bg: 'bg-surface-container-low',
      icon: 'wb_twilight',
      label: 'TU MOMENTO',
      text: 'Tu pico de mañana ya pasó. Es buen momento para reuniones, correos y tareas más ligeras.',
    })
  }

  if (role === 'student') {
    insights.push({
      color: 'text-secondary',
      bg: 'bg-secondary/5',
      icon: 'timer',
      label: 'TÉCNICA',
      text: 'Pomodoro activo: 25 min de estudio sin distracciones → 5 min de descanso. La ciencia lo respalda.',
    })
  } else {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'tips_and_updates',
      label: 'TIME BLOCKING',
      text: 'Divide tu día en bloques dedicados. Los estudios muestran hasta un 80% más de productividad frente a listas de tareas.',
    })
  }

  return insights.slice(0, 2)
}
