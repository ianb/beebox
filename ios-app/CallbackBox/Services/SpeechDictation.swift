import AVFAudio
import Foundation
import Speech

enum NativeVoiceTurnCommand: Equatable {
    case none
    case startDictation
    case stopDictation
}

enum NativeVoiceTurnEvent: Equatable {
    case microphoneStarted
    case microphoneStopped
    case voiceMessageSent(closeMicrophone: Bool)
    case speechPlaybackChanged(playing: Bool)
}

struct NativeVoiceTurnState: Equatable {
    private(set) var isActive = false
    private var speechPlaybackActive = false

    mutating func handle(_ event: NativeVoiceTurnEvent) -> NativeVoiceTurnCommand {
        switch event {
        case .microphoneStarted:
            isActive = true
            return speechPlaybackActive ? .none : .startDictation
        case .microphoneStopped:
            isActive = false
            return .stopDictation
        case .voiceMessageSent(let closeMicrophone):
            if closeMicrophone {
                isActive = false
                return .stopDictation
            }
            isActive = true
            return speechPlaybackActive ? .none : .startDictation
        case .speechPlaybackChanged(let playing):
            guard playing != speechPlaybackActive else {
                return .none
            }
            speechPlaybackActive = playing
            guard isActive else {
                return .none
            }
            return playing ? .stopDictation : .startDictation
        }
    }
}

enum VoiceCompositionState: Equatable {
    case idle
    case requestingPermission
    case recording
    case preparingHQ
    case editableResult
    case failed(message: String)
}

enum VoiceCompositionEvent: Equatable {
    case requestPermission
    case permissionGranted
    case recordingStopped(hasText: Bool)
    case keywordDetected
    case preparationCompleted
    case fail(message: String)
    case reset
}

enum VoiceCompositionReducer {
    static func reduce(_ state: inout VoiceCompositionState, _ event: VoiceCompositionEvent) {
        switch event {
        case .requestPermission:
            state = .requestingPermission
        case .permissionGranted:
            state = .recording
        case .recordingStopped(let hasText):
            state = hasText ? .editableResult : .idle
        case .keywordDetected:
            state = .preparingHQ
        case .preparationCompleted, .reset:
            state = .idle
        case .fail(let message):
            state = .failed(message: message)
        }
    }
}

@MainActor
final class SpeechDictation: ObservableObject {
    @Published private(set) var state: VoiceCompositionState = .idle
    @Published private(set) var interruptionCount = 0
    @Published private(set) var hasDictatedText = false
    @Published private(set) var keywordIntent: SpeechKeywordResult?
    @Published private(set) var preparationMessage: String?
    @Published var transcript = ""
    @Published var errorMessage: String?

    private let audioEngine = AVAudioEngine()
    private let audioSession: any AudioSessionControlling
    private let permissionRequester: (@MainActor () async -> Bool)?
    private let startupDidFinish: @MainActor () -> Void
    private let legacyRecognizer = SFSpeechRecognizer(locale: Locale.current)
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var analyzerSession: LiveSpeechRecognitionSession?
    private var startTask: Task<Void, Never>?
    private var startupGeneration: UUID?
    private var recognitionGeneration: UUID?
    private var seedText = ""
    private var firedKeywordKey: String?
    private var currentRecordingURL: URL?
    private var recordedAudioURL: URL?
    private var recordingFile: AVAudioFile?
    private var keywordSeedText = ""
    private var interruptionObserver: NSObjectProtocol?
    private var configurationChangeObserver: NSObjectProtocol?

    init(
        permissionRequester: (@MainActor () async -> Bool)? = nil,
        startupDidFinish: @escaping @MainActor () -> Void = {},
        audioSession: any AudioSessionControlling = SystemAudioSession()
    ) {
        self.audioSession = audioSession
        self.permissionRequester = permissionRequester
        self.startupDidFinish = startupDidFinish
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.handleAudioInterruption(notification)
            }
        }
        // A Bluetooth device connecting or disconnecting mid-dictation changes
        // the engine's input format, which the tap installed in `start` no
        // longer matches. Stop and say so rather than run on a broken tap.
        configurationChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: audioEngine,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleEngineConfigurationChange()
            }
        }
    }

    deinit {
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
        if let configurationChangeObserver {
            NotificationCenter.default.removeObserver(configurationChangeObserver)
        }
    }

    var isRecording: Bool {
        state == .recording
    }

    var hasPendingStart: Bool {
        startTask != nil
    }

    func toggle(currentText: String) {
        if isRecording {
            stop()
            return
        }
        startIfNeeded(currentText: currentText)
    }

    func startIfNeeded(currentText: String) {
        guard isRecording == false else {
            return
        }
        guard startTask == nil else {
            return
        }
        let generation = UUID()
        startupGeneration = generation
        startTask = Task {
            await start(currentText: currentText, generation: generation)
        }
    }

    func stop() {
        startTask?.cancel()
        startTask = nil
        startupGeneration = nil
        preparationMessage = nil
        endRecording(cancelTranscription: false)
        if state == .requestingPermission {
            VoiceCompositionReducer.reduce(&state, .reset)
        }
    }

    private func endRecording(cancelTranscription: Bool) {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        if currentRecordingURL != nil {
            recordedAudioURL = currentRecordingURL
        }
        currentRecordingURL = nil
        recordingFile = nil
        if cancelTranscription {
            recognitionGeneration = nil
            recognitionRequest?.endAudio()
            recognitionTask?.cancel()
            analyzerSession?.cancel()
            analyzerSession = nil
        } else {
            recognitionRequest?.endAudio()
            recognitionTask?.finish()
            analyzerSession?.finish()
        }
        recognitionRequest = nil
        recognitionTask = nil
        if state == .recording {
            VoiceCompositionReducer.reduce(
                &state,
                .recordingStopped(hasText: transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            )
        }
        // Deactivating alone would leave the recording category installed, so
        // later playback would stay quiet and off Bluetooth. `deactivate()`
        // also restores the idle configuration.
        audioSession.deactivate()
    }

    func resetDictationState() {
        recognitionGeneration = nil
        analyzerSession?.cancel()
        analyzerSession = nil
        hasDictatedText = false
        errorMessage = nil
        preparationMessage = nil
        transcript = ""
        keywordIntent = nil
        firedKeywordKey = nil
        recordedAudioURL = nil
        keywordSeedText = ""
        VoiceCompositionReducer.reduce(&state, .reset)
    }

    func noteManualTextChange(_ text: String) {
        guard isRecording == false, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        hasDictatedText = false
        transcript = ""
        VoiceCompositionReducer.reduce(&state, .reset)
    }

    func clearKeywordIntent() {
        keywordIntent = nil
    }

    func failPreparation(_ message: String) {
        errorMessage = message
        VoiceCompositionReducer.reduce(&state, .fail(message: message))
    }

    func consumeRecordedAudioURL() -> URL? {
        let url = recordedAudioURL
        recordedAudioURL = nil
        return url
    }

    func consumeKeywordSeedText() -> String {
        let value = keywordSeedText
        keywordSeedText = ""
        return value
    }

    private func start(currentText: String, generation startupID: UUID) async {
        defer {
            if startupGeneration == startupID {
                startTask = nil
                startupGeneration = nil
                preparationMessage = nil
            }
            startupDidFinish()
        }
        errorMessage = nil
        keywordIntent = nil
        firedKeywordKey = nil
        endRecording(cancelTranscription: true)
        VoiceCompositionReducer.reduce(&state, .requestPermission)
        let permissionsGranted = await requestPermissions()
        guard startupGeneration == startupID, Task.isCancelled == false else {
            return
        }
        guard permissionsGranted else {
            let message = "Enable microphone and speech recognition permissions to dictate."
            errorMessage = message
            VoiceCompositionReducer.reduce(&state, .fail(message: message))
            return
        }

        seedText = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = currentText

        do {
            try audioSession.activate(role: .recording)

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            let recognitionID = UUID()
            recognitionGeneration = recognitionID
            let modernSession = await makeAnalyzerSession(
                naturalFormat: format,
                generation: recognitionID
            )
            guard startupGeneration == startupID, Task.isCancelled == false else {
                modernSession?.cancel()
                return
            }

            let legacyRequest: SFSpeechAudioBufferRecognitionRequest?
            if modernSession == nil {
                guard let legacyRecognizer, legacyRecognizer.isAvailable else {
                    let message = "Speech recognition is not available."
                    endRecording(cancelTranscription: true)
                    errorMessage = message
                    VoiceCompositionReducer.reduce(&state, .fail(message: message))
                    return
                }
                let request = SFSpeechAudioBufferRecognitionRequest()
                request.shouldReportPartialResults = true
                recognitionRequest = request
                legacyRequest = request
                recognitionTask = legacyRecognizer.recognitionTask(with: request) { [weak self] result, error in
                    Task { @MainActor in
                        guard let self, self.recognitionGeneration == recognitionID else {
                            return
                        }
                        if let result {
                            self.receiveRecognizedSpeech(
                                result.bestTranscription.formattedString,
                                generation: recognitionID
                            )
                        }
                        if error != nil || result?.isFinal == true {
                            self.endRecording(cancelTranscription: false)
                        }
                    }
                }
            } else {
                analyzerSession = modernSession
                legacyRequest = nil
            }

            let recordingURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("callbackbox-\(UUID().uuidString)")
                .appendingPathExtension("wav")
            let audioFile = try AVAudioFile(forWriting: recordingURL, settings: format.settings)
            currentRecordingURL = recordingURL
            recordingFile = audioFile
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                modernSession?.append(buffer)
                legacyRequest?.append(buffer)
                try? audioFile.write(from: buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()
            VoiceCompositionReducer.reduce(&state, .permissionGranted)
        } catch {
            guard startupGeneration == startupID else {
                return
            }
            endRecording(cancelTranscription: true)
            if Self.isExpectedCancellation(error, taskWasCancelled: Task.isCancelled) {
                if state == .requestingPermission {
                    VoiceCompositionReducer.reduce(&state, .reset)
                }
                return
            }
            errorMessage = error.localizedDescription
            VoiceCompositionReducer.reduce(&state, .fail(message: error.localizedDescription))
        }
    }

    static func isExpectedCancellation(
        _ error: Error,
        taskWasCancelled: Bool
    ) -> Bool {
        taskWasCancelled || error is CancellationError
    }

    private func receiveRecognizedSpeech(_ spoken: String, generation: UUID) {
        guard recognitionGeneration == generation else {
            return
        }
        let currentTranscript = seedText.isEmpty ? spoken : "\(seedText) \(spoken)"
        if let keyword = SpeechKeywords.detect(currentTranscript) {
            let key = "\(keyword.action.rawValue):\(keyword.matchedPhrase)"
            if key != firedKeywordKey {
                firedKeywordKey = key
                keywordSeedText = seedText
                transcript = keyword.processedTranscript
                hasDictatedText = true
                VoiceCompositionReducer.reduce(&state, .keywordDetected)
                keywordIntent = keyword
                endRecording(cancelTranscription: true)
                return
            }
        }
        transcript = currentTranscript
        hasDictatedText = transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private func makeAnalyzerSession(
        naturalFormat: AVAudioFormat,
        generation: UUID
    ) async -> LiveSpeechRecognitionSession? {
        guard #available(iOS 26.0, *) else {
            return nil
        }
        preparationMessage = "Preparing on-device transcription..."
        do {
            return try await AppleSpeechAnalyzerSession.create(
                naturalFormat: naturalFormat,
                locale: Locale.current,
                onTranscript: { [weak self] spoken in
                    self?.receiveRecognizedSpeech(spoken, generation: generation)
                },
                onFailure: { [weak self] message in
                    guard let self, self.recognitionGeneration == generation else {
                        return
                    }
                    self.errorMessage = message
                    self.endRecording(cancelTranscription: true)
                    VoiceCompositionReducer.reduce(&self.state, .fail(message: message))
                }
            )
        } catch {
            return nil
        }
    }

    private func requestPermissions() async -> Bool {
        if let permissionRequester {
            return await permissionRequester()
        }
        async let speechAllowed = requestSpeechPermission()
        async let microphoneAllowed = requestMicrophonePermission()
        let permissions = await (speechAllowed, microphoneAllowed)
        return permissions.0 && permissions.1
    }

    private func handleAudioInterruption(_ notification: Notification) {
        guard
            let rawValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: rawValue) == .began,
            state == .recording
        else {
            return
        }
        let message = "Dictation was interrupted. Your live transcript is ready to edit or send."
        endRecording(cancelTranscription: true)
        errorMessage = message
        VoiceCompositionReducer.reduce(&state, .fail(message: message))
        interruptionCount += 1
    }

    private func handleEngineConfigurationChange() {
        guard state == .recording else {
            return
        }
        let message = "The audio device changed. Your live transcript is ready to edit or send."
        endRecording(cancelTranscription: true)
        errorMessage = message
        VoiceCompositionReducer.reduce(&state, .fail(message: message))
    }

    private func requestSpeechPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}
