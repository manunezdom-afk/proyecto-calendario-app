import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useNativeSwipe } from './lib/useNativeSwipe'
import { EASE_IOS } from './lib/motion'
import * as haptics from './lib/haptics'
import { useEvents }        from './hooks/useEvents'
import { useTasks }         from './hooks/useTasks'
import { useNotifications } from './hooks/useNotifications'
import { useAppBadge }      from './hooks/useAppBadge'
import { useNovaPersonalitySync } from './hooks/useNovaPersonalitySync'
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
import MorningBrief                from './components/MorningBrief'
import WelcomeScreen, { useWelcomeGate } from './components/WelcomeScreen'
import BootSplash, { useBootSplash } from './components/BootSplash'
import InstallAppCard              from './components/InstallAppCard'
import AuroraBackground            from './components/AuroraBackground'
import NovaHint                    from './components/NovaHint'
import UndoToast                   from './components/UndoToast'
import FirstLaunchOnboarding, { useOnboardingGate } from './components/FirstLaunchOnboarding'
import PlannerView                 from './views/PlannerView'
import { useFirstRunSequence }     from './hooks/useFirstRunSequence'

// Lazy: vistas y sheets secundarias. Solo bajan cuando el usuario navega a
// ellas, con lo que el bundle inicial en iPhone baja ~200 KB (parse+eval
// en devices antiguos pasa de ~2 s a ~1 s). Cada una queda en su propio
// chunk de Vite y se cachea agresivamente (mismo hash en el filename).
// NovaWidget pesa ~30 KB y solo se renderiza fuera del planner (calendar/
// tasks/settings). En cold start aterrizamos en planner, así que sacarlo del
// main chunk ahorra ese peso del primer parse.
const NovaWidget            = lazy(() => import('./components/NovaWidget'))
const loadCalendarView      = () => import('./views/CalendarView')
const loadDayView           = () => import('./views/DayView')
const loadTaskDetailView    = () => import('./views/TaskDetailView')
const loadTasksView         = () => import('./views/TasksView')
const loadSettingsView      = () => import('./views/SettingsView')
const loadMemoryView        = () => import('./views/MemoryView')
const loadNovaKnowsView     = () => import('./views/NovaKnowsView')
const loadCommandPalette    = () => import('./components/CommandPalette')
const loadQuickAddSheet     = () => import('./components/QuickAddSheet')
const loadImportExportSheet = () => import('./components/ImportExportSheet')
const loadEveningShutdown   = () => import('./components/EveningShutdown')
const loadSuggestionsInbox  = () => import('./components/SuggestionsInbox')

const CalendarView      = lazy(loadCalendarView)
const DayView           = lazy(loadDayView)
const TaskDetailView    = lazy(loadTaskDetailView)
const TasksView         = lazy(loadTasksView)
const SettingsView      = lazy(loadSettingsView)
const MemoryView        = lazy(loadMemoryView)
const NovaKnowsView     = lazy(loadNovaKnowsView)
const CommandPalette    = lazy(loadCommandPalette)
const QuickAddSheet     = lazy(loadQuickAddSheet)
const ImportExportSheet = lazy(loadImportExportSheet)
const EveningShutdown   = lazy(loadEveningShutdown)
const SuggestionsInbox  = lazy(loadSuggestionsInbox)

const LAST_OPENED_KEY = 'nova_last_opened'
const VALID_VIEWS = ['planner', 'calendar', 'day', 'tasks', 'settings']

// Orden de las pestañas principales para el swipe horizontal mobile.
// `day` y sub-views no entran — la nav inferior tampoco las muestra.
const SWIPE_VIEW_ORDER = ['planner', 'calendar', 'tasks', 'settings']
const SUB_VIEWS = new Set(['task-detail', 'memory', 'nova-knows'])
const VIEW_LABELS = {
  planner: 'Mi Día',
  calendar: 'Calendario',
  day: 'Día',
  tasks: 'Tareas',
  settings: 'Ajustes',
  'task-detail': 'Detalle',
  memory: 'Memoria',
  'nova-knows': 'Hilante aprende',
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function routeDepth(view) {
  return SUB_VIEWS.has(view) ? 1 : 0
}

function getRouteMotion(from, to, intent) {
  if (intent === 'back') return { direction: -1, depth: 'back' }
  if (intent === 'deeper') return { direction: 1, depth: 'deeper' }
  if (from === to) return { direction: 1, depth: 'same' }

  const fromDepth = routeDepth(from)
  const toDepth = routeDepth(to)
  if (toDepth > fromDepth) return { direction: 1, depth: 'deeper' }
  if (toDepth < fromDepth) return { direction: -1, depth: 'back' }

  const fromIndex = VALID_VIEWS.indexOf(from)
  const toIndex = VALID_VIEWS.indexOf(to)
  if (fromIndex >= 0 && toIndex >= 0) {
    return { direction: toIndex > fromIndex ? 1 : -1, depth: 'peer' }
  }
  return { direction: 1, depth: 'peer' }
}

function prefetch(loader) {
  try {
    loader().catch(() => {})
  } catch {}
}

function resetViewportPosition() {
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) } catch {}
  })
}

// Detección de Capacitor — main.jsx ya añade `is-capacitor` al <html> al
// arrancar. Este getter consulta esa marca para que las variants no usen
// transforms (scale/y) que fuerzan al WKWebView a recomputar layers en
// cada cambio de vista. En Capacitor: solo opacity → transición fluida.
function isCapacitorRuntime() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('is-capacitor')
}

// Slide horizontal entre tabs peer (Mi Día → Calendario, etc.). En tap
// también se siente el direccionalismo iOS — no solo un crossfade. Para
// sub-views (deeper / back) seguimos con opacity + escala leve (Apple usa
// crossfade sin slide para "drill-in" en ajustes y pantallas modales).
const PAGE_SLIDE_PX = 28  // discreto; el grueso lo aporta el opacity fade
const PAGE_TRANSITION = { duration: 0.22, ease: EASE_IOS }

const pageVariants = {
  initial: ({ depth = 'peer', direction = 1 } = {}) => {
    if (prefersReducedMotion()) return { opacity: 0 }
    if (depth === 'deeper') return { opacity: 0, scale: 0.98, y: 6 }
    if (depth === 'back')   return { opacity: 0, scale: 1.01 }
    // Peer (cambio horizontal entre tabs root): la vista entrante arranca
    // ligeramente desplazada en la dirección del movimiento.
    return { opacity: 0, x: direction * PAGE_SLIDE_PX }
  },
  animate: {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    transition: PAGE_TRANSITION,
  },
  exit: ({ depth = 'peer', direction = 1 } = {}) => {
    if (prefersReducedMotion()) {
      return { opacity: 0, transition: { duration: 0.10 } }
    }
    if (depth === 'deeper') return { opacity: 0, scale: 0.99, transition: { duration: 0.12, ease: 'easeIn' } }
    if (depth === 'back')   return { opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: 'easeIn' } }
    // Peer: se desplaza al lado opuesto a donde entrará la nueva vista.
    return { opacity: 0, x: -direction * PAGE_SLIDE_PX, transition: { duration: 0.16, ease: EASE_IOS } }
  },
}

function SkeletonBlock({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-slate-200/70 shadow-inner shadow-white/40 ${className}`}
      aria-hidden="true"
    />
  )
}

function RouteFallback({ activeView, isDesktop }) {
  const label = VIEW_LABELS[activeView] || 'Vista'
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Cargando ${label}`}
      className={`min-h-[calc(100vh-96px)] ${isDesktop ? 'px-8 pt-10' : 'px-4 pt-6'}`}
    >
      <div className="fixed inset-x-0 top-0 z-[80] h-[2px] bg-blue-400/40" />
      <div className="mx-auto w-full max-w-5xl">
        <SkeletonBlock className="mb-4 h-4 w-32 rounded-full" />
        <SkeletonBlock className="mb-3 h-12 w-52 rounded-3xl" />
        <SkeletonBlock className="mb-10 h-5 w-full max-w-xl rounded-full" />
        <div className={isDesktop ? 'grid grid-cols-[minmax(0,1fr)_360px] gap-8' : 'space-y-5'}>
          <div className="space-y-5">
            <SkeletonBlock className="h-16 rounded-[2rem]" />
            <SkeletonBlock className="h-48 rounded-[2rem]" />
            <SkeletonBlock className="h-20 rounded-[1.75rem]" />
          </div>
          {isDesktop && (
            <div className="space-y-4 rounded-[2rem] border border-slate-200/80 bg-white/70 p-6 shadow-sm">
              <SkeletonBlock className="h-4 w-36 rounded-full" />
              <SkeletonBlock className="h-8 w-full rounded-xl" />
              <SkeletonBlock className="h-12 rounded-2xl" />
              <SkeletonBlock className="h-12 rounded-2xl" />
              <SkeletonBlock className="h-12 rounded-2xl" />
            </div>
          )}
        </div>
      </div>
      <span className="sr-only">Cargando {label}</span>
    </div>
  )
}

function SheetFallback({ label = 'Cargando' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/20 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-2xl shadow-slate-900/15">
        <SkeletonBlock className="mb-3 h-4 w-28 rounded-full" />
        <SkeletonBlock className="mb-4 h-8 w-52 rounded-2xl" />
        <SkeletonBlock className="h-20 rounded-3xl" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  )
}

export default function App() {
  const { authModal, setAuthModal, user, loading: authLoading } = useAuth()
  const { show: showOnboarding, complete: completeOnboarding } = useOnboardingGate()
  // El welcome es la "threshold scene" que saluda una vez por día. En primer
  // uso lo mostramos antes del onboarding para que el link no "caiga" directo
  // en una pantalla de instrucciones: splash → bienvenida breve → tutorial.
  const { show: showWelcomeRaw, dismiss: dismissWelcome } = useWelcomeGate()
  const showWelcome = showWelcomeRaw
  // BootSplash: pantalla con el icono de marca en cada apertura
  // (estilo Instagram/Spotify). Se mantiene visible al menos ~700ms y
  // hasta que `authLoading=false` — así evitamos el flash de "app sin
  // sesión" en cold start cuando Supabase tarda en hidratar el JWT
  // persistido (típico 200-1500ms en iPhone). Cap defensivo a 4s
  // dentro del hook por si auth se cuelga.
  const { show: showBootSplash } = useBootSplash(authLoading)
  const showOnboardingNow = showOnboarding && !showWelcome

  // Precarga CalendarView y TasksView tras el primer frame para que la primera
  // navegación a esas vistas no dispare el Suspense fallback.
  // CRÍTICO: usar `window.requestIdleCallback` con typeof guard. En iOS Safari
  // y WebKit la variable global directa lanza ReferenceError ("Can't find
  // variable") porque no es propiedad de window enumerable. Eso volaba toda
  // la app en iPhone real (la WebView de Capacitor también es WebKit).
  useEffect(() => {
    const ric = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback : null
    const cic = typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback : null
    const id = ric
      ? ric(() => { loadCalendarView(); loadTasksView() })
      : setTimeout(() => { loadCalendarView(); loadTasksView() }, 800)
    return () => (ric && cic ? cic(id) : clearTimeout(id))
  }, [])

  // Si el usuario recargó con un OTP pendiente (sessionStorage), reabrimos
  // el modal en cuanto la bienvenida termina — evita que el flujo se pierda.
  useEffect(() => {
    if (user || showWelcome || showOnboardingNow) return
    try {
      const raw = sessionStorage.getItem('focus_auth_pending')
      if (raw) {
        const parsed = JSON.parse(raw)
        const fresh = parsed?.ts && (Date.now() - parsed.ts < 15 * 60 * 1000)
        if (fresh && !authModal) setAuthModal(true)
      }
    } catch {}
  }, [user, showWelcome, showOnboardingNow]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const [routeMotion, setRouteMotion] = useState({ direction: 1, depth: 'peer' })
  const activeViewRef = useRef(activeView)
  // Ref del wrapper de la vista activa — useNativeSwipe lo translatea en
  // tiempo real durante el drag (sin re-render). Se monta al motion.div
  // que ya envuelve la AnimatePresence.
  const swipeWrapperRef = useRef(null)

  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  useEffect(() => {
    function onPop() {
      const v = new URLSearchParams(window.location.search).get('view')
      const nextView = VALID_VIEWS.includes(v) ? v : 'planner'
      setRouteMotion(getRouteMotion(activeViewRef.current, nextView, 'back'))
      activeViewRef.current = nextView
      setSelectedEvent(null)
      setActiveView(nextView)
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

  // Badge del icono de la app (iOS PWA y browsers de escritorio compatibles):
  // refleja lo que queda por atender hoy para que la app "llame" al usuario
  // sin tener que estar abierta. Con sesión cerrada se limpia.
  useAppBadge(events, tasks, Boolean(user))

  // Sincroniza la personalidad de Nova entre localStorage y user_profiles
  // para que el cron pueda adaptar el tono de los push.
  useNovaPersonalitySync(user)
  const {
    suggestions,
    pendingCount: inboxPendingCount,
    addSuggestion,
    approveSuggestion,
    rejectSuggestion,
    clearResolved: clearResolvedSuggestions,
  } = useSuggestions()

  const [inboxOpen, setInboxOpen] = useState(false)
  // Demo de propuesta que Nova muestra en la bandeja vacía para que un usuario
  // nuevo entienda cómo se ve una propuesta. Se descarta permanentemente en
  // localStorage — no queremos que reaparezca cada vez que limpie resueltos.
  const INBOX_DEMO_KEY = 'focus_inbox_demo_dismissed_v1'
  const [inboxDemoDismissed, setInboxDemoDismissed] = useState(() => {
    try { return localStorage.getItem(INBOX_DEMO_KEY) === '1' } catch { return false }
  })
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

  // Demo de la bandeja: tres caminos que reusan la infra real (addEvent +
  // showUndo + seed del composer). No persistimos nada "falso" — si el usuario
  // Aprueba, el evento que se crea es 100% real y puede deshacerse con undo.
  function dismissInboxDemo() {
    try { localStorage.setItem(INBOX_DEMO_KEY, '1') } catch {}
    setInboxDemoDismissed(true)
  }
  function handleApproveDemo() {
    // Mañana en local, YYYY-MM-DD
    const t = new Date()
    t.setDate(t.getDate() + 1)
    const tomorrowISO = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    const created = addEvent({
      title: 'Trabajar en lo importante',
      time: '9:00 AM - 11:00 AM',
      date: tomorrowISO,
      section: 'focus',
      icon: 'psychology',
      dotColor: 'bg-secondary-container',
    })
    if (created?.id) {
      showUndo('Evento añadido para mañana', () => deleteEvent(created.id))
    }
    dismissInboxDemo()
    setInboxOpen(false)
  }
  function handleEditDemo() {
    // Seed del composer con el mismo prompt, sin autosubmit — el usuario
    // ajusta antes de mandar. Dos rutas:
    //   1. Si el planner ya está montado (caso común: bandeja se abre sobre
    //      planner), disparamos un custom event que PlannerView escucha y
    //      aplica el seed directo sobre su estado local.
    //   2. Si no, usamos el puente sessionStorage que PlannerView consume al
    //      montarse (para cuando el usuario abre la bandeja desde calendar
    //      o tasks).
    // Dejamos los dos activos porque son complementarios — el listener del
    // evento no hará nada si planner no está montado, y la sessionStorage
    // cubre ese caso.
    const seedText = 'Reserva mañana de 9:00 a 11:00 para trabajar en lo importante'
    const seedContext = {
      label: 'Editando propuesta de Hilante',
      body: 'Ajusta esta propuesta antes de guardarla en tu calendario.',
    }
    try {
      sessionStorage.setItem(
        'focus_pending_nova_seed',
        JSON.stringify({ text: seedText, ts: Date.now(), autosubmit: false, context: seedContext }),
      )
    } catch {}
    dismissInboxDemo()
    setInboxOpen(false)
    navigate('planner')
    // Si planner ya estaba montado, activeView no cambia y el useEffect de
    // mount no se vuelve a disparar. El custom event sí.
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('focus:nova-seed', {
          detail: { text: seedText, autosubmit: false, context: seedContext },
        }))
      } catch {}
    }, 0)
  }

  // Callback que Nova invoca con sus propuestas → encolamos
  // useCallback para que NovaWidget (memo) no re-renderice cada vez que App
  // re-renderiza por estado no relacionado (paletteOpen, notifPanelOpen, etc.).
  const handleProposeActions = useCallback((actions, { reply } = {}) => {
    const batchId = `batch-${Date.now()}`
    for (const action of actions) {
      const sug = actionToSuggestion(action, { reason: reply, batchId, events, tasks })
      if (sug) addSuggestion(sug)
    }
  }, [events, tasks, addSuggestion])

  // Estable para que el shallow-compare de NovaWidget memo lo respete.
  const openInbox = useCallback(() => setInboxOpen(true), [])

  const {
    notifLog, unreadCount,
    permissionState, permissionDismissed,
    requestPermission, dismissPermissionCard,
    markAllRead, dismiss: dismissNotif,
    pushDisconnected, pushHealing, reconnectPush, lastDelivery,
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
    !showOnboardingNow

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
    if (showOnboardingNow) return
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
  }, [showOnboardingNow])

  // ── Navigation ────────────────────────────────────────────────────────────
  function syncRouteUrl(view, { date, replace = false } = {}) {
    try {
      const url = new URL(window.location.href)
      if (VALID_VIEWS.includes(view) && view !== 'planner') url.searchParams.set('view', view)
      else url.searchParams.delete('view')
      if (view === 'day' && date) url.searchParams.set('date', date)
      if (view !== 'day') url.searchParams.delete('date')
      const method = replace ? 'replaceState' : 'pushState'
      window.history[method]({ view }, '', url.toString())
    } catch {}
  }

  function navigate(view, options = {}) {
    const nextView = VALID_VIEWS.includes(view) || SUB_VIEWS.has(view) ? view : 'planner'
    const fromView = activeViewRef.current
    if (nextView === fromView && !options.date) return
    // Subviews (memory / nova-knows) no viven en el bottom nav. Si navegamos a
    // una desde cualquier vista principal, guardamos la actual como previousView
    // para que el botón de back vuelva al punto de origen — p.ej. desde el
    // command palette en Planner, "volver" debe regresar al Planner, no a Ajustes.
    if ((nextView === 'memory' || nextView === 'nova-knows') && fromView !== 'task-detail') {
      setPreviousView(SUB_VIEWS.has(fromView) ? (previousView || 'settings') : fromView)
    }
    if (nextView !== 'task-detail') setSelectedEvent(null)
    setRouteMotion(getRouteMotion(fromView, nextView, options.intent))
    activeViewRef.current = nextView
    setActiveView(nextView)
    if (isDesktop) resetViewportPosition()
    syncRouteUrl(nextView, options)
  }

  function openTaskDetail(event = null) {
    const fromView = activeViewRef.current
    setSelectedEvent(event)
    setPreviousView(SUB_VIEWS.has(fromView) ? (previousView || 'planner') : fromView)
    setRouteMotion(getRouteMotion(fromView, 'task-detail', 'deeper'))
    activeViewRef.current = 'task-detail'
    setActiveView('task-detail')
    if (isDesktop) resetViewportPosition()
  }

  function returnToPreviousView(fallback = 'planner') {
    const target = previousView || fallback
    setRouteMotion(getRouteMotion(activeViewRef.current, target, 'back'))
    setSelectedEvent(null)
    activeViewRef.current = target
    setActiveView(target)
    if (isDesktop) resetViewportPosition()
    syncRouteUrl(target, { replace: true })
  }

  function goBack() {
    returnToPreviousView('planner')
  }

  // Swipe interactivo entre root tabs. El contenido sigue al dedo en
  // tiempo real (transform translate3d aplicado al wrapper vía ref, sin
  // setState por frame), con snap-back si el gesto no alcanza threshold,
  // commit con spring si lo pasa, y rubber-band en los bordes.
  const swipeEnabled = !isDesktop && SWIPE_VIEW_ORDER.includes(activeView)
  const canGoLeft  = useCallback(() => {
    const idx = SWIPE_VIEW_ORDER.indexOf(activeViewRef.current)
    return idx >= 0 && idx < SWIPE_VIEW_ORDER.length - 1
  }, [])
  const canGoRight = useCallback(() => {
    return SWIPE_VIEW_ORDER.indexOf(activeViewRef.current) > 0
  }, [])
  const onCommitLeft = useCallback(() => {
    const idx = SWIPE_VIEW_ORDER.indexOf(activeViewRef.current)
    if (idx >= 0 && idx < SWIPE_VIEW_ORDER.length - 1) {
      haptics.tap()
      navigate(SWIPE_VIEW_ORDER[idx + 1], { intent: 'forward' })
    }
  }, [])
  const onCommitRight = useCallback(() => {
    const idx = SWIPE_VIEW_ORDER.indexOf(activeViewRef.current)
    if (idx > 0) {
      haptics.tap()
      navigate(SWIPE_VIEW_ORDER[idx - 1], { intent: 'back' })
    }
  }, [])
  // Haptic suave al cruzar el threshold del drag — feedback "estás por
  // cambiar". Si no completa el gesto, no se dispara nada más.
  const onSwipeHaptic = useCallback(() => {
    haptics.selectionTick()
  }, [])
  useNativeSwipe({
    enabled: swipeEnabled,
    containerRef: swipeWrapperRef,
    canGoLeft, canGoRight,
    onCommitLeft, onCommitRight,
    onHaptic: onSwipeHaptic,
  })

  function handleSaveTask(updates) {
    if (selectedEvent?.id) editEvent(selectedEvent.id, updates)
  }

  const isDetail = activeView === 'task-detail'
  const isSubView = isDetail || activeView === 'memory' || activeView === 'nova-knows'
  const navView  = isSubView ? (previousView || 'settings') : activeView

  const firstRun = useFirstRunSequence()
  // Todos los flotantes (hints, install card, brief) esperan a que tanto el
  // onboarding como el welcome terminen. Así la primera impresión no satura.
  const gatesBlocking = showWelcome || showOnboardingNow
  // En mobile la card de instalar es flotante (z-55, bottom 104px) y tapa los
  // CTAs de Calendario ("Añadir evento", "Trabajar enfocado") y de Tareas.
  // La gateamos a planner-only en mobile; en desktop vive en la esquina
  // derecha con su propio espacio, así que se mantiene en todas las vistas.
  const showInstallCard =
    firstRun.step === 'install'
    && !gatesBlocking
    && (isDesktop || activeView === 'planner')
  const hasNovaConflictHint = (events?.length ?? 0) >= 2
  const hasNovaEmptyHint = (events?.length ?? 0) === 0 && activeView === 'planner'

  useEffect(() => {
    if (gatesBlocking) return
    const run = () => {
      // Después del primer frame útil precargamos lo más probable. Así el
      // usuario siente navegación instantánea sin pagar el costo en cold start.
      prefetch(loadCalendarView)
      prefetch(loadDayView)
      prefetch(loadTasksView)
      prefetch(loadSettingsView)
      if (isDesktop) {
        prefetch(loadCommandPalette)
        prefetch(loadQuickAddSheet)
        prefetch(loadImportExportSheet)
        prefetch(loadSuggestionsInbox)
      }
    }
    const id = window.requestIdleCallback
      ? window.requestIdleCallback(run, { timeout: 1600 })
      : window.setTimeout(run, 900)
    return () => {
      if (window.cancelIdleCallback && typeof id === 'number') window.cancelIdleCallback(id)
      else window.clearTimeout(id)
    }
  }, [gatesBlocking, isDesktop])

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
    morningBrief: (showMorningBrief && !showWelcome && !showOnboardingNow) ? {
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
        label: 'Día libre. Pídele a Hilante un plan.',
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
    {/* AppShell: contenedor principal mobile-first. min-h-dvh respeta la
        altura visible en iOS (svh sería sin barras, dvh es la altura útil
        actual incl. toolbar dinámica) — evita el "agujero negro" inferior
        que dejaba 100vh cuando la barra de navegación de Safari aparece o
        cuando el WKWebView se reduce por el teclado. overflow-x clip
        bloquea cualquier scroll horizontal accidental sin romper sticky. */}
    <div className="relative z-[1] min-h-dvh [overflow-x:clip] bg-[var(--app-bg)] dark:bg-[var(--app-bg-dark)]">
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
          cola). z-banner para no competir con toasts/modales. */}
      {!isOnline && (
        <div
          className="fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+56px)] pointer-events-none flex justify-center px-4"
          style={{ zIndex: 'var(--z-banner)' }}
        >
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
            Suspense envuelve TODO para cubrir las vistas lazy. El fallback ya
            no es null: una estructura liviana evita flashes y comunica progreso. */}
        {(
          <AnimatePresence mode="sync">
            <motion.div
              key={activeView}
              custom={routeMotion}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full"
              style={{ willChange: 'opacity, transform' }}
            >
              {/* Wrapper estable para useNativeSwipe — el ref no puede ir
                  en motion.div directamente (framer-motion lo intercepta).
                  El hook aplica translate3d acá durante el drag, sin
                  pelearse con la animación de framer-motion que controla
                  el motion.div padre. */}
              <div ref={swipeWrapperRef} className="w-full" style={{ willChange: 'transform' }}>
              <Suspense fallback={<RouteFallback activeView={activeView} isDesktop={isDesktop} />}>
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
                  onImportClick={() => { setImportExportInitialTab('import'); setImportExportOpen(true) }}
                  onOpenDay={(iso) => {
                    navigate('day', { date: iso })
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
                  addEvent={addEvent}
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
                  onOpenMemory={() => navigate('memory', { intent: 'deeper' })}
                  onOpenNovaKnows={() => navigate('nova-knows', { intent: 'deeper' })}
                />
              )}

              {activeView === 'memory' && (
                <div>
                  <div className="max-w-lg lg:max-w-2xl mx-auto px-4 pt-4">
                    <button
                      onClick={() => returnToPreviousView('settings')}
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
                <NovaKnowsView onBack={() => returnToPreviousView('settings')} />
              )}


              </Suspense>
              </div>
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
          className="fixed bottom-0 left-0 right-0"
          style={{ zIndex: 'var(--z-bottom-nav)' }}
        >
          <BottomNavBar activeView={navView} onNavigate={navigate} />
        </motion.div>
      )}

      {/* ── Nova Widget — solo en vistas sin FocusBar (calendar, tasks, settings) ── */}
      {activeView !== 'planner' && (
        <Suspense fallback={null}>
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
            onOpenInbox={openInbox}
            proposeMode={true}
            isDesktop={isDesktop}
          />
        </Suspense>
      )}

      {/* ── Bandeja de sugerencias ──────────────────────────────────────────
          Lazy: solo bajamos el chunk la primera vez que el usuario la abre.
          Antes estaba eager y pesaba en el bundle inicial aunque la bandeja
          vive oculta en cada cold start. */}
      {inboxOpen && (
        <Suspense fallback={<SheetFallback label="Cargando bandeja" />}>
          <SuggestionsInbox
            isOpen={inboxOpen}
            onClose={() => setInboxOpen(false)}
            suggestions={suggestions}
            onApprove={handleApproveSuggestion}
            onReject={rejectSuggestion}
            onClearResolved={clearResolvedSuggestions}
            demoDismissed={inboxDemoDismissed}
            onApproveDemo={handleApproveDemo}
            onEditDemo={handleEditDemo}
            onDismissDemo={dismissInboxDemo}
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
            className="fixed inset-x-4 mx-auto z-[80] px-4 py-3 rounded-2xl bg-slate-900/95 text-white shadow-[0_20px_48px_rgba(0,0,0,0.25)] backdrop-blur flex items-center gap-2.5 max-w-[420px]"
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
        {showMorningBrief && !isDesktop && !showWelcome && !showOnboardingNow && (
          <MorningBrief
            events={events}
            tasks={tasks}
            onStart={()      => { setShowMorningBrief(false); handleStartDay() }}
            onDismiss={()    => setShowMorningBrief(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Threshold Scene — pantalla-firma de entrada, SÓLO en el primer uso ── */}
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen
            onEnter={() => {
              dismissWelcome()
              if (!showOnboarding) {
                // Si no viene onboarding después, liberamos el dark-boot para
                // que la app (bg surface) se pinte en una sola transición.
                try { document.documentElement.classList.remove('focus-dark-boot') } catch {}
              }
            }}
            hasEvents={(events?.length ?? 0) > 0}
            hasFirstTime={(events?.length ?? 0) === 0 && (tasks?.length ?? 0) === 0}
            firstLaunch={showOnboarding}
            keepDarkBootOnExit={showOnboarding}
          />
        )}
      </AnimatePresence>

      {/* ── First-launch onboarding — tutorial animado de primer uso ───────── */}
      <AnimatePresence>
        {showOnboardingNow && (
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
          liftAboveInstallCard={showInstallCard}
        >
          Soy Hilante. Agrego eventos, tareas y bloques al instante — y cada cambio trae un "Deshacer" visible. Háblame tocando el orbe.
        </NovaHint>
      )}
      {!gatesBlocking && hasNovaEmptyHint && (
        <NovaHint
          id="empty-day-v1"
          delayMs={1400}
          liftAboveInstallCard={showInstallCard}
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
          liftAboveInstallCard={showInstallCard}
        >
          Si detecto un conflicto que no puedo resolver solo, te dejo una propuesta en la bandeja para que decidas.
        </NovaHint>
      )}

      {/* ── Permiso de notificaciones — contextual, tras crear un evento ── */}
      {contextualPermission && !showOnboardingNow && (
        <NovaHint
          id="notif-permission-v1"
          delayMs={1500}
          actionLabel="Activar"
          onAction={requestPermission}
          onDismiss={dismissPermissionCard}
          liftAboveInstallCard={showInstallCard}
        >
          Puedo avisarte con recordatorios inteligentes según cada evento. ¿Activamos notificaciones?
        </NovaHint>
      )}

      {/* ── Banner "notifs desconectadas" ──────────────────────────────────
          permission === granted pero la sub no está en el backend (APNs la
          invalidó, usuario cambió de cuenta, iOS reinstaló la PWA…). Antes
          este caso era silencioso: el RemindersRow decía "activo" pero nunca
          llegaba una push. Ahora ofrecemos reconexión explícita. */}
      {pushDisconnected && !showOnboardingNow && !showWelcome && (
        <NovaHint
          id={pushHealing ? 'notif-reconnecting' : 'notif-disconnected-v1'}
          delayMs={800}
          actionLabel={pushHealing ? 'Reconectando…' : 'Reconectar'}
          onAction={pushHealing ? undefined : reconnectPush}
          onDismiss={() => { /* no persistimos dismiss — si sigue roto, volverá */ }}
          liftAboveInstallCard={showInstallCard}
        >
          Tus recordatorios push están desconectados. Un toque y los vuelvo a activar.
        </NovaHint>
      )}

      {/* ── Invitación a instalar la app — aparece desde la 3ra sesión ─── */}
      {showInstallCard && <InstallAppCard onDismissed={firstRun.dismissInstall} />}

      {/* ── Evening Shutdown ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showEveningShutdown && (
          <Suspense fallback={<SheetFallback label="Preparando cierre del día" />}>
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
        <Suspense fallback={<SheetFallback label="Cargando importar y exportar" />}>
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
        <Suspense fallback={<SheetFallback label="Abriendo buscador" />}>
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
        <Suspense fallback={<SheetFallback label="Abriendo creación rápida" />}>
          <QuickAddSheet
            onSave={(formData) => { addEvent(formData); setPaletteQuickAdd(false) }}
            onCancel={() => setPaletteQuickAdd(false)}
            existingEvents={events}
          />
        </Suspense>
      )}

      {/* Boot splash — pantalla de arranque estilo apps mainstream
          (icono + degradado azul, ~1s, fade). Va al final del árbol con
          z-200 para cubrir todo el contenido en cada cold start. El
          splash inline (#focus-splash en index.html) sigue pintando
          mientras se carga el bundle; cuando React monta, BootSplash
          continúa la imagen sin salto y luego se desvanece. */}
      <AnimatePresence>
        {showBootSplash && <BootSplash key="boot-splash" />}
      </AnimatePresence>
    </div>
    </LayoutGroup>
  )
}
