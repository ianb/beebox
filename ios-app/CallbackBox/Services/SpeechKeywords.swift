import Foundation

enum SpeechKeywordAction: String, Codable, Sendable {
    case send
    case sendHq
    case sendClose
    case cancel
    case micOff
    case erase
}

struct SpeechKeywordResult: Equatable {
    var action: SpeechKeywordAction
    var processedTranscript: String
    var matchedPhrase: String
}

private struct InputWord {
    var normalized: String
    var original: String
    var leading: String
    var trailing: String
    /// True when the word sits inside a keyword tag this app wrote earlier
    /// (`<erase-message phrase="Clear message" />`). Such words are reproduced
    /// verbatim but may never take part in a match — see `keywordTagPattern`.
    var isProtected: Bool = false
}

private struct InputMatch {
    var leading: [InputWord]
    var captured: [InputWord]
    var remaining: [InputWord]

    var capturedTextTrimmed: String {
        Self.joinCaptured(captured).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func replaceTrimmed(with replacement: String) -> String {
        let original = Self.joinCaptured(captured)
        let leadingWhitespace = original.prefix { $0.isWhitespace }
        let trailingWhitespace = original.reversed().prefix { $0.isWhitespace }.reversed()
        let separatorBeforeCapture = leading.isEmpty ? captured.first?.leading ?? "" : ""
        let separatorAfterCapture = remaining.isEmpty ? captured.last?.trailing ?? "" : ""
        return Self.join(leading)
            + separatorBeforeCapture
            + leadingWhitespace
            + replacement
            + trailingWhitespace
            + separatorAfterCapture
            + Self.join(remaining)
    }

    static func join(_ words: [InputWord]) -> String {
        guard words.isEmpty == false else {
            return ""
        }
        let body = words.map { "\($0.leading)\($0.original)" }.joined()
        return body + (words.last?.trailing ?? "")
    }

    private static func joinCaptured(_ words: [InputWord]) -> String {
        guard let first = words.first else {
            return ""
        }
        return first.original + words.dropFirst().map { "\($0.leading)\($0.original)" }.joined()
    }
}

/// Native port of `callback-box/src/frontend/src/lib/audio/speech-keywords.ts`.
///
/// Keep this vocabulary, matching order, tag names, and phrase normalization in
/// sync with the TypeScript implementation and
/// `callback-box/test/frontend/lib/speech-keywords.doctest.md`. The Swift app
/// owns native dictation, but the persisted chat text is still read by the same
/// box-side prompt/display code as web voice input, so drift here is user-visible.
///
/// One deliberate divergence: this port refuses to match inside an existing
/// keyword tag (`isProtected`), so its own output can never be re-consumed as
/// input. Vocabulary and tag shape are unchanged; only nesting is bounded.
enum SpeechKeywords {
    private static let sendHqPatterns = [
        ["clean", "up", "and", "send"],
        ["send", "and", "clean", "up"],
    ].flatMap(expand)

    private static let sendClosePatterns = [
        ["send", "and", "close"],
        ["send", "and", "stop"],
        ["send", "and", "finish"],
        ["send", "and", "done"],
        ["send", "and", "sign", "off"],
        ["send", "and", "close", OptionalWord("the"), Choice(["mic", "microphone", "message"])],
        ["set", "a", "closed", OptionalWord("the"), Choice(["mic", "microphone", "message"])],
        ["over", "and", "out"],
    ].flatMap(expand)

    private static let micOffPatterns = [
        ["microphone", "off"],
        ["mic", "off"],
        ["turn", "off", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["stop", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["stop", "listening"],
    ].flatMap(expand)

    private static let cancelPatterns = [
        [Choice(["cancel", "abort", "nevermind"]), OptionalWord(["a", "the", "an"]), Choice(["message", "microphone"])],
        [Choice(["message", "microphone"]), Choice(["cancel", "abort", "nevermind"])],
    ].flatMap(expand)

    private static let erasePatterns = [
        ["erase", OptionalWord(["the", "a", "my"]), "message"],
        ["clear", OptionalWord(["the", "a", "my"]), "message"],
        ["start", "over"],
    ].flatMap(expand)

    private static let sendPatterns = [
        [Choice(["send", "sent", "same", "deliver", "finished", "finish", "said"]), OptionalWord(["a", "the", "an"]), "message"],
        ["it's", OptionalWord(["a", "the", "an"]), "message"],
        ["message", Choice(["done", "finished"])],
        ["send", "now"],
    ].flatMap(expand)

    static func detect(_ transcript: String, atStart: Bool = false) -> SpeechKeywordResult? {
        let words = tokenize(transcript)
        guard words.isEmpty == false else {
            return nil
        }

        if let match = firstMatch(patterns: sendClosePatterns, words: words, atStart: atStart) {
            return result(action: .sendClose, match: match)
        }
        if let match = firstMatch(patterns: sendHqPatterns, words: words, atStart: atStart) {
            return result(action: .sendHq, match: match)
        }
        if let match = firstMatch(patterns: micOffPatterns, words: words, atStart: atStart) {
            return result(action: .micOff, match: match)
        }
        if let match = firstMatch(patterns: cancelPatterns, words: words, atStart: atStart) {
            return result(action: .cancel, match: match)
        }
        if let match = firstMatch(patterns: erasePatterns, words: words, atStart: atStart) {
            return result(action: .erase, match: match)
        }
        if let match = firstMatch(patterns: sendPatterns, words: words, atStart: atStart) {
            return result(action: .send, match: match)
        }
        return nil
    }

    static func appendSendKeywordTag(
        to transcript: String,
        action: SpeechKeywordAction,
        matchedPhrase: String
    ) -> String {
        "\(transcript.trimmingCharacters(in: .whitespacesAndNewlines)) \(keywordTag(action: action, phrase: matchedPhrase))"
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func result(action: SpeechKeywordAction, match: InputMatch) -> SpeechKeywordResult {
        SpeechKeywordResult(
            action: action,
            processedTranscript: match.replaceTrimmed(with: keywordTag(action: action, phrase: match.capturedTextTrimmed))
                .trimmingCharacters(in: .whitespacesAndNewlines),
            matchedPhrase: match.capturedTextTrimmed
        )
    }

    private static func keywordTag(action: SpeechKeywordAction, phrase: String) -> String {
        let escaped = phrase
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
        return "<\(tagName(for: action)) phrase=\"\(escaped)\" />"
    }

    private static func tagName(for action: SpeechKeywordAction) -> String {
        switch action {
        case .send:
            "send-message"
        case .sendHq:
            "send-message"
        case .sendClose:
            "send-close-message"
        case .cancel:
            "cancel-message"
        case .micOff:
            "mic-off"
        case .erase:
            "erase-message"
        }
    }

    private static func firstMatch(patterns: [[String]], words: [InputWord], atStart: Bool) -> InputMatch? {
        for startIndex in words.indices {
            if atStart && startIndex > words.startIndex {
                return nil
            }
            let rest = Array(words[startIndex...])
            for pattern in patterns {
                guard pattern.count <= rest.count else {
                    continue
                }
                let candidates = Array(rest.prefix(pattern.count))
                // A tag's own words ("erase-message", and the phrase it quotes)
                // read as the very command that produced them. Matching them
                // would substitute inside the previous substitution, so each
                // repeat would nest a tag inside a tag.
                if candidates.contains(where: \.isProtected) {
                    continue
                }
                if zip(pattern, candidates).allSatisfy({ wordsEqual($0.1.normalized, normalize($0.0)) }) {
                    return InputMatch(
                        leading: Array(words[..<startIndex]),
                        captured: candidates,
                        remaining: Array(rest.dropFirst(pattern.count))
                    )
                }
            }
        }
        return nil
    }

    private static func normalize(_ word: String) -> String {
        let folded = word.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        return folded.unicodeScalars
            .filter { CharacterSet.alphanumerics.contains($0) }
            .map(String.init)
            .joined()
            .lowercased()
    }

    private static func wordsEqual(_ a: String, _ b: String) -> Bool {
        if a == b {
            return true
        }
        let shorter: String
        let longer: String
        if a.count <= b.count {
            shorter = a
            longer = b
        } else {
            shorter = b
            longer = a
        }
        guard shorter.count >= 2 else {
            return false
        }
        if longer == "\(shorter)s" || longer == "\(shorter)es" {
            return true
        }
        if shorter.hasSuffix("y") {
            return longer == "\(shorter.dropLast())ies"
        }
        return false
    }

    /// Matches a markup tag, which for this input means a keyword tag this app
    /// already wrote. The whole tag — name, attribute, quoted phrase — is
    /// off-limits to matching. Deliberately loose (any `<name …>`): the point is
    /// to fence off text the app generated, not to validate it. A phrase
    /// containing `>` would end the fence early; dictation does not produce
    /// angle brackets, and `keywordTag` escapes `&` and `"` already.
    private static let keywordTagPattern = #"<\s*/?\s*[A-Za-z][^<>]*>"#

    private static func protectedRanges(in text: String) -> [NSRange] {
        guard let regex = try? NSRegularExpression(pattern: keywordTagPattern) else {
            return []
        }
        let nsText = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)).map(\.range)
    }

    private static func tokenize(_ text: String) -> [InputWord] {
        let nsText = text as NSString
        guard let regex = try? NSRegularExpression(pattern: #"[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?"#) else {
            return []
        }
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
        guard matches.isEmpty == false else {
            return []
        }
        let fenced = protectedRanges(in: text)
        var words: [InputWord] = []
        var cursor = 0
        for match in matches {
            let leading = nsText.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let original = nsText.substring(with: match.range)
            cursor = match.range.location + match.range.length
            words.append(InputWord(
                normalized: normalize(original),
                original: original,
                leading: leading,
                trailing: "",
                isProtected: fenced.contains { NSIntersectionRange($0, match.range).length > 0 }
            ))
        }
        for index in words.indices {
            let nextStart = index == words.index(before: words.endIndex)
                ? nsText.length
                : matches[index + 1].range.location
            let currentEnd = matches[index].range.location + matches[index].range.length
            words[index].trailing = nsText.substring(with: NSRange(location: currentEnd, length: nextStart - currentEnd))
        }
        return words.filter { $0.normalized.isEmpty == false }
    }
}

enum VoicePreparationResolver {
    static func text(for preparation: VoicePreparation, hqTranscript: String?) -> String {
        guard let hqTranscript else {
            return preparation.liveTranscript
        }
        let processed = SpeechKeywords.detect(hqTranscript)?.processedTranscript
            ?? SpeechKeywords.appendSendKeywordTag(
                to: hqTranscript,
                action: preparation.action,
                matchedPhrase: preparation.matchedPhrase
            )
        return join(preparation.priorInput, processed)
    }

    private static func join(_ first: String, _ second: String) -> String {
        let cleanFirst = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSecond = second.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleanFirst.isEmpty {
            return cleanSecond
        }
        if cleanSecond.isEmpty {
            return cleanFirst
        }
        return "\(cleanFirst) \(cleanSecond)"
    }
}

enum NativeVoiceKeywordSendPlan: Equatable {
    case live(text: String)
    case hq

    static func make(
        liveTranscript: String,
        action: SpeechKeywordAction,
        narrationEnabled: Bool
    ) -> NativeVoiceKeywordSendPlan {
        narrationEnabled || action == .sendHq ? .hq : .live(text: liveTranscript)
    }
}

private struct Choice {
    var words: [String]

    init(_ words: [String]) {
        self.words = words
    }
}

private struct OptionalWord {
    var words: [String]

    init(_ word: String) {
        words = [word]
    }

    init(_ words: [String]) {
        self.words = words
    }
}

private enum PatternPart {
    case word(String)
    case choice(Choice)
    case optional(OptionalWord)
}

private func expand(_ parts: [Any]) -> [[String]] {
    let normalized = parts.map { part -> PatternPart in
        if let word = part as? String {
            return .word(word)
        }
        if let choice = part as? Choice {
            return .choice(choice)
        }
        if let optional = part as? OptionalWord {
            return .optional(optional)
        }
        assertionFailure("Unsupported keyword pattern part: \(part)")
        return .word("")
    }

    var expansions: [[String]] = [[]]
    for part in normalized {
        switch part {
        case .word(let word):
            expansions = expansions.map { $0 + [word] }
        case .choice(let choice):
            expansions = expansions.flatMap { base in
                choice.words.map { base + [$0] }
            }
        case .optional(let optional):
            let omitted = expansions
            let included = expansions.flatMap { base in
                optional.words.map { base + [$0] }
            }
            expansions = omitted + included
        }
    }
    return expansions
}
