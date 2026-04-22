-- Device pairing: permite vincular un dispositivo nuevo a una cuenta que ya
-- tiene sesión en otro dispositivo, sin depender del OTP por correo.
--
-- Flujo:
--   1. El nuevo dispositivo llama /api/auth/device/start y recibe:
--      - device_code (opaco, UUID + hex) → lo usa para hacer polling
--      - user_code   (8 chars legibles)  → lo muestra al usuario
--   2. Desde un dispositivo con sesión activa, el usuario ingresa el user_code
--      y confirma → /api/auth/device/approve genera un magic-link (solo
--      token_hash, sin enviar email) y lo guarda en el row.
--   3. El nuevo dispositivo hace polling; al ver status='approved' recibe el
--      token_hash una sola vez y lo intercambia via supabase.auth.verifyOtp.
--
-- Seguridad:
--   - TTL corto (5 min).
--   - Un solo uso: status transita pending → approved → consumed.
--   - Sin RLS pública: solo el service_role (backend) accede a esta tabla.
--   - device_code es unguessable; user_code vive poco y está rate-limited.

CREATE TABLE IF NOT EXISTS public.device_pairings (
  device_code   TEXT PRIMARY KEY,
  user_code     TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending',
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email         TEXT,
  token_hash    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  approved_at   TIMESTAMPTZ,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  user_agent    TEXT
);

ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;
-- Sin policies: nadie con anon/authenticated key puede leer/escribir acá.
-- Todos los accesos pasan por endpoints con service_role.

CREATE INDEX IF NOT EXISTS device_pairings_user_code_idx
  ON public.device_pairings (user_code);
CREATE INDEX IF NOT EXISTS device_pairings_expires_at_idx
  ON public.device_pairings (expires_at);
