import SwiftUI

private struct FocusSignInActionKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var focusSignIn: () -> Void {
        get { self[FocusSignInActionKey.self] }
        set { self[FocusSignInActionKey.self] = newValue }
    }
}

struct ContentView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage("focus.v1.hasSeenOnboarding") private var hasSeenOnboarding = false
    @State private var showSignIn = false

    private var hasPendingCode: Bool {
        if case .codeSent = auth.state { return true }
        return false
    }

    var body: some View {
        Group {
            if case .loading = auth.state {
                BootView()
            } else if auth.isAuthenticatedOrDemo {
                MainTabView()
                    .onAppear {
                        hasSeenOnboarding = true
                        showSignIn = false
                    }
            } else if showSignIn || hasPendingCode {
                LoginView(onBack: { showSignIn = false })
            } else {
                OnboardingView(onSignIn: { showSignIn = true })
            }
        }
        .environment(\.focusSignIn) {
            showSignIn = true
            auth.exitDemo()
        }
        .background(Theme.Colors.background.ignoresSafeArea())
    }
}
