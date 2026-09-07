import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage("focus.v1.hasSeenOnboarding") private var hasSeenOnboarding = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxxl) {
                HStack(spacing: 10) {
                    Image(systemName: "diamond.fill")
                        .foregroundStyle(Theme.Colors.focusAccent)
                        .accessibilityHidden(true)
                    Text("Focus").font(.title2.weight(.semibold))
                }
                .padding(.top, Theme.Spacing.xl)

                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    Text("De tenerlo en mente\na tenerlo hecho.")
                        .font(.largeTitle.bold())
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Dile a Focus lo que necesitas. Convierte tus ideas en pendientes y eventos para que sepas por dónde empezar.")
                        .font(.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    Text("UN EJEMPLO")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Text("“Estudiar economía mañana y reunión el viernes a las 10.”")
                        .font(.body)
                    Divider()
                    exampleRow("Estudiar economía", detail: "Pendiente · Mañana", symbol: "circle")
                    exampleRow("Reunión", detail: "Evento · Viernes, 10:00", symbol: "calendar")
                }
                .padding(Theme.Spacing.xl)
                .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))

                Label("También puedes crear todo a mano.", systemImage: "plus.circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
            .padding(.horizontal, Theme.Spacing.xxl)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .background(Theme.Colors.background)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: Theme.Spacing.sm) {
                Button {
                    FocusTelemetry.record(.onboardingCompleted)
                    hasSeenOnboarding = true
                    auth.enterDemo()
                } label: {
                    Text("Empezar")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("onboarding.start")
                Text("En este iPhone. Sin crear una cuenta.")
                    .font(.footnote)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Button("Ya tengo una cuenta") {
                    FocusTelemetry.record(.onboardingCompleted)
                    hasSeenOnboarding = true
                }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("onboarding.signIn")
            }
            .padding(.horizontal, Theme.Spacing.xxl)
            .padding(.top, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.sm)
            .background(Theme.Colors.background)
        }
        .onAppear { FocusTelemetry.record(.onboardingStarted) }
    }

    private func exampleRow(_ title: String, detail: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            Image(systemName: symbol)
                .foregroundStyle(Theme.Colors.focusAccent)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium))
                Text(detail).font(.subheadline).foregroundStyle(Theme.Colors.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
