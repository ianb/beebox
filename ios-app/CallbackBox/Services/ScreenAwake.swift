import UIKit

/// Why the screen is being held awake.
///
/// iOS sleeps the display on a system idle timer that only user interaction
/// resets. A foreground app that is *listening* has no interaction to offer —
/// an open microphone with a silent room looks exactly like an abandoned phone
/// — and when the screen locks the app is suspended, so the recording it was
/// holding dies. Each case below is a state where that outcome is a bug rather
/// than the user's intent.
enum ScreenAwakeReason: String, CaseIterable, Sendable {
    /// A composer voice turn: the microphone is open or opening, or it is
    /// closed only because the box is speaking and will reopen when it stops.
    /// One reason for the whole turn, because the gaps inside a turn — the
    /// pause for speech, the reply streaming in before the speech starts — are
    /// exactly when nobody is touching the screen.
    case voiceTurn
    /// The page is speaking. Without a background-audio mode a screen lock
    /// suspends the app, which cuts the utterance off mid-sentence.
    case speechPlayback
    /// Native capture is recording audio — the same open-microphone break on a
    /// different surface.
    case captureRecording
}

/// Pure core: which reasons are held, and whether the aggregate flipped.
///
/// Separated from the `UIApplication` write so the policy is testable without a
/// running app, and so exactly one place decides what the flag should be.
struct ScreenAwakeState: Equatable {
    private(set) var reasons: Set<ScreenAwakeReason> = []

    var isHeld: Bool {
        reasons.isEmpty == false
    }

    /// Returns whether `isHeld` changed, so the caller writes the system flag
    /// only on the edges.
    mutating func set(_ reason: ScreenAwakeReason, active: Bool) -> Bool {
        let wasHeld = isHeld
        if active {
            reasons.insert(reason)
        } else {
            reasons.remove(reason)
        }
        return isHeld != wasHeld
    }

}

/// The single writer of `UIApplication.shared.isIdleTimerDisabled`.
///
/// A leaked hold is a phone that never sleeps, which is worse than the bug it
/// fixes, so every driver states its reason as a *derived* condition —
/// recomputed from current state rather than incremented and decremented — and
/// each one folds `scenePhase == .active` into that condition. Backgrounding
/// therefore releases by the same path as the microphone closing; there is no
/// separate teardown to forget. A surface releases its own reasons when it
/// disappears and never the whole set — the composer and native capture are on
/// screen at the same time, and one tearing down must not unlock the other.
@MainActor
final class ScreenAwakeHold {
    static let shared = ScreenAwakeHold()

    private var state = ScreenAwakeState()
    private let apply: @MainActor (Bool) -> Void

    /// `apply` is injectable so tests can drive the policy without touching the
    /// shared `UIApplication`.
    init(apply: @escaping @MainActor (Bool) -> Void = { UIApplication.shared.isIdleTimerDisabled = $0 }) {
        self.apply = apply
    }

    var isHeld: Bool {
        state.isHeld
    }

    var heldReasons: Set<ScreenAwakeReason> {
        state.reasons
    }

    func set(_ reason: ScreenAwakeReason, active: Bool) {
        guard state.set(reason, active: active) else {
            return
        }
        apply(state.isHeld)
    }
}
