# Limitaciones conocidas

## Zona horaria única por usuario

La app **asume que el usuario está siempre en la misma zona horaria**.
Los eventos se guardan como `date: "YYYY-MM-DD"` y `time: "HH:MM"` en la tabla
`events`, sin columna `timezone`.

**Consecuencias:**

- Si viajas a otra zona horaria, los eventos **no se desplazan** — seguirás
  viendo "09:00" pero tu iPhone ya estará en otro huso.
- La exportación ICS convierte a UTC (correcto) pero la importación asume tu
  hora local, así que calendarios creados en otra TZ se importan a la tuya.
- El cron de notificaciones (`api/cron-notifications.js`) usa la hora del
  servidor (Vercel/Netlify, normalmente UTC) para calcular el offset. En la
  práctica funciona porque compara `new Date(year, month, day, h, m)` que
  también se interpreta en la TZ del servidor — pero si el usuario y el
  servidor están en TZs muy distintas la precisión se degrada hasta ±1h.

**Cómo soportar multi-timezone** (futuro):

1. Añadir columna `timezone TEXT` a `events` (default: TZ de `user_profiles`).
2. Guardar `start_at TIMESTAMPTZ` además de `date`/`time` para indexar en UTC.
3. En el cliente, convertir con `Intl.DateTimeFormat` según TZ del usuario.
4. En el cron, usar `toZonedTime(event.start_at, event.timezone)` en vez de
   construir Date local.

No es trivial — implica migración de datos y retocar parsers (`parseEventTime`,
`icsImport`, etc.). Se deja documentado para priorizar cuando haya demanda.
