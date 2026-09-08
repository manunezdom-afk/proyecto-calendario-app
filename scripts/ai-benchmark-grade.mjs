// Objective grader shared by all providers. Never calls a model as judge.
export function createGrader(dateContext) {
const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function resolveDateToken(token) {
  if (token == null) return null
  if (token === 'today') return dateContext.todayISO
  if (token === 'tomorrow') return dateContext.tomorrow
  if (token === '+2') return dateContext.dayAfter
  if (token.startsWith('weekday:')) {
    const day = norm(token.slice(8))
    for (const [name, iso] of Object.entries(dateContext.weekDates)) {
      if (norm(name) === day) return iso
    }
    return null
  }
  return token
}

function to24Minutes(t12) {
  const m = /^(\d{1,2}):(\d{2})\s(AM|PM)$/.exec(t12 || '')
  if (!m) return null
  let h = parseInt(m[1], 10) % 12 + (m[3] === 'PM' ? 12 : 0)
  return h * 60 + parseInt(m[2], 10)
}

function nowMinutes() {
  const [h, m] = dateContext.currentTime24.split(':').map(Number)
  return h * 60 + m
}

function classify(out) {
  const kinds = new Set()
  for (const a of out.actions) {
    if (a.type === 'add_event') kinds.add(a.event?.icon === 'alarm' ? 'reminder' : 'event')
    if (a.type === 'add_recurring_event') kinds.add('event')
    if (a.type === 'add_task') kinds.add('task')
    if (a.type === 'edit_event') kinds.add('edit')
    if (a.type === 'delete_event') kinds.add('delete')
  }
  if (out.actions.length >= 2) kinds.add('multi')
  if (out.actions.length === 0) {
    kinds.add(out.mode === 'clarification' || out.shouldAskUser ? 'clarify' : 'chat')
  }
  return kinds
}

function someActionText(out, fields, needles) {
  const haystacks = []
  for (const a of out.actions) {
    for (const f of fields) {
      if (f === 'title' && a.event?.title) haystacks.push(a.event.title)
      if (f === 'label' && a.task?.label) haystacks.push(a.task.label)
      if (f === 'subtitle' && a.event?.subtitle) haystacks.push(a.event.subtitle)
      if (f === 'location' && a.event?.location) haystacks.push(a.event.location)
      if (f === 'notes' && a.event?.notes) haystacks.push(a.event.notes)
    }
  }
  return needles.some(n => haystacks.some(h => norm(h).includes(norm(n))))
}

function evaluate(c, out) {
  // This grader measures interpretation of a plan. Destructive proposals are
  // expected to await confirmation; their presence is not a persistence receipt.
  out = { ...out, actions: [...(out.actions || []), ...(out.proposed_actions || [])] }
  const e = c.expect
  const fails = []
  const kinds = classify(out)
  const clarified = kinds.has('clarify')

  // allowClarify: una clarificación razonable cuenta como pass total.
  if (clarified && e.allowClarify) return { pass: true, fails: [], note: 'clarify aceptado' }

  const wanted = e.kind ? [e.kind] : (e.kindAnyOf || [])
  if (wanted.length > 0 && !wanted.some(k => kinds.has(k))) {
    fails.push(`kind: esperaba ${wanted.join('|')}, obtuve [${[...kinds].join(',')}]`)
  }

  if (e.minActions != null && out.actions.length < e.minActions) fails.push(`minActions: ${out.actions.length} < ${e.minActions}`)
  if (e.maxActions != null && out.actions.length > e.maxActions) fails.push(`maxActions: ${out.actions.length} > ${e.maxActions}`)

  if (e.noWrongCreate && wanted.length > 0 && !wanted.some(k => ['event', 'reminder', 'task', 'multi'].includes(k))) {
    if (out.actions.some(a => a.type === 'add_event' || a.type === 'add_task')) {
      fails.push('noWrongCreate: creó algo que no correspondía')
    }
  }

  if (e.titleIncludes && !someActionText(out, ['title', 'label'], e.titleIncludes)) fails.push(`title no contiene ${JSON.stringify(e.titleIncludes)}`)
  if (e.subtitleIncludes && !someActionText(out, ['subtitle'], e.subtitleIncludes)) fails.push(`subtitle no contiene ${JSON.stringify(e.subtitleIncludes)}`)
  if (e.subtitleOrLocationIncludes && !someActionText(out, ['subtitle', 'location', 'notes', 'title'], e.subtitleOrLocationIncludes)) fails.push(`subtitle/location no contiene ${JSON.stringify(e.subtitleOrLocationIncludes)}`)
  if (e.titleOrSubtitleIncludes && !someActionText(out, ['title', 'label', 'subtitle'], e.titleOrSubtitleIncludes)) fails.push(`title/subtitle no contiene ${JSON.stringify(e.titleOrSubtitleIncludes)}`)
  if (e.subtitleOrSecondActionIncludes) {
    const ok = someActionText(out, ['subtitle', 'notes'], e.subtitleOrSecondActionIncludes)
      || out.actions.slice(1).some(a => e.subtitleOrSecondActionIncludes.some(n => norm(a.event?.title || a.task?.label).includes(norm(n))))
      || (out.actions[0]?.event?.reminderNotes || []).some(rn => e.subtitleOrSecondActionIncludes.some(n => norm(rn).includes(norm(n))))
    if (!ok) fails.push(`detalle "${e.subtitleOrSecondActionIncludes}" no quedó como subtítulo ni acción secundaria`)
  }

  if (e.titlesInclude) {
    for (const group of e.titlesInclude) {
      if (!someActionText(out, ['title', 'label'], group)) fails.push(`falta acción con título ~ ${JSON.stringify(group)}`)
    }
  }

  const eventTimes = out.actions.map(a => a.event?.time).filter(Boolean)
  if (e.timeAnyOf && !eventTimes.some(t => e.timeAnyOf.includes(t))) fails.push(`time: esperaba ${e.timeAnyOf.join('|')}, obtuve ${eventTimes.join(',') || '(sin hora)'}`)
  if (e.timesAnyOf) {
    for (const group of e.timesAnyOf) {
      if (!eventTimes.some(t => group.includes(t))) fails.push(`falta acción a las ${group.join('|')}`)
    }
  }
  if (e.timeRelativeMinutes != null) {
    const target = (nowMinutes() + e.timeRelativeMinutes) % 1440
    const ok = eventTimes.some(t => {
      const mins = to24Minutes(t)
      if (mins == null) return false
      const diff = Math.min(Math.abs(mins - target), 1440 - Math.abs(mins - target))
      return diff <= 3
    })
    if (!ok) fails.push(`hora relativa: esperaba ahora+${e.timeRelativeMinutes}min, obtuve ${eventTimes.join(',') || '(sin hora)'}`)
  }

  if (e.date !== undefined) {
    const expected = resolveDateToken(e.date)
    const dates = out.actions.map(a => a.event?.date ?? a.task?.date ?? a.updates?.date ?? null)
    const ok = dates.some(d => (d ?? dateContext.todayISO) === expected)
    if (!ok) fails.push(`date: esperaba ${expected}, obtuve ${dates.join(',') || '(ninguna)'}`)
  }

  const firstEvent = out.actions.find(a => a.event)?.event
  if (e.endTimeNull && firstEvent && firstEvent.endTime != null) fails.push(`endTime debía ser null, fue ${firstEvent.endTime}`)
  if (e.durationMinutes != null) {
    const ok = out.actions.some(a => {
      const s = to24Minutes(a.event?.time); const f = to24Minutes(a.event?.endTime)
      if (s == null || f == null) return false
      const d = (f - s + 1440) % 1440
      return Math.abs(d - e.durationMinutes) <= 5
    })
    if (!ok) fails.push(`duración: esperaba ${e.durationMinutes}min`)
  }
  if (e.maxDurationMinutes != null) {
    const bad = out.actions.some(a => {
      const s = to24Minutes(a.event?.time); const f = to24Minutes(a.event?.endTime)
      if (s == null || f == null) return false
      return ((f - s + 1440) % 1440) > e.maxDurationMinutes
    })
    if (bad) fails.push(`duración supera máx ${e.maxDurationMinutes}min`)
  }
  if (e.reminderOffsetsInclude != null) {
    const ok = out.actions.some(a => (a.event?.reminderOffsets || a.updates?.reminderOffsets || []).includes(e.reminderOffsetsInclude))
    if (!ok) fails.push(`falta reminderOffset ${e.reminderOffsetsInclude}`)
  }
  if (e.targetId) {
    const ok = out.actions.some(a => a.id === e.targetId)
    if (!ok) fails.push(`targetId: esperaba ${e.targetId}`)
  }
  if (e.updateTime) {
    const ok = out.actions.some(a => a.updates?.time === e.updateTime)
    if (!ok) fails.push(`updates.time: esperaba ${e.updateTime}`)
  }
  if (e.updateDate !== undefined) {
    const expected = resolveDateToken(e.updateDate)
    const ok = out.actions.some(a => a.updates?.date === expected)
    if (!ok) fails.push(`updates.date: esperaba ${expected}`)
  }
  if (e.replyIncludes && !e.replyIncludes.some(n => norm(out.reply).includes(norm(n)))) {
    fails.push(`reply no menciona ${JSON.stringify(e.replyIncludes)}`)
  }

  // Tono: ninguna respuesta debe sonar a bot técnico.
  const robotic = ['intención detectada', 'procediendo a', 'parámetro temporal', 'entidad temporal', 'según mis parámetros', 'no puedo realizar esa acción']
  if (robotic.some(r => norm(out.reply).includes(norm(r)))) fails.push(`reply robótico: "${out.reply.slice(0, 80)}"`)

  return { pass: fails.length === 0, fails, note: '' }
}


return { evaluate, resolveDateToken };
}
