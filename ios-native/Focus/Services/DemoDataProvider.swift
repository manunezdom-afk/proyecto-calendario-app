import Foundation

/// Provee ejemplos (no datos del usuario) que sirven para mostrar cómo se vería
/// la app antes de que el usuario cree su primer evento o tarea.
///
/// Pensados para universitarios y trabajadores. Combinan clases, foco, reuniones,
/// estudio, gym y vida personal — el escenario realista de alguien que estudia
/// y trabaja en paralelo.
final class DemoDataProvider {
    static let shared = DemoDataProvider()

    private init() {}

    // MARK: - Helpers de fecha

    private func date(daysFromToday: Int, hour: Int, minute: Int = 0) -> Date {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let day = cal.date(byAdding: .day, value: daysFromToday, to: today) ?? today
        return cal.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
    }

    // MARK: - Eventos de EJEMPLO para Mi Día

    /// Eventos visibles en Mi Día cuando el usuario todavía no creó ninguno.
    /// Tono: estudiante universitario que también trabaja. 3 bloques basta para
    /// mostrar la estructura sin saturar la pantalla.
    func exampleTodayEvents() -> [FocusEvent] {
        [
            FocusEvent(
                title: "Clase de Cálculo II",
                notes: "Tema: derivadas parciales.",
                startTime: date(daysFromToday: 0, hour: 8),
                endTime: date(daysFromToday: 0, hour: 9, minute: 30),
                section: .estudio,
                location: "Aula 304"
            ),
            FocusEvent(
                title: "Foco profundo: TP final de Programación",
                notes: "Sin notificaciones. Avanzar el endpoint de auth.",
                startTime: date(daysFromToday: 0, hour: 10),
                endTime: date(daysFromToday: 0, hour: 11, minute: 30),
                section: .foco,
                featured: true
            ),
            FocusEvent(
                title: "Reunión con jefa — review semanal",
                notes: "Repasar prioridades y desbloqueos.",
                startTime: date(daysFromToday: 0, hour: 12),
                endTime: date(daysFromToday: 0, hour: 12, minute: 30),
                section: .reunion,
                location: "Meet"
            )
        ]
    }

    /// Eventos de la semana para vista de Calendario cuando no hay datos del usuario.
    func exampleWeekEvents() -> [FocusEvent] {
        var events = exampleTodayEvents()

        // Mañana
        events.append(FocusEvent(
            title: "Clase de Programación III",
            startTime: date(daysFromToday: 1, hour: 8),
            endTime: date(daysFromToday: 1, hour: 9, minute: 30),
            section: .estudio,
            location: "Aula 201"
        ))
        events.append(FocusEvent(
            title: "Foco: avanzar slides presentación",
            startTime: date(daysFromToday: 1, hour: 10),
            endTime: date(daysFromToday: 1, hour: 12),
            section: .foco
        ))
        events.append(FocusEvent(
            title: "1:1 con tutor de tesis",
            startTime: date(daysFromToday: 1, hour: 16),
            endTime: date(daysFromToday: 1, hour: 16, minute: 45),
            section: .reunion,
            location: "Oficina B"
        ))

        // +2 días
        events.append(FocusEvent(
            title: "Parcial de Bases de Datos",
            notes: "Llegar 15 min antes.",
            startTime: date(daysFromToday: 2, hour: 9),
            endTime: date(daysFromToday: 2, hour: 11),
            section: .estudio,
            featured: true
        ))
        events.append(FocusEvent(
            title: "Almuerzo en familia",
            startTime: date(daysFromToday: 2, hour: 13),
            endTime: date(daysFromToday: 2, hour: 14, minute: 30),
            section: .personal
        ))

        // +3 días
        events.append(FocusEvent(
            title: "Reunión con cliente Acme",
            notes: "Demo del avance del proyecto.",
            startTime: date(daysFromToday: 3, hour: 11),
            endTime: date(daysFromToday: 3, hour: 12),
            section: .reunion,
            featured: true
        ))
        events.append(FocusEvent(
            title: "Caminar por el parque",
            startTime: date(daysFromToday: 3, hour: 18),
            endTime: date(daysFromToday: 3, hour: 19),
            section: .descanso
        ))

        // +4 días (viernes)
        events.append(FocusEvent(
            title: "Entrega TP final de Programación",
            notes: "Fecha límite 23:59.",
            startTime: date(daysFromToday: 4, hour: 9),
            endTime: date(daysFromToday: 4, hour: 11),
            section: .foco,
            featured: true
        ))
        events.append(FocusEvent(
            title: "Cena con amigos",
            startTime: date(daysFromToday: 4, hour: 20, minute: 30),
            endTime: date(daysFromToday: 4, hour: 23),
            section: .personal,
            location: "Bar Sotto"
        ))

        // +5 (sábado)
        events.append(FocusEvent(
            title: "Repasar para final",
            startTime: date(daysFromToday: 5, hour: 10),
            endTime: date(daysFromToday: 5, hour: 12),
            section: .estudio
        ))

        return events
    }

    // MARK: - Tareas de EJEMPLO

    func exampleTodayTasks() -> [FocusTask] {
        [
            FocusTask(
                title: "Repasar fórmulas para el parcial",
                notes: "Derivadas parciales y reglas de la cadena.",
                priority: .alta,
                category: .hoy,
                subtasks: [
                    FocusSubtask(title: "Capítulo 4"),
                    FocusSubtask(title: "Capítulo 5"),
                    FocusSubtask(title: "Resolver 3 ejercicios")
                ]
            ),
            FocusTask(
                title: "Preparar presentación cliente Acme",
                notes: "Slides + speech.",
                priority: .alta,
                category: .hoy,
                subtasks: [
                    FocusSubtask(title: "Slide de problema"),
                    FocusSubtask(title: "Slide de solución", isCompleted: true),
                    FocusSubtask(title: "Slide de precios")
                ]
            ),
            FocusTask(
                title: "Responder mensaje del profe",
                priority: .media,
                category: .hoy
            )
        ]
    }

    func exampleWeekTasks() -> [FocusTask] {
        [
            FocusTask(
                title: "Inscribirme a la mesa de finales",
                priority: .alta,
                category: .semana
            ),
            FocusTask(
                title: "Llamar al dentista",
                priority: .media,
                category: .semana
            ),
            FocusTask(
                title: "Pagar internet",
                priority: .media,
                category: .semana
            ),
            FocusTask(
                title: "Revisar pendientes del sprint próximo",
                priority: .baja,
                category: .semana
            )
        ]
    }

    func exampleSomedayTasks() -> [FocusTask] {
        [
            FocusTask(
                title: "Empezar a leer Atomic Habits",
                priority: .baja,
                category: .algunDia
            ),
            FocusTask(
                title: "Aprender animaciones avanzadas en SwiftUI",
                priority: .baja,
                category: .algunDia
            ),
            FocusTask(
                title: "Arrancar proyecto personal con un amigo",
                priority: .media,
                category: .algunDia,
                subtasks: [
                    FocusSubtask(title: "Pensar idea"),
                    FocusSubtask(title: "Hacer mockup rápido")
                ]
            )
        ]
    }

    func exampleAllTasks() -> [FocusTask] {
        exampleTodayTasks() + exampleWeekTasks() + exampleSomedayTasks()
    }

    // MARK: - Sugerencias de Nova (siempre activas)

    /// Las sugerencias se muestran independientemente de si el usuario tiene
    /// datos. Son lo que Nova "detectó" mirando su día (real o ejemplo).
    func suggestions() -> [NovaSuggestion] {
        [
            NovaSuggestion(
                title: "Hoy tienes 3 bloques de estudio seguidos",
                detail: "Entre las 8 y las 16:30 estás estudiando o en clase. Te sugiero un descanso real al medio o vas a llegar quemado al gym.",
                kind: .rebalance,
                priority: .high,
                suggestedAction: "Reservar pausa 14:00–14:30"
            ),
            NovaSuggestion(
                title: "Antes del parcial te falta repasar Bases de Datos",
                detail: "El parcial es pasado mañana. Te recomiendo un bloque largo mañana entre 14 y 17.",
                kind: .schedule,
                priority: .high,
                suggestedAction: "Bloquear 3h mañana 14:00"
            ),
            NovaSuggestion(
                title: "No olvides preparar la reunión con tu jefa",
                detail: "Tienes review semanal con ella a las 12. Reservé 15 min antes para que repases tus puntos.",
                kind: .prep,
                priority: .normal,
                suggestedAction: "Crear bloque de prep 11:45"
            ),
            NovaSuggestion(
                title: "Mañana tienes 2 horas libres por la mañana",
                detail: "Entre las 10 y las 12 mañana está libre. Buen momento para avanzar el TP de programación.",
                kind: .schedule,
                priority: .normal,
                suggestedAction: "Bloquear foco mañana 10:00"
            ),
            NovaSuggestion(
                title: "Tienes 2 tareas sin horario",
                detail: "“Responder mensaje del profe” y “Comprar materiales” no tienen bloque asignado. Las puedo encajar entre clases.",
                kind: .task,
                priority: .normal,
                suggestedAction: "Asignar bloques"
            )
        ]
    }

    // MARK: - Mensaje Nova de bienvenida

    func welcomeNovaMessages() -> [NovaMessage] {
        [
            NovaMessage(
                role: .nova,
                content: "Soy \(AssistantBrand.displayName). Puedo ordenar tu día, crear tareas y proponerte cambios."
            )
        ]
    }

    // MARK: - Prompts/chips de ejemplo para Mi Día vacío

    /// Tres prompts cortos que se le pueden enviar a Nova directamente.
    /// Inspirados en el patrón web (PlannerView "onboardingChips").
    func emptyDayPrompts() -> [String] {
        [
            "Agrega gym mañana a las 7",
            "Reserva 2 horas para estudiar esta tarde",
            "Tengo parcial el jueves"
        ]
    }
}
