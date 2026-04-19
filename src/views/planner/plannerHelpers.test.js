import { describe, it, expect } from 'vitest'
import {
  parseTimeToDecimal,
  formatMinutes,
  eventTimeToBlockTime,
  normalizeTitleKey,
  extractReminderMeta,
  titleTokenSet,
  jaccard,
  looksLikeReminderTitle,
} from './plannerHelpers'

describe('parseTimeToDecimal (grid parser)', () => {
  it('parses HH:MM 24h', () => {
    expect(parseTimeToDecimal('09:00')).toBe(9)
    expect(parseTimeToDecimal('14:30')).toBe(14.5)
  })
  it('returns null for empty/invalid', () => {
    expect(parseTimeToDecimal('')).toBeNull()
    expect(parseTimeToDecimal('—')).toBeNull()
    expect(parseTimeToDecimal('abc')).toBeNull()
  })
})

describe('formatMinutes', () => {
  it('returns "ahora" for less than a minute', () => {
    expect(formatMinutes(0)).toBe('ahora')
    expect(formatMinutes(0.4)).toBe('ahora')
  })
  it('minutes under an hour', () => {
    expect(formatMinutes(10)).toBe('10 min')
    expect(formatMinutes(59.6)).toBe('60 min')
  })
  it('hours', () => {
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(125)).toBe('2h 5m')
    expect(formatMinutes(180)).toBe('3h')
  })
})

describe('eventTimeToBlockTime', () => {
  it('passes through 24h format with padding', () => {
    expect(eventTimeToBlockTime('9:30')).toBe('09:30')
    expect(eventTimeToBlockTime('14:00')).toBe('14:00')
  })
  it('converts 12h AM/PM to 24h', () => {
    expect(eventTimeToBlockTime('9:00 AM')).toBe('09:00')
    expect(eventTimeToBlockTime('3:30 PM')).toBe('15:30')
    expect(eventTimeToBlockTime('12:00 AM')).toBe('00:00')
    expect(eventTimeToBlockTime('12:00 PM')).toBe('12:00')
  })
  it('handles ranges (uses start)', () => {
    expect(eventTimeToBlockTime('2:00 PM - 3:30 PM')).toBe('14:00')
  })
  it('returns em-dash for unparseable', () => {
    expect(eventTimeToBlockTime('')).toBe('—')
    expect(eventTimeToBlockTime('nope')).toBe('—')
  })
})

describe('normalizeTitleKey', () => {
  it('lowercases and strips accents and extra spaces', () => {
    expect(normalizeTitleKey('  Reunión  con Ana ')).toBe('reunion con ana')
  })
})

describe('extractReminderMeta', () => {
  it('detects "Recordatorio: X"', () => {
    const r = extractReminderMeta('Recordatorio: Clase de Historia')
    expect(r.isReminder).toBe(true)
    expect(r.parentTitle).toBe('Clase de Historia')
  })
  it('detects "X — recordatorio"', () => {
    const r = extractReminderMeta('Clase de Historia — recordatorio 10 min')
    expect(r.isReminder).toBe(true)
    expect(r.parentTitle).toBe('Clase de Historia')
  })
  it('returns false for non-reminder', () => {
    const r = extractReminderMeta('Almuerzo')
    expect(r.isReminder).toBe(false)
  })
})

describe('titleTokenSet + jaccard similarity', () => {
  it('computes similarity ignoring stop-words', () => {
    const a = titleTokenSet('Reunión con el equipo de producto')
    const b = titleTokenSet('Reunión de producto con equipo')
    // sharing "reunion", "equipo", "producto" → similarity 1
    expect(jaccard(a, b)).toBe(1)
  })
  it('jaccard 0 when disjoint', () => {
    const a = titleTokenSet('Gym cardio')
    const b = titleTokenSet('Dentista consulta')
    expect(jaccard(a, b)).toBe(0)
  })
})

describe('looksLikeReminderTitle', () => {
  it('flags imperative checklist titles', () => {
    expect(looksLikeReminderTitle('Recordar enviar email')).toBe(true)
    expect(looksLikeReminderTitle('Pagar cuenta de luz')).toBe(true)
    expect(looksLikeReminderTitle('Check presentación')).toBe(true)
  })
  it('does not flag calendar events', () => {
    expect(looksLikeReminderTitle('Almuerzo con mamá')).toBe(false)
    expect(looksLikeReminderTitle('Gym')).toBe(false)
  })
})
