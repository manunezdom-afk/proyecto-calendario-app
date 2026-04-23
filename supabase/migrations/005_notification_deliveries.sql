-- Migration 005: telemetría persistente de push notifications
--
-- Registro append-only de cada intento de envío. El cron escribe una fila por
-- cada (user_id, endpoint, event_id, offset_min) que procesa. Sirve para:
--   1. Ver "última notificación enviada" en Ajustes (diagnóstico del usuario).
--   2. Detectar endpoints problemáticos sin silenciar el fallo (antes el
--      try/catch del cron solo lo imprimía en logs de Vercel).
--   3. Alertar si la tasa de failed > delivered, síntoma de VAPID inválido o
--      de un proveedor (APNs/FCM) caído.
--
-- La tabla es best-effort: el cron inserta con .then/.catch para NO romper el
-- envío si la migration no fue aplicada. Al primer corrido después de aplicar,
-- empieza a llenarse.

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id        TEXT,            -- event_reminder → events.id; test → null
  offset_min      INTEGER,         -- minutos antes del evento (null si no aplica)
  endpoint        TEXT NOT NULL,   -- sub endpoint (truncado si es muy largo)
  status          TEXT NOT NULL,   -- 'delivered' | 'failed' | 'gone'
  status_code     INTEGER,         -- HTTP status devuelto por FCM/APNs
  error           TEXT,            -- primeros 300 chars del error (si hubo)
  payload_title   TEXT,            -- primeros 200 chars del título
  duration_ms     INTEGER,         -- cuánto tardó webpush.sendNotification
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_deliveries IS
  'Log append-only de intentos de envío push. 1 fila por (sub, evento, offset). Gone = 404/410 → sub eliminada.';

CREATE INDEX IF NOT EXISTS idx_notif_deliveries_user_sent
  ON public.notification_deliveries (user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_deliveries_status
  ON public.notification_deliveries (status, sent_at DESC);

-- RLS: el usuario puede leer solo sus propias filas. El cron escribe con
-- service_role, que bypasea RLS.
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user reads own deliveries" ON public.notification_deliveries;
CREATE POLICY "user reads own deliveries"
  ON public.notification_deliveries
  FOR SELECT
  USING (auth.uid() = user_id);

-- No hay policy de INSERT/UPDATE/DELETE para usuarios — solo service_role escribe.

-- Purga automática: mantener 14 días de histórico es suficiente para
-- diagnóstico. Se ejecuta desde el mismo cron (api/cron-notifications.js)
-- en su primera corrida del día, o manualmente con:
--   DELETE FROM notification_deliveries WHERE sent_at < now() - interval '14 days';
