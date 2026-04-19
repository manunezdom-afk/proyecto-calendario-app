// Utilidades para mandar fotos al endpoint /api/analyze-photo y convertir
// la respuesta IA en eventos listos para ingesta (shape compatible con
// useEvents / onAddEvent / suggestions).
//
// Se usa desde:
// - components/importExport/PhotoTab.jsx (flujo batch: varias fotos)
// - components/NovaWidget.jsx            (adjuntar foto al chat con Nova)
// - components/FocusBar.jsx              (idem, inline en el planner)

import { guessIcon } from './iconGuesser'

// Resize client-side a máximo `maxPx` del lado mayor y devuelve base64 JPEG.
// Sirve para bajar el tamaño antes del upload (Anthropic vision cobra por
// pixeles; 1120px es sweet-spot calidad/costo según sus docs).
export function resizeToBase64(file, maxPx = 1120) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image_decode_failed'))
    }
    img.src = url
  })
}

// Convierte la respuesta del endpoint ({ title, date, time, endTime })
// en un evento completo de la app.
export function aiToAppEvent({ title = 'Evento', date = null, time = null, endTime = null }) {
  let displayTime = ''
  let h24 = null
  if (time) {
    const [h, m] = time.split(':').map(Number)
    h24 = h
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    displayTime = `${h12}:${String(m).padStart(2, '0')} ${period}`
  }
  const section = h24 !== null && h24 >= 14 ? 'evening' : 'focus'
  return {
    id: `evt-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim(),
    time: displayTime,
    date,
    section,
    featured: false,
    icon: guessIcon(title),
    dotColor: section === 'evening' ? 'bg-secondary-container' : '',
    description: endTime ? `Hasta las ${endTime}` : '',
  }
}

// Flujo end-to-end: recibe una lista de File, los analiza y devuelve eventos
// listos para agregar. Lanza con un code legible si algo falla.
//
//   try {
//     const events = await analyzePhotos([file])
//     // events: [{ id, title, time, date, section, icon, ... }]
//   } catch (err) {
//     // err.code: 'no_photos' | 'network' | 'server' | 'rate_limit' | 'no_events'
//   }
export async function analyzePhotos(files) {
  if (!files?.length) {
    const err = new Error('no_photos')
    err.code = 'no_photos'
    throw err
  }

  const images = await Promise.all(files.map((f) => resizeToBase64(f)))

  let res
  try {
    res = await fetch('/api/analyze-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
    })
  } catch {
    const err = new Error('No se pudo conectar al servidor.')
    err.code = 'network'
    throw err
  }

  let data
  try { data = await res.json() }
  catch {
    const err = new Error(`Error del servidor (${res.status}).`)
    err.code = 'server'
    throw err
  }

  if (res.status === 429) {
    const err = new Error('Demasiadas solicitudes. Espera un momento.')
    err.code = 'rate_limit'
    throw err
  }

  if (!res.ok || data.error) {
    const detail = data.detail ? ` (${data.detail})` : ''
    const err = new Error(`Error al analizar: ${data.error ?? res.status}${detail}.`)
    err.code = data.error || 'server'
    throw err
  }

  if (!data.events || data.events.length === 0) {
    const err = new Error('No se detectaron eventos. Asegúrate de que la foto muestre horarios o fechas visibles.')
    err.code = 'no_events'
    throw err
  }

  return data.events.map(aiToAppEvent)
}
