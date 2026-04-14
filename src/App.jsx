import { useState } from 'react'
import BottomNavBar from './components/BottomNavBar'
import CalendarView from './views/CalendarView'
import AssistantView from './views/AssistantView'
import TaskDetailView from './views/TaskDetailView'
import PlannerView from './views/PlannerView'

// The "tasks" tab reuses the PlannerView (acts as the task list).
// TaskDetailView is a sub-screen accessible from CalendarView cards.

export default function App() {
  // activeView: 'planner' | 'calendar' | 'assistant' | 'tasks' | 'task-detail'
  const [activeView, setActiveView] = useState('calendar')
  // previousView is used to navigate back from task-detail
  const [previousView, setPreviousView] = useState('calendar')

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

  // Resolve which nav tab is "active" for the bottom bar
  const navView = activeView === 'task-detail' ? previousView : activeView

  const isAssistant = activeView === 'assistant'
  const isTaskDetail = activeView === 'task-detail'

  return (
    <>
      {/* Main content */}
      {activeView === 'calendar' && <CalendarView onOpenTask={openTaskDetail} />}
      {activeView === 'planner' && <PlannerView />}
      {activeView === 'tasks' && <PlannerView />}
      {isTaskDetail && <TaskDetailView onBack={goBack} />}

      {/* Assistant overlay (rendered on top) */}
      {isAssistant && <AssistantView onClose={() => navigate(previousView || 'calendar')} />}

      {/* BottomNavBar — hidden when assistant is fullscreen */}
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
