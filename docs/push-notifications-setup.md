# Web Push Notifications — Setup Manual

Notificaciones push que llegan aunque la app esté cerrada (incluso con el celu bloqueado).

## Arquitectura

```
┌────────────┐   cada 5 min   ┌──────────────────────┐
│  GitHub    │ ─────────────> │ /api/cron-            │
│  Actions   │                │ notifications         │
└────────────┘                └─────────┬────────────┘
                                        │ escanea
                                        ▼
                              ┌──────────────────────┐
                              │  Supabase: events    │
                              │  sent_notifications  │
                              └─────────┬────────────┘
                                        │ match offset
                                        ▼
                              ┌──────────────────────┐
                              │ web-push → VAPID     │
                              └─────────┬────────────┘
                                        │
                                        ▼
                              ┌──────────────────────┐
                              │  Service Worker del  │
                              │  cliente → showNotif │
                              └──────────────────────┘
```

---

## Pasos para activarlo (orden)

### 1. Generar VAPID keys

En cualquier máquina con Node instalado, corré:

```bash
npx web-push generate-vapid-keys
```

Output:
```
=======================================
Public Key:
BH...........
Private Key:
kL...........
=======================================
```

Guardá las dos (no subas la private a GitHub).

### 2. Correr el SQL en Supabase

Todo el schema vive en `supabase/schema.sql` (todas las tablas, policies, índices, triggers y RPCs). Pegá el contenido de ese archivo en el SQL Editor de Supabase y ejecutalo. Es idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`) — podés correrlo varias veces sin romper nada.

Si ya lo corriste hace tiempo, aplicá también las migraciones en `supabase/migrations/` (por ejemplo `0001_indexes_and_feed_rpc.sql`, que agrega el índice compuesto `events(user_id, date)` y la RPC `increment_feed_read` usada por `/api/ics-feed`).

> Las tablas que importan para push notifications son `push_subscriptions` y `sent_notifications`. Están definidas en `schema.sql` junto con RLS y el UNIQUE constraint que protege de duplicados cuando el cron corre dos veces concurrentemente.

### 3. Agregar env vars en Vercel

Vercel → proyecto `proyecto-calendario-app` → Settings → Environment Variables.

Agregar las siguientes (todas con "All Environments" marcado):

| Name | Value | De dónde |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | La Public Key del paso 1 | `npx web-push generate-vapid-keys` |
| `VAPID_PUBLIC_KEY` | La misma Public Key (sin prefijo VITE) | idem |
| `VAPID_PRIVATE_KEY` | La Private Key del paso 1 | idem — **secreta** |
| `VAPID_EMAIL` | `mailto:tuemail@gmail.com` | identificación para los push servers |
| `SUPABASE_SERVICE_ROLE_KEY` | El service_role key de Supabase | Supabase → Settings → API → "service_role" (secreto) |
| `SUPABASE_URL` | URL del proyecto Supabase | ya existe como `VITE_SUPABASE_URL`, pero el backend lee sin el prefijo |
| `CRON_SECRET` | Un string aleatorio largo (ej. `openssl rand -hex 32`) | generá uno vos |

### 4. Configurar GitHub Secrets

GitHub → tu repo `proyecto-calendario-app` → Settings → Secrets and variables → Actions → "New repository secret".

| Secret | Value |
|---|---|
| `APP_URL` | `https://proyecto-calendario-app.vercel.app` (sin slash al final) |
| `CRON_SECRET` | El mismo string del paso 3 |

### 5. Redeploy en Vercel

Deployments → último → ⋯ → Redeploy → **desmarcá "Use existing Build Cache"** → Confirm.

### 6. Verificar

- Abrí la app en mobile/desktop, inicia sesión, aceptá permisos de notificación.
- Creá un evento para dentro de 15 minutos.
- Esperá.
- Llega el push a los 10 min antes aunque cierres la app.

---

## Debugging

- **GitHub Actions no corre:** Actions tab → ver si está habilitado
- **Push no llega:** Chrome DevTools → Application → Service Workers → ver si hay errores
- **"no_vapid_key":** Verificar que `VITE_VAPID_PUBLIC_KEY` está en Vercel y se hizo redeploy después
- **Ejecutar el cron manualmente:** Actions → "Notifications Cron" → Run workflow
- **Push duplicada:** el cron reserva cada `(user_id, event_id, offset_min)` antes de enviar y
  maneja `23505` (unique_violation) si otra instancia ganó la carrera. Si ves duplicados,
  revisa que el UNIQUE en `sent_notifications` siga presente en el schema.

## Costos

- **Vercel Hobby:** gratis (funciones serverless bajo uso típico)
- **Supabase Free:** gratis hasta 500MB DB y 50k auth users
- **GitHub Actions:** gratis hasta 2000 min/mes en repos privados (cada run del cron dura ~10s → ~50k runs/mes)

Todo en el tier gratuito alcanza para cientos de usuarios activos.
