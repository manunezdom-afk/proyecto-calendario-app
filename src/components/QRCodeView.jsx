import { useEffect, useRef, useState } from 'react'

// Render de un QR code a canvas. Carga `qrcode` lazy para no inflar el
// bundle inicial — solo pesa cuando el usuario entra a "vincular otro
// dispositivo". Si la carga falla (sin red, adblock raro) o tarda demasiado
// mostramos el estado de error; el modal sigue mostrando el código manual.

function withQRTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export default function QRCodeView({ value, size = 232, className = '' }) {
  const canvasRef = useRef(null)
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      setReady(false)
      setError(false)
      // Si el value viene vacío/null, no intentamos renderizar silenciosamente —
      // marcamos error para que el consumer sepa que el QR no está disponible
      // y el código manual siga siendo el fallback visible.
      if (!value || typeof value !== 'string') {
        if (!cancelled) setError(true)
        return
      }
      if (!canvasRef.current) return
      try {
        // Timeout 6s para el import lazy del chunk qrcode — si la red está
        // flaky el chunk puede nunca llegar y la UI quedaría en el placeholder
        // pulsante para siempre.
        const mod = await withQRTimeout(import('qrcode'), 6000, 'qr_import_timeout')
        if (cancelled || !canvasRef.current) return
        const QR = mod.default || mod
        // Timeout 3s para el render propiamente dicho (no debería tardar más
        // que eso aunque la librería tenga un bug raro en iOS).
        await withQRTimeout(
          QR.toCanvas(canvasRef.current, value, {
            width: size,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
          }),
          3000,
          'qr_draw_timeout',
        )
        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) {
          console.warn('[Focus] QR render failed', err?.message || err)
          setError(true)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [value, size])

  return (
    <div
      className={`relative rounded-2xl bg-white p-3 shadow-sm border border-slate-200 ${className}`}
      style={{ width: size + 24, height: size + 24 }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: size, height: size, display: error ? 'none' : 'block' }}
        aria-label="Código QR para vincular este dispositivo"
        role="img"
      />
      {!ready && !error && (
        <div
          className="absolute inset-3 flex items-center justify-center bg-slate-50 rounded-xl animate-pulse"
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-slate-300 text-[32px]">qr_code_2</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-3 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <span className="material-symbols-outlined text-slate-400 text-[26px]">qr_code_2</span>
          <p className="text-[11px] text-slate-500 leading-snug">
            No pudimos renderizar el QR. Usa el código de abajo.
          </p>
        </div>
      )}
    </div>
  )
}
