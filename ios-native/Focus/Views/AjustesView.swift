import SwiftUI
import UserNotifications
import UIKit

struct AjustesView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @EnvironmentObject private var coachMarks: CoachMarksStore
    @AppStorage("focus.v1.hasSeenOnboarding") private var hasSeenOnboarding = false
    @State private var showPersonalitySheet = false
    @State private var showResetConfirm = false
    @State private var showClearConfirm = false
    @State private var showSignOutConfirm = false
    /// Permiso de calendario denegado — alert con salto a Ajustes de iOS.
    @State private var showCalendarDeniedAlert = false
    // Eliminación de cuenta (Guideline 5.1.1(v)): alert con confirmación
    // tipeada. El error se muestra en un alert aparte para poder reintentar.
    @State private var showDeleteAccountAlert = false
    @State private var deleteConfirmText = ""
    @State private var isDeletingAccount = false
    @State private var deleteAccountError: String? = nil
    @Environment(\.openURL) private var openURL
    @State private var calendarSheet: CalendarConnectionSheet? = nil
    /// Estado del permiso de notificaciones — se refresca cuando la vista
    /// aparece y después de pedir autorización.
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.background.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxl) {
                        header
                            .padding(.horizontal, Theme.Spacing.xl)
                            // Padding superior `.lg` para mantener consistencia
                            // con Mi Día y dar aire al notch/Dynamic Island.
                            .padding(.top, Theme.Spacing.lg)

                        cuentaSection
                        sincronizacionSection
                        calendarioIphoneSection
                        novaSection
                        // Ocultas para App Review: son catálogos de features
                        // "Próximamente" (Guideline 2.1). Restaurar cuando
                        // existan de verdad (EventKit, dark mode).
                        if FocusConfig.showComingSoonSurfaces {
                            calendariosSection
                        }
                        notificacionesSection
                        if FocusConfig.showComingSoonSurfaces {
                            aparienciaSection
                        }
                        privacidadSection
                        datosLocalesSection
                        acercaSection
                        brandFooter
                            .padding(.horizontal, Theme.Spacing.xl)
                            .padding(.top, Theme.Spacing.lg)

                        Spacer(minLength: Theme.Spacing.bottomBarSafety)
                    }
                }
            }
            .task {
                await refreshNotificationStatus()
            }
            .sheet(isPresented: $showPersonalitySheet) {
                PersonalitySheet(
                    selected: store.settings.novaPersonality
                ) { personality in
                    store.updateSettings { $0.novaPersonality = personality }
                }
                .presentationDetents([.medium])
                .presentationBackground(Theme.Colors.background)
            }
            .sheet(item: $calendarSheet) { sheet in
                ComingSoonSheet(
                    title: sheet.title,
                    message: sheet.message,
                    icon: sheet.icon,
                    iconTint: sheet.tint
                )
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
            }
            .confirmationDialog(
                "Restablecer datos demo",
                isPresented: $showResetConfirm,
                titleVisibility: .visible
            ) {
                Button("Restablecer", role: .destructive) {
                    store.resetToDemoState()
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Vuelves al estado inicial con datos de ejemplo. Tus tareas, eventos y conversación con Nova creados se borran de este iPhone.")
            }
            .confirmationDialog(
                "Borrar datos locales",
                isPresented: $showClearConfirm,
                titleVisibility: .visible
            ) {
                Button("Borrar todo", role: .destructive) {
                    store.clearAllLocalData()
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Elimina TODOS los datos locales: tareas, eventos, sugerencias, conversación de Nova y ajustes. La próxima vez que abras la app, vuelven los datos de ejemplo.")
            }
            .confirmationDialog(
                "Cerrar sesión",
                isPresented: $showSignOutConfirm,
                titleVisibility: .visible
            ) {
                Button("Cerrar sesión", role: .destructive) {
                    auth.signOut()
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Vas a salir de tu cuenta. Tus datos locales en este iPhone no se borran.")
            }
            .alert("¿Eliminar tu cuenta?", isPresented: $showDeleteAccountAlert) {
                TextField("Escribe ELIMINAR", text: $deleteConfirmText)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                Button("Eliminar definitivamente", role: .destructive) {
                    let typed = deleteConfirmText
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .uppercased()
                    deleteConfirmText = ""
                    if typed == "ELIMINAR" {
                        Task { await performDeleteAccount() }
                    } else {
                        // Validación al confirmar (no .disabled dinámico):
                        // los botones de alert no siempre re-evalúan estado
                        // del TextField de forma confiable.
                        deleteAccountError = "Para confirmar, escribe ELIMINAR tal cual."
                    }
                }
                Button("Cancelar", role: .cancel) { deleteConfirmText = "" }
            } message: {
                Text("Borra tu cuenta y todos tus datos del servidor de forma inmediata e irreversible. Los datos locales de este iPhone también se eliminan.")
            }
            .alert(
                "Eliminar cuenta",
                isPresented: Binding(
                    get: { deleteAccountError != nil },
                    set: { if !$0 { deleteAccountError = nil } }
                )
            ) {
                Button("Entendido", role: .cancel) { deleteAccountError = nil }
            } message: {
                Text(deleteAccountError ?? "")
            }
            .alert("Permiso de calendario", isPresented: $showCalendarDeniedAlert) {
                Button("Abrir Ajustes") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                }
                Button("Ahora no", role: .cancel) {}
            } message: {
                Text("Focus no tiene acceso a tu calendario. Actívalo en Ajustes del iPhone → Focus → Calendarios para ver tus eventos aquí.")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Ajustes")
                .font(Theme.Typography.displayHero)
                .tracking(Theme.Tracking.displayHero)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("Tu cuenta, tu Nova, tus notificaciones.")
                .font(Theme.Typography.body)
                .tracking(Theme.Tracking.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    // MARK: - Sincronización (Bloque 3 — Supabase events/tasks)

    private var sincronizacionSection: some View {
        settingsSection(title: "Sincronización") {
            VStack(spacing: 0) {
                AjustesRow(
                    symbol: syncSymbol,
                    tint: syncTint,
                    title: syncTitle,
                    subtitle: syncSubtitle,
                    trailing: .nothing
                )
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                Button {
                    HapticManager.shared.tap()
                    Task { await store.fetchRemoteAndMerge() }
                } label: {
                    AjustesRow(
                        symbol: "arrow.triangle.2.circlepath",
                        tint: Theme.Colors.focusAccent,
                        title: "Sincronizar ahora",
                        subtitle: syncActionSubtitle,
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)
                .disabled(!canSyncManually)
                .opacity(canSyncManually ? 1.0 : 0.5)
            }
            .focusCardContainer()
        }
    }

    private var syncSymbol: String {
        switch store.syncState {
        case .demo:        return "iphone.gen3"
        case .loggedOut:   return "iphone.gen3"
        case .idle:        return "checkmark.icloud"
        case .syncing:     return "arrow.triangle.2.circlepath"
        case .error:       return "exclamationmark.icloud"
        }
    }

    private var syncTint: Color {
        switch store.syncState {
        case .demo, .loggedOut: return Theme.Colors.textTertiary
        case .idle:             return Theme.Colors.success
        case .syncing:          return Theme.Colors.focusAccent
        case .error:            return Theme.Colors.warning
        }
    }

    private var syncTitle: String {
        switch store.syncState {
        case .demo:        return "Modo demo"
        case .loggedOut:   return "Sin sesión"
        case .idle:        return "Sincronizado"
        case .syncing:     return "Sincronizando…"
        case .error:       return "No se pudo sincronizar"
        }
    }

    private var syncSubtitle: String {
        switch store.syncState {
        case .demo:
            return "Solo en este iPhone. Inicia sesión para sincronizar."
        case .loggedOut:
            return "Sesión cerrada. Tus datos siguen en este iPhone."
        case .idle:
            if let date = store.lastSyncAt {
                return "Última sync: \(DateFormatters.hourMinute.string(from: date))"
            }
            return "Datos al día con Supabase."
        case .syncing:
            return "Subiendo cambios locales…"
        case .error(let msg):
            return msg
        }
    }

    private var syncActionSubtitle: String {
        if !canSyncManually {
            return "Inicia sesión para sincronizar."
        }
        return "Fuerza fetch + upload contra Supabase."
    }

    private var canSyncManually: Bool {
        store.syncCredentials != nil
    }

    // MARK: - Cuenta

    private var cuentaSection: some View {
        settingsSection(title: "Cuenta") {
            VStack(spacing: 0) {
                if auth.isLoggedIn {
                    AjustesRow(
                        symbol: "person.crop.circle.fill",
                        tint: Theme.Colors.focusAccent,
                        title: auth.displayName,
                        // Si hay nombre real (Google name / metadata),
                        // mostramos el email pequeño debajo como subtitle.
                        // Si NO hay nombre, el title ya ES el email — el
                        // subtitle pasa a "Sesión iniciada" como antes.
                        subtitle: auth.hasRealName
                            ? (auth.currentEmail ?? "")
                            : "Sesión iniciada",
                        trailing: .badge("Activa", Theme.Colors.success)
                    )
                    Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    Button {
                        HapticManager.shared.tap()
                        showSignOutConfirm = true
                    } label: {
                        AjustesRow(
                            symbol: "rectangle.portrait.and.arrow.right",
                            tint: Theme.Colors.danger,
                            title: "Cerrar sesión",
                            subtitle: "Tus datos locales no se borran.",
                            trailing: .chevron
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    AjustesRow(
                        symbol: "person.crop.circle",
                        tint: Theme.Colors.textSecondary,
                        title: "Modo demo",
                        subtitle: "Sin sesión. Tus datos viven solo en este iPhone.",
                        trailing: .nothing
                    )
                    Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    Button {
                        HapticManager.shared.tap()
                        auth.exitDemo()
                    } label: {
                        AjustesRow(
                            symbol: "key.fill",
                            tint: Theme.Colors.focusAccent,
                            title: "Iniciar sesión",
                            subtitle: "Guarda tus datos en la nube y sincroniza entre dispositivos.",
                            trailing: .chevron
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .focusCardContainer()
        }
    }

    // MARK: - Plan

    private var planSection: some View {
        settingsSection(title: "Plan") {
            VStack(spacing: 0) {
                AjustesRow(
                    symbol: "sparkles",
                    tint: Theme.Colors.novaAccent,
                    title: auth.isLoggedIn ? "Early Access" : "Modo demo",
                    subtitle: auth.isLoggedIn
                        ? "Estás probando Focus pre-lanzamiento."
                        : "Tus datos viven solo en este iPhone.",
                    trailing: .nothing
                )
            }
            .focusCardContainer()
        }
    }

    // MARK: - Nova

    private var novaSection: some View {
        settingsSection(title: "Nova") {
            VStack(spacing: 0) {
                Button {
                    HapticManager.shared.tap()
                    showPersonalitySheet = true
                } label: {
                    AjustesRow(
                        symbol: "bubble.left.and.bubble.right",
                        tint: Theme.Colors.novaAccent,
                        title: "Personalidad",
                        subtitle: store.settings.novaPersonality.displayName,
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                AjustesRow(
                    symbol: "brain",
                    tint: Theme.Colors.novaAccent,
                    title: "Memoria",
                    subtitle: "Nova recuerda tus preferencias.",
                    trailing: .toggle(Binding(
                        get: { store.settings.novaMemoryEnabled },
                        set: { v in store.updateSettings { $0.novaMemoryEnabled = v } }
                    ))
                )

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                NavigationLink {
                    NovaMemoryListView()
                } label: {
                    AjustesRow(
                        symbol: "list.bullet.rectangle",
                        tint: Theme.Colors.novaAccent,
                        title: "Lo que Nova recuerda",
                        subtitle: "Revisa y borra memorias guardadas",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                AjustesRow(
                    symbol: "mic",
                    tint: Theme.Colors.novaAccent,
                    title: "Voz",
                    subtitle: "Habla con Nova en lugar de escribir.",
                    trailing: .toggle(Binding(
                        get: { store.settings.novaVoiceEnabled },
                        set: { v in store.updateSettings { $0.novaVoiceEnabled = v } }
                    ))
                )

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                NavigationLink {
                    NovaInboxView()
                } label: {
                    AjustesRow(
                        symbol: "tray.full",
                        tint: Theme.Colors.novaAccent,
                        title: "Bandeja de Nova",
                        subtitle: "\(store.pendingDisplaySuggestions.count) sugerencias pendientes",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)
            }
            .focusCardContainer()
        }
    }

    // MARK: - Calendarios conectados

    /// Lista de integraciones futuras. Todas abren un `ComingSoonSheet`
    /// honesto hasta que C5+ implemente la integración real (OAuth Google,
    /// EventKit Apple, parser .ics). Diseñadas para no parecer botones
    /// muertos: cada una explica qué va a poder hacer.
    private var calendariosSection: some View {
        settingsSection(title: "Calendarios conectados") {
            VStack(spacing: 0) {
                calendarRow(
                    symbol: "applelogo",
                    tint: Theme.Colors.textSecondary,
                    title: "Apple Calendar",
                    subtitle: "Importar eventos del calendario del sistema.",
                    sheet: CalendarConnectionSheet(
                        title: "Apple Calendar",
                        message: "Próximamente podrás traer tus eventos desde el calendario del iPhone usando EventKit. Nova los va a leer para sugerirte mejores bloques de foco.",
                        icon: "applelogo",
                        tint: Theme.Colors.textSecondary
                    )
                )
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                calendarRow(
                    symbol: "g.circle.fill",
                    tint: Color(red: 0.259, green: 0.522, blue: 0.957),
                    title: "Google Calendar",
                    subtitle: "Sincronizar agenda con tu cuenta Google.",
                    sheet: CalendarConnectionSheet(
                        title: "Google Calendar",
                        message: "Próximamente podrás conectar tu cuenta de Google con OAuth. Focus va a leer tus eventos y, si quieres, escribir los bloques de foco de vuelta.",
                        icon: "g.circle.fill",
                        tint: Color(red: 0.259, green: 0.522, blue: 0.957)
                    )
                )
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                calendarRow(
                    symbol: "doc.text.fill",
                    tint: Theme.Colors.focusAccent,
                    title: "Archivo .ics",
                    subtitle: "Importar/exportar archivos de calendario.",
                    sheet: CalendarConnectionSheet(
                        title: "Archivo .ics",
                        message: "Próximamente podrás importar un .ics (formato estándar de calendario) o exportar tu agenda como .ics para abrirla en cualquier otra app.",
                        icon: "doc.text.fill",
                        tint: Theme.Colors.focusAccent
                    )
                )
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                calendarRow(
                    symbol: "map.fill",
                    tint: Theme.Colors.warning,
                    title: "Ubicaciones (Maps / Waze)",
                    subtitle: "Abrir ubicaciones de eventos en mapas.",
                    sheet: CalendarConnectionSheet(
                        title: "Abrir ubicaciones",
                        message: "Más adelante podrás abrir las ubicaciones de tus eventos en Apple Maps, Google Maps o Waze con un tap. Por ahora la ubicación se guarda como texto.",
                        icon: "map.fill",
                        tint: Theme.Colors.warning
                    )
                )
            }
            .focusCardContainer()
        }
    }

    private func calendarRow(
        symbol: String,
        tint: Color,
        title: String,
        subtitle: String,
        sheet: CalendarConnectionSheet
    ) -> some View {
        Button {
            HapticManager.shared.tap()
            calendarSheet = sheet
        } label: {
            AjustesRow(
                symbol: symbol,
                tint: tint,
                title: title,
                subtitle: subtitle,
                trailing: .chevron
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Notificaciones

    private var notificacionesSection: some View {
        settingsSection(
            title: "Notificaciones",
            footer: "Focus usa notificaciones locales para recordarte eventos y tareas en este iPhone. No hay push remoto todavía."
        ) {
            VStack(spacing: 0) {
                // Estado real del permiso del sistema — la primera fila es la
                // que importa. Las demás filas son configuración aspiracional
                // (resumen / sugerencias) que sigue como toggle visual hasta
                // que se implemente realmente.
                permissionRow
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                AjustesRow(
                    symbol: "bell.fill",
                    tint: Theme.Colors.warning,
                    title: "Recordatorios",
                    subtitle: "Avísame en la hora del evento.",
                    trailing: .toggle(Binding(
                        get: { store.settings.remindersEnabled },
                        set: { v in store.updateSettings { $0.remindersEnabled = v } }
                    ))
                )
                // Resumen diario y Sugerencias inteligentes: toggles de
                // features que aún no existen — ocultos para App Review
                // (Guideline 2.1). Los settings persisten, así que al
                // restaurarlos vuelven con el valor que el usuario dejó.
                if FocusConfig.showComingSoonSurfaces {
                    Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    AjustesRow(
                        symbol: "sun.max.fill",
                        tint: Theme.Colors.warning,
                        title: "Resumen diario",
                        subtitle: "Cada mañana, tu día de un vistazo (próximamente).",
                        trailing: .toggle(Binding(
                            get: { store.settings.dailySummaryEnabled },
                            set: { v in store.updateSettings { $0.dailySummaryEnabled = v } }
                        ))
                    )
                    Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    AjustesRow(
                        symbol: "sparkles",
                        tint: Theme.Colors.novaAccent,
                        title: "Sugerencias inteligentes",
                        subtitle: "Nova te avisa cuando detecta algo útil (próximamente).",
                        trailing: .toggle(Binding(
                            get: { store.settings.smartSuggestionsEnabled },
                            set: { v in store.updateSettings { $0.smartSuggestionsEnabled = v } }
                        ))
                    )
                }
            }
            .focusCardContainer()
        }
    }

    /// Row dinámico según el estado del permiso de notificaciones del iPhone.
    /// - `.authorized` / `.provisional` / `.ephemeral` → muestra "Activadas".
    /// - `.notDetermined` → botón "Activar" que dispara `requestAuthorization`.
    /// - `.denied` → mensaje claro + botón "Abrir Ajustes del iPhone".
    @ViewBuilder
    private var permissionRow: some View {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral:
            AjustesRow(
                symbol: "checkmark.seal.fill",
                tint: Theme.Colors.success,
                title: "Permiso del iPhone",
                subtitle: "Activadas. Focus puede avisarte.",
                trailing: .nothing
            )
        case .notDetermined:
            Button {
                Task {
                    HapticManager.shared.tap()
                    _ = await LocalNotificationService.shared.requestAuthorization()
                    await refreshNotificationStatus()
                    // Si el usuario aceptó y hay recordatorios futuros,
                    // los programamos ahora.
                    if notificationStatus == .authorized && store.settings.remindersEnabled {
                        store.bootstrapLocalNotifications()
                    }
                }
            } label: {
                AjustesRow(
                    symbol: "bell.badge.fill",
                    tint: Theme.Colors.focusAccent,
                    title: "Permiso del iPhone",
                    subtitle: "Aún no solicitadas. Toca para activarlas.",
                    trailing: .nothing
                )
            }
            .buttonStyle(.plain)
        case .denied:
            Button {
                HapticManager.shared.tap()
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            } label: {
                AjustesRow(
                    symbol: "bell.slash.fill",
                    tint: Theme.Colors.warning,
                    title: "Permiso del iPhone",
                    subtitle: "Denegadas. Toca para abrir Ajustes del iPhone.",
                    trailing: .nothing
                )
            }
            .buttonStyle(.plain)
        @unknown default:
            AjustesRow(
                symbol: "bell.fill",
                tint: Theme.Colors.textTertiary,
                title: "Permiso del iPhone",
                subtitle: "Estado desconocido.",
                trailing: .nothing
            )
        }
    }

    /// Refresca el estado del permiso desde UNUserNotificationCenter.
    private func refreshNotificationStatus() async {
        let status = await LocalNotificationService.shared.currentStatus()
        await MainActor.run {
            self.notificationStatus = status
        }
    }

    // MARK: - Apariencia

    private var aparienciaSection: some View {
        settingsSection(title: "Apariencia") {
            VStack(spacing: 0) {
                ForEach(Array(AppearancePreference.allCases.enumerated()), id: \.element) { idx, pref in
                    Button {
                        HapticManager.shared.tick()
                        store.updateSettings { $0.appearance = pref }
                    } label: {
                        AjustesRow(
                            symbol: appearanceSymbol(pref),
                            tint: Theme.Colors.focusAccent,
                            title: pref.displayName,
                            subtitle: appearanceSubtitle(pref),
                            trailing: store.settings.appearance == pref ? .check : .nothing
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(pref == .dark)
                    .opacity(pref == .dark ? 0.45 : 1)
                    if idx < AppearancePreference.allCases.count - 1 {
                        Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    }
                }
            }
            .focusCardContainer()
        }
    }

    private func appearanceSymbol(_ pref: AppearancePreference) -> String {
        switch pref {
        case .system: return "circle.righthalf.filled"
        case .dark: return "moon.fill"
        case .light: return "sun.max"
        }
    }

    private func appearanceSubtitle(_ pref: AppearancePreference) -> String {
        switch pref {
        case .system: return "Sigue lo que use tu iPhone."
        case .light: return "Claro siempre."
        case .dark: return "Oscuro próximamente."
        }
    }

    // MARK: - Privacidad

    /// True solo con sesión real (no demo) — gatea la fila de eliminar cuenta.
    private var isLoggedInWithAccount: Bool {
        if case .loggedIn = auth.state { return true }
        return false
    }

    // MARK: - Calendario del iPhone (EventKit, read-only)

    private var calendarioIphoneSubtitle: String {
        if store.settings.systemCalendarOn {
            return "Tus eventos del iPhone se muestran junto a los de Focus. Solo lectura."
        }
        if SystemCalendarService.shared.isDenied {
            return "Permiso denegado. Actívalo en Ajustes del iPhone → Focus → Calendarios."
        }
        return "Ve tus eventos de iCloud, Google u Outlook dentro de Focus. Solo lectura."
    }

    private var calendarioIphoneSection: some View {
        settingsSection(title: "Calendario del iPhone") {
            VStack(spacing: 0) {
                AjustesRow(
                    symbol: "calendar",
                    tint: Theme.Colors.focusAccent,
                    title: "Mostrar eventos del iPhone",
                    subtitle: calendarioIphoneSubtitle,
                    trailing: .toggle(Binding(
                        get: { store.settings.systemCalendarOn },
                        set: { handleSystemCalendarToggle($0) }
                    ))
                )
            }
            .focusCardContainer()
        }
    }

    /// ON → pide permiso si falta y recién ahí persiste el setting (el
    /// toggle solo queda encendido si el permiso se concedió). OFF →
    /// persiste y vacía los eventos del sistema al instante.
    private func handleSystemCalendarToggle(_ on: Bool) {
        if !on {
            store.updateSettings { $0.showSystemCalendar = false }
            store.refreshSystemEvents()
            return
        }
        Task { @MainActor in
            let service = SystemCalendarService.shared
            let granted = service.isAuthorized ? true : await service.requestAccess()
            if granted {
                store.updateSettings { $0.showSystemCalendar = true }
                store.refreshSystemEvents()
            } else {
                store.updateSettings { $0.showSystemCalendar = false }
                showCalendarDeniedAlert = true
                HapticManager.shared.warning()
            }
        }
    }

    private var privacidadSection: some View {
        settingsSection(title: "Privacidad") {
            VStack(spacing: 0) {
                AjustesRow(
                    symbol: "lock.shield",
                    tint: Theme.Colors.success,
                    title: "Tus datos",
                    subtitle: isLoggedInWithAccount
                        ? "Se sincronizan con tu cuenta. Nova solo ve lo necesario para ayudarte."
                        : "En modo demo todo vive en este iPhone. Nada sale sin que lo apruebes.",
                    trailing: .nothing
                )
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                Button {
                    HapticManager.shared.tap()
                    if let url = URL(string: "https://www.usefocus.me/privacidad") {
                        openURL(url)
                    }
                } label: {
                    AjustesRow(
                        symbol: "doc.text",
                        tint: Theme.Colors.textSecondary,
                        title: "Política de privacidad",
                        subtitle: "Qué datos usamos y con quién se comparten.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)
                Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                Button {
                    HapticManager.shared.tap()
                    if let url = URL(string: "https://www.usefocus.me/terminos") {
                        openURL(url)
                    }
                } label: {
                    AjustesRow(
                        symbol: "doc.plaintext",
                        tint: Theme.Colors.textSecondary,
                        title: "Términos de Servicio",
                        subtitle: "Las reglas del servicio, en claro.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)
                // Eliminar cuenta solo aplica con sesión real: en modo demo
                // no existe cuenta que borrar (los datos locales se borran
                // desde la sección de abajo).
                if isLoggedInWithAccount {
                    Divider().overlay(Theme.Colors.border).padding(.leading, 60)
                    Button {
                        HapticManager.shared.warning()
                        showDeleteAccountAlert = true
                    } label: {
                        AjustesRow(
                            symbol: "trash",
                            tint: Theme.Colors.danger,
                            title: isDeletingAccount ? "Eliminando cuenta…" : "Eliminar cuenta",
                            subtitle: "Borra tu cuenta y todos tus datos. Irreversible.",
                            trailing: .chevron
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isDeletingAccount)
                    .opacity(isDeletingAccount ? 0.55 : 1)
                }
            }
            .focusCardContainer()
        }
    }

    /// Borra la cuenta en backend + limpia datos locales. Al terminar, el
    /// router raíz reacciona a `auth.state = .loggedOut` y vuelve a Login.
    @MainActor
    private func performDeleteAccount() async {
        guard !isDeletingAccount else { return }
        isDeletingAccount = true
        defer { isDeletingAccount = false }
        do {
            try await auth.deleteAccount()
            // La cuenta ya no existe en el backend: este iPhone no debe
            // conservar datos de una cuenta borrada.
            store.clearAllLocalData()
        } catch let err as AuthError {
            deleteAccountError = err.errorDescription ?? "No se pudo eliminar la cuenta. Inténtalo de nuevo."
            HapticManager.shared.warning()
        } catch {
            deleteAccountError = error.localizedDescription
            HapticManager.shared.warning()
        }
    }

    // MARK: - Datos locales

    private var datosLocalesSection: some View {
        settingsSection(title: "Datos locales") {
            VStack(spacing: 0) {
                Button {
                    HapticManager.shared.tap()
                    showResetConfirm = true
                } label: {
                    AjustesRow(
                        symbol: "arrow.counterclockwise.circle",
                        tint: Theme.Colors.focusAccent,
                        title: "Restablecer datos demo",
                        subtitle: "Vuelve al estado inicial con datos de ejemplo.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                Button {
                    HapticManager.shared.tap()
                    showClearConfirm = true
                } label: {
                    AjustesRow(
                        symbol: "trash",
                        tint: Theme.Colors.danger,
                        title: "Borrar datos locales",
                        subtitle: "Elimina tareas, eventos y conversación de este iPhone.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)
            }
            .focusCardContainer()
        }
    }

    // MARK: - Brand footer

    private var brandFooter: some View {
        VStack(spacing: Theme.Spacing.md) {
            FocusLogoMark(size: 56)
                .padding(.bottom, Theme.Spacing.xs)
            Text("Focus")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.Colors.textPrimary)
                .tracking(0.2)
            Text(AppVersion.displayString)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textTertiary)
            Text("Hecho para organizar tu día con Nova.")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Acerca

    private var acercaSection: some View {
        settingsSection(title: "Acerca de") {
            VStack(spacing: 0) {
                Button {
                    HapticManager.shared.tap()
                    hasSeenOnboarding = false
                } label: {
                    AjustesRow(
                        symbol: "play.rectangle",
                        tint: Theme.Colors.focusAccent,
                        title: "Ver tutorial otra vez",
                        subtitle: "Repasa el onboarding de bienvenida.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                Button {
                    HapticManager.shared.tap()
                    coachMarks.resetAll()
                    // Feedback breve: regresar a Mi Día para que el primer
                    // tip aparezca enseguida y el usuario vea el efecto.
                    nav.selectedTab = .miDia
                } label: {
                    AjustesRow(
                        symbol: "lightbulb",
                        tint: Theme.Colors.novaAccent,
                        title: "Ver consejos otra vez",
                        subtitle: "Los mini tutoriales contextuales volverán a aparecer.",
                        trailing: .chevron
                    )
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.Colors.border).padding(.leading, 60)

                AjustesRow(
                    symbol: "info.circle",
                    tint: Theme.Colors.textSecondary,
                    title: "Focus",
                    subtitle: "\(AppVersion.displayString) · Hecho para organizar tu día con Nova.",
                    trailing: .nothing
                )
            }
            .focusCardContainer()
        }
    }

    // MARK: - Helper

    private func settingsSection<Content: View>(
        title: String,
        footer: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text(title.uppercased()).sectionLabelStyle()
                .padding(.horizontal, Theme.Spacing.xl)
            content()
                .padding(.horizontal, Theme.Spacing.xl)
            if let footer {
                Text(footer)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textTertiary)
                    .padding(.horizontal, Theme.Spacing.xl)
                    .padding(.top, -Theme.Spacing.xs)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private extension View {
    // Theme 2.0: container con borderHairline en lugar de border sólido.
    // Las sections de Ajustes ahora se ven más "Linear-style".
    func focusCardContainer() -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.Colors.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                            .strokeBorder(Theme.Colors.borderHairline, lineWidth: Theme.Stroke.hairline)
                    )
                    .focusCardShadow()
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

private enum AjustesTrailing {
    case chevron
    case nothing
    case check
    case badge(String, Color)
    case toggle(Binding<Bool>)
}

private struct AjustesRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let subtitle: String?
    let trailing: AjustesTrailing

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            IconBadge(symbol: symbol, tint: tint, size: 34)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.Typography.bodyEmphasized)
                    .foregroundStyle(Theme.Colors.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textTertiary)
                        .lineLimit(2)
                }
            }

            Spacer()

            trailingView
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.md)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var trailingView: some View {
        switch trailing {
        case .chevron:
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.Colors.textTertiary)
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Colors.focusAccent)
        case .badge(let text, let color):
            // Theme 2.0: badge en captionMono UPPERCASE + tracking opinado.
            Text(text.uppercased())
                .font(Theme.Typography.captionMono)
                .tracking(Theme.Tracking.captionMono)
                .foregroundStyle(color)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(color.opacity(0.10))
                )
        case .toggle(let binding):
            // Theme 2.0: FocusToggle reemplaza UISwitch nativo. Track con
            // gradient FocusDeep cuando activo, en lugar del verde sistema.
            FocusToggle(isOn: binding)
        case .nothing:
            EmptyView()
        }
    }
}

// MARK: - Sheet de personalidad

private struct PersonalitySheet: View {
    let selected: NovaPersonality
    let onSelect: (NovaPersonality) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var local: NovaPersonality

    init(selected: NovaPersonality, onSelect: @escaping (NovaPersonality) -> Void) {
        self.selected = selected
        self.onSelect = onSelect
        _local = State(initialValue: selected)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.background.ignoresSafeArea()

                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    Text("Elige cómo te habla Nova.")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .padding(.horizontal, Theme.Spacing.xl)
                        .padding(.top, Theme.Spacing.md)

                    VStack(spacing: Theme.Spacing.sm) {
                        ForEach(NovaPersonality.allCases) { p in
                            Button {
                                HapticManager.shared.tick()
                                local = p
                                onSelect(p)
                            } label: {
                                HStack(spacing: Theme.Spacing.md) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.displayName)
                                            .font(Theme.Typography.bodyEmphasized)
                                            .foregroundStyle(Theme.Colors.textPrimary)
                                        Text(p.description)
                                            .font(Theme.Typography.subhead)
                                            .foregroundStyle(Theme.Colors.textSecondary)
                                    }
                                    Spacer()
                                    if local == p {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(Theme.Colors.focusAccent)
                                    }
                                }
                                .padding(Theme.Spacing.lg)
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                                        .fill(Theme.Colors.surface)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                                                .strokeBorder(
                                                    local == p ? Theme.Colors.focusAccent.opacity(0.45) : Theme.Colors.border,
                                                    lineWidth: Theme.Stroke.hairline
                                                )
                                        )
                                        .focusCardShadow()
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.xl)

                    Spacer()
                }
            }
            .navigationTitle("Personalidad de Nova")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.Colors.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                        .foregroundStyle(Theme.Colors.focusAccent)
                }
            }
        }
    }
}

// MARK: - Calendar connection sheet payload

/// Item identificable que dispara `ComingSoonSheet` desde las filas de
/// "Calendarios conectados". Cuando integraciones reales aterrizen (C5+),
/// estas filas pasarán a abrir su propio flujo en vez de este sheet.
struct CalendarConnectionSheet: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let icon: String
    let tint: Color
}

#Preview {
    AjustesView()
        .environmentObject(FocusDataStore())
}

// MARK: - NovaMemoryListView (inline en AjustesView.swift por pbxproj —
// archivos nuevos no se registran automáticamente y romperían el build).

/// Vista de "Mi memoria con Nova" — lista todas las memorias que Nova
/// guarda sobre el usuario (alias de personas, ramos, preferencias).
/// Permite borrar cada una con swipe.
///
/// Se accede desde Ajustes → Nova → "Lo que Nova recuerda".
struct NovaMemoryListView: View {
    /// State local — recargamos al hacer un delete porque NovaMemoryStore
    /// no es @Published. Si en el futuro lo convertimos a ObservableObject,
    /// quitamos esta capa.
    @State private var entries: [(category: NovaMemoryCategory, text: String, id: UUID)] = []
    @State private var showClearAll = false

    var body: some View {
        ZStack {
            Theme.Colors.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    Text(headerText)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .padding(.horizontal, Theme.Spacing.lg)
                        .padding(.top, Theme.Spacing.md)

                    if entries.isEmpty {
                        emptyState
                    } else {
                        ForEach(NovaMemoryCategory.allCases, id: \.self) { cat in
                            let group = entries.filter { $0.category == cat }
                            if !group.isEmpty {
                                section(for: cat, entries: group)
                            }
                        }
                    }

                    if !entries.isEmpty {
                        Button(role: .destructive) {
                            showClearAll = true
                        } label: {
                            Text("Borrar todas las memorias")
                                .font(Theme.Typography.bodyEmphasized)
                                .foregroundStyle(Theme.Colors.danger)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(
                                    RoundedRectangle(cornerRadius: 14)
                                        .fill(Theme.Colors.danger.opacity(0.08))
                                )
                        }
                        .padding(.horizontal, Theme.Spacing.lg)
                        .padding(.top, Theme.Spacing.md)
                    }
                }
                .padding(.bottom, Theme.Spacing.xxl)
            }
        }
        .navigationTitle("Lo que Nova recuerda")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { reload() }
        .alert("¿Borrar todas las memorias?", isPresented: $showClearAll) {
            Button("Cancelar", role: .cancel) { }
            Button("Borrar todo", role: .destructive) {
                NovaMemoryStore.shared.clearAll()
                reload()
                HapticManager.shared.warning()
            }
        } message: {
            Text("Esto borra todos los aliases, preferencias y reglas que Nova aprendió de ti. Esta acción no se puede deshacer.")
        }
    }

    // MARK: - Subvistas

    private var headerText: String {
        if entries.isEmpty {
            return "Cuando le cuentas cosas a Nova («Juan Pablo es mi coordinador», «teorías es Teorías de la Comunicación»), las guarda acá para entenderte mejor después."
        }
        let n = entries.count
        return "Nova recuerda \(n) cosa\(n == 1 ? "" : "s") sobre ti. Desliza una para borrarla o dile en el chat «olvida X»."
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "brain.head.profile")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Theme.Colors.textTertiary)
            Text("Sin memorias guardadas")
                .font(Theme.Typography.bodyEmphasized)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("Ejemplo: dile a Nova «mi mamá se llama Susana» y se acordará la próxima vez.")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.xxl)
    }

    private func section(
        for cat: NovaMemoryCategory,
        entries group: [(category: NovaMemoryCategory, text: String, id: UUID)]
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(label(for: cat))
                .font(Theme.Typography.captionEmphasized)
                .foregroundStyle(Theme.Colors.textTertiary)
                .padding(.horizontal, Theme.Spacing.lg)

            VStack(spacing: 0) {
                ForEach(Array(group.enumerated()), id: \.element.id) { idx, entry in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: icon(for: cat))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.Colors.novaAccent)
                            .frame(width: 22, alignment: .center)
                        Text(entry.text)
                            .font(Theme.Typography.body)
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Button {
                            NovaMemoryStore.shared.deactivate(id: entry.id)
                            reload()
                            HapticManager.shared.tick()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(Theme.Colors.textTertiary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, 12)
                    if idx < group.count - 1 {
                        Divider().overlay(Theme.Colors.border)
                            .padding(.leading, Theme.Spacing.md + 22 + 12)
                    }
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Theme.Colors.surfaceElevated)
            )
            .padding(.horizontal, Theme.Spacing.lg)
        }
    }

    // MARK: - Helpers

    private func reload() {
        entries = NovaMemoryStore.shared.allActiveMemoriesHuman(maxEntries: 100)
    }

    private func label(for cat: NovaMemoryCategory) -> String {
        switch cat {
        case .personAlias:     return "PERSONAS"
        case .courseAlias:     return "RAMOS / CURSOS"
        case .preference:      return "PREFERENCIAS"
        case .schedulingRule:  return "REGLAS DE HORARIO"
        case .appBehaviorRule: return "REGLAS DE LA APP"
        case .projectContext:  return "PROYECTOS"
        case .academicContext: return "CONTEXTO ACADÉMICO"
        }
    }

    private func icon(for cat: NovaMemoryCategory) -> String {
        switch cat {
        case .personAlias:     return "person.fill"
        case .courseAlias:     return "book.fill"
        case .preference:      return "heart.fill"
        case .schedulingRule:  return "calendar"
        case .appBehaviorRule: return "gearshape.fill"
        case .projectContext:  return "folder.fill"
        case .academicContext: return "graduationcap.fill"
        }
    }
}

