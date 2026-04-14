import TopAppBar from '../components/TopAppBar'

const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA6uixvLBbbeTBU4o6ECI8czwv2rG4Ab9QRoZzG80VUdtQGrNTKfEN6uAsjVY_xDejxYU0ty7i-w-WkdOwFL75tUeP3QdhnoU-aXj6gBXa_rA-EF4EnS0xA9i3U1C5A2ptq4qNGoThpYsChziALLNaGKBd5tmrg4sTexQTMX_Q76n0RKR0a6HoVsDWd3rDMM5crCyQShmr0MknscIOQMi0WkXjd-nwAlIW_5Y3hCfVOk4gFFs573xU55aE4-nN1yrW3tey74rnRdTLX'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBuP-YYDCS8puBN4BdB0p1a4oljJzvzAN_GJ1lnTWJoxLpt9qIMsUE-4SWVCGzBa4bd7Z28lWv1H2krPfVj1H-oxbauQP2yyGkzV51kMnCXLIiWzp2kNCUGDr3vdI-ptHCUeYQZ4o2k5zO4JC_4Wpj-MXYYhIWpbeDm_C95308waqJo-iw_MmyWV-shmMwOE2beNt4wetEgc-JFNnb8FwwZiHB145oLw_PNHljogMsgzx3aoBguhA6Tlj-Lp4MXrM3p-ulqb2d5kwCn'

const timelineBlocks = [
  {
    id: 1,
    time: '09:00',
    type: 'confirmed',
    title: 'Trabajo Profundo: Arquitectura del Sistema',
    description: 'Enfoque en el motor de navegación principal para el proyecto Sanctuary.',
    badge: 'CONFIRMADO',
    badgeStyle: 'bg-primary-fixed text-on-primary-fixed',
    cardStyle: 'bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary',
    dotStyle: 'bg-primary',
  },
  {
    id: 2,
    time: '10:30',
    type: 'suggestion',
    title: 'Descanso Inteligente: Meditación de 15 min',
    description: 'Carga cognitiva alta detectada. Recarga para la sincro de las 11:00.',
    badge: 'ACEPTAR',
    badgeStyle: 'border border-secondary/20 hover:bg-secondary/5 text-secondary',
    cardStyle: 'bg-surface-container-low/50 border border-dashed border-secondary/30',
    dotStyle: 'bg-secondary',
    timeStyle: 'text-outline/40 italic',
    titleStyle: 'text-secondary font-semibold',
    descStyle: 'italic text-on-surface-variant/70',
  },
  {
    id: 3,
    time: '11:00',
    type: 'confirmed',
    title: 'Trabajo Profundo: Arquitectura del Sistema',
    description: null,
    badge: 'CONFIRMADO',
    badgeStyle: 'bg-primary-fixed text-on-primary-fixed',
    cardStyle: 'bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary',
    dotStyle: 'bg-primary',
    showAvatars: true,
  },
  {
    id: 4,
    time: '12:30',
    type: 'suggestion',
    title: 'Sugerido: Inbox Zero (20m)',
    description: 'Tienes 12 mensajes urgentes sin leer en Slack.',
    badge: 'ACEPTAR',
    badgeStyle: 'border border-secondary/20 hover:bg-secondary/10 text-secondary',
    cardStyle: 'bg-secondary/5 border border-dashed border-secondary/30',
    dotStyle: 'bg-secondary',
    timeStyle: 'text-outline/40 italic',
    titleStyle: 'text-secondary font-semibold',
    descStyle: 'italic text-on-surface-variant/70',
  },
]

export default function PlannerView() {
  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-32">
      <TopAppBar />

      <main className="max-w-7xl mx-auto px-6 pt-8">
        <div className="flex flex-col md:flex-row gap-12">
          {/* Left Column: Timeline */}
          <div className="flex-1">
            <header className="mb-10">
              <p className="text-primary font-semibold tracking-wider text-xs uppercase mb-2">
                Martes, 24 de Oct
              </p>
              <h2 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">
                Flujo Diario
              </h2>
            </header>

            <div className="relative space-y-2">
              {timelineBlocks.map(
                ({
                  id,
                  time,
                  title,
                  description,
                  badge,
                  badgeStyle,
                  cardStyle,
                  dotStyle,
                  timeStyle,
                  titleStyle,
                  descStyle,
                  showAvatars,
                }) => (
                  <div key={id} className="flex gap-6 group">
                    <div className="w-16 pt-2 text-right">
                      <span
                        className={`text-sm font-semibold tracking-tighter ${
                          timeStyle || 'text-outline'
                        }`}
                      >
                        {time}
                      </span>
                    </div>
                    <div className="relative flex-1 pb-8">
                      <div
                        className={`absolute left-[-25px] top-4 w-2 h-2 rounded-full ring-4 ring-surface ${dotStyle}`}
                      ></div>
                      <div className={`p-5 rounded-xl ${cardStyle}`}>
                        <div className="flex justify-between items-start mb-1">
                          <h3 className={`font-bold text-on-surface ${titleStyle || ''}`}>
                            {title}
                          </h3>
                          <button
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeStyle}`}
                          >
                            {badge}
                          </button>
                        </div>
                        {description && (
                          <p className={`text-sm leading-relaxed ${descStyle || 'text-on-surface-variant'}`}>
                            {description}
                          </p>
                        )}
                        {showAvatars && (
                          <div className="flex items-center gap-2 mt-3">
                            <div className="flex -space-x-2">
                              <img
                                alt="Team member"
                                className="w-6 h-6 rounded-full border-2 border-surface object-cover"
                                src={AVATAR_1}
                              />
                              <img
                                alt="Team member"
                                className="w-6 h-6 rounded-full border-2 border-surface object-cover"
                                src={AVATAR_2}
                              />
                            </div>
                            <span className="text-xs text-on-surface-variant">
                              con el Equipo de Producto
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Right Column: Insights & Tasks */}
          <div className="w-full md:w-80 space-y-8">
            {/* Intelligence Card */}
            <div className="bg-surface-container-high/40 p-6 rounded-[24px] backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  auto_awesome
                </span>
                <h4 className="font-headline font-bold text-on-surface">Insights de IA</h4>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-primary mb-1 uppercase tracking-tight">
                    MÁXIMA CONCENTRACIÓN
                  </p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    Tu energía alcanza su pico entre las 09:00 - 11:30. 2 bloques de Trabajo
                    Profundo optimizados.
                  </p>
                </div>
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-secondary mb-1 uppercase tracking-tight">
                    ANÁLISIS DE HUECOS
                  </p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    1.5 horas de tiempo sin asignar encontradas. Sugerencias proporcionadas.
                  </p>
                </div>
              </div>
            </div>

            {/* Priority Tasks */}
            <div>
              <h4 className="font-headline font-bold text-on-surface mb-4 px-2">
                Tareas de Alto Impacto
              </h4>
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border-l-4 border-secondary-container">
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-semibold text-on-surface">
                      Revisar Roadmap del Q4
                    </span>
                    <span className="material-symbols-outlined text-outline-variant text-lg">
                      check_circle
                    </span>
                  </div>
                </div>
                <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border-l-4 border-outline-variant">
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-semibold text-on-surface">
                      Preparar diapositivas de presentación
                    </span>
                    <span className="material-symbols-outlined text-outline-variant text-lg">
                      radio_button_unchecked
                    </span>
                  </div>
                </div>
                <div className="bg-primary p-6 rounded-[24px] text-white shadow-xl shadow-primary/20">
                  <h5 className="text-lg font-bold mb-2">Objetivo de la Tarde</h5>
                  <p className="text-primary-fixed text-sm mb-4 leading-relaxed opacity-90">
                    Terminar la documentación arquitectónica para la nueva capa de datos.
                  </p>
                  <div className="w-full bg-white/20 h-1 rounded-full overflow-hidden">
                    <div className="bg-white w-[65%] h-full"></div>
                  </div>
                  <p className="text-[10px] mt-2 font-bold uppercase tracking-widest opacity-70">
                    65% COMPLETADO
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <button className="fixed bottom-28 right-6 w-14 h-14 bg-primary text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-105 active:scale-90 transition-transform z-40">
        <span className="material-symbols-outlined text-3xl">add</span>
      </button>
    </div>
  )
}
