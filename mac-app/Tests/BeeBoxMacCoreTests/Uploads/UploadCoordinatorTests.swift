import BeeBoxMacCore
import BeeBoxShared
import Foundation
import XCTest

@MainActor
final class UploadCoordinatorTests: XCTestCase {
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("beebox-mac-uploads-\(UUID().uuidString)")

    override func setUpWithError() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: directory)
    }

    private struct Rig {
        let coordinator: UploadCoordinator
        let folders: UploadFolderStore
        let boxes: BoxStore
        let scanTokens: FakeCredentials
        let tokenTransport: ScriptedTransport
        let sweeper: FakeSweeper
        let notices: NoticeLog
        let box: PairedBox
    }

    private func makeRig(oldUploaderPlist: URL? = nil) async throws -> Rig {
        let deviceTokens = FakeCredentials()
        let boxes = BoxStore(
            storageURL: directory.appendingPathComponent("boxes.json"),
            credentials: deviceTokens,
            redeemer: PairingRedeemer(transport: FakeTransport(status: 200, body: #"{"token":"device"}"#), userAgent: "ua"),
            deviceLabel: "Test Mac"
        )
        guard case .paired(let box) = await boxes.pair(pairingLink()) else { throw XCTSkip("pairing fixture failed") }
        let folders = UploadFolderStore(storageURL: directory.appendingPathComponent("uploads.json"))
        let scanTokens = FakeCredentials()
        let tokenTransport = ScriptedTransport()
        let sweeper = FakeSweeper()
        let notices = NoticeLog()
        let coordinator = UploadCoordinator(
            folders: folders,
            boxes: boxes,
            scanTokens: scanTokens,
            tokenClient: ScanTokenClient(transport: tokenTransport, userAgent: "ua"),
            sweeper: sweeper,
            photos: nil,
            hostName: "Test Mac",
            oldUploaderPlist: oldUploaderPlist ?? directory.appendingPathComponent("no-agent.plist"),
            now: { Date(timeIntervalSince1970: 1_792_195_200) },
            notify: { notices.items.append($0) }
        )
        return Rig(coordinator: coordinator, folders: folders, boxes: boxes, scanTokens: scanTokens,
                   tokenTransport: tokenTransport, sweeper: sweeper, notices: notices, box: box)
    }

    private func mintedBody(_ token: String) -> String {
        #"{"result":{"data":{"name":"n","token":"\#(token)","createdAt":"x"}}}"#
    }

    func testAddingAFolderMintsOneScanTokenAndSweeps() async throws {
        let rig = try await makeRig()
        rig.tokenTransport.queue(200, mintedBody("scan-1"))
        rig.sweeper.summary = SweepSummary.empty.with(uploaded: 2)

        let problem = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)

        XCTAssertNil(problem)
        XCTAssertEqual(rig.scanTokens.tokens[rig.box.id], "scan-1")
        XCTAssertNotNil(rig.folders.scanTokenNames[rig.box.id])
        XCTAssertEqual(rig.sweeper.targets.map(\.scanToken), ["scan-1"])
        let folder = try XCTUnwrap(rig.folders.folders.first)
        XCTAssertEqual(rig.coordinator.statuses[folder.id]?.totalSent, 2)
        XCTAssertEqual(rig.notices.items.map(\.uploaded), [2])

        // A second folder for the same box reuses the token.
        let second = directory.appendingPathComponent("photos")
        try FileManager.default.createDirectory(at: second, withIntermediateDirectories: true)
        _ = await rig.coordinator.addFolder(path: second.path, box: rig.box, disposition: .keep)
        XCTAssertEqual(rig.tokenTransport.requests.count, 1)
    }

    func testANonOwnerPairingCannotAddAFolder() async throws {
        let rig = try await makeRig()
        rig.tokenTransport.queue(403, #"{"error":{"message":"Owner access required"}}"#)

        let problem = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)

        XCTAssertEqual(problem, .pairedByNobody)
        XCTAssertTrue(rig.folders.folders.isEmpty)
    }

    func testAKeychainFailureRevokesTheMintedToken() async throws {
        let rig = try await makeRig()
        rig.scanTokens.failWrites = true
        rig.tokenTransport.queue(200, mintedBody("scan-1"))
        rig.tokenTransport.queue(200, #"{"result":{"data":{"ok":true}}}"#)

        let problem = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)

        XCTAssertEqual(problem, .credentialNotSaved)
        XCTAssertEqual(rig.tokenTransport.requests.compactMap(\.url?.lastPathComponent), ["scanTokens.create", "scanTokens.revoke"])
        XCTAssertTrue(rig.folders.folders.isEmpty)
    }

    func testTheOldUploadersFolderIsRefused() async throws {
        let plist = directory.appendingPathComponent("agent.plist")
        let data = try PropertyListSerialization.data(fromPropertyList: ["Label": OldUploaderCheck.label, "WatchPaths": [directory.path + "/"]], format: .xml, options: 0)
        try data.write(to: plist)
        let rig = try await makeRig(oldUploaderPlist: plist)

        let problem = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)

        XCTAssertEqual(problem, .oldUploaderWatching)
        XCTAssertTrue(rig.tokenTransport.requests.isEmpty)
    }

    func testAnUnreadableAgentPlistFailsClosed() throws {
        let plist = directory.appendingPathComponent("agent.plist")
        try Data("not a plist".utf8).write(to: plist)
        XCTAssertTrue(OldUploaderCheck.conflicts(folderPath: directory.path, plistURL: plist))
        XCTAssertFalse(OldUploaderCheck.conflicts(folderPath: directory.path, plistURL: directory.appendingPathComponent("none.plist")))
    }

    func testAStandingProblemStaysUntilASweepClearsIt() async throws {
        let rig = try await makeRig()
        rig.tokenTransport.queue(200, mintedBody("scan-1"))
        rig.sweeper.summary = SweepSummary.empty.with(problem: .boxUnavailable)
        _ = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)
        let folder = try XCTUnwrap(rig.folders.folders.first)
        XCTAssertEqual(rig.coordinator.statuses[folder.id]?.problem, .sweep(.boxUnavailable))
        XCTAssertTrue(rig.coordinator.hasStandingProblem)
        XCTAssertTrue(rig.notices.items.isEmpty)

        rig.sweeper.summary = .empty
        await rig.coordinator.sweepAll()
        XCTAssertNil(rig.coordinator.statuses[folder.id]?.problem)
        XCTAssertFalse(rig.coordinator.hasStandingProblem)
    }

    func testRemovingTheLastFolderRevokesTheToken() async throws {
        let rig = try await makeRig()
        rig.tokenTransport.queue(200, mintedBody("scan-1"))
        _ = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)
        let folder = try XCTUnwrap(rig.folders.folders.first)

        rig.tokenTransport.queue(500, #"{"error":{"message":"boom"}}"#)
        let failed = await rig.coordinator.removeFolder(folder, force: false)
        guard case .revokeFailed = failed else { return XCTFail("\(failed)") }
        XCTAssertEqual(rig.folders.folders, [folder])
        XCTAssertEqual(rig.scanTokens.tokens[rig.box.id], "scan-1")

        rig.tokenTransport.queue(200, #"{"result":{"data":{"ok":true}}}"#)
        let removed = await rig.coordinator.removeFolder(folder, force: false)
        XCTAssertEqual(removed, .removed)
        XCTAssertTrue(rig.folders.folders.isEmpty)
        XCTAssertNil(rig.scanTokens.tokens[rig.box.id])
        XCTAssertNil(rig.folders.scanTokenNames[rig.box.id])
    }

    func testRemoveAnywayKeepsNothingLocally() async throws {
        let rig = try await makeRig()
        rig.tokenTransport.queue(200, mintedBody("scan-1"))
        _ = await rig.coordinator.addFolder(path: directory.path, box: rig.box, disposition: .keep)

        let result = await rig.coordinator.removeBox(rig.box, force: true)

        XCTAssertEqual(result, .removed)
        XCTAssertTrue(rig.boxes.boxes.isEmpty)
        XCTAssertTrue(rig.folders.folders.isEmpty)
        XCTAssertNil(rig.scanTokens.tokens[rig.box.id])
    }
}

@MainActor
final class UploadReviewFixTests: XCTestCase {
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("beebox-mac-fixes-\(UUID().uuidString)")

    override func setUpWithError() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: directory)
    }

    /// A folder whose save failed must never be published, or a sweep would
    /// act on settings the person was told were not saved.
    func testAFolderThatCannotBeSavedIsNotPublished() throws {
        let blocker = directory.appendingPathComponent("not-a-directory")
        try Data().write(to: blocker)
        let store = UploadFolderStore(storageURL: blocker.appendingPathComponent("uploads.json"))
        let folder = UploadFolder(id: UUID(), folderPath: directory.path, boxID: UUID(), disposition: .trash, photosAlbum: nil)

        XCTAssertFalse(store.add(folder))
        XCTAssertTrue(store.folders.isEmpty)
    }

    private func pairedRig(sweeper: FakeSweeper, tokens: ScriptedTransport, clock: MutableClock) async throws -> (UploadCoordinator, UploadFolderStore, PairedBox) {
        let boxes = BoxStore(
            storageURL: directory.appendingPathComponent("boxes.json"),
            credentials: FakeCredentials(),
            redeemer: PairingRedeemer(transport: FakeTransport(status: 200, body: #"{"token":"device"}"#), userAgent: "ua"),
            deviceLabel: "Test Mac"
        )
        guard case .paired(let box) = await boxes.pair(pairingLink()) else { throw XCTSkip("pairing fixture failed") }
        let folders = UploadFolderStore(storageURL: directory.appendingPathComponent("uploads.json"))
        let coordinator = UploadCoordinator(
            folders: folders, boxes: boxes, scanTokens: FakeCredentials(),
            tokenClient: ScanTokenClient(transport: tokens, userAgent: "ua"),
            sweeper: sweeper, photos: nil, hostName: "Test Mac",
            oldUploaderPlist: directory.appendingPathComponent("none.plist"),
            now: { clock.now }, notify: { _ in }
        )
        return (coordinator, folders, box)
    }

    func testAFailedMintLeavesNoRecordedName() async throws {
        let tokens = ScriptedTransport()
        tokens.queue(500, #"{"error":{"message":"boom"}}"#)
        let (coordinator, folders, box) = try await pairedRig(sweeper: FakeSweeper(), tokens: tokens, clock: MutableClock())

        let problem = await coordinator.addFolder(path: directory.path, box: box, disposition: .keep)

        XCTAssertNotNil(problem)
        XCTAssertNil(folders.scanTokenNames[box.id])
    }

    /// A name recorded with no token behind it (an attempt that stopped after
    /// recording) is revoked before a new mint replaces it.
    func testALeftoverNameIsRevokedBeforeANewMint() async throws {
        let tokens = ScriptedTransport()
        tokens.queue(404, #"{"error":{"message":"No active scan token with that name"}}"#)
        tokens.queue(200, #"{"result":{"data":{"name":"n","token":"scan","createdAt":"x"}}}"#)
        let (coordinator, folders, box) = try await pairedRig(sweeper: FakeSweeper(), tokens: tokens, clock: MutableClock())
        folders.setScanTokenName("mac-left-over", forBox: box.id)

        let problem = await coordinator.addFolder(path: directory.path, box: box, disposition: .keep)

        XCTAssertNil(problem)
        XCTAssertEqual(tokens.requests.compactMap(\.url?.lastPathComponent), ["scanTokens.revoke", "scanTokens.create"])
        XCTAssertNotEqual(folders.scanTokenNames[box.id], "mac-left-over")
    }

    func testRetryAfterHoldsEveryTriggerForThatBox() async throws {
        let tokens = ScriptedTransport()
        tokens.queue(200, #"{"result":{"data":{"name":"n","token":"scan","createdAt":"x"}}}"#)
        let sweeper = FakeSweeper()
        sweeper.summary = SweepSummary.empty.with(problem: .rateLimited(retryAfterSeconds: 60))
        let clock = MutableClock()
        let (coordinator, _, box) = try await pairedRig(sweeper: sweeper, tokens: tokens, clock: clock)

        _ = await coordinator.addFolder(path: directory.path, box: box, disposition: .keep)
        XCTAssertEqual(sweeper.targets.count, 1)

        await coordinator.sweepAll()
        XCTAssertEqual(sweeper.targets.count, 1, "asked again inside the Retry-After window")

        clock.now = clock.now.addingTimeInterval(61)
        sweeper.summary = .empty
        await coordinator.sweepAll()
        XCTAssertEqual(sweeper.targets.count, 2)
    }

    func testFilesThatFailedToSendShowInTheStatus() async throws {
        let tokens = ScriptedTransport()
        tokens.queue(200, #"{"result":{"data":{"name":"n","token":"scan","createdAt":"x"}}}"#)
        let sweeper = FakeSweeper()
        var summary = SweepSummary.empty
        summary.errors = 1
        sweeper.summary = summary
        let (coordinator, folders, box) = try await pairedRig(sweeper: sweeper, tokens: tokens, clock: MutableClock())

        _ = await coordinator.addFolder(path: directory.path, box: box, disposition: .keep)

        let folder = try XCTUnwrap(folders.folders.first)
        XCTAssertEqual(coordinator.statuses[folder.id]?.failedInFolder, 1)
    }
}

@MainActor
final class MutableClock {
    var now = Date(timeIntervalSince1970: 1_792_195_200)
}

final class FakeSweeper: FolderSweeping, @unchecked Sendable {
    private let lock = NSLock()
    private var _summary = SweepSummary.empty
    private var _targets: [UploadTarget] = []

    var summary: SweepSummary {
        get { lock.withLock { _summary } }
        set { lock.withLock { _summary = newValue } }
    }

    var targets: [UploadTarget] { lock.withLock { _targets } }

    func run(_ target: UploadTarget, retryRejected: Bool) async -> SweepSummary {
        lock.withLock {
            _targets.append(target)
            return _summary
        }
    }
}

@MainActor
final class NoticeLog {
    var items: [UploadNotice] = []
}

/// Answers requests from a queue of scripted responses, in order.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [(Int, Data)] = []
    private var recorded: [URLRequest] = []

    func queue(_ status: Int, _ body: String) {
        lock.withLock { responses.append((status, Data(body.utf8))) }
    }

    var requests: [URLRequest] { lock.withLock { recorded } }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let next: (Int, Data)? = lock.withLock {
            recorded.append(request)
            return responses.isEmpty ? nil : responses.removeFirst()
        }
        let (status, body) = try XCTUnwrap(next, "unexpected request \(request.url?.absoluteString ?? "")")
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil))
        return (body, response)
    }
}

extension SweepSummary {
    static let empty = SweepSummary(
        uploaded: 0, duplicate: 0, rejected: 0, rejectedOnUpload: 0,
        skippedUnsettled: 0, skippedIdentityChanged: 0, errors: 0,
        rejectedFileNames: [], contractVersion: nil, standingProblem: nil
    )

    func with(uploaded: Int) -> SweepSummary {
        var copy = self
        copy.uploaded = uploaded
        return copy
    }

    func with(problem: SweepProblem) -> SweepSummary {
        var copy = self
        copy.standingProblem = problem
        return copy
    }
}
