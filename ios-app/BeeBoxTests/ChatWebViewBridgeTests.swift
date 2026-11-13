import XCTest
import WebKit
@testable import BeeBox

/// Only the box's own main frame may drive native. Each channel is tested through
/// `receiveBridgeMessage`, and the last tests post from real frames, because the
/// guard is only as good as what WebKit reports about the sender.
@MainActor
final class ChatWebViewBridgeTests: XCTestCase {
    private static let boxOrigin = "https://box.example.com"

    /// Every coordinator callback a channel can reach, as one flat log.
    private final class Recorder {
        var calls: [String] = []
    }

    private func makeCoordinator(
        _ recorder: Recorder,
        allowedOrigin: String? = ChatWebViewBridgeTests.boxOrigin
    ) -> ChatWebView.Coordinator {
        ChatWebView.Coordinator(
            boxID: UUID(),
            allowedOrigin: allowedOrigin,
            onComposerBinding: { _ in recorder.calls.append("beeboxComposerBinding") },
            onSessionChange: { _ in recorder.calls.append("beeboxSession") },
            onEmissionDeliveryAttempt: { _ in },
            onEmissionReceipt: { _ in recorder.calls.append("beeboxEmissionReceipt") },
            onLocationShareResult: { _ in recorder.calls.append("beeboxLocationResult") },
            onLocationSharingStateChange: { _ in recorder.calls.append("beeboxLocationState") },
            onNarrationStateChange: { _ in recorder.calls.append("beeboxNarrationState") },
            onHqDictationStateChange: { _ in recorder.calls.append("beeboxHqDictationState") },
            onSpeechPlaybackStateChange: { _ in recorder.calls.append("beeboxSpeechPlaybackState") },
            onResponseStateChange: { _ in recorder.calls.append("beeboxResponseState") },
            onCallStateChange: { _ in recorder.calls.append("beeboxCallState") },
            setCallAudio: { _ in },
            onScreenshotResult: { _ in },
            onComposerCommand: { _ in recorder.calls.append("beeboxComposerCommand") },
            onComposerCommandAcknowledgementDelivered: { _ in },
            onLastAudioRequest: { _ in recorder.calls.append("beeboxLastAudioRequest") },
            pageLoaded: true,
            evaluateEmission: { _, _ in }
        )
    }

    /// A body each channel accepts. Receipts and location results also need the
    /// request they answer to be in flight, which `arm` sets up.
    private func validBody(for channel: NativeBridgeChannel, emissionID: UUID, locationID: UUID) -> Any {
        switch channel {
        case .composerBinding:
            return #"{"version":1,"kind":"assigned","boxSlug":"test1","clientConversationId":"c1","sessionId":"s1","contextDir":""}"#
        case .session:
            return "\(Self.boxOrigin)/test1/chat?session=abc"
        case .emissionReceipt:
            return ["emissionId": emissionID.uuidString, "disposition": "sent"]
        case .locationResult:
            return ["id": locationID.uuidString, "success": true, "enabled": true, "message": "ok"]
        case .locationState, .narrationState:
            return ["enabled": true]
        case .hqDictationState:
            return ["enabled": true, "diarized": true]
        case .speechPlaybackState:
            return ["playing": true]
        case .responseState:
            return ["active": true]
        case .composerCommand:
            return #"{"version":2,"id":"c1","kind":"scan-controls"}"#
        case .lastAudioRequest:
            return #"{"version":1,"requestId":"r1","messageId":"m1"}"#
        case .callState:
            return ["active": true]
        }
    }

    /// Put an emission and a location request in flight so their answers count.
    private func arm(_ coordinator: ChatWebView.Coordinator) -> (emissionID: UUID, locationID: UUID) {
        let webView = WKWebView()
        let emission = NativeChatEmission(text: "hi", origin: .typed, diarized: false, images: [])
        coordinator.deliver([emission], to: webView)
        let location = NativeLocationShareRequest()
        coordinator.locationShareRequest = location
        coordinator.deliverLocationRequest(to: webView)
        return (emission.id, location.id)
    }

    func testEveryChannelRoutesFromTheBoxMainFrameAndIsRefusedFromAnythingElse() {
        for channel in NativeBridgeChannel.allCases {
            let recorder = Recorder()
            let coordinator = makeCoordinator(recorder)
            let (emissionID, locationID) = arm(coordinator)
            let body = validBody(for: channel, emissionID: emissionID, locationID: locationID)

            // Refused first, so a refusal that consumed the in-flight request
            // would also fail the accepted delivery below.
            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: false, frameOrigin: Self.boxOrigin, body: body, webView: nil)
            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: false, frameOrigin: "https://evil.example", body: body, webView: nil)
            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: true, frameOrigin: "https://evil.example", body: body, webView: nil)
            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: true, frameOrigin: nil, body: body, webView: nil)
            XCTAssertEqual(recorder.calls, [], "\(channel.rawValue) acted on a refused frame")

            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: true, frameOrigin: Self.boxOrigin, body: body, webView: nil)
            XCTAssertEqual(recorder.calls, [channel.rawValue], "\(channel.rawValue) routed wrongly")
        }
    }

    func testMalformedBodyDoesNotReachACallback() {
        for channel in NativeBridgeChannel.allCases {
            let recorder = Recorder()
            let coordinator = makeCoordinator(recorder)
            _ = arm(coordinator)
            coordinator.receiveBridgeMessage(name: channel.rawValue, isMainFrame: true, frameOrigin: Self.boxOrigin, body: 42, webView: nil)
            XCTAssertEqual(recorder.calls, [], channel.rawValue)
        }
    }

    func testUnknownChannelAndUnknownBoxOriginAreRefused() {
        let recorder = Recorder()
        makeCoordinator(recorder).receiveBridgeMessage(name: "beeboxOther", isMainFrame: true, frameOrigin: Self.boxOrigin, body: ["enabled": true], webView: nil)
        // No allowed origin means nothing is trusted, even a frame with none.
        makeCoordinator(recorder, allowedOrigin: nil).receiveBridgeMessage(name: "beeboxNarrationState", isMainFrame: true, frameOrigin: nil, body: ["enabled": true], webView: nil)
        XCTAssertEqual(recorder.calls, [])
    }

    func testSessionStillChecksTheOriginOfTheURLItReports() {
        let recorder = Recorder()
        makeCoordinator(recorder).receiveBridgeMessage(name: "beeboxSession", isMainFrame: true, frameOrigin: Self.boxOrigin, body: "https://evil.example/chat?session=abc", webView: nil)
        XCTAssertEqual(recorder.calls, [])
    }

    func testOriginIsCanonical() {
        XCTAssertEqual(ChatWebView.origin(from: URL(string: "HTTPS://Box.Example.com:443/test1")!), "https://box.example.com")
        XCTAssertEqual(ChatWebView.origin(from: URL(string: "http://box.example.com:80")!), "http://box.example.com")
        XCTAssertEqual(ChatWebView.origin(from: URL(string: "http://127.0.0.1:3210/main/test1")!), "http://127.0.0.1:3210")
        XCTAssertEqual(ChatWebView.origin(from: URL(string: "https://box.example.com:8443")!), "https://box.example.com:8443")
    }

    // MARK: Real frames

    /// Serves fixed pages over custom schemes, so a test has real cross-origin
    /// frames and response headers with no network.
    private final class PageServer: NSObject, WKURLSchemeHandler {
        var pages: [String: (html: String, headers: [String: String])] = [:]

        func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
            let url = urlSchemeTask.request.url!
            let page = pages[url.absoluteString] ?? (html: "", headers: [:])
            var headers = page.headers
            headers["Content-Type"] = "text/html"
            urlSchemeTask.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
            urlSchemeTask.didReceive(Data(page.html.utf8))
            urlSchemeTask.didFinish()
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}
    }

    /// A channel outside the guard. A frame posts here after its bridge message,
    /// and messages arrive in order, so the guard has already decided by then.
    private final class Probe: NSObject, WKScriptMessageHandler {
        var labels: [String] = []
        var onLabel: (() -> Void)?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            labels.append(message.body as? String ?? "")
            onLabel?()
        }
    }

    /// Load `url` and wait for `expected` frames to report on the probe channel.
    /// Returns what the narration channel delivered and what the probe heard.
    private func run(
        pages: [String: (html: String, headers: [String: String])],
        url: String,
        allowedOrigin: String,
        expected: [String],
        documentStartScript: String? = nil,
        htmlBaseURL: URL? = nil
    ) -> (narration: [Bool], probed: [String]) {
        let server = PageServer()
        server.pages = pages
        let probe = Probe()
        var narration: [Bool] = []
        let coordinator = ChatWebView.Coordinator(
            boxID: UUID(),
            allowedOrigin: allowedOrigin,
            onSessionChange: { _ in },
            onEmissionDeliveryAttempt: { _ in },
            onEmissionReceipt: { _ in },
            onLocationShareResult: { _ in },
            onLocationSharingStateChange: { _ in },
            onNarrationStateChange: { narration.append($0) },
            onSpeechPlaybackStateChange: { _ in },
            onResponseStateChange: { _ in },
            onScreenshotResult: { _ in },
            onComposerCommand: { _ in },
            onComposerCommandAcknowledgementDelivered: { _ in }
        )
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(server, forURLScheme: "bbxbox")
        configuration.setURLSchemeHandler(server, forURLScheme: "bbxother")
        configuration.userContentController.add(coordinator, name: NativeBridgeChannel.narrationState.rawValue)
        configuration.userContentController.add(probe, name: "testProbe")
        if let documentStartScript {
            configuration.userContentController.addUserScript(
                WKUserScript(source: documentStartScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        let webView = WKWebView(frame: .zero, configuration: configuration)

        let done = expectation(description: "frames reported")
        probe.onLabel = {
            if Set(probe.labels).isSuperset(of: expected) { done.fulfill(); probe.onLabel = nil }
        }
        if let htmlBaseURL {
            webView.loadHTMLString(pages[url]?.html ?? "", baseURL: htmlBaseURL)
        } else {
            webView.load(URLRequest(url: URL(string: url)!))
        }
        wait(for: [done], timeout: 20)
        return (narration, probe.labels)
    }

    private func script(_ enabled: Bool, label: String) -> String {
        """
        <script>
        webkit.messageHandlers.beeboxNarrationState.postMessage({enabled:\(enabled)});
        webkit.messageHandlers.testProbe.postMessage("\(label)");
        </script>
        """
    }

    func testRealSubframesPostButOnlyTheMainFrameIsHeard() {
        let result = run(
            pages: [
                "bbxbox://box.test/chat": (
                    script(true, label: "main")
                        + #"<iframe src="bbxother://other.test/frame"></iframe><iframe src="bbxbox://box.test/inner"></iframe>"#,
                    [:]
                ),
                "bbxother://other.test/frame": (script(false, label: "cross-origin"), [:]),
                "bbxbox://box.test/inner": (script(false, label: "same-origin"), [:]),
            ],
            url: "bbxbox://box.test/chat",
            allowedOrigin: "bbxbox://box.test",
            expected: ["main", "cross-origin", "same-origin"]
        )
        XCTAssertEqual(result.narration, [true])
    }

    func testRealMainFrameUnderCSPSandboxIsRefusedThoughItsURLIsOnTheBox() {
        let result = run(
            pages: [
                "bbxbox://box.test/frozen": (
                    script(true, label: "sandboxed"),
                    ["Content-Security-Policy": "sandbox allow-scripts"]
                ),
            ],
            url: "bbxbox://box.test/frozen",
            allowedOrigin: "bbxbox://box.test",
            expected: ["sandboxed"]
        )
        XCTAssertEqual(result.narration, [])
    }

    /// WebKit reports a default port as none and lowercases the host. If a paired
    /// URL and WebKit disagreed on an origin, every channel would go silent. The
    /// startup script posts at document start, so that moment is covered too.
    func testRealBoxOriginsMatchHowAPairedURLIsSpelledFromDocumentStart() {
        for (paired, base) in [
            ("http://127.0.0.1:3210/main/test1", "http://127.0.0.1:3210/main/test1/chat"),
            ("https://box.example.com/test1", "https://box.example.com/test1/chat"),
            ("HTTPS://Box.Example.com:443/test1", "https://box.example.com/test1/chat"),
            ("https://box.example.com:8443/test1", "https://box.example.com:8443/test1/chat"),
        ] {
            let result = run(
                pages: ["page": (script(true, label: "body"), [:])],
                url: "page",
                allowedOrigin: ChatWebView.origin(from: URL(string: paired)!)!,
                expected: ["body"],
                documentStartScript: "webkit.messageHandlers.beeboxNarrationState.postMessage({enabled:false});",
                htmlBaseURL: URL(string: base)!
            )
            XCTAssertEqual(result.narration, [false, true], paired)
        }
    }

    func testRealMainFrameOnAnotherOriginIsRefused() {
        let result = run(
            pages: ["bbxother://other.test/page": (script(true, label: "foreign"), [:])],
            url: "bbxother://other.test/page",
            allowedOrigin: "bbxbox://box.test",
            expected: ["foreign"]
        )
        XCTAssertEqual(result.narration, [])
    }
}
