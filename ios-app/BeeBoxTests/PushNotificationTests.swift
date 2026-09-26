import UserNotifications
import XCTest
@testable import BeeBox

/// APNs client side (contract §5.9, §5.10): the registration post, when it is
/// sent, and where a tap lands.
final class PushNotificationTests: XCTestCase {
    private let box = PairedBox(
        id: UUID(),
        label: "Test box",
        baseURL: URL(string: "https://box.example.com/family")!,
        sessionID: nil,
        authToken: "device-token",
        requiresDeviceUnlock: false
    )

    // MARK: - Environment and token encoding

    func testDebugBuildsRegisterAgainstTheSandboxHost() {
        XCTAssertEqual(PushEnvironment.forBuild(isDebug: true), .sandbox)
        XCTAssertEqual(PushEnvironment.forBuild(isDebug: false), .production)
        // The test target builds Debug.
        XCTAssertEqual(PushEnvironment.current, .sandbox)
    }

    func testTokenIsLowercaseHexOfEveryByte() {
        let data = Data([0x00, 0x0f, 0xa0, 0xff, 0x7b])
        XCTAssertEqual(PushToken.hex(data), "000fa0ff7b")
        XCTAssertEqual(PushToken.hex(Data(repeating: 0xab, count: 32)).count, 64)
    }

    // MARK: - Request shape, pinned by the shared fixtures

    /// `beebox/test/mobile-contract/fixtures/push-token/`: the request fixtures'
    /// `expected` is the stored form, which is exactly what this client sends
    /// (it hex-encodes lowercase); the environment fixture that the box refuses
    /// names a value this client cannot produce.
    func testRequestMatchesThePushTokenFixtures() throws {
        let fixtures = try MobileContractFixtures.load("push-token")
        XCTAssertFalse(fixtures.isEmpty, "no push-token fixtures at \(MobileContractFixtures.root.path)")
        var requests = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], name)
            switch (fixture["variant"] as? String, fixture["status"] as? Int) {
            case ("request", _):
                requests += 1
                let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], name)
                let environment = try XCTUnwrap(
                    PushEnvironment(rawValue: try XCTUnwrap(expected["environment"] as? String)),
                    name
                )
                let token = try XCTUnwrap(expected["token"] as? String, name)
                let request = try PushTokenRequest.urlRequest(box: box, token: token, environment: environment)
                XCTAssertEqual(request.url?.absoluteString, "https://box.example.com/family/api/pairing/push-token", name)
                XCTAssertEqual(request.httpMethod, "POST", name)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-token", name)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json", name)
                let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]
                XCTAssertEqual(
                    try MobileContractFixtures.canonicalJSON(try XCTUnwrap(body)),
                    try MobileContractFixtures.canonicalJSON(expected),
                    name
                )
            case ("error", 400):
                if let environment = input["environment"] as? String, environment != "sandbox", environment != "production" {
                    XCTAssertNil(PushEnvironment(rawValue: environment), name)
                }
            default:
                continue
            }
        }
        XCTAssertGreaterThan(requests, 0)
    }

    // MARK: - Post only when changed

    func testLedgerPostsOnceUntilTokenCredentialOrAgeChanges() {
        let ledger = PushRegistrationLedger(defaults: makeDefaults())
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let first = PushRegistrationLedger.fingerprint(token: "aa", environment: .sandbox, credential: "c1")

        XCTAssertTrue(ledger.needsPost(boxID: box.id, fingerprint: first, now: now))
        ledger.record(boxID: box.id, fingerprint: first, now: now)
        XCTAssertFalse(ledger.needsPost(boxID: box.id, fingerprint: first, now: now.addingTimeInterval(60)))

        let newToken = PushRegistrationLedger.fingerprint(token: "bb", environment: .sandbox, credential: "c1")
        let repaired = PushRegistrationLedger.fingerprint(token: "aa", environment: .sandbox, credential: "c2")
        let otherHost = PushRegistrationLedger.fingerprint(token: "aa", environment: .production, credential: "c1")
        XCTAssertTrue(ledger.needsPost(boxID: box.id, fingerprint: newToken, now: now))
        XCTAssertTrue(ledger.needsPost(boxID: box.id, fingerprint: repaired, now: now))
        XCTAssertTrue(ledger.needsPost(boxID: box.id, fingerprint: otherHost, now: now))
        XCTAssertTrue(ledger.needsPost(boxID: UUID(), fingerprint: first, now: now), "a newly paired box posts")
        XCTAssertTrue(
            ledger.needsPost(boxID: box.id, fingerprint: first, now: now.addingTimeInterval(PushRegistrationLedger.refreshInterval)),
            "a day-old registration is re-posted, restoring one the box pruned"
        )

        ledger.retain(boxIDs: [])
        XCTAssertTrue(ledger.needsPost(boxID: box.id, fingerprint: first, now: now), "an unpaired box's record is dropped")
    }

    @MainActor
    func testRegistrarPostsToEachBoxOnceAndOnlyWhenAllowed() async throws {
        let transport = RecordingPushTransport()
        let authorizer = StubAuthorizer(permission: .denied)
        let registrar = PushRegistrar(
            ledger: PushRegistrationLedger(defaults: makeDefaults()),
            transport: transport,
            authorizer: authorizer,
            environment: .sandbox
        )
        let second = PairedBox(
            id: UUID(),
            label: "Second",
            baseURL: URL(string: "https://other.example.com/kitchen")!,
            sessionID: nil,
            authToken: "second-token",
            requiresDeviceUnlock: false
        )
        let unauthenticated = PairedBox(
            id: UUID(),
            label: "Manual",
            baseURL: URL(string: "https://manual.example.com/x")!,
            sessionID: nil,
            authToken: nil,
            requiresDeviceUnlock: false
        )

        await registrar.boxesDidChange([box, unauthenticated])
        await registrar.tokenDidChange("abcd")
        XCTAssertEqual(registrar.permission, .denied)
        XCTAssertEqual(transport.urls, [], "nothing is posted while notifications are off")

        authorizer.permission = .allowed
        await registrar.sceneDidBecomeActive()
        XCTAssertEqual(transport.urls, ["https://box.example.com/family/api/pairing/push-token"])

        // A relaunch-equivalent with the same token posts nothing new.
        await registrar.tokenDidChange("abcd")
        XCTAssertEqual(transport.urls.count, 1)

        // Pairing a second box posts to it alone.
        await registrar.boxesDidChange([box, unauthenticated, second])
        XCTAssertEqual(transport.urls.last, "https://other.example.com/kitchen/api/pairing/push-token")
        XCTAssertEqual(transport.urls.count, 2)

        // A new token posts to both.
        await registrar.tokenDidChange("ef01")
        XCTAssertEqual(transport.urls.count, 4)
    }

    @MainActor
    func testFailedPostIsRetriedOnTheNextSync() async {
        let transport = RecordingPushTransport()
        transport.status = 503
        let registrar = PushRegistrar(
            ledger: PushRegistrationLedger(defaults: makeDefaults()),
            transport: transport,
            authorizer: StubAuthorizer(permission: .allowed),
            environment: .sandbox
        )
        await registrar.boxesDidChange([box])
        await registrar.tokenDidChange("abcd")
        XCTAssertEqual(transport.urls.count, 1)

        transport.status = 204
        await registrar.syncRegistrations()
        XCTAssertEqual(transport.urls.count, 2)
        await registrar.syncRegistrations()
        XCTAssertEqual(transport.urls.count, 2)
    }

    @MainActor
    func testFirstPairingAsksForPermissionOnce() async {
        let authorizer = StubAuthorizer(permission: .notDetermined)
        authorizer.grantOnRequest = true
        let registrar = PushRegistrar(
            ledger: PushRegistrationLedger(defaults: makeDefaults()),
            transport: RecordingPushTransport(),
            authorizer: authorizer,
            environment: .sandbox
        )
        await registrar.boxesDidChange([])
        XCTAssertEqual(authorizer.requests, 0, "no box, no prompt")
        await registrar.boxesDidChange([box])
        XCTAssertEqual(authorizer.requests, 1)
        XCTAssertEqual(registrar.permission, .allowed)
        await registrar.boxesDidChange([box])
        XCTAssertEqual(authorizer.requests, 1)
    }

    // MARK: - Payload keys (contract §5.10)

    /// `beebox/test/mobile-contract/fixtures/apns-payload/`: the box's payload
    /// for each loudness, read the way the notification delegate reads it.
    func testApnsPayloadFixturesReadAsTheirLoudness() throws {
        let fixtures = try MobileContractFixtures.load("apns-payload")
        XCTAssertEqual(fixtures.count, 3)
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], name)
            let intent = try XCTUnwrap(input["intent"] as? [String: Any], name)
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], name)
            let payload = try XCTUnwrap(expected["payload"] as? [String: Any], name)
            let userInfo = payload.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value }

            let loudness = NotificationLoudness(userInfo: userInfo)
            XCTAssertEqual(loudness.rawValue, intent["loudness"] as? String, name)
            let tap = NotificationTap(userInfo: userInfo)
            XCTAssertEqual(tap.target, intent["target"] as? String, name)
            XCTAssertEqual(tap.notificationID, intent["id"] as? String, name)
            XCTAssertNotNil(tap.boxPath, name)
        }
    }

    func testOnlyLoudPresentsInTheForeground() {
        XCTAssertEqual(NotificationCenterDelegate.presentationOptions(for: .loud), [.banner, .sound, .badge])
        XCTAssertEqual(NotificationCenterDelegate.presentationOptions(for: .quiet), [])
        XCTAssertEqual(NotificationCenterDelegate.presentationOptions(for: .dot), [])
        XCTAssertEqual(NotificationLoudness(userInfo: [:]), .dot)
        XCTAssertEqual(NotificationLoudness(userInfo: ["loudness": "shout"]), .quiet)
    }

    // MARK: - Target to URL (mirrors beebox/test/core/notification/target.doctest.md)

    private func render(_ value: String) -> String? {
        NotificationTarget(value).map { "/family/" + $0.boxPath(notificationID: "n7Qx") }
    }

    func testTheSixSchemesMatchTheBoxDoctest() {
        XCTAssertEqual(render("chat:8f2c-41aa"), "/family/chat?session=8f2c-41aa")
        XCTAssertEqual(render("chat:new"), "/family/chat?new=1&notification=n7Qx")
        XCTAssertEqual(
            render("card:_content/pets/pepper-shots.todo.card"),
            "/family/browse/_content/pets/pepper-shots.todo.card"
        )
        XCTAssertEqual(
            render("question:_bookkeeping/questions/Color.question.card"),
            "/family/browse/_bookkeeping/questions/Color.question.card"
        )
        XCTAssertEqual(
            render("admin:google-services"),
            "/family/views/_config/interface/admin.card?viewState=%7B%22section%22%3A%22google-services%22%7D"
        )
        XCTAssertEqual(render("dashboard"), "/family/")
    }

    func testCardPathNormalizesFromTheBoxRoot() {
        XCTAssertEqual(
            render("card:/_content/./notes/Plan.doc.card"),
            "/family/browse/_content/notes/Plan.doc.card"
        )
    }

    func testBadTargetsOpenNothing() {
        XCTAssertNil(NotificationTarget("https://example.com/"))
        XCTAssertNil(NotificationTarget("/box/health"))
        XCTAssertNil(NotificationTarget("card:../elsewhere/secret.card"))
        XCTAssertNil(NotificationTarget("card:notes/outside-the-areas.card"))
        XCTAssertNil(NotificationTarget("question:"))
        XCTAssertNil(NotificationTarget("chat:a b"))
        XCTAssertNil(NotificationTarget("chat:a/b"))
        XCTAssertNil(NotificationTarget("admin:Google"))
        XCTAssertNil(NotificationTarget("admin:google--services"))
        XCTAssertNil(NotificationTarget("card:_content/" + String(repeating: "x", count: 1000) + ".card"))
        XCTAssertNil(NotificationTap(target: nil, notificationID: "n1").boxPath)
    }

    func testSessionIdIsEncodedLikeEncodeURIComponent() {
        XCTAssertEqual(NotificationTarget.encodeURIComponent("a+b=c;d"), "a%2Bb%3Dc%3Bd")
        XCTAssertEqual(NotificationTarget.encodeURIComponent("é"), "%C3%A9")
        XCTAssertEqual(NotificationTarget.encodeURIComponent("-_.!~*'()"), "-_.!~*'()")
    }

    // MARK: - Loading the target

    func testChatTargetsKeepTheNativeComposer() {
        XCTAssertEqual(
            box.url(forBoxPath: "chat?session=8f2c-41aa")?.absoluteString,
            "https://box.example.com/family/chat?nativeComposer=1&session=8f2c-41aa"
        )
        XCTAssertEqual(
            box.url(forBoxPath: "browse/_content/notes/Plan.doc.card")?.absoluteString,
            "https://box.example.com/family/browse/_content/notes/Plan.doc.card"
        )
        XCTAssertEqual(box.url(forBoxPath: "")?.absoluteString, "https://box.example.com/family/")
    }

    func testPathPageAuthenticatesByHeaderOnly() {
        let request = ChatWebView.authenticatedRequest(
            for: box,
            page: .path("views/_config/interface/admin.card?viewState=%7B%22section%22%3A%22google-services%22%7D")
        )
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://box.example.com/family/views/_config/interface/admin.card?viewState=%7B%22section%22%3A%22google-services%22%7D"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-token")
        XCTAssertFalse(request.url?.absoluteString.contains("device-token") ?? true)
    }

    private func makeDefaults() -> UserDefaults {
        let name = "PushNotificationTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }
}

private final class RecordingPushTransport: PushTokenTransport, @unchecked Sendable {
    var urls: [String] = []
    var status = 204

    func send(_ request: URLRequest) async throws -> Int {
        urls.append(request.url?.absoluteString ?? "")
        return status
    }
}

private final class StubAuthorizer: NotificationAuthorizing, @unchecked Sendable {
    var permission: NotificationPermission
    var grantOnRequest = false
    var requests = 0

    init(permission: NotificationPermission) {
        self.permission = permission
    }

    func currentPermission() async -> NotificationPermission {
        permission
    }

    func requestAuthorization() async throws -> Bool {
        requests += 1
        if grantOnRequest {
            permission = .allowed
        }
        return grantOnRequest
    }
}
