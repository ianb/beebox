import XCTest
import WebKit
@testable import CallbackBox

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
        coordinator.webView(webView, didFinish: nil)

        XCTAssertEqual(attempts, [emission.id, emission.id])
        XCTAssertEqual(evaluationCount, 2)
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
    private func makeCoordinator(
        onAttempt: @escaping (UUID) -> Void = { _ in },
        onReceipt: @escaping (NativeEmissionReceipt) -> Void = { _ in },
        evaluate: @escaping (String, @escaping (Error?) -> Void) -> Void,
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
            pageLoaded: true,
            evaluateEmission: evaluate,
            openExternalURL: openExternalURL,
            loadInCurrentContext: loadInCurrentContext
        )
    }
}
