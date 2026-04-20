# Empaquetar Focus como app nativa de escritorio

La landing ya tiene el botón "Descargar" con detección de OS. Solo falta
subir los instaladores a GitHub Releases y el flujo queda completo:
el usuario toca "Descargar" → le baja un `.msix` / `.pkg` / `.apk` →
doble click → app nativa.

**Tiempo total: ~15 minutos la primera vez. ~5 minutos en cada release.**

---

## Qué genera el botón en la landing

`public/landing/index.html` detecta el OS del visitante y descarga el archivo correcto de GitHub Releases:

| OS | Archivo esperado | URL |
|---|---|---|
| Windows 10/11 | `Focus-Windows.msix` | `https://github.com/manunezdom-afk/proyecto-calendario-app/releases/latest/download/Focus-Windows.msix` |
| macOS | `Focus-Mac.pkg` | `https://github.com/manunezdom-afk/proyecto-calendario-app/releases/latest/download/Focus-Mac.pkg` |
| Android | `Focus-Android.apk` | `https://github.com/manunezdom-afk/proyecto-calendario-app/releases/latest/download/Focus-Android.apk` |
| iPhone / iPad | — | No hay binario descargable legítimo sin App Store. Landing cae a instrucciones A2HS. |
| Linux / ChromeOS | — | Landing cae al prompt nativo de Chrome/Edge (PWA install). |

Mientras Releases no tenga esos assets, la landing detecta el 404 con
un HEAD request y muestra un modal explicando que el binario todavía no
está publicado, ofreciendo usar la PWA como fallback.

---

## Paso 1 — Asegurarte de que la PWA esté publicada

El único requisito previo: la URL pública de Focus tiene que servir un
`manifest.json` válido y un service worker. Esto **ya está hecho**
(commits `6efdadd` y `a7c6123`). Verificá:

- Abrí `https://proyecto-calendario-app.vercel.app/manifest.json` en el browser: debe mostrarse el JSON, no 404.
- Abrí `https://proyecto-calendario-app.vercel.app/sw.js`: debe mostrar código JavaScript.
- Abrí Focus en Chrome desktop → DevTools → Application → Manifest: no debe haber errores rojos.

Si todo lo anterior está OK, pasá al Paso 2.

---

## Paso 2 — Generar los instaladores con PWABuilder

1. Ir a https://www.pwabuilder.com/
2. Pegar tu URL pública de Focus y tocar **"Start"**.
3. PWABuilder analiza la PWA. Tiene que darte puntaje alto en "Manifest", "Service Worker" y "Security". Si aparece algún warning, se arregla antes de seguir.
4. Tocar **"Package for stores"** arriba a la derecha.

### Windows (.msix)

1. En la tarjeta **Windows**, tocar **"Generate Package"**.
2. Opciones:
   - **App name**: `Focus`
   - **App version**: `1.0.0.0` (cuatro segmentos, requisito MSIX)
   - **Publisher display name**: lo que quieras, p.ej. `Manuel Núñez`
   - **Publisher ID**: PWABuilder te genera uno — copialo y usalo siempre el mismo en releases futuros. Si cambiás el Publisher ID en una actualización, Windows trata la app como nueva y pierde los datos del usuario.
   - **Package identity name**: `focusapp.calendario` o similar (único, estable).
3. Tocar **"Download"**. Te baja un `.zip` con varios archivos. Extraelo — el que importa es `Focus.msix` (o similar).
4. Renombrá a **`Focus-Windows.msix`**.

### macOS (.pkg)

PWABuilder no tiene soporte oficial de macOS packaging todavía. Dos opciones:

**A) Electron wrapper rápido (recomendado sin cert de Apple)**

Los usuarios Mac con Chrome/Edge/Brave pueden usar el botón "Instalar Focus" directamente desde el browser — esa ruta funciona perfecto en Mac sin firmar nada. Si preferís no generar `.pkg` por ahora, la landing ya cae ahí cuando no encuentra `Focus-Mac.pkg` en Releases.

**B) Safari macOS 14+ "Añadir al Dock"**

Los usuarios de Safari pueden usar `Archivo → Añadir al Dock`, ya documentado en el fallback modal de la landing.

**C) Generar .pkg firmado (requiere cuenta Apple Developer $99/año)**

Si querés el `.pkg` descargable real, necesitás:
1. Cuenta Apple Developer activa.
2. Certificado de "Developer ID Installer".
3. Wrapping con Electron o PWABuilder macOS CLI (experimental).
4. Notarización vía `xcrun notarytool`.

Este camino es semanas de trabajo — no lo recomiendo hasta tener 100+ usuarios Mac pidiéndolo.

### Android (.apk)

1. En la tarjeta **Android**, tocar **"Generate Package"**.
2. Opciones:
   - **Package ID**: `app.focus.calendario` (único, estable).
   - **Signing key**: PWABuilder te genera una. Guardála en un lugar seguro — vas a necesitar la misma en updates futuros o Android rechaza la actualización.
   - **App name** / **Launcher name** / **Short name**: `Focus`.
3. Tocar **"Download"**. El `.zip` trae `app-release-signed.apk`.
4. Renombrá a **`Focus-Android.apk`**.

> Nota: este APK es una TWA (Trusted Web Activity). Carga tu URL de Focus dentro de una shell de Chrome. Los updates del código web son instantáneos (no hay que re-generar el APK cada vez que deployás), solo cuando cambiás el manifest o el branding.

---

## Paso 3 — Subir a GitHub Releases

1. Ir a `https://github.com/manunezdom-afk/proyecto-calendario-app/releases`
2. Tocar **"Draft a new release"**.
3. **Tag**: `v1.0.0` (o la versión que corresponda).
4. **Release title**: `Focus 1.0.0 — primera versión descargable`.
5. En **"Attach binaries"** subí los 3 archivos con los nombres exactos:
   - `Focus-Windows.msix`
   - `Focus-Mac.pkg` (si lo generaste)
   - `Focus-Android.apk`
6. Tocar **"Publish release"**.

A partir de ese momento, las URLs `/releases/latest/download/Focus-Windows.msix` y compañía sirven los archivos directamente. La landing los consume sin cambios de código.

---

## Paso 4 — Testear la descarga

1. Entrá a la landing desde Windows → el botón dice "Descargar para Windows" → click → baja el `.msix`.
2. Doble click en el `.msix` → Windows abre el instalador. Tocá **"Instalar"**. Focus aparece en el menú Inicio.
3. Mismo flujo desde Android: click → baja APK → abrís → sideload.
4. Desde iPhone o Linux: la landing cae al modal de instrucciones. No hay binario, lo cual es lo esperado.

---

## Actualizaciones futuras

Cada vez que quieras publicar una versión nueva del instalador:

1. **Código web**: no requiere nada — el PWA sirve la web actualizada automáticamente.
2. **Instalador .msix / .apk**: solo si cambiaste el manifest (íconos, nombre, permisos). En ese caso:
   - Repetí el Paso 2 en PWABuilder.
   - Usá un **version number nuevo** pero el **mismo Publisher ID** (Windows) y la **misma signing key** (Android).
   - Subí los archivos reemplazando los anteriores en GitHub Releases (tag nuevo, mismo nombre de archivo).

---

## Troubleshooting

**"El .msix no abre en Windows — aparece 'SmartScreen protegió tu PC'"**
Es esperado para apps sin firmar con Microsoft Store Certificate. El usuario toca "Más información" → "Ejecutar de todos modos". Si querés eliminar el aviso, necesitás un Certificado EV de Code Signing (~$400/año) o publicar en Microsoft Store.

**"El APK no abre — dice 'Fuentes desconocidas bloqueadas'"**
Android Settings → Apps → Chrome → "Permitir instalar apps de esta fuente". Alternativa: publicar en Play Store vía PWABuilder (gratis, trámite de 1 semana).

**"La landing dice 'Instalador en preparación' aunque ya subí el archivo"**
Verificá:
1. El nombre del archivo es exacto (`Focus-Windows.msix`, no `Focus.msix` ni `focus-windows.msix`).
2. El release está como "Published", no "Draft".
3. Hacé un hard refresh en la landing (Ctrl+Shift+R o Cmd+Shift+R).
