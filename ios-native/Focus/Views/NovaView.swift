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
                    LazyVStack(alignment: .leading, spacing: 28) {
                        if store.novaMessages.isEmpty { introduction }
                        ForEach(store.novaMessages) { message in
                            NovaConversationEntry(message: message).id(message.id)
                        }
                        NovaFeedbackView(showLatestReply: false)
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.novaMessages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .onChange(of: store.isNovaTyping) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    NovaCaptureField(text: $draft, identifier: "nova", placeholder: "¿Qué tienes en mente?") {}
                        .padding(.horizontal, 16)
                        .padding(.top, 10)
                        .padding(.bottom, 8)
                        .background(Theme.Colors.background.opacity(0.96))
                }
            }
            .background { FocusAmbientBackground() }
            .navigationTitle(AssistantBrand.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { nav.openSettings() } label: {
                        Image(systemName: "gearshape").foregroundStyle(Theme.Colors.textSecondary)
                    }.accessibilityLabel("Ajustes")
                }
            }
            .onAppear(perform: consumePrompt)
            .onChange(of: nav.pendingNovaPrompt) { _, _ in consumePrompt() }
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    FocusMark(size: 36)
                    Text("UN POCO DE CLARIDAD")
                        .font(.caption2.weight(.medium)).tracking(1.3)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("Tu mente,").foregroundStyle(Theme.Colors.textPrimary)
                    Text("un poco más ligera.").foregroundStyle(Theme.Colors.accentGradient)
                }
                .font(.largeTitle.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
                Text("Dime qué tienes pendiente. Le damos un lugar en tu día.")
                    .font(.body).foregroundStyle(Theme.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                intentionCard("Guardar un pendiente", example: "Estudiar economía mañana",
                              icon: "checkmark.circle", prompt: "Tengo que estudiar economía mañana")
                intentionCard("Hacer espacio", example: "Reunión mañana a las 10",
                              icon: "calendar", prompt: "Reunión mañana a las 10")
                intentionCard("Ordenar lo que sigue", example: "Empezar por lo importante",
                              icon: "line.3.horizontal.decrease", prompt: "Ordena mis pendientes")
            }

            if store.syncCredentials == nil {
                Label("Puedes guardar pendientes en este iPhone. Inicia sesión para conversar con \(AssistantBrand.displayName) en la nube.", systemImage: "iphone")
                    .font(.caption).foregroundStyle(Theme.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }.padding(.top, 4)
    }

    private func intentionCard(_ title: String, example: String, icon: String, prompt: String) -> some View {
        Button { draft = prompt } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.Colors.focusAccent)
                    .frame(width: 36, height: 36)
                    .background(Theme.Colors.focusAccentSoft, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Theme.Colors.textPrimary)
                    Text(example).font(.caption).foregroundStyle(Theme.Colors.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.left")
                    .font(.caption.weight(.medium)).foregroundStyle(Theme.Colors.textSecondary)
                    .accessibilityHidden(true)
            }
            .focusSurface(radius: 20, padding: 14)
            .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Completa el borrador para que puedas revisarlo y enviarlo")
    }

    private func consumePrompt() {
        guard let text = nav.pendingNovaPrompt else { return }
        draft = text
        nav.pendingNovaPrompt = nil
    }
}

private struct NovaConversationEntry: View {
    let message: NovaMessage

    var body: some View {
        Group {
            if message.role == .user {
                content.focusSurface(radius: 22, padding: 18)
            } else {
                content.padding(.horizontal, 2)
            }
        }.accessibilityElement(children: .combine)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if message.role == .nova { FocusMark(size: 24) }
                Text(message.role == .user ? "Tu petición" : AssistantBrand.displayName)
                    .font(.caption.weight(.medium)).foregroundStyle(Theme.Colors.textSecondary)
            }
            Text(message.content)
                .font(.body).lineSpacing(3).foregroundStyle(Theme.Colors.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !message.actionLabels.isEmpty {
                NovaSavedActionsView(labels: message.actionLabels)
            }
        }
    }
}

private struct NovaSavedActionsView: View {
    var labels: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(labels.enumerated()), id: \.offset) { _, label in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Theme.Colors.success).accessibilityHidden(true)
                    Text(label).foregroundStyle(Theme.Colors.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.font(.subheadline)
            }
        }
        .padding(14)
        .background(Theme.Colors.focusAccentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
            VStack(alignment: .leading, spacing: 10) {
                TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Theme.Colors.textSecondary), axis: .vertical)
                    .font(.body).foregroundStyle(Theme.Colors.textPrimary)
                    .lineLimit(1...5).focused($focused)
                    .submitLabel(.send).onSubmit { submit() }
                    .frame(minHeight: 26)
                    .padding(.horizontal, 4)
                    .accessibilityLabel("Escribe a \(AssistantBrand.displayName)").accessibilityIdentifier("\(identifier).input")
                controls
            }
            .focusSurface(radius: 26, padding: 14)
            .overlay {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(focused ? Theme.Colors.focusAccent.opacity(0.7) : .clear, lineWidth: 1)
            }
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

    private var controls: some View {
        HStack(spacing: 8) {
            Button { focused = false; showVoice = true } label: {
                Label("Dictar", systemImage: "mic")
                    .font(.subheadline.weight(.medium))
                    .frame(minWidth: 44, minHeight: 44)
                    .padding(.horizontal, 6)
            }
            .buttonStyle(.plain).foregroundStyle(Theme.Colors.textSecondary)
            .accessibilityLabel("Dictar").accessibilityIdentifier("\(identifier).voice")
            .disabled(store.isNovaTyping)
            Spacer(minLength: 0)
            Text(text.count > 1500 ? "\(text.count)/\(maxLength)" : "A tu ritmo")
                .font(.caption).foregroundStyle(Theme.Colors.textSecondary)
                .lineLimit(1).accessibilityHidden(true)
            Button(action: submit) {
                Image(systemName: "arrow.up").font(.body.weight(.semibold))
                    .foregroundStyle(canSend ? Color.white : Theme.Colors.textSecondary)
                    .frame(width: 44, height: 44)
                    .background(canSend ? Theme.Colors.actionFill : Theme.Colors.surfaceHigh, in: Circle())
            }
            .buttonStyle(.plain).disabled(!canSend)
            .accessibilityLabel("Enviar a \(AssistantBrand.displayName)").accessibilityIdentifier("\(identifier).send")
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
        guard !store.isNovaTyping, store.novaPendingProposal == nil else { return }
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
        VStack(alignment: .leading, spacing: 16) {
            if store.isNovaTyping {
                progress
            } else if showLatestReply, store.novaPendingProposal == nil, store.novaErrorMessage == nil,
                      let reply = store.novaMessages.last, reply.role == .nova {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        FocusMark(size: 24)
                        Text(AssistantBrand.displayName).font(.caption.weight(.medium)).foregroundStyle(Theme.Colors.textSecondary)
                    }
                    Text(reply.content).font(.subheadline).foregroundStyle(Theme.Colors.textPrimary)
                        .lineSpacing(3).textSelection(.enabled).accessibilityIdentifier("capture.result")
                    if !reply.actionLabels.isEmpty { NovaSavedActionsView(labels: reply.actionLabels) }
                }.focusSurface(radius: 22, padding: 18)
            }
            if let proposal = store.novaPendingProposal {
                VStack(alignment: .leading, spacing: 16) {
                    Label("Revisa antes de aplicar", systemImage: "square.and.pencil")
                        .font(.headline).foregroundStyle(Theme.Colors.textPrimary)
                    Text(proposal.summary).font(.subheadline).foregroundStyle(Theme.Colors.textSecondary)
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(proposal.actionLabels.enumerated()), id: \.offset) { _, label in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "arrow.right").foregroundStyle(Theme.Colors.focusAccent)
                                    .accessibilityHidden(true)
                                Text(label).foregroundStyle(Theme.Colors.textPrimary)
                            }.font(.subheadline)
                        }
                    }
                    proposalControls
                }.focusSurface(radius: 24, padding: 20)
            }
            if let error = store.novaErrorMessage { errorCard(error) }
        }.accessibilityElement(children: .contain)
    }

    private var progress: some View {
        HStack(spacing: 12) {
            ProgressView().controlSize(.small).tint(Theme.Colors.focusAccent)
            Text("Organizando tu petición…")
                .font(.subheadline).foregroundStyle(Theme.Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Cancelar") { store.cancelNovaRequest() }
                .font(.subheadline.weight(.medium)).foregroundStyle(Theme.Colors.focusAccent)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.Colors.focusAccentSoft, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityIdentifier("nova.progress")
    }

    private var proposalControls: some View {
        HStack(spacing: 12) {
            Button("Aplicar") { store.confirmNovaProposal() }
                .buttonStyle(FocusPrimaryButtonStyle()).accessibilityIdentifier("nova.confirm")
            Button("Descartar") { store.cancelNovaProposal() }
                .font(.subheadline.weight(.medium)).foregroundStyle(Theme.Colors.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 54)
                .background(Theme.Colors.surfaceHigh, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityIdentifier("nova.discard")
        }
    }

    private func errorCard(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Theme.Colors.danger).accessibilityHidden(true)
                Text(error).foregroundStyle(Theme.Colors.textPrimary)
            }.font(.subheadline)
            if store.novaLastFailedInput != nil {
                Button { store.retryNovaMessage() } label: {
                    Label("Reintentar", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .foregroundStyle(Theme.Colors.focusAccent)
                .accessibilityIdentifier("nova.retry")
            }
        }
        .focusSurface(radius: 22, padding: 18)
        .accessibilityIdentifier("nova.error")
    }
}
