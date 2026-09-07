import SwiftUI

struct CalendarioView: View {
    /// Modos de visualización del Calendario. Día/Semana/Mes son los típicos.
    enum ViewMode: String, CaseIterable, Identifiable {
        case day, week, month
        var id: String { rawValue }
        var label: String {
            switch self {
            case .day: return "Día"
            case .week: return "Semana"
            case .month: return "Mes"
            }
        }
    }

    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var toast: ToastManager
    @EnvironmentObject private var nav: NavigationCoordinator
    @Environment(\.openURL) private var openURL
    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var viewMode: ViewMode = .week
    @State private var showCreateEvent = false
    @State private var editingEvent: FocusEvent? = nil

    private var displayEvents: [FocusEvent] {
        store.eventsFor(date: selectedDate).filter { $0.status != .cancelled }
    }

    private func eventsCount(for date: Date) -> Int {
        store.eventsFor(date: date).filter { $0.status != .cancelled }.count
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FocusAmbientBackground(intensity: 0.5)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                        if let error = store.localSaveError {
                            Label(error, systemImage: "exclamationmark.circle")
                                .foregroundStyle(Theme.Colors.danger)
                                .padding(.horizontal, Theme.Spacing.xl)
                                .accessibilityIdentifier("agenda.saveError")
                        }
                        FocusPageIntro(title: "Agenda", subtitle: monthYearLabel, symbol: "calendar")
                            .padding(.horizontal, Theme.Spacing.xl)

                        modePicker
                            .padding(.horizontal, Theme.Spacing.xl)

                        Group {
                            switch viewMode {
                            case .day:
                                dayMode
                            case .week:
                                weekMode
                            case .month:
                                monthMode
                            }
                        }

                        Spacer(minLength: Theme.Spacing.bottomBarSafety)
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showCreateEvent = true } label: {
                        Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Nuevo evento")
                    .accessibilityIdentifier("event.new")
                }
            }
            .sheet(isPresented: $showCreateEvent) {
                NuevoEventoSheet(initialDate: selectedDate) { newEvent in
                    let saved = store.addEvent(newEvent)
                    if saved {
                        toast.success("Evento creado")
                        selectedDate = Calendar.current.startOfDay(for: newEvent.startTime)
                    }
                    return saved
                }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.Colors.background)
            }
            .sheet(item: $editingEvent) { event in
                NuevoEventoSheet(editing: event) { updated in
                    let saved = store.updateEvent(updated)
                    if saved {
                        toast.success("Evento actualizado")
                        selectedDate = Calendar.current.startOfDay(for: updated.startTime)
                    }
                    return saved
                }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.Colors.background)
            }
            .task(id: nav.selectedTab) {
                if nav.selectedTab == .calendario {
                    // Consumir una fecha pendiente (ej. usuario tocó el
                    // preview "Mañana" de Mi Día). Salto inmediato al día
                    // pedido + modo `.day` para que el usuario aterrice en
                    // la agenda concreta y no en el selector de semana.
                    if let pending = nav.pendingCalendarDate {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            selectedDate = Calendar.current.startOfDay(for: pending)
                            viewMode = .day
                        }
                        nav.pendingCalendarDate = nil
                    }
                }
            }
        }
    }

    // MARK: - Mode picker

    private var modePicker: some View {
        Picker("Vista de agenda", selection: $viewMode) {
            ForEach(ViewMode.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .frame(minHeight: 44)
        .accessibilityIdentifier("agenda.mode")
        .padding(.horizontal, 1)
    }

    // MARK: - Modes

    /// Modo "Día": fecha grande arriba + lista de eventos del día.
    private var dayMode: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            dateDetailHeader
                .padding(.horizontal, Theme.Spacing.xl)
            dayContent
                .padding(.horizontal, Theme.Spacing.xl)
        }
    }

    /// Modo "Semana": selector de 14 días + detalle del día seleccionado.
    private var weekMode: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            weekSelector
                .padding(.horizontal, Theme.Spacing.xl)
            dateDetailHeader
                .padding(.horizontal, Theme.Spacing.xl)
            dayContent
                .padding(.horizontal, Theme.Spacing.xl)
        }
    }

    /// Modo "Mes": grilla mensual con puntos en días con eventos.
    private var monthMode: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            MonthGridView(
                anchorDate: selectedDate,
                eventsCount: { eventsCount(for: $0) },
                isSelected: { Calendar.current.isDate($0, inSameDayAs: selectedDate) },
                onTapDay: { date in
                    HapticManager.shared.tick()
                    selectedDate = Calendar.current.startOfDay(for: date)
                }
            )
            .padding(.horizontal, Theme.Spacing.xl)

            // Resumen del día seleccionado debajo de la grilla.
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                dateDetailHeader
                dayContent
            }
            .padding(.horizontal, Theme.Spacing.xl)
        }
    }

    // MARK: - Header

    private var monthYearLabel: String {
        DateFormatters.capitalizeFirst(DateFormatters.monthYear.string(from: selectedDate))
    }

    // MARK: - Day detail

    private var dateDetailHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(dayName)
                .font(Theme.Typography.title1)
                .tracking(Theme.Tracking.title1)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(dayMetadataLabel)
                .font(Theme.Typography.subhead)
                .tracking(Theme.Tracking.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private var dayName: String {
        if Calendar.current.isDateInToday(selectedDate) { return "Hoy" }
        if Calendar.current.isDateInTomorrow(selectedDate) { return "Mañana" }
        return DateFormatters.capitalizeFirst(DateFormatters.weekdayDay.string(from: selectedDate))
    }

    /// Cantidad y duración total de los eventos del día.
    private var dayMetadataLabel: String {
        let events = displayEvents
        if events.isEmpty { return "Sin eventos agendados." }
        let count = events.count
        let eventStr = "\(count) \(count == 1 ? "evento" : "eventos")"

        let totalMins = events.reduce(0) { acc, e in
            guard let end = e.endTime else { return acc }
            return acc + Int(end.timeIntervalSince(e.startTime) / 60)
        }
        guard totalMins > 0 else { return eventStr }

        let h = totalMins / 60
        let m = totalMins % 60
        let timeStr: String
        if h > 0 && m > 0 {
            timeStr = "\(h)h \(m)m"
        } else if h > 0 {
            timeStr = "\(h)h"
        } else {
            timeStr = "\(m) min"
        }
        return "\(eventStr) · \(timeStr) en agenda"
    }

    @ViewBuilder
    private var dayContent: some View {
        if displayEvents.isEmpty {
            EmptyStateView(
                symbol: "calendar",
                title: "Día libre",
                message: "No tienes eventos en este día. Buen momento para foco o descanso.",
                actionLabel: "Nuevo evento",
                action: { showCreateEvent = true }
            )
            .frame(minHeight: 280)
        } else {
            VStack(spacing: Theme.Spacing.md) {
                ForEach(displayEvents) { event in
                    // Los del calendario del iPhone son read-only: sin
                    // swipe-delete ni editar (Focus no escribe en EventKit).
                    let isSystemEvent = event.effectiveSource == .apple
                    HStack(spacing: 0) {
                        Button {
                            if isSystemEvent {
                                if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") { openURL(url) }
                            } else {
                                editingEvent = event
                            }
                        } label: {
                            CalendarEventCard(event: event)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("event.edit.\(event.id.uuidString)")

                        if !isSystemEvent {
                            Menu {
                                Button("Editar", systemImage: "pencil") { editingEvent = event }
                                Button("Eliminar", systemImage: "trash", role: .destructive) {
                                    if store.deleteEvent(event.id) { toast.success("Evento eliminado", symbol: "trash.fill") }
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("Opciones de \(event.title)")
                            .accessibilityIdentifier("event.options.\(event.id.uuidString)")
                        }
                    }
                    .padding(.trailing, 4)
                    .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.Colors.borderSoft, lineWidth: 0.5))

                }
            }
        }
    }

    // MARK: - Week selector

    private var weekSelector: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.sm) {
                    ForEach(dayOffsets, id: \.self) { offset in
                        let cal = Calendar.current
                        let date = cal.date(byAdding: .day, value: offset, to: cal.startOfDay(for: Date())) ?? Date()
                        DayPill(
                            date: date,
                            isSelected: cal.isDate(date, inSameDayAs: selectedDate),
                            eventsCount: eventsCount(for: date)
                        ) {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                selectedDate = cal.startOfDay(for: date)
                            }
                            HapticManager.shared.tick()
                        }
                        .id(offset)
                    }
                }
                .padding(.vertical, 2)
            }
            .onAppear {
                proxy.scrollTo(0, anchor: .leading)
            }
        }
    }

    private var dayOffsets: [Int] {
        Array(-2...11)
    }

}

// MARK: - Day pill

private struct DayPill: View {
    let date: Date
    let isSelected: Bool
    let eventsCount: Int
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var width = 54.0
    @ScaledMetric(relativeTo: .body) private var height = 76.0

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text(DateFormatters.weekdayShort.string(from: date))
                    .font(.caption)
                Text("\(Calendar.current.component(.day, from: date))")
                    .font(.headline)
                Circle()
                    .fill(eventsCount > 0 ? (isSelected ? Color.white : Theme.Colors.focusAccent) : .clear)
                    .frame(width: 5, height: 5)
            }
            .foregroundStyle(isSelected ? .white : Theme.Colors.textPrimary)
            .frame(width: width, height: height)
            .background {
                RoundedRectangle(cornerRadius: 16)
                    .fill(isSelected ? AnyShapeStyle(Theme.Colors.actionGradient) : AnyShapeStyle(Theme.Colors.surface))
            }
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(
                Calendar.current.isDateInToday(date) && !isSelected ? Theme.Colors.focusAccent : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityValue("\(eventsCount) eventos")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("agenda.day.\(Int(Calendar.current.startOfDay(for: date).timeIntervalSince1970))")
    }
}

// MARK: - Event card

private struct CalendarEventCard: View {
    let event: FocusEvent
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var layout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
    }

    var body: some View {
        layout {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(event.section.color)
                    .frame(width: 3, height: 34)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.timeRangeLabel)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                    if let duration = event.durationLabel {
                        Text(duration).font(.caption).foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
            }
            .frame(minWidth: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                Text(event.title)
                    .font(.body.weight(.medium))
                    .strikethrough(event.status == .done)
                if let subtitle = event.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
                if let location = event.location, !location.isEmpty {
                    Label(location, systemImage: "mappin")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if event.status == .done {
                    Label("Completado", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.secondary)
                }
                if event.effectiveSource == .apple {
                    Text("Calendario del iPhone").font(.caption).foregroundStyle(.secondary)
                } else if let offsets = event.reminderOffsets, !offsets.isEmpty {
                    Label(offsets.map { $0 == 0 ? "A la hora" : "\($0) min antes" }.joined(separator: " · "), systemImage: "bell")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Theme.Colors.textPrimary)
        .multilineTextAlignment(.leading)
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityHint(event.effectiveSource == .apple ? "Abre Calendario del iPhone" : "Editar evento")
    }
}

// MARK: - Sheet de nuevo evento (reusable desde Nova/Mi Día)

struct NuevoEventoSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let original: FocusEvent?
    let onSave: (FocusEvent) -> Bool
    @State private var title: String
    @State private var location: String
    @State private var notes: String
    @State private var startTime: Date
    @State private var endTime: Date
    @State private var hasEndTime: Bool
    @State private var section: EventSection
    @State private var reminder: Int
    @State private var saveError: String?

    init(initialDate: Date, onSave: @escaping (FocusEvent) -> Bool) {
        self.init(original: nil, initialDate: initialDate, onSave: onSave)
    }

    init(editing event: FocusEvent, onSave: @escaping (FocusEvent) -> Bool) {
        self.init(original: event, initialDate: event.startTime, onSave: onSave)
    }

    private init(original: FocusEvent?, initialDate: Date, onSave: @escaping (FocusEvent) -> Bool) {
        self.original = original
        self.onSave = onSave
        let calendar = Calendar.current
        let now = Date()
        let defaultStart: Date
        if calendar.isDateInToday(initialDate) {
            defaultStart = Date(timeIntervalSince1970: ceil(now.timeIntervalSince1970 / 900) * 900)
        } else {
            defaultStart = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: initialDate) ?? initialDate
        }
        let start = original?.startTime ?? defaultStart
        _title = State(initialValue: original?.title ?? "")
        _location = State(initialValue: original?.location ?? "")
        _notes = State(initialValue: original?.notes ?? "")
        _startTime = State(initialValue: start)
        _endTime = State(initialValue: original?.endTime ?? start.addingTimeInterval(3600))
        _hasEndTime = State(initialValue: original.map { $0.endTime != nil && !$0.displayAsPointInTime } ?? true)
        _section = State(initialValue: original?.section ?? .personal)
        _reminder = State(initialValue: Self.reminderSelection(original))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let saveError {
                    Section {
                        Label(saveError, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Theme.Colors.danger)
                            .accessibilityIdentifier("event.saveError")
                    }
                }
                Section("Qué tienes planeado") {
                    TextField("Título del evento", text: $title, axis: .vertical)
                        .lineLimit(1...5)
                        .accessibilityIdentifier("event.title")
                }

                Section("Cuándo") {
                    DatePicker("Inicio", selection: $startTime, displayedComponents: [.date, .hourAndMinute])
                        .accessibilityIdentifier("event.start")
                    Toggle("Hora de término", isOn: $hasEndTime)
                        .accessibilityIdentifier("event.hasEndTime")
                    if hasEndTime {
                        DatePicker("Término", selection: $endTime, displayedComponents: [.date, .hourAndMinute])
                            .accessibilityIdentifier("event.end")
                        if endTime <= startTime {
                            Text("El término debe ser después del inicio.")
                                .font(.footnote)
                                .foregroundStyle(Theme.Colors.danger)
                                .accessibilityIdentifier("event.dateError")
                        }
                    }
                }

                Section {
                    Picker("Recordatorio", selection: $reminder) {
                        Text("Sin aviso").tag(-1)
                        Text("A la hora de inicio").tag(0)
                        Text("5 minutos antes").tag(5)
                        Text("10 minutos antes").tag(10)
                        Text("15 minutos antes").tag(15)
                        Text("30 minutos antes").tag(30)
                        Text("1 hora antes").tag(60)
                        Text("1 día antes").tag(1440)
                        if let original, Self.reminderSelection(original) == -2 {
                            Text("Conservar avisos actuales").tag(-2)
                        }
                    }
                    .accessibilityIdentifier("event.reminder")
                } footer: {
                    Text("Los avisos necesitan permiso de notificaciones en este iPhone.")
                }

                Section("Detalles") {
                    Picker("Tipo", selection: $section) {
                        ForEach(EventSection.allCases) { Text($0.displayName).tag($0) }
                    }
                    .accessibilityIdentifier("event.section")
                    TextField("Ubicación (opcional)", text: $location)
                        .accessibilityIdentifier("event.location")
                    TextField("Notas (opcional)", text: $notes, axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityIdentifier("event.notes")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.Colors.background)
            .tint(Theme.Colors.focusAccent)
            .navigationTitle(original == nil ? "Nuevo evento" : "Editar evento")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .accessibilityIdentifier("event.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: save)
                        .disabled(!canSave)
                        .accessibilityIdentifier("event.save")
                }
            }
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (!hasEndTime || endTime > startTime)
    }

    private static func reminderSelection(_ event: FocusEvent?) -> Int {
        guard let event else { return -1 }
        let offsets = event.reminderOffsets ?? []
        if offsets.count > 1 { return -2 }
        if let offset = offsets.first {
            return [0, 5, 10, 15, 30, 60, 1440].contains(offset) ? offset : -2
        }
        return event.isReminder == true ? 0 : -1
    }

    private func save() {
        guard canSave else { return }
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var event = original ?? FocusEvent(title: cleaned, startTime: startTime, section: .personal)
        event.title = cleaned
        let cleanNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        event.notes = cleanNotes.isEmpty ? nil : cleanNotes
        event.location = cleanLocation.isEmpty ? nil : cleanLocation
        event.startTime = startTime
        event.section = section
        let originalHasEnd = original.map { $0.endTime != nil && !$0.displayAsPointInTime } ?? true
        if original == nil || hasEndTime != originalHasEnd || startTime != original?.startTime || (hasEndTime && endTime != original?.endTime) {
            event.endTime = hasEndTime ? endTime : nil
            event.inferredDuration = hasEndTime ? false : true
        }

        // Preserve every untouched field, including completion, links,
        // custom reminder notes, subtitle and external calendar metadata.
        if reminder != Self.reminderSelection(original) {
            event.reminderOffsets = reminder >= 0 ? [reminder] : nil
            event.reminderNotes = nil
            if reminder == -1 { event.isReminder = false }
        }
        if onSave(event) {
            dismiss()
        } else {
            saveError = "No pudimos guardar el evento. Revisa el espacio disponible e inténtalo de nuevo."
        }
    }
}

// MARK: - Month grid

/// Grilla mensual simple. 7 columnas (L-D), 5-6 filas. Cada celda muestra
/// el día y un punto cobalto si hay eventos. Tap cambia `selectedDate`.
private struct MonthGridView: View {
    let anchorDate: Date
    let eventsCount: (Date) -> Int
    let isSelected: (Date) -> Bool
    let onTapDay: (Date) -> Void

    @State private var monthOffset: Int = 0

    private var calendar: Calendar { Calendar.current }

    private var displayedMonth: Date {
        calendar.date(byAdding: .month, value: monthOffset, to: anchorDate) ?? anchorDate
    }

    private var monthYearLabel: String {
        DateFormatters.capitalizeFirst(DateFormatters.monthYear.string(from: displayedMonth))
    }

    /// Días que se muestran en la grilla: incluye días vacíos al inicio para
    /// alinear el primer día del mes con el día de la semana correspondiente
    /// (L=2 en es_ES). Devuelve nil para celdas vacías.
    private var gridDays: [Date?] {
        let comps = calendar.dateComponents([.year, .month], from: displayedMonth)
        guard let firstOfMonth = calendar.date(from: comps) else { return [] }
        let range = calendar.range(of: .day, in: .month, for: firstOfMonth) ?? 1..<2
        let daysInMonth = range.count

        // Día de la semana del primer día (1 = domingo en Calendar gregoriano,
        // pero queremos lunes-domingo). Ajustamos al estilo es-ES.
        let firstWeekday = calendar.component(.weekday, from: firstOfMonth)
        // weekday: 1=Dom, 2=Lun, 3=Mar, 4=Mié, 5=Jue, 6=Vie, 7=Sáb
        // Queremos columna 0=Lun, 1=Mar, ..., 6=Dom.
        let leadingEmpty = (firstWeekday + 5) % 7   // domingo → 6, lunes → 0

        var days: [Date?] = Array(repeating: nil, count: leadingEmpty)
        for d in 1...daysInMonth {
            if let date = calendar.date(byAdding: .day, value: d - 1, to: firstOfMonth) {
                days.append(date)
            }
        }
        // Completar hasta múltiplo de 7 para que la grilla quede pareja.
        while days.count % 7 != 0 { days.append(nil) }
        return days
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text(monthYearLabel)
                    .font(Theme.Typography.bodyBold)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Spacer()
                Button {
                    HapticManager.shared.tick()
                    monthOffset -= 1
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Theme.Colors.focusAccentSoft))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mes anterior")
                .accessibilityIdentifier("agenda.previousMonth")
                Button {
                    HapticManager.shared.tick()
                    monthOffset += 1
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Theme.Colors.focusAccentSoft))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mes siguiente")
                .accessibilityIdentifier("agenda.nextMonth")
            }

            // Encabezado de días de la semana (L M M J V S D).
            HStack(spacing: 0) {
                ForEach(Array(["L", "M", "M", "J", "V", "S", "D"].enumerated()), id: \.offset) { _, letter in
                    Text(letter)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textTertiary)
                        .frame(maxWidth: .infinity)
                }
            }

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7),
                spacing: 4
            ) {
                ForEach(Array(gridDays.enumerated()), id: \.offset) { _, day in
                    monthCell(for: day)
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.Colors.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                )
                .focusCardShadow()
        )
    }

    @ViewBuilder
    private func monthCell(for day: Date?) -> some View {
        if let day = day {
            let count = eventsCount(day)
            let selected = isSelected(day)
            let isToday = calendar.isDateInToday(day)
            Button {
                onTapDay(day)
            } label: {
                VStack(spacing: 2) {
                    Text("\(calendar.component(.day, from: day))")
                        .font(.subheadline.weight(selected || isToday ? .semibold : .regular))
                        .foregroundStyle(selected ? .white : (isToday ? Theme.Colors.focusAccent : Theme.Colors.textPrimary))
                    // Dot cuando hay eventos. Cobalto si seleccionado fondo blanco.
                    Circle()
                        .fill(count > 0 ? (selected ? Color.white : Theme.Colors.focusAccent) : Color.clear)
                        .frame(width: 4, height: 4)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected ? Theme.Colors.focusAccent : Color.clear)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
            .accessibilityValue("\(count) eventos")
            .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            Color.clear.frame(minHeight: 44)
        }
    }
}
