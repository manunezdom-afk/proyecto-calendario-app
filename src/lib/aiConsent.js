// Consentimiento explícito para enviar datos a proveedores de IA externos.
// Nova manda el mensaje del usuario + contexto de agenda (eventos, tareas,
// memorias) a DeepSeek (principal) y OpenAI/Anthropic (voz, fotos,
// alternativa). Apple Guideline 5.1.2(i) (nov 2025) exige nombrar al
// proveedor y obtener permiso ANTES de transmitir; en la web aplicamos el
// mismo estándar por coherencia con la app iOS y con la política publicada.
//
// Persistido por dispositivo en localStorage. La key lleva versión: si el
// texto del aviso cambia de forma sustancial (proveedores nuevos), bumpear
// a _v2 para re-pedir consentimiento.

const KEY = 'focus_ai_consent_v1'

export function hasAIConsent() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function grantAIConsent() {
  try { localStorage.setItem(KEY, '1') } catch {}
}
