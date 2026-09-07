import SwiftUI

private enum TaskFilter: String, CaseIterable, Identifiable {
    case pending, done
    var id: String { rawValue }
    var label: String { self == .pending ? "Pendientes" : "Completadas" }
}

struct TareasView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var toast: ToastManager
    @State private var filter: TaskFilter = .pending
    @State private var showCreate = false
    @State private var editingTask: FocusTask?
    @State private var expandedTaskIds: Set<UUID> = []

    private var filteredTasks: [FocusTask] {
        store.tasks.filter { $0.done == (filter == .done) }.sorted { lhs, rhs in
            if filter == .done { return (lhs.doneAt ?? .distantPast) > (rhs.doneAt ?? .distantPast) }
            let left = deadline(lhs) ?? .distantFuture
            let right = deadline(rhs) ?? .distantFuture
            if left != right { return left < right }
            if lhs.priority != rhs.priority { return lhs.priority == .alta || rhs.priority == .baja }
            return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error = store.localSaveError {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Theme.Colors.danger)
                            .accessibilityIdentifier("tasks.saveError")
                    }
                }
                Section {
                    Picker("Mostrar tareas", selection: $filter) {
                        ForEach(TaskFilter.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("tasks.filter")
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.clear)
                }

                if filteredTasks.isEmpty {
                    ContentUnavailableView {
                        Label(filter == .done ? "Aún no hay tareas completadas" : "Todo en orden", systemImage: "checkmark.circle")
                    } description: {
                        Text(filter == .done ? "Lo que termines queda aquí para que puedas revisarlo." : "Guarda lo que tienes en mente. Una cosa a la vez.")
                    } actions: {
                        if filter == .pending {
                            Button("Nueva tarea") { showCreate = true }
                                .buttonStyle(.borderedProminent)
                                .frame(minHeight: 44)
                        }
                    }
                    .listRowBackground(Color.clear)
                } else if filter == .done {
                    taskSection("Completadas", items: filteredTasks)
                } else {
                    taskSection("Atrasadas", items: filteredTasks.filter { group($0) == 0 })
                    taskSection("Hoy", items: filteredTasks.filter { group($0) == 1 })
                    taskSection("Próximamente", items: filteredTasks.filter { group($0) == 2 })
                    taskSection("Sin fecha", items: filteredTasks.filter { group($0) == 3 })
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.Colors.background)
            .navigationTitle("Pendientes")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showCreate = true } label: {
                        Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Nueva tarea")
                    .accessibilityIdentifier("task.new")
                }
            }
            .sheet(isPresented: $showCreate) {
                NuevaTareaSheet { task in
                    let saved = store.addTask(task)
                    if saved { toast.success("Tarea guardada") }
                    return saved
                }
            }
            .sheet(item: $editingTask) { task in
                NuevaTareaSheet(editing: task) { updated in
                    let saved = store.updateTask(updated)
                    if saved { toast.success("Tarea actualizada") }
                    return saved
                }
            }
        }
    }

    @ViewBuilder
    private func taskSection(_ title: String, items: [FocusTask]) -> some View {
        if !items.isEmpty {
            Section(title) {
                ForEach(items) { task in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .center, spacing: Theme.Spacing.sm) {
                            Button {
                                if store.toggleTask(task.id), !task.done { toast.success("Completada") }
                            } label: {
                                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                                    .font(.title2)
                                    .foregroundStyle(task.done ? Theme.Colors.success : Theme.Colors.textSecondary)
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(task.done ? "Marcar como pendiente: \(task.title)" : "Completar: \(task.title)")
                            .accessibilityValue(task.done ? "Completada" : "Pendiente")
                            .accessibilityIdentifier("task.complete.\(task.id.uuidString)")

                            Button { editingTask = task } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(task.title)
                                        .font(.body)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                        .strikethrough(task.done)
                                    if let due = task.dueLabel {
                                        Text(due)
                                            .font(.subheadline)
                                            .foregroundStyle(group(task) == 0 && !task.done ? Theme.Colors.danger : Theme.Colors.textSecondary)
                                    }
                                    if task.priority == .alta && !task.done {
                                        Label("Alta prioridad", systemImage: "flag.fill")
                                            .font(.caption)
                                            .foregroundStyle(Theme.Colors.danger)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.borderless)
                            .accessibilityHint("Editar tarea")
                            .accessibilityIdentifier("task.edit.\(task.id.uuidString)")

                            if task.hasSubtasks {
                                Button {
                                    if expandedTaskIds.contains(task.id) { expandedTaskIds.remove(task.id) }
                                    else { expandedTaskIds.insert(task.id) }
                                } label: {
                                    Image(systemName: expandedTaskIds.contains(task.id) ? "chevron.up" : "chevron.down")
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Subtareas: \(task.completedSubtaskCount) de \(task.subtasks.count) completadas")
                            }
                        }
                        if expandedTaskIds.contains(task.id) {
                            ForEach(task.subtasks) { subtask in
                                Button {
                                    store.toggleSubtask(taskId: task.id, subtaskId: subtask.id)
                                } label: {
                                    Label(subtask.title, systemImage: subtask.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.subheadline)
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                        .strikethrough(subtask.isCompleted)
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                }
                                .buttonStyle(.borderless)
                                .padding(.leading, 52)
                                .accessibilityValue(subtask.isCompleted ? "Completada" : "Pendiente")
                            }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            if store.deleteTask(task.id) { toast.success("Tarea eliminada") }
                        } label: { Label("Eliminar", systemImage: "trash") }
                        Button { editingTask = task } label: { Label("Editar", systemImage: "pencil") }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
            }
        }
    }

    private func deadline(_ task: FocusTask) -> Date? {
        guard let date = task.dueDate else { return nil }
        guard let time = task.dueTime else { return Calendar.current.startOfDay(for: date) }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        return Calendar.current.date(bySettingHour: parts.hour ?? 0, minute: parts.minute ?? 0, second: 0, of: date)
    }

    private func group(_ task: FocusTask) -> Int {
        guard let due = task.dueDate else {
            if task.category == .hoy { return 1 }
            if task.category == .semana { return 2 }
            return 3
        }
        let calendar = Calendar.current
        if calendar.startOfDay(for: due) < calendar.startOfDay(for: Date()) { return 0 }
        if task.dueTime != nil, let dueAt = deadline(task), dueAt < Date() { return 0 }
        if calendar.isDateInToday(due) { return 1 }
        return 2
    }
}

struct NuevaTareaSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let original: FocusTask?
    let onSave: (FocusTask) -> Bool
    @State private var title: String
    @State private var notes: String
    @State private var priority: TaskPriority
    @State private var hasDueDate: Bool
    @State private var hasDueTime: Bool
    @State private var dueDate: Date
    @State private var dueTime: Date
    @State private var saveError: String?

    init(onSave: @escaping (FocusTask) -> Bool) {
        self.init(original: nil, onSave: onSave)
    }

    init(editing task: FocusTask, onSave: @escaping (FocusTask) -> Bool) {
        self.init(original: task, onSave: onSave)
    }

    private init(original: FocusTask?, onSave: @escaping (FocusTask) -> Bool) {
        self.original = original
        self.onSave = onSave
        _title = State(initialValue: original?.title ?? "")
        _notes = State(initialValue: original?.notes ?? "")
        _priority = State(initialValue: original?.priority ?? .media)
        _hasDueDate = State(initialValue: original?.dueDate != nil)
        _hasDueTime = State(initialValue: original?.dueTime != nil)
        _dueDate = State(initialValue: original?.dueDate ?? Date())
        _dueTime = State(initialValue: original?.dueTime ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                if let saveError {
                    Section {
                        Label(saveError, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Theme.Colors.danger)
                            .accessibilityIdentifier("task.saveError")
                    }
                }
                Section("Qué necesitas hacer") {
                    TextField("Título de la tarea", text: $title, axis: .vertical)
                        .lineLimit(1...5)
                        .accessibilityIdentifier("task.title")
                }
                Section {
                    Toggle("Fecha límite", isOn: $hasDueDate)
                        .accessibilityIdentifier("task.hasDueDate")
                    if hasDueDate {
                        DatePicker("Día", selection: $dueDate, displayedComponents: .date)
                            .accessibilityIdentifier("task.dueDate")
                        Toggle("Añadir hora", isOn: $hasDueTime)
                            .accessibilityIdentifier("task.hasDueTime")
                        if hasDueTime {
                            DatePicker("Hora límite", selection: $dueTime, displayedComponents: .hourAndMinute)
                                .accessibilityIdentifier("task.dueTime")
                        }
                    }
                } footer: {
                    Text("La fecha te ayuda a ver qué necesita atención. Puedes dejarla sin fecha.")
                }
                Section("Detalles") {
                    Picker("Prioridad", selection: $priority) {
                        ForEach(TaskPriority.allCases) { Text($0.label).tag($0) }
                    }
                    .accessibilityIdentifier("task.priority")
                    TextField("Notas (opcional)", text: $notes, axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityIdentifier("task.notes")
                }
            }
            .navigationTitle(original == nil ? "Nueva tarea" : "Editar tarea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .accessibilityIdentifier("task.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: save)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("task.save")
                }
            }
        }
    }

    private func save() {
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        var task = original ?? FocusTask(title: cleaned, category: .algunDia)
        task.title = cleaned
        let cleanNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        task.notes = cleanNotes.isEmpty ? nil : cleanNotes
        task.priority = priority
        task.dueDate = hasDueDate ? Calendar.current.startOfDay(for: dueDate) : nil
        if hasDueDate && hasDueTime {
            let parts = Calendar.current.dateComponents([.hour, .minute], from: dueTime)
            task.dueTime = Calendar.current.date(bySettingHour: parts.hour ?? 9, minute: parts.minute ?? 0, second: 0, of: dueDate)
        } else {
            task.dueTime = nil
        }
        if hasDueDate { task.category = Calendar.current.isDateInToday(dueDate) ? .hoy : .semana }
        else if original == nil || original?.dueDate != nil { task.category = .algunDia }
        if onSave(task) {
            dismiss()
        } else {
            saveError = "No pudimos guardar la tarea. Revisa el espacio disponible e inténtalo de nuevo."
        }
    }
}
