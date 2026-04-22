-- Migration 004: per-event configurable reminders + explicit timezone
--
-- Adds two optional fields to events:
--   * reminder_offsets : INTEGER[] of minutes-before-event; NULL → client falls
--     back to defaults (currently [10, 30, 60]). Empty array [] = user quiere
--     silenciar todos los recordatorios para este evento.
--   * timezone         : IANA TZ (ej. "America/Argentina/Buenos_Aires"). NULL
--     → se interpreta en la TZ del usuario. Se escribe cuando se crea un evento
--     para que al viajar se sepa en qué huso se creó.
--
-- Safe to re-run: uses IF NOT EXISTS on each column.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_offsets INTEGER[];

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN public.events.reminder_offsets IS
  'Minutos antes del evento para cada recordatorio. NULL = usar defaults del cliente. [] = silenciado.';

COMMENT ON COLUMN public.events.timezone IS
  'IANA time zone en la que el evento fue creado (ej. America/Argentina/Buenos_Aires). NULL = TZ del usuario.';
