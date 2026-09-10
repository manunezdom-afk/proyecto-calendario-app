import SwiftUI
import UIKit

/// Hoy responde a una sola pregunta: qué puedo hacer ahora.
struct MiDiaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var toast: ToastManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var homeNow = NovaResponder.referenceNow
    @State private var captureFocused = false
    @State private var showNewTask = false
    @State private var showNewEvent = false
    @State private var editingTask: FocusTask?
    @State private var editingEvent: FocusEvent?
    @State private var lastCompletedTask: UUID?
    @State private var deletedEvent: FocusDataStore.EventDeletionReceipt?
    @State private var externalDeletionNotice = false

    private var dateLabel: String {
        let value = homeNow.formatted(.dateTime.weekday(.wide).day().month(.wide))
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
            suggestions: store.settings.smartSuggestionsEnabled ? store.pendingSuggestions : [], now: homeNow
        )
    }

    private var dayEvents: [FocusEvent] {
        let now = homeNow
        return store.eventsFor(date: now).filter {
            guard $0.status != .cancelled && $0.status != .done else { return false }
            if $0.isReminder == true { return $0.startTime >= now }
            return ($0.endTime ?? $0.startTime) >= now
        }
    }

    private var agendaLeads: Bool {
        !dayEvents.isEmpty && !priorityPlan.items.contains { $0.tone == .urgent }
            && (priorityPlan.items.isEmpty || dayEvents[0].startTime.timeIntervalSince(homeNow) <= 90 * 60)
    }

    private var feedbackBelowAgenda: Bool {
        agendaLeads && !store.isNovaTyping && store.novaPendingProposal == nil && store.novaErrorMessage == nil
    }

    private var quietDay: Bool {
        priorityPlan.items.isEmpty && priorityPlan.recommendation == nil && dayEvents.isEmpty
    }

    private var hasFeedback: Bool {
        store.isNovaTyping || store.novaPendingProposal != nil || store.novaErrorMessage != nil || store.homeReply != nil
    }

    private var headline: String {
        if priorityPlan.items.contains(where: { $0.tone == .urgent }) { return "Primero, lo esencial." }
        if agendaLeads { return "Tu día está en marcha." }
        if !priorityPlan.items.isEmpty { return "Un paso a la vez." }
        return "Hoy, con espacio."
    }

    var body: some View {
        NavigationStack {
            GeometryReader { viewport in
            ScrollViewReader { proxy in
            List {
                Group {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(dateLabel)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .accessibilityIdentifier("today.date")
                        Text(headline)
                            .font(.largeTitle.weight(.semibold))
                            .tracking(-0.8)
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                    }
                    .padding(.top, 16)

                    if quietDay && !captureFocused {
                        quietPresence(compact: hasFeedback, height: viewport.size.height)
                    }

                        NovaCaptureField(text: $draft, identifier: "capture", placeholder: "¿Qué tienes en mente?",
                                         onFocusChange: { captureFocused = $0 }) {}
                            .background {
                                GeometryReader { geometry in
                                    Color.clear.preference(key: HomeCaptureHeightKey.self, value: geometry.size.height)
                                }
                            }
                            .onPreferenceChange(HomeCaptureHeightKey.self) { _ in
                                if captureFocused { proxy.scrollTo("today.capture", anchor: .top) }
                            }
                            .id("today.capture")
                    if quietDay && !hasFeedback && draft.isEmpty && !captureFocused {
                        Button {
                            draft = "Recuérdame llamar mañana a las 10"
                        } label: {
                            Text("Prueba: “Recuérdame llamar mañana a las 10”")
                                .font(.caption).foregroundStyle(Theme.Colors.textSecondary)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Escribe el ejemplo en el composer para que puedas editarlo")
                        .accessibilityIdentifier("today.capture.suggestion")
                    }
                    if !feedbackBelowAgenda && hasFeedback { NovaFeedbackView(showLatestReply: true) }

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

                    if agendaLeads {
                        agendaSection
                        if feedbackBelowAgenda && hasFeedback { NovaFeedbackView(showLatestReply: true) }
                    }
                    if !priorityPlan.items.isEmpty || priorityPlan.recommendation != nil {
                        importantSection
                    }
                    if !agendaLeads && !dayEvents.isEmpty { agendaSection }
                        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: homeNow) ?? homeNow
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
                .listRowInsets(EdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            #if DEBUG
            .onAppear { HilantePresentationFixture.install(in: store); homeNow = NovaResponder.referenceNow }
            #endif
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                guard captureFocused else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                    proxy.scrollTo("today.capture", anchor: .top)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { homeNow = NovaResponder.referenceNow }
            }
            .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
                homeNow = NovaResponder.referenceNow
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: dayEvents.map(\.id))
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: quietDay)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: hasFeedback)
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

    private func quietPresence(compact: Bool, height: CGFloat) -> some View {
        let smallViewport = height < 650
        return VStack(alignment: .leading, spacing: 18) {
            if !dynamicTypeSize.isAccessibilitySize {
                HilanteLivingMark(phase: .resting, size: compact ? 62 : smallViewport ? 72 : 94)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, compact ? 8 : smallViewport ? 4 : 18)
            }
            if !compact {
                Text("Sin actividades para hoy")
                    .font(.title3.weight(.medium)).foregroundStyle(Theme.Colors.textPrimary)
                Text(dynamicTypeSize.isAccessibilitySize ? "Dile a Hilante qué quieres guardar."
                     : "Una idea, un pendiente o un plan.\nDile a Hilante qué quieres guardar.")
                    .font(.subheadline).foregroundStyle(Theme.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, compact || smallViewport || dynamicTypeSize.isAccessibilitySize ? 0 : min(36, height * 0.045))
        .padding(.bottom, compact ? 0 : 6)
        .accessibilityIdentifier("today.priority.empty")
    }

    @ViewBuilder private var agendaSection: some View {
        HStack {
            sectionTitle("Tu agenda", count: dayEvents.count)
            Spacer()
            Button { nav.openCalendar(on: homeNow) } label: {
                Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold))
                    .frame(width: 44, height: 44)
            }.accessibilityLabel("Ver agenda")
        }
        ForEach(Array(dayEvents.enumerated()), id: \.element.id) { index, event in
            eventRow(event, featured: agendaLeads && index == 0)
        }
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
                Text(plan.items.isEmpty ? "Una idea para hoy" : "Lo importante")
                    .font(.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .accessibilityAddTraits(.isHeader)
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
                .padding(.vertical, 4)
                .background(Theme.Colors.surface.opacity(0.55), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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

    private func eventRow(_ event: FocusEvent, overdue: Bool = false, featured: Bool = false) -> some View {
        let accessible = dynamicTypeSize.isAccessibilitySize
        let layout = (accessible || featured)
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
        return layout {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.startTime, format: .dateTime.hour().minute())
                    .font(featured ? .largeTitle.weight(.semibold).monospacedDigit() : .subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(featured ? Theme.Colors.focusAccent : Theme.Colors.textSecondary)
                    .lineLimit(1).minimumScaleFactor(0.8)
                if overdue { Text(event.startTime, format: .dateTime.day().month(.abbreviated)).font(.caption).foregroundStyle(Theme.Colors.danger) }
            }.frame(width: (accessible || featured) ? nil : 62, alignment: .leading)
            if !accessible && !featured {
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
                        Text(event.title).font(featured ? .title2.weight(.semibold) : .body.weight(.medium)).foregroundStyle(.primary)
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
        }.fixedSize(horizontal: false, vertical: true)
        .padding(featured ? 22 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if featured {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.Colors.focusAccent.opacity(0.16), Theme.Colors.novaAccent.opacity(0.07)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay { RoundedRectangle(cornerRadius: 26).strokeBorder(Theme.Colors.focusAccent.opacity(0.12), lineWidth: 1) }
            }
        }
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

private struct HomeCaptureHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
