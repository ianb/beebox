import AVFAudio
import Foundation
import Speech

@MainActor
final class SpeechDictation: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var hasDictatedText = false
    @Published private(set) var keywordIntent: SpeechKeywordResult?
    @Published private(set) var preparationMessage: String?
    @Published var transcript = ""
    @Published var errorMessage: String?

    private let audioEngine = AVAudioEngine()
    private let legacyRecognizer = SFSpeechRecognizer(locale: Locale.current)
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var analyzerSession: LiveSpeechRecognitionSession?
    private var startTask: Task<Void, Never>?
    private var recognitionGeneration: UUID?
    private var seedText = ""
    private var firedKeywordKey: String?
    private var currentRecordingURL: URL?
    private var recordedAudioURL: URL?
    private var recordingFile: AVAudioFile?
    private var keywordSeedText = ""

    func toggle(currentText: String) {
        if isRecording {
            stop()
            return
        }
        guard startTask == nil else {
            return
        }
        startTask = Task {
            await start(currentText: currentText)
        }
    }

    func stop() {
        startTask?.cancel()
        startTask = nil
        preparationMessage = nil
        endRecording(cancelTranscription: false)
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
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func resetDictationState() {
        recognitionGeneration = nil
        analyzerSession?.cancel()
        analyzerSession = nil
        hasDictatedText = false
        transcript = ""
        keywordIntent = nil
        firedKeywordKey = nil
        recordedAudioURL = nil
        keywordSeedText = ""
    }

    func noteManualTextChange(_ text: String) {
        guard isRecording == false, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        hasDictatedText = false
        transcript = ""
    }

    func clearKeywordIntent() {
        keywordIntent = nil
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

    private func start(currentText: String) async {
        defer {
            startTask = nil
            preparationMessage = nil
        }
        errorMessage = nil
        keywordIntent = nil
        firedKeywordKey = nil
        endRecording(cancelTranscription: true)
        guard await requestPermissions() else {
            errorMessage = "Enable microphone and speech recognition permissions to dictate."
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        seedText = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = currentText

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            let generation = UUID()
            recognitionGeneration = generation
            let modernSession = await makeAnalyzerSession(
                naturalFormat: format,
                generation: generation
            )
            guard Task.isCancelled == false else {
                modernSession?.cancel()
                return
            }

            let legacyRequest: SFSpeechAudioBufferRecognitionRequest?
            if modernSession == nil {
                guard let legacyRecognizer, legacyRecognizer.isAvailable else {
                    errorMessage = "Speech recognition is not available."
                    return
                }
                let request = SFSpeechAudioBufferRecognitionRequest()
                request.shouldReportPartialResults = true
                recognitionRequest = request
                legacyRequest = request
                recognitionTask = legacyRecognizer.recognitionTask(with: request) { [weak self] result, error in
                    Task { @MainActor in
                        guard let self, self.recognitionGeneration == generation else {
                            return
                        }
                        if let result {
                            self.receiveRecognizedSpeech(result.bestTranscription.formattedString, generation: generation)
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
            isRecording = true
        } catch {
            endRecording(cancelTranscription: true)
            errorMessage = error.localizedDescription
        }
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
                }
            )
        } catch {
            return nil
        }
    }

    private func requestPermissions() async -> Bool {
        async let speechAllowed = requestSpeechPermission()
        async let microphoneAllowed = requestMicrophonePermission()
        let permissions = await (speechAllowed, microphoneAllowed)
        return permissions.0 && permissions.1
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
