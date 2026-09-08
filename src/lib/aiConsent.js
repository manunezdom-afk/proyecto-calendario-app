// Consentimiento explícito para enviar datos a proveedores de IA externos.
// Hilante envía el mensaje + contexto necesario de agenda a OpenAI.
// El análisis opcional de fotos usa Anthropic; la transcripción de audio
// del servidor está pausada. El reconocimiento web depende del navegador.
// El permiso debe preceder al envío de texto/contexto o imágenes.
//
// Persistido por dispositivo en localStorage. La key lleva versión: si el
// texto del aviso cambia de forma sustancial (proveedores nuevos), versionar
// la key para volver a pedir consentimiento. V2 distingue chat y fotos.

const KEY = 'focus_ai_consent_v2'

export function hasAIConsent() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function grantAIConsent() {
  try { localStorage.setItem(KEY, '1') } catch {}
}
