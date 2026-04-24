-- Migration 005: metadata for smarter notification history
--
-- The cron still works without these columns because the API falls back to the
-- original shape. Applying this migration lets Supabase keep the exact kind and
-- copy that was sent to the user.

ALTER TABLE public.sent_notifications
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB;

CREATE INDEX IF NOT EXISTS sent_notif_user_kind_idx
  ON public.sent_notifications (user_id, kind, sent_at DESC);
