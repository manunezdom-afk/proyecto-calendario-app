import { useState, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useEvents }        from './hooks/useEvents'
import { useTasks }         from './hooks/useTasks'
import { useNotifications } from './hooks/useNotifications'
import { useUserProfile }   from './hooks/useUserProfile'
import { useSuggestions }   from './hooks/useSuggestions'
import { useAuth }          from './context/AuthContext'
import { actionToSuggestion, applySuggestion } from './utils/actionToSuggestion'

import TopAppBar                   from './components/TopAppBar'
import BottomNavBar                from './components/BottomNavBar'
import DesktopSideBar              from './components/DesktopSideBar'
import NotificationPanel           from './components/NotificationPanel'
import ImportExportSheet           from './components/ImportExportSheet'
import AuthModal                   from './components/AuthModal'
import NovaWidget                  from './components/NovaWidget'
import MorningBrief                from './components/MorningBrief'
import EveningShutdown             from './components/EveningShutdown'
import SuggestionsInbox            from './components/SuggestionsInbox'
import WelcomeScreen, { useWelcomeGate } from './components/WelcomeScreen'
import InstallAppCard              from './components/InstallAppCard'
import AuroraBackground            from './components/AuroraBackground'
import NovaHint                    from './components/NovaHint'
import { useFirstRunSequence }     from './hooks/useFirstRunSequence'

import CalendarView    from './views/CalendarView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'
import SettingsView    from './views/SettingsView'
import MemoryView      from './views/MemoryView'
import NovaKnowsView   from './views/NovaKnowsView'

const LAST_OPENED_KEY = 'nova_last_opened'

const pageVariants = {
  initial: { opacity: 0, y: 6, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: 0.08 } },
}

export default function App() {
  const { authModal, setAuthModal, user } = useAuth()
  const { profile }                 = useUserProfile()
  const { show: showWelcome, dismiss: dismissWelcome } = useWelcomeGate()

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

  const VALID_VIEWS = ['planner', 'calendar', 'tasks', 'settings']
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

  const { events, addEvent, deleteEvent, editEvent } = useEvents()
  const { tasks, addTask, toggleTask, deleteTask }   = useTasks()
  const {
    suggestions,
    pendingCount: inboxPendingCount,
    addSuggestion,
    approveSuggestion,
    rejectSuggestion,
    clearResolved: clearResolvedSuggestions,
  } = useSuggestions()

  const [inboxOpen, setInboxOpen] = useState(false)

  // Handlers para ejecutar una sugerencia aprobada
  const suggestionHandlers = {
    onAddEvent: addEvent,
    onEditEvent: editEvent,
    onDeleteEvent: deleteEvent,
    onToggleTask: toggleTask,
  }

  function handleApproveSuggestion(id) {
    const s = suggestions.find((x) => x.id === id)
    if (s) applySuggestion(s, suggestionHandlers)
    approveSuggestion(id)
  }

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
    !showWelcome

  const [notifPanelOpen,      setNotifPanelOpen]      = useState(false)
  const [importExportOpen,    setImportExportOpen]    = useState(false)
  const [importExportInitialTab, setImportExportInitialTab] = useState('export')
  const [selectedEvent, setSelectedEvent] = useState(null)

  // ── Morning Brief ─────────────────────────────────────────────────────────
  const [showMorningBrief,   setShowMorningBrief]   = useState(false)
  const [showEveningShutdown, setShowEveningShutdown] = useState(false)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const last  = localStorage.getItem(LAST_OPENED_KEY)
    const hour  = new Date().getHours()
    // Solo mostrar el brief matutino si es realmente la mañana (5 AM – 12 PM).
    // Abrir la app a las 21:00 no tiene por qué dispararlo con "¿Arrancamos?".
    const isMorning = hour >= 5 && hour < 12
    if (last !== today && isMorning) {
      const timer = setTimeout(() => setShowMorningBrief(true), 600)
      localStorage.setItem(LAST_OPENED_KEY, today)
      return () => clearTimeout(timer)
    }
  }, [])

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(view) {
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
  const showInstallCard = firstRun.step === 'install' && !showWelcome
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
    morningBrief: (showMorningBrief && !showWelcome) ? {
      events,
      tasks,
      profile,
      onStart:      () => { setShowMorningBrief(false); handleStartDay() },
      onDismiss:    () => setShowMorningBrief(false),
      onMoveEvent:  (id, updates) => { editEvent(id, updates); setShowMorningBrief(false) },
    } : null,
  }

  // Al arrancar el día desde el brief, navegamos al planner y scrolleamos
  // al primer evento próximo (si existe) para que el usuario vea al toque
  // con qué empezar.
  function handleStartDay() {
    navigate('planner')
    setTimeout(() => {
      const nextEvent = document.querySelector('[data-next-event]')
      if (nextEvent) {
        nextEvent.scrollIntoView({ behavior: 'smooth', block: 'center' })
        nextEvent.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
        setTimeout(() => {
          nextEvent.classList.remove('ring-2', 'ring-primary', 'ring-offset-2')
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
        />
      </motion.div>

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
        {/* ── Single-view layout: cada botón del sidebar → su propia vista ── */}
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
              {activeView === 'planner' && <PlannerView {...plannerProps} isDesktop={isDesktop} />}

              {activeView === 'calendar' && (
                <CalendarView
                  events={events}
                  onAddEvent={addEvent}
                  onDeleteEvent={deleteEvent}
                  onEditEvent={editEvent}
                  onOpenTask={(event) => openTaskDetail(event)}
                  onExportClick={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
                  isDesktop={isDesktop}
                />
              )}

              {activeView === 'tasks' && (
                <TasksView
                  tasks={tasks}
                  addTask={addTask}
                  toggleTask={toggleTask}
                  deleteTask={deleteTask}
                />
              )}

              {activeView === 'task-detail' && (
                <TaskDetailView event={selectedEvent} onBack={goBack} onSave={handleSaveTask} onDelete={deleteEvent} />
              )}

              {activeView === 'settings' && (
                <SettingsView
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
                      Ajustes
                    </button>
                  </div>
                  <MemoryView />
                </div>
              )}

              {activeView === 'nova-knows' && (
                <NovaKnowsView onBack={() => setActiveView(previousView || 'settings')} />
              )}


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
          onToggleTask={toggleTask}
          onProposeActions={handleProposeActions}
          onOpenInbox={() => setInboxOpen(true)}
          proposeMode={true}
          isDesktop={isDesktop}
        />
      )}

      {/* ── Bandeja de sugerencias ────────────────────────────────────────── */}
      <SuggestionsInbox
        isOpen={inboxOpen}
        onClose={() => setInboxOpen(false)}
        suggestions={suggestions}
        onApprove={handleApproveSuggestion}
        onReject={rejectSuggestion}
        onClearResolved={clearResolvedSuggestions}
      />

      {/* ── Morning Brief (solo modal en mobile; desktop: inline en PlannerView) */}
      <AnimatePresence>
        {showMorningBrief && !isDesktop && !showWelcome && (
          <MorningBrief
            events={events}
            tasks={tasks}
            profile={profile}
            onStart={()      => { setShowMorningBrief(false); handleStartDay() }}
            onDismiss={()    => setShowMorningBrief(false)}
            onMoveEvent={(id, updates) => { editEvent(id, updates); setShowMorningBrief(false) }}
          />
        )}
      </AnimatePresence>

      {/* ── Threshold Scene — la pantalla-firma de entrada (una vez por día) ── */}
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen
            onEnter={dismissWelcome}
            hasEvents={(events?.length ?? 0) > 0}
            hasFirstTime={(events?.length ?? 0) === 0 && (tasks?.length ?? 0) === 0}
          />
        )}
      </AnimatePresence>

      {/* ── Nova hints contextuales (reemplazan el tour modal) ─────────────── */}
      {/* Regla: una sola burbuja a la vez. Si el día está vacío, mostramos
          el hint accionable (empty-day). Si no, el intro genérico. */}
      {!showWelcome && activeView === 'planner' && !hasNovaEmptyHint && (
        <NovaHint
          id="welcome-intro-v1"
          delayMs={1400}
        >
          Soy Nova. Propongo movimientos en tu día, pero nunca toco tu calendario sin tu aprobación. Pedímelo tocando el orbe.
        </NovaHint>
      )}
      {!showWelcome && hasNovaEmptyHint && (
        <NovaHint
          id="empty-day-v1"
          delayMs={1400}
        >
          Tu día está en blanco. Puedo proponer un bloque de foco de 25 min cuando quieras — solo pedímelo.
        </NovaHint>
      )}
      {!showWelcome && !hasNovaEmptyHint && hasNovaConflictHint && (
        <NovaHint
          id="inbox-hint-v1"
          delayMs={4200}
          actionLabel="Ver bandeja"
          onAction={() => setInboxOpen(true)}
        >
          Si querés, reviso tu día y te mando propuestas a la bandeja. Nunca toco nada sin tu aprobación.
        </NovaHint>
      )}

      {/* ── Permiso de notificaciones — contextual, tras crear un evento ── */}
      {contextualPermission && (
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
          <EveningShutdown
            events={events}
            tasks={tasks}
            onClose={()     => setShowEveningShutdown(false)}
            onEditEvent={editEvent}
          />
        )}
      </AnimatePresence>

      <NotificationPanel
        isOpen={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
        notifLog={notifLog}
        onMarkAllRead={markAllRead}
        onDismiss={dismissNotif}
      />

      <ImportExportSheet
        isOpen={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        events={events}
        onImportEvent={addEvent}
        initialTab={importExportInitialTab}
      />

      <AuthModal isOpen={authModal} onClose={() => setAuthModal(false)} />
    </div>
    </LayoutGroup>
  )
}
