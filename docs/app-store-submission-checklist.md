# Checklist de submission — Focus iOS nativo (2026-08)

Guía vigente para subir `ios-native/Focus.xcodeproj` al App Store. Reemplaza
a `app-store.md` (legacy Capacitor). La metadata de la ficha (nombre,
subtítulo, keywords, descripción) está en `app-store-metadata.md`.

Estado: la **Fase A de compliance está en el código** (commit `23846fd`):
privacy manifest, eliminar cuenta in-app, consentimiento IA, links legales,
reporte de contenido, superficies "Próximamente" ocultas, prints limpiados.
Lo que queda es **manual en App Store Connect / Xcode** y está listado acá.

---

## 1. Antes de archivar (Xcode)

- [ ] Bumpear `CURRENT_PROJECT_VERSION` (hoy 25) si ya subiste ese build.
- [ ] Scheme `Focus` → Release → Archive con el team `D8UM897B2T`.
- [ ] Verificar que el archive incluye `PrivacyInfo.xcprivacy` (Product →
      Show Build Folder → Focus.app debe contenerlo — el build Debug ya lo
      copia, verificado 2026-08-10).
- [ ] `ITSAppUsesNonExemptEncryption=false` ya está en Info.plist — el
      upload NO debe preguntar por export compliance.

## 2. App Store Connect — creación de la app

- [ ] Crear app con Bundle ID `me.usefocus.app`, idioma principal
      Español (España), categoría **Productivity** (secundaria Lifestyle).
- [ ] URLs: Privacy Policy `https://www.usefocus.me/privacidad` · Support
      `https://www.usefocus.me/soporte` · Marketing `https://www.usefocus.me`.
      (Ambas páginas ya están publicadas y actualizadas al 2026-08-10, con
      DeepSeek/OpenAI/Anthropic declarados y borrado in-app documentado.)
- [ ] EULA: usar el estándar de Apple o linkear
      `https://www.usefocus.me/terminos` (ya publicado).

## 3. Age rating (cuestionario nuevo, obligatorio desde ene-2026)

Respuestas esperadas para Focus (revisar cada pregunta igual — el
cuestionario cambia):

| Pregunta | Respuesta |
|---|---|
| ¿Contenido violento/sexual/apuestas/drogas? | No |
| ¿La app incluye un asistente de IA / chatbot? | **Sí** (Nova) |
| ¿El chat IA puede producir contenido sin filtrar/sin restricción? | Con moderación: el backend usa system prompt restringido a organización personal + botón de reportar in-app |
| ¿Contenido generado por usuarios visible para otros? | No (todo es privado por usuario) |
| ¿Acceso sin restricción a la web? | No |

Resultado esperado: **13+**. No pelearlo — un chat IA en 4+ genera rechazo
o re-clasificación forzada.

## 4. App Privacy (nutrition labels)

Debe ser **espejo exacto** de `ios-native/Focus/PrivacyInfo.xcprivacy`:

| Dato | Recolectado | Vinculado al usuario | Tracking | Propósito |
|---|---|---|---|---|
| Email address | Sí | Sí | No | App functionality |
| User ID | Sí | Sí | No | App functionality |
| Other user content (eventos, tareas, memorias, mensajes a Nova) | Sí | Sí | No | App functionality |

Todo lo demás: "no recolectado". **Tracking: ninguno** (no hay ATT).

## 5. Review notes (campo "Notes" del build) — CRÍTICO para apps con IA

Texto sugerido (en inglés, los reviewers lo procesan más rápido):

```
Focus is a personal calendar with an AI assistant ("Nova").

AI DISCLOSURE (Guideline 5.1.2(i)): Nova sends the user's message plus
minimal agenda context to third-party AI providers through our backend.
Primary provider: DeepSeek (deepseek-v4). Alternatives: OpenAI, Anthropic.
The app shows an explicit consent sheet naming the provider BEFORE the
first message is transmitted. Declining keeps the rest of the app fully
usable. Voice dictation is transcribed on-device (SFSpeechRecognizer) and
never uploaded.

MODERATION (Guideline 1.2): the assistant is restricted by system prompt
to personal-organization topics; every AI reply has a long-press
"Report response" action that emails our support inbox.

ACCOUNT DELETION (5.1.1(v)): Settings → Privacidad → Eliminar cuenta —
immediate, irreversible, deletes all server data.

REVIEW ACCESS: no account needed — tap "Continuar en modo demo" on the
login screen to try every screen with sample data (demo mode uses a local
parser; no data leaves the device). To test the live AI path, create an
account with any email (OTP code arrives by email).
```

- [ ] Pegar esto en Review Notes. **No omitir la mención de IA** — omitirla
      es causa conocida de delays/rechazo en 2026.

## 6. EU / DSA (si distribuyes en la UE — España incluida)

- [ ] App Store Connect → Business → declarar **trader status** y
      verificar dirección, teléfono y email (se publican en la ficha de la
      UE). Sin esto la app no se lista en la UE desde feb-2025.
- [ ] Si prefieres no exponer datos personales todavía: desmarcar los 27
      países de la UE en la disponibilidad y lanzar primero en
      LATAM + US, agregando la UE después.

## 7. Screenshots (solo iPhone — la app es `TARGETED_DEVICE_FAMILY = 1`)

- [ ] 6.9" (iPhone 16/17 Pro Max) y 6.5" — 3 a 6 capturas.
- [ ] Sugerencia de secuencia: 1) Mi Día con timeline lleno, 2) Nova
      creando un evento por chat, 3) Calendario mes, 4) consentimiento /
      privacidad como diferencial ("Tú siempre apruebas"), 5) Ajustes.
- [ ] Captions con keywords (Apple las indexa por OCR desde 2025) — en
      español neutral.

## 8. Antes de "Submit for Review"

- [ ] Probar en TestFlight el flujo completo NUEVO: consentimiento IA
      (primer mensaje) → aceptar → respuesta real; "Ahora no" → el texto
      vuelve al input.
- [ ] Probar Eliminar cuenta con una cuenta desechable (crea, borra,
      verifica que el login posterior arranca de cero).
- [ ] Verificar links de Ajustes → Política / Términos abren Safari.
- [ ] Long-press en una respuesta de Nova → "Reportar respuesta" abre Mail.
- [ ] `BETA_UNLIMITED` en Vercel: decidir si queda ON para la review
      (recomendado ON para que el reviewer no choque con cuotas) y
      documentar apagarlo post-aprobación si aplica.

## 9. Pendientes conocidos que NO bloquean esta submission

- Sign in with Apple: **no requerido hoy** (solo OTP email = sistema
  propio). Se vuelve OBLIGATORIO si activas `isGoogleSignInEnabled`
  (Guideline 4.8). No activar Google sin agregar Apple.
- Accesibilidad/Dynamic Type: mínima (119 tamaños fijos). Mejorar en
  Fase B — no suele bloquear primera aprobación pero sí featuring.
- Exportación de datos in-app (GDPR portabilidad): hoy por email — el
  SQL está listo en `PRIVACY_AUDIT.md` §7.
- Tablas `focus_events`/`focus_tasks`: cubiertas por CASCADE al borrar
  cuenta (verificado en migración 018), pero falta agregarlas al SQL de
  exportación de `PRIVACY_AUDIT.md` §7.
