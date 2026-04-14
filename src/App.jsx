import { useState } from 'react'
import { useEvents }        from './hooks/useEvents'
import { useNotifications } from './hooks/useNotifications'
import { useDarkMode }      from './hooks/useDarkMode'

import TopAppBar                   from './components/TopAppBar'
import BottomNavBar                from './components/BottomNavBar'
import NotificationPanel           from './components/NotificationPanel'
import NotificationPermissionCard  from './components/NotificationPermissionCard'

import CalendarView    from './views/CalendarView'
import AssistantView   from './views/AssistantView'
import TaskDetailView  from './views/TaskDetailView'
import PlannerView     from './views/PlannerView'
import TasksView       from './views/TasksView'

export default function App() {
  // ── Navigation ────────────────────────────────────────────────────────────
  const [activeView, setActiveView]     = useState('planner')
  const [previousView, setPreviousView] = useState('planner')

  // ── Shared event state ────────────────────────────────────────────────────
  const { events, addEvent, deleteEvent, editEvent } = useEvents()

  // ── Dark mode ─────────────────────────────────────────────────────────────
  const { isDark, toggle: toggleDark } = useDarkMode()

  // ── Notifications ─────────────────────────────────────────────────────────
  const {
    notifLog, unreadCount,
    permissionState, permissionDismissed,
    requestPermission, dismissPermissionCard,
    markAllRead, dismiss: dismissNotif,
  } = useNotifications({ events })
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)

  // ── Task detail ───────────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState(null)

  // ── Navigation helpers ────────────────────────────────────────────────────
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

  // Show permission card on planner/tasks when not yet asked and not dismissed
  const showPermCard =
    !isAssistant &&
    permissionState === 'default' &&
    !permissionDismissed &&
    (activeView === 'planner' || activeView === 'tasks' || activeView === 'calendar')

  return (
    <>
      {/* ── Global TopAppBar (hidden inside AssistantView fullscreen) ────── */}
      {!isAssistant && (
        <TopAppBar
          showBack={isDetail}
          onBack={isDetail ? goBack : undefined}
          onBellClick={() => setNotifPanelOpen(true)}
          unreadCount={unreadCount}
          onToggleDark={toggleDark}
          isDark={isDark}
        />
      )}

      {/* ── Permission card (inline, not a modal) ────────────────────────── */}
      {showPermCard && (
        <NotificationPermissionCard
          onAllow={requestPermission}
          onDismiss={dismissPermissionCard}
        />
      )}

      {/* ── Views ─────────────────────────────────────────────────────────── */}
      {activeView === 'planner' && (
        <PlannerView events={events} onAddEvent={addEvent} onDeleteEvent={deleteEvent} />
      )}

      {activeView === 'calendar' && (
        <CalendarView
          events={events}
          onAddEvent={addEvent}
          onDeleteEvent={deleteEvent}
          onEditEvent={editEvent}
          onOpenTask={(event) => openTaskDetail(event)}
        />
      )}

      {activeView === 'tasks' && <TasksView />}

      {activeView === 'task-detail' && (
        <TaskDetailView event={selectedEvent} onBack={goBack} onSave={handleSaveTask} />
      )}

      {isAssistant && (
        <AssistantView
          onClose={() => navigate(previousView || 'planner')}
          onAddEvent={addEvent}
        />
      )}

      {/* ── Bottom nav ────────────────────────────────────────────────────── */}
      {!isAssistant && (
        <BottomNavBar
          activeView={navView}
          onNavigate={(view) => {
            if (view === 'assistant') setPreviousView(navView)
            navigate(view)
          }}
        />
      )}

      {/* ── Notification panel (slide-in) ─────────────────────────────────── */}
      <NotificationPanel
        isOpen={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
        notifLog={notifLog}
        onMarkAllRead={markAllRead}
        onDismiss={dismissNotif}
      />
    </>
  )
}
