import SwiftUI

struct BootView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            FocusMark(size: 64)
            Text("Focus").font(.title.weight(.semibold))
            ProgressView().accessibilityLabel("Abriendo Focus")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { FocusAmbientBackground() }
    }
}
