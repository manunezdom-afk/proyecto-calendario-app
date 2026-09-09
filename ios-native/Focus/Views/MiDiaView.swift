import SwiftUI

/// Hoy responde a una sola pregunta: qué puedo hacer ahora.
struct MiDiaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var toast: ToastManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openURL) private var openURL
    @State private var draft = ""
    @State private var showNovaResult = false
    @State private var showNewTask = false
    @State private var showNewEvent = false
    @State private var editingTask: FocusTask?
    @State private var editingEvent: FocusEvent?
    @State private var lastCompletedTask: UUID?
    @State private var deletedEvent: FocusDataStore.EventDeletionReceipt?
    @State private var externalDeletionNotice = false

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

    private var priorityPlan: HomePriorityPlan {
        HomePriorityPlanner.makePlan(
            tasks: store.tasks,
            events: store.events + store.systemEvents,
            suggestions: store.settings.smartSuggestionsEnabled ? store.pendingSuggestions : []
        )
    }

    private var dayEvents: [FocusEvent] {
        let now = Date()
        return store.eventsFor(date: now).filter {
            guard $0.status != .cancelled && $0.status != .done else { return false }
            if $0.isReminder == true { return $0.startTime >= now }
            return ($0.endTime ?? $0.startTime) >= now
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(dateLabel)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .accessibilityIdentifier("today.date")
                        Text("Vamos con tu día.")
                            .font(Theme.Typography.displayHero)
                            .tracking(-0.8)
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("Lo que tienes en mente, empieza aquí.")
                            .font(.body)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                    .padding(.top, 16)

                    VStack(alignment: .leading, spacing: 16) {
                        NovaCaptureField(text: $draft, identifier: "capture", placeholder: "¿Qué tienes en mente?") {
                            showNovaResult = true
                        }
                        if showNovaResult || store.isNovaTyping || store.novaPendingProposal != nil || store.novaErrorMessage != nil {
                            NovaFeedbackView(showLatestReply: true)
                        }
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
                        importantSection

                        Group {
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
                                }.padding(16).background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 22))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: dayEvents.map(\.id))
            .background { FocusAmbientBackground(intensity: 0.85) }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Hoy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        FocusMark(size: 28)
                        Text("Focus").font(.headline.weight(.medium)).foregroundStyle(Theme.Colors.textPrimary)
                    }.accessibilityElement(children: .combine)
                }
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
            .safeAreaInset(edge: .bottom) {
                if let receipt = deletedEvent, receipt.generation == store.accountGeneration {
                    HStack {
                        Text("Evento eliminado").font(.subheadline)
                        Spacer()
                        Button("Deshacer") {
                            if store.undoEventDeletion(receipt) { deletedEvent = nil }
                            else { toast.show(.warning("No pude restaurarlo. Inténtalo de nuevo.")) }
                        }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                            .accessibilityIdentifier("today.undoDelete")
                    }
                    .padding(.horizontal, 16).background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 20)
                    .task(id: receipt.id) {
                        try? await Task.sleep(nanoseconds: 10_000_000_000)
                        if !Task.isCancelled, deletedEvent?.id == receipt.id { deletedEvent = nil }
                    }
                }
            }
            .alert("Evento del calendario del iPhone", isPresented: $externalDeletionNotice) {
                Button("Entendido", role: .cancel) { }
            } message: {
                Text("Focus consulta este calendario. Para eliminar el evento, ábrelo en Calendario y comprueba los permisos de esa cuenta.")
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
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "circle.dotted.circle")
                    .font(.system(size: 26, weight: .light))
                    .foregroundStyle(Theme.Colors.focusAccent)
                    .frame(width: 44, height: 44)
                    .background(Theme.Colors.focusAccentSoft, in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    Text("Empieza por una cosa.")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text("Una tarea, un plan o eso que no quieres olvidar.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button {
                draft = "Tengo que estudiar economía mañana"
            } label: {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("PRUEBA A DECIR").font(.caption2.weight(.semibold)).tracking(1.2)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text("Estudiar economía mañana")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.Colors.textPrimary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.left")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .frame(width: 36, height: 36)
                        .background(Theme.Colors.surface, in: Circle())
                }
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(Theme.Colors.surfaceTinted, in: RoundedRectangle(cornerRadius: 18))
            }.buttonStyle(.plain).accessibilityIdentifier("today.example")
            Button {
                showNewTask = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus")
                    Text("Crear una tarea manualmente")
                }
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Colors.focusAccent)
            .accessibilityIdentifier("today.manualTask")
        }
        .focusSurface(radius: 26, padding: 20)
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
            Text("\(count)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(Theme.Colors.focusAccent)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Theme.Colors.focusAccentSoft, in: Capsule())
        }.accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }

    private var importantSection: some View {
        let plan = priorityPlan
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Lo importante")
                    .font(.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(plan.summary)
                    .font(.subheadline)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("today.priority.header")

            if !plan.items.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(plan.items.enumerated()), id: \.element.id) { index, item in
                        attentionRow(item)
                        if index < plan.items.count - 1 { Divider().padding(.leading, 60) }
                    }
                }
                .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            } else if plan.recommendation == nil {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle")
                        .font(.title3)
                        .foregroundStyle(Theme.Colors.success)
                        .accessibilityHidden(true)
                    Text(pendingTasks.isEmpty
                         ? "Tu agenda contiene lo próximo; no hay pendientes que reclamen atención."
                         : "Tus demás pendientes pueden esperar. Focus los mantiene en su lista.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityIdentifier("today.priority.empty")
            }

            if let recommendation = plan.recommendation {
                recommendationRow(recommendation)
            }

            if plan.hiddenTaskCount > 0 || plan.hiddenReminderCount > 0 {
                HStack(spacing: 16) {
                    if plan.hiddenTaskCount > 0 {
                        Button("Ver demás pendientes") { nav.selectedTab = .tareas }
                    }
                    if plan.hiddenReminderCount > 0 {
                        Button("Revisar avisos") { nav.openCalendar(on: Date()) }
                    }
                }
                .font(.subheadline.weight(.medium))
                .frame(minHeight: 44)
            } else if plan.items.isEmpty && !pendingTasks.isEmpty {
                Button("Ver pendientes") { nav.selectedTab = .tareas }
                    .font(.subheadline.weight(.medium))
                    .frame(minHeight: 44)
            }
        }
    }

    @ViewBuilder private func attentionRow(_ item: HomePriorityPlan.Item) -> some View {
        switch item.content {
        case .task(let task):
            todayTaskRow(task, reason: item.reason, tone: item.tone)
        case .reminder(let event):
            overdueReminderRow(event, reason: item.reason)
        }
    }

    private func todayTaskRow(
        _ task: FocusTask,
        reason: String,
        tone: HomePriorityPlan.Item.Tone
    ) -> some View {
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
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(priorityToneColor(tone))
                }.frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("today.priority.task.open.\(task.id.uuidString)")
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
    }

    private func overdueReminderRow(_ event: FocusEvent, reason: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "bell.badge.fill")
                .font(.body.weight(.medium))
                .foregroundStyle(Theme.Colors.danger)
                .frame(width: 44, height: 52)
                .accessibilityHidden(true)
            Button {
                if event.effectiveSource == .local { editingEvent = event }
                else if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") { openURL(url) }
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Text(reason).font(.caption).foregroundStyle(Theme.Colors.danger)
                }
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.plain)
            if event.effectiveSource == .local {
                Button {
                    var done = event
                    done.status = .done
                    if store.updateEvent(done) { toast.success("Recordatorio completado") }
                } label: {
                    Image(systemName: "checkmark.circle")
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Completar recordatorio \(event.title)")
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
    }

    private func recommendationRow(_ suggestion: NovaSuggestion) -> some View {
        HStack(alignment: .top, spacing: 12) {
            FocusMark(size: 30)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text("HILANTE RECOMIENDA")
                    .font(.caption2.weight(.semibold))
                    .tracking(1)
                    .foregroundStyle(Theme.Colors.novaAccent)
                    .accessibilityIdentifier("today.priority.recommendation")
                Text(suggestion.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(suggestion.detail)
                    .font(.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Revisar con Hilante") {
                    nav.openNova(prompt: "Ayúdame con esta recomendación: \(suggestion.title). \(suggestion.detail)")
                }
                .font(.subheadline.weight(.medium))
                .frame(minHeight: 44)
                .accessibilityIdentifier("today.priority.recommendation.open")
            }
            Spacer(minLength: 0)
            Button {
                store.updateSuggestion(suggestion.id, status: .dismissed)
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Colors.textSecondary)
            .accessibilityLabel("Descartar recomendación")
            .accessibilityIdentifier("today.priority.recommendation.dismiss")
        }
        .padding(16)
        .background(Theme.Colors.novaAccent.opacity(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func priorityToneColor(_ tone: HomePriorityPlan.Item.Tone) -> Color {
        switch tone {
        case .urgent: return Theme.Colors.danger
        case .today: return Theme.Colors.textSecondary
        case .important: return Theme.Colors.warning
        }
    }

    private func eventRow(_ event: FocusEvent, overdue: Bool = false) -> some View {
        let accessible = dynamicTypeSize.isAccessibilitySize
        let layout = accessible
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
        return layout {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.startTime, format: .dateTime.hour().minute())
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .lineLimit(1).minimumScaleFactor(0.8)
                if overdue { Text(event.startTime, format: .dateTime.day().month(.abbreviated)).font(.caption).foregroundStyle(Theme.Colors.danger) }
            }.frame(width: accessible ? nil : 62, alignment: .leading)
            if !accessible {
                RoundedRectangle(cornerRadius: 2).fill(event.accentColor).frame(width: 3)
                    .accessibilityHidden(true)
            }
            Button {
                if event.effectiveSource == .local { editingEvent = event }
                else if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") { openURL(url) }
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Image(systemName: event.effectiveSource == .local ? event.section.symbol : "calendar")
                            .font(.caption).foregroundStyle(event.accentColor).accessibilityHidden(true)
                        Text(event.title).font(.body.weight(.medium)).foregroundStyle(.primary)
                    }
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
        }.fixedSize(horizontal: false, vertical: true).focusSurface(radius: 20, padding: 16)
        .accessibilityIdentifier("today.event.\(event.id.uuidString)")
        .swipeActions(edge: .trailing, allowsFullSwipe: event.effectiveSource == .local) {
            if event.effectiveSource == .local {
                Button(role: .destructive) {
                    if let receipt = store.deleteEventWithUndo(event.id) { deletedEvent = receipt }
                    else if store.events.contains(where: { $0.id == event.id }) {
                        toast.show(.warning("No pude guardar el borrado. Inténtalo de nuevo."))
                    }
                } label: { Label("Eliminar", systemImage: "trash") }.tint(.red)
            } else {
                Button { externalDeletionNotice = true } label: { Label("Eliminar", systemImage: "trash") }.tint(.red)
                Button {
                    if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") { openURL(url) }
                } label: { Label("Calendario", systemImage: "calendar") }
            }
        }
    }
}
