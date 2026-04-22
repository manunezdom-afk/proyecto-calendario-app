-- Elimina columnas peak_start / peak_end de user_profiles.
-- Motivo: la feature "Zona de rendimiento" fue retirada del producto — ya no
-- se lee ni se escribe desde la app.
-- Seguro de correr múltiples veces (IF EXISTS).

ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS peak_start;
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS peak_end;
