import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Modal full-screen que abre la cámara y escanea un QR. Cuando detecta un
// código válido llama onDetect(rawValue). El caller decide qué hacer con el
// valor (extractUserCodeFromScanned + approve).
//
// Usa BarcodeDetector nativo cuando está disponible (Chrome/Edge/Safari 17+,
// Chrome Android). Para navegadores sin soporte mostramos un fallback que
// guía al usuario a la cámara nativa del sistema o a tipear el código.
//
// Notas:
//   · `facingMode: 'environment'` para usar la cámara trasera en móvil.
//   · Detectamos con requestAnimationFrame para que el usuario vea el video
//     en tiempo real con mínima latencia de decodificación.
//   · Cerramos la cámara al desmontar SIEMPRE para no dejar el LED verde.

const HAS_BARCODE_DETECTOR =
  typeof window !== 'undefined' && 'BarcodeDetector' in window

export default function QRScannerSheet({ isOpen, onDetect, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const detectorRef = useRef(null)
  const rafRef = useRef(null)
  const [status, setStatus] = useState('init') // init | scanning | denied | no_support | error
  const [errorDetail, setErrorDetail] = useState('')

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null } catch {}
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function start() {
      setStatus('init')
      setErrorDetail('')

      if (!HAS_BARCODE_DETECTOR) {
        setStatus('no_support')
        return
      }
      if (!navigator?.mediaDevices?.getUserMedia) {
        setStatus('no_support')
        return
      }

      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] })
      } catch (err) {
        setStatus('no_support')
        setErrorDetail(String(err?.message || err))
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // playsInline + muted + play dentro del gesto que abrió el sheet
          // (el click del botón) satisface a iOS Safari.
          videoRef.current.muted = true
          await videoRef.current.play().catch(() => {})
        }
        setStatus('scanning')
        scanLoop()
      } catch (err) {
        if (cancelled) return
        const name = err?.name || ''
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied')
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('error')
          setErrorDetail('No se encontró una cámara disponible.')
        } else {
          setStatus('error')
          setErrorDetail(String(err?.message || err))
        }
      }
    }

    function scanLoop() {
      if (cancelled) return
      const video = videoRef.current
      const detector = detectorRef.current
      if (!video || !detector) return

      ;(async () => {
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video)
            if (codes && codes[0]?.rawValue) {
              const value = codes[0].rawValue
              stopCamera()
              if (!cancelled) onDetect?.(value)
              return
            }
          }
        } catch {
          // detect() puede throwear si el frame aún no está listo; seguimos.
        }
        if (!cancelled) rafRef.current = requestAnimationFrame(scanLoop)
      })()
    }

    start()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [isOpen, onDetect, stopCamera])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[90] bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Escanear código QR"
        >
          {/* Video en el fondo */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: status === 'scanning' ? 'block' : 'none' }}
          />

          {/* Overlay con máscara y cuadro objetivo */}
          {status === 'scanning' && (
            <>
              <div className="absolute inset-0 bg-black/40 pointer-events-none" />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white/90 rounded-3xl"
                style={{ width: 'min(72vw, 280px)', height: 'min(72vw, 280px)', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}
              >
                <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{
                  boxShadow: 'inset 0 0 0 4px rgba(59,130,246,0.35)',
                }} />
              </div>
              <p className="absolute left-1/2 -translate-x-1/2 bottom-32 text-white/90 text-[13px] font-medium text-center px-6">
                Apunta al QR del otro dispositivo
              </p>
            </>
          )}

          {/* Estados alternativos */}
          {status === 'init' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-8 gap-3">
              <span className="material-symbols-outlined text-[36px] animate-pulse">qr_code_scanner</span>
              <p className="text-[14px] font-semibold">Iniciando cámara…</p>
            </div>
          )}

          {status === 'denied' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-8 gap-4">
              <span className="material-symbols-outlined text-[40px] text-amber-400">videocam_off</span>
              <div>
                <p className="text-[15px] font-bold">Permiso de cámara denegado</p>
                <p className="text-[12.5px] text-white/70 mt-1 leading-snug">
                  Actívalo en Ajustes del sistema → Focus → Cámara, y vuelve a intentar.
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-full bg-white/10 border border-white/20 text-[13px] font-semibold"
              >
                Cerrar
              </button>
            </div>
          )}

          {status === 'no_support' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-8 gap-4">
              <span className="material-symbols-outlined text-[40px] text-white/70">qr_code_scanner</span>
              <div>
                <p className="text-[15px] font-bold">Escaneo no disponible</p>
                <p className="text-[12.5px] text-white/70 mt-1 leading-snug">
                  Tu navegador no soporta escaneo de QR. Usa la cámara del teléfono para leer el QR, o escribe el código de 8 caracteres a mano.
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-full bg-white/10 border border-white/20 text-[13px] font-semibold"
              >
                Escribir el código
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-8 gap-4">
              <span className="material-symbols-outlined text-[40px] text-amber-400">error</span>
              <div>
                <p className="text-[15px] font-bold">No pudimos abrir la cámara</p>
                {errorDetail && (
                  <p className="text-[11.5px] text-white/60 mt-1 leading-snug break-words">{errorDetail}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-full bg-white/10 border border-white/20 text-[13px] font-semibold"
              >
                Cerrar
              </button>
            </div>
          )}

          {/* Botón de cerrar siempre visible */}
          <button
            onClick={onClose}
            aria-label="Cerrar escáner"
            className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm active:scale-95 transition-transform"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
