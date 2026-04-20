-- Focus App — Supabase Schema
-- Run this in the Supabase SQL editor

-- ── user_profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chronotype    TEXT,
  role          TEXT,
  peak_start    NUMERIC  DEFAULT 9,
  peak_end      NUMERIC  DEFAULT 11.5,
  setup_done    BOOLEAN  DEFAULT FALSE,
  snoozed_until BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile"
  ON public.user_profiles FOR ALL USING (auth.uid() = id);

-- ── events ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  time        TEXT,
  description TEXT DEFAULT '',
  section     TEXT DEFAULT 'focus',
  icon        TEXT DEFAULT 'event',
  dot_color   TEXT DEFAULT 'bg-secondary-container',
  date        TEXT,
  featured    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own events"
  ON public.events FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS events_user_date_idx
  ON public.events (user_id, date DESC);

-- ── tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  done       BOOLEAN DEFAULT FALSE,
  priority   TEXT    DEFAULT 'Media',
  category   TEXT    DEFAULT 'hoy',
  done_at    BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tasks"
  ON public.tasks FOR ALL USING (auth.uid() = user_id);

-- ── blocks (reserved for future time-blocking feature) ───────────────────────
CREATE TABLE IF NOT EXISTS public.blocks (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT,
  start_time TEXT,
  end_time   TEXT,
  date       TEXT,
  color      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own blocks"
  ON public.blocks FOR ALL USING (auth.uid() = user_id);

-- ── suggestions (Nova: modo propuesta) ──────────────────────────────────────
-- Acciones propuestas por Nova que el usuario aprueba o rechaza antes de aplicar.
CREATE TABLE IF NOT EXISTS public.suggestions (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,               -- add_event | edit_event | delete_event | mark_task_done
  payload      JSONB NOT NULL,              -- los campos de la acción original
  preview_title TEXT,                       -- "Crear: Reunión con Ana"
  preview_body  TEXT,                       -- "Mañana 15:00 · Focus"
  preview_icon  TEXT DEFAULT 'auto_awesome',
  reason       TEXT,                        -- razón/explicación de Nova
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  batch_id     TEXT,                        -- agrupa sugerencias de la misma respuesta
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own suggestions"
  ON public.suggestions FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS suggestions_user_status_idx
  ON public.suggestions (user_id, status, created_at DESC);

-- ── user_memories (memoria persistente de Nova sobre el usuario) ───────────
-- Nova guarda aquí hechos, relaciones, preferencias, metas y rutinas que aprende
-- durante las conversaciones. Se inyectan en el system prompt de cada llamada
-- para que Nova recuerde y se sienta como un asistente real.
CREATE TABLE IF NOT EXISTS public.user_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,              -- fact | relationship | preference | goal | pain | routine | context
  subject       TEXT,                       -- "pareja", "jefe", "proyecto-tesis", "trabajo", "familia"
  content       TEXT NOT NULL,              -- texto libre: "Su pareja se llama Ana, aniversario 14 marzo"
  confidence    TEXT DEFAULT 'medium',      -- high | medium | low
  source        TEXT DEFAULT 'conversation',-- conversation | inferred | user_edited
  expires_at    DATE,                       -- null = no expira
  pinned        BOOLEAN DEFAULT FALSE,      -- usuario la marcó como importante
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),  -- actualizado al ser referenciada por Nova
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own memories"
  ON public.user_memories FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_memories_user_idx
  ON public.user_memories (user_id, pinned DESC, last_seen_at DESC);

-- ── notif_log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notif_log (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   TEXT,
  title      TEXT,
  body       TEXT,
  icon       TEXT,
  timestamp  BIGINT,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notif_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notifications"
  ON public.notif_log FOR ALL USING (auth.uid() = user_id);

-- ── updated_at trigger (applies to events, tasks, user_profiles) ─────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── user_signals: implicit behavioral events for learning ────────────────────
-- Cada interacción relevante (task done, event created, sug aprobada/rechazada,
-- mensaje a Nova) se loguea acá. analyzeBehavior() las agrega en un modelo.
CREATE TABLE IF NOT EXISTS public.user_signals (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own signals"
  ON public.user_signals FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_signals_user_kind_idx
  ON public.user_signals (user_id, kind, created_at DESC);

-- ── user_behavior: aggregated model built from user_signals ──────────────────
-- One row per user. analyzeBehavior() upserts esto cada noche (Evening Shutdown)
-- o a demanda. El modelo se inyecta en el system prompt de Nova.
CREATE TABLE IF NOT EXISTS public.user_behavior (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  model            JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_behavior ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own behavior"
  ON public.user_behavior FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_behavior
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── push_subscriptions: suscripciones Web Push por usuario ───────────────────
-- Un usuario puede tener varias (desktop + mobile + etc.) → PK compuesta
-- endpoint es único globalmente (lo garantiza el navegador)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions (user_id);

-- ── sent_notifications: dedup para no mandar la misma push 2 veces ───────────
-- El cron scheduler registra acá cada push enviado (user_id + event_id + offset)
CREATE TABLE IF NOT EXISTS public.sent_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL,
  offset_min INTEGER NOT NULL,
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, event_id, offset_min)
);

ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
-- El service role bypasea RLS; los users pueden ver las propias
CREATE POLICY "Users read own sent notifications"
  ON public.sent_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS sent_notif_user_evt_idx
  ON public.sent_notifications (user_id, event_id);

-- ── calendar_feeds: tokens para URLs suscribibles de calendario ──────────────
-- Cada usuario puede tener 1+ "feeds" — URL públicas con un token que
-- expone su calendario en formato ICS para que apps como Google Calendar o
-- Apple Calendar se suscriban y se actualicen automáticamente.
CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  token        TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label        TEXT,
  filter       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  read_count   INTEGER DEFAULT 0
);

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own feeds"
  ON public.calendar_feeds FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS calendar_feeds_user_idx
  ON public.calendar_feeds (user_id, created_at DESC);

-- RPC para incrementar atómicamente read_count del feed (llamado por ics-feed.js)
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
REVOKE EXECUTE ON FUNCTION public.increment_feed_read(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_feed_read(TEXT) FROM anon, authenticated;

-- ── api_rate_limits: rate limiter global para endpoints serverless ─────────
-- Reemplaza el contador in-memory que no escalaba entre instancias.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key          TEXT         NOT NULL,
  window_start TIMESTAMPTZ  NOT NULL,
  count        INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.api_rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;

-- ── tts_usage: tope de costo diario TTS por usuario ────────────────────────
CREATE TABLE IF NOT EXISTS public.tts_usage (
  user_id     UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE     NOT NULL,
  char_count  INTEGER  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tts usage"
  ON public.tts_usage FOR SELECT USING (auth.uid() = user_id);

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
