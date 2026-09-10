import SwiftUI
import UIKit
import CryptoKit

/// A presentation receipt, scoped to the account. Never owns domain mutations
/// or conversation text. Hidden is terminal for this exact message identity.
struct HomeReplyState: Codable, Equatable {
    enum HiddenReason: String, Codable { case dismissed, expired, contextChanged, superseded }
    let messageID: UUID
    let timestamp: Date
    let compactAt: Date
    let expiresAt: Date
    let context: String
    var hiddenReason: HiddenReason?

    init(message: NovaMessage, context: String, calendar: Calendar = .current) {
        messageID = message.id
        timestamp = message.timestamp
        compactAt = timestamp.addingTimeInterval(90)
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: timestamp))
            ?? timestamp.addingTimeInterval(600)
        expiresAt = min(timestamp.addingTimeInterval(message.actionLabels.isEmpty ? 600 : 90), midnight)
        self.context = context
    }

    func phase(at now: Date) -> HomeReplyPhase {
        guard hiddenReason == nil, now >= timestamp, now < expiresAt else { return .hidden }
        return now < compactAt ? .fresh : .compact
    }

    /// Stable across processes, array ordering and nonsemantic sync metadata.
    static func context(tasks: [FocusTask], events: [FocusEvent]) -> String {
        struct Snapshot: Encodable { let tasks: [FocusTask]; let events: [FocusEvent] }
        let normalized = events.map { event in
            var copy = event
            copy.lastSyncedAt = nil
            copy.externalCalendarColorHex = nil
            return copy
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let snapshot = Snapshot(tasks: tasks.sorted { $0.id.uuidString < $1.id.uuidString },
                                events: normalized.sorted { $0.id.uuidString < $1.id.uuidString })
        return SHA256.hash(data: (try? encoder.encode(snapshot)) ?? Data()).map { String(format: "%02x", $0) }.joined()
    }
}

/// Home is a glance at the present. History is never mutated by this policy.
enum HomeReplyPhase: Equatable {
    case fresh, compact, hidden

    static func resolve(_ message: NovaMessage, now: Date = Date(), contextChanged: Bool = false,
                        calendar: Calendar = .current) -> Self {
        guard message.role == .nova, !contextChanged else { return .hidden }
        return HomeReplyState(message: message, context: "", calendar: calendar).phase(at: now)
    }
}

/// Small native blocks, with inline Markdown handled by Foundation (no web view).
struct HilanteText: View {
    let content: String
    var compact = false

    struct Block: Identifiable {
        let id: Int
        var text: String
        var marker: String?
        var heading = false
    }

    static func blocks(_ content: String) -> [Block] {
        content.components(separatedBy: .newlines).enumerated().compactMap { index, line in
            let text = line.trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty, !text.hasPrefix("```") else { return nil }
            if let range = text.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                return Block(id: index, text: String(text[range.upperBound...]), heading: true)
            }
            if let range = text.range(of: #"^(?:[-*+] |\d+[.)] )"#, options: .regularExpression) {
                let prefix = String(text[range]).trimmingCharacters(in: .whitespaces)
                return Block(id: index, text: String(text[range.upperBound...]),
                             marker: prefix.first?.isNumber == true ? prefix : "•")
            }
            return Block(id: index, text: text)
        }
    }

    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 10) {
            ForEach(Self.blocks(content)) { block in
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    if let marker = block.marker {
                        Text(marker).foregroundStyle(Theme.Colors.textSecondary)
                            .frame(minWidth: 12, alignment: .leading).accessibilityHidden(true)
                    }
                    Text(Self.inline(block.text))
                        .fontWeight(block.heading ? .semibold : .regular)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(block.heading ? .isHeader : [])
                }
            }
        }
        .font(compact ? .subheadline : .body)
        .foregroundStyle(Theme.Colors.textPrimary)
        .lineSpacing(2)
        .textSelection(.enabled)
    }
}

/// One UIKit text system owns glyphs, placeholder, selection and caret scrolling.
/// Only the outer height animates; editing never cross-fades text snapshots.
struct HilanteTextInput: UIViewRepresentable {
    var text: String
    var focused: Bool
    var onTextChange: (String) -> Void
    var onFocusChange: (Bool) -> Void
    @Binding var height: CGFloat
    var placeholder: String
    var identifier: String
    @Environment(\.sizeCategory) private var sizeCategory

    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.adjustsFontForContentSizeCategory = true
        view.textColor = .label
        view.tintColor = UIColor(Theme.Colors.focusAccent)
        view.textContainerInset = UIEdgeInsets(top: 7, left: 0, bottom: 7, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.keyboardDismissMode = .interactive
        view.returnKeyType = .default
        view.accessibilityLabel = "Escribe a Hilante"
        view.accessibilityIdentifier = identifier
        view.heightChanged = { [weak coordinator = context.coordinator] value in
            DispatchQueue.main.async {
                guard let coordinator, abs(coordinator.parent.height - value) > 0.5 else { return }
                coordinator.parent.height = value
            }
        }
        return view
    }

    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.parent = self
        // Resetting font/text during marked-text composition can invalidate glyph layout.
        let font = UIFont.preferredFont(forTextStyle: .body)
        if view.font != font { view.font = font }
        // End editing before applying an external clear (send/dictation).
        if !focused && view.isFirstResponder { view.resignFirstResponder() }
        // While editing, UIKit is authoritative. A queued SwiftUI height update
        // can carry an older binding value; replaying it here duplicates glyphs
        // or restores characters that the user just deleted.
        if text.isEmpty && !view.text.isEmpty {
            // Sending is an explicit clear, including any pending marked text.
            view.unmarkText()
            view.text = ""
        } else if !view.isFirstResponder && view.text != text && view.markedTextRange == nil {
            view.text = text
        }
        view.placeholderLabel.text = sizeCategory.isAccessibilityCategory ? "Escribe aquí…" : placeholder
        view.refreshLayout()
        if focused && !view.isFirstResponder { view.becomeFirstResponder() }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: HilanteTextInput
        init(_ parent: HilanteTextInput) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) {
            (textView as? ComposerTextView)?.refreshLayout()
            parent.onTextChange(textView.text)
        }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.onFocusChange(true) }
        func textViewDidEndEditing(_ textView: UITextView) { parent.onFocusChange(false) }
    }

    final class ComposerTextView: UITextView {
        let placeholderLabel = UILabel()
        var heightChanged: ((CGFloat) -> Void)?
        override init(frame: CGRect, textContainer: NSTextContainer?) {
            super.init(frame: frame, textContainer: textContainer)
            font = .preferredFont(forTextStyle: .body)
            placeholderLabel.numberOfLines = 0
            placeholderLabel.textColor = .secondaryLabel
            placeholderLabel.isUserInteractionEnabled = false
            placeholderLabel.isAccessibilityElement = false
            addSubview(placeholderLabel)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func layoutSubviews() {
            super.layoutSubviews()
            refreshLayout()
        }
        func refreshLayout() {
            // Hidden synchronously with UIKit's edit, without a SwiftUI removal transition.
            placeholderLabel.isHidden = !text.isEmpty
            placeholderLabel.font = font
            guard bounds.width > 0 else { return }
            let line = font?.lineHeight ?? 22
            let placeholderHeight = text.isEmpty
                ? placeholderLabel.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height + 14 : 0
            let natural = max(placeholderHeight, sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
            let target = min(min(160, line * 5 + 14), max(line + 14, natural))
            placeholderLabel.frame = CGRect(x: 0, y: 7, width: bounds.width,
                height: placeholderLabel.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
            heightChanged?(ceil(target))
        }
    }
}

/// Focus's two interlaced strokes. Listening geometry is driven only by measured
/// energy; autonomous movement is reserved for processing, while visible/active.
struct HilanteLivingMark: View {
    enum Phase { case resting, listening, processing, ready, unavailable }
    let phase: Phase
    var level: Float = 0
    var size: CGFloat = 84
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var energy: CGFloat {
        guard phase == .listening, !reduceMotion, level.isFinite else { return 0 }
        return CGFloat(min(max(level, 0), 1))
    }

    var body: some View {
        ZStack {
            Ellipse()
                .fill(Theme.Colors.accentGradient.opacity(phase == .resting ? 0.09 : 0.12 + energy * 0.16))
                .frame(width: size * (1.3 + energy * 0.25), height: size * (0.9 + energy * 0.3))
                .blur(radius: size * 0.3)
            if phase == .processing && !reduceMotion && scenePhase == .active {
                HilanteProcessingGlyph(size: size)
            } else {
                HilanteMarkGlyph(size: size, energy: energy, sweep: 0)
                    .scaleEffect(phase == .ready && !reduceMotion ? 0.92 : 1)
            }
            if phase == .ready || phase == .unavailable || (phase == .listening && reduceMotion) {
                Image(systemName: phase == .ready ? "checkmark" : phase == .unavailable ? "mic.slash" : "mic.fill")
                    .font(.system(size: size * 0.17, weight: .semibold))
                    .foregroundStyle(Theme.Colors.focusAccent)
                    .padding(6).background(Theme.Colors.background, in: Circle())
                    .offset(x: size * 0.4, y: size * 0.3)
            }
        }
        .frame(width: size, height: size)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: energy)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: phase)
        .accessibilityHidden(true)
    }
}

private struct HilanteMarkGlyph: View {
    let size: CGFloat
    let energy: CGFloat
    let sweep: CGFloat
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * (0.18 + energy * 0.06), style: .continuous)
                .stroke(Theme.Colors.accentGradient, style: StrokeStyle(lineWidth: size * 0.054, lineCap: .round))
                .frame(width: size * (0.47 + energy * 0.06), height: size * (0.61 + energy * 0.12))
                .rotationEffect(.degrees(38 + energy * 13 + sweep * 9))
            RoundedRectangle(cornerRadius: size * (0.18 + energy * 0.04), style: .continuous)
                .trim(from: 0.08, to: 0.78)
                .stroke(Theme.Colors.accentGradient, style: StrokeStyle(lineWidth: size * 0.054, lineCap: .round))
                .frame(width: size * (0.47 + energy * 0.08), height: size * (0.61 + energy * 0.06))
                .rotationEffect(.degrees(-38 - energy * 11 + sweep * 9))
        }
    }
}

private struct HilanteProcessingGlyph: View {
    let size: CGFloat
    @State private var moving = false
    var body: some View {
        HilanteMarkGlyph(size: size, energy: 0, sweep: moving ? 1 : -1)
            .scaleEffect(moving ? 1.04 : 0.96)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { moving = true }
            }
    }
}

struct HilanteThinkingMark: View {
    var body: some View {
        HilanteLivingMark(phase: .processing, size: 38)
    }
}

#if DEBUG
/// Opt-in synthetic UI states in the isolated UI-test partition. No transport.
@MainActor
enum HilantePresentationFixture {
    static func install(in store: FocusDataStore) {
        let args = CommandLine.arguments
        if args.contains("--ui-testing") {
            if args.contains("--appearance=dark") { store.settings.appearance = .dark }
            if args.contains("--appearance=light") { store.settings.appearance = .light }
        }
        if args.contains("--ui-testing"), let preview = args.first(where: { $0.hasPrefix("--home-preview=") }) {
            let day = Calendar.current.startOfDay(for: Date())
            NovaResponder.testReferenceDate = day.addingTimeInterval(10 * 3600)
            if store.tasks.isEmpty && store.events.isEmpty && store.novaMessages.isEmpty {
                let mode = String(preview.split(separator: "=").last ?? "")
                let count = ["three", "activities"].contains(mode) ? 3 : mode == "one" ? 1 : 0
                for title in ["Cerrar la propuesta", "Revisar el presupuesto", "Preparar la reunión"].prefix(count) {
                    _ = store.addTask(FocusTask(title: title, priority: .alta, dueDate: day))
                }
                if ["agenda", "activities"].contains(mode) {
                    _ = store.addEvent(FocusEvent(title: "Reunión de equipo", startTime: day.addingTimeInterval(10.5 * 3600),
                        endTime: day.addingTimeInterval(11 * 3600), section: .reunion))
                }
            }
        }
        guard args.contains("--ui-testing"), let flag = args.first(where: { $0.hasPrefix("--hilante-preview=") }),
              store.novaMessages.isEmpty else { return }
        let mode = String(flag.split(separator: "=").last ?? "")
        let content = mode == "short" ? "Tu siguiente paso: **revisar la propuesta**." : """
        ### Un paso a la vez
        Empieza por **revisar la propuesta**. Tienes espacio para avanzar con calma.

        - Lee las notas y marca lo esencial.
        - Prepara **tres ideas** para la reunión.
        - Deja los detalles para después.

        ### Después
        1. Revisa lo que falta por resolver.
        2. Reserva un momento para cerrar el día.

        No necesitas hacerlo todo ahora. Elige un paso pequeño y continúa desde ahí.
        """
        let age: TimeInterval = mode == "expired" ? 601 : mode == "compact" ? 100 : mode == "expiring" ? 580 : 0
        store.novaMessages = [NovaMessage(role: .user, content: "Ayúdame a ordenar el día"),
                              NovaMessage(role: .nova, content: content, timestamp: Date().addingTimeInterval(-age))]
        if mode == "thinking" { store.novaMessages.removeLast(); store.isNovaTyping = true }
        FocusLocalStore.saveSync(store.novaMessages, forKey: .novaMessages)
    }
}
#endif
