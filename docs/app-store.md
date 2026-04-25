# Subir Focus al App Store — guía paso a paso

Esta guía asume que ya está hecho todo lo del repo (Capacitor instalado, `ios/` generado, iconos listos). Lo que sigue depende de cosas que solo tú puedes hacer en tu Mac y en cuentas de Apple.

---

## Decisiones que ya están tomadas (cambiables)

Están en `capacitor.config.json` en la raíz del repo:

- **Bundle ID:** `me.usefocus.app`
- **Nombre de app (CFBundleDisplayName):** `Focus`
- **Color de fondo / status bar:** `#0a0a0f` (igual que la web)
- **Idioma principal:** español (`es`)

⚠️ **El bundle ID es irreversible** una vez subes la app a App Store Connect. Si quieres otro, cámbialo **antes** del primer upload (editar `capacitor.config.json` → `npm run ios:sync`).

---

## Requisitos previos (los instalas tú una sola vez)

### 1. Xcode

```
App Store de Mac → buscar "Xcode" → Instalar (~10 GB, 30-60 min)
```

Después de instalar, abrirlo una vez para aceptar la licencia y luego:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

### 2. Cuenta Apple Developer (99 USD/año)

1. Ir a [developer.apple.com](https://developer.apple.com/programs/)
2. "Enroll" con tu Apple ID (manunezdom@gmail.com)
3. Pagar 99 USD/año (auto-renovación). Si lo pagas como persona individual, listo. Si quieres como empresa, te piden DUNS Number (más demora).
4. Apple aprueba en **24-48h** normalmente.

### 3. App Store Connect

Cuando Apple aprueba la cuenta, accedes a [appstoreconnect.apple.com](https://appstoreconnect.apple.com). Ahí se gestiona la ficha de la app.

---

## Flujo completo (después de tener Xcode + cuenta Apple Developer)

### Paso 1 — Compilar el bundle web y sincronizar con iOS

Cada vez que cambies código React:

```bash
npm run ios:sync
```

Eso hace `vite build` + copia `dist/` dentro del proyecto Xcode.

### Paso 2 — Abrir el proyecto en Xcode

```bash
npm run ios:open
```

Eso abre `ios/App/App.xcworkspace` en Xcode.

### Paso 3 — Configurar firma (la primera vez)

En Xcode:

1. En el panel izquierdo, click en `App` (el ícono azul arriba de todo).
2. Pestaña **Signing & Capabilities**.
3. **Team** → seleccionar tu cuenta Apple Developer (la que pagaste).
4. **Bundle Identifier** → debería decir `me.usefocus.app`. Si Xcode te pide cambiarlo porque "ya existe", elige otro (ej: `me.usefocus.focusapp`) y actualiza también `capacitor.config.json` + `npm run ios:sync`.
5. Si Xcode muestra warning de provisioning profile, click en **"Try Again"** o **"Automatically manage signing"**.

### Paso 4 — Habilitar Push Notifications (opcional pero recomendado)

En la misma pantalla **Signing & Capabilities**:

1. Click `+ Capability` (arriba a la izquierda).
2. Buscar y agregar **Push Notifications**.
3. Agregar también **Background Modes** → marcar `Remote notifications`.

⚠️ Sin este paso, el plugin `@capacitor/push-notifications` no funciona en iOS. La web push de Vercel sí seguirá funcionando, pero las nativas no.

### Paso 5 — Probar en simulador

1. Arriba en Xcode, junto al botón de play, elegir **"iPhone 15"** o similar.
2. Click ▶️ (Run). Compila y abre el simulador con tu app.
3. Verificar que la app abre, navegas, login funciona, etc.

⚠️ El simulador no soporta push notifications nativas — eso requiere device físico.

### Paso 6 — Probar en iPhone físico (recomendado antes de subir)

1. Conectar iPhone con cable.
2. En el iPhone: Ajustes → General → VPN y administración de dispositivos → confiar en tu certificado de developer.
3. En Xcode arriba seleccionar tu iPhone como destino.
4. Click ▶️.

### Paso 7 — Cuando la app esté lista, hacer Archive

1. Arriba en Xcode, junto al play, elegir **"Any iOS Device (arm64)"** (NO el simulador).
2. Menú **Product → Archive** (toma 1-3 minutos).
3. Cuando termina, abre la ventana **Organizer** automáticamente.

### Paso 8 — Subir a App Store Connect

En **Organizer**:

1. Seleccionar el archive que acabas de crear.
2. Click **"Distribute App"**.
3. Elegir **"App Store Connect"** → "Upload" → siguiente, siguiente...
4. Xcode firma con el provisioning profile de App Store y sube. Toma 5-15 min.
5. Cuando termina, esperar 10-30 min más para que App Store Connect procese el build.

### Paso 9 — Crear ficha de la app en App Store Connect

Antes (o en paralelo) al primer upload, en [appstoreconnect.apple.com](https://appstoreconnect.apple.com):

1. **Mis Apps → +** → Nueva app.
2. Plataforma: iOS.
3. Nombre: `Focus` (si está tomado, probar `Focus Calendar`, `Focus — Calendario`, etc).
4. Idioma principal: Spanish.
5. Bundle ID: seleccionar `me.usefocus.app` (aparece después del primer upload con Xcode).
6. SKU: `focus-ios-001` (interno tuyo, irrelevante).

Luego completar las pestañas:

- **App Information**:
  - Categoría primaria: `Productivity`
  - Categoría secundaria: `Lifestyle` (opcional)
  - Privacy Policy URL: necesitas una URL pública. Si no tienes, crea `usefocus.me/privacy` o usa un servicio como [termly.io](https://termly.io) gratis.

- **Pricing and Availability**:
  - Free / paid (free es lo más simple para arrancar).
  - Países: All Countries (o solo los que quieras).

- **App Privacy** (cuestionario):
  - Datos que recolectas (email del login, preferencias). Apple es estricto con esto — completar honestamente.

- **Version Information** (la 1.0.0):
  - Screenshots: 6.7" (iPhone 15 Pro Max) y 6.5" (iPhone 11 Pro Max). Mínimo 3, máximo 10. Tomar desde el simulador con `Cmd+S`.
  - Promotional text: 170 caracteres.
  - Description: largo, describir features. Mínimo 10 caracteres.
  - Keywords: 100 caracteres totales separados por coma. Ej: `calendario,productividad,focus,tareas,enfoque`.
  - Support URL: `usefocus.me` (o un email de soporte en una página).
  - Marketing URL: `usefocus.me` (opcional).

- **Build**: seleccionar el build que subiste con Xcode (aparece después de procesar).

- **App Review Information**:
  - Datos de un usuario demo (Apple necesita poder probar la app sin signup). Crear un user de prueba en Supabase.
  - Notes: explicar features especiales, qué probar, etc.

### Paso 10 — Submit for Review

Botón azul arriba a la derecha. Apple revisa en **24-72h** normalmente. Te notifican por email.

---

## Si Apple rechaza (es común la primera vez)

**Guideline 4.2 - Minimum Functionality**: rechazan apps que son "solo un wrapper de web". Soluciones:

- Activar push notifications nativas (paso 4) — ya está casi todo listo.
- Agregar features que requieran iOS: biometría (FaceID), widgets, Siri Shortcuts, calendario nativo (Capacitor tiene plugins).
- En el "App Review Information", explicar todas las features que SÍ son nativas.

**Guideline 5.1.1 - Privacy**: si el cuestionario de privacidad no coincide con lo que la app hace.

**Guideline 4.0 - Design**: usualmente issues de UI cortada por safe area, botones difíciles de tocar, etc. Probar en device físico antes ayuda.

Apple te manda un mensaje específico, lo arreglas, vuelves a hacer Archive + Upload, y resubmiteas. Normalmente al segundo intento pasa.

---

## ¿Cómo arreglo bugs después de publicar?

### Bug en código React (UI, lógica, etc.) — sin pasar por Apple

1. Cambias el código.
2. `git push` a `main`.
3. Vercel deploya en ~1 min.
4. El usuario abre la app y ya tiene el fix (porque la app carga su contenido desde `dist/` empaquetado, PERO si configuras la app para cargar desde `usefocus.me`, ahí sí es instantáneo).

⚠️ **Importante**: Capacitor por defecto empaqueta `dist/` dentro del binario iOS. Eso significa que un cambio en React requiere `npm run ios:sync` + Archive + Upload + review de Apple.

**Si quieres updates instantáneos** (sin pasar por Apple para cada bug), edita `capacitor.config.json` y agrega:

```json
"server": {
  "url": "https://usefocus.me",
  "iosScheme": "https",
  "cleartext": false
}
```

Eso hace que la app sea un wrapper que carga `usefocus.me` directo. Pros: cualquier push a main = update inmediato para todos. Contras: requiere conexión, y Apple a veces es más estricto con esto (guideline 4.2).

**Recomendación**: empieza empaquetado (default). Si Apple rechaza por 4.2, agregas más nativo. Si la base de usuarios crece y necesitas updates rápidos, pasa al modo `server.url`.

### Bug nativo / cambio mayor — sí pasa por Apple

1. `npm run ios:sync`
2. En Xcode, subir versión:
   - **General → Version**: `1.0.0` → `1.0.1`
   - **General → Build**: incrementar (ej: `1` → `2`).
3. Product → Archive → Distribute → Upload.
4. En App Store Connect: nuevo build aparece, "Submit for Review".
5. Review típicamente más rápido en updates (~12-24h).

---

## Comandos útiles del repo

```bash
npm run ios:sync      # build web + copiar a ios/
npm run ios:open      # abrir Xcode workspace
npm run ios:run       # sync + open (todo en uno)
npm run build:ios-icons  # regenera el AppIcon 1024 desde public/icons/icon-512.png
```

---

## Costos totales

- **Apple Developer**: 99 USD/año (obligatorio mientras la app esté publicada).
- **Xcode**: gratis.
- **Capacitor**: gratis.
- **Hosting (Vercel)**: ya lo tienes.
- **Política de privacidad**: gratis si la haces tú, ~10 USD/mes si usas Termly.

---

## Checklist antes del primer upload

- [ ] Xcode instalado y abierto al menos una vez.
- [ ] Apple Developer account activa (status "active" en developer.apple.com).
- [ ] `npm run ios:sync` corre sin errores.
- [ ] App abre y funciona en simulador.
- [ ] App abre y funciona en iPhone físico (recomendado).
- [ ] Bundle ID en Xcode coincide con `me.usefocus.app` (o el que elegiste).
- [ ] Team de Signing seleccionado.
- [ ] Push Notifications capability agregada (si quieres push nativo).
- [ ] AppIcon 1024×1024 sin alpha (ya está, generado por `build:ios-icons`).
- [ ] Privacy Policy URL pública lista.
- [ ] Screenshots tomados (mínimo 3 a 6.7").
- [ ] Usuario demo creado en Supabase para que Apple pueda hacer login.
