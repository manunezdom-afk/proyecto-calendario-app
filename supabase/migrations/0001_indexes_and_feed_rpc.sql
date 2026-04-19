-- Migración 0001 — índices adicionales y RPC para incremento atómico de read_count.
--
-- Aplicar con `supabase db push` o copiar en el SQL editor de Supabase.
-- Es idempotente (usa IF NOT EXISTS / OR REPLACE).

-- ── Índices para queries del cron y del feed ──────────────────────────────────
-- cron-notifications.js filtra events por (user_id, date) — con 1k+ eventos el
-- scan secuencial se vuelve costoso.
CREATE INDEX IF NOT EXISTS events_user_date_idx
  ON public.events (user_id, date DESC);

-- notif_log por usuario y fecha (usado para mostrar la historia en la UI).
CREATE INDEX IF NOT EXISTS notif_log_user_created_idx
  ON public.notif_log (user_id, created_at DESC);

-- ── RPC: increment_feed_read ──────────────────────────────────────────────────
-- Incrementa atómicamente read_count y actualiza last_read_at del feed.
-- Reemplaza el UPDATE buggy de ics-feed.js que dejaba read_count sin tocar.
CREATE OR REPLACE FUNCTION public.increment_feed_read(p_token TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.calendar_feeds
     SET read_count   = COALESCE(read_count, 0) + 1,
         last_read_at = NOW()
   WHERE token = p_token;
$$;

-- Solo el service_role debería poder invocarla (el endpoint público ics-feed
-- usa getSupabaseAdmin()). No damos EXECUTE a anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.increment_feed_read(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_feed_read(TEXT) FROM anon, authenticated;
