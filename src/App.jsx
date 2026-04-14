import { useState } from 'react'
import { useEvents } from './hooks/useEvents'
import BottomNavBar from './components/BottomNavBar'
import CalendarView from './views/CalendarView'
import AssistantView from './views/AssistantView'
import TaskDetailView from './views/TaskDetailView'
import PlannerView from './views/PlannerView'

export default function App() {
  // ── Navigation state ──────────────────────────────────────────────────────
  // activeView: 'planner' | 'calendar' | 'assistant' | 'tasks' | 'task-detail'
  const [activeView, setActiveView] = useState('calendar')
  const [previousView, setPreviousView] = useState('calendar')

  // ── Event state (shared across all views) ─────────────────────────────────
  const { events, addEvent, deleteEvent, editEvent } = useEvents()

  // ── Navigation helpers ────────────────────────────────────────────────────
  function navigate(view) {
    setActiveView(view)
  }

  function openTaskDetail() {
    setPreviousView(activeView)
    setActiveView('task-detail')
  }

  function goBack() {
    setActiveView(previousView)
  }

  // Resolve which nav tab is highlighted (task-detail is a sub-screen of calendar)
  const navView = activeView === 'task-detail' ? previousView : activeView

  const isAssistant = activeView === 'assistant'
  const isTaskDetail = activeView === 'task-detail'

  return (
    <>
      {/* ── Screen router ─────────────────────────────────────────────────── */}
      {activeView === 'calendar' && (
        <CalendarView
          events={events}
          onAddEvent={addEvent}
          onDeleteEvent={deleteEvent}
          onEditEvent={editEvent}
          onOpenTask={openTaskDetail}
        />
      )}

      {(activeView === 'planner' || activeView === 'tasks') && (
        <PlannerView
          events={events}
          onAddEvent={addEvent}
          onDeleteEvent={deleteEvent}
        />
      )}

      {isTaskDetail && <TaskDetailView onBack={goBack} />}

      {/* Assistant fullscreen overlay */}
      {isAssistant && (
        <AssistantView onClose={() => navigate(previousView || 'calendar')} />
      )}

      {/* ── Bottom navigation (hidden when assistant is active) ────────────── */}
      {!isAssistant && (
        <BottomNavBar
          activeView={navView}
          onNavigate={(view) => {
            if (view === 'assistant') setPreviousView(navView)
            navigate(view)
          }}
        />
      )}
    </>
  )
}
