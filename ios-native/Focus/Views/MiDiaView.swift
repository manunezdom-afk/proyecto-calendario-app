import SwiftUI

/// Hoy responde a una sola pregunta: qué puedo hacer ahora.
struct MiDiaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var toast: ToastManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @State private var draft = ""
    @State private var showNovaResult = false
    @State private var showNewTask = false
    @State private var showNewEvent = false
    @State private var editingTask: FocusTask?
    @State private var editingEvent: FocusEvent?
    @State private var lastCompletedTask: UUID?

    private var dateLabel: String {
        let value = Date().formatted(.dateTime.weekday(.wide).day().month(.wide))
        return value.prefix(1).uppercased() + value.dropFirst()
    }

    private var pendingTasks: [FocusTask] {
        store.tasks.filter { !$0.done && $0.parentTaskId == nil }.sorted {
            let left = ($0.dueDate ?? .distantFuture)
            let right = ($1.dueDate ?? .distantFuture)
            if left != right { return left < right }
            if $0.priority != $1.priority { return $0.priority == .alta || $1.priority == .baja }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }

    private var todayTasks: [FocusTask] {
        let dated = pendingTasks.filter {
            if let due = $0.dueDate { return due < (Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())) ?? Date()) }
            return $0.category == .hoy || $0.priority == .alta
        }
        return dated.isEmpty ? Array(pendingTasks.filter { $0.dueDate == nil }.prefix(3)) : dated
    }

    private var dayEvents: [FocusEvent] {
        store.eventsFor(date: Date()).filter { $0.status != .cancelled && $0.status != .done }
    }

    private var overdueReminders: [FocusEvent] {
        store.events.filter {
            $0.isReminder == true && $0.status != .done && $0.status != .cancelled &&
            $0.startTime < Calendar.current.startOfDay(for: Date())
        }.sorted { $0.startTime < $1.startTime }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Text(dateLabel)
                        .font(.subheadline).foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.date")

                    VStack(alignment: .leading, spacing: 12) {
                        Text("De tu cabeza a tu día.").font(.title2.weight(.semibold))
                        NovaCaptureField(text: $draft, identifier: "capture", placeholder: "¿Qué necesitas hacer?") {
                            showNovaResult = true
                        }
                        if showNovaResult { NovaFeedbackView(showLatestReply: true) }
                    }

                    syncNotice

                    if let id = lastCompletedTask, let task = store.tasks.first(where: { $0.id == id && $0.done }) {
                        HStack {
                            Label("Completaste \(task.title)", systemImage: "checkmark.circle.fill")
                                .font(.subheadline).foregroundStyle(Theme.Colors.success)
                            Spacer()
                            Button("Deshacer") {
                                if store.toggleTask(id) { lastCompletedTask = nil }
                            }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                        }.accessibilityIdentifier("today.completed")
                    }

                    if store.tasks.isEmpty && store.events.isEmpty && store.systemEvents.isEmpty {
                        firstStep
                    } else {
                        if !todayTasks.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionTitle("Lo importante", count: todayTasks.count)
                                VStack(spacing: 0) {
                                    ForEach(Array(todayTasks.prefix(5).enumerated()), id: \.element.id) { index, task in
                                        todayTaskRow(task)
                                        if index < min(todayTasks.count, 5) - 1 { Divider().padding(.leading, 52) }
                                    }
                                }.background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 16))
                                if todayTasks.count > 5 {
                                    Button("Ver los \(todayTasks.count) pendientes") { nav.selectedTab = .tareas }
                                        .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                                }
                            }
                        } else if !pendingTasks.isEmpty {
                            Button { nav.selectedTab = .tareas } label: {
                                Label(pendingTasks.count == 1 ? "Tienes 1 pendiente para después" : "Tienes \(pendingTasks.count) pendientes para después", systemImage: "checklist")
                                    .font(.subheadline).frame(minHeight: 44)
                            }
                        }

                        if !overdueReminders.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionTitle("Avisos por atender", count: overdueReminders.count)
                                ForEach(overdueReminders.prefix(5)) { event in eventRow(event, overdue: true) }
                            }
                        }

                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                sectionTitle("Tu agenda", count: dayEvents.count)
                                Spacer()
                                Button("Ver agenda") { nav.openCalendar(on: Date()) }
                                    .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                            }
                            if dayEvents.isEmpty {
                                Text("Hoy no tienes eventos. Hay espacio para avanzar a tu ritmo.")
                                    .font(.body).foregroundStyle(.secondary)
                            } else {
                                ForEach(dayEvents) { event in eventRow(event) }
                            }
                        }

                        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
                        let next = store.eventsFor(date: tomorrow).filter { $0.status != .cancelled && $0.status != .done }
                        if let first = next.first {
                            Button { nav.openCalendar(on: tomorrow) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "sunrise").font(.title3)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Mañana").font(.subheadline.weight(.semibold))
                                        Text("\(first.timeRangeLabel) · \(first.title)").font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                                }.padding(16).background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 16))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            }
            .background(Theme.Colors.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Hoy")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { nav.openSettings() } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ajustes").accessibilityIdentifier("today.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Nueva tarea", systemImage: "checkmark.circle") { showNewTask = true }
                        Button("Nuevo evento", systemImage: "calendar.badge.plus") { showNewEvent = true }
                    } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Crear").accessibilityIdentifier("today.new")
                }
            }
            .refreshable { await store.fetchRemoteAndMerge(); store.refreshSystemEvents() }
            .sheet(isPresented: $showNewTask) {
                NuevaTareaSheet { saveTask($0) }
            }
            .sheet(isPresented: $showNewEvent) {
                NuevoEventoSheet(initialDate: Date()) { saveEvent($0) }
            }
            .sheet(item: $editingTask) { task in
                NuevaTareaSheet(editing: task) { saveTask($0, editing: true) }
            }
            .sheet(item: $editingEvent) { event in
                NuevoEventoSheet(editing: event) {
                    saveEvent($0, editing: true)
                }
            }
        }
    }

    private func saveTask(_ task: FocusTask, editing: Bool = false) -> Bool {
        let saved = editing ? store.updateTask(task) : store.addTask(task)
        if saved { toast.success(editing ? "Cambios guardados" : "Tarea guardada") }
        return saved
    }

    private func saveEvent(_ event: FocusEvent, editing: Bool = false) -> Bool {
        let saved = editing ? store.updateEvent(event) : store.addEvent(event)
        if saved { toast.success(editing ? "Cambios guardados" : "Evento guardado") }
        return saved
    }

    private var firstStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "checklist").font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.Colors.focusAccent).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text("Empieza por una cosa.").font(.title2.weight(.semibold))
                Text("Escríbela arriba. Focus la convierte en una tarea o un evento y la guarda aquí.")
                    .font(.body).foregroundStyle(.secondary)
            }
            Button {
                draft = "Tengo que estudiar economía mañana"
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("PRUEBA CON UN EJEMPLO").font(.caption2.weight(.semibold)).tracking(1)
                        Text("«Tengo que estudiar economía mañana»").font(.subheadline)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.left").font(.subheadline)
                }.foregroundStyle(Theme.Colors.focusAccent)
            }.buttonStyle(.plain).accessibilityIdentifier("today.example")
            Divider()
            Button("Crear una tarea manualmente") { showNewTask = true }
                .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                .accessibilityIdentifier("today.manualTask")
        }
        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder private var syncNotice: some View {
        if case .error(let message) = store.syncState {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "icloud.slash").foregroundStyle(Theme.Colors.warning)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Atención al guardar").font(.subheadline.weight(.semibold))
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button("Reintentar") { Task { await store.fetchRemoteAndMerge() } }
                    .font(.caption.weight(.semibold)).frame(minHeight: 44)
            }.accessibilityIdentifier("today.syncError")
        }
    }

    private func sectionTitle(_ title: String, count: Int) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.headline)
            Text("\(count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
        }.accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }

    private func todayTaskRow(_ task: FocusTask) -> some View {
        HStack(spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    if store.toggleTask(task.id) { lastCompletedTask = task.id }
                }
            } label: {
                Image(systemName: "circle").font(.title2).foregroundStyle(Theme.Colors.focusAccent)
                    .frame(width: 44, height: 52)
            }.buttonStyle(.plain).accessibilityLabel("Completar \(task.title)")
                .accessibilityIdentifier("today.complete.\(task.id.uuidString)")
            Button { editingTask = task } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title).font(.body.weight(.medium)).foregroundStyle(.primary)
                    HStack(spacing: 8) {
                        if let due = task.dueDate, due < Calendar.current.startOfDay(for: Date()) {
                            Text("Atrasada").foregroundStyle(Theme.Colors.danger)
                        } else if task.priority == .alta {
                            Text("Prioridad alta").foregroundStyle(Theme.Colors.warning)
                        }
                        if let label = task.dueLabel { Text(label).foregroundStyle(.secondary) }
                    }.font(.caption)
                }.frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }.buttonStyle(.plain)
        }.padding(.horizontal, 8).padding(.vertical, 6)
    }

    private func eventRow(_ event: FocusEvent, overdue: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.startTime, format: .dateTime.hour().minute()).font(.subheadline.weight(.semibold).monospacedDigit())
                if overdue { Text(event.startTime, format: .dateTime.day().month(.abbreviated)).font(.caption).foregroundStyle(Theme.Colors.danger) }
            }.frame(width: 62, alignment: .leading)
            RoundedRectangle(cornerRadius: 2).fill(event.section.color).frame(width: 3)
            Button {
                if event.effectiveSource == .local { editingEvent = event }
                else if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") { openURL(url) }
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.title).font(.body.weight(.medium)).foregroundStyle(.primary)
                    if let subtitle = event.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let location = event.location, !location.isEmpty {
                        Label(location, systemImage: "mappin").font(.caption).foregroundStyle(.secondary)
                    }
                    if event.effectiveSource != .local {
                        Text("Calendario del iPhone").font(.caption).foregroundStyle(.secondary)
                    } else if let offsets = event.reminderOffsets, !offsets.isEmpty {
                        Label(offsets.map { $0 == 0 ? "A la hora" : "\($0) min antes" }.joined(separator: " · "), systemImage: "bell")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }.buttonStyle(.plain)
            if event.isReminder == true && event.effectiveSource == .local {
                Button {
                    var done = event; done.status = .done
                    if store.updateEvent(done) { toast.success("Recordatorio completado") }
                } label: { Image(systemName: "checkmark.circle").font(.title2).frame(width: 44, height: 44) }
                .accessibilityLabel("Completar recordatorio \(event.title)")
            }
        }.fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("today.event.\(event.id.uuidString)")
    }
}
