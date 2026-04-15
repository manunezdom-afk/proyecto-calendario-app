import { useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useEvents }        from './hooks/useEvents'
import { useNotifications } from './hooks/useNotifications'
import { useDarkMode }      from './hooks/useDarkMode'

import TopAppBar                   from './components/TopAppBar'
import BottomNavBar                from './components/BottomNavBar'
import NotificationPanel           from './components/NotificationPanel'
import NotificationPermissionCard  from './components/NotificationPermissionCard'
import ImportExportSheet           from './components/ImportExportSheet'

import CalendarView    from './views/CalendarView'
import AssistantView   from './views/AssistantView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'

const pageVariants = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } }
}

export default function App() {
  const [activeView, setActiveView]     = useState('planner')
  const [previousView, setPreviousView] = useState('planner')
  const { events, addEvent, deleteEvent, editEvent } = useEvents()
  const { isDark, toggle: toggleDark } = useDarkMode()

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
    <div className={`min-h-screen ${isDark ? 'dark bg-slate-950' : 'bg-slate-50'} overflow-hidden`}>
      <AnimatePresence mode="wait">
        {!isAssistant && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <TopAppBar
              showBack={isDetail}
              onBack={isDetail ? goBack : undefined}
              onBellClick={() => setNotifPanelOpen(true)}
              unreadCount={unreadCount}
              onToggleDark={toggleDark}
              isDark={isDark}
              onShareClick={() => setImportExportOpen(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pb-24">
        {showPermCard && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <NotificationPermissionCard
              onAllow={requestPermission}
              onDismiss={dismissPermissionCard}
            />
          </motion.div>
        )}

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
    </div>
    </LayoutGroup>
  )
}
