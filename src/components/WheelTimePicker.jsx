import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// WheelTimePicker
//
// Replica el time picker "wheel" de iOS (el que ves en Reloj → alarmas):
// dos columnas verticales con scroll-snap, fila del centro resaltada con
// una cápsula translúcida, números alejados del centro desvanecidos con
// un mask-image de gradiente. Haptic tick con navigator.vibrate en cada
// cambio de índice durante el scroll (Android/soportado), silencioso en
// iOS Safari donde vibrate no existe.
//
// Uso:
//   <WheelTimePicker
//      initialValue="09:00"
//      onChange={(hm) => setTime(hm)}   // "HH:MM" en 24h
//      minuteStep={1}                   // 1 | 5 | 15 | 30…
//   />
//
// Controlado por dentro (uncontrolled para el padre): el padre lee el
// valor por onChange. Cambiar initialValue después de mount no reubica
// el wheel — es valor inicial, no prop controlada.

const ROW_H = 44
const VISIBLE = 7
const COL_H = ROW_H * VISIBLE // 308 px de alto total de cada columna

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

export function parseTimeToHM(s, fallback = { h: 9, m: 0 }) {
  if (!s || typeof s !== 'string') return fallback
  const first = s.split('-')[0].trim()
  const m24 = first.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) return { h: clamp(parseInt(m24[1], 10), 0, 23), m: clamp(parseInt(m24[2], 10), 0, 59) }
  const m12 = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const mm = parseInt(m12[2] ?? '0', 10)
    const ap = m12[3].toUpperCase()
    if (h === 12) h = 0
    if (ap === 'PM') h += 12
    return { h: clamp(h, 0, 23), m: clamp(mm, 0, 59) }
  }
  return fallback
}

export function formatTime12(h, m) {
  const ap = h >= 12 ? 'PM' : 'AM'
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

export function formatTime24(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function WheelColumn({ items, selectedIndex, onChange, ariaLabel }) {
  const ref = useRef(null)
  const lastIdxRef = useRef(selectedIndex)
  const debounceRef = useRef(null)

  // Posicionar inicialmente sin animación — sincronizado con el layout
  // para evitar un flash del primer item antes de asentarse.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = selectedIndex * ROW_H
    lastIdxRef.current = selectedIndex
    // iOS Safari a veces ignora el scrollTop inicial si el layout aún no
    // terminó. Reintentamos en el siguiente frame como seguro.
    requestAnimationFrame(() => {
      if (el.scrollTop !== selectedIndex * ROW_H) {
        el.scrollTop = selectedIndex * ROW_H
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cambio externo → scroll suave al nuevo índice
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = selectedIndex * ROW_H
    if (Math.abs(el.scrollTop - target) > 2) {
      el.scrollTo({ top: target, behavior: 'smooth' })
    }
    lastIdxRef.current = selectedIndex
  }, [selectedIndex])

  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Tick en vivo: cuando el scroll cruza un item, vibramos. Sirve para
    // dar sensación de "clicks" mientras el usuario mueve el dedo.
    const liveIdx = clamp(Math.round(el.scrollTop / ROW_H), 0, items.length - 1)
    if (liveIdx !== lastIdxRef.current) {
      lastIdxRef.current = liveIdx
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(4) } catch {}
      }
    }
    // Debounce: después de ~120 ms sin scroll asumimos que el snap asentó
    // y emitimos onChange con el índice final.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const finalIdx = clamp(Math.round(el.scrollTop / ROW_H), 0, items.length - 1)
      if (finalIdx !== selectedIndex) onChange(finalIdx)
    }, 120)
  }, [items.length, onChange, selectedIndex])

  return (
    <div className="relative flex-1 select-none" style={{ height: COL_H }}>
      <div
        ref={ref}
        role="listbox"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className="wheel-col h-full overflow-y-auto overscroll-contain"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          maskImage: 'linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)',
        }}
      >
        {/* Padding equivalente a 3 filas para que el primer item pueda
            centrarse (y el último también). */}
        <div aria-hidden style={{ height: ROW_H * 3 }} />
        {items.map((it, i) => (
          <div
            key={i}
            role="option"
            aria-selected={i === selectedIndex}
            className="flex items-center justify-center tabular-nums text-[28px] font-semibold text-on-surface"
            style={{
              height: ROW_H,
              scrollSnapAlign: 'center',
            }}
          >
            {it}
          </div>
        ))}
        <div aria-hidden style={{ height: ROW_H * 3 }} />
      </div>
      {/* Cápsula de selección — detrás de los números, centrada */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1 right-1 top-1/2 -translate-y-1/2 rounded-2xl bg-on-surface/[0.06]"
        style={{ height: ROW_H }}
      />
    </div>
  )
}

export default function WheelTimePicker({ initialValue = '09:00', onChange, minuteStep = 1 }) {
  const parsed = parseTimeToHM(initialValue, { h: 9, m: 0 })
  // Snappeamos el minuto inicial al step (ej: si viene 37 con step 15 → 30)
  const snappedM = clamp(Math.round(parsed.m / minuteStep) * minuteStep, 0, 60 - minuteStep)
  const [hour, setHour] = useState(parsed.h)
  const [minute, setMinute] = useState(snappedM)

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
  const minutes = Array.from(
    { length: Math.floor(60 / minuteStep) },
    (_, i) => String(i * minuteStep).padStart(2, '0'),
  )
  const minuteIdx = Math.round(minute / minuteStep)

  useEffect(() => {
    onChange?.(formatTime24(hour, minute), { hour, minute })
  }, [hour, minute]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{`
        .wheel-col::-webkit-scrollbar { display: none; }
        .wheel-col { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
      <div className="flex items-center justify-center gap-1">
        <WheelColumn
          items={hours}
          selectedIndex={hour}
          onChange={setHour}
          ariaLabel="Hora"
        />
        <WheelColumn
          items={minutes}
          selectedIndex={minuteIdx}
          onChange={(idx) => setMinute(idx * minuteStep)}
          ariaLabel="Minutos"
        />
      </div>
    </>
  )
}
