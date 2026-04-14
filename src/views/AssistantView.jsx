const AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDc_HJr_2CTn2bH2wxJwN-84kHi9OHpnszK1Bsp89yK0Q9Yrw1wyUPskebHdZGSP_yIcd72iyGGt_n5982DlxLk6paq5dujnm_ExfkboSKpVYrlXG6Jfodq-YyTzs78HKo0F_eNeevX9hyoluaPJtqdgPnbzm8AxT5Hc99QRUXZVirEaCtku9NSaaqLv-oN1sHKBoE5wihpUXo9Aij5CQyf5CtVv8i_asslJ7yI9b9BJ46H4rtaUDIv38tWvCSk8jGbgjjQpR3OdJ5q'

const suggestions = [
  {
    id: 1,
    icon: 'menu_book',
    iconColor: 'text-primary-fixed-dim',
    bgColor: 'bg-primary/20',
    title: 'Sesión de Estudio',
    time: '16:00 — 18:00 · Modo Enfoque',
    tags: ['Biología', 'Tranquilo'],
  },
  {
    id: 2,
    icon: 'fitness_center',
    iconColor: 'text-secondary-fixed-dim',
    bgColor: 'bg-secondary/20',
    title: 'Entrenamiento Gym',
    time: '18:30 — 19:45 · Core y Cardio',
    tags: ['Intenso', 'Quema de Calorías'],
  },
]

export default function AssistantView({ onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col backdrop-darken text-white overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center w-full px-6 py-4 bg-transparent z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-all"
          >
            <span className="material-symbols-outlined text-white">close</span>
          </button>
          <span className="font-headline font-extrabold text-lg tracking-tight">Sanctuary</span>
        </div>
        <div className="h-10 w-10 rounded-full overflow-hidden ring-2 ring-primary/20">
          <img
            alt="User profile avatar"
            className="w-full h-full object-cover"
            src={AVATAR_URL}
          />
        </div>
      </header>

      {/* Main Conversational Interface */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 relative">
        {/* Visual Waveform / Orb */}
        <div className="relative flex items-center justify-center mb-20">
          <div className="absolute w-[400px] h-[400px] ai-pulse-glow animate-pulse"></div>
          <div className="relative z-10 w-32 h-32 rounded-full bg-gradient-to-br from-primary to-secondary-container flex items-center justify-center shadow-[0_0_60px_rgba(0,88,188,0.5)]">
            <div className="flex items-end gap-1.5 h-12">
              <div className="w-1.5 h-6 bg-white/90 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-1.5 h-12 bg-white rounded-full animate-bounce"></div>
              <div className="w-1.5 h-8 bg-white/90 rounded-full animate-bounce [animation-delay:-0.5s]"></div>
              <div className="w-1.5 h-10 bg-white rounded-full animate-bounce [animation-delay:-0.2s]"></div>
              <div className="w-1.5 h-5 bg-white/80 rounded-full animate-bounce [animation-delay:-0.7s]"></div>
            </div>
          </div>
        </div>

        {/* Real-time Transcription */}
        <div className="max-w-2xl text-center">
          <h1 className="font-headline text-3xl font-bold tracking-tight mb-6 leading-tight">
            <span className="text-white">Organiza mi tarde para </span>
            <span className="text-white/40">estudiar y hacer ejercicio...</span>
          </h1>
          <p className="text-white/60 text-lg font-medium tracking-wide">
            Escuchando tu plan...
          </p>
        </div>
      </div>

      {/* Dynamic Insights / Contextual Actions */}
      <div className="w-full px-6 pb-32">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suggestions.map(({ id, icon, iconColor, bgColor, title, time, tags }) => (
              <div
                key={id}
                className="group bg-white/5 backdrop-blur-xl p-5 rounded-[24px] border border-white/10 flex items-start gap-4 transition-all hover:bg-white/10 active:scale-[0.98]"
              >
                <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center`}>
                  <span className={`material-symbols-outlined ${iconColor}`}>{icon}</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-headline text-lg font-bold">{title}</h3>
                  <p className="text-sm text-white/60 mb-3">{time}</p>
                  <div className="flex gap-2 flex-wrap">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 bg-white/10 rounded-full text-xs font-semibold"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="material-symbols-outlined text-white/20 group-hover:text-white transition-colors">
                  check_circle
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Assistant Bottom Control Bar */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[92%] max-w-lg z-[70]">
        <div className="bg-white/10 backdrop-blur-3xl p-2 rounded-[32px] border border-white/10 flex items-center justify-between">
          <button className="w-14 h-14 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <span className="material-symbols-outlined text-white">keyboard</span>
          </button>
          <div className="flex items-center gap-4 px-4 overflow-hidden">
            <div className="h-1 w-20 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary w-1/2 animate-pulse"></div>
            </div>
            <span className="text-sm font-semibold tracking-wider text-white/80 uppercase">
              PROCESANDO
            </span>
          </div>
          <button className="w-14 h-14 rounded-full bg-error/20 hover:bg-error/30 flex items-center justify-center transition-colors group">
            <span className="material-symbols-outlined text-error group-hover:scale-110 transition-transform">
              stop
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
