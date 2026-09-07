import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage("focus.v1.hasSeenOnboarding") private var hasSeenOnboarding = false

    var body: some View {
        Group {
            if case .loading = auth.state {
                BootView()
            } else if auth.isAuthenticatedOrDemo {
                MainTabView()
                    .onAppear { hasSeenOnboarding = true }
            } else if !hasSeenOnboarding {
                OnboardingView()
            } else {
                LoginView()
            }
        }
        .background(Theme.Colors.background.ignoresSafeArea())
    }
}
