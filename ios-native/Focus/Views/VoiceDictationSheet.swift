import SwiftUI

struct VoiceDictationSheet: View {
    @StateObject private var service = NovaLiveService()
    @State private var retryTask: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    var onTranscript: (String) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: service.state == .listening ? "waveform" : "mic")
                        .font(.system(size: 40, weight: .light)).foregroundStyle(Theme.Colors.focusAccent)
                        .frame(maxWidth: .infinity).padding(.top, 24).accessibilityHidden(true)
                    Text(statusTitle).font(.title2.weight(.semibold))
                    if !service.transcript.isEmpty {
                        Text(service.transcript).font(.body).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16).background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 16))
                            .accessibilityIdentifier("voice.transcript")
                    }
                    if let error = errorMessage {
                        Text(error).font(.body).foregroundStyle(.secondary).accessibilityIdentifier("voice.error")
                    } else {
                        Text("El audio se transcribe en este iPhone. Revisa el texto antes de enviarlo.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }.padding(24)
            }
            .background(Theme.Colors.background)
            .navigationTitle("Dictado").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cancelDictation(); dismiss() }.accessibilityIdentifier("voice.cancel")
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    if service.state == .listening {
                        Button("Terminar dictado") { service.stop() }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                    } else if service.state == .processing || service.state == .requestingPermissions {
                        ProgressView("Preparando el texto…")
                    } else if !service.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button("Usar este texto") {
                            let text = service.transcript
                            cancelDictation(); onTranscript(text); dismiss()
                        }.buttonStyle(.borderedProminent).controlSize(.large).accessibilityIdentifier("voice.use")
                    } else if service.state == .idle || errorMessage != nil && service.state != .denied {
                        Button("Volver a dictar") {
                            retryTask?.cancel()
                            retryTask = Task { await startDictation() }
                        }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .accessibilityIdentifier("voice.retry")
                    } else if service.state == .denied {
                        Button("Abrir Ajustes del iPhone") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }.buttonStyle(.bordered).controlSize(.large)
                    }
                }.frame(maxWidth: .infinity).padding(20).background(Theme.Colors.background)
            }
            .task { await startDictation() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { cancelDictation() } }
            .onDisappear { cancelDictation() }
        }
    }

    private func cancelDictation() {
        retryTask?.cancel()
        retryTask = nil
        service.cancel()
    }

    private func startDictation() async {
        await service.beginDictation()
    }

    private var statusTitle: String {
        switch service.state {
        case .listening: return "Te escucho."
        case .processing: return "Terminando el dictado…"
        case .requestingPermissions: return "Permiso para dictar"
        case .denied: return "Puedes seguir escribiendo."
        case .error: return "El dictado no está disponible."
        case .idle: return service.transcript.isEmpty ? "Tu voz, en palabras." : "Revisa tu texto."
        }
    }

    private var errorMessage: String? {
        if case .error(let message) = service.state { return message }
        if service.state == .denied { return "Focus necesita permiso de micrófono y reconocimiento de voz para dictar. Puedes activarlos en Ajustes o cerrar y escribir." }
        return nil
    }
}
