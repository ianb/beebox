import XCTest
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
            authToken: authToken
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
}
