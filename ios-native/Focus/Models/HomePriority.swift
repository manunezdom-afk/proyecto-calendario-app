import Foundation

/// La selección editorial de Hoy. No persiste un orden manual: se reconstruye
/// con el contexto actual cada vez que cambian tareas, agenda o la hora.
struct HomePriorityPlan {
    struct Item: Identifiable, Hashable {
        enum Content: Hashable {
            case task(FocusTask)
            case reminder(FocusEvent)
        }

        enum Tone: Hashable {
            case urgent
            case today
            case important
        }

        let content: Content
        let reason: String
        let tone: Tone

        var id: String {
            switch content {
            case .task(let task): return "task-\(task.id.uuidString)"
            case .reminder(let event): return "reminder-\(event.id.uuidString)"
            }
        }

        var taskID: UUID? {
            guard case .task(let task) = content else { return nil }
            return task.id
        }
    }

    let items: [Item]
    let totalItemCount: Int
    let totalTaskCount: Int
    let totalReminderCount: Int
    let recommendation: NovaSuggestion?

    var hiddenTaskCount: Int {
        max(0, totalTaskCount - items.compactMap(\.taskID).count)
    }

    var hiddenReminderCount: Int {
        let visible = items.reduce(into: 0) { count, item in
            if case .reminder = item.content { count += 1 }
        }
        return max(0, totalReminderCount - visible)
    }

    var summary: String {
        if totalItemCount == 0 {
            return recommendation == nil
                ? "No hay nada urgente ahora."
                : "Hilante detectó algo útil para hoy."
        }
        let urgentCount = items.filter { $0.tone == .urgent }.count
        if urgentCount > 0 {
            return totalItemCount == 1
                ? "Hay una cosa que requiere atención ahora."
                : "Hay \(totalItemCount) cosas que requieren atención ahora."
        }
        return totalItemCount == 1
            ? "Focus eligió una cosa para avanzar hoy."
            : "Focus eligió \(totalItemCount) cosas para avanzar hoy."
    }
}

enum HomePriorityPlanner {
    private struct RankedItem {
        let item: HomePriorityPlan.Item
        let tier: Int
        let date: Date
        let priority: Int
        let title: String
    }

    static func makePlan(
        tasks: [FocusTask],
        events: [FocusEvent],
        suggestions: [NovaSuggestion] = [],
        now: Date = Date(),
        calendar: Calendar = .current,
        limit: Int = 3
    ) -> HomePriorityPlan {
        let startOfToday = calendar.startOfDay(for: now)
        let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? now
        let activeEvents = events.filter { $0.status != .done && $0.status != .cancelled }
        let agendaEventIDs = Set(activeEvents.compactMap { event in
            calendar.isDate(event.startTime, inSameDayAs: now) ? event.id : nil
        })

        var ranked: [RankedItem] = activeEvents.compactMap { event in
            guard event.isReminder == true, event.startTime < now else { return nil }
            let reason: String
            if calendar.isDate(event.startTime, inSameDayAs: now) {
                reason = "Aviso vencido · \(DateFormatters.hourMinute.string(from: event.startTime))"
            } else {
                reason = "Aviso pendiente · \(event.startTime.formatted(.dateTime.day().month(.abbreviated)))"
            }
            return RankedItem(
                item: .init(content: .reminder(event), reason: reason, tone: .urgent),
                tier: 0,
                date: event.startTime,
                priority: 0,
                title: event.title
            )
        }

        let rankedTasks: [RankedItem] = tasks.compactMap { task in
            guard !task.done, task.parentTaskId == nil else { return nil }
            if let linkedEventID = task.linkedEventId, agendaEventIDs.contains(linkedEventID) {
                return nil
            }

            let priority = priorityRank(task.priority)
            if let dueDate = task.dueDate {
                guard dueDate < startOfTomorrow else { return nil }
                if dueDate < startOfToday {
                    return RankedItem(
                        item: .init(content: .task(task), reason: "Atrasada", tone: .urgent),
                        tier: 0,
                        date: dueDate,
                        priority: priority,
                        title: task.title
                    )
                }
                if let dueTime = task.dueTime, dueTime < now {
                    return RankedItem(
                        item: .init(
                            content: .task(task),
                            reason: "Venció a las \(DateFormatters.hourMinute.string(from: dueTime))",
                            tone: .urgent
                        ),
                        tier: 0,
                        date: dueTime,
                        priority: priority,
                        title: task.title
                    )
                }
                let time = task.dueTime.map { " · \(DateFormatters.hourMinute.string(from: $0))" } ?? ""
                let high = task.priority == .alta ? " · prioridad alta" : ""
                return RankedItem(
                    item: .init(content: .task(task), reason: "Para hoy\(time)\(high)", tone: .today),
                    tier: 1,
                    date: task.dueTime ?? dueDate,
                    priority: priority,
                    title: task.title
                )
            }

            if task.priority == .alta {
                return RankedItem(
                    item: .init(content: .task(task), reason: "Prioridad alta", tone: .important),
                    tier: 2,
                    date: .distantFuture,
                    priority: priority,
                    title: task.title
                )
            }
            guard task.category == .hoy else { return nil }
            return RankedItem(
                item: .init(content: .task(task), reason: "Elegida para hoy", tone: .today),
                tier: 3,
                date: .distantFuture,
                priority: priority,
                title: task.title
            )
        }
        ranked.append(contentsOf: rankedTasks)

        ranked.sort {
            if $0.tier != $1.tier { return $0.tier < $1.tier }
            if $0.date != $1.date { return $0.date < $1.date }
            if $0.priority != $1.priority { return $0.priority < $1.priority }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }

        let allItems = ranked.map(\.item)
        let recommendation = usefulRecommendation(
            from: suggestions,
            hasPriorities: !allItems.isEmpty,
            tasks: tasks,
            events: activeEvents,
            now: now,
            calendar: calendar
        )
        return HomePriorityPlan(
            items: Array(allItems.prefix(max(0, limit))),
            totalItemCount: allItems.count,
            totalTaskCount: rankedTasks.count,
            totalReminderCount: ranked.count - rankedTasks.count,
            recommendation: recommendation
        )
    }

    static func visibleTaskIDs(
        _ tasks: [FocusTask],
        events: [FocusEvent] = [],
        now: Date = Date(),
        timezone: TimeZone = .current,
        limit: Int = 3
    ) -> Set<UUID> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        return Set(makePlan(tasks: tasks, events: events, now: now, calendar: calendar, limit: limit)
            .items.compactMap(\.taskID))
    }

    private static func priorityRank(_ priority: TaskPriority) -> Int {
        switch priority {
        case .alta: return 0
        case .media: return 1
        case .baja: return 2
        }
    }

    private static func usefulRecommendation(
        from suggestions: [NovaSuggestion],
        hasPriorities: Bool,
        tasks: [FocusTask],
        events: [FocusEvent],
        now: Date,
        calendar: Calendar
    ) -> NovaSuggestion? {
        let existingTitles = Set((tasks.map(\.title) + events.map(\.title)).map(normalized))
        return suggestions
            .filter {
                $0.status == .pending &&
                calendar.isDate($0.createdAt, inSameDayAs: now) &&
                $0.relatedTaskId == nil && $0.relatedEventId == nil &&
                !existingTitles.contains(normalized($0.suggestedAction)) &&
                ($0.priority == .high || !hasPriorities)
            }
            .sorted {
                if $0.priority != $1.priority { return $0.priority == .high }
                return $0.createdAt > $1.createdAt
            }
            .first
    }

    private static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
