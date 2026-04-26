-- Migration 009: native iOS APNs tokens for App Store builds
--
-- Web Push subscriptions live in push_subscriptions. Capacitor/App Store
-- builds register with Apple Push Notification service and receive an APNs
-- device token instead, so the cron needs a second delivery table.

CREATE TABLE IF NOT EXISTS public.native_push_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL DEFAULT 'ios',
  environment  TEXT NOT NULL DEFAULT 'production',
  bundle_id    TEXT NOT NULL DEFAULT 'me.usefocus.app',
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.native_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own native push tokens" ON public.native_push_tokens;
CREATE POLICY "Users manage own native push tokens"
  ON public.native_push_tokens
  FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS native_push_tokens_user_idx
  ON public.native_push_tokens (user_id);

CREATE INDEX IF NOT EXISTS native_push_tokens_user_env_idx
  ON public.native_push_tokens (user_id, environment);
