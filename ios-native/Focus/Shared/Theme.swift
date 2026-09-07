import SwiftUI
import UIKit

/// Semantic system colors and text styles follow appearance, contrast and Dynamic Type.
enum Theme {
    enum Colors {
        static let background = Color(uiColor: .systemGroupedBackground)
        static let canvasL0 = background
        static let surface = Color(uiColor: .secondarySystemGroupedBackground)
        static let surfaceL1 = surface
        static let surfaceElevated = surface
        static let surfaceHigh = Color(uiColor: .tertiarySystemGroupedBackground)
        static let surfaceL2 = surfaceHigh
        static let surfaceTinted = Color(uiColor: .secondarySystemBackground)
        static let border = Color(uiColor: .separator).opacity(0.5)
        static let borderEmphasis = Color(uiColor: .separator)
        static let borderHairline = border
        static let borderSoft = border
        static let textPrimary = Color(uiColor: .label)
        static let textSecondary = Color(uiColor: .secondaryLabel)
        static let textTertiary = Color(uiColor: .secondaryLabel)
        static let textQuaternary = Color(uiColor: .tertiaryLabel)

        static let focusAccent = Color(uiColor: .systemBlue)
        static let focusAccentSoft = focusAccent.opacity(0.10)
        static let focusAccentHover = focusAccent
        static let novaAccent = focusAccent
        static let novaAccentSoft = focusAccentSoft
        static let novaAccentDeep = focusAccent
        static let novaElectric = focusAccent
        static let novaHalo = Color.clear

        static let success = Color(uiColor: .systemGreen)
        static let successSoft = success.opacity(0.10)
        static let warning = Color(uiColor: .systemOrange)
        static let warningSoft = warning.opacity(0.10)
        static let danger = Color(uiColor: .systemRed)
        static let dangerSoft = danger.opacity(0.10)
        static let info = focusAccent
        static let infoSoft = focusAccentSoft

        static let sectionFoco = focusAccent
        static let sectionReunion = Color(uiColor: .systemIndigo)
        static let sectionPersonal = Color(uiColor: .systemTeal)
        static let sectionEstudio = Color(uiColor: .systemIndigo)
        static let sectionDescanso = Color(uiColor: .systemTeal)
        static let sectionEntrenamiento = Color(uiColor: .systemGreen)
        static let sectionReminder = warning
        static let priorityHigh = danger
        static let priorityMedium = textSecondary
        static let priorityLow = textTertiary
        static let cardShadow = Color.clear
        static let cardShadowStrong = Color.clear
        static let modalShadow = Color.clear

        // Source-compatible aliases for components being retired.
        static let focusDeepGradient = flat(focusAccent)
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

        private static func flat(_ color: Color) -> LinearGradient {
            LinearGradient(colors: [color, color], startPoint: .top, endPoint: .bottom)
        }
    }

    enum Typography {
        static let displayHero = Font.largeTitle.bold()
        static let display = Font.largeTitle.bold()
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

    func focusCardShadow(strong: Bool = false) -> some View { self }
}
