import SwiftUI

/// Email and one-time code entry share AuthStore's single request state.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var email = ""
    @State private var code = ""
    @State private var localError: String?
    @State private var resendCooldownSeconds = 0
    @State private var resendTimer: Task<Void, Never>?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case email, code }
    private var isCodeStep: Bool {
        if case .codeSent = auth.state { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Guarda tus pendientes y eventos en tu cuenta para usarlos en otros dispositivos.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .listRowBackground(Color.clear)
                }

                if case .codeSent(let sentEmail) = auth.state {
                    codeSection(sentEmail: sentEmail)
                } else {
                    emailSection
                }

                if let message = localError ?? auth.lastError {
                    Section {
                        Label(message, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Theme.Colors.danger)
                            .accessibilityIdentifier("login.error")
                    }
                }

                Section {
                    Button("Continuar en este iPhone") {
                        focusedField = nil
                        auth.enterDemo()
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("login.local")
                } footer: {
                    Text("También puedes usar Focus sin una cuenta. Tus datos se guardan en este iPhone.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Tu cuenta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Listo") { focusedField = nil }
                }
            }
            .onChange(of: auth.state) { _, state in
                if case .codeSent = state {
                    code = ""
                    focusedField = .code
                    startResendCooldown()
                } else {
                    focusedField = nil
                    resendTimer?.cancel()
                }
            }
            .onDisappear { resendTimer?.cancel() }
        }
    }

    private var emailSection: some View {
        Section("Correo electrónico") {
            TextField("tu@correo.com", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: .email)
                .submitLabel(.send)
                .onSubmit { Task { await submitEmail() } }
                .accessibilityLabel("Correo electrónico")
                .accessibilityIdentifier("login.email")
            Button {
                Task { await submitEmail() }
            } label: {
                HStack {
                    Text("Enviar código")
                    Spacer()
                    if auth.isWorking { ProgressView() }
                }
                .frame(minHeight: 44)
            }
            .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isWorking)
            .accessibilityIdentifier("login.sendCode")
        }
    }

    private func codeSection(sentEmail: String) -> some View {
        Section {
            Text("Enviamos un código a \(sentEmail).")
                .font(.subheadline)
                .foregroundStyle(Theme.Colors.textSecondary)
            TextField("Código de 6 dígitos", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focusedField, equals: .code)
                .font(.title2.monospacedDigit())
                .onChange(of: code) { _, value in
                    let digits = String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
                    if code != digits { code = digits }
                }
                .accessibilityIdentifier("login.code")
            Button {
                Task { await submitCode() }
            } label: {
                HStack {
                    Text("Verificar código")
                    Spacer()
                    if auth.isWorking { ProgressView() }
                }
                .frame(minHeight: 44)
            }
            .disabled(code.count != 6 || auth.isWorking)
            .accessibilityIdentifier("login.verify")
            Button("Cambiar correo") {
                resendTimer?.cancel()
                auth.changeEmail()
                code = ""
                localError = nil
                focusedField = .email
            }
            .disabled(auth.isWorking)
            .frame(minHeight: 44)
            .accessibilityIdentifier("login.changeEmail")
            Button(resendCooldownSeconds > 0 ? "Reenviar en \(resendCooldownSeconds) s" : "Reenviar código") {
                Task {
                    await auth.resendCode()
                    if auth.lastError == nil { startResendCooldown() }
                }
            }
            .disabled(auth.isWorking || resendCooldownSeconds > 0)
            .frame(minHeight: 44)
            .accessibilityIdentifier("login.resend")
        } header: {
            Text("Revisa tu correo")
        } footer: {
            Text("Si no llega, revisa la carpeta de correo no deseado.")
        }
    }

    private func submitEmail() async {
        guard !auth.isWorking else { return }
        focusedField = nil
        let cleaned = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.range(of: #"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$"#, options: .regularExpression) != nil else {
            localError = "Revisa que el correo tenga el formato nombre@dominio.com."
            return
        }
        localError = nil
        await auth.sendOTP(email: cleaned)
    }

    private func submitCode() async {
        guard !auth.isWorking, code.count == 6 else { return }
        localError = nil
        focusedField = nil
        await auth.verifyOTP(token: code)
    }

    private func startResendCooldown() {
        resendTimer?.cancel()
        resendCooldownSeconds = 30
        resendTimer = Task { @MainActor in
            while resendCooldownSeconds > 0 {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                resendCooldownSeconds -= 1
            }
        }
    }
}
