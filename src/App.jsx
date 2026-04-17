import { useState, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useEvents }        from './hooks/useEvents'
import { useNotifications } from './hooks/useNotifications'
import { useAuth }          from './context/AuthContext'

import TopAppBar                   from './components/TopAppBar'
import BottomNavBar                from './components/BottomNavBar'
import NotificationPanel           from './components/NotificationPanel'
import NotificationPermissionCard  from './components/NotificationPermissionCard'
import ImportExportSheet           from './components/ImportExportSheet'
import GuestBanner                 from './components/GuestBanner'
import AuthModal                   from './components/AuthModal'

import CalendarView    from './views/CalendarView'
import AssistantView   from './views/AssistantView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'

const pageVariants = {
  initial: { opacity: 0, y: 6, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.99, transition: { duration: 0.08 } }
}

export default function App() {
  const { authModal, setAuthModal } = useAuth()
  const [activeView, setActiveView]     = useState('planner')
  const [previousView, setPreviousView] = useState('planner')
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const { events, addEvent, deleteEvent, editEvent } = useEvents()

  const {
    notifLog, unreadCount,
    permissionState, permissionDismissed,
    requestPermission, dismissPermissionCard,
    markAllRead, dismiss: dismissNotif,
  } = useNotifications({ events })

  const [notifPanelOpen, setNotifPanelOpen]       = useState(false)
  const [importExportOpen, setImportExportOpen]   = useState(false)
  const [importExportInitialTab, setImportExportInitialTab] = useState('export')
  const [selectedEvent, setSelectedEvent] = useState(null)

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

  const navView     = activeView === 'task-detail' ? previousView : activeView
  const isAssistant = activeView === 'assistant'
  const isDetail    = activeView === 'task-detail'

  const showPermCard =
    !isAssistant &&
    permissionState === 'default' &&
    !permissionDismissed &&
    (activeView === 'planner' || activeView === 'tasks' || activeView === 'calendar')

  return (
    <LayoutGroup>
    <div className="min-h-screen bg-slate-50 overflow-hidden">
      <AnimatePresence mode="wait">
        {!isAssistant && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.15, delay: 0 }}
          >
            <TopAppBar
              showBack={isDetail}
              onBack={isDetail ? goBack : undefined}
              onBellClick={() => setNotifPanelOpen(true)}
              unreadCount={unreadCount}
              onShareClick={() => setImportExportOpen(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pb-24">
        {!isAssistant && !isDetail && <GuestBanner />}

        {showPermCard && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <NotificationPermissionCard
              onAllow={requestPermission}
              onDismiss={dismissPermissionCard}
            />
          </motion.div>
        )}

        {/* ── Desktop 2-column layout ──────────────────────────────────── */}
        {isDesktop && !isDetail && !isAssistant ? (
          <div className="flex h-[calc(100vh-64px)]">
            <div className="w-[480px] xl:w-[540px] flex-shrink-0 overflow-y-auto border-r border-slate-200">
              <PlannerView
                events={events}
                onAddEvent={addEvent}
                onEditEvent={editEvent}
                onDeleteEvent={deleteEvent}
                onOpenAssistant={() => { setPreviousView('planner'); navigate('assistant') }}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              <CalendarView
                events={events}
                onAddEvent={addEvent}
                onDeleteEvent={deleteEvent}
                onEditEvent={editEvent}
                onOpenTask={(event) => openTaskDetail(event)}
                onExportClick={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
              />
            </div>
            {/* Nova pill — siempre visible en desktop */}
            <button
              onClick={() => { setPreviousView(activeView); navigate('assistant') }}
              className="fixed bottom-6 right-6 flex items-center gap-2 px-5 py-3 bg-primary text-white rounded-2xl shadow-2xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform z-50 font-bold text-sm"
            >
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
              Nova
            </button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={isAssistant ? previousView : activeView}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full"
            >
              {(activeView === 'planner' || (isAssistant && previousView === 'planner')) && (
                <PlannerView
                  events={events}
                  onAddEvent={addEvent}
                  onEditEvent={editEvent}
                  onDeleteEvent={deleteEvent}
                  onOpenAssistant={() => { setPreviousView('planner'); navigate('assistant') }}
                />
              )}

              {(activeView === 'calendar' || (isAssistant && previousView === 'calendar')) && (
                <CalendarView
                  events={events}
                  onAddEvent={addEvent}
                  onDeleteEvent={deleteEvent}
                  onEditEvent={editEvent}
                  onOpenTask={(event) => openTaskDetail(event)}
                  onExportClick={() => { setImportExportInitialTab('export'); setImportExportOpen(true) }}
                />
              )}

              {(activeView === 'tasks' || (isAssistant && previousView === 'tasks')) && <TasksView />}

              {activeView === 'task-detail' && (
                <TaskDetailView event={selectedEvent} onBack={goBack} onSave={handleSaveTask} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>


      <AnimatePresence>
        {!isAssistant && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
            transition={{ duration: 0.6, type: 'spring', damping: 20 }}
            className="fixed bottom-0 left-0 right-0 z-40"
          >
            <BottomNavBar
              activeView={navView}
              onNavigate={(view) => {
                if (view === 'assistant') setPreviousView(navView)
                navigate(view)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAssistant && (
          <AssistantView
            onClose={() => navigate(previousView || 'planner')}
            onAddEvent={addEvent}
            onEditEvent={editEvent}
            onDeleteEvent={deleteEvent}
            events={events}
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
