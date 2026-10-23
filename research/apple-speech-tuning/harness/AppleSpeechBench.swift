// Runs audio files through one configuration of Apple's on-device speech
// recognition and writes one JSON line per file. macOS 26 has the same
// SpeechTranscriber and DictationTranscriber as iOS 26, so these results stand
// in for the phone's model (not its speed).
//
// Build: research/apple-speech-tuning/harness/build.sh
// Run:   apple-speech-bench --config st.transcription --manifest m.jsonl --out o.jsonl [--vocab-key oracle]

import AVFAudio
import CoreMedia
import Foundation
import Speech

struct ManifestItem: Decodable {
    var id: String
    var audio: String
    /// Vocabulary lists by name ("oracle", "box", …); `--vocab-key` picks one.
    var vocab: [String: [String]]?
    /// Items that share a group share one custom language model.
    var group: String?
}

struct Output: Encodable {
    var id: String
    var config: String
    var vocabKey: String?
    var text: String
    /// Per final result: the alternatives Apple reported, best first.
    var alternatives: [[String]]?
    /// Per word-ish run: the text and its confidence, when requested.
    var confidences: [WordConfidence]?
    var audioSeconds: Double
    var elapsedSeconds: Double
    var error: String?
}

struct WordConfidence: Encodable {
    var text: String
    var confidence: Double
}

struct Args {
    var config = "st.transcription"
    var manifest = ""
    var out = ""
    var vocabKey: String?
    var lmWeight: Double?
    var limit: Int?

    static func parse() -> Args {
        var args = Args()
        var it = CommandLine.arguments.dropFirst().makeIterator()
        while let flag = it.next() {
            let value = it.next() ?? ""
            switch flag {
            case "--config": args.config = value
            case "--manifest": args.manifest = value
            case "--out": args.out = value
            case "--vocab-key": args.vocabKey = value
            case "--lm-weight": args.lmWeight = Double(value)
            case "--limit": args.limit = Int(value)
            case "--locale": locale = Locale(identifier: value)
            default:
                FileHandle.standardError.write("unknown flag \(flag)\n".data(using: .utf8)!)
                exit(2)
            }
        }
        return args
    }
}

enum BenchError: Error, CustomStringConvertible {
    case unsupportedLocale(String)
    case assets(String)
    case unknownConfig(String)
    case recognizer(String)

    var description: String {
        switch self {
        case .unsupportedLocale(let s): "unsupported locale \(s)"
        case .assets(let s): "assets \(s)"
        case .unknownConfig(let s): "unknown config \(s)"
        case .recognizer(let s): "recognizer \(s)"
        }
    }
}

/// Set from `--locale` (default en-US) before any transcriber is made.
nonisolated(unsafe) var locale = Locale(identifier: "en-US")

// MARK: - Results collection

struct Collected {
    var text = ""
    var alternatives: [[String]] = []
    var confidences: [WordConfidence] = []
}

func collect(_ attributed: AttributedString, alternatives: [AttributedString], into c: inout Collected, wantConfidence: Bool) {
    c.text += String(attributed.characters)
    if alternatives.isEmpty == false {
        c.alternatives.append(alternatives.map { String($0.characters) })
    }
    if wantConfidence {
        for run in attributed.runs {
            if let conf = run.transcriptionConfidence {
                c.confidences.append(WordConfidence(text: String(attributed[run.range].characters), confidence: conf))
            }
        }
    }
}

// MARK: - SpeechAnalyzer configurations

func speechTranscriber(config: String) throws -> SpeechTranscriber {
    switch config {
    case "st.transcription":
        return SpeechTranscriber(locale: locale, preset: .transcription)
    case "st.alternatives":
        return SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.alternativeTranscriptions],
            attributeOptions: [.transcriptionConfidence]
        )
    case "st.progressive":
        return SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
    case "st.fast":
        return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.fastResults], attributeOptions: [])
    case "st.etiquette":
        return SpeechTranscriber(locale: locale, transcriptionOptions: [.etiquetteReplacements], reportingOptions: [], attributeOptions: [])
    default:
        throw BenchError.unknownConfig(config)
    }
}

func dictationTranscriber(config: String, lm: SFSpeechLanguageModel.Configuration?) throws -> DictationTranscriber {
    var preset: DictationTranscriber.Preset
    switch config {
    case "dt.long", "dt.long.lm":
        preset = .longDictation
    case "dt.long.farfield":
        preset = .longDictation
        preset.contentHints.insert(.farField)
    case "dt.long.alternatives":
        preset = .longDictation
        preset.reportingOptions.insert(.alternativeTranscriptions)
        preset.attributeOptions.insert(.transcriptionConfidence)
    case "dt.short":
        preset = .shortDictation
    default:
        throw BenchError.unknownConfig(config)
    }
    if let lm {
        preset.contentHints.insert(.customizedLanguage(modelConfiguration: lm))
    }
    return DictationTranscriber(
        locale: locale,
        contentHints: preset.contentHints,
        transcriptionOptions: preset.transcriptionOptions,
        reportingOptions: preset.reportingOptions,
        attributeOptions: preset.attributeOptions
    )
}

func ensureAssets(_ modules: [any SpeechModule]) async throws {
    if await AssetInventory.status(forModules: modules) != .installed {
        FileHandle.standardError.write("installing assets…\n".data(using: .utf8)!)
        try await AssetInventory.assetInstallationRequest(supporting: modules)?.downloadAndInstall()
    }
    guard await AssetInventory.status(forModules: modules) == .installed else {
        throw BenchError.assets("not installed")
    }
}

func runAnalyzer(
    fileURL: URL,
    config: String,
    vocab: [String]?,
    lm: SFSpeechLanguageModel.Configuration?
) async throws -> Collected {
    let audioFile = try AVAudioFile(forReading: fileURL)
    let modules: [any SpeechModule]
    let resultsTask: Task<Collected, Error>
    let wantConfidence = config.hasSuffix("alternatives")
    if config.hasPrefix("st.") {
        let t = try speechTranscriber(config: config)
        modules = [t]
        try await ensureAssets(modules)
        resultsTask = Task {
            var c = Collected()
            for try await r in t.results where r.isFinal {
                collect(r.text, alternatives: r.alternatives, into: &c, wantConfidence: wantConfidence)
            }
            return c
        }
    } else {
        let t = try dictationTranscriber(config: config, lm: lm)
        modules = [t]
        try await ensureAssets(modules)
        resultsTask = Task {
            var c = Collected()
            for try await r in t.results where r.isFinal {
                collect(r.text, alternatives: r.alternatives, into: &c, wantConfidence: wantConfidence)
            }
            return c
        }
    }
    let analyzer = SpeechAnalyzer(modules: modules)
    if let vocab, vocab.isEmpty == false {
        let context = AnalysisContext()
        context.contextualStrings[.general] = vocab
        try await analyzer.setContext(context)
    }
    if let last = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: last)
    } else {
        await analyzer.cancelAndFinishNow()
    }
    return try await resultsTask.value
}

// MARK: - Legacy SFSpeechRecognizer

func runLegacy(
    fileURL: URL,
    vocab: [String]?,
    lm: SFSpeechLanguageModel.Configuration?
) async throws -> Collected {
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
        throw BenchError.recognizer("no recognizer")
    }
    guard recognizer.supportsOnDeviceRecognition else {
        throw BenchError.recognizer("no on-device support")
    }
    let request = SFSpeechURLRecognitionRequest(url: fileURL)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.addsPunctuation = true
    if let vocab {
        request.contextualStrings = vocab
    }
    if let lm {
        request.customizedLanguageModel = lm
    }
    let delegate = LegacyDelegate()
    return try await withCheckedThrowingContinuation { cont in
        delegate.continuation = cont
        delegate.task = recognizer.recognitionTask(with: request, delegate: delegate)
    }
}

/// On-device file recognition reports one final result per utterance, then
/// finishes; the closure API makes the end hard to see, so use the delegate.
final class LegacyDelegate: NSObject, SFSpeechRecognitionTaskDelegate, @unchecked Sendable {
    var continuation: CheckedContinuation<Collected, Error>?
    var task: SFSpeechRecognitionTask?
    private var collected = Collected()

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishRecognition result: SFSpeechRecognitionResult) {
        let best = result.bestTranscription.formattedString
        collected.text += (collected.text.isEmpty ? "" : " ") + best
        collected.alternatives.append(result.transcriptions.map(\.formattedString))
    }

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool) {
        guard let continuation else { return }
        self.continuation = nil
        if successfully || collected.text.isEmpty == false {
            continuation.resume(returning: collected)
        } else {
            continuation.resume(throwing: task.error ?? BenchError.recognizer("failed"))
        }
    }
}

// MARK: - Custom language model

var lmCache: [String: SFSpeechLanguageModel.Configuration] = [:]

func customLanguageModel(group: String, vocab: [String], weight: Double?) async throws -> SFSpeechLanguageModel.Configuration {
    let weightLabel = weight.map { String($0) } ?? "default"
    let key = "\(group)|\(weightLabel)"
    if let cached = lmCache[key] {
        return cached
    }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("apple-speech-bench-lm/\(key.replacingOccurrences(of: "|", with: "_"))")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let data = SFCustomLanguageModelData(locale: locale, identifier: "run.beebox.bench.\(group)", version: "1.0")
    for term in vocab {
        data.insert(phraseCount: .init(phrase: term, count: 10))
    }
    // Carrier phrases give each term a sentence context to appear in, the
    // way Apple's sample code uses templates.
    let generator = SFCustomLanguageModelData.TemplatePhraseCountGenerator()
    generator.define(className: "term", values: vocab)
    for template in ["<term>", "about <term>", "with <term>", "from <term>", "<term> said", "talk to <term>", "the <term> project"] {
        generator.insert(template: template, count: 5)
    }
    data.insert(phraseCountGenerator: generator)
    let asset = dir.appendingPathComponent("data.bin")
    try await data.export(to: asset)
    let configuration: SFSpeechLanguageModel.Configuration
    if let weight {
        configuration = SFSpeechLanguageModel.Configuration(
            languageModel: dir.appendingPathComponent("lm.bin"),
            vocabulary: dir.appendingPathComponent("vocab.bin"),
            weight: NSNumber(value: weight)
        )
    } else {
        configuration = SFSpeechLanguageModel.Configuration(
            languageModel: dir.appendingPathComponent("lm.bin"),
            vocabulary: dir.appendingPathComponent("vocab.bin")
        )
    }
    try await SFSpeechLanguageModel.prepareCustomLanguageModel(for: asset, configuration: configuration, ignoresCache: true)
    lmCache[key] = configuration
    return configuration
}

// MARK: - Main

func describePresets() -> String {
    func st(_ name: String, _ p: SpeechTranscriber.Preset) -> String {
        "  SpeechTranscriber.\(name): transcription=\(p.transcriptionOptions) reporting=\(p.reportingOptions) attributes=\(p.attributeOptions)"
    }
    func dt(_ name: String, _ p: DictationTranscriber.Preset) -> String {
        "  DictationTranscriber.\(name): hints=\(p.contentHints) transcription=\(p.transcriptionOptions) reporting=\(p.reportingOptions) attributes=\(p.attributeOptions)"
    }
    return [
        st("transcription", .transcription),
        st("transcriptionWithAlternatives", .transcriptionWithAlternatives),
        st("timeIndexedTranscriptionWithAlternatives", .timeIndexedTranscriptionWithAlternatives),
        st("progressiveTranscription", .progressiveTranscription),
        st("timeIndexedProgressiveTranscription", .timeIndexedProgressiveTranscription),
        dt("phrase", .phrase),
        dt("shortDictation", .shortDictation),
        dt("progressiveShortDictation", .progressiveShortDictation),
        dt("longDictation", .longDictation),
        dt("progressiveLongDictation", .progressiveLongDictation),
        dt("timeIndexedLongDictation", .timeIndexedLongDictation),
    ].joined(separator: "\n")
}

@main
struct Main {
    static func main() async {
        if CommandLine.arguments.dropFirst().first == "--describe" {
            print(describePresets())
            print("SpeechTranscriber.isAvailable=\(SpeechTranscriber.isAvailable)")
            print("SpeechTranscriber.installedLocales=\(await SpeechTranscriber.installedLocales.map(\.identifier))")
            print("DictationTranscriber.installedLocales=\(await DictationTranscriber.installedLocales.map(\.identifier))")
            let st = SpeechTranscriber(locale: locale, preset: .transcription)
            let dt = DictationTranscriber(locale: locale, preset: .longDictation)
            print("st formats=\(await st.availableCompatibleAudioFormats)")
            print("dt formats=\(await dt.availableCompatibleAudioFormats)")
            print("best format st=\(String(describing: await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [st])))")
            print("best format dt=\(String(describing: await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [dt])))")
            print("phonemes en-US=\(SFCustomLanguageModelData.supportedPhonemes(locale: locale).prefix(60))")
            return
        }
        let args = Args.parse()
        let decoder = JSONDecoder()
        let encoder = JSONEncoder()
        var items: [ManifestItem] = []
        do {
            let text = try String(contentsOfFile: args.manifest, encoding: .utf8)
            for line in text.split(separator: "\n") where line.isEmpty == false {
                items.append(try decoder.decode(ManifestItem.self, from: Data(line.utf8)))
            }
        } catch {
            FileHandle.standardError.write("manifest: \(error)\n".data(using: .utf8)!)
            exit(1)
        }
        if let limit = args.limit {
            items = Array(items.prefix(limit))
        }
        FileManager.default.createFile(atPath: args.out, contents: nil)
        guard let out = FileHandle(forWritingAtPath: args.out) else {
            exit(1)
        }
        let usesLM = args.config.hasSuffix(".lm")
        for (index, item) in items.enumerated() {
            let url = URL(fileURLWithPath: item.audio)
            let vocab = args.vocabKey.flatMap { item.vocab?[$0] }
            var record = Output(id: item.id, config: args.config, vocabKey: args.vocabKey, text: "", audioSeconds: 0, elapsedSeconds: 0)
            do {
                let file = try AVAudioFile(forReading: url)
                record.audioSeconds = Double(file.length) / file.fileFormat.sampleRate
                var lm: SFSpeechLanguageModel.Configuration?
                if usesLM {
                    lm = try await customLanguageModel(group: "\(item.group ?? "all")-\(args.vocabKey ?? "none")", vocab: vocab ?? [], weight: args.lmWeight)
                }
                // With a custom LM, the vocabulary goes into the LM; the
                // context strings are passed too only when not using one.
                let contextVocab = usesLM ? nil : vocab
                let start = Date()
                let collected: Collected
                if args.config.hasPrefix("sf.") {
                    collected = try await runLegacy(fileURL: url, vocab: contextVocab, lm: lm)
                } else {
                    collected = try await runAnalyzer(fileURL: url, config: args.config, vocab: contextVocab, lm: lm)
                }
                record.elapsedSeconds = Date().timeIntervalSince(start)
                record.text = collected.text.trimmingCharacters(in: .whitespacesAndNewlines)
                record.alternatives = collected.alternatives.isEmpty ? nil : collected.alternatives
                record.confidences = collected.confidences.isEmpty ? nil : collected.confidences
            } catch {
                record.error = String(describing: error)
            }
            if let data = try? encoder.encode(record) {
                out.write(data)
                out.write("\n".data(using: .utf8)!)
            }
            FileHandle.standardError.write("[\(index + 1)/\(items.count)] \(item.id) \(String(format: "%.2f", record.elapsedSeconds))s\(record.error.map { " ERROR \($0)" } ?? "")\n".data(using: .utf8)!)
        }
        try? out.close()
    }
}
