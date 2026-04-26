import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { parseEvent } from '../utils/parseEvent'
import {
  DURATION_CHIPS,
  composeTimeRange,
  NO_END_TIME_LABEL,
  findOverlappingEvents,
} from '../utils/eventDuration'
import { useAppPreferences } from '../hooks/useAppPreferences'
import { useVoiceDictation } from '../hooks/useVoiceDictation'
import { isIOSSafari } from '../lib/permissions'
import { pushModal, popModal } from '../utils/modalStack'
import MicButton from './MicButton'

const EXAMPLES = [
  '"futbol a las 5"',
  '"reunión mañana a las 10"',
  '"gym a las 6 de la tarde"',
  '"almuerzo al mediodía"',
  '"cena con mamá a las 8"',
]

export default function QuickAddSheet({ onSave, onCancel, targetDate, targetDateLabel, initialText = '', existingEvents = [] }) {
  const [input, setInput] = useState(initialText)
  const [parsed, setParsed] = useState(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  // Duración elegida por el usuario en esta sesión del sheet. null significa
  // "sin seleccionar aún"; 0 = sin hora de término (explícito); >0 = minutos.
  const [chosenDuration, setChosenDuration] = useState(null)
  // Mensaje cuando el dictado falla por permiso/no-soporte. Se muestra debajo
  // del input. Nullable; se limpia al teclear o reintentar.
  const [voiceError, setVoiceError] = useState(null)
  const inputRef = useRef(null)
  const { prefs } = useAppPreferences()

  // Dictado por voz. El usuario puede llenar el input hablando y luego
  // confirmar con "Añadir" — la NLP corre igual sobre lo dictado, así que
  // "futbol mañana a las 5" funciona dictado o tipeado.
  const dictation = useVoiceDictation({
    onTranscript: (text) => setInput(text),
    onFinalize:   (text) => setInput(text),
    onError: (code) => {
      if (code === 'unsupported') {
        setVoiceError(
          isIOSSafari()
            ? 'En iPhone puedes dictar con el micrófono del teclado: pulsa el icono sobre el teclado.'
            : 'Este navegador no soporta dictado por voz. Escribe el evento.',
        )
      } else if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceError(
          isIOSSafari()
            ? 'En iPhone, si el dictado web no arranca usa el micrófono del teclado.'
            : 'Permiso de micrófono denegado. Ábrelo en los ajustes del sistema.',
        )
      } else if (code === 'audio-capture') {
        setVoiceError('No se pudo acceder al micrófono. Otra app puede estar usándolo.')
      }
    },
  })

  // Cycle placeholder examples
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(id)
  }, [])

  // Auto-focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  // Registramos el sheet como modal activo para que los flotantes (Nova pill,
  // FABs) se escondan mientras esté abierto. Se desregistra al desmontar.
  useEffect(() => {
    pushModal()
    return () => popModal()
  }, [])

  // Live NLP parse as the user types
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed.length < 3) {
      setParsed(null)
      setChosenDuration(null)
      return
    }
    const result = parseEvent(trimmed)
    setParsed(result)
    // Reset choice cuando el usuario cambia el texto — evita arrastrar una
    // duración que ya no aplica (ej: cambió el título de reunión a cena).
    setChosenDuration(null)
  }, [input])

  // ¿El usuario fue explícito en la duración dentro del texto?
  const hasExplicitDuration = parsed?.durationMinutes != null
  // ¿Inferimos una duración con alta/media confianza para ese tipo de evento?
  const hasConfidentInference =
    parsed?.inferredDurationMinutes != null &&
    (parsed.inferredConfidence === 'high' || parsed.inferredConfidence === 'medium')

  // ¿Necesitamos preguntar duración antes de guardar?
  // 1) Solo si ya hay una hora de inicio parseada (sin hora, la duración no
  //    aplica — el evento es "flexible").
  // 2) El texto no fue explícito sobre duración.
  // 3) La preferencia del usuario es "preguntar" (ask) O no pudimos inferir
  //    con confianza razonable.
  const needsDurationStep = Boolean(
    parsed?.startTime &&
    !hasExplicitDuration &&
    prefs.defaultDurationBehavior === 'ask'
  )

  // Chip inicial sugerido según inferencia (destaca visualmente el más
  // probable sin auto-confirmar — el usuario sigue decidiendo).
  const suggestedMinutes = hasConfidentInference ? parsed.inferredDurationMinutes : null

  function resolveFinalTime() {
    if (!parsed) return ''
    // Si el parser ya compuso un rango (duración explícita), úsalo tal cual.
    if (hasExplicitDuration) return parsed.time
    // Si el usuario eligió un chip en este sheet, componer con eso.
    if (chosenDuration !== null) {
      if (chosenDuration === 0) return parsed.startTime
      return composeTimeRange(parsed.startTime, chosenDuration)
    }
    // Fallback según preferencia del usuario (default30 / none / ask).
    if (prefs.defaultDurationBehavior === 'default30' && parsed.startTime) {
      return composeTimeRange(parsed.startTime, 30)
    }
    // 'none' (o 'ask' sin elección → no debería entrar aquí, pero por si acaso)
    return parsed.startTime || ''
  }

  function handleConfirm() {
    if (!parsed) return
    if (needsDurationStep && chosenDuration === null) return
    // Si el usuario confirma mientras la sesión de voz sigue abierta,
    // cerramos la captura para liberar el mic antes de notificar al padre.
    if (dictation.isListening) dictation.stop()
    const finalTime = resolveFinalTime()
    onSave({
      title: parsed.title,
      time: finalTime,
      date: targetDate || parsed.date, // YYYY-MM-DD — va al campo date, no a description
      description: '',           // notas del usuario: vacío al crear
      section: parsed.section,
      icon: parsed.icon,
      dotColor: parsed.dotColor,
    })
  }

  // Conflictos: calculamos contra `existingEvents` el mismo payload que se
  // guardaría si el usuario pulsa "Añadir" ahora. No bloqueamos el flujo —
  // el usuario sigue pudiendo confirmar — solo avisamos visiblemente. Fuente
  // de la verdad igual que al guardar: fecha objetivo + resolveFinalTime().
  const conflicts = (() => {
    const effectiveDate = targetDate || parsed?.date
    if (!effectiveDate || !parsed?.startTime) return []
    const finalTime = resolveFinalTime()
    if (!finalTime) return []
    return findOverlappingEvents(
      { date: effectiveDate, time: finalTime },
      existingEvents,
    )
  })()

  // Resumen de la duración resuelta — mostrado bajo la vista previa para que
  // el usuario vea exactamente qué va a guardar.
  const durationSummary = (() => {
    if (!parsed?.startTime) return null
    if (hasExplicitDuration) return parsed.time
    if (chosenDuration === 0) return `${parsed.startTime} · ${NO_END_TIME_LABEL}`
    if (chosenDuration > 0) return composeTimeRange(parsed.startTime, chosenDuration)
    if (prefs.defaultDurationBehavior === 'default30') {
      return `${composeTimeRange(parsed.startTime, 30)} · 30 min por defecto`
    }
    if (prefs.defaultDurationBehavior === 'none') {
      return `${parsed.startTime} · ${NO_END_TIME_LABEL}`
    }
    return null
  })()

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-surface rounded-t-[32px] px-6 pt-5 shadow-2xl z-10"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)' }}
      >

        {/* Handle bar */}
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-6" />

        <div className="mb-5">
          <h2 className="font-headline font-extrabold text-xl text-on-surface">
            Añadir evento
          </h2>
          {targetDateLabel ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="material-symbols-outlined text-primary text-[14px]">calendar_today</span>
              <p className="text-sm font-semibold text-primary first-letter:uppercase">{targetDateLabel}</p>
            </div>
          ) : (
            <p className="text-sm text-outline mt-1">
              Escribe de forma natural, como le dirías a un amigo
            </p>
          )}
        </div>

        {/* Input + dictado por voz.
            Layout: [edit] [input.....] [X si hay texto] [MIC].
            El mic vive a la derecha como acción primaria de entrada
            (mismo lugar que en FocusBar y NovaWidget), así el usuario
            asocia la posición con "habla aquí" en toda la app. */}
        <div className="mb-5">
          <div
            className={`flex items-center gap-2 bg-surface-container-low rounded-2xl px-4 py-2.5 border transition-colors ${
              dictation.isListening
                ? 'border-nova/50 shadow-[0_0_0_3px_rgba(34,211,238,0.14)]'
                : 'border-outline-variant/30 focus-within:border-primary'
            }`}
          >
            <span className="material-symbols-outlined text-outline text-xl flex-shrink-0">edit</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); if (voiceError) setVoiceError(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && parsed && !(needsDurationStep && chosenDuration === null)) {
                  handleConfirm()
                }
              }}
              placeholder={dictation.isListening ? 'Escuchando…' : `Ej: ${EXAMPLES[placeholderIdx]}`}
              disabled={dictation.isListening}
              className="flex-1 min-w-0 bg-transparent text-on-surface placeholder:text-outline/50 text-base font-medium focus:outline-none disabled:opacity-70"
            />
            {input && !dictation.isListening && (
              <button
                type="button"
                onClick={() => setInput('')}
                aria-label="Limpiar texto"
                className="flex-shrink-0 text-outline hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
            <MicButton
              isListening={dictation.isListening}
              commitProgress={dictation.commitProgress}
              onToggle={() => {
                if (voiceError) setVoiceError(null)
                dictation.toggle()
              }}
            />
          </div>
          {voiceError && (
            <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400 px-1 leading-snug">
              {voiceError}
            </p>
          )}
        </div>

        {/* Live preview card */}
        {parsed ? (
          <div className="bg-surface-container-lowest rounded-2xl p-4 mb-4 border border-outline-variant/20 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span
                className="material-symbols-outlined text-primary text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {parsed.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-on-surface truncate">{parsed.title}</p>
              <p className="text-sm text-outline mt-0.5">
                {targetDateLabel
                  ? [targetDateLabel, durationSummary || parsed.time].filter(Boolean).join(' · ')
                  : [parsed.date !== 'Hoy' ? parsed.date : '', durationSummary || parsed.time].filter(Boolean).join(' · ') || 'Sin horario definido'}
              </p>
            </div>
            <span className="material-symbols-outlined text-primary/60 text-xl flex-shrink-0">
              auto_awesome
            </span>
          </div>
        ) : input.trim().length >= 3 ? null : (
          <div className="text-center text-outline text-sm py-3 mb-5 font-medium">
            Sigue escribiendo para ver la vista previa...
          </div>
        )}

        {/* Conflicto: avisamos sin bloquear. Si el usuario insiste, puede
            guardar igual — quizás la superposición sea intencional (turnos
            opcionales, doble bloque). Máximo 2 nombres para no alargar. */}
        {conflicts.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5">
            <span
              className="material-symbols-outlined text-amber-500 text-[18px] flex-shrink-0 mt-0.5"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden="true"
            >
              warning
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-amber-700 dark:text-amber-300">
                {conflicts.length === 1 ? 'Pisa otro evento' : `Pisa ${conflicts.length} eventos`}
              </p>
              <p className="text-[12px] text-on-surface-variant leading-snug mt-0.5 truncate">
                {conflicts.slice(0, 2).map((c) => `${c.time?.split('-')[0]?.trim() || ''} · ${c.title}`).join(' · ')}
                {conflicts.length > 2 && ` · +${conflicts.length - 2}`}
              </p>
            </div>
          </div>
        )}

        {/* Duración — chips de confirmación.
            Aparecen cuando hay hora de inicio parseada pero sin duración
            explícita en el texto. El chip sugerido (inferencia por tipo) se
            destaca, pero no auto-confirma — el usuario sigue decidiendo. */}
        {needsDurationStep && (
          <div className="mb-5">
            <p className="text-xs font-bold text-outline mb-2">
              ¿Cuánto dura?
              {suggestedMinutes && (
                <span className="text-outline/60 font-medium ml-1">
                  · sugerencia: {DURATION_CHIPS.find((c) => c.value === suggestedMinutes)?.label || `${suggestedMinutes} min`}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {DURATION_CHIPS.map((chip) => {
                // value null → "sin hora de término"; traducimos a 0 interno
                // para distinguirlo de "aún no elegido" (null).
                const chipValue = chip.value === null ? 0 : chip.value
                const isSelected = chosenDuration === chipValue
                const isSuggested = suggestedMinutes !== null && chip.value === suggestedMinutes
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setChosenDuration(chipValue)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-primary text-white shadow-md'
                        : isSuggested
                          ? 'bg-primary/10 text-primary border border-primary/30'
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-2xl bg-surface-container-low text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!parsed || (needsDurationStep && chosenDuration === null)}
            className="flex-1 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/20 disabled:opacity-30 disabled:shadow-none active:scale-95 transition-all"
            title={needsDurationStep && chosenDuration === null ? 'Elige una duración para continuar' : undefined}
          >
            {needsDurationStep && chosenDuration === null ? 'Elige duración' : 'Añadir'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
