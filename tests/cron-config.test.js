import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('GitHub Actions ejecuta el cron de notificaciones de Focus cada 5 minutos', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/notifications-cron.yml', import.meta.url),
    'utf8',
  )

  assert.match(workflow, /cron:\s*['"]\*\/5 \* \* \* \*['"]/)
  assert.match(workflow, /api\/cron-notifications/)
  assert.match(workflow, /CRON_SECRET/)
})

test('Vercel no declara un cron de 5 minutos incompatible con Hobby', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const cron = config.crons?.find((entry) => entry.path === '/api/cron-notifications')

  assert.equal(cron, undefined)
})
