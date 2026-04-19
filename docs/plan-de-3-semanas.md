# Plan compacto para Focus — 3 semanas

Agrupado por resultado, no por tiempo. Avanza en orden, cada tarea desbloquea la siguiente.

---

## Regla de oro

**No agregues features nuevas hasta que 10 personas estén usando lo que ya existe.** Si sigues agregando sin feedback real, estás optimizando a ciegas.

---

## Bloque 1 — Desbloquear la app

- [ ] Ejecutar los 4 SQL pendientes en Supabase:
  - `user_signals`
  - `user_behavior`
  - `push_subscriptions` + `sent_notifications`
  - `calendar_feeds`
- [ ] Arreglar el login de Supabase usando la página `/#/diagnostic`
- [ ] Probar flujo completo con tu propia cuenta:
  - Crear 5 eventos
  - Completar 3 tareas
  - Mandar 5 mensajes a Nova
  - Aprobar/rechazar 3 sugerencias
  - Revisar "Lo que Nova sabe de ti"
  - Verificar que las señales llegan a Supabase (Table Editor → `user_signals`)
- [ ] Anotar en un doc todos los bugs y fricciones que encuentres mientras pruebas
- [ ] Decidir qué hacer con el onboarding:
  - **A)** Eliminar (recomendado — el sistema aprende solo)
  - **B)** Reemplazar por 1 pregunta libre: "¿qué quieres lograr esta semana?"
  - **C)** Nova pregunta en contexto durante el uso
  - **A + C** combinadas (voto recomendado)

---

## Bloque 2 — Polish mínimo

- [ ] Arreglar los 5 bugs más molestos de tu lista del Bloque 1
- [ ] Comprar dominio (~$12):
  - Recomendado: Cloudflare Registrar o Porkbun
  - Opciones: `focusapp.app`, `getfocus.app`, `usefocus.app`, `focalist.app`
- [ ] Conectar dominio a Vercel (Settings → Domains → Add)
- [ ] Reemplazar el mockup dibujado de la landing por un screenshot real de la app
- [ ] Configurar notificaciones push:
  - Generar VAPID keys (`npx web-push generate-vapid-keys`)
  - Pegar las keys en Vercel Environment Variables
  - Agregar GitHub Secrets (`APP_URL`, `CRON_SECRET`)
- [ ] Verificar que las push lleguen con el celular bloqueado (crear evento a 10 min, cerrar app, esperar)

---

## Bloque 3 — Beta privada

- [ ] Invitar a 8-10 personas con mensaje directo:
  - 3 amigos que usen calendario seriamente
  - 2 early adopters de productividad
  - 5 random (para encontrar bugs)
- [ ] Hacer 2 video-llamadas de 20 min viendo cómo usan la app sin ayudarlos
- [ ] Consolidar feedback y detectar los 3 problemas que más se repiten
- [ ] Arreglar solo esos 3 problemas (nada más)

---

## Bloque 4 — Monetización

### Modelo de negocio

**Free tier:**
- Eventos y tareas ilimitados
- Nova: 20 mensajes/día
- 1 calendar feed (suscripción)
- Notificaciones push básicas

**Pro tier — $4.99/mes o $39/año:**
- Nova ilimitado
- Calendar feeds ilimitados
- Dark mode bien hecho
- Backup automático semanal
- Soporte prioritario

### Tareas

- [ ] Crear cuenta en Stripe
- [ ] Integrar Stripe Checkout (no Stripe Elements — más simple)
- [ ] Poner límite de 20 mensajes/día a Nova en plan free
- [ ] Poner límite de 1 calendar feed en plan free
- [ ] Mostrar UI de "Upgrade a Pro" cuando se alcance un límite
- [ ] Webhook de Stripe en `/api/stripe-webhook` para marcar usuarios como `is_pro` en Supabase

---

## Bloque 5 — Lanzamiento

- [ ] Preparar assets para Product Hunt:
  - 5 screenshots de la app
  - Video de 30 segundos (puede ser un screencast)
  - Copy del producto (título, tagline, descripción)
- [ ] Publicar en Product Hunt (mejor día histórico: martes)
- [ ] Movilizar tu red el día del launch (LinkedIn, Twitter, WhatsApp)
- [ ] Postear en r/productivity y r/getdisciplined (Reddit)
- [ ] Escribir un "Show HN" en Hacker News
- [ ] Post en Indie Hackers contando la historia del proyecto

**Meta realista del launch:** top 10 del día en Product Hunt, ~500 visitas, ~50 signups.

---

## Bloque 6 — Seguridad mínima

- [ ] Rate limiting en `/api/calendar-feeds` y `/api/focus-assistant`
- [ ] Validar inputs con Zod en todos los endpoints del API
- [ ] Instalar Sentry para tracking de errores (plan gratis hasta 5k errors/mes)
- [ ] Activar 2FA en Vercel, Supabase, GitHub y Stripe
- [ ] Revisar que no haya `console.log` con datos sensibles (tokens, emails, keys)
- [ ] Configurar `Content-Security-Policy` en `vercel.json`
- [ ] Revisar que las RLS policies de Supabase estén restrictivas (ya están OK)

---

## Bloque 7 — Email + analytics

- [ ] Crear cuenta en Resend (gratis hasta 3k emails/mes)
- [ ] Email de bienvenida automático al registrarse
- [ ] Email día 3: "¿cómo te va con Focus?"
- [ ] Email día 7: "prueba Pro gratis 7 días"
- [ ] Instalar Plausible ($9/mes) o Umami (self-hosted gratis) para analytics
- [ ] Trackear 5 métricas clave:
  - Registros totales
  - Usuarios activos semanales (WAU)
  - Retención día 7
  - Eventos creados por usuario por semana
  - Mensajes a Nova por usuario por semana

---

## Orden sugerido

Haz los bloques **1 → 2 → 3 → 4 → 5** en ese orden.
El **6** y **7** van en paralelo cuando tengas tiempo muerto.

---

## Métricas objetivo (final de las 3 semanas)

| Métrica | Meta realista |
|---|---|
| Usuarios registrados | 20-30 |
| Usuarios activos semanales | 10+ |
| Retención día 7 | 40%+ |
| MRR (Stripe) | $10-50 |
| Bugs críticos sin resolver | 0 |

---

## Qué NO hacer en estas 3 semanas

- ❌ Agregar features nuevas (lo que tienes ya alcanza)
- ❌ Dark mode, temas, personalizaciones visuales
- ❌ App nativa (Capacitor) — espera a tener 500+ usuarios activos
- ❌ Blog, content marketing — después de Product Hunt
- ❌ Integraciones profundas (Google Cal bidireccional, WhatsApp) — mes 2 si hay tracción
- ❌ Rebuilds de cosas que funcionan aceptablemente
- ❌ Poner todo detrás del paywall — el modelo freemium funciona mejor

---

## Primer paso concreto (ahora)

**Empieza por el Bloque 1, tarea 1:** ejecuta los 4 SQL pendientes en Supabase. Son 15 minutos. Cuando termines, avanza con la tarea 2 (arreglar login).
