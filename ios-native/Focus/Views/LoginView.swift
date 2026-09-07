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
    var onBack: (() -> Void)? = nil

    private enum Field: Hashable { case email, code }
    private var isCodeStep: Bool {
        if case .codeSent = auth.state { return true }
        return false
    }
    private var keyboardIsFocused: Bool { focusedField != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: keyboardIsFocused ? 16 : 24) {
                    header

                    if case .codeSent(let sentEmail) = auth.state {
                        codeCard(sentEmail: sentEmail)
                    } else {
                        emailCard
                    }

                    if let message = localError ?? auth.lastError {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(Theme.Colors.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("login.error")
                    }

                    primaryAction

                    if isCodeStep { codeActions }

                    VStack(spacing: 8) {
                        Button("Continuar en este iPhone") {
                            focusedField = nil
                            auth.enterDemo()
                        }
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityIdentifier("login.local")
                        if !keyboardIsFocused {
                            Text("Sin una cuenta, tus datos se guardan en este iPhone.")
                                .font(.footnote)
                                .foregroundStyle(Theme.Colors.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                }
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.top, keyboardIsFocused ? 8 : 20)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(FocusAmbientBackground(intensity: 0.8))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if onBack != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: goBack) {
                            Label("Volver", systemImage: "chevron.left")
                                .font(.subheadline.weight(.medium))
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("login.back")
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Listo") { focusedField = nil }
                }
            }
            .onAppear {
                if case .codeSent(let sentEmail) = auth.state {
                    email = sentEmail
                    focusedField = .code
                    startResendCooldown()
                }
            }
            .onChange(of: auth.state) { _, state in
                if case .codeSent(let sentEmail) = state {
                    email = sentEmail
                    code = ""
                    focusedField = .code
                    startResendCooldown()
                } else {
                    // Changing email already assigns its next focus; do not undo it.
                    if state != .loggedOut { focusedField = nil }
                    resendTimer?.cancel()
                }
            }
            .onDisappear { resendTimer?.cancel() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !keyboardIsFocused {
                FocusMark(size: 44)
                    .padding(.bottom, 4)
            }
            Text(isCodeStep ? "Revisa tu correo." : "Tu día, contigo.")
                .font(keyboardIsFocused ? .title3.weight(.medium) : .largeTitle.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !keyboardIsFocused {
                Text(isCodeStep
                     ? "Introduce el código para continuar."
                     : "Accede a tus pendientes y eventos en otros dispositivos.")
                    .font(.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var emailCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Correo electrónico")
                .font(.subheadline.weight(.medium))
            TextField("", text: $email, prompt: Text("tu@correo.com").foregroundStyle(Theme.Colors.textSecondary))
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: .email)
                .submitLabel(.send)
                .onSubmit { Task { await submitEmail() } }
                .font(.body)
                .frame(minHeight: 44)
                .accessibilityLabel("Correo electrónico")
                .accessibilityIdentifier("login.email")
            if !keyboardIsFocused {
                Text("Te enviaremos un código para entrar.")
                    .font(.footnote)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
        .focusSurface(radius: 24, padding: 18)
    }

    private func codeCard(sentEmail: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enviamos un código a \(sentEmail).")
                .font(.subheadline)
                .foregroundStyle(Theme.Colors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Código de 6 dígitos", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focusedField, equals: .code)
                .font(.title2.monospacedDigit())
                .frame(minHeight: 44)
                .onChange(of: code) { _, value in
                    let digits = String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
                    if code != digits { code = digits }
                }
                .accessibilityLabel("Código de 6 dígitos")
                .accessibilityIdentifier("login.code")
        }
        .focusSurface(radius: 24, padding: 18)
    }

    private var primaryAction: some View {
        Button {
            Task {
                if isCodeStep { await submitCode() }
                else { await submitEmail() }
            }
        } label: {
            HStack(spacing: 12) {
                Text(isCodeStep ? "Verificar código" : "Enviar código")
                if auth.isWorking { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(FocusPrimaryButtonStyle())
        .disabled(auth.isWorking || (isCodeStep
                  ? code.count != 6
                  : email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
        .accessibilityIdentifier(isCodeStep ? "login.verify" : "login.sendCode")
    }

    private var codeActions: some View {
        VStack(spacing: 4) {
            Button(resendCooldownSeconds > 0 ? "Reenviar en \(resendCooldownSeconds) s" : "Reenviar código") {
                Task {
                    await auth.resendCode()
                    if isCodeStep && auth.lastError == nil { startResendCooldown() }
                }
            }
            .disabled(auth.isWorking || resendCooldownSeconds > 0)
            .frame(maxWidth: .infinity, minHeight: 44)
            .accessibilityIdentifier("login.resend")
            Button("Cambiar correo") {
                resendTimer?.cancel()
                auth.changeEmail()
                code = ""
                localError = nil
                focusedField = .email
            }
            .disabled(auth.isWorking)
            .frame(maxWidth: .infinity, minHeight: 44)
            .accessibilityIdentifier("login.changeEmail")
            Text("Si no llega, revisa la carpeta de correo no deseado.")
                .font(.footnote)
                .foregroundStyle(Theme.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .font(.subheadline)
    }

    private func goBack() {
        focusedField = nil
        resendTimer?.cancel()
        code = ""
        localError = nil
        auth.changeEmail()
        onBack?()
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
