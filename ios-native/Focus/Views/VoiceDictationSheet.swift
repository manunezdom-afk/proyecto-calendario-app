import SwiftUI

/// A compact extension of the composer. Audio stays on device; sending the
/// reviewed text goes through the composer's existing consent and request flow.
struct VoiceDictationSheet: View {
    @StateObject private var service = NovaLiveService()
    @State private var retryTask: Task<Void, Never>?
    @State private var draft = ""
    @State private var prefix = ""
    @State private var selectedDetent: PresentationDetent = .height(390)
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
                HStack(spacing: 10) {
                    FocusMark(size: 28).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Tu voz en Focus").font(.headline)
                        Text(statusTitle).font(.subheadline).foregroundStyle(.secondary)
                            .accessibilityIdentifier("voice.status")
                    }
                    Spacer(minLength: 8)
                    Button { cancelDictation(); dismiss() } label: {
                        Image(systemName: "xmark").font(.body.weight(.medium)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain).foregroundStyle(Theme.Colors.textSecondary)
                    .accessibilityLabel("Cancelar dictado").accessibilityIdentifier("voice.cancel")
                }

                if service.state == .listening {
                    DictationWaveform(samples: service.audioSamples, level: service.audioLevel,
                        speaking: service.isSpeaking, reduceMotion: reduceMotion)
                        .frame(height: 40)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(service.isSpeaking ? "Voz detectada" : "Micrófono activo")
                        .accessibilityIdentifier("voice.waveform")
                } else if service.state == .processing || service.state == .requestingPermissions {
                    ProgressView(service.state == .processing ? "Terminando el texto…" : "Preparando el micrófono…")
                        .font(.subheadline).frame(maxWidth: .infinity, minHeight: 40)
                }

                TextField("Di lo que necesitas…", text: $draft, axis: .vertical)
                    .font(.title3.weight(.regular)).foregroundStyle(Theme.Colors.textPrimary)
                    .lineLimit(3...7).focused($editing)
                    .disabled(busy).textInputAutocapitalization(.sentences)
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 18))
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
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 20)
        }
        .background(Theme.Colors.background)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(390), .large], selection: $selectedDetent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .task {
            if dynamicTypeSize.isAccessibilitySize { selectedDetent = .large }
            draft = initialText
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
            Button { service.stop() } label: {
                Label("Terminar", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(FocusPrimaryButtonStyle()).accessibilityIdentifier("voice.stop")
        } else if !busy {
            if service.state == .denied {
                Button("Abrir Ajustes del iPhone") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.bordered).frame(minHeight: 44).accessibilityIdentifier("voice.settings")
            }
            HStack(spacing: 12) {
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
                if canUseText {
                    Button {
                        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        editing = false
                        cancelDictation()
                        if let onSend { onSend(text) } else { onTranscript(text) }
                        dismiss()
                    } label: {
                        Label(onSend == nil ? "Usar texto" : "Enviar", systemImage: "arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(FocusPrimaryButtonStyle()).accessibilityIdentifier("voice.use")
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

/// A rolling history of measured microphone amplitude. Silence is flat; there
/// is no idle oscillator. Reduce Motion uses a static microphone indicator.
private struct DictationWaveform: View {
    let samples: [Float]
    let level: Float
    let speaking: Bool
    let reduceMotion: Bool

    var body: some View {
        Group {
            if reduceMotion {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                    Text(speaking ? "Recibiendo tu voz" : "Escuchando").font(.subheadline)
                }
                .frame(maxWidth: .infinity)
            } else {
                GeometryReader { geometry in
                    HStack(alignment: .center, spacing: 4) {
                        ForEach(samples.indices, id: \.self) { index in
                            Capsule()
                                .fill(Theme.Colors.focusAccent)
                                .frame(width: max(2, (geometry.size.width - CGFloat(samples.count - 1) * 4) / CGFloat(samples.count)),
                                       height: 3 + CGFloat(samples[index]) * 35)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.linear(duration: 0.09), value: samples)
                }
            }
        }
        .foregroundStyle(Theme.Colors.focusAccent)
    }
}
