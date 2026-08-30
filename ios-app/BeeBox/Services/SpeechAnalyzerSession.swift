import AVFAudio
import Foundation
import Speech

protocol LiveSpeechRecognitionSession: AnyObject {
    func append(_ buffer: AVAudioPCMBuffer)
    func finish()
    func cancel()
}

struct ProgressiveSpeechTranscript: Equatable {
    private(set) var finalizedText = ""
    private(set) var volatileText = ""

    var text: String {
        finalizedText + volatileText
    }

    mutating func apply(text: String, isFinal: Bool) {
        if isFinal {
            finalizedText += text
            volatileText = ""
        } else {
            volatileText = text
        }
    }
}

@available(iOS 26.0, *)
final class AppleSpeechAnalyzerSession: LiveSpeechRecognitionSession {
    private enum Transcriber {
        case speech(SpeechTranscriber)
        case dictation(DictationTranscriber)

        var modules: [any SpeechModule] {
            switch self {
            case .speech(let transcriber):
                [transcriber]
            case .dictation(let transcriber):
                [transcriber]
            }
        }
    }

    enum SetupError: LocalizedError {
        case unsupportedLocale
        case missingAudioFormat
        case modelUnavailable

        var errorDescription: String? {
            switch self {
            case .unsupportedLocale:
                "Apple's on-device speech model does not support this language."
            case .missingAudioFormat:
                "Apple's speech analyzer could not select an audio format."
            case .modelUnavailable:
                "Apple's on-device speech model could not be installed."
            }
        }
    }

    private let analyzer: SpeechAnalyzer
    private let inputBuilder: AsyncStream<AnalyzerInput>.Continuation
    private let converter: AVAudioConverter
    private let lock = NSLock()
    private var acceptingInput = true
    private var reportedConversionFailure = false
    private var analysisTask: Task<Void, Never>?
    private var resultsTask: Task<Void, Never>?
    private let onFailure: @MainActor @Sendable (String) -> Void

    static func create(
        naturalFormat: AVAudioFormat,
        locale: Locale,
        onTranscript: @escaping @MainActor @Sendable (String) -> Void,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) async throws -> AppleSpeechAnalyzerSession {
        let transcriber: Transcriber
        if
            SpeechTranscriber.isAvailable,
            let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
        {
            transcriber = .speech(
                SpeechTranscriber(locale: supportedLocale, preset: .progressiveTranscription)
            )
        } else if let supportedLocale = await DictationTranscriber.supportedLocale(equivalentTo: locale) {
            transcriber = .dictation(
                DictationTranscriber(locale: supportedLocale, preset: .progressiveLongDictation)
            )
        } else {
            throw SetupError.unsupportedLocale
        }

        let modules = transcriber.modules
        if await AssetInventory.status(forModules: modules) != .installed {
            let installation = try await AssetInventory.assetInstallationRequest(supporting: modules)
            try await installation?.downloadAndInstall()
        }
        guard await AssetInventory.status(forModules: modules) == .installed else {
            throw SetupError.modelUnavailable
        }

        let analyzer = SpeechAnalyzer(modules: modules)
        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else {
            throw SetupError.missingAudioFormat
        }
        guard let converter = AVAudioConverter(from: naturalFormat, to: analyzerFormat) else {
            throw SetupError.missingAudioFormat
        }
        try await analyzer.prepareToAnalyze(in: analyzerFormat)

        let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
        let session = AppleSpeechAnalyzerSession(
            analyzer: analyzer,
            inputBuilder: inputBuilder,
            converter: converter,
            onFailure: onFailure
        )
        session.startAnalysis(inputSequence: inputSequence, onFailure: onFailure)
        switch transcriber {
        case .speech(let speechTranscriber):
            session.startResults(
                speechTranscriber.results,
                text: { String($0.text.characters) },
                onTranscript: onTranscript,
                onFailure: onFailure
            )
        case .dictation(let dictationTranscriber):
            session.startResults(
                dictationTranscriber.results,
                text: { String($0.text.characters) },
                onTranscript: onTranscript,
                onFailure: onFailure
            )
        }
        return session
    }

    private init(
        analyzer: SpeechAnalyzer,
        inputBuilder: AsyncStream<AnalyzerInput>.Continuation,
        converter: AVAudioConverter,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) {
        self.analyzer = analyzer
        self.inputBuilder = inputBuilder
        self.converter = converter
        self.onFailure = onFailure
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard acceptingInput else {
            return
        }
        do {
            if let converted = try convert(buffer) {
                inputBuilder.yield(AnalyzerInput(buffer: converted))
            }
        } catch {
            guard reportedConversionFailure == false else {
                return
            }
            reportedConversionFailure = true
            let message = error.localizedDescription
            Task { @MainActor [onFailure] in
                onFailure(message)
            }
        }
    }

    func finish() {
        lock.lock()
        guard acceptingInput else {
            lock.unlock()
            return
        }
        acceptingInput = false
        lock.unlock()
        inputBuilder.finish()
    }

    func cancel() {
        finish()
        analysisTask?.cancel()
        resultsTask?.cancel()
        let analyzer = analyzer
        Task {
            await analyzer.cancelAndFinishNow()
        }
    }

    private func startResults<Results>(
        _ results: Results,
        text: @escaping @Sendable (Results.Element) -> String,
        onTranscript: @escaping @MainActor @Sendable (String) -> Void,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) where Results: AsyncSequence & Sendable, Results.Element: SpeechModuleResult {
        resultsTask = Task {
            var transcript = ProgressiveSpeechTranscript()
            do {
                for try await result in results {
                    guard Task.isCancelled == false else {
                        return
                    }
                    transcript.apply(text: text(result), isFinal: result.isFinal)
                    await onTranscript(transcript.text)
                }
            } catch {
                guard Task.isCancelled == false else {
                    return
                }
                await onFailure(error.localizedDescription)
            }
        }
    }

    private func startAnalysis(
        inputSequence: AsyncStream<AnalyzerInput>,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) {
        analysisTask = Task {
            do {
                let lastSample = try await analyzer.analyzeSequence(inputSequence)
                guard Task.isCancelled == false else {
                    await analyzer.cancelAndFinishNow()
                    return
                }
                if let lastSample {
                    try await analyzer.finalizeAndFinish(through: lastSample)
                } else {
                    await analyzer.cancelAndFinishNow()
                }
            } catch {
                guard Task.isCancelled == false else {
                    return
                }
                await onFailure(error.localizedDescription)
            }
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
        let sampleRateRatio = converter.outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * sampleRateRatio)) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else {
            throw SetupError.missingAudioFormat
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if suppliedInput {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error {
            throw conversionError ?? SetupError.missingAudioFormat
        }
        return output.frameLength == 0 ? nil : output
    }
}
