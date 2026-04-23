// Estampa dist/sw.js con un VERSION único por build.
//
// Razón: el SW usa `const VERSION = 'vXX'` como clave de sus caches. Si un
// deploy solo cambia JSX/CSS pero sw.js queda idéntico byte-a-byte, el
// navegador NO instala un SW nuevo → no hay `controllerchange` → la PWA
// sigue sirviendo el shell cacheado y los cambios no aparecen hasta que
// el usuario limpia todo a mano.
//
// Este script corre después de `vite build` y sobrescribe el VERSION del
// sw.js copiado a dist con el SHA del commit (Vercel) o un timestamp
// (local). `public/sw.js` en git queda intacto — el stamp vive solo en
// el artefacto desplegado.

import { readFile, writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SW_PATH = resolve(__dirname, '..', 'dist', 'sw.js')

function resolveVersion() {
  // Vercel inyecta VERCEL_GIT_COMMIT_SHA en prod y preview builds.
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA
  if (vercelSha) return vercelSha.slice(0, 7)

  // Local: intentamos git rev-parse. Si el directorio no es un repo
  // (raro, pero p. ej. CI aislado), caemos a timestamp para que al
  // menos cambie en cada build.
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return `t${Date.now().toString(36)}`
  }
}

async function main() {
  if (!existsSync(SW_PATH)) {
    console.warn(`[stamp-sw-version] ${SW_PATH} no existe. ¿Corriste vite build antes?`)
    process.exit(0)
  }

  const version = resolveVersion()
  const source = await readFile(SW_PATH, 'utf8')
  const stamped = source.replace(
    /const VERSION = '[^']+'/,
    `const VERSION = '${version}'`,
  )

  if (stamped === source) {
    console.warn('[stamp-sw-version] no se encontró el VERSION a reemplazar en sw.js')
    process.exit(1)
  }

  await writeFile(SW_PATH, stamped, 'utf8')
  console.log(`[stamp-sw-version] sw.js estampado con VERSION='${version}'`)
}

main().catch((err) => {
  console.error('[stamp-sw-version] error:', err)
  process.exit(1)
})
