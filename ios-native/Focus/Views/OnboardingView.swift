import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage("focus.v1.hasSeenOnboarding") private var hasSeenOnboarding = false
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 38
    let onSignIn: () -> Void

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 650
            ScrollView {
                VStack(alignment: .leading, spacing: compact ? 24 : 32) {
                    HStack(spacing: 12) {
                        FocusMark(size: compact ? 40 : 48)
                            .accessibilityHidden(true)
                        Text("Focus")
                            .font(.title2.weight(.medium))
                    }
                    .padding(.top, compact ? 12 : 28)

                    VStack(alignment: .leading, spacing: 16) {
                        Text("Menos ruido.\nMás espacio para ti.")
                            .font(.system(size: titleSize, weight: .medium))
                            .tracking(-0.8)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("Convierte lo que tienes en mente en un siguiente paso.")
                            .font(.body)
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    example
                }
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { actions }
        }
        .background(FocusAmbientBackground())
        .onAppear { FocusTelemetry.record(.onboardingStarted) }
    }

    private var example: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("EJEMPLO")
                .font(.caption.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Colors.focusAccent)
            Text("“Estudiar mañana y reunión el viernes a las 10.”")
                .font(.body.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            exampleRow("Estudiar", detail: "Pendiente · Mañana", symbol: "circle")
            exampleRow("Reunión", detail: "Evento · Viernes, 10:00", symbol: "calendar")
        }
        .focusSurface(radius: 24, padding: 20)
    }

    private var actions: some View {
        VStack(spacing: 8) {
            Button {
                FocusTelemetry.record(.onboardingCompleted)
                hasSeenOnboarding = true
                auth.enterDemo()
            } label: {
                Text("Empezar")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(FocusPrimaryButtonStyle())
            .accessibilityIdentifier("onboarding.start")

            Text("En este iPhone. Sin crear una cuenta.")
                .font(.footnote)
                .foregroundStyle(Theme.Colors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Ya tengo una cuenta") {
                FocusTelemetry.record(.onboardingCompleted)
                hasSeenOnboarding = true
                onSignIn()
            }
            .font(.subheadline.weight(.medium))
            .frame(minHeight: 44)
            .accessibilityIdentifier("onboarding.signIn")
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Theme.Colors.background.opacity(0.94))
    }

    private func exampleRow(_ title: String, detail: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Theme.Colors.focusAccent)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.medium))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
