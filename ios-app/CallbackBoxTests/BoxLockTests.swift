import XCTest
import LocalAuthentication
@testable import CallbackBox

final class PairedBoxLockPreferenceTests: XCTestCase {
    func testLegacyJSONDefaultsToUnlockedWithoutDroppingFields() throws {
        let id = UUID()
        let json = """
        {
          "id": "\(id.uuidString)",
          "label": "Legacy",
          "baseURL": "https://example.test/box",
          "sessionID": "session-1",
          "authToken": "secret"
        }
        """

        let box = try JSONDecoder().decode(PairedBox.self, from: Data(json.utf8))

        XCTAssertEqual(box.id, id)
        XCTAssertEqual(box.label, "Legacy")
        XCTAssertEqual(box.sessionID, "session-1")
        XCTAssertEqual(box.authToken, "secret")
        XCTAssertFalse(box.requiresDeviceUnlock)
    }

    func testRoundTripAndSessionReplacementPreserveLock() throws {
        let box = makeBox(requiresDeviceUnlock: true)
        let decoded = try JSONDecoder().decode(PairedBox.self, from: JSONEncoder().encode(box))

        XCTAssertEqual(decoded, box)
        XCTAssertTrue(box.withSessionID("new-session").requiresDeviceUnlock)
    }

    @MainActor
    func testStorePersistsLockMutation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storageURL = root.appendingPathComponent("paired-boxes.json")
        let store = PairedBoxStore(storageURL: storageURL)
        store.addManualBox(label: "Test", baseURL: URL(string: "https://example.test/box")!, sessionID: nil)
        let box = try XCTUnwrap(store.selectedBox)

        store.setRequiresDeviceUnlock(true, for: box)

        XCTAssertTrue(try XCTUnwrap(store.selectedBox).requiresDeviceUnlock)
        XCTAssertTrue(try XCTUnwrap(PairedBoxStore(storageURL: storageURL).selectedBox).requiresDeviceUnlock)
    }
}

@MainActor
final class BoxLockManagerTests: XCTestCase {
    func testProtectedBoxStartsLockedAndSuccessfulAttemptUnlocksIt() async {
        let authenticator = FakeDeviceAuthenticator(results: [.authenticated])
        let manager = BoxLockManager(authenticator: authenticator)
        let box = makeBox(requiresDeviceUnlock: true)

        XCTAssertTrue(manager.isLocked(box))
        manager.unlock(box)
        await authenticator.waitForCalls(1)
        await Task.yield()

        XCTAssertFalse(manager.isLocked(box))
        XCTAssertEqual(authenticator.reasons, ["Unlock this box."])
    }

    func testCancellationFailureAndPasscodeNotSetRemainLocked() async {
        for (result, expectedStatus) in [
            (DeviceAuthenticationResult.cancelled, BoxLockStatus.locked),
            (.failed, .failed),
            (.passcodeNotSet, .passcodeNotSet),
        ] {
            let authenticator = FakeDeviceAuthenticator(results: [result])
            let manager = BoxLockManager(authenticator: authenticator)
            let box = makeBox(requiresDeviceUnlock: true)
            manager.unlock(box)
            await authenticator.waitForCalls(1)
            await Task.yield()

            XCTAssertTrue(manager.isLocked(box))
            XCTAssertEqual(manager.status, expectedStatus)
        }
    }

    func testOnlyPasscodeNotSetCanOpenWithoutAuthentication() async {
        let box = makeBox(requiresDeviceUnlock: true)
        let failedAuthenticator = FakeDeviceAuthenticator(results: [.failed])
        let failedManager = BoxLockManager(authenticator: failedAuthenticator)
        failedManager.unlock(box)
        await failedAuthenticator.waitForCalls(1)
        await Task.yield()
        failedManager.openWithoutPasscode(box)
        XCTAssertTrue(failedManager.isLocked(box))

        let unavailableAuthenticator = FakeDeviceAuthenticator(results: [.passcodeNotSet])
        let unavailableManager = BoxLockManager(authenticator: unavailableAuthenticator)
        unavailableManager.unlock(box)
        await unavailableAuthenticator.waitForCalls(1)
        await Task.yield()
        unavailableManager.openWithoutPasscode(box)
        XCTAssertFalse(unavailableManager.isLocked(box))
    }

    func testRelockIgnoresLateSuccess() async {
        let authenticator = FakeDeviceAuthenticator()
        let manager = BoxLockManager(authenticator: authenticator)
        let box = makeBox(requiresDeviceUnlock: true)
        manager.unlock(box)
        await authenticator.waitForCalls(1)

        manager.relock()
        authenticator.resolveFirst(.authenticated)
        await Task.yield()

        XCTAssertTrue(manager.isLocked(box))
        XCTAssertGreaterThanOrEqual(authenticator.cancelCount, 2)
    }

    func testNewAttemptIgnoresEarlierCompletion() async {
        let authenticator = FakeDeviceAuthenticator()
        let manager = BoxLockManager(authenticator: authenticator)
        let firstBox = makeBox(requiresDeviceUnlock: true)
        let secondBox = makeBox(requiresDeviceUnlock: true)
        manager.unlock(firstBox)
        await authenticator.waitForCalls(1)
        manager.unlock(secondBox)
        await authenticator.waitForCalls(2)

        authenticator.resolve(at: 0, with: .authenticated)
        await Task.yield()
        XCTAssertTrue(manager.isLocked(firstBox))
        XCTAssertTrue(manager.isLocked(secondBox))

        authenticator.resolve(at: 1, with: .authenticated)
        await Task.yield()
        XCTAssertFalse(manager.isLocked(secondBox))
    }

    func testLockRemovalAlwaysPerformsIndependentAuthentication() async {
        let authenticator = FakeDeviceAuthenticator(results: [.authenticated, .cancelled])
        let manager = BoxLockManager(authenticator: authenticator)
        let box = makeBox(requiresDeviceUnlock: true)
        manager.unlock(box)
        await authenticator.waitForCalls(1)
        await Task.yield()
        XCTAssertFalse(manager.isLocked(box))

        let removal = await manager.authenticateForLockRemoval()

        XCTAssertEqual(removal, .cancelled)
        XCTAssertEqual(authenticator.reasons, ["Unlock this box.", "Turn off the lock for this box."])
    }

    func testLocalAuthenticationErrorMappingOnlyBypassesMissingPasscode() {
        let missing = NSError(domain: LAError.errorDomain, code: LAError.Code.passcodeNotSet.rawValue)
        let cancelled = NSError(domain: LAError.errorDomain, code: LAError.Code.userCancel.rawValue)
        let unavailable = NSError(domain: LAError.errorDomain, code: LAError.Code.biometryNotAvailable.rawValue)

        XCTAssertEqual(LocalDeviceAuthenticator.result(for: missing), .passcodeNotSet)
        XCTAssertEqual(LocalDeviceAuthenticator.result(for: cancelled), .cancelled)
        XCTAssertEqual(LocalDeviceAuthenticator.result(for: unavailable), .failed)
        XCTAssertEqual(LocalDeviceAuthenticator.result(for: URLError(.unknown)), .failed)
    }
}

private func makeBox(requiresDeviceUnlock: Bool) -> PairedBox {
    PairedBox(
        id: UUID(),
        label: "Test",
        baseURL: URL(string: "https://example.test/box")!,
        sessionID: nil,
        authToken: nil,
        requiresDeviceUnlock: requiresDeviceUnlock
    )
}

@MainActor
private final class FakeDeviceAuthenticator: DeviceAuthenticating {
    private var results: [DeviceAuthenticationResult]
    private var continuations: [CheckedContinuation<DeviceAuthenticationResult, Never>?] = []
    private(set) var reasons: [String] = []
    private(set) var cancelCount = 0

    init(results: [DeviceAuthenticationResult] = []) {
        self.results = results
    }

    func authenticate(reason: String) async -> DeviceAuthenticationResult {
        reasons.append(reason)
        if results.isEmpty == false {
            return results.removeFirst()
        }
        return await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func cancel() {
        cancelCount += 1
    }

    func resolveFirst(_ result: DeviceAuthenticationResult) {
        resolve(at: 0, with: result)
    }

    func resolve(at index: Int, with result: DeviceAuthenticationResult) {
        guard continuations.indices.contains(index), let continuation = continuations[index] else {
            return
        }
        continuations[index] = nil
        continuation.resume(returning: result)
    }

    func waitForCalls(_ count: Int) async {
        while reasons.count < count {
            await Task.yield()
        }
    }
}
