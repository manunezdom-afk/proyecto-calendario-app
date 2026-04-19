import { describe, it, expect } from 'vitest'
import {
  toISODate, todayISO, tomorrowISO,
  parseTimeToDecimal, formatHour12, formatHour24, parseEventHour,
} from './dateHelpers'

describe('toISODate', () => {
  it('formats a date as YYYY-MM-DD in local TZ', () => {
    expect(toISODate(new Date(2026, 3, 14))).toBe('2026-04-14')
    expect(toISODate(new Date(2026, 11, 1))).toBe('2026-12-01')
  })
  it('pads single digits', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('todayISO / tomorrowISO', () => {
  it('returns proper ISO strings', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(tomorrowISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('tomorrow is one day after today', () => {
    const t = new Date(todayISO() + 'T00:00:00').getTime()
    const tm = new Date(tomorrowISO() + 'T00:00:00').getTime()
    expect(tm - t).toBe(86400000)
  })
})

describe('parseTimeToDecimal', () => {
  it('parses 12h with AM/PM', () => {
    expect(parseTimeToDecimal('9:00 AM')).toBe(9)
    expect(parseTimeToDecimal('9:30 AM')).toBe(9.5)
    expect(parseTimeToDecimal('3:00 PM')).toBe(15)
    expect(parseTimeToDecimal('12:00 AM')).toBe(0)
    expect(parseTimeToDecimal('12:00 PM')).toBe(12)
  })
  it('parses 12h without minutes ("7pm")', () => {
    expect(parseTimeToDecimal('7pm')).toBe(19)
    expect(parseTimeToDecimal('9am')).toBe(9)
  })
  it('parses 24h', () => {
    expect(parseTimeToDecimal('09:00')).toBe(9)
    expect(parseTimeToDecimal('14:30')).toBe(14.5)
    expect(parseTimeToDecimal('23:59')).toBeCloseTo(23.9833, 3)
  })
  it('parses h format ("14h30")', () => {
    expect(parseTimeToDecimal('14h30')).toBe(14.5)
    expect(parseTimeToDecimal('9h')).toBe(9)
  })
  it('returns start of a range', () => {
    expect(parseTimeToDecimal('9:00 - 10:00')).toBe(9)
    expect(parseTimeToDecimal('9:00 – 10:30')).toBe(9)
  })
  it('returns null for invalid input', () => {
    expect(parseTimeToDecimal('')).toBeNull()
    expect(parseTimeToDecimal(null)).toBeNull()
    expect(parseTimeToDecimal('hoy')).toBeNull()
  })
})

describe('formatHour12 / formatHour24', () => {
  it('formats 12h properly', () => {
    expect(formatHour12(9)).toBe('9:00 AM')
    expect(formatHour12(15.5)).toBe('3:30 PM')
    expect(formatHour12(0)).toBe('12:00 AM')
    expect(formatHour12(12)).toBe('12:00 PM')
  })
  it('formats 24h with zero pad', () => {
    expect(formatHour24(9)).toBe('09:00')
    expect(formatHour24(14.5)).toBe('14:30')
  })
  it('handles null', () => {
    expect(formatHour12(null)).toBe('')
    expect(formatHour24(null)).toBe('')
  })
})

describe('parseEventHour', () => {
  it('returns integer hour', () => {
    expect(parseEventHour('9:30 AM')).toBe(9)
    expect(parseEventHour('14:30')).toBe(14)
    expect(parseEventHour('3:45 PM')).toBe(15)
  })
  it('returns null for invalid', () => {
    expect(parseEventHour('')).toBeNull()
    expect(parseEventHour('abc')).toBeNull()
  })
})
