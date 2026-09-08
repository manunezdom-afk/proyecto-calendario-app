// Consentimiento explícito para enviar datos a proveedores de IA externos.
// Nova manda el mensaje del usuario + contexto de agenda (eventos, tareas,
// memorias) al proveedor habilitado: Anthropic, DeepSeek u OpenAI. Las fotos
// usan Anthropic; la transcripción de audio del servidor está pausada.
// El permiso debe preceder al envío de texto/contexto o imágenes.
//
// Persistido por dispositivo en localStorage. La key lleva versión: si el
// texto del aviso cambia de forma sustancial (proveedores nuevos), versionar
// la key para volver a pedir consentimiento. No hay proveedores nuevos aquí.

const KEY = 'focus_ai_consent_v1'

export function hasAIConsent() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function grantAIConsent() {
  try { localStorage.setItem(KEY, '1') } catch {}
}
