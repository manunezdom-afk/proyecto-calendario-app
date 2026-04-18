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
