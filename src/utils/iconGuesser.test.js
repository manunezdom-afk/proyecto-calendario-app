import { describe, it, expect } from 'vitest'
import { guessIcon, norm } from './iconGuesser'

describe('norm', () => {
  it('lowercases and strips accents', () => {
    expect(norm('Fútbol')).toBe('futbol')
    expect(norm('Reunión')).toBe('reunion')
    expect(norm('café')).toBe('cafe')
  })
  it('handles null/undefined without throwing', () => {
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
    expect(norm('')).toBe('')
  })
})

describe('guessIcon', () => {
  it('detects sport activities', () => {
    expect(guessIcon('Fútbol con los chicos')).toBe('fitness_center')
    expect(guessIcon('Gym 7am')).toBe('fitness_center')
    expect(guessIcon('Crossfit intenso')).toBe('fitness_center')
  })
  it('detects meetings', () => {
    expect(guessIcon('Reunión con Ana')).toBe('groups')
    expect(guessIcon('Zoom con el equipo')).toBe('groups')
    expect(guessIcon('1on1 Carlos')).toBe('groups')
  })
  it('detects meals', () => {
    expect(guessIcon('Almuerzo con mamá')).toBe('restaurant')
    expect(guessIcon('Cena en el centro')).toBe('restaurant')
  })
  it('detects study activities', () => {
    expect(guessIcon('Estudiar para el parcial')).toBe('menu_book')
    expect(guessIcon('Clase de Cálculo')).toBe('menu_book')
  })
  it('detects alarms', () => {
    expect(guessIcon('Levantarme temprano')).toBe('alarm')
  })
  it('falls back to event for unknown text', () => {
    expect(guessIcon('Llenar tanque del auto')).toBe('event')
    expect(guessIcon('')).toBe('event')
    expect(guessIcon(null)).toBe('event')
  })
  it('is case and accent insensitive', () => {
    expect(guessIcon('CUMPLEAÑOS')).toBe('cake')
    expect(guessIcon('cumpleanos')).toBe('cake')
  })
})
