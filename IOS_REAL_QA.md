# HISTÓRICO — QA de Capacitor

Este procedimiento pertenece al wrapper anterior. No ejecutarlo para validar la app nativa actual. Usa [Preparación de release — Focus 2.0](docs/focus-2/RELEASE.md#evidencia-y-validación-local) y el [registro de la reconstrucción](docs/focus-2/README.md).

---

# iOS Real QA — Cómo asegurar que Xcode corre la build nueva

Este documento describe el flujo exacto para que cuando pruebes Focus en
Xcode/iPhone tengas certeza de que estás viendo la última versión del código,
no una build vieja cacheada por el WebView, el service worker o DerivedData.

## Stack

- **Frontend**: Vite + React 18, output a `dist/`
- **Wrapper iOS**: Capacitor 8 (`ios/App/App.xcodeproj`)
- **Bundle ID**: `me.usefocus.app`
- **Scheme**: `Focus`
- **Activos sincronizados**: `ios/App/App/public/` (lo escribe `cap sync`)

## Confirmación visual de build nueva

En **Ajustes → al final**, debajo del footer "Focus · Calendario con IA",
aparece una línea pequeña en monoespaciada:

```
build a1b2c3d · 05/05 12:34
```

- `a1b2c3d` → SHA corto del commit que se compiló
- `05/05 12:34` → fecha y hora local de la compilación

Antes de probar cualquier bug en Xcode, abrí Ajustes y compará el SHA con
`git rev-parse --short HEAD` de tu terminal. Si no coinciden, **estás
mirando una build vieja** y todo lo demás es ruido.

## Comandos npm disponibles

| Script | Qué hace |
|---|---|
| `npm run build` | Vite build + estampa SW con commit SHA |
| `npm run ios:sync` | build + `npx cap sync ios` |
| `npm run ios:open` | abre Xcode (sin build) |
| `npm run ios:run` | build + sync + open Xcode |
| `npm run ios:fresh` | borra `dist/` y `ios/App/App/public/`, build + sync + open |
| `npm run ios:clean` | solo borra caches (`dist`, `public` iOS, `.vite`) |

**Cuándo usar cada uno**:
- Cambio chico de UI/lógica → `ios:run` (es lo de siempre)
- Cambios que no aparecen tras `ios:run` → `ios:fresh` (asume cache sucio)
- Antes de un commit que vas a probar exhaustivo → `ios:fresh` siempre

## Flujo recomendado en cada iteración

1. Editar código
2. `npm run ios:fresh` (o `ios:run` si confías en el cache)
3. En Xcode:
   - **Product → Clean Build Folder** (Shift+Cmd+K) si toca lib nativa
   - Seleccionar el iPhone físico (o simulador)
   - **Run** (Cmd+R)
4. Apenas la app abra, ir a **Ajustes** y verificar el `build SHA`
5. Si el SHA viejo persiste → ver sección "Build vieja persiste"

## Build vieja persiste — pasos correctivos por nivel

Aplica de menor a mayor agresividad. Probá uno y volvé a abrir Ajustes; si
el SHA cambió, parar.

### Nivel 1: Cache web (más común)
- En Xcode, parar app
- En el iPhone, **forzar cierre** (App Switcher → swipe up)
- Abrir de nuevo. El SW debería instalar la versión nueva.

### Nivel 2: WebView cache + service worker zombi
- Desinstalar Focus del iPhone (long-press → Eliminar app)
- En Mac: `npm run ios:fresh`
- En Xcode: Product → Clean Build Folder
- Run

### Nivel 3: DerivedData de Xcode contaminado
```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
```
- Después: Run en Xcode (recompila todo desde cero, ~30-60s extra)

### Nivel 4: Capacitor pods desincronizados
```bash
cd ios/App && pod install --repo-update && cd ../..
npm run ios:fresh
```

### Nivel 5: PWA instalada en home screen NO refresca
- iOS NO actualiza el icono ni el SW de una PWA pegada al home screen
- Solo aplica si instalaste Focus desde Safari → Compartir → Añadir a inicio
- Solución: long-press el icono → Eliminar app → reinstalar desde Safari
- Esto NO aplica a la app firmada de Xcode (es nativa)

## Riesgos conocidos de cache

| Origen | Mitigación |
|---|---|
| Service worker | `scripts/stamp-sw-version.mjs` corre tras cada `vite build` y bumpa `VERSION` con el SHA, fuerza `controllerchange` |
| WebView (WKWebView) | Capacitor en iOS sirve desde bundle local, no HTTP cache. Pero si `cap sync` falla, queda el `public/` viejo → `ios:fresh` lo borra |
| `dist/` con assets viejos | `ios:fresh` borra `dist/` antes de buildear |
| Vite dep cache | `node_modules/.vite` invalidable con `ios:clean` |
| DerivedData de Xcode | borrarlo manualmente (Nivel 3) |
| Iconos en home screen (PWA) | bumpar `?v=N` en `index.html` y `manifest.json`, o reinstalar |
| localStorage / sessionStorage | desinstalar app o `Settings → General → iPhone Storage → Focus → Offload App` |

## Marca de build: dónde se inyecta

- `vite.config.js` → `define` con `__BUILD_COMMIT__` y `__BUILD_TIME__`
- `src/views/SettingsView.jsx` → componente `BuildStamp` al final
- En CI/Vercel se prefiere `VERCEL_GIT_COMMIT_SHA` antes que `git rev-parse`

## Validación antes de cada sesión de QA

```bash
# 1) Estás en main actualizado
git fetch origin main
git status               # debe estar clean
git log --oneline -3     # ¿coincide con lo que esperás?

# 2) Build limpia
npm run ios:fresh

# 3) En Xcode → Run
# 4) En la app → Ajustes → leer "build XXXXXXX"
# 5) Comparar con: git rev-parse --short HEAD
```

Si los SHAs no coinciden, parar todo y repetir hasta que coincidan. Cualquier
bug encontrado sin esta confirmación es no-confiable.
