import BeeBoxMacCore
import XCTest

final class HostingPreferenceTests: XCTestCase {
    func testOffForANewInstall() {
        XCTAssertFalse(HostingPreference.resolve(stored: nil, existingBoxFolder: false))
    }

    func testOnForAnInstallThatAlreadyHasABox() {
        XCTAssertTrue(HostingPreference.resolve(stored: nil, existingBoxFolder: true))
    }

    func testTheBoxholdersChoiceWins() {
        XCTAssertFalse(HostingPreference.resolve(stored: false, existingBoxFolder: true))
        XCTAssertTrue(HostingPreference.resolve(stored: true, existingBoxFolder: false))
    }

    func testReadAndWriteRoundTrip() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "beebox-mac-tests-\(UUID().uuidString)"))
        XCTAssertFalse(HostingPreference.read(defaults, existingBoxFolder: false))
        HostingPreference.write(true, to: defaults)
        XCTAssertTrue(HostingPreference.read(defaults, existingBoxFolder: false))
    }
}
