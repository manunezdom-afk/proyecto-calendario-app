import SwiftUI
import UIKit

/// Focus visual language: pearl / ink, a restrained blue–iris light, and native Dynamic Type.
enum Theme {
    enum Colors {
        static let background = adaptive(light: 0xF5F7FC, dark: 0x0D111C)
        static let canvasL0 = background
        static let surface = adaptive(light: 0xFFFFFF, dark: 0x191F2F)
        static let surfaceL1 = surface
        static let surfaceElevated = surface
        static let surfaceHigh = adaptive(light: 0xEAF0FA, dark: 0x252E43)
        static let surfaceL2 = surfaceHigh
        static let surfaceTinted = adaptive(light: 0xEAF0FF, dark: 0x202C48)
        static let border = adaptive(light: 0xDAE1F0, dark: 0x36425C)
        static let borderEmphasis = Color(uiColor: .separator)
        static let borderHairline = border
        static let borderSoft = border
        static let textPrimary = adaptive(light: 0x192238, dark: 0xF0F3FC)
        static let textSecondary = adaptive(light: 0x56627A, dark: 0xAFBBD2)
        static let textTertiary = textSecondary
        static let textQuaternary = Color(uiColor: .tertiaryLabel)

        static let focusAccent = adaptive(light: 0x3554CC, dark: 0xA7BBFF)
        static let accentGradient = LinearGradient(colors: [focusAccent, novaAccent], startPoint: .topLeading, endPoint: .bottomTrailing)
        // Saturated fills keep white button labels legible in either appearance.
        static let actionGradient = LinearGradient(colors: [Color(uiColor: rgb(0x3355CE)), Color(uiColor: rgb(0x6450C5))], startPoint: .leading, endPoint: .trailing)
        static let actionFill = Color(uiColor: rgb(0x3C55CE))
        static let textOnAccent = adaptive(light: 0xFFFFFF, dark: 0x111D40)
        static let ambientBlue = adaptive(light: 0xC4D9FF, dark: 0x203D88)
        static let ambientIris = adaptive(light: 0xE3D9FF, dark: 0x413078)
        static let focusAccentSoft = focusAccent.opacity(0.10)
        static let focusAccentHover = focusAccent
        static let novaAccent = adaptive(light: 0x7050BA, dark: 0xC3B4FF)
        static let novaAccentSoft = focusAccentSoft
        static let novaAccentDeep = focusAccent
        static let novaElectric = focusAccent
        static let novaHalo = Color.clear

        static let success = adaptive(light: 0x187344, dark: 0x7AD6AA)
        static let successSoft = success.opacity(0.10)
        static let warning = adaptive(light: 0x875607, dark: 0xF7C56E)
        static let warningSoft = warning.opacity(0.10)
        static let danger = adaptive(light: 0xBB3344, dark: 0xFF97A6)
        static let dangerSoft = danger.opacity(0.10)
        static let info = focusAccent
        static let infoSoft = focusAccentSoft

        static let sectionFoco = focusAccent
        static let sectionReunion = adaptive(light: 0x746039, dark: 0xD8BC89)
        static let sectionPersonal = adaptive(light: 0x9B526F, dark: 0xE8ACC4)
        static let sectionEstudio = adaptive(light: 0x7653A4, dark: 0xC6ADF0)
        static let sectionDescanso = adaptive(light: 0x536D7A, dark: 0xADCBD6)
        static let sectionEntrenamiento = adaptive(light: 0x26715B, dark: 0x8DD9B8)
        static let sectionReminder = warning
        static let priorityHigh = danger
        static let priorityMedium = textSecondary
        static let priorityLow = textTertiary
        static let cardShadow = adaptive(light: 0x283F78, dark: 0x000000).opacity(0.06)
        static let cardShadowStrong = cardShadow.opacity(1.5)
        static let modalShadow = Color.clear

        // Source-compatible aliases for components being retired.
        static let focusDeepGradient = actionGradient
        static let novaPrismGradient = flat(focusAccent)
        static let novaGradient = flat(focusAccent)
        static let heroSunsetGradient = flat(surface)
        static let dangerMeltGradient = flat(danger)
        static let ambientCalmRadial = RadialGradient(colors: [.clear, .clear], center: .center, startRadius: 0, endRadius: 1)
        static let novaChatBackground = flat(background)
        static let novaChatHalo = ambientCalmRadial
        static let novaGlassFill = surface
        static let novaGlassUserFill = focusAccentSoft
        static let novaGlassStroke = border
        static let novaGlassStrokeEmphasis = focusAccent
        static let novaTextOnDark = textPrimary
        static let novaTextOnDarkSecondary = textSecondary
        static let novaTextOnDarkTertiary = textTertiary
        static let novaLabelOnDark = focusAccent
        static let novaGlow = Color.clear
        static let novaSendGradient = flat(focusAccent)

        private static func rgb(_ value: UInt) -> UIColor {
            UIColor(red: CGFloat((value >> 16) & 0xFF) / 255,
                    green: CGFloat((value >> 8) & 0xFF) / 255,
                    blue: CGFloat(value & 0xFF) / 255, alpha: 1)
        }

        private static func adaptive(light: UInt, dark: UInt) -> Color {
            Color(uiColor: UIColor { traits in
                rgb(traits.userInterfaceStyle == .dark ? dark : light)
            })
        }

        private static func flat(_ color: Color) -> LinearGradient {
            LinearGradient(colors: [color, color], startPoint: .top, endPoint: .bottom)
        }
    }

    enum Typography {
        static let displayHero = Font.system(.largeTitle, design: .default).weight(.medium)
        static let display = Font.largeTitle.weight(.medium)
        static let title = Font.title.bold()
        static let title1 = Font.title2.weight(.semibold)
        static let title2 = Font.title2.weight(.semibold)
        static let title3 = Font.title3.weight(.semibold)
        static let headline = Font.headline
        static let body = Font.body
        static let bodyEmphasized = Font.body.weight(.medium)
        static let bodyBold = Font.body.weight(.semibold)
        static let subhead = Font.subheadline
        static let subheadEmphasized = Font.subheadline.weight(.medium)
        static let callout = Font.callout.weight(.medium)
        static let footnote = Font.footnote
        static let caption = Font.caption
        static let captionEmphasized = Font.caption.weight(.semibold)
        static let timestamp = Font.subheadline.monospacedDigit()
        static let largeNumber = Font.title.bold().monospacedDigit()
        static let captionMono = Font.system(.caption, design: .monospaced)
        static let bodyMono = Font.system(.subheadline, design: .monospaced)
        static let displayMono = Font.system(.title, design: .monospaced).bold()
    }

    enum Tracking {
        static let displayHero: CGFloat = 0
        static let title1: CGFloat = 0
        static let title2: CGFloat = 0
        static let title3: CGFloat = 0
        static let headline: CGFloat = 0
        static let body: CGFloat = 0
        static let callout: CGFloat = 0
        static let captionMono: CGFloat = 0
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let xxxl: CGFloat = 32
        static let huge: CGFloat = 48
        static let bottomBarSafety: CGFloat = 24
    }

    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let pill: CGFloat = 999
    }

    enum Stroke {
        static let hairline: CGFloat = 0.5
        static let thin: CGFloat = 1
        static let medium: CGFloat = 1.5
    }

    enum Motion {
        static let snap: Double = 0.12
        static let quick: Double = 0.18
        static let standard: Double = 0.24
        static let slow: Double = 0.3
        static let easeOutQuick = Animation.easeOut(duration: quick)
        static let easeInOutStandard = Animation.easeInOut(duration: standard)
        static let appleSpring = Animation.easeOut(duration: standard)
        static let snapTap = Animation.easeOut(duration: snap)
    }

    enum Spring {
        static let entrance = Animation.easeOut(duration: 0.2)
        static let dismiss = Animation.easeOut(duration: 0.18)
        static let interactive = Animation.interactiveSpring(response: 0.2, dampingFraction: 1)
        static let settle = Animation.easeOut(duration: 0.2)
        static let pop = Animation.easeOut(duration: 0.18)
    }
}

extension View {
    func sectionLabelStyle() -> some View {
        self.font(.caption.weight(.semibold)).foregroundStyle(Theme.Colors.textSecondary)
    }

    func focusCard(radius: CGFloat = Theme.Radius.lg, padding: CGFloat = Theme.Spacing.lg, shadow: Bool = true) -> some View {
        self.padding(padding)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: radius))
    }

    func focusCardElevated(radius: CGFloat = Theme.Radius.xl, padding: CGFloat = Theme.Spacing.lg, tint: Color? = nil) -> some View {
        self.padding(padding)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.Colors.border, lineWidth: 0.5))
    }

    func novaResultCard(radius: CGFloat = Theme.Radius.xl, padding: CGFloat = Theme.Spacing.xl) -> some View {
        self.padding(padding)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.Colors.border, lineWidth: 0.5))
    }

    func focusCardShadow(strong: Bool = false) -> some View {
        shadow(color: Theme.Colors.cardShadow, radius: strong ? 20 : 12, x: 0, y: 6)
    }

    func focusSurface(radius: CGFloat = 24, padding: CGFloat = 20) -> some View {
        self.padding(padding)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Theme.Colors.border.opacity(0.65), lineWidth: 0.5))
            .shadow(color: Theme.Colors.cardShadow, radius: 18, x: 0, y: 7)
    }
}


/// Static, inexpensive atmosphere. All decoration is excluded from accessibility
/// and hit testing; increased contrast removes the color wash altogether.
struct FocusAmbientBackground: View {
    var intensity: Double = 1
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Theme.Colors.background
                if contrast != .increased {
                    Ellipse()
                        .fill(RadialGradient(colors: [Theme.Colors.ambientBlue.opacity(0.65 * intensity), .clear],
                                             center: .center, startRadius: 0, endRadius: geometry.size.width * 0.68))
                        .frame(width: geometry.size.width * 1.5, height: 500)
                        .offset(x: -geometry.size.width * 0.28, y: -150)
                    Ellipse()
                        .fill(RadialGradient(colors: [Theme.Colors.ambientIris.opacity(0.48 * intensity), .clear],
                                             center: .center, startRadius: 0, endRadius: geometry.size.width * 0.6))
                        .frame(width: geometry.size.width * 1.3, height: 480)
                        .offset(x: geometry.size.width * 0.4, y: -70)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A Focus-owned orbital mark: two rounded paths resolving around a clear center.
/// Drawn in SwiftUI, with no bitmap downloads or perpetual animation.
struct FocusMark: View {
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.31, style: .continuous)
                .fill(Theme.Colors.surface.opacity(0.8))
            RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                .stroke(Theme.Colors.accentGradient, style: StrokeStyle(lineWidth: size * 0.065, lineCap: .round))
                .frame(width: size * 0.47, height: size * 0.61)
                .rotationEffect(.degrees(38))
            RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                .trim(from: 0.08, to: 0.78)
                .stroke(Theme.Colors.accentGradient, style: StrokeStyle(lineWidth: size * 0.065, lineCap: .round))
                .frame(width: size * 0.47, height: size * 0.61)
                .rotationEffect(.degrees(-38))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct FocusPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.white)
            .padding(.horizontal, 22)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Theme.Colors.actionGradient, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .opacity(enabled ? (configuration.isPressed ? 0.82 : 1) : 0.5)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
