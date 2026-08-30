import XCTest
@testable import BeeBox

@MainActor
final class ScreenAwakeTests: XCTestCase {
    /// Records every write the hold makes, so a test can assert both the value
    /// and that the flag is written only on the edges — a hold that rewrote the
    /// system flag on every state change would be harmless but would hide a
    /// leak behind the noise.
    private func recordingHold() -> (ScreenAwakeHold, () -> [Bool]) {
        var writes: [Bool] = []
        let hold = ScreenAwakeHold { writes.append($0) }
        return (hold, { writes })
    }

    func testHoldsWhileAnyReasonIsActiveAndReleasesWhenTheLastOneEnds() {
        let (hold, writes) = recordingHold()

        hold.set(.voiceTurn, active: true)
        hold.set(.speechPlayback, active: true)
        XCTAssertTrue(hold.isHeld)

        hold.set(.voiceTurn, active: false)
        XCTAssertTrue(hold.isHeld, "speech is still playing")

        hold.set(.speechPlayback, active: false)
        XCTAssertFalse(hold.isHeld)
        XCTAssertEqual(writes(), [true, false], "the flag is written only on the edges")
    }

    func testReleasingAReasonThatWasNeverHeldDoesNotWriteTheFlag() {
        let (hold, writes) = recordingHold()

        hold.set(.captureRecording, active: false)

        XCTAssertFalse(hold.isHeld)
        XCTAssertEqual(writes(), [])
    }

    func testOneSurfaceReleasingLeavesAnotherSurfacesHoldStanding() {
        // The composer and native capture are on screen together; capture
        // dismissing must not unlock a phone whose microphone is still open.
        let (hold, writes) = recordingHold()

        hold.set(.voiceTurn, active: true)
        hold.set(.captureRecording, active: true)
        hold.set(.captureRecording, active: false)

        XCTAssertEqual(hold.heldReasons, [.voiceTurn])
        XCTAssertEqual(writes(), [true])
    }

    func testRepeatedActivationOfTheSameReasonStaysOneHold() {
        let (hold, writes) = recordingHold()

        hold.set(.voiceTurn, active: true)
        hold.set(.voiceTurn, active: true)
        hold.set(.voiceTurn, active: false)

        XCTAssertFalse(hold.isHeld, "a re-derived reason must not need two releases")
        XCTAssertEqual(writes(), [true, false])
    }

    func testStateReportsOnlyAggregateTransitions() {
        var state = ScreenAwakeState()

        XCTAssertTrue(state.set(.voiceTurn, active: true))
        XCTAssertFalse(state.set(.speechPlayback, active: true))
        XCTAssertFalse(state.set(.voiceTurn, active: false))
        XCTAssertTrue(state.set(.speechPlayback, active: false))
    }
}
