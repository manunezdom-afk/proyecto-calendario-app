import SwiftUI
import UIKit

// MARK: - Nova Chat (glassmorphic dark) — solo segmento Chat
//
// Componentes opinados para el rediseño del chat con Nova. El resto de la
// app (Mi Día, Calendario, Ajustes, Bandeja, Acciones) sigue light.
// El chat entra en un "modo IA premium" con fondo violet-black,
// burbujas glass, input flotante, markdown render y typing indicator
// minimalista — sin tocar nada del shell light.
//
// Los tokens viven en `Theme.Colors.novaChat*`, `novaGlass*`, `novaText*`.

// MARK: - Backdrop

/// Fondo dark animado para el chat. LinearGradient violet-black profundo +
/// halo radial superior + dos orbs morados difuminados que respiran suave.
/// Cubre todo el área de seguridad inferior para que el inputBar flote
/// sobre un dark continuo en lugar de cortarse contra el canvas claro.
struct NovaChatBackdrop: View {
    @State private var animatePhase: CGFloat = 0

    var body: some View {
        ZStack {
            // `.container` (no `.all`) — extiende el fondo bajo el tab bar
            // pero RESPETA el keyboard safe area. Sin esto, el `safeAreaInset`
            // del inputBar no se reposiciona cuando aparece el teclado y la
            // barra queda atrapada detrás del keyboard (solo se ve "Listo").
            Theme.Colors.novaChatBackground
                .ignoresSafeArea(.container, edges: [.bottom, .horizontal])

            Theme.Colors.novaChatHalo
                .ignoresSafeArea(.container, edges: [.bottom, .horizontal])
                .allowsHitTesting(false)

            // Orb top-left — violet difuso.
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.486, green: 0.380, blue: 1.000).opacity(0.50),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 200
                    )
                )
                .frame(width: 380, height: 380)
                .blur(radius: 64)
                .offset(x: -130, y: -180 + animatePhase * 22)
                .animation(
                    .easeInOut(duration: 6.2).repeatForever(autoreverses: true),
                    value: animatePhase
                )

            // Orb bottom-right — electric blue difuso.
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.220, green: 0.518, blue: 1.000).opacity(0.35),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 220
                    )
                )
                .frame(width: 400, height: 400)
                .blur(radius: 72)
                .offset(x: 150, y: 240 - animatePhase * 28)
                .animation(
                    .easeInOut(duration: 7.4).repeatForever(autoreverses: true),
                    value: animatePhase
                )
        }
        .onAppear { animatePhase = 1 }
        .allowsHitTesting(false)
    }
}

// MARK: - Markdown renderer (bloques + inline)

/// Render simplificado de Markdown para mensajes de Nova en chat dark.
///
/// Soporta:
/// - ```` ```code blocks``` ```` → NovaCodeBlockView con copy button
/// - `#`, `##`, `###` → headings con peso semibold y jerarquía
/// - `- ` o `* ` → lista con bullet
/// - `1.` / `2.` → lista numerada
/// - `**bold**`, `*italic*`, `` `inline code` `` → vía AttributedString markdown
///
/// El parsing es por líneas — code blocks abren/cierran con ``` y atrapan
/// todo lo demás como contenido literal. El resto se trata como párrafo o
/// heading según el prefijo.
struct NovaMarkdownContent: View {
    let raw: String
    var bodyColor: Color = Theme.Colors.novaTextOnDarkSecondary
    var titleColor: Color = Theme.Colors.novaTextOnDark

    enum Block: Hashable {
        case heading(level: Int, text: String)
        case paragraph(String)
        case bulletList([String])
        case numberedList([String])
        case code(language: String, content: String)
    }

    private var blocks: [Block] {
        var out: [Block] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbers: [String] = []
        var codeLines: [String] = []
        var codeLang: String = ""
        var inCode: Bool = false

        func flushParagraph() {
            if !paragraph.isEmpty {
                out.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        func flushBullets() {
            if !bullets.isEmpty {
                out.append(.bulletList(bullets))
                bullets = []
            }
        }
        func flushNumbers() {
            if !numbers.isEmpty {
                out.append(.numberedList(numbers))
                numbers = []
            }
        }
        func flushLists() {
            flushBullets()
            flushNumbers()
        }

        for line in raw.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if inCode {
                    out.append(.code(language: codeLang, content: codeLines.joined(separator: "\n")))
                    codeLines = []
                    codeLang = ""
                    inCode = false
                } else {
                    flushParagraph()
                    flushLists()
                    codeLang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    inCode = true
                }
                continue
            }
            if inCode {
                codeLines.append(line)
                continue
            }

            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                flushLists()
                continue
            }
            if line.hasPrefix("### ") {
                flushParagraph(); flushLists()
                out.append(.heading(level: 3, text: String(line.dropFirst(4))))
            } else if line.hasPrefix("## ") {
                flushParagraph(); flushLists()
                out.append(.heading(level: 2, text: String(line.dropFirst(3))))
            } else if line.hasPrefix("# ") {
                flushParagraph(); flushLists()
                out.append(.heading(level: 1, text: String(line.dropFirst(2))))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flushParagraph(); flushNumbers()
                bullets.append(String(line.dropFirst(2)))
            } else if let numMatch = numberedListPrefix(line) {
                flushParagraph(); flushBullets()
                numbers.append(numMatch)
            } else {
                flushBullets(); flushNumbers()
                paragraph.append(line)
            }
        }
        if inCode {
            out.append(.code(language: codeLang, content: codeLines.joined(separator: "\n")))
        }
        flushParagraph()
        flushLists()
        return out
    }

    /// Devuelve el contenido después de "N. " si el prefijo es número + punto +
    /// espacio. Si no calza, nil.
    private func numberedListPrefix(_ line: String) -> String? {
        var idx = line.startIndex
        var hasDigit = false
        while idx < line.endIndex, line[idx].isNumber {
            hasDigit = true
            idx = line.index(after: idx)
        }
        guard hasDigit, idx < line.endIndex, line[idx] == "." else { return nil }
        idx = line.index(after: idx)
        guard idx < line.endIndex, line[idx] == " " else { return nil }
        return String(line[line.index(after: idx)...])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let level, let text):
                    Text(attributed(text))
                        .font(headingFont(level: level))
                        .foregroundStyle(titleColor)
                        .fixedSize(horizontal: false, vertical: true)
                case .paragraph(let text):
                    Text(attributed(text))
                        .font(Theme.Typography.body)
                        .tracking(Theme.Tracking.body)
                        .foregroundStyle(bodyColor)
                        .lineSpacing(6)
                        .fixedSize(horizontal: false, vertical: true)
                case .bulletList(let items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(Theme.Colors.novaLabelOnDark)
                                    .frame(width: 5, height: 5)
                                    .padding(.top, 8)
                                Text(attributed(item))
                                    .font(Theme.Typography.body)
                                    .foregroundStyle(bodyColor)
                                    .lineSpacing(6)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                case .numberedList(let items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(idx + 1).")
                                    .font(Theme.Typography.bodyMono)
                                    .foregroundStyle(Theme.Colors.novaLabelOnDark)
                                    .padding(.top, 1)
                                Text(attributed(item))
                                    .font(Theme.Typography.body)
                                    .foregroundStyle(bodyColor)
                                    .lineSpacing(6)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                case .code(let lang, let content):
                    NovaCodeBlockView(language: lang, content: content)
                }
            }
        }
    }

    private func headingFont(level: Int) -> Font {
        switch level {
        case 1: return Font.system(size: 22, weight: .semibold)
        case 2: return Font.system(size: 18, weight: .semibold)
        default: return Font.system(size: 16, weight: .semibold)
        }
    }

    /// Convierte un string en AttributedString con markdown inline (bold,
    /// italic, code, links). Si el parsing falla, devuelve plain.
    private func attributed(_ text: String) -> AttributedString {
        if let attr = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return attr
        }
        return AttributedString(text)
    }
}

// MARK: - Code block con copy

/// Bloque de código sobre fondo dark: header con language tag + botón copiar,
/// contenido en mono más oscuro. Esquinas redondeadas, borde glass.
struct NovaCodeBlockView: View {
    let language: String
    let content: String
    @State private var copied: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(language.isEmpty ? "code" : language.lowercased())
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.novaTextOnDarkTertiary)
                    .textCase(.uppercase)
                Spacer()
                Button {
                    UIPasteboard.general.string = content
                    HapticManager.shared.tick()
                    withAnimation(.easeOut(duration: 0.15)) { copied = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                        withAnimation(.easeIn(duration: 0.20)) { copied = false }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 11, weight: .semibold))
                        Text(copied ? "Copiado" : "Copiar")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(
                        copied
                            ? Color(red: 0.55, green: 0.95, blue: 0.70)
                            : Theme.Colors.novaTextOnDarkSecondary
                    )
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(Color.white.opacity(0.06))
                    )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.04))

            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.Colors.novaTextOnDark)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Color.black.opacity(0.28))
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.Colors.novaGlassStroke, lineWidth: 0.8)
        )
    }
}

// MARK: - Message bubbles

/// Burbuja del usuario en chat dark: glass tintado cobalto, alineado a la
/// derecha. Limpio, sin avatar (es obvio que es del usuario por la posición).
struct NovaGlassUserBubble: View {
    let content: String

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Spacer(minLength: 56)
            Text(content)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(Theme.Colors.novaTextOnDark)
                .multilineTextAlignment(.leading)
                .lineSpacing(3)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(
                    ZStack {
                        UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 4, topTrailingRadius: 20, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .environment(\.colorScheme, .dark)
                        UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 4, topTrailingRadius: 20, style: .continuous)
                            .fill(Theme.Colors.novaGlassUserFill)
                    }
                )
                .overlay(
                    UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 4, topTrailingRadius: 20, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.357, green: 0.302, blue: 1.000).opacity(0.40),
                                    Color(red: 0.220, green: 0.518, blue: 1.000).opacity(0.15)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 0.8
                        )
                )
                .shadow(color: Color.black.opacity(0.25), radius: 8, x: 0, y: 4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Burbuja de Nova en chat dark: glass blanco translúcido a la izquierda,
/// avatar gradient con leve glow, label "NOVA" en captionMono, y markdown
/// render del contenido. Es ancho completo (menos avatar) para que listas
/// y code blocks respiren.
struct NovaGlassNovaBubble: View {
    let content: String
    @Environment(\.openURL) private var openURL

    /// Moderación de contenido IA (Guideline 1.2): mail pre-armado a
    /// soporte con la respuesta reportada. Al volumen actual no se
    /// justifica un endpoint dedicado; el contrato es que cada reporte se
    /// revisa y ajusta los filtros del asistente.
    private static func reportURL(for content: String) -> URL {
        var comps = URLComponents()
        comps.scheme = "mailto"
        comps.path = "manunezdom@gmail.com"
        comps.queryItems = [
            URLQueryItem(name: "subject", value: "Reporte de respuesta de Nova"),
            URLQueryItem(name: "body", value: """
            Hola, quiero reportar esta respuesta de Nova:

            ---
            \(content)
            ---

            Motivo (cuéntanos brevemente):
            """),
        ]
        return comps.url ?? URL(string: "mailto:manunezdom@gmail.com")!
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Theme.Colors.novaPrismGradient)
                    .frame(width: 28, height: 28)
                    .shadow(color: Theme.Colors.novaGlow, radius: 10, y: 3)
                NovaSparkMark(size: 12)
            }
            .padding(.top, 4)

            VStack(alignment: .leading, spacing: 8) {
                Text("Nova")
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.novaLabelOnDark)
                    .textCase(.uppercase)

                NovaMarkdownContent(raw: content)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                ZStack {
                    UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 4, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .environment(\.colorScheme, .dark)
                    UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 4, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous)
                        .fill(Theme.Colors.novaGlassFill)
                }
            )
            .overlay(
                UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 4, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.25),
                                Color(red: 0.357, green: 0.302, blue: 1.000).opacity(0.15),
                                Color.white.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.7
                    )
            )
            .shadow(color: Color.black.opacity(0.20), radius: 8, x: 0, y: 4)
            // Long-press: copiar o reportar la respuesta (moderación 1.2).
            .contextMenu {
                Button {
                    UIPasteboard.general.string = content
                } label: {
                    Label("Copiar", systemImage: "doc.on.doc")
                }
                Button(role: .destructive) {
                    openURL(Self.reportURL(for: content))
                } label: {
                    Label("Reportar respuesta", systemImage: "flag")
                }
            }
        }
    }
}

// MARK: - Typing indicator

/// "Nova está pensando" — onda minimalista de 3 puntos morados con phase
/// staggered + avatar que respira con leve glow. Hiper-minimalista,
/// sin label de copy extra (la presencia del avatar y los puntos basta).
struct NovaPulseTypingIndicator: View {
    @State private var pulse: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Theme.Colors.novaPrismGradient)
                    .frame(width: 28, height: 28)
                    .scaleEffect(pulse ? 1.06 : 0.96)
                    .shadow(
                        color: Theme.Colors.novaGlow.opacity(pulse ? 0.85 : 0.35),
                        radius: pulse ? 14 : 5
                    )
                    .animation(
                        .easeInOut(duration: 1.1).repeatForever(autoreverses: true),
                        value: pulse
                    )
                NovaSparkMark(size: 12)
            }
            .padding(.top, 4)

            VStack(alignment: .leading, spacing: 10) {
                Text("Nova")
                    .font(Theme.Typography.captionMono)
                    .tracking(Theme.Tracking.captionMono)
                    .foregroundStyle(Theme.Colors.novaLabelOnDark)
                    .textCase(.uppercase)

                HStack(spacing: 7) {
                    ForEach(0..<3) { i in
                        Circle()
                            .fill(Theme.Colors.novaPrismGradient)
                            .frame(width: 7, height: 7)
                            .scaleEffect(pulse ? 1.0 : 0.50)
                            .opacity(pulse ? 0.95 : 0.30)
                            .animation(
                                .easeInOut(duration: 0.74)
                                    .repeatForever(autoreverses: true)
                                    .delay(0.18 * Double(i)),
                                value: pulse
                            )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .opacity(pulse ? 1.0 : 0.85)
            .animation(
                .easeInOut(duration: 1.5).repeatForever(autoreverses: true),
                value: pulse
            )
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .environment(\.colorScheme, .dark)
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Theme.Colors.novaGlassFill)
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.20),
                                Color(red: 0.357, green: 0.302, blue: 1.000).opacity(0.12),
                                Color.white.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.7
                    )
            )

            Spacer(minLength: 12)
        }
        .onAppear { pulse = true }
    }
}

// MARK: - Glass input bar (dark)

/// Input bar flotante glass para el chat. Auto-expand multilínea (1...6),
/// botón mic glass, botón send con gradient morado + glow. Cuando recibe
/// focus, el borde se ilumina con tinte violet y el shadow se intensifica
/// — feedback claro de que la escritura está activa.
///
/// NO reutiliza FocusBarInput porque ese componente vive sobre fondo light
/// y es compartido con Mi Día / Calendario; cambiarlo rompería esos lugares.
struct NovaGlassInputBar: View {
    @Binding var text: String
    var placeholder: String = "Escríbele a Nova…"
    var onSubmit: () -> Void
    var onMic: () -> Void
    var isDictating: Bool = false
    var audioLevel: CGFloat = 0

    @FocusState private var isFocused: Bool
    @State private var dictationPulse: Bool = false

    private var canSubmit: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var diamondScale: CGFloat {
        guard isDictating else { return 1.0 }
        let clamped = max(0, min(1, audioLevel))
        return 1.0 + clamped * 0.25
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            inputRow
            if isDictating {
                FocusAudioVisualizer(
                    level: Float(audioLevel),
                    state: audioLevel > 0.08 ? .speaking : .listening,
                    maxBarHeight: 28
                )
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(Theme.Motion.easeInOutStandard, value: isDictating)
    }

    private var inputRow: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Nova Diamond Sparkle
            ZStack {
                if isDictating {
                    Circle()
                        .strokeBorder(
                            Theme.Colors.novaAccent.opacity(0.55),
                            lineWidth: 2
                        )
                        .frame(width: 30, height: 30)
                        .scaleEffect(dictationPulse ? 2.0 : 1.0)
                        .opacity(dictationPulse ? 0 : 0.9)
                        .animation(
                            .easeOut(duration: 1.4).repeatForever(autoreverses: false),
                            value: dictationPulse
                        )
                }
                Circle()
                    .fill(Theme.Colors.novaGradient)
                    .frame(width: 30, height: 30)
                    .shadow(
                        color: Theme.Colors.novaAccent.opacity(isDictating ? 0.7 : 0.35),
                        radius: isDictating ? 12 : 6,
                        y: 0
                    )
                NovaSparkMark(size: 13)
            }
            .scaleEffect(diamondScale)
            .animation(.easeOut(duration: 0.12), value: diamondScale)

            TextField(
                "",
                text: $text,
                prompt: Text(placeholder)
                    .foregroundStyle(Theme.Colors.novaTextOnDarkTertiary),
                axis: .vertical
            )
            .focused($isFocused)
            .font(.system(size: 16, weight: .regular))
            .foregroundStyle(Theme.Colors.novaTextOnDark)
            .tint(Theme.Colors.novaLabelOnDark)
            .lineLimit(1...6)
            .submitLabel(.send)
            .onSubmit {
                if canSubmit { onSubmit() }
            }
            .padding(.vertical, 6)
            // Sin `.toolbar(placement: .keyboard)`: el botón "Listo" que
            // SwiftUI montaba ahí flotaba encima del propio composer y
            // tapaba los botones mic + send. El usuario ya puede cerrar
            // el teclado tocando fuera del input (tap en `NovaChatBackdrop`)
            // o haciendo scroll en el chat.

            // Mic
            Button(action: onMic) {
                Image(systemName: isDictating ? "stop.fill" : "mic.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(
                        isDictating
                            ? Color.white
                            : Theme.Colors.novaTextOnDarkSecondary
                    )
                    .frame(width: 34, height: 34)
                    .background(
                        Circle().fill(
                            isDictating
                                ? AnyShapeStyle(Theme.Colors.novaPrismGradient)
                                : AnyShapeStyle(Color.white.opacity(0.07))
                        )
                    )
                    .overlay(
                        Circle()
                            .strokeBorder(
                                isDictating ? Theme.Colors.novaAccent.opacity(0.45) : Theme.Colors.novaGlassStroke,
                                lineWidth: isDictating ? 2.0 : 0.8
                            )
                            .scaleEffect(isDictating && dictationPulse ? 1.55 : 1.0)
                            .opacity(isDictating && dictationPulse ? 0 : 1)
                            .animation(
                                isDictating
                                    ? .easeOut(duration: 1.2).repeatForever(autoreverses: false)
                                    : .default,
                                value: dictationPulse
                            )
                    )
            }
            .buttonStyle(NovaGlowIconButtonStyle())
            .onChange(of: isDictating) { _, dictating in
                if dictating {
                    dictationPulse = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        dictationPulse = true
                    }
                } else {
                    dictationPulse = false
                }
            }

            // Send
            Button(action: {
                if canSubmit {
                    HapticManager.shared.tap()
                    onSubmit()
                }
            }) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(
                        Circle()
                            .fill(
                                canSubmit
                                    ? AnyShapeStyle(Theme.Colors.novaSendGradient)
                                    : AnyShapeStyle(Color.white.opacity(0.08))
                            )
                    )
                    .overlay(
                        Circle()
                            .strokeBorder(
                                canSubmit
                                    ? Color.white.opacity(0.30)
                                    : Theme.Colors.novaGlassStroke,
                                lineWidth: 0.8
                            )
                    )
                    .shadow(
                        color: canSubmit ? Theme.Colors.novaGlow : Color.clear,
                        radius: 14,
                        x: 0,
                        y: 5
                    )
                    .opacity(canSubmit ? 1.0 : 0.55)
            }
            .buttonStyle(NovaGlowIconButtonStyle())
            .disabled(!canSubmit)
            .animation(.easeInOut(duration: 0.18), value: canSubmit)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Color.white.opacity(0.04))
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(
                    isFocused
                        ? AnyShapeStyle(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.357, green: 0.302, blue: 1.000),
                                    Color(red: 0.220, green: 0.518, blue: 1.000)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        : AnyShapeStyle(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.22),
                                    Color.white.opacity(0.06)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        ),
                    lineWidth: isFocused ? 1.4 : 0.9
                )
        )
        .shadow(
            color: isFocused ? Color(red: 0.357, green: 0.302, blue: 1.000).opacity(0.35) : Color.black.opacity(0.25),
            radius: isFocused ? 20 : 10,
            x: 0,
            y: isFocused ? 8 : 4
        )
        .animation(Theme.Motion.easeInOutStandard, value: isFocused)
    }
}

/// Estilo de botón de ícono con leve scale al presionar — el "feel" táctil
/// que el rediseño pide ("transiciones suaves de mínimo 200ms").
struct NovaGlowIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
            .animation(.easeInOut(duration: 0.18), value: configuration.isPressed)
    }
}

// MARK: - Empty chat hero (dark friendly)

/// Hero del estado vacío del chat — versión dark del existente. Diamante
/// Nova grande con halo morado, título display blanco, copy plata, chips
/// glass capsulares para arrancar conversaciones.
struct NovaEmptyChatHeroDark: View {
    var onChip: (NovaQuickAction) -> Void
    var showLiveChip: Bool = false
    var onLive: (() -> Void)? = nil

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: Theme.Spacing.lg) {
                Spacer(minLength: Theme.Spacing.xxxl + Theme.Spacing.md)

                ZStack {
                    // Halo radial morado difuso alrededor del diamante.
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.486, green: 0.380, blue: 1.000).opacity(0.70),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 95
                            )
                        )
                        .frame(width: 200, height: 200)
                        .blur(radius: 22)

                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(Theme.Colors.novaPrismGradient)
                        .frame(width: 96, height: 96)
                        .overlay(
                            RoundedRectangle(cornerRadius: 26, style: .continuous)
                                .stroke(Color.white.opacity(0.32), lineWidth: 1)
                        )
                        .shadow(color: Theme.Colors.novaGlow, radius: 34, y: 14)
                        .shadow(color: Color(red: 0.220, green: 0.518, blue: 1.000).opacity(0.25), radius: 18, y: 4)
                    NovaSparkMark(size: 42)
                }
                .padding(.bottom, Theme.Spacing.sm)

                Text("¿Qué quieres ordenar?")
                    .font(Theme.Typography.displayHero)
                    .tracking(Theme.Tracking.displayHero)
                    .foregroundStyle(Theme.Colors.novaTextOnDark)
                    .multilineTextAlignment(.center)

                Text("Pídele a Nova un evento, una tarea, o que organice tu día.")
                    .font(Theme.Typography.body)
                    .tracking(Theme.Tracking.body)
                    .foregroundStyle(Theme.Colors.novaTextOnDarkSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .frame(maxWidth: 320)
                    .padding(.bottom, Theme.Spacing.lg)

                VStack(spacing: 10) {
                    if showLiveChip, let onLive {
                        liveChip(action: onLive)
                    }
                    chip(symbol: "sparkles", label: "Organizar mi día") {
                        onChip(.organizar)
                    }
                    chip(symbol: "checkmark.circle", label: "Crear tarea") {
                        onChip(.crearTarea)
                    }
                    chip(symbol: "calendar.badge.plus", label: "Agendar evento") {
                        onChip(.crearEvento)
                    }
                    chip(symbol: "tray.full", label: "Revisar pendientes") {
                        onChip(.revisarPendientes)
                    }
                }
                .padding(.horizontal, Theme.Spacing.xl)

                Spacer(minLength: Theme.Spacing.xl)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func chip(symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.Colors.novaLabelOnDark)
                Text(label)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.Colors.novaTextOnDark)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.Colors.novaTextOnDarkTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(
                ZStack {
                    Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark)
                    Capsule().fill(Theme.Colors.novaGlassFill)
                }
            )
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.25),
                            Color.white.opacity(0.07)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 0.7
                )
            )
            .shadow(color: Color.black.opacity(0.25), radius: 10, y: 4)
        }
        .buttonStyle(NovaGlowIconButtonStyle())
    }

    private func liveChip(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                Text("Hablar con Nova")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity)
            .background(
                Capsule()
                    .fill(Theme.Colors.novaSendGradient)
                    .shadow(color: Theme.Colors.novaGlow, radius: 16, y: 6)
            )
            .overlay(
                Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.8)
            )
        }
        .buttonStyle(NovaGlowIconButtonStyle())
    }
}
