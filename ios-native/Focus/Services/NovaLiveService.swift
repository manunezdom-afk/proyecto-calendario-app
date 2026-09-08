import Foundation
import Speech
import AVFoundation

/// Dictado local con `SFSpeechRecognizer` + `AVAudioEngine`
/// para capturar audio del micrófono y transcribirlo en tiempo real.
///
/// Scope V1:
/// - Solo voz → texto. NO hay respuesta hablada (TTS).
/// - NO hay streaming full-duplex tipo Live API.
/// - Locale preferido `es_CL`, fallback `es_ES`, fallback default del device.
/// - El caller decide cuándo `start()` y `stop()`. La transcripción final
///   se entrega cuando el caller invoca `stop()` o el reconocedor emite el
///   resultado `isFinal`.
///
/// Permisos: el caller llama `requestAuthorization()` antes de `start()`.
/// Si rechaza, `start()` no hace nada y `state` queda en `.denied`.
///
/// Privacidad: exige el modelo de reconocimiento en el dispositivo.
/// Si falta, muestra un error recuperable y permite continuar escribiendo.
/// No envía audio al backend de Focus ni habilita reconocimiento remoto.
@MainActor
final class NovaLiveService: ObservableObject {

    /// Estados visibles para Nova Live View.
    enum State: Equatable {
        case idle
        case requestingPermissions
        case listening
        case processing      // tras stop, esperando finalización del recognizer
        case error(String)
        case denied
    }

    @Published var state: State = .idle
    @Published var transcript: String = ""
    /// Nivel de audio en vivo (0.0…1.0). Calculado en cada audio buffer
    /// del tap, normalizado a partir del RMS en dB. La UI usa este valor
    /// para waveform/barras animadas que dan feedback "estoy oyéndote".
    @Published private(set) var audioLevel: Float = 0
    @Published private(set) var audioSamples: [Float] = Array(repeating: 0, count: 24)
    @Published private(set) var isPausedForSilence = false
    @Published private(set) var notice: String?
    /// `true` cuando hay habla actualmente (energía por encima del piso de
    /// ruido). Calculado en el mismo loop del tap. Sirve para distinguir
    /// "pausa para pensar" vs "terminé de hablar":
    /// - habla → reset del timer
    /// - silencio breve + última habla reciente → pausa para pensar
    /// - silencio sostenido + sin energía sostenida → fin
    @Published private(set) var isSpeaking: Bool = false

    // MARK: - Internals

    /// Permission operations are injectable so cancellation can be verified without audio hardware.
    struct Permissions {
        var currentStatus: () async -> AuthorizationCombined
        var requestSpeech: () async -> Bool
        var requestMicrophone: () async -> Bool

        static var system: Permissions {
            Permissions(
                currentStatus: {
                    let speech = SFSpeechRecognizer.authorizationStatus()
                    let mic = AVAudioApplication.shared.recordPermission
                    if speech == .authorized && mic == .granted { return .authorized }
                    if speech == .denied || speech == .restricted || mic == .denied { return .denied }
                    return .notDetermined
                },
                requestSpeech: { await NovaLiveService.requestSpeechRecognitionAuthorization() == .authorized },
                requestMicrophone: { await NovaLiveService.requestMicrophonePermission() }
            )
        }
    }

    private let permissions: Permissions
    private let recognizer: SFSpeechRecognizer?
    /// Every teardown invalidates suspended permission requests and queued audio callbacks.
    private(set) var sessionGeneration = UUID()
    private var audioSessionIsActive = false
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var finishTask: Task<Void, Never>?
    private var audioObservers: [NSObjectProtocol] = []
    private var inputTapInstalled = false
    private var captureStartedAt: TimeInterval?

    /// Locale efectivo que usamos (para diagnóstico/UI). Resuelto en init.
    let activeLocaleIdentifier: String

    /// **VAD (Voice Activity Detection) con doble timeout**:
    /// - `silenceShortSeconds` aplica cuando el usuario aún no dijo nada
    ///   (transcript vacío). Si arranca el mic pero no habla, paramos
    ///   rápido para no dejar pegado.
    /// - `silenceLongSeconds` aplica cuando ya hay transcript. Le damos
    ///   más tiempo para que pueda pausar y pensar en medio de una frase
    ///   sin que se corte.
    /// Ambos son condicionados a que ADEMÁS el audio level esté bajo
    /// sostenido (gateado por `lowEnergyHoldSeconds`), porque a veces el
    /// recognizer demora en emitir texto aunque el usuario esté hablando
    /// — usar solo timer de transcript causaba cortes prematuros.
    private static let silenceShortSeconds: Double = 6.0
    private static let silenceLongSeconds: Double = 4.0
    private static let lowEnergyHoldSeconds: Double = 0.6
    /// Umbral de energía debajo del cual consideramos "silencio". 0.05 en
    /// el rango 0…1 (-46dB aprox post-normalize). Más bajo = más
    /// estricto, más alto = corta antes con ruido ambiente.
    private static let speechEnergyThreshold: Float = 0.05

    /// Timer monotónico para detectar silencio. Lo reseteamos cada vez que
    /// llega texto nuevo del reconocedor o el audio level pasa el umbral.
    private var lastSpeechAt: TimeInterval?
    /// Última vez que el audio level estuvo por encima del threshold.
    /// Usado por el VAD para evitar corte mientras hay energía.
    private var lastHighEnergyAt: TimeInterval?
    private var silenceCheckTask: Task<Void, Never>?
    /// Smoothing factor (low-pass) para el audioLevel publicado — sin
    /// esto la UI parpadea demasiado. 0.0 = solo histórico, 1.0 = solo
    /// nuevo. 0.35 da movimiento responsive pero estable.
    private static let audioLevelSmoothing: Float = 0.35
    /// Contador para throttle del publish — el tap se llama ~43 veces/seg
    /// (buffer 1024 @ 44.1kHz). Publicar cada vez es exagerado, cada 3°
    /// callback da ~14fps que es suficiente para animación fluida.
    private var bufferTickCounter: Int = 0

    init(permissions: Permissions = .system) {
        self.permissions = permissions
        // Preferir español de Chile, después español de España y el locale
        // del dispositivo. La disponibilidad del modelo local se verifica al iniciar.
        let preferred = SFSpeechRecognizer(locale: Locale(identifier: "es_CL"))
        let fallbackES = SFSpeechRecognizer(locale: Locale(identifier: "es_ES"))
        let any = SFSpeechRecognizer()
        let chosen = preferred ?? fallbackES ?? any
        self.recognizer = chosen
        self.activeLocaleIdentifier = chosen?.locale.identifier ?? "unavailable"
        observeAudioSession()
    }

    // MARK: - Permission flow

    /// Pide los DOS permisos necesarios en orden: Speech Recognition + Micrófono.
    /// Devuelve `true` solo si ambos quedan autorizados.
    func requestAuthorization() async -> Bool {
        guard !Task.isCancelled else { return false }
        tearDown()
        return await requestAuthorization(for: sessionGeneration)
    }

    private func requestAuthorization(for generation: UUID) async -> Bool {
        guard continueSession(generation) else { return false }
        state = .requestingPermissions
        let speechGranted = await permissions.requestSpeech()
        guard continueSession(generation) else { return false }
        guard speechGranted else {
            state = .denied
            return false
        }
        let micGranted = await permissions.requestMicrophone()
        guard continueSession(generation) else { return false }
        guard micGranted else {
            state = .denied
            return false
        }
        state = .idle
        return true
    }

    func currentAuthorizationStatus() async -> AuthorizationCombined {
        await permissions.currentStatus()
    }

    /// One lifecycle spans permission lookup, permission dialogs and recording.
    /// The sheet must not restart a fresh session after a suspended lookup is cancelled.
    func beginDictation() async {
        guard !Task.isCancelled else { return }
        tearDown()
        let generation = sessionGeneration
        state = .requestingPermissions
        let status = await currentAuthorizationStatus()
        guard continueSession(generation) else { return }
        if status == .denied {
            state = .denied
            return
        }
        if status == .notDetermined {
            guard await requestAuthorization(for: generation) else { return }
        }
        guard continueSession(generation) else { return }
        startCapture(for: generation)
    }

    enum AuthorizationCombined {
        case authorized
        case denied
        case notDetermined
    }

    private static func requestSpeechRecognitionAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status)
            }
        }
    }

    private static func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    // MARK: - Listening

    /// Arranca la captura + transcripción. Asume permisos ya autorizados —
    /// si no lo están, devuelve error y deja `state = .denied`.
    func start() async {
        guard !Task.isCancelled else { return }
        tearDown()
        let generation = sessionGeneration
        let auth = await currentAuthorizationStatus()
        guard continueSession(generation) else { return }
        guard auth == .authorized else {
            state = .denied
            return
        }
        startCapture(for: generation)
    }

    private func startCapture(for generation: UUID) {
        guard continueSession(generation) else { return }
        transcript = ""
        notice = nil
        audioLevel = 0
        isSpeaking = false
        lastHighEnergyAt = nil
        bufferTickCounter = 0

        guard let recognizer, recognizer.isAvailable else {
            state = .error("Reconocimiento de voz no disponible en este momento.")
            return
        }

        // El consentimiento promete dictado local. No habilitar una subida
        // automática de audio cuando falta el modelo de reconocimiento.
        guard recognizer.supportsOnDeviceRecognition else {
            state = .error("El dictado sin conexión no está disponible en este iPhone. Puedes escribir tu petición.")
            return
        }

        // Configurar sesión de audio para grabación. `.measurement` y
        // `.duckOthers` dan buena calidad sin matar otro audio (música
        // pausa, no se mata).
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            audioSessionIsActive = true
        } catch {
            state = .error("No pude activar el micrófono. Intenta otra vez.")
            return
        }

        // Crear engine + request + task.
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        guard recordingFormat.sampleRate > 0, recordingFormat.channelCount > 0 else {
            tearDown()
            state = .error("No hay un micrófono disponible. Revisa la conexión e intenta otra vez.")
            return
        }
        // Each tap owns its request: a queued buffer from an old engine must
        // never be appended to a newer recording's recognition request.
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)
            // Audio level + VAD. Esta closure NO viene en MainActor —
            // calculamos el level acá y hopeamos al main solo para
            // publish + check del watchdog.
            let level = Self.bufferLevel(buffer)
            Task { @MainActor [weak self] in
                guard let self, self.sessionGeneration == generation,
                      self.state == .listening else { return }
                self.receiveAudioLevel(level, generation: generation)
            }
        }

        inputTapInstalled = true
        self.audioEngine = engine
        self.recognitionRequest = request
        engine.prepare()
        do {
            try engine.start()
        } catch {
            state = .error("No pude iniciar la captura de audio.")
            tearDown()
            return
        }

        self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let recognitionError = error as NSError?
            Task { @MainActor [weak self] in
                self?.receiveRecognitionUpdate(text: text, isFinal: isFinal,
                    error: recognitionError, generation: generation)
            }
        }

        beginListening(at: ProcessInfo.processInfo.systemUptime)
        startSilenceWatchdog(generation: generation)
    }

    /// Termina la grabación. Si hay transcripción acumulada, queda visible
    /// en `transcript` y el caller puede leerla. `state` pasa a
    /// `.processing` brevemente mientras el recognizer cierra, y queda en
    /// `.idle` cuando termina.
    func stop() {
        guard state == .listening else { return }
        state = .processing
        // Pedirle al request que termine de procesar el audio acumulado.
        recognitionRequest?.endAudio()
        removeInputTap()
        audioEngine?.stop()
        isSpeaking = false
        isPausedForSilence = false
        // No tearDown inmediato — esperamos al `isFinal` del recognizer.
        // Si el recognizer no llega a final (raro), forzamos teardown a los
        // 2 segundos.
        let generation = sessionGeneration
        finishTask?.cancel()
        finishTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, let self, self.sessionGeneration == generation else { return }
            if self.state == .processing {
                self.finalizeListening()
            }
        }
    }

    /// Cancelación inmediata: descarta lo que haya y vuelve a idle. La UI
    /// llama esto cuando el usuario toca "Cancelar" o cuando el contexto
    /// requiere parar todo (cambio de tab, app va a background, logout).
    func cancel() {
        tearDown()
        transcript = ""
        notice = nil
        state = .idle
    }

    enum Interruption {
        case background, audioSession, routeChanged, mediaServicesReset
    }

    /// Keep recognized words but never reactivate the microphone automatically.
    func pauseForInterruption(_ reason: Interruption) {
        guard state == .listening || state == .processing || state == .requestingPermissions else { return }
        tearDown()
        switch reason {
        case .background: notice = "Dictado en pausa. Tu texto sigue aquí."
        case .audioSession: notice = "El dictado se interrumpió. Puedes revisar el texto o volver a dictar."
        case .routeChanged: notice = "Cambió el micrófono. Tu texto sigue aquí; toca Dictar para continuar."
        case .mediaServicesReset: notice = "El audio se reinició. Tu texto sigue aquí; toca Dictar para continuar."
        }
        state = .idle
    }

    func handleRouteChange(reason: UInt) {
        guard [AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue,
               AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue,
               AVAudioSession.RouteChangeReason.noSuitableRouteForCategory.rawValue,
               AVAudioSession.RouteChangeReason.routeConfigurationChange.rawValue].contains(reason) else { return }
        pauseForInterruption(.routeChanged)
    }

    private func observeAudioSession() {
        let center = NotificationCenter.default
        audioObservers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let began = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            if began { Task { @MainActor [weak self] in self?.pauseForInterruption(.audioSession) } }
        })
        audioObservers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
            Task { @MainActor [weak self] in self?.handleRouteChange(reason: reason) }
        })
        for name in [AVAudioSession.mediaServicesWereResetNotification, AVAudioSession.mediaServicesWereLostNotification] {
            audioObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.pauseForInterruption(.mediaServicesReset) }
            })
        }
    }

    /// Cleanup defensivo cuando el service se desinstancia (ej. logout
    /// destruye MiDiaView). Sin esto, el audio engine podría quedar
    /// activo en memoria hasta que iOS lo recicle. `tearDown` libera el
    /// inputNode, el audioEngine, el recognitionRequest y la audio session.
    deinit {
        // No podemos usar @MainActor desde deinit; las propiedades que
        // tocamos son thread-safe (audioEngine sync) o solo metadata.
        finishTask?.cancel()
        silenceCheckTask?.cancel()
        audioObservers.forEach { NotificationCenter.default.removeObserver($0) }
        recognitionTask?.cancel()
        if inputTapInstalled { audioEngine?.inputNode.removeTap(onBus: 0) }
        audioEngine?.stop()
        if audioSessionIsActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    // MARK: - Internals

    private func finalizeListening() {
        tearDown()
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            notice = "No escuché ninguna palabra. Puedes volver a dictar o escribir."
        }
        state = .idle
    }

    private func removeInputTap() {
        guard inputTapInstalled else { return }
        audioEngine?.inputNode.removeTap(onBus: 0)
        inputTapInstalled = false
    }

    private func tearDown() {
        sessionGeneration = UUID()
        finishTask?.cancel()
        finishTask = nil
        silenceCheckTask?.cancel()
        silenceCheckTask = nil
        removeInputTap()
        audioEngine?.stop()
        audioEngine = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        lastSpeechAt = nil
        lastHighEnergyAt = nil
        captureStartedAt = nil
        audioLevel = 0
        audioSamples = Array(repeating: 0, count: 24)
        isPausedForSilence = false
        isSpeaking = false
        bufferTickCounter = 0
        // Liberar la sesión para que no se quede activa bloqueando otros
        // sonidos. Ignoramos el error — si falla, no es crítico.
        if audioSessionIsActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            audioSessionIsActive = false
        }
    }

    private func continueSession(_ generation: UUID) -> Bool {
        guard sessionGeneration == generation else { return false }
        guard !Task.isCancelled else {
            tearDown()
            state = .idle
            return false
        }
        return true
    }

    /// Kept separate from Speech's callback to test stale results without a microphone.
    func receiveRecognitionUpdate(text: String?, isFinal: Bool, error: NSError?, generation: UUID) {
        guard sessionGeneration == generation,
              state == .listening || state == .processing else { return }
        if let text {
            if text != transcript { lastSpeechAt = ProcessInfo.processInfo.systemUptime }
            transcript = text
            if isFinal {
                finalizeListening()
                return
            }
        }
        if let error {
            let isCancelled = error.domain == "kAFAssistantErrorDomain"
                && (error.code == 209 || error.code == 216)
            tearDown()
            state = isCancelled ? .idle : .error("No pude entender el audio. Intenta otra vez.")
        }
    }

    /// Monotonic lifecycle clocks are testable without recording audio.
    func beginListening(at uptime: TimeInterval) {
        captureStartedAt = uptime
        lastSpeechAt = uptime
        lastHighEnergyAt = nil
        notice = nil
        isPausedForSilence = false
        state = .listening
    }

    func checkSilence(at uptime: TimeInterval) {
        guard state == .listening, let started = captureStartedAt else { return }
        let speechIdle = uptime - (lastSpeechAt ?? started)
        let energyIdle = uptime - (lastHighEnergyAt ?? started)
        isPausedForSilence = energyIdle >= 0.8 && speechIdle >= 0.8
        let timeout = transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? Self.silenceShortSeconds : Self.silenceLongSeconds
        if uptime - started >= 60 || (speechIdle >= timeout && energyIdle >= Self.lowEnergyHoldSeconds) {
            stop()
        }
    }

    private func startSilenceWatchdog(generation: UUID) {
        silenceCheckTask?.cancel()
        silenceCheckTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard !Task.isCancelled, let self, self.sessionGeneration == generation,
                      self.state == .listening else { return }
                self.checkSilence(at: ProcessInfo.processInfo.systemUptime)
            }
        }
    }

    // MARK: - Audio level (RMS → dB → 0…1)

    /// Calcula el RMS del buffer (sample values son float -1..1 ya), lo
    /// convierte a dB y normaliza a un rango 0..1 con piso en -55dB
    /// (silencio) y techo en -5dB (habla fuerte). Resultado: el usuario
    /// hablando normal mueve la barra en ~0.4-0.7, silencio queda en ~0.
    nonisolated static func bufferLevel(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let channel = channelData.pointee
        let length = Int(buffer.frameLength)
        guard length > 0 else { return 0 }
        var sumSquares: Float = 0
        for i in 0..<length {
            let s = channel[i]
            sumSquares += s * s
        }
        let rms = sqrt(sumSquares / Float(length))
        // Evitar log(0). 1e-7 corresponde a ~-140dB, sub-silencio absoluto.
        let dB = 20 * log10(max(rms, 1e-7))
        // Mapear -55dB (silencio ambiente) → 0, -5dB (habla alta) → 1.
        let normalized = (dB + 55) / 50
        return min(max(normalized, 0), 1)
    }

    /// Publish a small amplitude history at ~14 Hz; SwiftUI interpolates its
    /// geometry on the display clock. No synthetic oscillator or display timer.
    func receiveAudioLevel(_ rawLevel: Float, generation: UUID, uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard sessionGeneration == generation, state == .listening else { return }
        let level = rawLevel.isFinite ? min(max(rawLevel, 0), 1) : 0
        let smoothed = Self.audioLevelSmoothing * level + (1 - Self.audioLevelSmoothing) * audioLevel
        bufferTickCounter += 1
        if bufferTickCounter % 3 == 0 {
            audioLevel = smoothed
            audioSamples = Array(audioSamples.dropFirst()) + [smoothed]
        }
        if level >= Self.speechEnergyThreshold { lastHighEnergyAt = uptime }
        isSpeaking = lastHighEnergyAt.map { uptime - $0 < 0.2 } ?? false
        if isSpeaking { isPausedForSilence = false }
    }
}
