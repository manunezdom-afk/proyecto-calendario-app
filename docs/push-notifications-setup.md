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

Copiá y ejecutá esto en el SQL Editor de Supabase:

```sql
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.sent_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL,
  offset_min INTEGER NOT NULL,
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, event_id, offset_min)
);
ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own sent notifications"
  ON public.sent_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS sent_notif_user_evt_idx
  ON public.sent_notifications (user_id, event_id);
```

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

## Costos

- **Vercel Hobby:** gratis (funciones serverless bajo uso típico)
- **Supabase Free:** gratis hasta 500MB DB y 50k auth users
- **GitHub Actions:** gratis hasta 2000 min/mes en repos privados (cada run del cron dura ~10s → ~50k runs/mes)

Todo en el tier gratuito alcanza para cientos de usuarios activos.
