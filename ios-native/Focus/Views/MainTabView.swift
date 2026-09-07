import SwiftUI

enum MainTab: Hashable, CaseIterable {
    case miDia, tareas, calendario, nova, ajustes
    static let visibleTabs: [MainTab] = [.miDia, .tareas, .calendario, .nova]
    var title: String {
        switch self {
        case .miDia: return "Hoy"
        case .tareas: return "Pendientes"
        case .calendario: return "Agenda"
        case .nova: return AssistantBrand.displayName
        case .ajustes: return "Ajustes"
        }
    }
    var symbol: String {
        switch self {
        case .miDia: return "sun.max"
        case .tareas: return "checklist"
        case .calendario: return "calendar"
        case .nova: return "diamond"
        case .ajustes: return "gearshape"
        }
    }
    var selectedSymbol: String { symbol }
}

// Retained for links from existing contextual actions.
enum NovaSegment: Hashable { case bandeja, acciones, chat }

@MainActor
final class NavigationCoordinator: ObservableObject {
    @Published var selectedTab: MainTab = .miDia
    @Published var novaSegment: NovaSegment = .chat
    @Published var pendingNovaPrompt: String?
    @Published var pendingCalendarDate: Date?
    @Published var showSettings = false

    func openNova(prompt: String? = nil, segment: NovaSegment? = nil) {
        if let prompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            pendingNovaPrompt = prompt
        }
        novaSegment = .chat
        selectedTab = .nova
    }

    func openCalendar(on date: Date) {
        pendingCalendarDate = Calendar.current.startOfDay(for: date)
        selectedTab = .calendario
    }

    func openSettings() { showSettings = true }
}

struct MainTabView: View {
    @EnvironmentObject private var store: FocusDataStore
    @StateObject private var nav = NavigationCoordinator()
    @StateObject private var toast = ToastManager()

    var body: some View {
        VStack(spacing: 0) {
            if store.notificationPermissionDenied {
                HStack(spacing: 12) {
                    Image(systemName: "bell.slash").foregroundStyle(Theme.Colors.warning)
                        .accessibilityHidden(true)
                    Text("No recibirás avisos en este iPhone.").font(.subheadline)
                    Spacer(minLength: 0)
                    Button("Revisar") { nav.openSettings() }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .padding(.horizontal, 20).padding(.vertical, 4)
                .background(Theme.Colors.surface)
                .accessibilityIdentifier("notifications.denied")
            }
            TabView(selection: $nav.selectedTab) {
                MiDiaView()
                    .tabItem { Label("Hoy", systemImage: "sun.max") }
                    .tag(MainTab.miDia)
                    .accessibilityIdentifier("tab.hoy")
                TareasView()
                    .tabItem { Label("Pendientes", systemImage: "checklist") }
                    .tag(MainTab.tareas)
                    .accessibilityIdentifier("tab.pendientes")
                CalendarioView()
                    .tabItem { Label("Agenda", systemImage: "calendar") }
                    .tag(MainTab.calendario)
                    .accessibilityIdentifier("tab.agenda")
                NovaView()
                    .tabItem { Label(AssistantBrand.displayName, systemImage: "diamond") }
                    .tag(MainTab.nova)
                    .accessibilityIdentifier("tab.nova")
            }
        }
        .tint(Theme.Colors.focusAccent)
        .environmentObject(nav)
        .environmentObject(toast)
        .sheet(isPresented: $nav.showSettings) {
            AjustesView()
                .environmentObject(nav)
                .environmentObject(toast)

        }
        .onChange(of: nav.selectedTab) { oldValue, newValue in
            if newValue == .ajustes {
                nav.selectedTab = oldValue == .ajustes ? .miDia : oldValue
                nav.openSettings()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .focusReminderTapped)) { _ in
            nav.selectedTab = .miDia
        }
        .overlay(alignment: .top) {
            if let current = toast.current {
                ToastBanner(toast: current)
                    .padding(.top, 8)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("feedback.toast")
            }
        }
    }
}
