import { describe, it, expect, vi, beforeEach } from 'vitest'
import { iosVersionSupportsPush } from './iosPushSupport'

// La mayoría de helpers dependen de `navigator.userAgent` y `window.matchMedia`,
// que son estables bajo happy-dom. Aquí testeamos la parte que es pura
// (version check) — el resto sería testing del User-Agent del runner, no útil.

describe('iosVersionSupportsPush', () => {
  it('returns false for null or missing version', () => {
    expect(iosVersionSupportsPush(null)).toBe(false)
    expect(iosVersionSupportsPush(undefined)).toBe(false)
  })
  it('returns false for iOS 15.x', () => {
    expect(iosVersionSupportsPush({ major: 15, minor: 0, patch: 0 })).toBe(false)
    expect(iosVersionSupportsPush({ major: 15, minor: 7, patch: 3 })).toBe(false)
  })
  it('returns false for iOS 16.3 and below', () => {
    expect(iosVersionSupportsPush({ major: 16, minor: 0, patch: 0 })).toBe(false)
    expect(iosVersionSupportsPush({ major: 16, minor: 3, patch: 9 })).toBe(false)
  })
  it('returns true for iOS 16.4', () => {
    expect(iosVersionSupportsPush({ major: 16, minor: 4, patch: 0 })).toBe(true)
    expect(iosVersionSupportsPush({ major: 16, minor: 4, patch: 2 })).toBe(true)
  })
  it('returns true for iOS 17+', () => {
    expect(iosVersionSupportsPush({ major: 17, minor: 0, patch: 0 })).toBe(true)
    expect(iosVersionSupportsPush({ major: 18, minor: 2, patch: 1 })).toBe(true)
  })
})
