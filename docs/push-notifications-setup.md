# Push Notifications — Setup Manual

Notificaciones push que llegan aunque la app esté cerrada:

- Web Push para navegador/PWA.
- APNs nativo para la app iOS de App Store/TestFlight.

## Arquitectura

```
GitHub Actions (cada 5 min)
        │
        ▼
/api/cron-notifications
        │
        ▼
Supabase: events + sent_notifications
        │
        ├─ Web Push: push_subscriptions + VAPID
        │
        └─ iOS nativo: native_push_tokens + APNs
```

---

## Pasos para activarlo (orden)

### 1. Generar VAPID keys

En cualquier máquina con Node instalado, ejecuta:

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

Guarda las dos (no subas la private a GitHub).

### 2. Crear la key APNs para iOS nativo

Apple Developer → Certificates, Identifiers & Profiles → Keys → crea una key con `Apple Push Notifications service (APNs)`.

Guarda estos datos:

| Dato | Dónde está |
|---|---|
| `APNS_TEAM_ID` | Apple Developer → Membership details |
| `APNS_KEY_ID` | La key APNs creada |
| `APNS_PRIVATE_KEY` | Contenido completo del `.p8` descargado |
| `APNS_BUNDLE_ID` | `me.usefocus.app` |
| `APNS_ENV` | `production` para TestFlight/App Store |

En Xcode, el target `App` debe tener la capability **Push Notifications** activa y tu Apple Team seleccionado en Signing & Capabilities. El repo ya incluye `ios/App/App/App.entitlements`, pero el equipo de firma se elige con tu cuenta de Apple.

### 3. Correr el SQL en Supabase

Si estás levantando una base nueva, ejecuta `supabase/schema.sql`.

Si la base ya existe, asegúrate de tener las tablas de push del schema (`push_subscriptions`, `sent_notifications`, `notification_deliveries`) y aplica las migraciones nuevas/pendientes, especialmente:

- `supabase/migrations/005_notification_deliveries.sql`
- `supabase/migrations/006_sent_notification_metadata.sql`
- `supabase/migrations/009_native_push_tokens.sql`

Si lo haces a mano, la tabla nueva de iOS nativo es:

```sql
CREATE TABLE IF NOT EXISTS public.native_push_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT 'ios',
  environment TEXT NOT NULL DEFAULT 'production',
  bundle_id  TEXT NOT NULL DEFAULT 'me.usefocus.app',
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.native_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own native push tokens"
  ON public.native_push_tokens FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS native_push_tokens_user_idx
  ON public.native_push_tokens (user_id);
```

### 4. Agregar env vars en Vercel

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
| `CRON_SECRET` | Un string aleatorio largo (ej. `openssl rand -hex 32`) | genera uno tú |
| `VITE_API_ORIGIN` | `https://www.usefocus.me` | necesario para que la app iOS llame a las APIs de Vercel |
| `APNS_TEAM_ID` | Team ID de Apple | Apple Developer |
| `APNS_KEY_ID` | Key ID APNs | Apple Developer → Keys |
| `APNS_PRIVATE_KEY` | Contenido del `.p8` | secreto |
| `APNS_BUNDLE_ID` | `me.usefocus.app` | bundle del target iOS |
| `APNS_ENV` | `production` | TestFlight/App Store |
| `VITE_APNS_ENV` | `production` | opcional; usa `development` solo para builds Debug instalados desde Xcode |

### 5. Configurar GitHub Secrets

GitHub → tu repo `proyecto-calendario-app` → Settings → Secrets and variables → Actions → "New repository secret".

| Secret | Value |
|---|---|
| `APP_URL` | `https://www.usefocus.me` (sin slash al final) |
| `CRON_SECRET` | El mismo string del paso 4 |

### 6. Cron cada 5 minutos

El cron operativo es GitHub Actions: `.github/workflows/notifications-cron.yml`.

No uses `vercel.json > crons` para cada 5 minutos si estás en Vercel Hobby. Vercel Hobby solo permite cron diario; GitHub Actions sí sirve para este intervalo.

### 7. Redeploy en Vercel

Deployments → último → ⋯ → Redeploy → **desmarca "Use existing Build Cache"** → Confirm.

### 8. Verificar

- Abre la app en mobile/desktop, inicia sesión y acepta permisos de notificación.
- En iPhone/TestFlight, abre Ajustes → Diagnóstico de notificaciones → Reconectar notificaciones.
- Envía una notificación de prueba desde Ajustes.
- Crea un evento para dentro de 15 minutos.
- Espera.
- Llega el push a los 10 min antes aunque cierres la app.

---

## Debugging

- **GitHub Actions no corre:** Actions tab → ver si está habilitado
- **Push no llega:** Chrome DevTools → Application → Service Workers → ver si hay errores
- **"no_vapid_key":** Verificar que `VITE_VAPID_PUBLIC_KEY` está en Vercel y se hizo redeploy después
- **"apns_not_configured":** Verificar `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENV`
- **APNs `BadDeviceToken`:** El token no coincide con ambiente/bundle. Para TestFlight/App Store usa `APNS_ENV=production`.
- **Ejecutar el cron manualmente:** Actions → "Notifications Cron" → Run workflow

## Costos

- **Vercel Hobby:** gratis (funciones serverless bajo uso típico)
- **Supabase Free:** gratis hasta 500MB DB y 50k auth users
- **GitHub Actions:** gratis hasta 2000 min/mes en repos privados. Un cron cada 5 min son ~8640 runs/mes; si cada run dura ~10s, usa ~1440 min/mes.
- **Apple APNs:** incluido con Apple Developer Program; requiere la membresía activa para publicar en App Store.

Hosting, Supabase y GitHub alcanzan en tiers gratuitos para cientos de usuarios activos. App Store requiere Apple Developer Program activo.
