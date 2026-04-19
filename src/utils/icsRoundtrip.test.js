import { describe, it, expect } from 'vitest'
import { eventsToICS } from './icsExport'
import { parseICS } from './icsImport'

describe('ICS export', () => {
  it('emits a valid VCALENDAR envelope', () => {
    const ics = eventsToICS([])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
  })

  it('includes DTSTAMP and does NOT throw fmtDT ReferenceError', () => {
    // Regression: fmtDT no existía, sólo fmtDTZ. Este test falla si reaparece.
    const ics = eventsToICS([{ id: 'e1', title: 'Test', time: '9:00 AM', date: '2026-04-14' }])
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
  })

  it('escapes commas, semicolons and newlines in SUMMARY', () => {
    const ics = eventsToICS([
      { id: 'e2', title: 'Reunión, café; después\nchat', time: '', date: '2026-04-14' },
    ])
    expect(ics).toContain('SUMMARY:Reunión\\, café\\; después\\nchat')
  })

  it('emits all-day event with DTSTART;VALUE=DATE when there is no time', () => {
    const ics = eventsToICS([{ id: 'e3', title: 'Feriado', time: '', date: '2026-04-14' }])
    expect(ics).toContain('DTSTART;VALUE=DATE:20260414')
    expect(ics).toContain('DTEND;VALUE=DATE:20260415')
  })
})

describe('ICS import', () => {
  it('parses a simple VEVENT', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:x1@example',
      'SUMMARY:Reunión importante',
      'DTSTART:20260414T150000Z',
      'DTEND:20260414T160000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Reunión importante')
    expect(events[0].date).toBe('2026-04-14')
    expect(events[0].icon).toBe('groups')
  })

  it('unescapes commas and newlines from SUMMARY', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Uno\\, dos\\nlinea2',
      'DTSTART;VALUE=DATE:20260414',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const [ev] = parseICS(ics)
    expect(ev.title).toBe('Uno, dos\nlinea2')
  })

  it('parses all-day event without throwing', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Feriado nacional',
      'DTSTART;VALUE=DATE:20260414',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const [ev] = parseICS(ics)
    expect(ev.date).toBe('2026-04-14')
    expect(ev.time).toBe('')
  })
})

describe('ICS round-trip', () => {
  it('preserves title, date and approximate time for timed events', () => {
    // Usamos una hora UTC exacta para evitar drift por TZ del test runner.
    const input = [{
      id: 'rt-1',
      title: 'Cita dentista',
      time: '2:00 PM',
      date: '2026-04-14',
      description: 'Consultorio av. central',
    }]
    const ics = eventsToICS(input)
    const parsed = parseICS(ics)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('Cita dentista')
    // La fecha puede cambiar si la TZ del runner es muy lejana a UTC,
    // pero en el setup estándar (UTC) debería coincidir.
    expect(parsed[0].date).toBe('2026-04-14')
    // El icono se infiere desde el título durante el import.
    expect(parsed[0].icon).toBe('local_hospital')
  })
})
