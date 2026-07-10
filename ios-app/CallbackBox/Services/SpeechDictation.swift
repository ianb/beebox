import AVFAudio
import Foundation
import Speech

@MainActor
final class SpeechDictation: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var hasDictatedText = false
    @Published private(set) var keywordIntent: SpeechKeywordResult?
    @Published var transcript = ""
    @Published var errorMessage: String?

    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale.current)
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
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
        Task {
            await start(currentText: currentText)
        }
    }

    func stop() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        if currentRecordingURL != nil {
            recordedAudioURL = currentRecordingURL
        }
        currentRecordingURL = nil
        recordingFile = nil
        recognitionRequest?.endAudio()
        recognitionTask?.finish()
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func resetDictationState() {
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
        errorMessage = nil
        keywordIntent = nil
        firedKeywordKey = nil
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Speech recognition is not available."
            return
        }
        guard await requestPermissions() else {
            errorMessage = "Enable microphone and speech recognition permissions to dictate."
            return
        }

        stop()
        seedText = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = currentText

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            recognitionRequest = request

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            let recordingURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("callbackbox-\(UUID().uuidString)")
                .appendingPathExtension("wav")
            let audioFile = try AVAudioFile(forWriting: recordingURL, settings: format.settings)
            currentRecordingURL = recordingURL
            recordingFile = audioFile
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
                try? audioFile.write(from: buffer)
            }

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else {
                        return
                    }
                    if let result {
                        let spoken = result.bestTranscription.formattedString
                        let currentTranscript = self.seedText.isEmpty ? spoken : "\(self.seedText) \(spoken)"
                        if let keyword = SpeechKeywords.detect(currentTranscript) {
                            let key = "\(keyword.action.rawValue):\(keyword.matchedPhrase)"
                            if key != self.firedKeywordKey {
                                self.firedKeywordKey = key
                                self.keywordSeedText = self.seedText
                                self.transcript = keyword.processedTranscript
                                self.hasDictatedText = true
                                self.keywordIntent = keyword
                                self.stop()
                                return
                            }
                        }
                        self.transcript = currentTranscript
                        self.hasDictatedText = self.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                    }
                    if error != nil || result?.isFinal == true {
                        self.stop()
                    }
                }
            }

            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
        } catch {
            stop()
            errorMessage = error.localizedDescription
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
