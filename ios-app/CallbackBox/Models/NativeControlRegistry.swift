import SwiftUI

/// What the native shell can tell an agent about its own controls.
///
/// SwiftUI has no document to walk, so the native inventory is **declared** —
/// but declared *in the view body*, by a modifier that registers while the view
/// is on screen and deregisters when it leaves. That is what keeps it honest:
/// `NativeComposerView.trailingControl` is already a state machine that renders
/// mic *or* send *or* stop, so whichever one is currently in the body is the
/// only one in the registry, with no separate state to keep in step.
///
/// Deliberately **not** `@Published`: registration happens inside `onAppear` and
/// on geometry changes, and publishing there would invalidate the view that is
/// registering. Nothing in the UI renders from the registry — it is read on
/// demand when the web asks (`scan-controls`) and, later, when a `control:`
/// pointer needs a frame to draw a ring on.
///
/// Contract: `callback-box/docs/mobile-contract.md` §4.8. The ids come from
/// Track 4's table in `docs/plans/agent-points-at-ui.md` and are shared with the
/// web, so `control:cb-composer-mic` means the same control on both surfaces.
/// What one anchored view can be asked to do beyond being pointed at.
///
/// Held beside the entry rather than inside it because a closure is neither
/// `Equatable` nor `Codable`, and the entry is both. Presence is what makes an
/// action supported: `NativeControlEntry.actions` is derived from these, so the
/// list the agent reads and the dispatch that runs are the same fact.
struct NativeControlHandlers {
    /// Make this control the first responder. Only the composer's text field
    /// has one; everything else refuses rather than pretending.
    var focus: (() -> Void)?
    /// Present what this control opens. Only the composer's Add button has one.
    var reveal: (() -> Void)?

    var actions: [NativeControlEntry.Action] {
        var actions: [NativeControlEntry.Action] = [.point]
        if focus != nil {
            actions.append(.focus)
        }
        if reveal != nil {
            actions.append(.reveal)
        }
        return actions
    }
}

/// What happened when a `control:` pointer reached a native control.
///
/// A refusal always carries a sentence the user reads in the pointer's broken
/// treatment: the plan forbids a silent no-op here, and "nothing visibly
/// happened" is the failure the treatment exists to prevent.
enum NativeControlActionOutcome: Equatable {
    /// Draw the ring on this box, in global coordinates.
    case pointed(CGRect)
    case refused(String)
}

final class NativeControlRegistry: ObservableObject {
    /// One registration. The token is the *instance* identity: two views can
    /// legitimately carry the same `cb-` id across a state change (the mic and
    /// the send button never coexist, but SwiftUI may run the new view's
    /// `onAppear` before the old view's `onDisappear`), and matching on the
    /// token means a departing view can only ever remove its own entry.
    private struct Registration {
        var token: UUID
        var entry: NativeControlEntry
        var frame: CGRect
        var handlers: NativeControlHandlers
    }

    private var registrations: [Registration] = []

    /// Insert or refresh one anchor's registration.
    ///
    /// The handlers are re-supplied on every call because they close over the
    /// registering view's state; refreshing them with the frame is what keeps a
    /// `focus` running against the composer that is on screen now.
    func register(
        _ entry: NativeControlEntry,
        frame: CGRect,
        handlers: NativeControlHandlers = NativeControlHandlers(),
        token: UUID
    ) {
        let registration = Registration(token: token, entry: entry, frame: frame, handlers: handlers)
        if let index = registrations.firstIndex(where: { $0.token == token }) {
            registrations[index] = registration
            return
        }
        registrations.append(registration)
    }

    /// Remove the registration made under `token`, if it is still the live one.
    func unregister(token: UUID) {
        registrations.removeAll { $0.token == token }
    }

    /// The inventory, one entry per address, sorted so two scans of the same
    /// screen produce the same list regardless of the order SwiftUI ran
    /// `onAppear` in.
    ///
    /// Coalescing by id is not tidiness. During a mic → send swap both views can
    /// briefly be registered, and reporting both would tell the agent two
    /// mutually exclusive controls are on screen at once — precisely the kind of
    /// wrong-but-confident answer this feature exists to prevent. The most recent
    /// registration wins, because it is the one that just appeared.
    /// A registration whose frame the registry cannot use is reported with **no
    /// actions at all**, so the dump prints it `(not pointable)` rather than
    /// handing the agent a `control:` link that `perform` would then refuse.
    /// Listing the control is still right — it is on screen and the agent should
    /// know it exists — but promising a pointer we would not honour is the
    /// short-list-presented-as-complete failure in miniature.
    var entries: [NativeControlEntry] {
        var latest: [String: NativeControlEntry] = [:]
        for registration in registrations {
            var entry = registration.entry
            if !Self.isPointable(registration.frame) {
                entry.actions = []
            }
            latest[entry.id] = entry
        }
        return latest.values.sorted { $0.id < $1.id }
    }

    /// Whether a captured frame is a real laid-out box. A registration made
    /// before SwiftUI has laid the view out carries a zero frame, and ringing
    /// that would draw a marker where the control is not.
    private static func isPointable(_ frame: CGRect) -> Bool {
        frame.width > 0 && frame.height > 0
    }

    /// The on-screen box of one registered control, for drawing a pointer on it.
    /// Frames are captured at appear and on layout change, so a control that has
    /// moved without either is approximate — accepted (`agent-points-at-ui.md`,
    /// Track 5: the native side may work at lower fidelity than the DOM scan).
    func frame(of id: String) -> CGRect? {
        registrations.last { $0.entry.id == id }?.frame
    }

    /// Act on one control for a `control:` pointer, and say what to draw or why
    /// nothing was drawn.
    ///
    /// The refusals are the point of this method. The plan accepts that the
    /// native side works at lower fidelity than the DOM one — a declared
    /// registry rather than a walk, and `focus`/`reveal` only where they have an
    /// honest meaning — on the condition that the gaps are *stated*. So an
    /// unregistered address, a control whose frame the registry no longer
    /// believes, an action this control has no handler for, and an action asked
    /// of a control that is on screen but not operable each come back with a
    /// sentence rather than a shrug.
    func perform(_ action: NativeControlEntry.Action, on controlID: String) -> NativeControlActionOutcome {
        guard let registration = registrations.last(where: { $0.entry.id == controlID }) else {
            return .refused("The app has no control \"\(controlID)\" on screen right now.")
        }
        guard registration.entry.actions.contains(action) else {
            return .refused("\(action.rawValue) is not supported for this control on this surface (\(controlID)).")
        }
        // A frame this thin is one the registry never got a real layout for —
        // ringing it would draw a marker somewhere the control is not, which is
        // worse than saying so. `entries` reports such a control with no actions
        // for the same reason, so the two answers agree.
        guard Self.isPointable(registration.frame) else {
            return .refused("The app knows \"\(controlID)\" but not where it is on screen right now.")
        }
        if registration.entry.disabled, action != .point {
            return .refused("This control is on screen but not usable right now (\(controlID)).")
        }
        switch action {
        case .point:
            break
        case .focus:
            registration.handlers.focus?()
        case .reveal:
            registration.handlers.reveal?()
        }
        return .pointed(registration.frame)
    }
}

private struct NativeControlRegistryKey: EnvironmentKey {
    /// A live-but-empty registry, so a preview or a fixture screen that never
    /// installs one still renders — it simply reports no native controls.
    static let defaultValue = NativeControlRegistry()
}

extension EnvironmentValues {
    var nativeControlRegistry: NativeControlRegistry {
        get { self[NativeControlRegistryKey.self] }
        set { self[NativeControlRegistryKey.self] = newValue }
    }
}

/// Registers one control with the environment's registry for as long as it is on
/// screen, and gives it the matching `accessibilityIdentifier`.
///
/// Both in one modifier on purpose: the identifier is the platform's own stable
/// handle (it is what XCUITest addresses views by), the registry entry is what
/// the agent reads, and setting them from one call is what stops them drifting.
private struct ControlAnchorModifier: ViewModifier {
    let entry: NativeControlEntry
    let handlers: NativeControlHandlers
    @Environment(\.nativeControlRegistry) private var registry
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .accessibilityIdentifier(entry.id)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear {
                            registry.register(entry, frame: proxy.frame(in: .global), handlers: handlers, token: token)
                        }
                        .onChange(of: entry) { _, updated in
                            registry.register(updated, frame: proxy.frame(in: .global), handlers: handlers, token: token)
                        }
                        .onChange(of: proxy.frame(in: .global)) { _, frame in
                            registry.register(entry, frame: frame, handlers: handlers, token: token)
                        }
                        .onDisappear {
                            registry.unregister(token: token)
                        }
                }
            )
    }
}

extension View {
    /// Declare this view as an addressable native control.
    ///
    /// - Parameters:
    ///   - id: the shared `cb-` address from Track 4's table.
    ///   - role: the ARIA role vocabulary, so the dump reads alike on both surfaces.
    ///   - label: the control's accessible label — pass the same string the view's
    ///     `accessibilityLabel` uses, and read it live so a state-dependent
    ///     control reports what it means right now.
    ///   - does: the author-written "what it does", for controls whose behaviour a
    ///     label cannot convey (a disclosure trigger, or the mic's tap-versus-hold).
    ///   - container: the native surface this control sits in; the dump groups by it.
    ///   - disabled: on screen but not operable. Passed explicitly because
    ///     SwiftUI's `.disabled()` state cannot be read back out of a view.
    ///   - onFocus: what "focus this" means for this control, or nil where it
    ///     means nothing — the composer's text field has a first responder to
    ///     make; a button does not, and pretending otherwise is the silent
    ///     no-op the plan forbids.
    ///   - onReveal: what "show me what this opens" means, or nil. Present only
    ///     on a control that presents a sheet, and it opens that sheet — it
    ///     never operates the control on the user's behalf.
    func controlAnchor(
        _ id: String,
        role: NativeControlEntry.Role = .button,
        label: String,
        does: String? = nil,
        container: String = NativeControlSurface.composer,
        disabled: Bool = false,
        onFocus: (() -> Void)? = nil,
        onReveal: (() -> Void)? = nil
    ) -> some View {
        let handlers = NativeControlHandlers(focus: onFocus, reveal: onReveal)
        return modifier(ControlAnchorModifier(
            entry: NativeControlEntry(
                id: id,
                role: role,
                label: label,
                does: does,
                container: container,
                disabled: disabled,
                actions: handlers.actions
            ),
            handlers: handlers
        ))
    }
}

/// The native surfaces controls are grouped under in the dump. One constant per
/// surface rather than a literal at each call site, because the string is a
/// group heading the agent reads and a typo would split one surface into two.
enum NativeControlSurface {
    static let composer = "Composer"
}
