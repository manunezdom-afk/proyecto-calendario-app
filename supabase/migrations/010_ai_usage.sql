-- Migration 010: cuota diaria de uso de IA por usuario.
--
-- Por qué: los endpoints /api/focus-assistant y /api/analyze-photo llaman a
-- Claude (Anthropic). Sin contador por usuario, un atacante con sesión válida
-- — o un bucle accidental en el cliente — puede vaciar el presupuesto de la
-- API en minutos. El rate limit por IP en _lib/rateLimit.js es in-memory y
-- muere entre invocaciones serverless de Vercel; aquí persistimos el conteo.
--
-- Esquema deliberadamente minimalista: una fila por (usuario, día, endpoint).
-- Los días viejos pueden borrarse con un cron mensual; mientras tanto la tabla
-- crece muy lento (≈2 filas/usuario/día activo).

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id    UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        DATE    NOT NULL,
  endpoint   TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, endpoint)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Solo el service_role escribe (vía /api/_lib/aiUsage.js). El usuario puede
-- leer su propio contador para mostrarlo en Ajustes si más adelante se quiere.
DROP POLICY IF EXISTS "Users read own ai_usage" ON public.ai_usage;
CREATE POLICY "Users read own ai_usage"
  ON public.ai_usage
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx
  ON public.ai_usage (user_id, day);
