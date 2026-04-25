# Focus — protocolo de trabajo en paralelo (Claude × Codex)

Este proyecto se edita con **dos asistentes en paralelo** (Claude Code y Codex). Ambos pushean a `main` y `main` es lo que Vercel deploya a producción (usefocus.me). Para que los cambios de uno NO pisen los del otro, seguir este protocolo sin excepción.

## Antes de empezar a editar archivos

1. `git fetch origin main`
2. `git rebase origin/main` (si la rama actual no es `main`)
3. Solo entonces leer/editar.

Si rebase tira conflictos: parar, mostrar el conflicto al usuario, resolverlo con su input. **Nunca** descartar los cambios del otro asistente como atajo (`git checkout --theirs`/`--ours` ciego, `git reset --hard`, etc.).

## Después de commitear

1. `git add <archivos-específicos>` — **nunca** `git add .` ni `git add -A`. El otro asistente puede tener cambios in-flight en otros archivos.
2. `git commit -m "..."`
3. `git fetch origin main && git rebase origin/main` (por si llegaron commits nuevos mientras editabas).
4. `git push origin HEAD:main` (fast-forward push directo a main).

Si el push es rechazado por non-fast-forward: repetir paso 3 y reintentar. Nunca usar `--force` ni `--force-with-lease` sobre `main`.

## Reglas firmes

- **PROHIBIDO `git push --force`/`-f` a main.** Borra los commits del otro asistente sin aviso.
- **PROHIBIDO `git reset --hard`** sin verificar `git status` y `git log` primero.
- **PROHIBIDO** stagear archivos que no tocaste en esta sesión. Si aparecen modificados de otro lado, dejarlos.
- `.claude/settings.local.json` y similares: nunca commitear, son locales.
- Para cambios riesgosos (deps, schema DB, refactor grande) → rama feature + PR, no push directo.

## Vercel + caches

- Solo `main` → producción. Ramas no deployan (salvo preview).
- `scripts/stamp-sw-version.mjs` corre en cada `vite build` y bumpa el `VERSION` del service worker con el commit SHA → caches viejos del SW se invalidan automáticamente.
- Cuando cambien archivos en `public/icons/` (favicon, apple-touch-icon, icon-192/512): bumpar el query string `?v=N` en `index.html` y `public/manifest.json` para forzar cache-bust del browser HTTP.
- iOS instalado en home screen NUNCA refresca su icono. El usuario debe desinstalar (long-press → eliminar) y reinstalar desde Safari → Compartir → Añadir a pantalla de inicio.

## Memoria entre asistentes

- `CLAUDE.md` (este archivo) lo lee Claude Code automáticamente al inicio de cada sesión.
- `AGENTS.md` es una copia con el mismo contenido para Codex y otros agentes que sigan esa convención.
- Si actualizás uno, actualizá el otro.
