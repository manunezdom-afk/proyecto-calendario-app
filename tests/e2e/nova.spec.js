import { test, expect } from '@playwright/test'

// Every provider request is mocked; unrelated external HTTP is blocked.
// These tests verify UI receipts, not claims written by the simulated model.
test.use({ serviceWorkers: 'block', screenshot: 'off', trace: 'off' })
const TODAY = new Date().toISOString().slice(0, 10)
const reply = (requestId, text) => ({ requestId, mode: 'chat_only', reply: text, actions: [], proposed_actions: [], confidence: 1 })

async function mockAssistant(page, respond) {
  await page.route('**/api/focus-assistant', async route => {
    const requestId = route.request().headers()['x-request-id']
    const result = await respond({ requestId, body: route.request().postDataJSON() })
    await route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.body) })
  })
}
async function openHilante(page, { consent = true } = {}) {
  await page.goto('/?view=calendar')
  if (consent) await page.evaluate(() => localStorage.setItem('focus_ai_consent_v1', '1'))
  const opener = page.getByRole('button', { name: 'Abrir Hilante', exact: true })
  await expect(opener).toBeVisible({ timeout: 10_000 })
  await opener.click()
  await expect(page.getByPlaceholder('Escribe o habla…')).toBeVisible()
}
const input = page => page.getByPlaceholder('Escribe o habla…')
const sendButton = page => page.getByRole('button', { name: 'Enviar mensaje', exact: true })
async function send(page, message) {
  await input(page).fill(message)
  await expect(sendButton(page)).toBeEnabled()
  await sendButton(page).click()
}
async function savedEvents(page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('focus_events'))
    .flatMap(key => { try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : [] } catch { return [] } }))
}

test.describe('Hilante — consentimiento y resultado verificable', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort()
    })
    await page.addInitScript(() => {
      localStorage.setItem('focus_onboarding_completed_v1', '1')
      localStorage.setItem('focus_welcome_last', new Date().toISOString().slice(0, 10))
      localStorage.setItem('focus_hint_welcome-intro-v1', '1')
      localStorage.setItem('focus_hint_empty-day-v1', '1')
      localStorage.setItem('focus_boot_splash_seen', '1')
      localStorage.setItem('focus_install_dismissed', 'true')
    })
  })

  test('aceptar consentimiento precede al envío; cancelar conserva el texto', async ({ page }) => {
    let calls = 0
    await mockAssistant(page, ({ requestId }) => { calls++; return { body: reply(requestId, 'Podemos ordenar tus pendientes paso a paso.') } })
    await openHilante(page, { consent: false })
    await send(page, 'Ayúdame a ordenar mis pendientes')
    const consent = page.getByRole('alertdialog', { name: 'Consentimiento para usar inteligencia artificial' })
    await expect(consent).toBeVisible()
    await expect(consent).toContainText('Anthropic, DeepSeek u OpenAI')
    expect(calls).toBe(0)
    await consent.getByRole('button', { name: 'Ahora no' }).click()
    await expect(input(page)).toHaveValue('Ayúdame a ordenar mis pendientes')
    expect(calls).toBe(0)
    await sendButton(page).click()
    await consent.getByRole('button', { name: 'Aceptar y enviar' }).click()
    await expect(page.getByText('Podemos ordenar tus pendientes paso a paso.', { exact: true })).toBeVisible()
    expect(calls).toBe(1)
  })

  test('una acción válida confirma un recibo y queda guardada localmente', async ({ page }) => {
    await mockAssistant(page, ({ requestId }) => ({ body: { requestId, mode: 'proposal', confidence: 1,
      reply: 'Propuesta preparada.', actions: [], proposed_actions: [{ type: 'add_event', event: { title: 'Gym E2E', date: TODAY, time: '07:00' } }] } }))
    await openHilante(page)
    await send(page, 'Agenda Gym E2E hoy a las 7')
    await expect(page.getByText('Agenda Gym E2E hoy a las 7', { exact: true })).toBeVisible()
    await expect(page.getByText('Preparé una propuesta. Revisa los cambios en la bandeja antes de aplicarlos.', { exact: true })).toBeVisible()
    expect((await savedEvents(page)).filter(event => event.title === 'Gym E2E')).toHaveLength(0)
    await page.getByRole('button', { name: /Abrir bandeja/ }).click()
    await expect(page.getByRole('heading', { name: 'Bandeja de Hilante', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Aprobar/ }).click()
    await expect(page.getByText('Añadí «Gym E2E» en este dispositivo.', { exact: true }).first()).toBeVisible()
    await expect.poll(async () => (await savedEvents(page)).filter(event => event.title === 'Gym E2E').length).toBe(1)
    const stored = (await savedEvents(page)).find(event => event.title === 'Gym E2E')
    expect(stored.date).toBe(TODAY)
    await page.getByRole('button', { name: 'Cerrar bandeja', exact: true }).click()
    await page.getByRole('button', { name: 'Abrir Hilante', exact: true }).click()
    await expect(input(page)).toHaveValue('')
    await input(page).fill('otro mensaje')
    await expect(sendButton(page)).toBeEnabled()
  })

  test('un texto que afirma guardar sin acciones se rechaza y no crea eventos', async ({ page }) => {
    await mockAssistant(page, ({ requestId }) => ({ body: reply(requestId, 'Guardé Gym E2E para mañana.') }))
    await openHilante(page)
    await send(page, 'Agenda Gym E2E mañana')
    await expect(page.getByText('No hay cambios guardados que confirmen esa respuesta. Repite la solicitud.', { exact: true })).toBeVisible()
    await expect(page.getByText('Guardé Gym E2E para mañana.', { exact: true })).toHaveCount(0)
    expect((await savedEvents(page)).filter(event => event.title === 'Gym E2E')).toHaveLength(0)
  })

  test('error definitivo libera el envío y el reintento explícito usa otra identidad', async ({ page }) => {
    const ids = []
    await mockAssistant(page, ({ requestId }) => {
      ids.push(requestId)
      return ids.length === 1
        ? { status: 503, body: { requestId, error: 'assistant_unavailable', message: 'Servicio temporalmente no disponible.', request_completed: true, request_retryable: true } }
        : { body: reply(requestId, 'Ya podemos continuar.') }
    })
    await openHilante(page)
    await send(page, 'Hola Hilante')
    await expect(page.getByText('Servicio temporalmente no disponible.', { exact: true })).toBeVisible()
    await send(page, 'Hola Hilante')
    await expect(page.getByText('Ya podemos continuar.', { exact: true })).toBeVisible()
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).not.toBe(ids[0])
  })

  test('doble click no duplica solicitud; el envío permanece bloqueado durante la espera', async ({ page }) => {
    let calls = 0
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    await mockAssistant(page, async ({ requestId }) => { calls++; await pending; return { body: reply(requestId, 'Una sola respuesta.') } })
    await openHilante(page)
    await input(page).fill('test doble envío')
    try {
      await sendButton(page).click({ clickCount: 2 })
      await expect.poll(() => calls).toBe(1)
      await expect(sendButton(page)).toBeDisabled()
      await expect(page.getByText('test doble envío', { exact: true })).toHaveCount(1)
    } finally { finish() }
    await expect(page.getByText('Una sola respuesta.', { exact: true })).toBeVisible()
    expect(calls).toBe(1)
  })

  test('cerrar y reabrir durante una respuesta conserva el historial', async ({ page }) => {
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    await mockAssistant(page, async ({ requestId }) => { await pending; return { body: reply(requestId, 'Podemos continuar cuando quieras.') } })
    await openHilante(page)
    try {
      await send(page, 'mensaje en espera')
      await expect(page.getByText('mensaje en espera', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Cerrar Hilante', exact: true }).click()
      await page.getByRole('button', { name: 'Abrir Hilante', exact: true }).click()
      await expect(page.getByText('mensaje en espera', { exact: true })).toBeVisible()
    } finally { finish() }
    await expect(page.getByText('Podemos continuar cuando quieras.', { exact: true })).toBeVisible()
  })

  test('input vacío no permite enviar ni llama al modelo', async ({ page }) => {
    let calls = 0
    await mockAssistant(page, ({ requestId }) => { calls++; return { body: reply(requestId, 'No debe aparecer.') } })
    await openHilante(page)
    await expect(input(page)).toHaveValue('')
    await expect(sendButton(page)).toBeDisabled()
    await input(page).press('Enter')
    await expect(page.getByRole('alertdialog', { name: 'Consentimiento para usar inteligencia artificial' })).toHaveCount(0)
    expect(calls).toBe(0)
  })
})
