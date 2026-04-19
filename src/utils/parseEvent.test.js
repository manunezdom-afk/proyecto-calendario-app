import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseEvent } from './parseEvent'

// Fijamos "hoy" en un punto conocido para tests estables.
const FROZEN = new Date(2026, 3, 14, 10, 0, 0) // 2026-04-14 10:00 local

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FROZEN)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('parseEvent — colloquial Spanish', () => {
  it('parses "reunion a las 5 de la tarde"', () => {
    const r = parseEvent('reunion a las 5 de la tarde')
    expect(r.time).toBe('5:00 PM')
    expect(r.section).toBe('evening')
    expect(r.icon).toBe('groups')
  })

  it('parses "gym mañana a las 7 de la mañana" → tomorrow', () => {
    const r = parseEvent('gym mañana a las 7 de la mañana')
    expect(r.time).toBe('7:00 AM')
    expect(r.date).toBe('2026-04-15')
    expect(r.icon).toBe('fitness_center')
  })

  it('parses "almuerzo hoy a las 13"', () => {
    const r = parseEvent('almuerzo hoy a las 13')
    expect(r.time).toMatch(/1:00 PM/)
    expect(r.date).toBe('2026-04-14')
    expect(r.icon).toBe('restaurant')
  })

  it('parses "reunion a las 5 y media"', () => {
    const r = parseEvent('reunion a las 5 y media de la tarde')
    expect(r.time).toBe('5:30 PM')
  })

  it('strips command prefixes ("acuérdame de...")', () => {
    const r = parseEvent('acuérdame de estudiar mañana a las 4 pm')
    expect(r.title.toLowerCase()).toContain('estudiar')
    expect(r.time).toBe('4:00 PM')
    expect(r.date).toBe('2026-04-15')
  })

  it('handles morning context ("levantarme")', () => {
    // "a las 6" con contexto madrugador → AM
    const r = parseEvent('levantarme a las 6')
    expect(r.time).toMatch(/6:00 AM/)
    expect(r.icon).toBe('alarm')
  })

  it('returns empty time for input without hour', () => {
    const r = parseEvent('comprar leche')
    expect(r.time).toBe('')
    expect(r.date).toBe('2026-04-14') // today fallback
  })

  it('does not crash on empty input', () => {
    expect(() => parseEvent('')).not.toThrow()
    expect(() => parseEvent(null)).not.toThrow()
  })
})
