import XCTest
import UIKit
@testable import CallbackBox

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
            baseURL: URL(string: "https://cb.example/box")!,
            sessionID: "abc123",
            authToken: nil
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
            ChatWebView.visibleSessionID(from: URL(string: "https://cb.example/box/chat?embed=1&session=abc123")!),
            "abc123"
        )
        XCTAssertEqual(
            ChatWebView.visibleSessionID(from: URL(string: "https://cb.example/box/chat?session=new&embed=1")!),
            "new"
        )
        XCTAssertNil(ChatWebView.visibleSessionID(from: URL(string: "https://cb.example/box/chat?embed=1")!))
        XCTAssertNil(ChatWebView.visibleSessionID(from: URL(string: "https://cb.example/box/chat?embed=1&session=")!))
    }

    /// The keyword vectors are shared golden fixtures under
    /// `callback-box/test/mobile-contract/fixtures/speech-keywords/`, consumed
    /// here and by the TS `test/mobile-contract/fixtures.doctest.md`. Editing a
    /// vector once fails both suites until they agree — see
    /// `callback-box/docs/implemented-plans/mobile-parity-sync.md`.
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
/// under `callback-box/test/mobile-contract/fixtures/` with the TS doctest.
final class MobileContractFixtureDecodeTests: XCTestCase {
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
            XCTAssertEqual(payload["message"] as? String, expected["message"] as? String, "\(name): message")
            decoded += 1
        }
        XCTAssertGreaterThan(decoded, 0, "no location result fixtures decoded")
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
            if fixture["expected"] is [String: Any] {
                let command = try JSONDecoder().decode(NativeComposerCommand.self, from: data)
                XCTAssertEqual(command.version, 1, "\(name): version")
                XCTAssertEqual(command.kind, .addSelection, "\(name): kind")
                XCTAssertEqual(command.id, input["id"] as? String, "\(name): id")
                decoded += 1
            } else {
                XCTAssertThrowsError(try JSONDecoder().decode(NativeComposerCommand.self, from: data), "\(name): malformed command decoded")
                rejected += 1
            }
        }
        XCTAssertGreaterThan(decoded, 0, "no add-selection command fixture decoded")
        XCTAssertGreaterThan(rejected, 0, "no malformed command fixture rejected")
    }
}

/// Loads the shared cross-platform golden fixtures from the monorepo working
/// tree. Located via `#filePath` (this test file's compiled-in source path),
/// walking up to the repo root — acceptable for a monorepo-local test, and
/// avoids bundling the fixtures into the test target.
enum MobileContractFixtures {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // CallbackBoxTests/
        .deletingLastPathComponent() // ios-app/
        .deletingLastPathComponent() // repo root
        .appendingPathComponent("callback-box/test/mobile-contract/fixtures")

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
}
