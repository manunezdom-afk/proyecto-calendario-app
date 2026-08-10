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
    @EnvironmentObject private var coachMarks: CoachMarksStore
    @Environment(\.openURL) private var openURL
    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var viewMode: ViewMode = .week
    @State private var showCreateEvent = false
    @State private var editingEvent: FocusEvent? = nil

    /// Eventos a mostrar para el día seleccionado.
    /// - Si tiene eventos reales → los muestra (logueado o demo).
    /// - Si NO tiene eventos Y está en modo demo (no logueado) → muestra
    ///   ejemplos para ilustrar la app.
    /// - Si NO tiene eventos Y está LOGUEADO → array vacío. La cuenta real
    ///   NUNCA debe mostrar eventos demo falsos como si fueran del usuario.
    private var displayEvents: [FocusEvent] {
        // Con eventos propios O del calendario del iPhone → los reales
        // (eventsFor ya mergea ambos). Demo solo cuando no hay nada real.
        if store.hasUserEvents || !store.systemEvents.isEmpty {
            return store.eventsFor(date: selectedDate)
        }
        guard store.isInDemoMode else { return [] }
        let cal = Calendar.current
        return DemoDataProvider.shared.exampleWeekEvents()
            .filter { cal.isDate($0.startTime, inSameDayAs: selectedDate) }
            .sorted { $0.startTime < $1.startTime }
    }

    private var showingExamples: Bool {
        !store.hasUserEvents && store.systemEvents.isEmpty && store.isInDemoMode
    }

    /// Cuenta eventos para un día dado (para el dot indicator).
    private func eventsCount(for date: Date) -> Int {
        let cal = Calendar.current
        if store.hasUserEvents || !store.systemEvents.isEmpty {
            return store.eventsFor(date: date).count
        }
        guard store.isInDemoMode else { return 0 }
        return DemoDataProvider.shared.exampleWeekEvents()
            .filter { cal.isDate($0.startTime, inSameDayAs: date) }.count
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Theme 2.0 v4: mismo ambient canvas animado que Mi Día y
                // Nova. Estado .idle — Calendario no tiene flow de IA
                // activo. Coherencia visual cruzando tabs.
                FocusAmbientCanvas(state: .idle)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                        header
                            .padding(.horizontal, Theme.Spacing.xl)
                            // `.lg` consistente con Mi Día/Ajustes/Nova —
                            // aire respecto al notch/Dynamic Island.
                            .padding(.top, Theme.Spacing.lg)

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
            .sheet(isPresented: $showCreateEvent) {
                NuevoEventoSheet(initialDate: selectedDate) { newEvent in
                    store.addEvent(newEvent)
                    toast.success("Evento creado")
                    selectedDate = Calendar.current.startOfDay(for: newEvent.startTime)
                }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.Colors.background)
            }
            .sheet(item: $editingEvent) { event in
                NuevoEventoSheet(editing: event) { updated in
                    store.updateEvent(updated)
                    toast.success("Evento actualizado")
                    selectedDate = Calendar.current.startOfDay(for: updated.startTime)
                }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.Colors.background)
            }
            // Coach mark de Calendario la primera vez que el usuario llega
            // a esta tab. `.task(id: nav.selectedTab)` se redispara cada
            // vez que el usuario cambia de tab — el guard interno asegura
            // que solo presente cuando realmente entró acá.
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
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    coachMarks.presentIfNeeded(.calendar)
                }
            }
        }
    }

    // MARK: - Mode picker

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach(ViewMode.allCases) { mode in
                modePickerButton(mode)
            }
        }
        .padding(3)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.Colors.surfaceHigh)
        )
    }

    private func modePickerButton(_ mode: ViewMode) -> some View {
        let isSelected = viewMode == mode
        return Button {
            HapticManager.shared.tick()
            withAnimation(.easeInOut(duration: 0.20)) {
                viewMode = mode
            }
        } label: {
            Text(mode.label)
                .font(Theme.Typography.subheadEmphasized)
                .foregroundStyle(isSelected ? Theme.Colors.textPrimary : Theme.Colors.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .fill(isSelected ? Theme.Colors.surface : Color.clear)
                        .focusCardShadow()
                )
        }
        .buttonStyle(.plain)
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

    private var header: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: 6) {
                // Theme 2.0: meta-label en captionMono UPPERCASE (coherente
                // con badges del timeline y headers de Mi Día).
                Text(monthYearLabel)
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.textTertiary)
                    .textCase(.uppercase)
                Text("Calendario")
                    .font(Theme.Typography.displayHero)
                    .tracking(Theme.Tracking.displayHero)
                    .foregroundStyle(Theme.Colors.textPrimary)
            }
            Spacer()
            addButton
                .padding(.top, 8)
        }
    }

    private var addButton: some View {
        Button {
            HapticManager.shared.tap()
            showCreateEvent = true
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                // Theme 2.0: focusDeepGradient + sombra cobalto más intensa.
                .background(
                    Circle()
                        .fill(Theme.Colors.focusDeepGradient)
                        .shadow(color: Theme.Colors.focusAccent.opacity(0.40), radius: 14, x: 0, y: 5)
                )
                .overlay(
                    Circle().strokeBorder(Color.white.opacity(0.20), lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Nuevo evento")
    }

    private var monthYearLabel: String {
        DateFormatters.capitalizeFirst(DateFormatters.monthYear.string(from: selectedDate))
    }

    // MARK: - Day detail

    private var dateDetailHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
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

    /// Resumen del día: "6 eventos · 5h 30m ocupadas" — diferencia
    /// el Calendario de Mi Día dando contexto cuantitativo.
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
        return "\(eventStr) · \(timeStr) ocupadas"
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
                    let isDemoEvent = showingExamples
                    // Los del calendario del iPhone son read-only: sin
                    // swipe-delete ni editar (Focus no escribe en EventKit).
                    let isSystemEvent = event.effectiveSource == .apple
                    SwipeToDelete(enabled: !isDemoEvent && !isSystemEvent) {
                        store.deleteEvent(event.id)
                        toast.success("Evento eliminado", symbol: "trash.fill")
                    } content: {
                        CalendarEventCard(event: event)
                    }
                    // Long-press → Editar / Eliminar. Igual que Mi Día,
                    // funciona en cualquier vista (Día/Semana/Mes) porque
                    // todas comparten `dayContent`. Solo se desactiva
                    // cuando estamos mostrando eventos de demostración.
                    .contextMenu {
                        if isSystemEvent {
                            Button {
                                if let url = URL(string: "calshow:\(event.startTime.timeIntervalSinceReferenceDate)") {
                                    openURL(url)
                                }
                            } label: {
                                Label("Abrir en Calendario", systemImage: "arrow.up.forward.app")
                            }
                        } else if !isDemoEvent {
                            Button {
                                editingEvent = event
                            } label: {
                                Label("Editar", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                store.deleteEvent(event.id)
                                toast.success("Evento eliminado", symbol: "trash.fill")
                            } label: {
                                Label("Eliminar", systemImage: "trash")
                            }
                        }
                    }
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

    /// Theme 2.0: si el día representa "hoy" pero NO está seleccionado,
    /// recibe un ring sutil cobalto + dot indicador — el usuario ubica
    /// el presente sin tener que contar pills.
    private var isToday: Bool {
        Calendar.current.isDateInToday(date)
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text(weekdayShort)
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(isSelected ? .white : Theme.Colors.textTertiary)
                Text("\(dayNumber)")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(isSelected ? .white : Theme.Colors.textPrimary)
                Circle()
                    .fill(eventsCount > 0
                          ? (isSelected ? Color.white.opacity(0.85) : Theme.Colors.focusAccent)
                          : Color.clear)
                    .frame(width: 5, height: 5)
            }
            .frame(width: 50, height: 72)
            // Theme 2.0: selected → focusDeepGradient (no sólido) + sombra
            // contextual. isToday no-selected → ring focusAccent 0.55 +
            // glow cobalto sutil. Resto → surface plano + borderHairline.
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(
                        isSelected
                            ? AnyShapeStyle(Theme.Colors.focusDeepGradient)
                            : AnyShapeStyle(Theme.Colors.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                            .strokeBorder(
                                isSelected
                                    ? Color.clear
                                    : (isToday
                                        ? Theme.Colors.focusAccent.opacity(0.55)
                                        : Theme.Colors.borderHairline),
                                lineWidth: isToday && !isSelected ? 1.2 : Theme.Stroke.hairline
                            )
                    )
                    .shadow(
                        color: isSelected
                            ? Theme.Colors.focusAccent.opacity(0.32)
                            : (isToday
                                ? Theme.Colors.focusAccent.opacity(0.18)
                                : Theme.Colors.cardShadow),
                        radius: isSelected ? 14 : (isToday ? 8 : 6),
                        x: 0,
                        y: isSelected ? 6 : 3
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var weekdayShort: String {
        DateFormatters.weekdayShort.string(from: date).uppercased()
    }

    private var dayNumber: Int {
        Calendar.current.component(.day, from: date)
    }
}

// MARK: - Event card

private struct CalendarEventCard: View {
    let event: FocusEvent

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(event.timeRangeLabel)
                    .font(Theme.Typography.timestamp)
                    .foregroundStyle(Theme.Colors.textPrimary)
                if let dur = event.durationLabel {
                    Text(dur)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textTertiary)
                }
            }
            .frame(width: 80, alignment: .leading)

            Rectangle()
                .fill(event.section.color)
                .frame(width: 3)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 3) {
                // Chip de origen para eventos del calendario del iPhone
                // (read-only) — paridad con TimelineEventRow en Mi Día.
                if event.effectiveSource == .apple {
                    HStack(spacing: 3) {
                        Image(systemName: "iphone")
                            .font(.system(size: 8, weight: .semibold))
                        Text("IPHONE")
                            .font(Theme.Typography.captionMono)
                            .tracking(Theme.Tracking.captionMono)
                    }
                    .foregroundStyle(Theme.Colors.textTertiary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Theme.Colors.surfaceHigh))
                }
                Text(event.title)
                    .font(Theme.Typography.bodyEmphasized)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                // Subtítulo / detalle (ej. "Llevar la pelota") dentro de la
                // misma card, debajo del título — paridad con TimelineEventRow
                // en Mi Día. Antes el Calendario solo mostraba el título y el
                // contexto del evento se perdía.
                if let subtitle = event.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                // Solo ubicación si hay. Notes/descripción quedan para detalle.
                // Tap → ComingSoonSheet anticipando Maps/Waze.
                if let loc = event.location, !loc.isEmpty {
                    LocationLabel(location: loc)
                }
            }

            Spacer()
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
}

// MARK: - Sheet de nuevo evento (reusable desde Nova/Mi Día)

struct NuevoEventoSheet: View {
    @Environment(\.dismiss) private var dismiss
    /// Si está editando, conservamos el id + flags para hacer update en vez
    /// de insert.
    private let editingId: UUID?
    private let editingIsReminder: Bool?
    private let editingDisplayAsPoint: Bool?
    let onSave: (FocusEvent) -> Void

    @State private var title: String = ""
    @State private var location: String = ""
    @State private var notes: String = ""
    @State private var date: Date
    @State private var startTime: Date
    @State private var endTime: Date
    @State private var section: EventSection = .reunion

    /// Inicializador de "nuevo evento": prefija fecha y deja título vacío.
    init(initialDate: Date, onSave: @escaping (FocusEvent) -> Void) {
        self.editingId = nil
        self.editingIsReminder = nil
        self.editingDisplayAsPoint = nil
        self.onSave = onSave
        let cal = Calendar.current
        let baseDay = cal.startOfDay(for: initialDate)
        let nextHour = cal.date(bySettingHour: max(9, cal.component(.hour, from: Date()) + 1), minute: 0, second: 0, of: baseDay) ?? baseDay
        let oneHourLater = cal.date(byAdding: .hour, value: 1, to: nextHour) ?? nextHour
        _date = State(initialValue: baseDay)
        _startTime = State(initialValue: nextHour)
        _endTime = State(initialValue: oneHourLater)
    }

    /// Inicializador de "editar evento": precarga todos los campos del evento
    /// y conserva su id para que `onSave` produzca un update.
    init(editing event: FocusEvent, onSave: @escaping (FocusEvent) -> Void) {
        self.editingId = event.id
        self.editingIsReminder = event.isReminder
        self.editingDisplayAsPoint = event.displayAsPointInTime ? true : nil
        self.onSave = onSave
        let cal = Calendar.current
        let baseDay = cal.startOfDay(for: event.startTime)
        _title = State(initialValue: event.title)
        _location = State(initialValue: event.location ?? "")
        _notes = State(initialValue: event.notes ?? "")
        _date = State(initialValue: baseDay)
        _startTime = State(initialValue: event.startTime)
        _endTime = State(initialValue: event.endTime ?? cal.date(byAdding: .hour, value: 1, to: event.startTime) ?? event.startTime)
        _section = State(initialValue: event.section)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.background.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: Theme.Spacing.xl) {
                        sheetField(label: "TÍTULO") {
                            TextField("Clase, foco, reunión…", text: $title, axis: .vertical)
                                .font(Theme.Typography.headline)
                                .foregroundStyle(Theme.Colors.textPrimary)
                                .tint(Theme.Colors.focusAccent)
                                .lineLimit(1...3)
                        }

                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            Text("DÍA").sectionLabelStyle()
                            DatePicker("", selection: $date, displayedComponents: .date)
                                .datePickerStyle(.compact)
                                .labelsHidden()
                                .tint(Theme.Colors.focusAccent)
                                .padding(Theme.Spacing.md)
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                        .fill(Theme.Colors.surface)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                                .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                                        )
                                )
                        }

                        HStack(spacing: Theme.Spacing.md) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Text("INICIO").sectionLabelStyle()
                                DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute)
                                    .datePickerStyle(.compact)
                                    .labelsHidden()
                                    .tint(Theme.Colors.focusAccent)
                                    .padding(Theme.Spacing.md)
                                    .background(
                                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                            .fill(Theme.Colors.surface)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                                    .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                                            )
                                    )
                            }
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Text("FIN").sectionLabelStyle()
                                DatePicker("", selection: $endTime, displayedComponents: .hourAndMinute)
                                    .datePickerStyle(.compact)
                                    .labelsHidden()
                                    .tint(Theme.Colors.focusAccent)
                                    .padding(Theme.Spacing.md)
                                    .background(
                                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                            .fill(Theme.Colors.surface)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                                    .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                                            )
                                    )
                            }
                        }

                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            Text("TIPO").sectionLabelStyle()
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: Theme.Spacing.sm) {
                                    ForEach(EventSection.allCases) { s in
                                        sectionChip(s)
                                    }
                                }
                            }
                        }

                        // Ubicación libre: sala, oficina, link de Meet/Zoom o dirección.
                        // Por ahora se muestra como texto plano en la vista de evento.
                        // FUTURO: si el texto parece dirección física, ofrecer
                        // "Abrir en Apple Maps / Google Maps / Waze" desde el
                        // detalle del evento. No implementar acá — solo guardar el
                        // string crudo y dejar la decisión para la vista de detalle.
                        sheetField(label: "UBICACIÓN (OPCIONAL)") {
                            TextField("Sala, oficina, link o dirección…", text: $location)
                                .font(Theme.Typography.body)
                                .foregroundStyle(Theme.Colors.textPrimary)
                                .tint(Theme.Colors.focusAccent)
                        }

                        Spacer(minLength: Theme.Spacing.lg)
                    }
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, Theme.Spacing.md)
                }
            }
            .navigationTitle("Nuevo evento")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.Colors.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: save)
                        .foregroundStyle(canSave ? Theme.Colors.focusAccent : Theme.Colors.textTertiary)
                        .disabled(!canSave)
                }
            }
        }
    }

    private func sectionChip(_ s: EventSection) -> some View {
        Button {
            HapticManager.shared.tick()
            section = s
        } label: {
            HStack(spacing: 4) {
                Image(systemName: s.symbol)
                    .font(.system(size: 11, weight: .semibold))
                Text(s.displayName)
                    .font(Theme.Typography.subheadEmphasized)
            }
            .foregroundStyle(section == s ? .white : Theme.Colors.textSecondary)
            .padding(.horizontal, Theme.Spacing.md + 2)
            .padding(.vertical, Theme.Spacing.sm)
            .background(
                Capsule()
                    .fill(section == s ? s.color : Theme.Colors.surface)
                    .overlay(
                        Capsule()
                            .strokeBorder(section == s ? Color.clear : Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func sheetField<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(label).sectionLabelStyle()
            content()
                .padding(Theme.Spacing.md)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .fill(Theme.Colors.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                        )
                )
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && endTime > startTime
    }

    private func save() {
        let cal = Calendar.current
        let dayStart = cal.startOfDay(for: date)
        func combine(_ time: Date) -> Date {
            let comps = cal.dateComponents([.hour, .minute], from: time)
            return cal.date(bySettingHour: comps.hour ?? 9, minute: comps.minute ?? 0, second: 0, of: dayStart) ?? dayStart
        }
        // Si estoy editando, conservar el id original + isReminder; si no,
        // crear evento nuevo con un id fresco. Editar manualmente desde el
        // sheet implica que el usuario eligió un rango explícito → ya no
        // tratamos el evento como "point in time" salvo que fuera reminder.
        let event = FocusEvent(
            id: editingId ?? UUID(),
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes,
            startTime: combine(startTime),
            endTime: combine(endTime),
            section: section,
            location: location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : location,
            isReminder: editingIsReminder
        )
        onSave(event)
        dismiss()
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
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Theme.Colors.focusAccentSoft))
                }
                .buttonStyle(.plain)
                Button {
                    HapticManager.shared.tick()
                    monthOffset += 1
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Theme.Colors.focusAccentSoft))
                }
                .buttonStyle(.plain)
            }

            // Encabezado de días de la semana (L M M J V S D).
            HStack(spacing: 0) {
                ForEach(["L", "M", "M", "J", "V", "S", "D"], id: \.self) { letter in
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
                        .font(.system(size: 13, weight: selected || isToday ? .semibold : .regular))
                        .foregroundStyle(selected ? .white : (isToday ? Theme.Colors.focusAccent : Theme.Colors.textPrimary))
                    // Dot cuando hay eventos. Cobalto si seleccionado fondo blanco.
                    Circle()
                        .fill(count > 0 ? (selected ? Color.white : Theme.Colors.focusAccent) : Color.clear)
                        .frame(width: 4, height: 4)
                }
                .frame(maxWidth: .infinity, minHeight: 38)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected ? Theme.Colors.focusAccent : Color.clear)
                )
            }
            .buttonStyle(.plain)
        } else {
            Color.clear.frame(minHeight: 38)
        }
    }
}

#Preview {
    CalendarioView()
        .environmentObject(FocusDataStore())
}
