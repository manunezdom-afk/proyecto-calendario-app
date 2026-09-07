import SwiftUI

struct BootView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            Image(systemName: "diamond.fill")
                .font(.largeTitle)
                .foregroundStyle(Theme.Colors.focusAccent)
                .accessibilityHidden(true)
            Text("Focus").font(.title.weight(.semibold))
            ProgressView().accessibilityLabel("Abriendo Focus")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Colors.background.ignoresSafeArea())
    }
}
