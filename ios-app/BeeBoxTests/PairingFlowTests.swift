import BeeBoxShared
import XCTest
@testable import BeeBox

/// `PairedBoxStore.pair(from:)`: a `beebox://pair` link through redeem to a
/// stored box, against a fake transport.
@MainActor
final class PairingFlowTests: XCTestCase {
    private let link = URL(string: "beebox://pair?baseURL=https%3A%2F%2Fbox.example.test%2Fhome&label=Home&pairingToken=ticket-1")!

    func testRedeemedLinkStoresBoxWithDeviceToken() async throws {
        let transport = GatedTransport(status: 200, body: #"{"token":"device-token"}"#)
        await transport.open()
        let (store, credentials) = makeStore(transport: transport)

        let outcome = await store.pair(from: link)

        XCTAssertEqual(outcome, .paired)
        let box = try XCTUnwrap(store.boxes.first)
        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertEqual(box.label, "Home")
        XCTAssertEqual(box.baseURL.absoluteString, "https://box.example.test/home")
        XCTAssertEqual(credentials.tokens[box.id], "device-token")
        XCTAssertEqual(store.selectedBoxID, box.id)
        let requestCount = await transport.requestCount
        XCTAssertEqual(requestCount, 1)
    }

    /// The bug from issues/bugs/2026-07-17-ios-pairing-flow-robustness.md: one
    /// link delivered twice must POST its single-use ticket once.
    func testSameLinkDeliveredTwiceWhileRedeemingPostsOnce() async throws {
        let transport = GatedTransport(status: 200, body: #"{"token":"device-token"}"#)
        let (store, _) = makeStore(transport: transport)

        async let first = store.pair(from: link)
        await transport.waitForRequests(1)
        let second = await store.pair(from: link)
        await transport.open()
        let firstOutcome = await first

        XCTAssertEqual(second, .duplicate)
        XCTAssertNil(second.failureMessage)
        XCTAssertEqual(firstOutcome, .paired)
        XCTAssertEqual(store.boxes.count, 1)
        let requestCount = await transport.requestCount
        XCTAssertEqual(requestCount, 1)
    }

    func testSameLinkAfterSuccessDoesNotPostAgain() async {
        let transport = GatedTransport(status: 200, body: #"{"token":"device-token"}"#)
        await transport.open()
        let (store, _) = makeStore(transport: transport)

        _ = await store.pair(from: link)
        let again = await store.pair(from: link)

        XCTAssertEqual(again, .duplicate)
        let requestCount = await transport.requestCount
        XCTAssertEqual(requestCount, 1)
    }

    func testRejectedTicketReportsServerMessageAndAddsNothing() async throws {
        let transport = GatedTransport(status: 401, body: #"{"error":"Pairing code is invalid or expired."}"#)
        await transport.open()
        let (store, _) = makeStore(transport: transport)

        let outcome = await store.pair(from: link)

        XCTAssertEqual(outcome, .failed(.redeem(.rejected(status: 401, message: "Pairing code is invalid or expired."))))
        XCTAssertEqual(
            outcome.failureMessage,
            "Pairing code is invalid or expired. Make a new one on the box and try again."
        )
        XCTAssertTrue(store.boxes.isEmpty)
    }

    func testFailedTicketCanBeRetried() async {
        let transport = GatedTransport(status: 503, body: "Box is closed")
        await transport.open()
        let (store, _) = makeStore(transport: transport)

        _ = await store.pair(from: link)
        let retry = await store.pair(from: link)

        XCTAssertEqual(retry, .failed(.redeem(.rejected(status: 503, message: nil))))
        let requestCount = await transport.requestCount
        XCTAssertEqual(requestCount, 2)
    }

    func testCredentialSaveFailureIsReported() async {
        let transport = GatedTransport(status: 200, body: #"{"token":"device-token"}"#)
        await transport.open()
        let (store, credentials) = makeStore(transport: transport)
        credentials.failAllWrites = true

        let outcome = await store.pair(from: link)

        XCTAssertEqual(outcome, .failed(.storeFailed))
        XCTAssertNotNil(outcome.failureMessage)
    }

    func testNonPairingLinkIsNotRedeemed() async {
        let transport = GatedTransport(status: 200, body: #"{"token":"device-token"}"#)
        let (store, _) = makeStore(transport: transport)

        let outcome = await store.pair(from: URL(string: "beebox://pair?label=Nope&pairingToken=t")!)

        XCTAssertEqual(outcome, .notAPairingLink)
        let requestCount = await transport.requestCount
        XCTAssertEqual(requestCount, 0)
    }

    private func makeStore(transport: GatedTransport) -> (PairedBoxStore, FakeCredentialStore) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("beebox-ios-pairing-tests-\(UUID().uuidString)")
        let credentials = FakeCredentialStore()
        let store = PairedBoxStore(
            storageURL: directory.appendingPathComponent("paired-boxes.json"),
            credentialStore: credentials,
            selectedBoxStore: FakeSelectedBoxSnapshotStore(),
            redeemer: PairingRedeemer(transport: transport, userAgent: "BeeBox-Test"),
            deviceLabel: { "Test Phone" }
        )
        return (store, credentials)
    }
}

/// Holds every request until `open()`, so a test can deliver a second link
/// while the first redeem is still in flight.
private actor GatedTransport: HTTPTransport {
    private let status: Int
    private let body: Data
    private var isOpen = false
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var countWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private(set) var requestCount = 0

    init(status: Int, body: String) {
        self.status = status
        self.body = Data(body.utf8)
    }

    func open() {
        isOpen = true
        let released = waiting
        waiting = []
        released.forEach { $0.resume() }
    }

    func waitForRequests(_ count: Int) async {
        guard requestCount < count else { return }
        await withCheckedContinuation { countWaiters.append((count, $0)) }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requestCount += 1
        let ready = countWaiters.filter { $0.0 <= requestCount }
        countWaiters.removeAll { $0.0 <= requestCount }
        ready.forEach { $0.1.resume() }
        if !isOpen {
            await withCheckedContinuation { waiting.append($0) }
        }
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil))
        return (body, response)
    }
}
