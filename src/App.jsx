import { useState, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useEvents }        from './hooks/useEvents'
import { useTasks }         from './hooks/useTasks'
import { useNotifications } from './hooks/useNotifications'
import { useUserProfile }   from './hooks/useUserProfile'
import { useAuth }          from './context/AuthContext'

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

import CalendarView    from './views/CalendarView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'

const LAST_OPENED_KEY = 'nova_last_opened'

const pageVariants = {
  initial: { opacity: 0, y: 6, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: 0.08 } },
}

export default function App() {
  const { authModal, setAuthModal } = useAuth()
  const { profile }                 = useUserProfile()
  const [activeView, setActiveView]     = useState('planner')
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
    notifLog, unreadCount,
    permissionState, permissionDismissed,
    requestPermission, dismissPermissionCard,
    markAllRead, dismiss: dismissNotif,
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
  const navView  = isDetail ? previousView : activeView

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
  }

  return (
    <LayoutGroup>
    <div className="min-h-screen bg-slate-50 overflow-hidden">
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
        />
      </motion.div>

      {isDesktop && !isDetail && (
        <DesktopSideBar
          activeView={navView}
          onNavigate={navigate}
          onSettings={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
        />
      )}

      <main className={isDesktop && !isDetail ? "pb-0 pl-[72px]" : "pb-24"}>
        {!isDetail && <GuestBanner />}

        {showPermCard && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <NotificationPermissionCard
              onAllow={requestPermission}
              onDismiss={dismissPermissionCard}
            />
          </motion.div>
        )}

        {/* ── Desktop 2-column layout (solo en Mi Día) ────────────────────── */}
        {isDesktop && !isDetail && activeView === 'planner' ? (
          <div className="flex h-[calc(100vh-64px)]">
            <div className="basis-[40%] max-w-[520px] flex-shrink-0 overflow-y-auto border-r border-slate-200">
              <PlannerView {...plannerProps} isDesktop />
            </div>
            <div className="basis-[60%] flex-1 overflow-y-auto">
              <CalendarView
                events={events}
                onAddEvent={addEvent}
                onDeleteEvent={deleteEvent}
                onEditEvent={editEvent}
                onOpenTask={(event) => openTaskDetail(event)}
                onExportClick={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
                isDesktop
              />
            </div>
          </div>
        ) : (
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

      {/* ── Nova Widget — omnipresente ────────────────────────────────────── */}
      <NovaWidget
        events={events}
        tasks={tasks}
        onAddEvent={addEvent}
        onEditEvent={editEvent}
        onDeleteEvent={deleteEvent}
        onToggleTask={toggleTask}
        isDesktop={isDesktop}
      />

      {/* ── Morning Brief ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showMorningBrief && (
          <MorningBrief
            events={events}
            tasks={tasks}
            profile={profile}
            onStart={()      => setShowMorningBrief(false)}
            onDismiss={()    => setShowMorningBrief(false)}
            onMoveEvent={(id, updates) => { editEvent(id, updates); setShowMorningBrief(false) }}
          />
        )}
      </AnimatePresence>

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
