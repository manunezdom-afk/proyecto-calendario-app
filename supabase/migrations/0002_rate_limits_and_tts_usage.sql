-- Migración 0002 — rate limiting global + tracking de costo TTS.
--
-- Aplicar con `supabase db push` o pegar en el SQL editor.
-- Idempotente (IF NOT EXISTS / OR REPLACE).

-- ── api_rate_limits ──────────────────────────────────────────────────────────
-- Reemplaza el rate limiter in-memory de /api/analyze-photo y /api/focus-assistant.
-- La clave es libre (ej. "analyze-photo:ip-1.2.3.4" o "tts:user-<uuid>"), con
-- una ventana discretizada por window_start. Un único INSERT atómico con
-- ON CONFLICT incrementa el contador sin races entre instancias serverless.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key          TEXT         NOT NULL,
  window_start TIMESTAMPTZ  NOT NULL,
  count        INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- No-RLS: solo el service_role (backend) escribe/lee acá. Los usuarios finales
-- nunca acceden a esta tabla.
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Limpia entries viejos para evitar crecimiento sin límite. Corre por cron
-- o manualmente; la política es "mantener últimas 24h".
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.api_rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;

-- RPC principal: reserva 1 hit en la ventana actual (si ya existe, incrementa).
-- Devuelve si está permitido, cuántos hits restan y cuándo resetea.
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key             TEXT,
  p_window_seconds  INTEGER,
  p_max_count       INTEGER
)
RETURNS TABLE (allowed BOOLEAN, count INTEGER, remaining INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bucket_epoch BIGINT;
  v_window_start TIMESTAMPTZ;
  v_count        INTEGER;
BEGIN
  -- Alineamos al bucket más cercano para que todos los hits en la misma
  -- ventana caigan en la misma row (sin esto, el ON CONFLICT no agruparía).
  v_bucket_epoch := (EXTRACT(EPOCH FROM NOW())::BIGINT / p_window_seconds) * p_window_seconds;
  v_window_start := TO_TIMESTAMP(v_bucket_epoch);

  INSERT INTO public.api_rate_limits (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING public.api_rate_limits.count INTO v_count;

  allowed   := v_count <= p_max_count;
  count     := v_count;
  remaining := GREATEST(0, p_max_count - v_count);
  reset_at  := v_window_start + (p_window_seconds * INTERVAL '1 second');
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── tts_usage ───────────────────────────────────────────────────────────────
-- Un row por (user_id, día) con el total de caracteres TTS consumidos.
-- Sirve para limitar gasto de OpenAI TTS por usuario y día.
CREATE TABLE IF NOT EXISTS public.tts_usage (
  user_id     UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE     NOT NULL,
  char_count  INTEGER  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;
-- Usuarios pueden leer su propio consumo (útil para mostrar "te quedan X mins").
CREATE POLICY "Users read own tts usage"
  ON public.tts_usage FOR SELECT USING (auth.uid() = user_id);

-- RPC: reserva p_chars caracteres en el día actual. Devuelve si excede el
-- tope diario. Se llama ANTES de invocar OpenAI; si no está allowed, 429
-- sin costo. Si Anthropic falla después, el contador queda ligeramente
-- sobreestimado — eso es conservador, preferimos errar hacia "bloquear".
CREATE OR REPLACE FUNCTION public.increment_tts_usage(
  p_user_id      UUID,
  p_chars        INTEGER,
  p_daily_limit  INTEGER
)
RETURNS TABLE (allowed BOOLEAN, used INTEGER, remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
BEGIN
  INSERT INTO public.tts_usage (user_id, day, char_count)
  VALUES (p_user_id, CURRENT_DATE, p_chars)
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    char_count = public.tts_usage.char_count + p_chars,
    updated_at = NOW()
  RETURNING public.tts_usage.char_count INTO v_used;

  allowed   := v_used <= p_daily_limit;
  used      := v_used;
  remaining := GREATEST(0, p_daily_limit - v_used);
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_tts_usage(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
