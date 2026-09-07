import XCTest
import UIKit
@testable import BeeBox

final class SpeechKeywordsTests: XCTestCase {
    func testProgressiveTranscriptReplacesVolatileResults() {
        var transcript = ProgressiveSpeechTranscript()

        transcript.apply(text: "Hello wor", isFinal: false)
        XCTAssertEqual(transcript.text, "Hello wor")

        transcript.apply(text: "Hello world", isFinal: false)
        XCTAssertEqual(transcript.text, "Hello world")

        transcript.apply(text: "Hello world", isFinal: true)
        XCTAssertEqual(transcript.finalizedText, "Hello world")
        XCTAssertEqual(transcript.volatileText, "")
        XCTAssertEqual(transcript.text, "Hello world")

        transcript.apply(text: " again", isFinal: false)
        XCTAssertEqual(transcript.text, "Hello world again")

        transcript.apply(text: " again.", isFinal: true)
        XCTAssertEqual(transcript.text, "Hello world again.")
    }

    func testChatURLUsesNativeComposerAndPreservesSession() {
        let box = PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://beebox.example/box")!,
            sessionID: "abc123",
            authToken: nil,
            requiresDeviceUnlock: false
        )
        let components = URLComponents(url: box.chatURL, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []

        XCTAssertEqual(components?.path, "/box/chat")
        XCTAssertEqual(queryItems.first { $0.name == "nativeComposer" }?.value, "1")
        XCTAssertEqual(queryItems.first { $0.name == "session" }?.value, "abc123")
        XCTAssertNil(queryItems.first { $0.name == "embed" })
    }

    func testDictionaryPayloadAcceptsLegacyObjectAndNeutralStringForms() {
        let legacy = ChatWebView.dictionaryPayload(from: ["disposition": "sent", "emissionId": "abc"])
        XCTAssertEqual(legacy?["disposition"] as? String, "sent")
        XCTAssertEqual(legacy?["emissionId"] as? String, "abc")

        let neutral = ChatWebView.dictionaryPayload(
            from: #"{"disposition":"rejected","emissionId":"abc","reason":"Invalid native message"}"#
        )
        XCTAssertEqual(neutral?["disposition"] as? String, "rejected")
        XCTAssertEqual(neutral?["reason"] as? String, "Invalid native message")

        XCTAssertNil(ChatWebView.dictionaryPayload(from: "not json"))
        XCTAssertNil(ChatWebView.dictionaryPayload(from: #"["array","not","object"]"#))
        XCTAssertNil(ChatWebView.dictionaryPayload(from: 42))
    }

    func testVisibleChatSessionParsing() {
        XCTAssertEqual(
            ChatWebView.visibleSessionID(from: URL(string: "https://beebox.example/box/chat?embed=1&session=abc123")!),
            "abc123"
        )
        XCTAssertEqual(
            ChatWebView.visibleSessionID(from: URL(string: "https://beebox.example/box/chat?session=new&embed=1")!),
            "new"
        )
        XCTAssertNil(ChatWebView.visibleSessionID(from: URL(string: "https://beebox.example/box/chat?embed=1")!))
        XCTAssertNil(ChatWebView.visibleSessionID(from: URL(string: "https://beebox.example/box/chat?embed=1&session=")!))
    }

    /// The keyword vectors are shared golden fixtures under
    /// `beebox/test/mobile-contract/fixtures/speech-keywords/`, consumed
    /// here and by the TS `test/mobile-contract/fixtures.doctest.md`. Editing a
    /// vector once fails both suites until they agree — see
    /// `beebox/docs/implemented-plans/mobile-parity-sync.md`.
    func testSpeechKeywordFixturesMatchSharedVectors() throws {
        let fixtures = try MobileContractFixtures.load("speech-keywords")
        XCTAssertFalse(fixtures.isEmpty, "no speech-keyword fixtures found at \(MobileContractFixtures.root.path)")
        for (name, fixture) in fixtures {
            guard let op = fixture["op"] as? String, let input = fixture["input"] as? [String: Any] else {
                XCTFail("\(name): missing op/input")
                continue
            }
            switch op {
            case "detect":
                try assertDetectFixture(name: name, input: input, expected: fixture["expected"])
            case "append":
                try assertAppendFixture(name: name, input: input, expected: fixture["expected"])
            default:
                XCTFail("\(name): unknown op \(op)")
            }
        }
    }

    func testKeywordTagsAreNotValidKeywordInput() {
        let tagged = "<erase-message phrase=\"Clear message\" />"
        XCTAssertNil(
            SpeechKeywords.detect(tagged),
            "a tag the app wrote must not match as a spoken command"
        )

        // The nesting the field report saw: saying the phrase again re-ran
        // detection over the previous substitution.
        var text = "Clear message"
        for _ in 0..<3 {
            guard let result = SpeechKeywords.detect(text) else {
                break
            }
            text = result.processedTranscript
        }
        XCTAssertEqual(text, tagged)
        XCTAssertEqual(text.components(separatedBy: "<erase-message").count - 1, 1)
    }

    func testKeywordsStillMatchAlongsideAnExistingTag() {
        let seeded = "<mic-off phrase=\"Mic off\" /> buy milk send message"
        let result = SpeechKeywords.detect(seeded)

        XCTAssertEqual(result?.action, .send)
        XCTAssertEqual(result?.matchedPhrase, "send message")
        XCTAssertEqual(
            result?.processedTranscript,
            "<mic-off phrase=\"Mic off\" /> buy milk <send-message phrase=\"send message\" />"
        )
    }

    @MainActor
    func testRefusedKeywordLeavesComposerTextUnchanged() throws {
        let dictation = SpeechDictation()
        dictation.transcript = "Remind me about the dentist"

        dictation.ingestRecognizedSpeechForTesting("Remind me about the dentist clear message")

        let intent = try XCTUnwrap(dictation.keywordIntent)
        XCTAssertEqual(intent.action, .erase)
        // The composer reads `transcript`. Until the command is accepted it must
        // show neither the tag nor the spoken command words.
        XCTAssertEqual(dictation.transcript, "Remind me about the dentist")

        dictation.discardKeywordSubstitution()
        XCTAssertEqual(dictation.transcript, "Remind me about the dentist")
        XCTAssertFalse(dictation.transcript.contains("erase-message"))
    }

    /// Only an action that hands the draft off as a message may leave its
    /// control tag behind: the tag is message content the moment it lands in
    /// the composer.
    func testOnlySendingActionsCommitTheKeywordSubstitution() {
        for action in [SpeechKeywordAction.send, .sendHq, .sendClose] {
            XCTAssertTrue(action.commitsKeywordSubstitution, "\(action) stages the draft as a message")
        }
        for action in [SpeechKeywordAction.cancel, .micOff, .erase] {
            XCTAssertFalse(action.commitsKeywordSubstitution, "\(action) must not leave a tag in the composer")
        }
    }

    /// An accepted mic-off stops dictation and leaves the composer standing, so
    /// a committed `<mic-off …/>` would sit in the draft as text the user can
    /// later send as content. (The composer's own microphone stop is the
    /// `.micOff` branch's voice-turn/earcon work; what is checkable here is
    /// that recognition ended and the draft text never moved.)
    @MainActor
    func testAcceptedMicOffLeavesTheComposerAtThePreKeywordTranscript() throws {
        let dictation = SpeechDictation()
        dictation.transcript = "Remind me about the dentist"

        dictation.ingestRecognizedSpeechForTesting("Remind me about the dentist mic off")

        let intent = try XCTUnwrap(dictation.keywordIntent)
        XCTAssertEqual(intent.action, .micOff)
        XCTAssertFalse(intent.action.commitsKeywordSubstitution)

        // What the composer does for an accepted, non-sending action.
        dictation.discardKeywordSubstitution()

        XCTAssertEqual(dictation.transcript, "Remind me about the dentist")
        XCTAssertFalse(dictation.transcript.contains("<mic-off"))
        XCTAssertTrue(dictation.hasDictatedText)
        XCTAssertFalse(dictation.isRecording)
        XCTAssertEqual(dictation.state, .preparingHQ)
    }

    @MainActor
    func testAcceptedSendCommitsTheTagSubstitution() throws {
        let dictation = SpeechDictation()
        dictation.transcript = "Remind me about the dentist"

        dictation.ingestRecognizedSpeechForTesting("Remind me about the dentist send message")

        let intent = try XCTUnwrap(dictation.keywordIntent)
        XCTAssertEqual(intent.action, .send)
        XCTAssertTrue(intent.action.commitsKeywordSubstitution)

        dictation.commitKeywordSubstitution()
        XCTAssertEqual(dictation.transcript, intent.processedTranscript)
        XCTAssertTrue(dictation.transcript.contains("<send-message phrase="))

        // A second commit is inert: the hold is consumed, not sticky.
        dictation.commitKeywordSubstitution()
        XCTAssertEqual(dictation.transcript, intent.processedTranscript)
    }

    func testSendBlockersNameTheTermAndRefuseHonestly() {
        XCTAssertEqual(
            ComposerSendBlocker.blockers(isPreparingSend: false, isUploadingPhotoBatch: false, isDraftReady: true),
            []
        )
        XCTAssertEqual(
            ComposerSendBlocker.blockers(isPreparingSend: true, isUploadingPhotoBatch: false, isDraftReady: false),
            [.preparingSend, .draftNotReady]
        )
        XCTAssertEqual(
            ComposerSendBlocker.logLabel(for: [.preparingSend, .draftNotReady]),
            "preparingSend,draftNotReady"
        )
        XCTAssertEqual(
            ComposerSendBlocker.voiceRefusalStatus(for: [.photoBatchUploading]),
            "Photos are still uploading — try again when they finish."
        )
        // Only the photo term promises a short wait.
        for blockers in [[ComposerSendBlocker.preparingSend], [.draftNotReady], [.preparingSend, .draftNotReady]] {
            XCTAssertFalse(
                ComposerSendBlocker.voiceRefusalStatus(for: blockers).contains("try again in a moment"),
                "\(blockers) must not promise a transient wait"
            )
        }
        XCTAssertNotEqual(
            ComposerSendBlocker.voiceRefusalStatus(for: [.preparingSend]),
            ComposerSendBlocker.voiceRefusalStatus(for: [.draftNotReady])
        )
    }

    private func assertDetectFixture(name: String, input: [String: Any], expected: Any?) throws {
        let transcript = try XCTUnwrap(input["transcript"] as? String, "\(name): missing transcript")
        let atStart = (input["atStart"] as? Bool) ?? false
        let result = SpeechKeywords.detect(transcript, atStart: atStart)
        if expected is NSNull {
            XCTAssertNil(result, "\(name): expected no match")
            return
        }
        let expectedFields = try XCTUnwrap(expected as? [String: Any], "\(name): unrecognized expected")
        let match = try XCTUnwrap(result, "\(name): expected a match")
        if let action = expectedFields["action"] as? String {
            XCTAssertEqual(match.action.rawValue, action, "\(name): action")
        }
        if let processed = expectedFields["processedTranscript"] as? String {
            XCTAssertEqual(match.processedTranscript, processed, "\(name): processedTranscript")
        }
        if let phrase = expectedFields["matchedPhrase"] as? String {
            XCTAssertEqual(match.matchedPhrase, phrase, "\(name): matchedPhrase")
        }
    }

    private func assertAppendFixture(name: String, input: [String: Any], expected: Any?) throws {
        let transcript = try XCTUnwrap(input["transcript"] as? String, "\(name): missing transcript")
        let actionRaw = try XCTUnwrap(input["action"] as? String, "\(name): missing action")
        let action = try XCTUnwrap(SpeechKeywordAction(rawValue: actionRaw), "\(name): bad action \(actionRaw)")
        let matchedPhrase = try XCTUnwrap(input["matchedPhrase"] as? String, "\(name): missing matchedPhrase")
        let expectedText = try XCTUnwrap(expected as? String, "\(name): expected must be a string")
        let got = SpeechKeywords.appendSendKeywordTag(to: transcript, action: action, matchedPhrase: matchedPhrase)
        XCTAssertEqual(got, expectedText, "\(name)")
    }
}

/// Decodes the web→native golden fixtures (receipt, location result) through the
/// real `ChatWebView.dictionaryPayload(from:)` seam — crossing the JSON-string
/// neutral transport exactly as the web layer posts them. Shares the fixtures
/// under `beebox/test/mobile-contract/fixtures/` with the TS doctest.
final class MobileContractFixtureDecodeTests: XCTestCase {
    func testConversationBindingFixtures() throws {
        for (name, fixture) in try MobileContractFixtures.load("composer-binding") {
            let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(fixture["input"]))
            let binding = try? JSONDecoder().decode(NativeComposerBinding.self, from: data)
            XCTAssertEqual(binding?.isValid == true, fixture["expectedValid"] as? Bool, name)
        }
    }

    func testV3SharedFixtures() throws {
        for (name, fixture) in try MobileContractFixtures.load("native-emission-v3") {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any])
            let revision = input["bindingRevision"] as? Int
            let bindingData = (input["binding"] as? [String: Any]).flatMap {
                try? JSONSerialization.data(withJSONObject: $0)
            }
            let binding = bindingData.flatMap { try? JSONDecoder().decode(NativeSendBinding.self, from: $0) }
            let valid = binding?.target.isValid == true && (revision ?? -1) >= 0
            XCTAssertEqual(valid, fixture["expectedValid"] as? Bool, name)
        }
    }

    func testV3EmissionCarriesImmutableBinding() throws {
        let target = NativeConversationTarget(kind: .session, sessionId: "first", contextDir: "kitchen")
        let binding = NativeSendBinding(boxSlug: "test1", target: target,
            attention: NativeAttentionSnapshot(surface: .card, focusedRef: "/report.md", transcript: .hidden))
        let emission = NativeChatEmission(binding: binding, bindingRevision: 7,
            text: "Review this", origin: .typed, diarized: false, images: [])
        let data = try JSONEncoder().encode(NativeEmissionV3(emission: emission))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["version"] as? Int, 3)
        XCTAssertEqual(object["bindingRevision"] as? Int, 7)
        let targetObject = (object["binding"] as? [String: Any])?["target"] as? [String: Any]
        XCTAssertEqual(targetObject?["sessionId"] as? String, "first")
    }

    func testReceiptFixturesDecodeThroughDictionaryPayload() throws {
        let fixtures = try MobileContractFixtures.load("receipt")
        XCTAssertFalse(fixtures.isEmpty, "no receipt fixtures found")
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            let payload = try XCTUnwrap(
                ChatWebView.dictionaryPayload(from: try MobileContractFixtures.jsonString(from: input)),
                "\(name): dictionaryPayload returned nil"
            )
            let dispositionString = try XCTUnwrap(payload["disposition"] as? String, "\(name): disposition")
            XCTAssertNotNil(
                NativeEmissionReceipt.Disposition(rawValue: dispositionString),
                "\(name): disposition \(dispositionString) is not a known native case"
            )
            XCTAssertEqual(dispositionString, expected["disposition"] as? String, "\(name): disposition")
            XCTAssertEqual(payload["emissionId"] as? String, expected["emissionId"] as? String, "\(name): emissionId")
            XCTAssertEqual(payload["reason"] as? String, expected["reason"] as? String, "\(name): reason")
            XCTAssertEqual(payload["definitive"] as? Bool, expected["definitive"] as? Bool, "\(name): definitive")
        }
    }

    func testLocationResultFixturesDecodeThroughDictionaryPayload() throws {
        let fixtures = try MobileContractFixtures.load("location")
        var decoded = 0
        for (name, fixture) in fixtures where (fixture["variant"] as? String) == "result" {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            let payload = try XCTUnwrap(
                ChatWebView.dictionaryPayload(from: try MobileContractFixtures.jsonString(from: input)),
                "\(name): dictionaryPayload returned nil"
            )
            XCTAssertEqual(payload["id"] as? String, expected["id"] as? String, "\(name): id")
            XCTAssertEqual(payload["success"] as? Bool, expected["success"] as? Bool, "\(name): success")
            XCTAssertEqual(payload["enabled"] as? Bool, expected["enabled"] as? Bool, "\(name): enabled")
            XCTAssertEqual(payload["message"] as? String, expected["message"] as? String, "\(name): message")
            decoded += 1
        }
        XCTAssertGreaterThan(decoded, 0, "no location result fixtures decoded")
    }

    func testNarrationStateFixturesDecodeThroughNativeSeam() throws {
        let fixtures = try MobileContractFixtures.load("narration-state")
        XCTAssertFalse(fixtures.isEmpty, "no narration state fixtures found")
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            let enabled = ChatWebView.narrationEnabled(
                from: try MobileContractFixtures.jsonString(from: input)
            )
            XCTAssertEqual(enabled, expected["enabled"] as? Bool, "\(name): enabled")
        }
    }

    func testSpeechPlaybackStateFixturesDecodeThroughNativeSeam() throws {
        let fixtures = try MobileContractFixtures.load("speech-playback-state")
        XCTAssertFalse(fixtures.isEmpty, "no speech playback state fixtures found")
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            let playing = ChatWebView.speechPlaybackActive(
                from: try MobileContractFixtures.jsonString(from: input)
            )
            XCTAssertEqual(playing, expected["playing"] as? Bool, "\(name): playing")
        }
    }

    func testResponseStateFixturesDecodeThroughNativeSeam() throws {
        let fixtures = try MobileContractFixtures.load("response-state")
        XCTAssertFalse(fixtures.isEmpty, "no response state fixtures found")
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            let active = ChatWebView.responseActive(
                from: try MobileContractFixtures.jsonString(from: input)
            )
            XCTAssertEqual(active, expected["active"] as? Bool, "\(name): active")
        }
    }

    /// Native is the *encoder* for the barge-in command (contract §4.9), so the
    /// fixture pins what this app puts on the wire; the web doctest checks its
    /// decoder against the same file. The rejected fixtures exist for the web
    /// side — native has no way to emit them — so they are only asserted to be
    /// unlike what we send.
    func testSpeechCommandEncodesTheValidFixtureAndNothingElse() throws {
        let fixtures = try MobileContractFixtures.load("speech-command")
        XCTAssertFalse(fixtures.isEmpty, "no speech-command fixtures found")
        let encoded = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: try JSONEncoder().encode(NativeSpeechCommand.stop)
            ) as? [String: Any],
            "NativeSpeechCommand.stop did not encode to an object"
        )
        var matched = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let sameShape = (input["version"] as? Int) == (encoded["version"] as? Int)
                && (input["action"] as? String) == (encoded["action"] as? String)
            if fixture["expected"] is [String: Any] {
                XCTAssertTrue(sameShape, "\(name): native encodes \(encoded), fixture says \(input)")
                matched += 1
            } else {
                XCTAssertFalse(sameShape, "\(name): a rejected fixture matches what native sends")
            }
        }
        XCTAssertEqual(matched, 1, "exactly one speech-command fixture is the shape native sends")
    }

    func testV2EmissionFixturesDecodeStrictly() throws {
        let fixtures = try MobileContractFixtures.load("emission")
        var decodedV2 = 0
        var rejectedV2 = 0
        var rejectedLegacy = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try MobileContractFixtures.jsonData(from: input)
            if (input["version"] as? Int) == 2, fixture["expected"] is [String: Any] {
                let emission = try JSONDecoder().decode(NativeEmissionV2.self, from: data)
                XCTAssertEqual(emission.version, 2, "\(name): version")
                XCTAssertEqual(emission.id, input["id"] as? String, "\(name): id")
                XCTAssertEqual(emission.files.count, (input["files"] as? [Any])?.count, "\(name): files")
                XCTAssertEqual(emission.selections.count, (input["selections"] as? [Any])?.count, "\(name): selections")
                decodedV2 += 1
                continue
            }
            XCTAssertThrowsError(try JSONDecoder().decode(NativeEmissionV2.self, from: data), "\(name): must not decode as V2")
            if input["version"] == nil {
                rejectedLegacy += 1
            } else {
                rejectedV2 += 1
            }
        }
        XCTAssertGreaterThan(decodedV2, 0, "no complete V2 fixture decoded")
        XCTAssertGreaterThan(rejectedV2, 0, "no malformed or unknown V2 fixture rejected")
        XCTAssertGreaterThan(rejectedLegacy, 0, "no legacy fixture kept outside the V2 decoder")
    }

    func testComposerCommandFixturesDecodeStrictly() throws {
        let fixtures = try MobileContractFixtures.load("composer-command")
        var decoded = 0
        var rejected = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try MobileContractFixtures.jsonData(from: input)
            if let expected = fixture["expected"] as? [String: Any] {
                // Both envelope versions live in this family: V1 with a top-level
                // `selection`, V2 with a kind-discriminated payload. The fixture
                // says which, so this asserts what it says rather than pinning V1.
                let command = try JSONDecoder().decode(NativeComposerCommand.self, from: data)
                XCTAssertEqual(command.version, expected["version"] as? Int, "\(name): version")
                XCTAssertEqual(command.kind.rawValue, expected["kind"] as? String, "\(name): kind")
                XCTAssertEqual(command.id, input["id"] as? String, "\(name): id")
                decoded += 1
            } else {
                XCTAssertThrowsError(try JSONDecoder().decode(NativeComposerCommand.self, from: data), "\(name): malformed command decoded")
                rejected += 1
            }
        }
        XCTAssertGreaterThan(decoded, 0, "no command fixture decoded")
        XCTAssertGreaterThan(rejected, 0, "no malformed command fixture rejected")
    }

    func testComposerCommandAcknowledgementFixturesDecodeStrictly() throws {
        let fixtures = try MobileContractFixtures.load("composer-command-ack")
        var decoded = 0
        var rejected = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try MobileContractFixtures.jsonData(from: input)
            if fixture["expected"] is NSNull {
                XCTAssertThrowsError(
                    try JSONDecoder().decode(NativeComposerCommandAcknowledgement.self, from: data),
                    "\(name): malformed acknowledgement decoded"
                )
                rejected += 1
            } else {
                let acknowledgement = try JSONDecoder().decode(
                    NativeComposerCommandAcknowledgement.self,
                    from: data
                )
                XCTAssertEqual(acknowledgement.version, 1, "\(name): version")
                XCTAssertEqual(acknowledgement.id, input["id"] as? String, "\(name): id")
                XCTAssertEqual(acknowledgement.accepted, input["accepted"] as? Bool, "\(name): accepted")
                XCTAssertEqual(acknowledgement.reason, input["reason"] as? String, "\(name): reason")
                decoded += 1
            }
        }
        XCTAssertGreaterThan(decoded, 0, "no composer-command acknowledgement fixture decoded")
        XCTAssertGreaterThan(rejected, 0, "no malformed composer-command acknowledgement fixture rejected")
    }
}

/// Loads the shared cross-platform golden fixtures from the monorepo working
/// tree. Located via `#filePath` (this test file's compiled-in source path),
/// walking up to the repo root — acceptable for a monorepo-local test, and
/// avoids bundling the fixtures into the test target.
enum MobileContractFixtures {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // BeeBoxTests/
        .deletingLastPathComponent() // ios-app/
        .deletingLastPathComponent() // repo root
        .appendingPathComponent("beebox/test/mobile-contract/fixtures")

    struct FixtureError: Error { var message: String }

    static func load(_ family: String) throws -> [(name: String, fixture: [String: Any])] {
        let dir = root.appendingPathComponent(family)
        let files = try FileManager.default
            .contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        return try files.map { url in
            let data = try Data(contentsOf: url)
            guard let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw FixtureError(message: "\(url.lastPathComponent) is not a JSON object")
            }
            return (url.deletingPathExtension().lastPathComponent, dict)
        }
    }

    static func jsonString(from object: [String: Any]) throws -> String {
        let data = try jsonData(from: object)
        guard let string = String(data: data, encoding: .utf8) else {
            throw FixtureError(message: "could not encode fixture JSON as UTF-8")
        }
        return string
    }

    static func jsonData(from object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object)
    }

    /// Key-sorted JSON text, so two structurally equal payloads compare equal
    /// however their dictionaries happened to be ordered.
    static func canonicalJSON(_ object: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard let string = String(data: data, encoding: .utf8) else {
            throw FixtureError(message: "could not encode fixture JSON as UTF-8")
        }
        return string
    }
}

final class CameraImageEncoderTests: XCTestCase {
    func testJPEGDataFlattensImageOrientation() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let source = UIGraphicsImageRenderer(size: CGSize(width: 12, height: 20), format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 12, height: 20))
        }
        let cgImage = try XCTUnwrap(source.cgImage)
        let rotated = UIImage(cgImage: cgImage, scale: 1, orientation: .right)

        let encoded = try XCTUnwrap(CameraImageEncoder.jpegData(from: rotated))
        let decoded = try XCTUnwrap(UIImage(data: encoded))

        XCTAssertEqual(decoded.imageOrientation, .up)
        XCTAssertEqual(decoded.size, rotated.size)
    }

    func testComposerImagesDownscaleAndPreservePNGEncoding() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let source = UIGraphicsImageRenderer(size: CGSize(width: 2_000, height: 1_000), format: format).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_000, height: 1_000))
        }

        let encoded = try XCTUnwrap(ComposerImageEncoder.encode(image: source, sourceMimeType: "image/png"))
        let decoded = try XCTUnwrap(UIImage(data: encoded.data))

        XCTAssertEqual(encoded.mimeType, "image/png")
        XCTAssertEqual(encoded.fileExtension, "png")
        XCTAssertEqual(decoded.size, CGSize(width: 1_920, height: 960))
    }
}
