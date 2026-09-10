import SwiftUI

/// A compact extension of the composer. Audio stays on device; sending the
/// reviewed text goes through the composer's existing consent and request flow.
struct VoiceDictationSheet: View {
    @StateObject private var service = NovaLiveService()
    @State private var retryTask: Task<Void, Never>?
    @State private var draft = ""
    @State private var prefix = ""
    @State private var contentHeight: CGFloat = 330
    @State private var selectedDetent: PresentationDetent = .height(330)
    @FocusState private var editing: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var initialText = ""
    var onTranscript: (String) -> Void
    var onSend: ((String) -> Void)? = nil

    private var busy: Bool {
        service.state == .listening || service.state == .processing || service.state == .requestingPermissions
    }
    private var canUseText: Bool { !busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(AssistantBrand.displayName).font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Spacer(minLength: 8)
                    Button { cancelDictation(); dismiss() } label: {
                        Image(systemName: "xmark").font(.body.weight(.medium)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain).foregroundStyle(Theme.Colors.textSecondary)
                    .accessibilityLabel("Cancelar dictado").accessibilityIdentifier("voice.cancel")
                }

                HilanteLivingMark(phase: markPhase, level: service.isSpeaking ? service.audioLevel : 0, size: 82)
                    .frame(maxWidth: .infinity).frame(height: 96)
                    .accessibilityHidden(false)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(statusTitle)
                    .accessibilityIdentifier("voice.status")

                TextField("Di lo que necesitas…", text: $draft, axis: .vertical)
                    .font(.title3.weight(.regular)).foregroundStyle(Theme.Colors.textPrimary)
                    .lineLimit(1...5).focused($editing)
                    .disabled(busy).textInputAutocapitalization(.sentences)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .accessibilityLabel(busy ? "Transcripción en vivo" : "Editar transcripción")
                    .accessibilityIdentifier("voice.transcript")
                    .onChange(of: editing) { _, value in
                        if value { selectedDetent = .large }
                    }

                if let message = message {
                    Text(message).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("voice.error")
                } else {
                    Text(busy ? "El audio se transcribe en este iPhone." : "Puedes corregir el texto antes de enviarlo.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                controls
            }
            .padding(.horizontal, 24).padding(.top, 6).padding(.bottom, 24)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(key: DictationHeightKey.self, value: geometry.size.height)
                }
            }
        }
        .background(Theme.Colors.background)
        .onPreferenceChange(DictationHeightKey.self) { height in
            let next = min(560, max(300, ceil(height)))
            guard abs(contentHeight - next) > 1 else { return }
            contentHeight = next
            if !editing && !dynamicTypeSize.isAccessibilitySize { selectedDetent = .height(next) }
        }
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(contentHeight), .large], selection: $selectedDetent)
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(28)
        .task {
            if dynamicTypeSize.isAccessibilitySize { selectedDetent = .large }
            draft = initialText
            #if DEBUG
            if CommandLine.arguments.contains("--ui-testing"),
               let fixture = CommandLine.arguments.first(where: { $0.hasPrefix("--voice-preview=") }) {
                switch fixture.split(separator: "=").last {
                case "denied": service.state = .denied
                case "processing": service.state = .processing
                case "listening":
                    service.beginListening(at: ProcessInfo.processInfo.systemUptime)
                    for _ in 0..<3 { service.receiveAudioLevel(0.7, generation: service.sessionGeneration) }
                default: draft = "tengo que salir a las 3:20"
                }
                return
            }
            #endif
            await startDictation()
        }
        .onChange(of: service.transcript) { _, transcript in
            draft = [prefix, transcript].filter { !$0.isEmpty }.joined(separator: " ")
        }
        .onChange(of: service.state) { old, new in
            guard scenePhase == .active else { return }
            if old == .processing && new == .idle { HapticManager.shared.tick() }
            if case .error = new { HapticManager.shared.warning() }
            if new == .denied && old != .denied { HapticManager.shared.warning() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                retryTask?.cancel(); retryTask = nil
                service.pauseForInterruption(.background)
                editing = false
            }
        }
        .onDisappear { cancelDictation() }
    }

    @ViewBuilder private var controls: some View {
        if service.state == .listening {
            HStack {
                Spacer()
                Button { service.stop() } label: {
                    Label("Listo", systemImage: "stop.fill")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 20).frame(minHeight: 46)
                        .background(Theme.Colors.focusAccentSoft, in: Capsule())
                }
                .buttonStyle(.plain).foregroundStyle(Theme.Colors.focusAccent)
                .accessibilityLabel("Terminar dictado").accessibilityIdentifier("voice.stop")
                Spacer()
            }
        } else if !busy {
            if service.state == .denied {
                Button("Abrir Ajustes del iPhone") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.bordered).frame(minHeight: 44).accessibilityIdentifier("voice.settings")
            }
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 12))
            layout {
                if service.state != .denied {
                    Button {
                        editing = false
                        retryTask?.cancel()
                        retryTask = Task { await startDictation() }
                    } label: {
                        Label(canUseText ? "Dictar más" : "Dictar", systemImage: "mic")
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered).accessibilityIdentifier("voice.retry")
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                if canUseText {
                    Button {
                        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        editing = false
                        cancelDictation()
                        if let onSend { onSend(text) } else { onTranscript(text) }
                        dismiss()
                    } label: {
                        Label(onSend == nil ? "Usar texto" : "Enviar", systemImage: "arrow.up")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 20).frame(minHeight: 46)
                            .foregroundStyle(.white).background(Theme.Colors.actionGradient, in: Capsule())
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("voice.use")
                }
            }
            if canUseText && onSend != nil {
                Button("Volver al texto") {
                    let text = draft
                    cancelDictation(); onTranscript(text); dismiss()
                }
                .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityIdentifier("voice.review")
            }
        }
    }

    private func cancelDictation() {
        retryTask?.cancel(); retryTask = nil
        service.cancel()
    }

    private func startDictation() async {
        prefix = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        HapticManager.shared.tick()
        await service.beginDictation()
    }

    private var markPhase: HilanteLivingMark.Phase {
        switch service.state {
        case .listening: return .listening
        case .processing, .requestingPermissions: return .processing
        case .idle: return canUseText ? .ready : .resting
        case .denied, .error: return .unavailable
        }
    }

    private var statusTitle: String {
        switch service.state {
        case .listening: return service.isPausedForSilence ? "Una pausa. Sigue cuando quieras." : "Te escucho"
        case .processing: return "Terminando el dictado"
        case .requestingPermissions: return "Vamos a activar tu voz"
        case .denied: return "Puedes seguir escribiendo"
        case .error: return "Probemos otra vez"
        case .idle: return canUseText ? "Revisa y envía" : "Tu voz, en palabras"
        }
    }

    private var message: String? {
        if case .error(let message) = service.state { return message }
        if service.state == .denied { return "Activa Micrófono y Reconocimiento de voz para dictar. También puedes cerrar y escribir." }
        return service.notice
    }
}

private struct DictationHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
