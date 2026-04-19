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
import NotificationPermissionCard  from './components/NotificationPermissionCard'
import ImportExportSheet           from './components/ImportExportSheet'
import GuestBanner                 from './components/GuestBanner'
import AuthModal                   from './components/AuthModal'
import NovaWidget                  from './components/NovaWidget'
import MorningBrief                from './components/MorningBrief'
import EveningShutdown             from './components/EveningShutdown'
import SuggestionsInbox            from './components/SuggestionsInbox'
import WelcomeScreen, { useWelcomeGate } from './components/WelcomeScreen'
import OnboardingTour, { useOnboardingTour } from './components/OnboardingTour'
import InstallAppCard              from './components/InstallAppCard'
import OfflineBanner               from './components/OfflineBanner'
import UpdateAvailableBanner       from './components/UpdateAvailableBanner'

import CalendarView    from './views/CalendarView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'
import SettingsView    from './views/SettingsView'
import MemoryView      from './views/MemoryView'
import NovaKnowsView   from './views/NovaKnowsView'
import DiagnosticView  from './views/DiagnosticView'

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
  const { show: showTour,    complete: completeTour }  = useOnboardingTour()

  // Nombre para saludo personalizado (si existe email, usamos la parte antes de @)
  const userName = user?.email ? user.email.split('@')[0].split('.')[0] : null

  // Soporte de ruta especial via URL hash: #/diagnostic
  const initialView = () => {
    if (typeof window !== 'undefined' && window.location.hash === '#/diagnostic') {
      return 'diagnostic'
    }
    return 'planner'
  }
  const [activeView, setActiveView]     = useState(initialView)
  const [previousView, setPreviousView] = useState('planner')
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
    pushError,
  } = useNotifications({ events })

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
    if (last !== today) {
      // Small delay so the app renders first
      const timer = setTimeout(() => setShowMorningBrief(true), 600)
      localStorage.setItem(LAST_OPENED_KEY, today)
      return () => clearTimeout(timer)
    }
  }, [])

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(view) { setActiveView(view) }

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

  const showPermCard =
    permissionState === 'default' &&
    !permissionDismissed &&
    (activeView === 'planner' || activeView === 'tasks' || activeView === 'calendar')

  // ── Shared PlannerView props ──────────────────────────────────────────────
  const plannerProps = {
    events,
    tasks,
    onAddEvent:        addEvent,
    onEditEvent:       editEvent,
    onDeleteEvent:     deleteEvent,
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
    setActiveView('planner')
    // Pequeño delay para que la animación de cierre del modal termine y el
    // planner ya esté visible antes de hacer el scroll
    setTimeout(() => {
      // Buscamos el próximo evento del día (dentro de la próxima hora),
      // o el primero pendiente, y lo scrolleamos al centro con highlight
      const nextEvent = document.querySelector('[data-next-event], [data-event-card]')
      if (nextEvent) {
        nextEvent.scrollIntoView({ behavior: 'smooth', block: 'center' })
        nextEvent.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
        setTimeout(() => {
          nextEvent.classList.remove('ring-2', 'ring-primary', 'ring-offset-2')
        }, 2000)
      } else {
        // Sin eventos → scroll suave al top del main
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, 400)
  }

  return (
    <LayoutGroup>
    <div className="min-h-screen bg-slate-50 overflow-hidden">
      <OfflineBanner />
      <UpdateAvailableBanner />
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

      <main className={isDesktop && !isDetail ? "pb-0 pl-[72px]" : "pb-24"}>
        {!isDetail && <GuestBanner />}

        {showPermCard && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <NotificationPermissionCard
              onAllow={requestPermission}
              onDismiss={dismissPermissionCard}
              error={pushError}
            />
          </motion.div>
        )}

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
                <TaskDetailView event={selectedEvent} onBack={goBack} onSave={handleSaveTask} />
              )}

              {activeView === 'settings' && (
                <SettingsView
                  onOpenImport={() => { setImportExportInitialTab('import'); setImportExportOpen(true) }}
                  onOpenMemory={() => { setPreviousView('settings'); setActiveView('memory') }}
                  onOpenNovaKnows={() => { setPreviousView('settings'); setActiveView('nova-knows') }}
                  onOpenDiagnostic={() => { setPreviousView('settings'); setActiveView('diagnostic') }}
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

              {activeView === 'diagnostic' && (
                <DiagnosticView onBack={() => {
                  if (typeof window !== 'undefined') window.location.hash = ''
                  setActiveView('settings')
                }} />
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

      {/* ── Nova Widget — omnipresente (modo propuesta) ────────────────────── */}
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

      {/* ── Welcome premium (una vez por día) ─────────────────────────────── */}
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen onEnter={dismissWelcome} userName={userName} />
        )}
      </AnimatePresence>

      {/* ── Onboarding tour animado (una vez por navegador) ──────────────── */}
      <AnimatePresence>
        {showTour && !showWelcome && (
          <OnboardingTour onDone={completeTour} />
        )}
      </AnimatePresence>

      {/* ── Invitación a instalar la app (no aparece si ya está instalada) ── */}
      {!showWelcome && !showTour && <InstallAppCard />}

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
