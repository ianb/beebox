import XCTest
@testable import BeeBox

@MainActor
final class BackgroundExecutionHoldTests: XCTestCase {
    func testEndsExactlyOnce() {
        let application = FakeBackgroundTaskApplication()
        let hold = BackgroundExecutionHold(application: application)

        XCTAssertTrue(hold.begin(name: "test"))
        XCTAssertTrue(hold.wasAcquired)
        hold.end()
        hold.end()

        XCTAssertEqual(application.beginNames, ["test"])
        XCTAssertEqual(application.endedIdentifiers, [application.nextIdentifier])
    }

    func testRecordsExpirationBeforeCallingOwner() {
        let application = FakeBackgroundTaskApplication()
        var ownerSawExpiration = false
        let hold = BackgroundExecutionHold(application: application)

        XCTAssertTrue(hold.begin(name: "test") {
            ownerSawExpiration = hold.expired
        })
        application.expire()

        XCTAssertTrue(hold.expired)
        XCTAssertTrue(ownerSawExpiration)
        XCTAssertEqual(application.endedIdentifiers, [application.nextIdentifier])
    }

    func testReportsDeclinedAcquisition() {
        let application = FakeBackgroundTaskApplication()
        application.nextIdentifier = .invalid
        let hold = BackgroundExecutionHold(application: application)

        XCTAssertFalse(hold.begin(name: "test"))
        XCTAssertFalse(hold.wasAcquired)
        hold.end()

        XCTAssertTrue(application.endedIdentifiers.isEmpty)
    }

    func testReleasesOnDeallocation() {
        let application = FakeBackgroundTaskApplication()
        var hold: BackgroundExecutionHold? = BackgroundExecutionHold(application: application)
        XCTAssertTrue(hold?.begin(name: "test") == true)

        hold = nil

        XCTAssertEqual(application.endedIdentifiers, [application.nextIdentifier])
    }
}

@MainActor
private final class FakeBackgroundTaskApplication: BackgroundTaskApplication {
    var applicationState: UIApplication.State = .active
    var nextIdentifier = UIBackgroundTaskIdentifier(rawValue: 41)
    private(set) var beginNames: [String?] = []
    private(set) var endedIdentifiers: [UIBackgroundTaskIdentifier] = []
    private var expirationHandler: (() -> Void)?

    func beginBackgroundTask(
        withName taskName: String?,
        expirationHandler handler: (@Sendable () -> Void)?
    ) -> UIBackgroundTaskIdentifier {
        beginNames.append(taskName)
        expirationHandler = handler
        return nextIdentifier
    }

    func endBackgroundTask(_ identifier: UIBackgroundTaskIdentifier) {
        endedIdentifiers.append(identifier)
    }

    func expire() {
        expirationHandler?()
    }
}
