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

    func testSendCommandsMatchTypeScriptDoctestCases() {
        XCTAssertEqual(SpeechKeywords.detect("send message")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("sent message")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("said message")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("same message")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("deliver the message")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("message finished")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("send now")?.action, .send)
        XCTAssertEqual(SpeechKeywords.detect("it's a message")?.action, .send)

        XCTAssertNil(SpeechKeywords.detect("finished"))
        XCTAssertNil(SpeechKeywords.detect("I'm finished"))
        XCTAssertEqual(
            SpeechKeywords.detect("OK send message")?.processedTranscript,
            #"OK <send-message phrase="send message" />"#
        )
    }

    func testSendAndCloseCommandsMatchTypeScriptDoctestCases() {
        XCTAssertEqual(SpeechKeywords.detect("send and close")?.action, .sendClose)
        XCTAssertEqual(SpeechKeywords.detect("send and stop")?.action, .sendClose)
        XCTAssertEqual(SpeechKeywords.detect("send and close the mic")?.action, .sendClose)
        XCTAssertEqual(SpeechKeywords.detect("set a closed message")?.action, .sendClose)
        XCTAssertEqual(SpeechKeywords.detect("over and out")?.action, .sendClose)
        XCTAssertEqual(
            SpeechKeywords.detect("OK send and close")?.processedTranscript,
            #"OK <send-close-message phrase="send and close" />"#
        )

        XCTAssertEqual(SpeechKeywords.detect("send and finish the message")?.action, .sendClose)
        XCTAssertEqual(SpeechKeywords.detect("send and stop the mic")?.action, .sendClose)
    }

    func testControlCommandsMatchTypeScriptDoctestCases() {
        XCTAssertEqual(SpeechKeywords.detect("cancel message")?.action, .cancel)
        XCTAssertEqual(SpeechKeywords.detect("abort the message")?.action, .cancel)
        XCTAssertNil(SpeechKeywords.detect("nevermind"))
        XCTAssertEqual(SpeechKeywords.detect("nevermind the message")?.action, .cancel)

        XCTAssertEqual(SpeechKeywords.detect("microphone off")?.action, .micOff)
        XCTAssertEqual(SpeechKeywords.detect("turn off the mic")?.action, .micOff)
        XCTAssertEqual(SpeechKeywords.detect("stop listening")?.action, .micOff)

        XCTAssertEqual(SpeechKeywords.detect("erase the message")?.action, .erase)
        XCTAssertEqual(SpeechKeywords.detect("clear my message")?.action, .erase)
        XCTAssertEqual(SpeechKeywords.detect("start over")?.action, .erase)
    }

    func testNoMatchCasesMatchTypeScriptDoctestCases() {
        XCTAssertNil(SpeechKeywords.detect("hello world"))
        XCTAssertNil(SpeechKeywords.detect("the weather is nice"))
    }

    func testAppendSendKeywordTagMatchesTypeScriptDoctestCases() {
        XCTAssertNil(SpeechKeywords.detect("Buy milk tomorrow."))
        XCTAssertEqual(
            SpeechKeywords.appendSendKeywordTag(
                to: "Buy milk tomorrow.",
                action: .send,
                matchedPhrase: "send message"
            ),
            #"Buy milk tomorrow. <send-message phrase="send message" />"#
        )
        XCTAssertEqual(
            SpeechKeywords.appendSendKeywordTag(
                to: "Buy milk tomorrow.",
                action: .sendClose,
                matchedPhrase: "send and close"
            ),
            #"Buy milk tomorrow. <send-close-message phrase="send and close" />"#
        )
        XCTAssertEqual(
            SpeechKeywords.appendSendKeywordTag(
                to: "Ping R&D.",
                action: .send,
                matchedPhrase: #"send "the" message"#
            ),
            #"Ping R&D. <send-message phrase="send &quot;the&quot; message" />"#
        )
    }

    func testAtStartPreventsMidUtteranceMatches() {
        XCTAssertNil(SpeechKeywords.detect("please send message", atStart: true))
        XCTAssertEqual(SpeechKeywords.detect("send message please", atStart: true)?.action, .send)
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
