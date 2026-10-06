import AVFAudio
import Foundation
import Speech

/// The HQ pass run on the phone: Apple's `SpeechTranscriber` over the finished
/// recording, with a final-results preset.
///
/// When it is available it IS the HQ pass — the composer sends its text and
/// makes no call to `/api/chat/transcribe-audio`. "Available" is narrow on
/// purpose: `DictationTranscriber`, which the live session falls back to for a
/// locale `SpeechTranscriber` lacks, is the older model and does not count; the
/// server pass is better than it. Every reason the pass did not run or did not
/// finish is a `Skip`, and the caller continues with the server path.
enum OnDeviceHqTranscriber {
    /// The `hqService` value an on-device pass stamps on its emission. The web
    /// side passes it through to `<speech stt-service="…">` unchanged.
    static let serviceName = "apple-speech-transcriber"

    enum Skip: Error, Equatable {
        /// The box's HQ service labels speakers; `SpeechTranscriber` cannot.
        case diarizationRequested
        case osTooOld
        case transcriberUnavailable
        case unsupportedLocale
        /// The language model is not installed yet. The send does not wait for
        /// a download; `prefetchAssets` starts one ahead of time.
        case assetsNotInstalled
        case timedOut
        case emptyTranscript
        case failed(String)

        /// A stable label for `BoxLog`; `failed` carries the error's type name,
        /// never its message, which can quote audio content.
        var logLabel: String {
            switch self {
            case .diarizationRequested: "diarization-requested"
            case .osTooOld: "os-too-old"
            case .transcriberUnavailable: "transcriber-unavailable"
            case .unsupportedLocale: "unsupported-locale"
            case .assetsNotInstalled: "assets-not-installed"
            case .timedOut: "timed-out"
            case .emptyTranscript: "empty-transcript"
            case .failed(let kind): "failed:\(kind)"
            }
        }
    }

    struct Result: Equatable {
        var text: String
        var audioSeconds: Double
    }

    /// Transcribes the recording on the device, or throws a `Skip`.
    ///
    /// The pass is bounded: a recording that the model has not finished within
    /// `timeout(forAudioSeconds:)` goes to the server instead of holding the
    /// message.
    static func transcribe(
        fileURL: URL,
        locale: Locale = .current,
        diarizationRequested: Bool
    ) async throws -> Result {
        guard diarizationRequested == false else {
            throw Skip.diarizationRequested
        }
        guard #available(iOS 26.0, *) else {
            throw Skip.osTooOld
        }
        return try await SpeechTranscriberPass.run(fileURL: fileURL, locale: locale)
    }

    /// Starts the one-time language-model download in the background, so the
    /// first HQ send after enabling HQ dictation does not fall through to the
    /// server for want of assets. The web re-posts its HQ state on every
    /// session change, so this runs once per process: again only after a
    /// download that failed, never after one that finished or a check that
    /// says this phone cannot run the model.
    static func prefetchAssets(locale: Locale = .current) {
        guard #available(iOS 26.0, *) else {
            return
        }
        guard prefetch.begin() else {
            return
        }
        Task.detached(priority: .utility) {
            let outcome = await SpeechTranscriberPass.installAssets(locale: locale)
            prefetch.finish(retryable: outcome == .downloadFailed)
        }
    }

    private static let prefetch = PrefetchGate()

    private final class PrefetchGate: @unchecked Sendable {
        private let lock = NSLock()
        private var started = false

        func begin() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard started == false else {
                return false
            }
            started = true
            return true
        }

        func finish(retryable: Bool) {
            lock.lock()
            defer { lock.unlock() }
            if retryable {
                started = false
            }
        }
    }

    /// Installs the language model if it is missing; true once it is installed.
    @discardableResult
    static func installAssets(locale: Locale = .current) async -> Bool {
        guard #available(iOS 26.0, *) else {
            return false
        }
        return await SpeechTranscriberPass.installAssets(locale: locale) == .installed
    }

    /// Twice the recording's length, never under 30 seconds. On-device
    /// transcription runs well faster than real time; a pass past this bound
    /// is stuck rather than slow.
    static func timeout(forAudioSeconds seconds: Double) -> Duration {
        .seconds(max(30, seconds * 2))
    }
}

private enum AssetInstallOutcome {
    case installed
    case unavailable
    case downloadFailed
}

@available(iOS 26.0, *)
private enum SpeechTranscriberPass {
    static func transcriber(locale: Locale) async throws -> SpeechTranscriber {
        guard SpeechTranscriber.isAvailable else {
            throw OnDeviceHqTranscriber.Skip.transcriberUnavailable
        }
        guard let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            throw OnDeviceHqTranscriber.Skip.unsupportedLocale
        }
        return SpeechTranscriber(locale: supportedLocale, preset: .transcription)
    }

    static func installAssets(locale: Locale) async -> AssetInstallOutcome {
        do {
            let modules = [try await transcriber(locale: locale)]
            guard await AssetInventory.status(forModules: modules) != .installed else {
                return .installed
            }
            BoxLog.info("voice HQ on-device assets download started", category: .composer)
            try await AssetInventory.assetInstallationRequest(supporting: modules)?.downloadAndInstall()
            guard await AssetInventory.status(forModules: modules) == .installed else {
                BoxLog.warn("voice HQ on-device assets download finished but not installed", category: .composer)
                return .downloadFailed
            }
            BoxLog.info("voice HQ on-device assets installed", category: .composer)
            return .installed
        } catch let skip as OnDeviceHqTranscriber.Skip {
            BoxLog.info("voice HQ on-device assets not fetched reason=\(skip.logLabel)", category: .composer)
            return .unavailable
        } catch {
            BoxLog.warn(
                "voice HQ on-device assets download failed error=\(String(reflecting: type(of: error)))",
                category: .composer
            )
            return .downloadFailed
        }
    }

    static func run(fileURL: URL, locale: Locale) async throws -> OnDeviceHqTranscriber.Result {
        let transcriber = try await transcriber(locale: locale)
        let modules: [any SpeechModule] = [transcriber]
        guard await AssetInventory.status(forModules: modules) == .installed else {
            throw OnDeviceHqTranscriber.Skip.assetsNotInstalled
        }
        let audioFile: AVAudioFile
        do {
            audioFile = try AVAudioFile(forReading: fileURL)
        } catch {
            throw OnDeviceHqTranscriber.Skip.failed("audio-file-unreadable")
        }
        let audioSeconds = Double(audioFile.length) / audioFile.fileFormat.sampleRate
        let analyzer = SpeechAnalyzer(modules: modules)

        let text: String
        do {
            text = try await withThrowingTaskGroup(of: String?.self) { group in
                group.addTask {
                    var text = ""
                    for try await result in transcriber.results where result.isFinal {
                        text += String(result.text.characters)
                    }
                    return text
                }
                group.addTask {
                    if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
                        try await analyzer.finalizeAndFinish(through: lastSample)
                    } else {
                        await analyzer.cancelAndFinishNow()
                    }
                    return nil
                }
                group.addTask {
                    try await Task.sleep(for: OnDeviceHqTranscriber.timeout(forAudioSeconds: audioSeconds))
                    throw OnDeviceHqTranscriber.Skip.timedOut
                }
                var transcript: String?
                var analysisFinished = false
                while transcript == nil || analysisFinished == false {
                    guard let next = try await group.next() else {
                        break
                    }
                    if let next {
                        transcript = next
                    } else {
                        analysisFinished = true
                    }
                }
                group.cancelAll()
                return transcript ?? ""
            }
        } catch let skip as OnDeviceHqTranscriber.Skip {
            await analyzer.cancelAndFinishNow()
            throw skip
        } catch {
            await analyzer.cancelAndFinishNow()
            throw OnDeviceHqTranscriber.Skip.failed(String(reflecting: type(of: error)))
        }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            throw OnDeviceHqTranscriber.Skip.emptyTranscript
        }
        return OnDeviceHqTranscriber.Result(text: trimmed, audioSeconds: audioSeconds)
    }
}
