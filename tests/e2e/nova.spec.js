import { test, expect } from '@playwright/test'
import { parseTimeRange } from '../../src/utils/eventDuration.js'

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
  if (consent) await page.evaluate(() => localStorage.setItem('focus_ai_consent_v2', '1'))
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
    await page.route('**/api/ai-capabilities', route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ runtime: 'focus-openai-v1', chat_provider: 'openai' }) }))
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
    await page.evaluate(() => localStorage.setItem('focus_ai_consent_v1', '1'))
    await send(page, 'Ayúdame a ordenar mis pendientes')
    const consent = page.getByRole('alertdialog', { name: 'Consentimiento para usar inteligencia artificial' })
    await expect(consent).toBeVisible()
    await expect(consent).toContainText('OpenAI')
    await expect(consent).toContainText('Si analizas fotos, las imágenes se envían a Anthropic')
    await expect(consent).not.toContainText('DeepSeek')
    expect(calls).toBe(0)
    await consent.getByRole('button', { name: 'Ahora no' }).click()
    await expect(input(page)).toHaveValue('Ayúdame a ordenar mis pendientes')
    expect(calls).toBe(0)
    await sendButton(page).click()
    await consent.getByRole('button', { name: 'Aceptar y enviar' }).click()
    await expect(page.getByText('Podemos ordenar tus pendientes paso a paso.', { exact: true })).toBeVisible()
    expect(calls).toBe(1)
  })

  test('un servidor antiguo no recibe el mensaje y el borrador se conserva', async ({ page }) => {
    let calls = 0
    const checks = []
    await page.route('**/api/ai-capabilities', route => {
      checks.push({ method: route.request().method(), headers: route.request().headers(), body: route.request().postData() })
      return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>Previous deployment</html>' })
    })
    await mockAssistant(page, ({ requestId }) => { calls++; return { body: reply(requestId, 'No debe recibirse.') } })
    await openHilante(page)
    await send(page, 'Este mensaje privado debe quedarse aquí')
    await expect(page.getByText('Estamos actualizando Hilante. Tu mensaje sigue aquí; vuelve a intentarlo en un momento.', { exact: true })).toBeVisible()
    await expect(input(page)).toHaveValue('Este mensaje privado debe quedarse aquí')
    await expect(sendButton(page)).toBeEnabled()
    expect(calls).toBe(0)
    expect(checks).toHaveLength(1)
    expect(checks[0].method).toBe('GET')
    expect(checks[0].headers.authorization).toBeUndefined()
    expect(checks[0].body).toBeNull()
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

  test('refinar una propuesta conserva el plan pendiente y solo guarda el horario aprobado', async ({ page }) => {
    const requests = []
    await mockAssistant(page, ({ requestId, body }) => {
      requests.push(body)
      if (body.message === 'Necesito pensarlo') return { body: { ...reply(requestId, 'Tu propuesta sigue pendiente.'), mode: 'clarification' } }
      const secondRefinement = body.message.startsWith('Prefiero')
      const refining = body.message.startsWith('No quiero') || secondRefinement
      return { body: { requestId, mode: 'proposal', confidence: 1, reply: 'Propuesta preparada.', actions: [],
        ...(refining ? { replacesProposalId: body.pendingProposal?.id } : {}),
        proposed_actions: [{ type: 'add_event', event: { title: 'Estudiar continuidad E2E', date: TODAY,
          time: secondRefinement ? '17:00' : refining ? '18:00' : '19:00', endTime: secondRefinement ? '19:00' : refining ? '20:00' : '21:00' } }] } }
    })
    const pending = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('focus_suggestions'))
      .flatMap(key => { try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }).filter(row => row.status === 'pending'))
    await openHilante(page)
    await send(page, 'Organízame la tarde con dos horas de estudio')
    await expect.poll(async () => (await pending()).length).toBe(1)
    const first = (await pending())[0]
    expect((await savedEvents(page)).filter(row => row.title === 'Estudiar continuidad E2E')).toHaveLength(0)
    await send(page, 'Necesito pensarlo')
    await expect(page.getByText('Tu propuesta sigue pendiente.', { exact: true }).last()).toBeVisible()
    expect((await pending())[0].id).toBe(first.id)
    await send(page, 'No quiero estudiar después de las 8 PM')
    await expect.poll(async () => (await pending())[0]?.payload?.event?.endTime).toBe('20:00')
    const current = await pending()
    expect(current).toHaveLength(1)
    expect(current[0].id).not.toBe(first.id)
    expect(requests[2].pendingProposal.id).toBe(first.batchId)
    expect(requests[2].pendingProposal.originalRequest).toBe('Organízame la tarde con dos horas de estudio')
    expect(requests[2].pendingProposal.actions[0].event.endTime).toBe('21:00')
    expect(requests[2].events.some(row => row.title === 'Estudiar continuidad E2E')).toBe(false)
    expect(JSON.stringify(requests[2].pendingProposal)).not.toContain('reviewedEvent')
    await send(page, 'Prefiero comenzar a las 17')
    await expect.poll(async () => (await pending())[0]?.payload?.event?.endTime).toBe('19:00')
    expect(requests[3].pendingProposal.originalRequest).toBe('Organízame la tarde con dos horas de estudio\nNo quiero estudiar después de las 8 PM')
    expect((await pending())[0].payload.proposalContext.originalRequest).toBe('Organízame la tarde con dos horas de estudio\nNo quiero estudiar después de las 8 PM\nPrefiero comenzar a las 17')
    expect((await savedEvents(page)).filter(row => row.title === 'Estudiar continuidad E2E')).toHaveLength(0)
    await page.getByRole('button', { name: /Abrir bandeja/ }).click()
    await expect(page.getByText(/17:00.*19:00/).first()).toBeVisible()
    await page.getByRole('button', { name: /Aprobar/ }).click()
    await expect(page.getByText('Añadí «Estudiar continuidad E2E» en este dispositivo.', { exact: true }).first()).toBeVisible()
    const saved = (await savedEvents(page)).filter(row => row.title === 'Estudiar continuidad E2E')
    expect(saved).toHaveLength(1)
    expect(parseTimeRange(saved[0].time).startH).toBe(17)
    expect(parseTimeRange(saved[0].time).endH).toBe(19)
  })

  test('el límite de ajustes conserva propuesta y borrador sin otra solicitud', async ({ page }) => {
    let calls = 0
    await mockAssistant(page, ({ requestId }) => {
      calls++
      return { body: { requestId, mode: 'proposal', confidence: 1, reply: 'Propuesta preparada.', actions: [],
        proposed_actions: [{ type: 'add_event', event: { title: 'Estudiar límite E2E', date: TODAY, time: '18:00', endTime: '20:00' } }] } }
    })
    const pending = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('focus_suggestions'))
      .flatMap(key => { try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }).filter(row => row.status === 'pending'))
    await openHilante(page)
    const goal = 'Organiza ' + '😀'.repeat(1990)
    await send(page, goal)
    await expect.poll(async () => (await pending()).length).toBe(1)
    const before = await pending()
    await send(page, 'No quiero estudiar después de las 20')
    await expect(page.getByText('La propuesta llegó al límite de ajustes. La conservé sin aplicar; descártala y pide una planificación nueva con todos tus requisitos.', { exact: true })).toBeVisible()
    await expect(input(page)).toHaveValue('No quiero estudiar después de las 20')
    expect(calls).toBe(1)
    expect(await pending()).toEqual(before)
    expect((await savedEvents(page)).filter(row => row.title === 'Estudiar límite E2E')).toHaveLength(0)
  })

  test('un texto que afirma guardar sin acciones se rechaza y no crea eventos', async ({ page }) => {
    await mockAssistant(page, ({ requestId }) => ({ body: reply(requestId, 'Guardé Gym E2E para mañana.') }))
    await openHilante(page)
    await send(page, 'Agenda Gym E2E mañana')
    await expect(page.getByText('No hay cambios guardados que confirmen esa respuesta. Repite la solicitud.', { exact: true })).toBeVisible()
    await expect(page.getByText('Guardé Gym E2E para mañana.', { exact: true })).toHaveCount(0)
    expect((await savedEvents(page)).filter(event => event.title === 'Gym E2E')).toHaveLength(0)
  })

  test('crear y editar se guardan directamente; borrar exige aprobar la propuesta', async ({ page }) => {
    await mockAssistant(page, ({ requestId, body }) => {
      const current = body.events.find(event => event.title === 'Lectura E2E')
      const action = body.message.startsWith('Crea')
        ? { type: 'add_event', event: { title: 'Lectura E2E', date: TODAY, time: '10:00' } }
        : body.message.startsWith('Mueve')
          ? { type: 'edit_event', id: current?.id, updates: { time: '11:00' } }
          : { type: 'delete_event', id: current?.id }
      return { body: { requestId, mode: 'chat_with_action', confidence: 1,
        reply: 'Acción interpretada.', actions: [action], proposed_actions: [] } }
    })
    await openHilante(page)
    await send(page, 'Crea Lectura E2E hoy a las 10')
    await expect(page.getByText('Añadí «Lectura E2E» en este dispositivo.', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Abrir bandeja/ })).toHaveCount(0)
    const created = (await savedEvents(page)).find(event => event.title === 'Lectura E2E')
    expect(created.time).toBe('10:00')
    await send(page, 'Mueve Lectura E2E a las 11')
    await expect(page.getByText('Actualicé el evento en este dispositivo.', { exact: true }).first()).toBeVisible()
    const edited = (await savedEvents(page)).filter(event => event.title === 'Lectura E2E')
    expect(edited).toHaveLength(1)
    expect(edited[0].id).toBe(created.id)
    expect(edited[0].time).toBe('11:00')
    await send(page, 'Borra Lectura E2E')
    await expect(page.getByText('Preparé una propuesta. Revisa los cambios en la bandeja antes de aplicarlos.', { exact: true })).toBeVisible()
    expect((await savedEvents(page)).some(event => event.id === created.id)).toBe(true)
    await page.getByRole('button', { name: /Abrir bandeja/ }).click()
    await page.getByRole('button', { name: /Aprobar/ }).click()
    await expect(page.getByText('Eliminé el evento en este dispositivo.', { exact: true })).toBeVisible()
    expect((await savedEvents(page)).some(event => event.id === created.id)).toBe(false)
  })

  test('un fallo de almacenamiento no confirma la creación directa', async ({ page }) => {
    await mockAssistant(page, ({ requestId }) => ({ body: { requestId, mode: 'chat_with_action', confidence: 1,
      reply: 'Guardé Lectura E2E.', actions: [{ type: 'add_event', event: { title: 'Lectura E2E', date: TODAY, time: '10:00' } }], proposed_actions: [] } }))
    await openHilante(page)
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('focus_events')) throw new DOMException('Synthetic storage full', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    })
    await send(page, 'Crea Lectura E2E hoy a las 10')
    await expect(page.getByText('No pude guardar todos los cambios en este dispositivo. Revisa tus pendientes antes de repetirlos.', { exact: true })).toBeVisible()
    await expect(page.getByText('Guardé Lectura E2E.', { exact: true })).toHaveCount(0)
    expect((await savedEvents(page)).filter(event => event.title === 'Lectura E2E')).toHaveLength(0)
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
