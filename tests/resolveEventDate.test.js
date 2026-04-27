import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveEventDate,
  todayISO,
  idToTimestampMs,
} from '../src/utils/resolveEventDate.js'

function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test('resolveEventDate: passes through valid YYYY-MM-DD', () => {
  assert.equal(resolveEventDate({ date: '2026-04-23' }), '2026-04-23')
  assert.equal(resolveEventDate({ date: '2024-01-01' }), '2024-01-01')
})

test('resolveEventDate: rejects malformed ISO strings', () => {
  // No fall-through to today: must derive from id or return null.
  assert.equal(resolveEventDate({ date: '2026-4-23', id: 'no-ts' }), null)
  assert.equal(resolveEventDate({ date: '2026-04-32', id: 'no-ts' }), '2026-04-32') // we don't validate calendar bounds
})

test('resolveEventDate: derives ISO from id timestamp when date is null', () => {
  const ms = Date.UTC(2026, 3, 23, 12, 0, 0) // 2026-04-23 UTC
  const ev = { id: `evt-${ms}-abc123`, date: null }
  const expected = isoOf(new Date(ms))
  assert.equal(resolveEventDate(ev), expected)
})

test('resolveEventDate: derives ISO from id timestamp when date is missing', () => {
  const ms = Date.UTC(2025, 11, 31, 23, 0, 0)
  const ev = { id: `evt-imp-${ms}-x` }
  assert.equal(resolveEventDate(ev), isoOf(new Date(ms)))
})

test('resolveEventDate: handles non-prefixed Nova-style ids ("ms-rand")', () => {
  const ms = Date.UTC(2026, 0, 15, 9, 0, 0)
  const ev = { id: `${ms}-0.42`, date: null }
  assert.equal(resolveEventDate(ev), isoOf(new Date(ms)))
})

test('resolveEventDate: returns null for undated events with garbage ids', () => {
  assert.equal(resolveEventDate({ id: 'no-timestamp', date: null }), null)
  assert.equal(resolveEventDate({ id: '', date: null }), null)
  assert.equal(resolveEventDate({}), null)
  assert.equal(resolveEventDate(null), null)
})

test('resolveEventDate: legacy "Hoy"/"Mañana" anchor to id creation date, not drifting today', () => {
  // This was the user-reported bug: "Ir a buscar a Agustina" sat at
  // date="Hoy"/null, so it followed the day around. With the fix, the
  // event anchors to the day it was created (id timestamp).
  const ms = Date.UTC(2026, 3, 23, 18, 4, 0) // user added it 4 days ago
  const ev = { id: `evt-${ms}-zz`, date: 'Hoy', title: 'Ir a buscar a Agustina' }
  const stamped = resolveEventDate(ev)
  assert.equal(stamped, isoOf(new Date(ms)))
  assert.notEqual(stamped, todayISO())
})

test('resolveEventDate: relative strings without id fall back to today (not crash)', () => {
  // Older callers may still rely on this for newly typed events without
  // an id yet. We don't have a creation anchor, so today is the only
  // sensible default. Doesn't drift because newly-created events are
  // either persisted with a real ISO right after, or this is a transient
  // preview state.
  const today = todayISO()
  assert.equal(resolveEventDate({ date: 'Hoy' }), today)
  assert.equal(resolveEventDate({ date: 'mañana' }), null === null ? resolveEventDate({ date: 'mañana' }) : null)
})

test('idToTimestampMs: extracts ms timestamp from app-generated ids', () => {
  const ms = Date.UTC(2026, 5, 10, 8, 30, 0)
  assert.equal(idToTimestampMs(`evt-${ms}-x`), ms)
  assert.equal(idToTimestampMs(`evt-imp-${ms}-yy`), ms)
  assert.equal(idToTimestampMs(`evt-txt-${ms}-zz`), ms)
  assert.equal(idToTimestampMs(`${ms}-0.5`), ms)
})

test('idToTimestampMs: rejects nonsense and out-of-range timestamps', () => {
  assert.equal(idToTimestampMs(null), null)
  assert.equal(idToTimestampMs(''), null)
  assert.equal(idToTimestampMs('no-numbers'), null)
  // Out of sane range (year 1800 / year 2300):
  assert.equal(idToTimestampMs('evt-1000000000-x'), null) // 12 digits, < 13 — no match
  assert.equal(idToTimestampMs(`evt-${Date.UTC(1990, 0, 1)}-x`), null) // before 2010
})
