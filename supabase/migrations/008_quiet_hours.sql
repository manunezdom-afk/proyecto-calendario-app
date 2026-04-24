-- Migration 008: quiet hours por usuario para las push notifications
--
-- Ambos NULL = sin quiet hours activas (comportamiento previo, push libre).
-- Valores 0..23 = hora local del usuario (el cron combina con timezone que
-- ya existe en user_profiles para resolver la hora real).
--
-- La ventana puede cruzar medianoche: si quiet_start > quiet_end (ej. 22→7)
-- el cron la trata como [22..23] ∪ [0..6]. Esa lógica vive en el handler.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS quiet_start SMALLINT,
  ADD COLUMN IF NOT EXISTS quiet_end SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_quiet_start_range'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_quiet_start_range
      CHECK (quiet_start IS NULL OR (quiet_start BETWEEN 0 AND 23));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_quiet_end_range'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_quiet_end_range
      CHECK (quiet_end IS NULL OR (quiet_end BETWEEN 0 AND 23));
  END IF;
END $$;
