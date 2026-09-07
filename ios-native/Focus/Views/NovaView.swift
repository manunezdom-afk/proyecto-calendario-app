import SwiftUI

/// El historial explica las acciones; la captura se comparte con Hoy.
struct NovaView: View {
    @EnvironmentObject private var store: FocusDataStore
    @EnvironmentObject private var nav: NavigationCoordinator
    @State private var draft = ""

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        if store.novaMessages.isEmpty { introduction }
                        ForEach(store.novaMessages) { message in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(message.role == .user ? "TÚ" : "NOVA")
                                    .font(.caption2.weight(.semibold)).tracking(1.2)
                                    .foregroundStyle(.secondary)
                                Text(message.content).font(.body).textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if !message.actionLabels.isEmpty {
                                    ForEach(Array(message.actionLabels.enumerated()), id: \.offset) { _, label in
                                        Label(label, systemImage: "checkmark.circle.fill")
                                            .font(.subheadline).foregroundStyle(Theme.Colors.success)
                                    }
                                }
                            }
                            .padding(message.role == .user ? 16 : 0)
                            .background(message.role == .user ? Theme.Colors.surface : .clear,
                                        in: RoundedRectangle(cornerRadius: 16))
                            .accessibilityElement(children: .combine)
                            .id(message.id)
                        }
                        NovaFeedbackView(showLatestReply: false)
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.novaMessages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .onChange(of: store.isNovaTyping) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    NovaCaptureField(text: $draft, identifier: "nova", placeholder: "Escribe lo que necesitas…") {}
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Theme.Colors.background)
                }
            }
            .background(Theme.Colors.background)
            .navigationTitle("Nova")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { nav.openSettings() } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ajustes")
                }
            }
            .onAppear(perform: consumePrompt)
            .onChange(of: nav.pendingNovaPrompt) { _, _ in consumePrompt() }
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Dilo. Dale un lugar.").font(.largeTitle.weight(.bold))
            Text("Convierte lo que tienes en mente en tareas, eventos y recordatorios. Puedes corregir o continuar una petición aquí.")
                .font(.body).foregroundStyle(.secondary)
            ForEach(["Tengo que estudiar economía mañana", "Reunión mañana a las 10", "Ordena mis pendientes"], id: \.self) { prompt in
                Button { draft = prompt } label: {
                    HStack { Text(prompt); Spacer(); Image(systemName: "arrow.up.left") }
                        .font(.subheadline).padding(16)
                        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
            if store.syncCredentials == nil {
                Label("En este iPhone: captura sencilla sin conexión. Inicia sesión para usar Nova en la nube.", systemImage: "iphone")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.top, 16)
    }

    private func consumePrompt() {
        guard let text = nav.pendingNovaPrompt else { return }
        draft = text
        nav.pendingNovaPrompt = nil
    }
}

/// Puerta de captura única: preserva el borrador, pide consentimiento cuando
/// corresponde y usa el mismo ejecutor tanto en Hoy como en Nova.
struct NovaCaptureField: View {
    @EnvironmentObject private var store: FocusDataStore
    @Binding var text: String
    var identifier: String
    var placeholder: String
    var onSend: () -> Void
    @FocusState private var focused: Bool
    @State private var showVoice = false
    @State private var showConsent = false
    @State private var pendingText: String?

    private let maxLength = 1800
    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        text.count <= maxLength && !store.isNovaTyping && store.novaPendingProposal == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 4) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .font(.body).lineLimit(1...5).focused($focused)
                    .submitLabel(.send).onSubmit { submit() }
                    .padding(.vertical, 12).padding(.leading, 16)
                    .accessibilityLabel("Escribe a Nova").accessibilityIdentifier("\(identifier).input")
                Button { focused = false; showVoice = true } label: {
                    Image(systemName: "mic").font(.body.weight(.medium)).frame(width: 44, height: 48)
                }.buttonStyle(.plain).foregroundStyle(.secondary)
                    .accessibilityLabel("Dictar").accessibilityIdentifier("\(identifier).voice")
                    .disabled(store.isNovaTyping)
                Button(action: submit) {
                    Image(systemName: "arrow.up").font(.body.weight(.semibold))
                        .foregroundStyle(canSend ? Color.white : Theme.Colors.textSecondary)
                        .frame(width: 40, height: 40)
                        .background(canSend ? Theme.Colors.focusAccent : Theme.Colors.surfaceHigh, in: Circle())
                        .frame(width: 48, height: 48)
                }.buttonStyle(.plain).disabled(!canSend)
                    .accessibilityLabel("Enviar a Nova").accessibilityIdentifier("\(identifier).send")
            }
            .padding(4)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(focused ? Theme.Colors.focusAccent : Theme.Colors.border, lineWidth: 1))
            if text.count > maxLength {
                Text("Haz tu mensaje un poco más corto (máximo \(maxLength) caracteres).")
                    .font(.caption).foregroundStyle(Theme.Colors.danger)
            }
        }
        .sheet(isPresented: $showVoice) {
            VoiceDictationSheet { transcript in text = transcript }
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showConsent, onDismiss: { pendingText = nil }) {
            NovaAIConsentSheet {
                NovaAIConsent.grant()
                let value = pendingText
                pendingText = nil; showConsent = false
                if let value { send(value) }
            } onDecline: {
                pendingText = nil; showConsent = false
            }
        }
    }

    private func submit() {
        guard canSend else { return }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if store.syncCredentials != nil && !NovaAIConsent.granted {
            pendingText = value; focused = false; showConsent = true
        } else { send(value) }
    }

    private func send(_ value: String) {
        guard !store.isNovaTyping else { return }
        focused = false
        text = ""
        onSend()
        store.sendNovaMessage(value)
    }
}

/// Mismo estado de progreso, propuesta y recuperación en ambas superficies.
struct NovaFeedbackView: View {
    @EnvironmentObject private var store: FocusDataStore
    var showLatestReply: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.isNovaTyping {
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    Text("Organizando tu petición…").font(.subheadline)
                    Spacer()
                    Button("Cancelar") { store.cancelNovaRequest() }.font(.subheadline).frame(minHeight: 44)
                }.accessibilityIdentifier("nova.progress")
            } else if showLatestReply, let reply = store.novaMessages.last, reply.role == .nova {
                Text(reply.content).font(.subheadline).foregroundStyle(.primary)
                    .textSelection(.enabled).accessibilityIdentifier("capture.result")
            }
            if let proposal = store.novaPendingProposal {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Revisa antes de aplicar").font(.headline)
                    Text(proposal.summary).font(.subheadline)
                    ForEach(Array(proposal.actionLabels.enumerated()), id: \.offset) { _, label in
                        Label(label, systemImage: "arrow.right").font(.subheadline)
                    }
                    HStack {
                        Button("Aplicar") { store.confirmNovaProposal() }
                            .buttonStyle(.borderedProminent).accessibilityIdentifier("nova.confirm")
                        Button("Descartar") { store.cancelNovaProposal() }
                            .buttonStyle(.bordered).accessibilityIdentifier("nova.discard")
                    }.controlSize(.large)
                }.padding(16).background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: 16))
            }
            if let error = store.novaErrorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label(error, systemImage: "exclamationmark.circle").font(.subheadline)
                    if store.novaLastFailedInput != nil {
                        Button("Reintentar") { store.retryNovaMessage() }
                            .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                            .accessibilityIdentifier("nova.retry")
                    }
                }.foregroundStyle(Theme.Colors.danger).accessibilityIdentifier("nova.error")
            }
        }.accessibilityElement(children: .contain)
    }
}
