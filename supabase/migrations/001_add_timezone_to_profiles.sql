-- Migración: agregar columna `timezone` a user_profiles.
-- Motivo: el cron de push y Nova necesitan la zona horaria del usuario para
-- calcular correctamente cuándo disparar notificaciones y cómo interpretar
-- fechas/horas de eventos (antes todo se asumía UTC, lo cual es incorrecto
-- para usuarios fuera del servidor de Vercel).
--
-- Ejecutar una sola vez en Supabase SQL editor.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

-- Si tenés usuarios ya creados, podés dejarlos en 'UTC' o correr este UPDATE
-- para llenarlos con un default razonable (por ejemplo Chile):
-- UPDATE public.user_profiles SET timezone = 'America/Santiago' WHERE timezone IS NULL OR timezone = 'UTC';
