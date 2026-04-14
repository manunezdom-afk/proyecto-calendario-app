import { useState } from 'react'
import { useEvents } from './hooks/useEvents'
import BottomNavBar from './components/BottomNavBar'
import CalendarView from './views/CalendarView'
import AssistantView from './views/AssistantView'
import TaskDetailView from './views/TaskDetailView'
import PlannerView from './views/PlannerView'

export default function App() {
  // ── Navigation ────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('calendar')
  const [previousView, setPreviousView] = useState('calendar')

  // ── Shared event state (persisted in localStorage) ────────────────────────
  const { events, addEvent, deleteEvent, editEvent } = useEvents()

  // ── Selected event for TaskDetailView ────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState(null)

  // ── Navigation helpers ────────────────────────────────────────────────────
  function navigate(view) {
    setActiveView(view)
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
    if (selectedEvent?.id) {
      editEvent(selectedEvent.id, updates)
    }
  }

  const navView = activeView === 'task-detail' ? previousView : activeView
  const isAssistant = activeView === 'assistant'

  return (
    <>
      {/* ── Calendar ─────────────────────────────────────────────────────── */}
      {activeView === 'calendar' && (
        <CalendarView
          events={events}
          onAddEvent={addEvent}
          onDeleteEvent={deleteEvent}
          onEditEvent={editEvent}
          onOpenTask={(event) => openTaskDetail(event)}
        />
      )}

      {/* ── Planner / Tasks ──────────────────────────────────────────────── */}
      {(activeView === 'planner' || activeView === 'tasks') && (
        <PlannerView
          events={events}
          onAddEvent={addEvent}
          onDeleteEvent={deleteEvent}
        />
      )}

      {/* ── Task Detail ───────────────────────────────────────────────────── */}
      {activeView === 'task-detail' && (
        <TaskDetailView
          event={selectedEvent}
          onBack={goBack}
          onSave={handleSaveTask}
        />
      )}

      {/* ── Assistant overlay ─────────────────────────────────────────────── */}
      {isAssistant && (
        <AssistantView
          onClose={() => navigate(previousView || 'calendar')}
          onAddEvent={addEvent}
        />
      )}

      {/* ── Bottom nav (hidden in assistant fullscreen) ───────────────────── */}
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
