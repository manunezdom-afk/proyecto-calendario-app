// Cuota diaria de IA por usuario.
//
// Por qué existe: los endpoints /api/focus-assistant y /api/analyze-photo
// llaman a Claude (Anthropic) y sin límite por usuario un atacante con sesión
// válida — o un usuario en bucle — puede vaciar el presupuesto de la API.
// El rate limit por IP de _lib/rateLimit.js es in-memory (muere entre
// invocaciones serverless), así que aquí persistimos contadores en Supabase.
//
// Tabla: public.ai_usage (user_id, day, endpoint, count). Migración 010.
//
// Fallback graceful: si la migración no se aplicó todavía o Supabase falla,
// devolvemos { ok: true, soft: true } para no bloquear deploy. Loggeamos una
// vez por proceso para que el operador note el degradado.

const SOFT_FAIL_FLAG = '__focus_ai_usage_warned'

const SOFT_LIMITS = {
  // Conservador para lanzamiento. Subir si métricas reales lo justifican.
  'focus-assistant': 200,
  'analyze-photo':   30,
}

function todayUtcISO() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function nextResetIso() {
  const d = new Date()
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

/**
 * Verifica + incrementa la cuota diaria del usuario para un endpoint dado.
 *
 * Devuelve:
 *   { ok: true,  remaining }            — usuario dentro de su cuota
 *   { ok: true,  remaining, soft: true } — la tabla no está disponible (no bloqueamos)
 *   { ok: false, reason, limit, resetAt } — cuota excedida (responder 429)
 *
 * IMPORTANTE: incrementa el contador antes de devolver ok=true, para que la
 * siguiente request use el valor actualizado. En caso de error de upsert, no
 * sumamos pero permitimos pasar.
 */
export async function enforceAiQuota(admin, userId, endpoint) {
  if (!admin || !userId) return { ok: true, soft: true, remaining: null }
  const limit = SOFT_LIMITS[endpoint] ?? 100
  const day = todayUtcISO()

  try {
    const { data, error: selErr } = await admin
      .from('ai_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('day', day)
      .eq('endpoint', endpoint)
      .maybeSingle()

    if (selErr) {
      if (/does not exist|not found/i.test(selErr.message || '')) {
        warnOnce('[ai_usage] tabla ai_usage no encontrada — corriendo sin cuota persistente')
        return { ok: true, soft: true, remaining: null }
      }
      // Otros errores (políticas RLS, conexión): no bloqueamos pero marcamos soft.
      return { ok: true, soft: true, remaining: null }
    }

    const current = Number(data?.count || 0)
    if (current >= limit) {
      return {
        ok: false,
        reason: 'quota_exceeded',
        limit,
        used: current,
        resetAt: nextResetIso(),
      }
    }

    const { error: upErr } = await admin
      .from('ai_usage')
      .upsert(
        { user_id: userId, day, endpoint, count: current + 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,day,endpoint' },
      )
    if (upErr) {
      return { ok: true, soft: true, remaining: limit - current }
    }

    return { ok: true, remaining: limit - current - 1 }
  } catch {
    return { ok: true, soft: true, remaining: null }
  }
}

function warnOnce(msg) {
  if (typeof globalThis !== 'undefined' && !globalThis[SOFT_FAIL_FLAG]) {
    globalThis[SOFT_FAIL_FLAG] = true
    console.warn(msg)
  }
}
