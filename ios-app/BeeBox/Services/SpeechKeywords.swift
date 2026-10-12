import Foundation

enum SpeechKeywordAction: String, Codable, Sendable {
    case send
    case sendHq
    case sendClose
    case sendCheckpoint
    case cancel
    case micOff
    case erase
}

extension SpeechKeywordAction {
    /// Whether accepting this action may publish the held keyword tag
    /// substitution into the composer draft.
    ///
    /// The substitution replaces the spoken command words with a control tag
    /// (`<mic-off phrase="Mic off" />`). That tag is message content once it is
    /// in the draft, so only an action that immediately hands the draft off as
    /// a message may commit it. Everything else discards the hold and keeps the
    /// pre-keyword transcript: mic-off leaves the composer standing, so a
    /// committed tag would sit there as text the user can later send, and
    /// cancel/erase clear the draft moments later anyway — discarding is what
    /// they mean.
    var commitsKeywordSubstitution: Bool {
        switch self {
        case .send, .sendHq, .sendClose, .sendCheckpoint:
            return true
        case .cancel, .micOff, .erase:
            return false
        }
    }
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

/// Native port of `beebox/src/frontend/src/lib/audio/speech-keywords.ts`.
///
/// Keep this vocabulary, matching order, tag names, and phrase normalization in
/// sync with the TypeScript implementation and
/// `beebox/src/frontend/test/lib/audio/speech-keywords.doctest.md`. The Swift app
/// owns native dictation, but the persisted chat text is still read by the same
/// box-side prompt/display code as web voice input, so drift here is user-visible.
///
/// One deliberate divergence: this port refuses to match inside an existing
/// keyword tag (`isProtected`), so its own output can never be re-consumed as
/// input. Vocabulary and tag shape are unchanged; only nesting is bounded.
enum SpeechKeywords {
    /// Representative phrases shown beside the native microphone while it is
    /// live. This is presentation guidance, not a second detection contract:
    /// detection remains local to this Swift implementation and may accept
    /// alternates that are not shown here.
    static let keywordHintsWithText = [
        "\"send message\"",
        "\"send checkpoint\"",
        "\"over and out\"",
        "\"erase message\"",
        "\"cancel message\"",
        "\"microphone off\"",
    ]

    /// Before dictation has produced text, only ending the microphone turn is
    /// useful. Keep this separate so the UI cannot suggest an action with no
    /// text to act on.
    static let keywordHintsWithoutText = ["\"microphone off\""]

    private static let sendHqPatterns = [
        ["clean", "up", "and", "send"],
        ["send", "and", "clean", "up"],
    ].flatMap(expand)

    private static let sendClosePatterns = [
        ["over", "and", "out"],
        ["send", "and", "close"],
        ["send", "and", "stop"],
        ["send", "and", "finish"],
        ["send", "and", "finished"],
        ["send", "and", "done"],
        ["send", "and", "sign", "off"],
        ["send", "and", "close", OptionalWord("the"), Choice(["mic", "microphone", "message"])],
        ["set", "a", "closed", OptionalWord("the"), Choice(["mic", "microphone", "message"])],
    ].flatMap(expand)

    /// "Send checkpoint": a plain send whose tag tells the agent the user is
    /// still talking. "checkpoint" alone never fires, and the commit/add verbs
    /// take no article, so talking about checkpoints stays plain speech.
    private static let sendCheckpointPatterns = [
        [Choice(["send", "sent"]), OptionalWord(["a", "the"]), "checkpoint", OptionalWord("message")],
        [Choice(["commit", "add"]), "checkpoint"],
    ].flatMap(expand)

    private static let micOffPatterns = [
        ["microphone", "off"],
        ["mic", "off"],
        ["turn", "off", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["stop", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["close", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["mute", OptionalWord("the"), Choice(["microphone", "mic"])],
        ["stop", "listening"],
        ["pause", "listening"],
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
        if let match = firstMatch(patterns: sendCheckpointPatterns, words: words, atStart: atStart) {
            return result(action: .sendCheckpoint, match: match)
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

    /// Re-attach a send keyword the HQ pass did not reproduce. The HQ text is
    /// kept as it came back; `heard="live"` says live dictation detected the
    /// command and the end of the text may still hold it in other words.
    static func appendSendKeywordTag(
        to transcript: String,
        action: SpeechKeywordAction,
        matchedPhrase: String
    ) -> String {
        let tag = keywordTag(action: action, phrase: matchedPhrase, heardLive: true)
        return "\(transcript.trimmingCharacters(in: .whitespacesAndNewlines)) \(tag)"
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

    private static func keywordTag(action: SpeechKeywordAction, phrase: String, heardLive: Bool = false) -> String {
        let escaped = phrase
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
        let heard = heardLive ? " heard=\"live\"" : ""
        return "<\(tagName(for: action)) phrase=\"\(escaped)\"\(heard) />"
    }

    /// Whether two actions write the same tag (`sendHq` and `send` both write
    /// `send-message`).
    static func sameTag(_ first: SpeechKeywordAction, _ second: SpeechKeywordAction) -> Bool {
        tagName(for: first) == tagName(for: second)
    }

    private static func tagName(for action: SpeechKeywordAction) -> String {
        switch action {
        case .send:
            "send-message"
        case .sendHq:
            "send-message"
        case .sendClose:
            "send-close-message"
        case .sendCheckpoint:
            "send-checkpoint-message"
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
            // The longest phrase at the earliest position wins, whatever the
            // pattern order: "send and close the mic" must not capture just
            // "send and close" and leave "the mic" in the message. Same rule
            // as the TS `KeywordPattern.match`.
            var best: [InputWord]?
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
                if zip(pattern, candidates).allSatisfy({ wordsEqual($0.1.normalized, normalize($0.0)) }),
                   candidates.count > (best?.count ?? 0) {
                    best = candidates
                }
            }
            if let best {
                return InputMatch(
                    leading: Array(words[..<startIndex]),
                    captured: best,
                    remaining: Array(rest.dropFirst(best.count))
                )
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

/// What a voice send captured, before any HQ pass: the composed live text,
/// the text typed before dictation, and the send keyword (if one was spoken).
struct VoiceSendText: Equatable {
    var liveTranscript: String
    var priorInput: String
    var action: SpeechKeywordAction
    var matchedPhrase: String
    /// False for the Send button: nothing was spoken to restore.
    var appendsKeywordTag: Bool
}

enum VoicePreparationResolver {
    static func text(for preparation: VoicePreparation, hqTranscript: String?) -> String {
        text(
            VoiceSendText(
                liveTranscript: preparation.liveTranscript,
                priorInput: preparation.priorInput,
                action: preparation.action,
                matchedPhrase: preparation.matchedPhrase,
                appendsKeywordTag: preparation.appendsKeywordTag != false
            ),
            hqTranscript: hqTranscript
        )
    }

    /// The text a voice send delivers: the live transcript when there is no
    /// HQ text, else the typed prefix joined to the HQ text with the send
    /// keyword rule applied.
    static func text(_ send: VoiceSendText, hqTranscript: String?) -> String {
        guard let hqTranscript else {
            return send.liveTranscript
        }
        if send.appendsKeywordTag == false {
            return join(send.priorInput, hqTranscript)
        }
        // The live keyword fired the send: an HQ keyword counts only when it
        // is the same command; otherwise the live tag is appended.
        let detected = SpeechKeywords.detect(hqTranscript)
        let processed = detected.flatMap {
            SpeechKeywords.sameTag($0.action, send.action) ? $0.processedTranscript : nil
        } ?? SpeechKeywords.appendSendKeywordTag(
            to: hqTranscript,
            action: send.action,
            matchedPhrase: send.matchedPhrase
        )
        return join(send.priorInput, processed)
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

/// A quick chat thought's final text and HQ engine
/// (docs/plans/ios-quick-chat-hq.md). Non-blank HQ text from the phone's own
/// pass gives the HQ text and its engine; anything else — the pass skipped,
/// no recording, a blank result — gives the live transcript and no engine.
enum QuickChatVoiceText {
    static func resolve(
        _ send: VoiceSendText,
        hq: (text: String, service: String)?
    ) -> (text: String, hqService: String?) {
        guard let hq, hq.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return (send.liveTranscript, nil)
        }
        return (VoicePreparationResolver.text(send, hqTranscript: hq.text), hq.service)
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
