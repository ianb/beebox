import BeeBoxMacCore
import BeeBoxShared
import Foundation
import XCTest

@MainActor
final class BoxStoreTests: XCTestCase {
    private func makeStore(
        transport: FakeTransport,
        credentials: FakeCredentials = FakeCredentials(),
        storage: URL = scratchFile("paired-boxes.json")
    ) -> BoxStore {
        BoxStore(
            storageURL: storage,
            credentials: credentials,
            redeemer: PairingRedeemer(transport: transport, userAgent: "BeeBox-Mac-Test"),
            deviceLabel: "Test Mac"
        )
    }

    func testPairingStoresTheBoxAndKeepsTheTokenOutOfTheFile() async throws {
        let credentials = FakeCredentials()
        let storage = scratchFile("paired-boxes.json")
        let store = makeStore(transport: FakeTransport(status: 200, body: #"{"token":"device-token"}"#), credentials: credentials, storage: storage)

        let result = await store.pair(pairingLink())

        let box = try XCTUnwrap(store.boxes.first)
        XCTAssertEqual(result, .paired(box))
        XCTAssertEqual(box.label, "Workshop")
        XCTAssertFalse(box.hostedLocally)
        XCTAssertEqual(credentials.tokens[box.id], "device-token")
        let file = try String(contentsOf: storage, encoding: .utf8)
        XCTAssertFalse(file.contains("device-token"))

        let reloaded = makeStore(transport: FakeTransport(status: 500, body: ""), credentials: credentials, storage: storage)
        XCTAssertEqual(reloaded.boxes, [box])
        XCTAssertEqual(reloaded.token(for: box), "device-token")
    }

    func testPairingTheSameBoxAgainReplacesItsToken() async throws {
        let credentials = FakeCredentials()
        let store = makeStore(transport: FakeTransport(status: 200, body: #"{"token":"second"}"#), credentials: credentials)

        _ = await store.pair(pairingLink(ticket: "a"))
        _ = await store.pair(pairingLink(label: "Shop", ticket: "b"))

        let box = try XCTUnwrap(store.boxes.first)
        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertEqual(box.label, "Shop")
        XCTAssertEqual(credentials.tokens[box.id], "second")
    }

    func testPublicPlainHTTPIsRefusedWithoutARequest() async {
        let transport = FakeTransport(status: 200, body: #"{"token":"t"}"#)
        let store = makeStore(transport: transport)

        let result = await store.pair(pairingLink("http://203.0.113.9/box"))

        XCTAssertEqual(result, .refusedTransport)
        XCTAssertEqual(transport.requestCount, 0)
        XCTAssertTrue(store.boxes.isEmpty)
    }

    func testALinkWithoutATicketIsNotAccepted() async {
        let transport = FakeTransport(status: 200, body: #"{"token":"t"}"#)
        let store = makeStore(transport: transport)

        let result = await store.pair(pairingLink(ticket: nil))

        XCTAssertEqual(result, .noTicket)
        XCTAssertEqual(transport.requestCount, 0)
    }

    func testAStoredTicketIsNotRedeemedTwice() async {
        let transport = FakeTransport(status: 200, body: #"{"token":"t"}"#)
        let store = makeStore(transport: transport)

        _ = await store.pair(pairingLink())
        let again = await store.pair(pairingLink())

        XCTAssertEqual(again, .duplicate)
        XCTAssertEqual(transport.requestCount, 1)
    }

    func testKeychainFailureAddsNoBoxAndAllowsARetry() async {
        let credentials = FakeCredentials()
        credentials.failWrites = true
        let transport = FakeTransport(status: 200, body: #"{"token":"t"}"#)
        let store = makeStore(transport: transport, credentials: credentials)

        let first = await store.pair(pairingLink())
        let second = await store.pair(pairingLink())

        XCTAssertEqual(first, .storeFailed)
        XCTAssertEqual(second, .storeFailed)
        XCTAssertTrue(store.boxes.isEmpty)
        XCTAssertEqual(transport.requestCount, 2)
    }

    func testAnUnreadableFileIsNeverOverwritten() async throws {
        let storage = scratchFile("paired-boxes.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: storage)
        let store = makeStore(transport: FakeTransport(status: 200, body: #"{"token":"t"}"#), storage: storage)

        let result = await store.pair(pairingLink())

        XCTAssertNotNil(store.loadFailure)
        XCTAssertEqual(result, .storeFailed)
        XCTAssertEqual(try String(contentsOf: storage, encoding: .utf8), "not json")
    }

    func testRemoveDeletesTheTokenThenTheRecord() async throws {
        let credentials = FakeCredentials()
        let store = makeStore(transport: FakeTransport(status: 200, body: #"{"token":"t"}"#), credentials: credentials)
        _ = await store.pair(pairingLink())
        let box = try XCTUnwrap(store.boxes.first)

        credentials.failDeletes = true
        XCTAssertThrowsError(try store.remove(box))
        XCTAssertEqual(store.boxes, [box])

        credentials.failDeletes = false
        try store.remove(box)
        XCTAssertTrue(store.boxes.isEmpty)
        XCTAssertNil(credentials.tokens[box.id])
    }

    func testTheLocalBoxFollowsTheRuntimeURL() throws {
        let store = makeStore(transport: FakeTransport(status: 500, body: ""))

        store.setLocalBox(label: "This Mac", baseURL: URL(string: "http://localhost:3280/box/")!)
        store.setLocalBox(label: "This Mac", baseURL: URL(string: "http://localhost:3299/box/")!)

        let box = try XCTUnwrap(store.boxes.first)
        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertTrue(box.hostedLocally)
        XCTAssertEqual(box.baseURL.absoluteString, "http://localhost:3299/box/")
    }
}

@MainActor
final class LocalBoxPairingTests: XCTestCase {
    func testPairingTheLocalBoxGivesItsEntryAToken() async throws {
        let credentials = FakeCredentials()
        let store = BoxStore(
            storageURL: scratchFile("paired-boxes.json"),
            credentials: credentials,
            redeemer: PairingRedeemer(transport: FakeTransport(status: 200, body: #"{"token":"local-token"}"#), userAgent: "ua"),
            deviceLabel: "Test Mac"
        )
        store.setLocalBox(label: "This Mac", baseURL: URL(string: "http://localhost:3280/box/")!)

        _ = await store.pair(pairingLink("http://localhost:3280/box", label: "Bee Box"))

        let box = try XCTUnwrap(store.boxes.first)
        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertTrue(box.hostedLocally)
        XCTAssertEqual(credentials.tokens[box.id], "local-token")
    }
}

final class CachedCredentialStoreTests: XCTestCase {
    final class CountingStore: PairedBoxCredentialStoreProtocol, @unchecked Sendable {
        var tokens: [UUID: String] = [:]
        var reads = 0
        func readToken(for boxID: UUID) -> String? { reads += 1; return tokens[boxID] }
        func writeToken(_ token: String, for boxID: UUID) throws { tokens[boxID] = token }
        func deleteToken(for boxID: UUID) throws { tokens[boxID] = nil }
        func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int { 0 }
    }

    func testEachItemIsReadOnceIncludingAMiss() {
        let backing = CountingStore()
        let id = UUID()
        backing.tokens[id] = "t"
        let cached = CachedCredentialStore(backing)
        for _ in 0..<5 {
            XCTAssertEqual(cached.readToken(for: id), "t")
            XCTAssertNil(cached.readToken(for: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!))
        }
        XCTAssertEqual(backing.reads, 2)
    }

    func testWritesAndDeletesUpdateTheCache() throws {
        let backing = CountingStore()
        let cached = CachedCredentialStore(backing)
        let id = UUID()
        try cached.writeToken("new", for: id)
        XCTAssertEqual(cached.readToken(for: id), "new")
        try cached.deleteToken(for: id)
        XCTAssertNil(cached.readToken(for: id))
        XCTAssertEqual(backing.reads, 1, "only the write's own read-back reaches the Keychain")
    }
}
