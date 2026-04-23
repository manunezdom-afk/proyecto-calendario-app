import { useState, useEffect, lazy, Suspense } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useEvents }        from './hooks/useEvents'
import { useTasks }         from './hooks/useTasks'
import { useNotifications } from './hooks/useNotifications'
import { useSuggestions }   from './hooks/useSuggestions'
import { useUserMemories }  from './hooks/useUserMemories'
import { useAuth }          from './context/AuthContext'
import { actionToSuggestion, applySuggestion } from './utils/actionToSuggestion'

// Eager: todo lo que se pinta en el primer render del planner (landing).
// Mantener chicos y rápidos; lo que entra aquí penaliza cada cold start.
import TopAppBar                   from './components/TopAppBar'
import BottomNavBar                from './components/BottomNavBar'
import DesktopSideBar              from './components/DesktopSideBar'
import NotificationPanel           from './components/NotificationPanel'
import AuthModal                   from './components/AuthModal'
import NovaWidget                  from './components/NovaWidget'
import MorningBrief                from './components/MorningBrief'
import WelcomeScreen, { useWelcomeGate } from './components/WelcomeScreen'
import InstallAppCard              from './components/InstallAppCard'
import AuroraBackground            from './components/AuroraBackground'
import NovaHint                    from './components/NovaHint'
import UndoToast                   from './components/UndoToast'
import FirstLaunchOnboarding, { useOnboardingGate } from './components/FirstLaunchOnboarding'
import PlannerView                 from './views/PlannerView'
import { useFirstRunSequence }     from './hooks/useFirstRunSequence'
import { writeIncomingPairCode, normalizeUserCode } from './utils/devicePairing'

// Lazy: vistas y sheets secundarias. Solo bajan cuando el usuario navega a
// ellas, con lo que el bundle inicial en iPhone baja ~200 KB (parse+eval
// en devices antiguos pasa de ~2 s a ~1 s). Cada una queda en su propio
// chunk de Vite y se cachea agresivamente (mismo hash en el filename).
const CalendarView      = lazy(() => import('./views/CalendarView'))
const DayView           = lazy(() => import('./views/DayView'))
const TaskDetailView    = lazy(() => import('./views/TaskDetailView'))
const TasksView         = lazy(() => import('./views/TasksView'))
const SettingsView      = lazy(() => import('./views/SettingsView'))
const MemoryView        = lazy(() => import('./views/MemoryView'))
const NovaKnowsView     = lazy(() => import('./views/NovaKnowsView'))
const CommandPalette    = lazy(() => import('./components/CommandPalette'))
const QuickAddSheet     = lazy(() => import('./components/QuickAddSheet'))
const ImportExportSheet = lazy(() => import('./components/ImportExportSheet'))
const EveningShutdown   = lazy(() => import('./components/EveningShutdown'))
const SuggestionsInbox  = lazy(() => import('./components/SuggestionsInbox'))

const LAST_OPENED_KEY = 'nova_last_opened'

const pageVariants = {
  initial: { opacity: 0, y: 6, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: 0.08 } },
}

export default function App() {
  const { authModal, setAuthModal, user } = useAuth()
  const { show: showOnboarding, complete: completeOnboarding } = useOnboardingGate()
  // El welcome es la "threshold scene" que saluda una vez por día. Si el
  // onboarding va a mostrarse, suprimimos el welcome: no queremos encadenar
  // dos pantallas oscuras en el primer uso.
  const { show: showWelcomeRaw, dismiss: dismissWelcome } = useWelcomeGate()
  const showWelcome = showWelcomeRaw && !showOnboarding

  // Si el usuario recargó con un OTP pendiente (sessionStorage), reabrimos
  // el modal en cuanto la bienvenida termina — evita que el flujo se pierda.
  useEffect(() => {
    if (user || showWelcome) return
    try {
      const raw = sessionStorage.getItem('focus_auth_pending')
      if (raw) {
        const parsed = JSON.parse(raw)
        const fresh = parsed?.ts && (Date.now() - parsed.ts < 15 * 60 * 1000)
        if (fresh && !authModal) setAuthModal(true)
      }
    } catch {}
  }, [user, showWelcome]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link de vinculación: ?pair=XXXXXXXX en la URL.
  //
  // Caso típico: el dispositivo LOGUEADO muestra un QR con el URL de la app +
  // ?pair=CODE. La cámara nativa del dispositivo nuevo lee ese QR y abre el
  // link en Safari/PWA. Levantamos el código, lo guardamos en sessionStorage
  // y limpiamos la URL para que un refresh no lo reaplique. Si NO hay sesión
  // (caso esperado), el AuthModal lo consume en `device_scan` y canjea. Si
  // ya hay sesión, el código se ignora — el QR no está pensado para reusar
  // en el mismo dispositivo que lo generó.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      const raw = url.searchParams.get('pair')
      if (!raw) return
      const code = normalizeUserCode(raw)
      // Siempre limpiamos el parámetro de la URL (aunque el código sea
      // inválido, no queremos que quede colgando en la barra).
      url.searchParams.delete('pair')
      const next = url.pathname + (url.search ? url.search : '') + (url.hash || '')
      window.history.replaceState(window.history.state, '', next)
      if (!code) return
      writeIncomingPairCode(code)
      if (!authModal) setAuthModal(true)
    } catch {}
    // Solo corremos una vez al montar; si más adelante cambia la URL vía
    // navigate/popstate, el usuario tendrá que scanear de nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const VALID_VIEWS = ['planner', 'calendar', 'day', 'tasks', 'settings']
  const initialView = () => {
    try {
      const v = new URLSearchParams(window.location.search).get('view')
      return VALID_VIEWS.includes(v) ? v : 'planner'
    } catch {
      return 'planner'
    }
  }
  const [activeView, setActiveView]     = useState(initialView)
  const [previousView, setPreviousView] = useState('planner')

  useEffect(() => {
    function onPop() {
      const v = new URLSearchParams(window.location.search).get('view')
      setActiveView(VALID_VIEWS.includes(v) ? v : 'planner')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Estado de conectividad. Mostramos un pill de "Sin conexión" cuando el
  // navegador declara offline, para que el usuario sepa que sus cambios viven
  // locales y se sincronizarán al volver. Sin esto, el silencio puede
  // interpretarse como "se perdió lo que acabo de escribir" — matando la
  // confianza justo cuando necesitamos que confíe en la PWA.
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  )
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const { events, addEvent, deleteEvent, editEvent } = useEvents()
  const { tasks, addTask, toggleTask, deleteTask, updateTask } = useTasks()
  const { memories } = useUserMemories()
  const {
    suggestions,
    pendingCount: inboxPendingCount,
    addSuggestion,
    approveSuggestion,
    rejectSuggestion,
    clearResolved: clearResolvedSuggestions,
  } = useSuggestions()

  const [inboxOpen, setInboxOpen] = useState(false)
  // Toast efímero al aprobar una sugerencia. Visible ~3.5 s sin interrumpir.
  const [approvalToast, setApprovalToast] = useState(null)

  // Undo global — la promesa que el onboarding hace al usuario: "cualquier
  // cambio lo puedes deshacer en un toque". Cada acción creativa que Nova
  // aplique (crear evento/tarea/memoria, aprobar suggestion) llama a
  // showUndo() con un mensaje humano y un callback que revierte. UndoToast
  // vive 7s y luego desaparece; si llega otro undoable antes, reemplaza al
  // anterior (lo pendiente se considera aceptado).
  const [undoable, setUndoable] = useState(null)
  const showUndo = (message, undo) => {
    if (!undo) return
    setUndoable({ id: `undo-${Date.now()}`, message, undo })
  }

  // Handlers para ejecutar una sugerencia aprobada
  const suggestionHandlers = {
    onAddEvent: addEvent,
    onEditEvent: editEvent,
    onDeleteEvent: deleteEvent,
    onAddTask: addTask,
    onToggleTask: toggleTask,
    onDeleteTask: deleteTask,
  }

  function handleApproveSuggestion(id) {
    const s = suggestions.find((x) => x.id === id)
    if (s) {
      const result = applySuggestion(s, suggestionHandlers)
      // Si la aplicación es reversible (add_event/add_task), ofrecemos Deshacer.
      // Si no, mantenemos el toast verde de siempre — p. ej. toggles/edits no
      // tienen estado previo que podamos restaurar.
      if (result?.undo) {
        showUndo(result.message, result.undo)
      } else {
        const label = s.title || s.summary || 'Sugerencia'
        setApprovalToast({ id: `${id}-${Date.now()}`, label })
      }
    }
    approveSuggestion(id)
  }

  useEffect(() => {
    if (!approvalToast) return
    const t = setTimeout(() => setApprovalToast(null), 3500)
    return () => clearTimeout(t)
  }, [approvalToast])

  // Callback que Nova invoca con sus propuestas → encolamos
  function handleProposeActions(actions, { reply } = {}) {
    const batchId = `batch-${Date.now()}`
    for (const action of actions) {
      const sug = actionToSuggestion(action, { reason: reply, batchId, events, tasks })
      if (sug) addSuggestion(sug)
    }
  }

  const {
    notifLog, unreadCount,
    permissionState, permissionDismissed,
    requestPermission, dismissPermissionCard,
    markAllRead, dismiss: dismissNotif,
  } = useNotifications({ events })

  // ── Permission contextual ────────────────────────────────────────────────
  // En vez de pedir notificaciones en el primer arranque, esperamos a que
  // exista al menos un evento real. Ese momento = "el usuario quiere que lo
  // recordemos". Aceptación sube, fricción baja.
  const contextualPermission =
    permissionState === 'default' &&
    !permissionDismissed &&
    (events?.length ?? 0) > 0 &&
    !showWelcome &&
    !showOnboarding

  const [notifPanelOpen,      setNotifPanelOpen]      = useState(false)
  const [importExportOpen,    setImportExportOpen]    = useState(false)
  const [importExportInitialTab, setImportExportInitialTab] = useState('export')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuickAdd, setPaletteQuickAdd] = useState(false)

  // ── Command Palette ⌘K ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      const cmd = e.metaKey || e.ctrlKey
      if (cmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // "/" abre la paleta también, salvo si el foco está en un input/textarea
      if (e.key === '/' && !paletteOpen) {
        const tag = (e.target?.tagName || '').toLowerCase()
        const editable = e.target?.isContentEditable
        if (tag === 'input' || tag === 'textarea' || editable) return
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen])

  // ── Morning Brief ─────────────────────────────────────────────────────────
  const [showMorningBrief,   setShowMorningBrief]   = useState(false)
  const [showEveningShutdown, setShowEveningShutdown] = useState(false)

  useEffect(() => {
    // No apilamos el brief arriba del onboarding — sería demasiado en el
    // primer uso. El brief empieza a aparecer desde el día siguiente.
    if (showOnboarding) return
    const today = new Date().toISOString().slice(0, 10)
    const last  = localStorage.getItem(LAST_OPENED_KEY)
    const hour  = new Date().getHours()
    // Solo mostrar el brief matutino si es realmente la mañana (5 AM – 12 PM).
    // Abrir la app a las 21:00 no tiene por qué dispararlo con "¿Arrancamos?".
    const isMorning = hour >= 5 && hour < 12
    // Si el usuario ya pulsó "Empezar el día" hoy, no volvemos a ofrecerle
    // el brief aunque reabra la app: ya arrancó, el botón quedaría redundante.
    const alreadyStarted = localStorage.getItem(`focus:day_started:${today}`) === '1'
    if (last !== today && isMorning && !alreadyStarted) {
      const timer = setTimeout(() => setShowMorningBrief(true), 600)
      localStorage.setItem(LAST_OPENED_KEY, today)
      return () => clearTimeout(timer)
    }
  }, [showOnboarding])

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(view) {
    // Subviews (memory / nova-knows) no viven en el bottom nav. Si navegamos a
    // una desde cualquier vista principal, guardamos la actual como previousView
    // para que el botón de back vuelva al punto de origen — p.ej. desde el
    // command palette en Planner, "volver" debe regresar al Planner, no a Ajustes.
    if ((view === 'memory' || view === 'nova-knows') && activeView !== 'task-detail') {
      setPreviousView(activeView)
    }
    setActiveView(view)
    try {
      const url = new URL(window.location.href)
      if (VALID_VIEWS.includes(view) && view !== 'planner') url.searchParams.set('view', view)
      else url.searchParams.delete('view')
      window.history.pushState({ view }, '', url.toString())
    } catch {}
  }

  function openTaskDetail(event = null) {
    setSelectedEvent(event)
    setPreviousView(activeView)
    setActiveView('task-detail')
  }

  function goBack() {
    setActiveView(previousView)
    setSelectedEvent(null)
  }

  function handleSaveTask(updates) {
    if (selectedEvent?.id) editEvent(selectedEvent.id, updates)
  }

  const isDetail = activeView === 'task-detail'
  const isSubView = isDetail || activeView === 'memory' || activeView === 'nova-knows'
  const navView  = isSubView ? (previousView || 'settings') : activeView

  const firstRun = useFirstRunSequence()
  // Todos los flotantes (hints, install card, brief) esperan a que tanto el
  // onboarding como el welcome terminen. Así la primera impresión no satura.
  const gatesBlocking = showWelcome || showOnboarding
  const showInstallCard = firstRun.step === 'install' && !gatesBlocking
  const hasNovaConflictHint = (events?.length ?? 0) >= 2
  const hasNovaEmptyHint = (events?.length ?? 0) === 0 && activeView === 'planner'

  // ── Shared PlannerView props ──────────────────────────────────────────────
  const plannerProps = {
    events,
    tasks,
    onAddEvent:        addEvent,
    onEditEvent:       editEvent,
    onDeleteEvent:     deleteEvent,
    onAddTask:         addTask,
    onToggleTask:      toggleTask,
    onDeleteTask:      deleteTask,
    onEveningShutdown: () => setShowEveningShutdown(true),
    onNavigate:        navigate,
    onShowUndo:        showUndo,
    morningBrief: (showMorningBrief && !showWelcome && !showOnboarding) ? {
      events,
      tasks,
      onStart:      () => { setShowMorningBrief(false); handleStartDay() },
      onDismiss:    () => setShowMorningBrief(false),
    } : null,
  }

  // Al arrancar el día desde el brief, navegamos al planner, marcamos que
  // el usuario ya "arrancó" hoy (para no volver a ofrecer el brief en el
  // mismo día aunque vuelva a abrir), y mostramos un toast con la primera
  // acción concreta del día: o el próximo bloque de agenda, o un empujón
  // amable si no hay nada armado. Además scrolleamos al próximo evento
  // con un ring de color para que el usuario vea dónde continuar.
  function handleStartDay() {
    navigate('planner')
    try {
      const today = new Date().toISOString().slice(0, 10)
      localStorage.setItem(`focus:day_started:${today}`, '1')
    } catch {}

    // Próximo evento de hoy por hora. Si no hay, miramos si hay tareas
    // pendientes para sugerir foco. Todo offline, sin pedirle nada a Nova.
    const today = new Date().toISOString().slice(0, 10)
    const nowMin = (() => {
      const d = new Date()
      return d.getHours() * 60 + d.getMinutes()
    })()
    const toMin = (hhmm) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null
    }
    const todayEvents = (events || [])
      .filter((e) => (e?.date || today) === today && toMin(e?.time) != null)
      .sort((a, b) => toMin(a.time) - toMin(b.time))
    const nextEv = todayEvents.find((e) => toMin(e.time) >= nowMin - 5) || todayEvents[0] || null
    const pendingTasks = (tasks || []).filter((t) => !t.done)

    if (nextEv) {
      setApprovalToast({
        id: `day-start-${Date.now()}`,
        label: nextEv.time ? `${nextEv.time} · ${nextEv.title}` : nextEv.title,
      })
    } else if (pendingTasks.length > 0) {
      const t = pendingTasks[0]
      setApprovalToast({
        id: `day-start-${Date.now()}`,
        label: `Empieza por: ${t.label}`,
      })
    } else {
      setApprovalToast({
        id: `day-start-${Date.now()}`,
        label: 'Día libre. Pídele a Nova un plan.',
      })
    }

    setTimeout(() => {
      const nextEventEl = document.querySelector('[data-next-event]')
      if (nextEventEl) {
        nextEventEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        nextEventEl.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
        setTimeout(() => {
          nextEventEl.classList.remove('ring-2', 'ring-primary', 'ring-offset-2')
        }, 2000)
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, 400)
  }

  return (
    <LayoutGroup>
    {/* Aurora ambiente — firma de marca, continuidad con landing.
        Renderizada fuera del wrapper principal para que el bg-surface no la tape. */}
    <AuroraBackground variant="app" intensity={0.55} />
    <div className="relative z-[1] min-h-screen overflow-hidden">
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        <TopAppBar
          showBack={isDetail}
          onBack={isDetail ? goBack : undefined}
          onBellClick={() => setNotifPanelOpen(true)}
          unreadCount={unreadCount}
          onShareClick={() => setImportExportOpen(true)}
          onInboxClick={() => setInboxOpen(true)}
          inboxCount={inboxPendingCount}
          onSearchClick={() => setPaletteOpen(true)}
        />
      </motion.div>

      {/* Banda de offline. Discreta pero constante — el usuario necesita saber
          que sus cambios viven locales hasta que vuelva la red, y no hay otra
          fuente de señal obvia (las mutaciones no fallan, las guardamos en
          cola). z-index bajo para no competir con toasts/modales. */}
      {!isOnline && (
        <div className="fixed left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top,0px)+56px)] z-[30] pointer-events-none">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-[11px] font-semibold shadow-lg backdrop-blur">
            <span className="material-symbols-outlined text-[14px]">cloud_off</span>
            Sin conexión · guardando local
          </div>
        </div>
      )}

      {isDesktop && !isDetail && (
        <DesktopSideBar
          activeView={navView}
          onNavigate={navigate}
        />
      )}

      <main
        className={`relative z-10 ${isDesktop && !isDetail ? "pb-0 pl-[72px]" : "w-full"}`}
        style={!isDesktop || isDetail ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' } : undefined}
      >
        {/* ── Single-view layout: cada botón del sidebar → su propia vista ──
            Suspense envuelve TODO para cubrir las vistas lazy. Fallback null
            — el micro-flash entre navegación es imperceptible porque los
            chunks de cada vista están ya cacheados tras la primera visita. */}
        {(
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full"
            >
              <Suspense fallback={null}>
              {activeView === 'planner' && <PlannerView {...plannerProps} isDesktop={isDesktop} />}

              {activeView === 'calendar' && (
                <CalendarView
                  events={events}
                  tasks={tasks}
                  onAddEvent={addEvent}
                  onDeleteEvent={deleteEvent}
                  onEditEvent={editEvent}
                  onOpenTask={(event) => openTaskDetail(event)}
                  onExportClick={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
                  onOpenDay={(iso) => {
                    try {
                      const url = new URL(window.location.href)
                      url.searchParams.set('view', 'day')
                      if (iso) url.searchParams.set('date', iso)
                      window.history.pushState({ view: 'day' }, '', url.toString())
                    } catch {}
                    setActiveView('day')
                  }}
                  isDesktop={isDesktop}
                />
              )}

              {activeView === 'day' && (
                <DayView
                  events={events}
                  tasks={tasks}
                  onAddEvent={addEvent}
                  onOpenTask={(event) => openTaskDetail(event)}
                  onOpenImport={() => { setImportExportInitialTab('import'); setImportExportOpen(true) }}
                  onOpenPhotoImport={() => { setImportExportInitialTab('photo'); setImportExportOpen(true) }}
                  isDesktop={isDesktop}
                />
              )}

              {activeView === 'tasks' && (
                <TasksView
                  tasks={tasks}
                  events={events}
                  addTask={addTask}
                  toggleTask={toggleTask}
                  deleteTask={deleteTask}
                  updateTask={updateTask}
                  onNavigate={navigate}
                />
              )}

              {activeView === 'task-detail' && (
                <TaskDetailView event={selectedEvent} onBack={goBack} onSave={handleSaveTask} onDelete={deleteEvent} />
              )}

              {activeView === 'settings' && (
                <SettingsView
                  memoriesCount={memories.length}
                  onOpenImport={() => { setImportExportInitialTab('import'); setImportExportOpen(true) }}
                  onOpenMemory={() => { setPreviousView('settings'); setActiveView('memory') }}
                  onOpenNovaKnows={() => { setPreviousView('settings'); setActiveView('nova-knows') }}
                />
              )}

              {activeView === 'memory' && (
                <div>
                  <div className="max-w-lg lg:max-w-2xl mx-auto px-4 pt-4">
                    <button
                      onClick={() => setActiveView(previousView || 'settings')}
                      className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                      {previousView === 'planner' ? 'Mi día'
                        : previousView === 'calendar' ? 'Calendario'
                        : previousView === 'tasks' ? 'Tareas'
                        : 'Ajustes'}
                    </button>
                  </div>
                  <MemoryView />
                </div>
              )}

              {activeView === 'nova-knows' && (
                <NovaKnowsView onBack={() => setActiveView(previousView || 'settings')} />
              )}


              </Suspense>
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* ── Bottom Nav ────────────────────────────────────────────────────── */}
      {!isDesktop && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, type: 'spring', damping: 20 }}
          className="fixed bottom-0 left-0 right-0 z-40"
        >
          <BottomNavBar activeView={navView} onNavigate={navigate} />
        </motion.div>
      )}

      {/* ── Nova Widget — solo en vistas sin FocusBar (calendar, tasks, settings) ── */}
      {activeView !== 'planner' && (
        <NovaWidget
          events={events}
          tasks={tasks}
          onAddEvent={addEvent}
          onEditEvent={editEvent}
          onDeleteEvent={deleteEvent}
          onAddTask={addTask}
          onToggleTask={toggleTask}
          onDeleteTask={deleteTask}
          onProposeActions={handleProposeActions}
          onOpenInbox={() => setInboxOpen(true)}
          proposeMode={true}
          isDesktop={isDesktop}
        />
      )}

      {/* ── Bandeja de sugerencias ──────────────────────────────────────────
          Lazy: solo bajamos el chunk la primera vez que el usuario la abre.
          Antes estaba eager y pesaba en el bundle inicial aunque la bandeja
          vive oculta en cada cold start. */}
      {inboxOpen && (
        <Suspense fallback={null}>
          <SuggestionsInbox
            isOpen={inboxOpen}
            onClose={() => setInboxOpen(false)}
            suggestions={suggestions}
            onApprove={handleApproveSuggestion}
            onReject={rejectSuggestion}
            onClearResolved={clearResolvedSuggestions}
          />
        </Suspense>
      )}

      {/* Undo global ───────────────────────────────────────────────────────── */}
      <UndoToast action={undoable} onDismiss={() => setUndoable(null)} />

      {/* Toast de confirmación al aprobar sugerencia ──────────────────────── */}
      <AnimatePresence>
        {approvalToast && (
          <motion.div
            key={approvalToast.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-3 rounded-2xl bg-slate-900/95 text-white shadow-[0_20px_48px_rgba(0,0,0,0.25)] backdrop-blur flex items-center gap-2.5 max-w-[min(92vw,420px)]"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6.5rem)' }}
          >
            <span
              className="material-symbols-outlined text-emerald-300 text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden="true"
            >
              check_circle
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300/90">
                {approvalToast.id?.startsWith('day-start-') ? 'Empieza por' : 'Añadido'}
              </p>
              <p className="text-[13px] font-semibold leading-tight truncate">{approvalToast.label}</p>
            </div>
            <button
              type="button"
              onClick={() => setApprovalToast(null)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              OK
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Morning Brief (solo modal en mobile; desktop: inline en PlannerView) */}
      <AnimatePresence>
        {showMorningBrief && !isDesktop && !showWelcome && !showOnboarding && (
          <MorningBrief
            events={events}
            tasks={tasks}
            onStart={()      => { setShowMorningBrief(false); handleStartDay() }}
            onDismiss={()    => setShowMorningBrief(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Threshold Scene — la pantalla-firma de entrada (una vez por día) ── */}
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen
            onEnter={() => {
              dismissWelcome()
              // Al terminar la threshold dark, liberamos el dark-boot para
              // que la app (bg surface) se pinte en una sola transición.
              try { document.documentElement.classList.remove('focus-dark-boot') } catch {}
            }}
            hasEvents={(events?.length ?? 0) > 0}
            hasFirstTime={(events?.length ?? 0) === 0 && (tasks?.length ?? 0) === 0}
          />
        )}
      </AnimatePresence>

      {/* ── First-launch onboarding — tutorial animado de primer uso ───────── */}
      <AnimatePresence>
        {showOnboarding && (
          <FirstLaunchOnboarding
            onDone={() => {
              // Cierre atómico: el hook ya persiste "completado" y marca el
              // welcome del día. Además descartamos el welcome en memoria
              // para que no aparezca detrás del onboarding.
              completeOnboarding()
              dismissWelcome()
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Nova hints contextuales (reemplazan el tour modal) ─────────────── */}
      {/* Regla: una sola burbuja a la vez. Si el día está vacío, mostramos
          el hint accionable (empty-day). Si no, el intro genérico. */}
      {!gatesBlocking && activeView === 'planner' && !hasNovaEmptyHint && (
        <NovaHint
          id="welcome-intro-v1"
          delayMs={1400}
        >
          Soy Nova. Agrego eventos, tareas y bloques al instante — y cada cambio trae un "Deshacer" visible. Háblame tocando el orbe.
        </NovaHint>
      )}
      {!gatesBlocking && hasNovaEmptyHint && (
        <NovaHint
          id="empty-day-v1"
          delayMs={1400}
        >
          Tu día está en blanco. Dime qué quieres agendar y lo agrego.
        </NovaHint>
      )}
      {!gatesBlocking && !hasNovaEmptyHint && hasNovaConflictHint && (
        <NovaHint
          id="inbox-hint-v1"
          delayMs={4200}
          actionLabel="Ver bandeja"
          onAction={() => setInboxOpen(true)}
        >
          Si detecto un conflicto que no puedo resolver solo, te dejo una propuesta en la bandeja para que decidas.
        </NovaHint>
      )}

      {/* ── Permiso de notificaciones — contextual, tras crear un evento ── */}
      {contextualPermission && !showOnboarding && (
        <NovaHint
          id="notif-permission-v1"
          delayMs={1500}
          actionLabel="Activar"
          onAction={requestPermission}
          onDismiss={dismissPermissionCard}
        >
          Puedo avisarte 10 min antes de cada evento. ¿Activamos recordatorios?
        </NovaHint>
      )}

      {/* ── Invitación a instalar la app — aparece desde la 3ra sesión ─── */}
      {showInstallCard && <InstallAppCard onDismissed={firstRun.dismissInstall} />}

      {/* ── Evening Shutdown ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showEveningShutdown && (
          <Suspense fallback={null}>
            <EveningShutdown
              events={events}
              tasks={tasks}
              onClose={()     => setShowEveningShutdown(false)}
              onEditEvent={editEvent}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <NotificationPanel
        isOpen={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
        notifLog={notifLog}
        onMarkAllRead={markAllRead}
        onDismiss={dismissNotif}
      />

      {importExportOpen && (
        <Suspense fallback={null}>
          <ImportExportSheet
            isOpen={importExportOpen}
            onClose={() => setImportExportOpen(false)}
            events={events}
            onImportEvent={addEvent}
            initialTab={importExportInitialTab}
          />
        </Suspense>
      )}

      <AuthModal isOpen={authModal} onClose={() => setAuthModal(false)} />

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            events={events}
            tasks={tasks}
            memories={memories}
            onNavigate={navigate}
            onOpenEvent={(event) => openTaskDetail(event)}
            onQuickAdd={() => { setPaletteOpen(false); setPaletteQuickAdd(true) }}
          />
        </Suspense>
      )}

      {paletteQuickAdd && (
        <Suspense fallback={null}>
          <QuickAddSheet
            onSave={(formData) => { addEvent(formData); setPaletteQuickAdd(false) }}
            onCancel={() => setPaletteQuickAdd(false)}
            existingEvents={events}
          />
        </Suspense>
      )}
    </div>
    </LayoutGroup>
  )
}
