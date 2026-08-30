import XCTest
import WebKit
@testable import BeeBox

/// The chat navigation must authenticate by header, never by URL.
///
/// A device token has no expiry, so a copy in an access log, a `Referer`, or
/// WebKit history stays replayable until someone manually revokes the device.
/// These tests are the regression guard against `?mobileToken=` coming back.
final class ChatWebViewRequestTests: XCTestCase {
    private func makeBox(authToken: String?) -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test box",
            baseURL: URL(string: "https://box.example.com/test1")!,
            sessionID: nil,
            authToken: authToken,
            requiresDeviceUnlock: false
        )
    }

    func testRequestCarriesTokenAsAuthorizationHeader() {
        let request = ChatWebView.authenticatedRequest(for: makeBox(authToken: "secret-device-token"))

        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret-device-token")
    }

    func testRequestURLCarriesNoCredential() {
        let box = makeBox(authToken: "secret-device-token")
        let request = ChatWebView.authenticatedRequest(for: box)

        let url = try! XCTUnwrap(request.url)
        let components = try! XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let names = (components.queryItems ?? []).map(\.name)

        XCTAssertFalse(names.contains("mobileToken"))
        XCTAssertFalse(url.absoluteString.contains("secret-device-token"))
        XCTAssertEqual(url, box.chatURL)
    }

    /// A surrounding-whitespace token is trimmed rather than sent as-is —
    /// the server compares the token exactly, so an untrimmed one fails closed
    /// in a way that looks like a revoked device.
    func testWhitespaceOnlyTokenSendsNoHeader() {
        let request = ChatWebView.authenticatedRequest(for: makeBox(authToken: "   "))

        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }

    func testPaddedTokenIsTrimmed() {
        let request = ChatWebView.authenticatedRequest(for: makeBox(authToken: "  padded-token\n"))

        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer padded-token")
    }

    /// An unpaired box still loads the page; the box answers 401 and the web
    /// layer surfaces it, rather than the app sending a bogus credential.
    func testMissingTokenSendsNoHeader() {
        let box = makeBox(authToken: nil)
        let request = ChatWebView.authenticatedRequest(for: box)

        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(request.url, box.chatURL)
    }

    func testConfigurationAllowsAutomaticSpeechPlayback() {
        let configuration = ChatWebView.makeConfiguration()

        XCTAssertTrue(configuration.allowsInlineMediaPlayback)
        XCTAssertEqual(configuration.mediaTypesRequiringUserActionForPlayback, [])
    }

    @MainActor
    func testSameOriginNewWindowLoadsInCurrentContext() {
        let url = URL(string: "https://box.example.com/test1/browse/card")!
        var loadedURL: URL?
        var externalURL: URL?
        let coordinator = makeCoordinator(
            evaluate: { _, completion in completion(nil) },
            openExternalURL: { externalURL = $0 },
            loadInCurrentContext: { _, request in loadedURL = request.url }
        )
        coordinator.handleNewWindowRequest(URLRequest(url: url), url: url, in: WKWebView())

        XCTAssertEqual(loadedURL, url)
        XCTAssertNil(externalURL)
    }

    @MainActor
    func testExternalNewWindowUsesSystemBrowser() {
        let url = URL(string: "https://example.org/source")!
        var loadedURL: URL?
        var externalURL: URL?
        let coordinator = makeCoordinator(
            evaluate: { _, completion in completion(nil) },
            openExternalURL: { externalURL = $0 },
            loadInCurrentContext: { _, request in loadedURL = request.url }
        )
        coordinator.handleNewWindowRequest(URLRequest(url: url), url: url, in: WKWebView())

        XCTAssertNil(loadedURL)
        XCTAssertEqual(externalURL, url)
    }

    func testNonWebNewWindowFailsClosedToSystemHandler() {
        let destination = ChatWebView.newWindowDestination(
            for: URL(string: "mailto:person@example.com")!,
            allowedOrigin: nil
        )

        XCTAssertEqual(destination, .browser)
    }

    func testLocationSharingStateDecodesNeutralBridgePayload() {
        XCTAssertEqual(ChatWebView.locationSharingEnabled(from: #"{"enabled":true}"#), true)
        XCTAssertNil(ChatWebView.locationSharingEnabled(from: #"{"enabled":"yes"}"#))
    }

    func testNarrationStateDecodesNeutralBridgePayload() {
        XCTAssertEqual(ChatWebView.narrationEnabled(from: #"{"enabled":true}"#), true)
        XCTAssertNil(ChatWebView.narrationEnabled(from: #"{"enabled":"yes"}"#))
    }

    func testSpeechPlaybackStateDecodesNeutralBridgePayload() {
        XCTAssertEqual(ChatWebView.speechPlaybackActive(from: #"{"playing":true}"#), true)
        XCTAssertNil(ChatWebView.speechPlaybackActive(from: #"{"playing":"yes"}"#))
    }

    func testResponseStateDecodesNeutralBridgePayload() {
        XCTAssertEqual(ChatWebView.responseActive(from: #"{"active":true}"#), true)
        XCTAssertNil(ChatWebView.responseActive(from: #"{"active":"yes"}"#))
    }

    @MainActor
    func testUnacknowledgedEmissionRemainsPending() async {
        let emission = makeEmission()
        let noReceipt = expectation(description: "no fabricated receipt")
        noReceipt.isInverted = true
        var receipt: NativeEmissionReceipt?
        let coordinator = makeCoordinator(
            onReceipt: {
                receipt = $0
                noReceipt.fulfill()
            },
            evaluate: { _, completion in completion(nil) }
        )

        coordinator.deliver([emission], to: WKWebView())
        await fulfillment(of: [noReceipt], timeout: 0.05)

        XCTAssertNil(receipt)
    }

    @MainActor
    func testNavigationClearsInflightStateAndRedeliversSameID() {
        let emission = makeEmission()
        var attempts: [UUID] = []
        var evaluationCount = 0
        let coordinator = makeCoordinator(
            onAttempt: { attempts.append($0) },
            evaluate: { _, completion in
                evaluationCount += 1
                completion(nil)
            }
        )
        coordinator.pendingEmissions = [emission]
        let webView = WKWebView()

        coordinator.deliver([emission], to: webView)
        coordinator.webView(webView, didStartProvisionalNavigation: nil)
        coordinator.webView(webView, didCommit: nil)
        coordinator.webView(webView, didFinish: nil)

        XCTAssertEqual(attempts, [emission.id, emission.id])
        XCTAssertEqual(evaluationCount, 2)
    }

    @MainActor
    func testProvisionalNavigationKeepsOldPageReceiptEligible() {
        let emission = makeEmission()
        var receipt: NativeEmissionReceipt?
        let coordinator = makeCoordinator(
            onReceipt: { receipt = $0 },
            evaluate: { _, completion in completion(nil) }
        )
        let webView = WKWebView()

        coordinator.deliver([emission], to: webView)
        coordinator.webView(webView, didStartProvisionalNavigation: nil)
        coordinator.receiveEmissionReceipt([
            "emissionId": emission.id.uuidString,
            "disposition": "sent",
        ])

        XCTAssertEqual(receipt?.emissionID, emission.id)
        XCTAssertEqual(receipt?.disposition, .sent)
    }

    @MainActor
    func testRedeliveryRequestAbandonsInflightAttemptAndDeliversTheSameIDAgain() {
        let emission = makeEmission()
        var attempts: [UUID] = []
        var evaluationCount = 0
        let coordinator = makeCoordinator(
            onAttempt: { attempts.append($0) },
            evaluate: { _, completion in
                evaluationCount += 1
                completion(nil)
            }
        )
        coordinator.pendingEmissions = [emission]
        let webView = WKWebView()

        coordinator.deliver([emission], to: webView)
        // No request yet: the inflight guard still suppresses redelivery.
        coordinator.abandonRequestedInflightEmissions()
        coordinator.deliver([emission], to: webView)
        XCTAssertEqual(evaluationCount, 1)

        let request = NativeEmissionRedeliveryRequest(emissionIDs: [emission.id])
        coordinator.emissionRedeliveryRequest = request
        coordinator.abandonRequestedInflightEmissions()
        coordinator.deliver([emission], to: webView)

        XCTAssertEqual(attempts, [emission.id, emission.id])
        XCTAssertEqual(evaluationCount, 2)

        // The same request must not redeliver again on later view updates.
        coordinator.abandonRequestedInflightEmissions()
        coordinator.deliver([emission], to: webView)
        XCTAssertEqual(evaluationCount, 2)

        coordinator.emissionRedeliveryRequest = NativeEmissionRedeliveryRequest(
            emissionIDs: [emission.id]
        )
        coordinator.abandonRequestedInflightEmissions()
        coordinator.deliver([emission], to: webView)
        XCTAssertEqual(evaluationCount, 3)
    }

    @MainActor
    func testLateReceiptFromAnAbandonedAttemptIsDroppedButTheNewAttemptSettles() {
        let emission = makeEmission()
        var receipts: [NativeEmissionReceipt] = []
        let coordinator = makeCoordinator(
            onReceipt: { receipts.append($0) },
            evaluate: { _, completion in completion(nil) }
        )
        coordinator.pendingEmissions = [emission]
        let webView = WKWebView()

        coordinator.deliver([emission], to: webView)
        coordinator.emissionRedeliveryRequest = NativeEmissionRedeliveryRequest(
            emissionIDs: [emission.id]
        )
        coordinator.abandonRequestedInflightEmissions()
        // The abandoned attempt's receipt lands before the new delivery.
        coordinator.receiveEmissionReceipt([
            "emissionId": emission.id.uuidString,
            "disposition": "sent",
        ])
        XCTAssertTrue(receipts.isEmpty)

        coordinator.deliver([emission], to: webView)
        coordinator.receiveEmissionReceipt([
            "emissionId": emission.id.uuidString,
            "disposition": "sent",
        ])
        XCTAssertEqual(receipts.map(\.emissionID), [emission.id])
    }

    /// The evaluate completion of an ABANDONED attempt says the script never
    /// reached the page — a fact about that attempt, not about the emission.
    /// The redelivered attempt under the same ID may be sending or already
    /// sent, so rejecting it on the old attempt's error would show the user a
    /// failure that did not happen.
    @MainActor
    func testLateErrorFromAnAbandonedAttemptDoesNotRejectTheFreshAttempt() {
        let emission = makeEmission()
        var receipts: [NativeEmissionReceipt] = []
        var completions: [(Error?) -> Void] = []
        let coordinator = makeCoordinator(
            onReceipt: { receipts.append($0) },
            evaluate: { _, completion in completions.append(completion) }
        )
        coordinator.pendingEmissions = [emission]
        let webView = WKWebView()

        coordinator.deliver([emission], to: webView)
        coordinator.emissionRedeliveryRequest = NativeEmissionRedeliveryRequest(
            emissionIDs: [emission.id]
        )
        coordinator.abandonRequestedInflightEmissions()
        coordinator.deliver([emission], to: webView)
        XCTAssertEqual(completions.count, 2)

        // The abandoned attempt fails only now, with the fresh attempt inflight.
        completions[0](StubDeliveryError.failed)
        XCTAssertTrue(receipts.isEmpty, "the abandoned attempt must not reject the fresh one")

        coordinator.receiveEmissionReceipt([
            "emissionId": emission.id.uuidString,
            "disposition": "sent",
        ])
        XCTAssertEqual(receipts.map(\.emissionID), [emission.id])
        XCTAssertEqual(receipts.map(\.disposition), [.sent])
    }

    @MainActor
    func testCurrentAttemptErrorStillRejectsTheEmission() {
        let emission = makeEmission()
        var receipts: [NativeEmissionReceipt] = []
        let coordinator = makeCoordinator(
            onReceipt: { receipts.append($0) },
            evaluate: { _, completion in completion(StubDeliveryError.failed) }
        )
        coordinator.pendingEmissions = [emission]

        coordinator.deliver([emission], to: WKWebView())

        XCTAssertEqual(receipts.map(\.disposition), [.rejected])
        XCTAssertEqual(receipts.first?.emissionID, emission.id)
    }

    private enum StubDeliveryError: Error {
        case failed
    }

    private func makeEmission() -> NativeChatEmission {
        NativeChatEmission(
            id: UUID(),
            text: "test",
            origin: .typed,
            diarized: false,
            images: [],
            files: [],
            selections: []
        )
    }

    @MainActor
    /// A barge-in aimed at an utterance no document is playing must not wait
    /// for a page: the microphone opened on the press regardless, and a parked
    /// request would fire into whatever the freshly-loaded page says next.
    func testSpeechStopRequestIsSettledRatherThanParkedWhileThePageLoads() {
        var settled: [UUID] = []
        let coordinator = makeCoordinator(
            evaluate: { _, completion in completion(nil) },
            pageLoaded: false,
            onSpeechStopSettled: { settled.append($0) }
        )
        let request = NativeSpeechStopRequest()
        coordinator.speechStopRequest = request

        coordinator.deliverSpeechStopRequest(to: WKWebView())

        XCTAssertEqual(settled, [request.id])
        XCTAssertNil(coordinator.speechStopRequest)
    }

    /// The replacement document is not playing the utterance the press
    /// interrupted, so an undelivered request is abandoned, never replayed.
    func testProvisionalNavigationAbandonsAnUndeliveredSpeechStopRequest() {
        var settled: [UUID] = []
        let coordinator = makeCoordinator(
            evaluate: { _, completion in completion(nil) },
            onSpeechStopSettled: { settled.append($0) }
        )
        let request = NativeSpeechStopRequest()
        coordinator.speechStopRequest = request

        coordinator.webView(WKWebView(), didStartProvisionalNavigation: nil)

        XCTAssertEqual(settled, [request.id])
        XCTAssertNil(coordinator.speechStopRequest)
    }

    private func makeCoordinator(
        onAttempt: @escaping (UUID) -> Void = { _ in },
        onReceipt: @escaping (NativeEmissionReceipt) -> Void = { _ in },
        evaluate: @escaping (String, @escaping (Error?) -> Void) -> Void,
        pageLoaded: Bool = true,
        onSpeechStopSettled: @escaping (NativeSpeechStopRequest.ID) -> Void = { _ in },
        openExternalURL: @escaping (URL) -> Void = { _ in },
        loadInCurrentContext: @escaping (WKWebView, URLRequest) -> Void = { _, _ in }
    ) -> ChatWebView.Coordinator {
        ChatWebView.Coordinator(
            boxID: UUID(),
            allowedOrigin: "https://box.example.com",
            onSessionChange: { _ in },
            onEmissionDeliveryAttempt: onAttempt,
            onEmissionReceipt: onReceipt,
            onLocationShareResult: { _ in },
            onLocationSharingStateChange: { _ in },
            onNarrationStateChange: { _ in },
            onSpeechPlaybackStateChange: { _ in },
            onResponseStateChange: { _ in },
            onScreenshotResult: { _ in },
            onComposerCommand: { _ in },
            onComposerCommandAcknowledgementDelivered: { _ in },
            onSpeechStopRequestSettled: onSpeechStopSettled,
            pageLoaded: pageLoaded,
            evaluateEmission: evaluate,
            openExternalURL: openExternalURL,
            loadInCurrentContext: loadInCurrentContext
        )
    }
}

/// The shell's back control reports itself from KVO, not from the navigation
/// delegate: the web client routes client-side, and a `pushState` grows the
/// back-forward list without firing `didFinish`. The `.initial` option is what
/// makes a webview that starts with nowhere to go say so — without it the
/// control's visibility would be undecided until the first navigation.
@MainActor
final class ChatWebViewBackControlTests: XCTestCase {
    func testCanGoBackIsReportedImmediately() async {
        let reported = expectation(description: "canGoBack reported")
        var values: [Bool] = []
        let coordinator = ChatWebView.Coordinator(
            boxID: UUID(),
            allowedOrigin: "https://box.example.com",
            onSessionChange: { _ in },
            onEmissionDeliveryAttempt: { _ in },
            onEmissionReceipt: { _ in },
            onLocationShareResult: { _ in },
            onLocationSharingStateChange: { _ in },
            onNarrationStateChange: { _ in },
            onSpeechPlaybackStateChange: { _ in },
            onResponseStateChange: { _ in },
            onScreenshotResult: { _ in },
            onComposerCommand: { _ in },
            onComposerCommandAcknowledgementDelivered: { _ in },
            onCanGoBackChange: { canGoBack in
                values.append(canGoBack)
                reported.fulfill()
            },
            evaluateEmission: { _, completion in completion(nil) }
        )

        let webView = WKWebView()
        coordinator.observeCanGoBack(webView)
        await fulfillment(of: [reported], timeout: 1)

        // A fresh webview has nowhere to go, so the control stays hidden.
        XCTAssertEqual(values, [false])
    }

    /// One press walks one entry. `updateUIView` runs on every SwiftUI update,
    /// so an un-latched request would go back repeatedly for a single tap.
    func testRepeatedUpdatesConsumeOneBackRequest() {
        var backCalls = 0
        let webView = BackCountingWebView { backCalls += 1 }
        let coordinator = ChatWebView.Coordinator(
            boxID: UUID(),
            allowedOrigin: "https://box.example.com",
            onSessionChange: { _ in },
            onEmissionDeliveryAttempt: { _ in },
            onEmissionReceipt: { _ in },
            onLocationShareResult: { _ in },
            onLocationSharingStateChange: { _ in },
            onNarrationStateChange: { _ in },
            onSpeechPlaybackStateChange: { _ in },
            onResponseStateChange: { _ in },
            onScreenshotResult: { _ in },
            onComposerCommand: { _ in },
            onComposerCommandAcknowledgementDelivered: { _ in },
            evaluateEmission: { _, completion in completion(nil) }
        )

        coordinator.backRequest = NativeBackRequest()
        coordinator.goBackIfRequested(webView)
        coordinator.goBackIfRequested(webView)
        coordinator.backRequest = NativeBackRequest()
        coordinator.goBackIfRequested(webView)

        XCTAssertEqual(backCalls, 2)
    }
}

/// A `WKWebView` that claims history and counts `goBack()`. A real one has an
/// empty back-forward list in a test, and `canGoBack` is read-only, so the
/// press path can only be exercised through a subclass.
private final class BackCountingWebView: WKWebView {
    private let onGoBack: () -> Void

    init(onGoBack: @escaping () -> Void) {
        self.onGoBack = onGoBack
        super.init(frame: .zero, configuration: WKWebViewConfiguration())
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override var canGoBack: Bool { true }

    override func goBack() -> WKNavigation? {
        onGoBack()
        return nil
    }
}
