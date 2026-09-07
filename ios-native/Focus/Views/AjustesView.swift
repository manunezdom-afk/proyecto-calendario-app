import SwiftUI
import UserNotifications
import UIKit

struct AjustesView: View {
    @Environment(\.focusSignIn) private var focusSignIn
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var requestingNotifications = false
    @State private var requestingCalendar = false
    @State private var showCalendarDeniedAlert = false
    @State private var showSignOutConfirm = false
    @State private var showDeleteAccountAlert = false
    @State private var deleteConfirmText = ""
    @State private var isDeletingAccount = false
    @State private var deleteAccountError: String?
    @State private var aiConsentGranted = NovaAIConsent.granted
    @State private var showAIConsent = false
    @State private var showRecoveryConfirm = false
    @State private var recoverySource: RecoverySource = .legacy
    @State private var recoveryCount = 0
    @State private var recoveryTarget = ""
    @State private var recoveryTargetID = ""
    @State private var recoveryMessage: String?

    private enum RecoverySource { case legacy, guest }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    FocusPageIntro(
                        title: "A tu manera.",
                        subtitle: "Tu cuenta, tus preferencias y tu privacidad.",
                        symbol: "slider.horizontal.3",
                        compact: true
                    )
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.clear)
                }
                accountSection
                recoverySection
                novaSection
                notificationsSection
                calendarSection
                appearanceSection
                privacySection
                Section("Acerca de Focus") {
                    LabeledContent("Versión", value: AppVersion.displayString)
                }
            }
            .scrollContentBackground(.hidden)
            .background { FocusAmbientBackground(intensity: 0.3) }
            .tint(Theme.Colors.focusAccent)
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cerrar") { nav.showSettings = false }
                        .accessibilityIdentifier("settings.close")
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if let error = store.localSaveError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.subheadline)
                        .foregroundStyle(Theme.Colors.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(Theme.Colors.surface)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("settings.saveError")
                }
            }
            .task { await refreshPermissions() }
            .onChange(of: store.localSaveError) { _, error in
                if let error {
                    UIAccessibility.post(notification: .announcement, argument: error)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refreshPermissions() } }
            }
            .sheet(isPresented: $showAIConsent) {
                NovaAIConsentSheet(onAccept: {
                    NovaAIConsent.grant()
                    aiConsentGranted = true
                    showAIConsent = false
                }, onDecline: {
                    showAIConsent = false
                })
            }
            .confirmationDialog("Cerrar sesión", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Cerrar sesión", role: .destructive) {
                    nav.showSettings = false
                    auth.signOut()
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Tus datos seguirán asociados a tu cuenta.")
            }
            .alert("Acceso al calendario", isPresented: $showCalendarDeniedAlert) {
                Button("Abrir Ajustes del iPhone", action: openSystemSettings)
                Button("Ahora no", role: .cancel) {}
            } message: {
                Text("Para mostrar los eventos del iPhone, permite a Focus acceder a Calendarios.")
            }
            .confirmationDialog("Recuperar datos anteriores", isPresented: $showRecoveryConfirm, titleVisibility: .visible) {
                Button("Recuperar datos", action: performRecovery)
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Se añadirán \(recoveryCount) pendientes y eventos a \(recoveryTarget). Tus datos actuales se conservarán.")
            }
            .alert("Recuperar datos", isPresented: Binding(
                get: { recoveryMessage != nil },
                set: { if !$0 { recoveryMessage = nil } }
            )) {
                Button("Entendido", role: .cancel) { recoveryMessage = nil }
            } message: {
                Text(recoveryMessage ?? "")
            }
            .alert("¿Eliminar tu cuenta?", isPresented: $showDeleteAccountAlert) {
                TextField("Escribe ELIMINAR", text: $deleteConfirmText)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                Button("Eliminar definitivamente", role: .destructive) {
                    let typed = deleteConfirmText.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    deleteConfirmText = ""
                    guard typed == "ELIMINAR" else {
                        deleteAccountError = "Escribe ELIMINAR para confirmar."
                        return
                    }
                    Task { await performDeleteAccount() }
                }
                Button("Cancelar", role: .cancel) { deleteConfirmText = "" }
            } message: {
                Text("Se borrarán tu cuenta y sus datos de Focus. Esta acción no se puede deshacer.")
            }
            .alert("Eliminar cuenta", isPresented: Binding(
                get: { deleteAccountError != nil },
                set: { if !$0 { deleteAccountError = nil } }
            )) {
                Button("Entendido", role: .cancel) { deleteAccountError = nil }
            } message: {
                Text(deleteAccountError ?? "")
            }
        }
    }

    private var accountSection: some View {
        Section {
            if auth.isLoggedIn {
                LabeledContent("Cuenta", value: auth.currentEmail ?? auth.displayName)
                VStack(alignment: .leading, spacing: 4) {
                    Label(syncTitle, systemImage: syncSymbol)
                        .font(.body)
                    Text(syncDetail)
                        .font(.footnote)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("settings.syncStatus")
                Button {
                    Task { await store.fetchRemoteAndMerge() }
                } label: {
                    HStack {
                        Text("Sincronizar ahora")
                        Spacer()
                        if store.syncState == .syncing { ProgressView() }
                    }
                }
                .disabled(store.syncState == .syncing)
                .accessibilityIdentifier("settings.sync")
                Button("Cerrar sesión", role: .destructive) { showSignOutConfirm = true }
                    .accessibilityIdentifier("settings.signOut")
            } else {
                Label("En este iPhone", systemImage: "iphone")
                Text("Tus pendientes y eventos se guardan aquí. Inicia sesión para sincronizarlos.")
                    .font(.footnote)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Button("Iniciar sesión") {
                    nav.showSettings = false
                    focusSignIn()
                }
                .accessibilityIdentifier("settings.signIn")
            }
        } header: {
            Text("Cuenta y datos")
        }
    }

    private var novaSection: some View {
        Section {
            Picker("Estilo de respuesta", selection: Binding(
                get: { store.settings.novaPersonality },
                set: { value in store.updateSettings { $0.novaPersonality = value } }
            )) {
                ForEach(NovaPersonality.allCases) { personality in
                    Text(personality.displayName).tag(personality)
                }
            }
            .accessibilityIdentifier("settings.personality")
            Toggle("Usar memoria", isOn: Binding(
                get: { store.settings.novaMemoryEnabled },
                set: { value in store.updateSettings { $0.novaMemoryEnabled = value } }
            ))
            .accessibilityIdentifier("settings.memory")
            NavigationLink("Lo que Nova recuerda") { NovaMemoryListView() }
                .accessibilityIdentifier("settings.memories")
        } header: {
            Text("Nova")
        } footer: {
            Text("Al desactivar la memoria, Nova deja de aprender y usar tus preferencias guardadas. Puedes revisarlas o borrarlas.")
        }
    }

    @ViewBuilder
    private var recoverySection: some View {
        if store.legacyRecoveryCount > 0 || (auth.isLoggedIn && store.guestRecoveryCount > 0) {
            Section {
                if store.legacyRecoveryCount > 0 {
                    Button("Recuperar datos anteriores (\(store.legacyRecoveryCount))") { requestRecovery(.legacy) }
                        .accessibilityIdentifier("settings.recoverLegacy")
                }
                if auth.isLoggedIn && store.guestRecoveryCount > 0 {
                    Button("Añadir datos de este iPhone (\(store.guestRecoveryCount))") { requestRecovery(.guest) }
                        .accessibilityIdentifier("settings.recoverGuest")
                }
            } header: {
                Text("Datos anteriores")
            } footer: {
                Text("Encontramos pendientes y eventos guardados antes. Elige recuperarlos y revisa dónde se añadirán.")
            }
        }
    }

    private var notificationsSection: some View {
        Section {
            Toggle("Avisos de eventos", isOn: Binding(
                get: { store.settings.remindersEnabled },
                set: { value in setRemindersEnabled(value) }
            ))
            .disabled(requestingNotifications)
            .accessibilityIdentifier("settings.reminders")

            switch notificationStatus {
            case .authorized, .provisional, .ephemeral:
                Label("Notificaciones permitidas", systemImage: "checkmark.circle")
                    .foregroundStyle(Theme.Colors.textSecondary)
            case .notDetermined:
                Button("Permitir notificaciones") {
                    setRemindersEnabled(true)
                }
                .disabled(requestingNotifications)
                .accessibilityIdentifier("settings.requestNotifications")
            case .denied:
                Button("Permitir en Ajustes del iPhone", action: openSystemSettings)
                    .accessibilityIdentifier("settings.openNotificationSettings")
                Text("Los eventos se guardan, pero el iPhone no puede avisarte.")
                    .font(.footnote)
                    .foregroundStyle(Theme.Colors.textSecondary)
            @unknown default:
                Button("Revisar Ajustes del iPhone", action: openSystemSettings)
            }
        } header: {
            Text("Notificaciones")
        } footer: {
            Text("Elige cuándo recibir un aviso al crear o editar cada evento.")
        }
    }

    private var calendarSection: some View {
        Section {
            Toggle("Mostrar eventos del iPhone", isOn: Binding(
                get: { store.settings.systemCalendarOn },
                set: { value in setSystemCalendarEnabled(value) }
            ))
            .disabled(requestingCalendar)
            .accessibilityIdentifier("settings.calendar")
        } header: {
            Text("Calendario")
        } footer: {
            Text("Consulta los eventos de tus calendarios junto a los de Focus. Para modificarlos, se abre Calendario.")
        }
    }

    private var appearanceSection: some View {
        Section("Apariencia") {
            Picker("Tema", selection: Binding(
                get: { store.settings.appearance },
                set: { value in store.updateSettings { $0.appearance = value } }
            )) {
                ForEach(AppearancePreference.allCases) { Text($0.displayName).tag($0) }
            }
            .accessibilityIdentifier("settings.appearance")
        }
    }

    private var privacySection: some View {
        Section {
            Toggle("Permitir IA externa", isOn: Binding(
                get: { aiConsentGranted },
                set: { enabled in
                    if enabled {
                        showAIConsent = true
                    } else {
                        store.cancelNovaRequest()
                        NovaAIConsent.revoke()
                        aiConsentGranted = false
                    }
                }
            ))
            .accessibilityIdentifier("settings.aiConsent")
            Link("Política de privacidad", destination: URL(string: "https://www.usefocus.me/privacidad")!)
            Link("Términos del servicio", destination: URL(string: "https://www.usefocus.me/terminos")!)
            if auth.isLoggedIn {
                Button(isDeletingAccount ? "Eliminando cuenta…" : "Eliminar cuenta", role: .destructive) {
                    showDeleteAccountAlert = true
                }
                .disabled(isDeletingAccount)
                .accessibilityIdentifier("settings.deleteAccount")
            }
        } header: {
            Text("Privacidad")
        } footer: {
            Text("Con tu permiso, Nova envía tu mensaje y el contexto necesario a proveedores de IA. Puedes retirar el permiso cuando quieras y seguir creando tareas y eventos a mano.")
        }
    }

    private var syncTitle: String {
        switch store.syncState {
        case .demo, .loggedOut: return "En este iPhone"
        case .idle: return store.lastSyncAt == nil ? "Sincronización disponible" : "Sincronizado"
        case .syncing: return "Sincronizando…"
        case .error: return "Sincronización pendiente"
        }
    }

    private var syncDetail: String {
        switch store.syncState {
        case .demo, .loggedOut: return "Inicia sesión para sincronizar tus datos."
        case .idle:
            if let date = store.lastSyncAt { return "Última actualización: \(DateFormatters.hourMinute.string(from: date))." }
            return "Tus datos se sincronizan con tu cuenta."
        case .syncing: return "Actualizando tus pendientes y eventos."
        case .error: return "Revisa tu conexión y vuelve a intentarlo."
        }
    }

    private var syncSymbol: String {
        switch store.syncState {
        case .demo, .loggedOut: return "iphone"
        case .idle: return "checkmark.icloud"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .error: return "exclamationmark.icloud"
        }
    }

    @MainActor
    private func refreshPermissions() async {
        notificationStatus = await LocalNotificationService.shared.currentStatus()
        aiConsentGranted = NovaAIConsent.granted
        if store.settings.systemCalendarOn && !SystemCalendarService.shared.isAuthorized {
            store.updateSettings { $0.showSystemCalendar = false }
            store.refreshSystemEvents()
        }
    }

    private func setRemindersEnabled(_ enabled: Bool) {
        guard !requestingNotifications else { return }
        if !enabled {
            store.updateSettings { $0.remindersEnabled = false; $0.notificationsEnabled = false }
            return
        }
        requestingNotifications = true
        Task { @MainActor in
            defer { requestingNotifications = false }
            let status = await LocalNotificationService.shared.currentStatus()
            notificationStatus = status == .notDetermined
                ? await LocalNotificationService.shared.requestAuthorization()
                : status
            let allowed = [.authorized, .provisional, .ephemeral].contains(notificationStatus)
            store.updateSettings { $0.remindersEnabled = allowed; $0.notificationsEnabled = allowed }
            if allowed { store.bootstrapLocalNotifications() }
        }
    }

    private func setSystemCalendarEnabled(_ enabled: Bool) {
        guard !requestingCalendar else { return }
        if !enabled {
            store.updateSettings { $0.showSystemCalendar = false }
            store.refreshSystemEvents()
            return
        }
        requestingCalendar = true
        Task { @MainActor in
            defer { requestingCalendar = false }
            let service = SystemCalendarService.shared
            let granted = service.isAuthorized ? true : await service.requestAccess()
            store.updateSettings { $0.showSystemCalendar = granted }
            store.refreshSystemEvents()
            if !granted { showCalendarDeniedAlert = true }
        }
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }

    private var currentRecoveryTargetID: String {
        if case .loggedIn(let session) = auth.state { return session.userId }
        return "local"
    }

    private func requestRecovery(_ source: RecoverySource) {
        recoverySource = source
        recoveryCount = source == .legacy ? store.legacyRecoveryCount : store.guestRecoveryCount
        recoveryTargetID = currentRecoveryTargetID
        recoveryTarget = auth.isLoggedIn ? "tu cuenta \(auth.currentEmail ?? auth.displayName)" : "este iPhone"
        showRecoveryConfirm = true
    }

    private func performRecovery() {
        guard currentRecoveryTargetID == recoveryTargetID else {
            recoveryMessage = "La cuenta cambió. Revisa el destino y vuelve a intentarlo."
            return
        }
        let success = recoverySource == .legacy
            ? store.importLegacyDataIntoCurrentAccount()
            : store.importGuestDataIntoCurrentAccount()
        recoveryMessage = success ? "Datos recuperados." : (store.localSaveError ?? "No pudimos recuperar los datos. Vuelve a intentarlo.")
    }

    @MainActor
    private func performDeleteAccount() async {
        guard !isDeletingAccount else { return }
        let generation = store.accountGeneration
        isDeletingAccount = true
        defer { isDeletingAccount = false }
        do {
            try await auth.deleteAccount()
            guard store.accountGeneration == generation else { return }
            store.clearAllLocalData()
            nav.showSettings = false
        } catch {
            deleteAccountError = "No pudimos eliminar tu cuenta. Revisa tu conexión e inténtalo de nuevo."
            HapticManager.shared.warning()
        }
    }
}

// Memories remain on the device and can always be reviewed or deleted.
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
            Text("Esto borra todos los nombres, preferencias y reglas que Nova aprendió de ti. Esta acción no se puede deshacer.")
        }
    }

    // MARK: - Subvistas

    private var headerText: String {
        if entries.isEmpty {
            return "Cuando le cuentas cosas a Nova («Juan Pablo es mi coordinador», «teorías es Teorías de la Comunicación»), las guarda aquí para entenderte mejor después."
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
                                .font(.title3)
                                .foregroundStyle(Theme.Colors.textSecondary)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Borrar memoria: \(entry.text)")
                        .accessibilityIdentifier("memory.delete.\(entry.id.uuidString)")
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
