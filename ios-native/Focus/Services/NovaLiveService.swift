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
    private static let silenceShortSeconds: Double = 2.0
    private static let silenceLongSeconds: Double = 3.5
    private static let lowEnergyHoldSeconds: Double = 0.6
    /// Umbral de energía debajo del cual consideramos "silencio". 0.05 en
    /// el rango 0…1 (-46dB aprox post-normalize). Más bajo = más
    /// estricto, más alto = corta antes con ruido ambiente.
    private static let speechEnergyThreshold: Float = 0.05

    /// Timer monotónico para detectar silencio. Lo reseteamos cada vez que
    /// llega texto nuevo del reconocedor o el audio level pasa el umbral.
    private var lastSpeechAt: Date?
    /// Última vez que el audio level estuvo por encima del threshold.
    /// Usado por el VAD para evitar corte mientras hay energía.
    private var lastHighEnergyAt: Date?
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
        inputNode.removeTap(onBus: 0)  // por las dudas, evitar dobles taps
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
                self.updateAudioLevel(level)
            }
        }

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

        self.lastSpeechAt = Date()

        self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let recognitionError = error as NSError?
            Task { @MainActor [weak self] in
                self?.receiveRecognitionUpdate(text: text, isFinal: isFinal,
                    error: recognitionError, generation: generation)
            }
        }

        state = .listening
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
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        // No tearDown inmediato — esperamos al `isFinal` del recognizer.
        // Si el recognizer no llega a final (raro), forzamos teardown a los
        // 2 segundos.
        let generation = sessionGeneration
        Task { @MainActor [weak self] in
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
        state = .idle
    }

    /// Cleanup defensivo cuando el service se desinstancia (ej. logout
    /// destruye MiDiaView). Sin esto, el audio engine podría quedar
    /// activo en memoria hasta que iOS lo recicle. `tearDown` libera el
    /// inputNode, el audioEngine, el recognitionRequest y la audio session.
    deinit {
        // No podemos usar @MainActor desde deinit; las propiedades que
        // tocamos son thread-safe (audioEngine sync) o solo metadata.
        recognitionTask?.cancel()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        if audioSessionIsActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    // MARK: - Internals

    private func finalizeListening() {
        tearDown()
        state = .idle
    }

    private func tearDown() {
        sessionGeneration = UUID()
        silenceCheckTask?.cancel()
        silenceCheckTask = nil
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        lastSpeechAt = nil
        lastHighEnergyAt = nil
        audioLevel = 0
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
            transcript = text
            lastSpeechAt = Date()
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

    /// VAD inteligente: distingue **pausa para pensar** vs **fin de habla**
    /// usando dos señales en combinación:
    /// 1. **Tiempo sin transcripción nueva** del recognizer (`lastSpeechAt`).
    /// 2. **Energía de audio sostenida baja** (`lastHighEnergyAt`).
    ///
    /// La diferencia con la versión anterior (timeout fijo de 8s sin
    /// distinción) es:
    /// - Si el usuario aún no dijo nada (transcript vacío) → corte rápido
    ///   en `silenceShortSeconds` (2s). No le hacemos esperar si no piensa
    ///   hablar.
    /// - Si ya hay transcript → `silenceLongSeconds` (3.5s). Esto permite
    ///   pausas naturales para pensar entre frases.
    /// - Pero NUNCA cortamos si la energía de audio sigue alta — eso
    ///   significa que el usuario sigue hablando (o murmurando) aunque el
    ///   recognizer aún no haya emitido texto. Solo cortamos cuando
    ///   `lastHighEnergyAt` también pasó `lowEnergyHoldSeconds` (0.6s).
    private func startSilenceWatchdog(generation: UUID) {
        silenceCheckTask?.cancel()
        silenceCheckTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                // Check cada 200ms — más responsive para VAD que 1s.
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard !Task.isCancelled, let self, self.sessionGeneration == generation,
                      self.state == .listening else { return }

                let now = Date()
                let hasContent = !self.transcript.isEmpty
                let silenceTimeout = hasContent
                    ? Self.silenceLongSeconds
                    : Self.silenceShortSeconds

                let timeSinceSpeech = self.lastSpeechAt.map {
                    now.timeIntervalSince($0)
                } ?? now.timeIntervalSince(Date(timeIntervalSinceNow: -100))

                let timeSinceHighEnergy = self.lastHighEnergyAt.map {
                    now.timeIntervalSince($0)
                } ?? Self.lowEnergyHoldSeconds + 1

                // Ambas condiciones deben cumplirse: timer de transcripción
                // pasó Y energía baja sostenida. Si el usuario sigue
                // hablando aunque el recognizer aún no haya emitido, la
                // energía mantiene viva la sesión.
                let transcriptIdle = timeSinceSpeech >= silenceTimeout
                let energyIdle = timeSinceHighEnergy >= Self.lowEnergyHoldSeconds
                if transcriptIdle && energyIdle {
                    self.stop()
                    return
                }
            }
        }
    }

    // MARK: - Audio level (RMS → dB → 0…1)

    /// Calcula el RMS del buffer (sample values son float -1..1 ya), lo
    /// convierte a dB y normaliza a un rango 0..1 con piso en -55dB
    /// (silencio) y techo en -5dB (habla fuerte). Resultado: el usuario
    /// hablando normal mueve la barra en ~0.4-0.7, silencio queda en ~0.
    private static func bufferLevel(_ buffer: AVAudioPCMBuffer) -> Float {
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

    /// Aplicado en MainActor (porque @Published muta state observable).
    /// Hace smoothing exponencial para que la UI no parpadee y throttling
    /// para no spamear publishes. Además resetea `lastHighEnergyAt` para
    /// el VAD.
    private func updateAudioLevel(_ newLevel: Float) {
        // Smoothing exponencial: nuevoValor = α·raw + (1-α)·anterior
        let smoothed = Self.audioLevelSmoothing * newLevel
            + (1 - Self.audioLevelSmoothing) * audioLevel

        bufferTickCounter += 1
        // Throttle publish — cada 3 ticks (~14fps), suficiente para
        // animación fluida sin spamear @Published.
        if bufferTickCounter % 3 == 0 {
            audioLevel = smoothed
        }

        // VAD: track energía alta para el watchdog. Threshold inferior
        // pequeño para captar voz suave también.
        let speaking = newLevel >= Self.speechEnergyThreshold
        if speaking {
            lastHighEnergyAt = Date()
        }
        if speaking != isSpeaking {
            isSpeaking = speaking
        }
    }
}
