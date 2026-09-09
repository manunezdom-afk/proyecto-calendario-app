import { test, expect } from '@playwright/test'

// Propuestas explícitas del contrato vigente de Hilante. Ninguna se guarda
// antes de aprobarla. Todo proveedor y tráfico externo están interceptados.
test.use({ serviceWorkers: 'block', screenshot: 'off', trace: 'off' })

const TODAY = new Date().toISOString().slice(0, 10)

async function skipOnboarding(page) {
  await page.addInitScript(() => {
    localStorage.setItem('focus_onboarding_completed_v1', '1')
    localStorage.setItem('focus_welcome_last', new Date().toISOString().slice(0, 10))
    localStorage.setItem('focus_hint_welcome-intro-v1', '1')
    localStorage.setItem('focus_hint_empty-day-v1', '1')
    localStorage.setItem('focus_install_dismissed', 'true')
    localStorage.setItem('focus_ai_consent_v2', '1')
    localStorage.setItem('focus_boot_splash_seen', '1')
  })
}

async function mockNovaResponse(page, body) {
  await page.route('**/api/focus-assistant', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, requestId: route.request().headers()['x-request-id'] }),
    })
  })
}

async function openNovaAndSend(page, message) {
  const pill = page.getByRole('button', { name: /abrir hilante/i })
  await expect(pill).toBeVisible({ timeout: 10_000 })
  await pill.click()
  const input = page.getByPlaceholder(/escribe o habla/i)
  await expect(input).toBeVisible({ timeout: 4_000 })
  await input.fill(message)
  await page.getByRole('button', { name: /enviar mensaje/i }).click()
}

test.describe('Hilante — representación de propuestas', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    await page.route('**/api/ai-capabilities', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runtime: 'focus-openai-v1', chat_provider: 'openai' }) }))
    await skipOnboarding(page)
  })
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') return
    const saved = await page.evaluate(() => Object.keys(localStorage).filter(key => /^focus_(events|tasks)/.test(key))
      .flatMap(key => { try { const rows = JSON.parse(localStorage.getItem(key)); return Array.isArray(rows) ? rows : [] } catch { return [] } }))
    expect(saved).toHaveLength(0)
  })

  test('add_event explícitamente propuesto muestra un chip', async ({ page }) => {
    await mockNovaResponse(page, {
      reply: 'Revisa el almuerzo propuesto para hoy.',
      mode: 'proposal', actions: [], proposed_actions: [{
        type: 'add_event',
        event: {
          title: 'Almuerzo con María',
          time: '2:00 PM',
          endTime: '3:00 PM',
          date: TODAY,
          section: 'evening',
          icon: 'restaurant',
        },
      }],
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'almuerzo con maría a las 2 PM')

    // El chip de propuesta debe aparecer con el título exacto
    await expect(page.getByText(/Crear: Almuerzo con María/i)).toBeVisible({ timeout: 6_000 })

    // El botón "Abrir bandeja" aparece para sugerencias propuestas
    await expect(page.getByRole('button', { name: /abrir bandeja/i })).toBeVisible()
  })

  test('add_task explícitamente propuesto muestra un chip', async ({ page }) => {
    await mockNovaResponse(page, {
      reply: 'Revisa la tarea propuesta.',
      mode: 'proposal', actions: [], proposed_actions: [{
        type: 'add_task',
        task: { label: 'Comprar pan', priority: 'Media', category: 'hoy' },
      }],
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'comprar pan')

    await expect(page.getByText(/Crear tarea: Comprar pan/i)).toBeVisible({ timeout: 6_000 })
  })

  test('add_recurring_event genera chip único (no N chips)', async ({ page }) => {
    await mockNovaResponse(page, {
      reply: 'Propuesta de doce sesiones de yoga preparada.',
      mode: 'proposal', actions: [], proposed_actions: [{
        type: 'add_recurring_event',
        event: { title: 'Yoga', date: TODAY, time: '8:00 AM', endTime: '9:00 AM', section: 'focus', icon: 'event' },
        recurrence: { pattern: 'weekly', weekday: 1, startDate: TODAY, count: 12 },
      }],
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'yoga todos los lunes a las 8')

    // UNA sola propuesta para crear (no 12 chips). El cliente expande al aplicar.
    await expect(page.getByText(/Crear: Yoga/i)).toBeVisible({ timeout: 6_000 })
    const chips = page.getByText(/Crear: Yoga/i)
    expect(await chips.count()).toBe(1)
  })

  test('mensaje sin acciones solo muestra reply (no crea propuestas)', async ({ page }) => {
    // Simulación del bug que sufrimos: Nova respondía "Listo, agendé X" sin
    // emitir add_event en branch ambiguous. La defensa del lado cliente es
    // que sin actions, no hay chips de propuesta.
    await mockNovaResponse(page, {
      reply: '¿Cuánto dura? 30 min, 1 h, 2 h, o sin hora de término.',
      actions: [],
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'estudiar Teorías')

    // El reply aparece en el chat
    await expect(page.getByText(/¿Cuánto dura\?/)).toBeVisible({ timeout: 6_000 })

    // La aclaración no produce chips ni cambios guardados.
    expect(await page.getByText(/^(Crear:|Crear tarea:)/i).count()).toBe(0)
    // Tampoco botón "Abrir bandeja" — no hay sugerencias encoladas.
    expect(await page.getByRole('button', { name: /abrir bandeja/i }).count()).toBe(0)
  })

  test('múltiples acciones de tipos distintos generan múltiples chips', async ({ page }) => {
    await mockNovaResponse(page, {
      reply: 'Revisa el evento y la tarea propuestos.',
      mode: 'proposal', actions: [], proposed_actions: [
        {
          type: 'add_event',
          event: { title: 'Reunión con Nico', time: '3:00 PM', endTime: '3:30 PM', date: TODAY, section: 'evening', icon: 'groups' },
        },
        {
          type: 'add_task',
          task: { label: 'Preparar agenda para Nico', category: 'hoy', priority: 'Media' },
        },
      ],
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'reunión con Nico 3pm y prepara agenda')

    await expect(page.getByText(/Crear: Reunión con Nico/i)).toBeVisible({ timeout: 6_000 })
    await expect(page.getByText(/Crear tarea: Preparar agenda para Nico/i)).toBeVisible()

    // Ambas acciones permanecen en revisión, sin guardar eventos ni tareas.
  })

  test('JSON malformado del backend → mensaje de error legible', async ({ page }) => {
    // Simula el caso de fallback del backend (el handler retorna llm_bad_output
    // tras dos intentos de parse fallidos).
    await page.route('**/api/focus-assistant', async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'llm_bad_output',
          reply: 'Tuve un problema procesando la respuesta. Repite el mensaje por favor.',
          actions: [],
        }),
      })
    })
    await page.goto('/?view=calendar')
    await openNovaAndSend(page, 'agenda algo confuso')

    // El cliente decodifica el statusMsg de llm_bad_output. Validamos que el
    // texto del error aparezca, no un spinner colgado o silencio total.
    await expect(page.getByText(/no pude procesarlo|repite|problema/i).first())
      .toBeVisible({ timeout: 6_000 })
  })
})
