import SwiftUI
import UIKit

/// Home is a glance at the present. History is never mutated by this policy.
enum HomeReplyPhase: Equatable {
    case fresh, compact, hidden

    static func resolve(_ message: NovaMessage, now: Date = Date(), contextChanged: Bool = false,
                        calendar: Calendar = .current) -> Self {
        let age = now.timeIntervalSince(message.timestamp)
        guard message.role == .nova, age >= 0, calendar.isDate(message.timestamp, inSameDayAs: now),
              !contextChanged else { return .hidden }
        if age < 90 { return .fresh }
        // Execution receipts belong in history once the immediate acknowledgement has passed.
        guard message.actionLabels.isEmpty, age < 600 else { return .hidden }
        return .compact
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
        view.placeholderLabel.text = placeholder
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
            let natural = sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height
            let target = min(min(160, line * 5 + 14), max(line + 14, natural))
            placeholderLabel.frame = CGRect(x: 0, y: 7, width: bounds.width,
                height: placeholderLabel.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
            heightChanged?(ceil(target))
        }
    }
}

struct HilanteThinkingMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        FocusMark(size: 38)
            .scaleEffect(reduceMotion ? 1 : (breathing ? 1.04 : 0.96))
            .opacity(reduceMotion ? 1 : (breathing ? 1 : 0.65))
            .animation(reduceMotion ? nil : .easeInOut(duration: 1.15).repeatForever(autoreverses: true), value: breathing)
            .onAppear { breathing = true }
            .onDisappear { breathing = false }
    }
}

#if DEBUG
/// Opt-in synthetic UI states. No credentials, transport, or persisted conversation.
@MainActor
enum HilantePresentationFixture {
    static func install(in store: FocusDataStore) {
        let args = CommandLine.arguments
        if args.contains("--ui-testing"), let preview = args.first(where: { $0.hasPrefix("--home-preview=") }) {
            let day = Calendar.current.startOfDay(for: Date())
            NovaResponder.testReferenceDate = day.addingTimeInterval(10 * 3600)
            if store.tasks.isEmpty && store.events.isEmpty && store.novaMessages.isEmpty {
                let mode = String(preview.split(separator: "=").last ?? "")
                let count = mode == "three" ? 3 : mode == "one" ? 1 : 0
                for title in ["Cerrar la propuesta", "Revisar el presupuesto", "Preparar la reunión"].prefix(count) {
                    _ = store.addTask(FocusTask(title: title, priority: .alta, dueDate: day))
                }
                if mode == "agenda" {
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
    }
}
#endif
