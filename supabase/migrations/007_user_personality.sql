-- Migration 007: persist the user's selected Nova personality
--
-- Hoy la personalidad vive sólo en localStorage del cliente. El cron corre
-- en serverless y nunca la ve, así que las push notifications salen siempre
-- con el mismo tono. Esta columna la trae al backend para que el generador
-- de copy pueda hablar con la voz correcta.
--
-- Default 'focus' = misma experiencia que tenía cualquier usuario antes.
-- El CHECK mantiene el enum alineado con NOVA_PERSONALITY_IDS en
-- api/_lib/personality.js y src/utils/novaPersonality.js.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS nova_personality TEXT NOT NULL DEFAULT 'focus';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_nova_personality_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_nova_personality_check
      CHECK (nova_personality IN ('focus', 'cercana', 'estrategica'));
  END IF;
END $$;
