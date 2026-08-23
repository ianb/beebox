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
    }

    private var registrations: [Registration] = []

    /// Insert or refresh one anchor's registration.
    func register(_ entry: NativeControlEntry, frame: CGRect, token: UUID) {
        if let index = registrations.firstIndex(where: { $0.token == token }) {
            registrations[index] = Registration(token: token, entry: entry, frame: frame)
            return
        }
        registrations.append(Registration(token: token, entry: entry, frame: frame))
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
    var entries: [NativeControlEntry] {
        var latest: [String: NativeControlEntry] = [:]
        for registration in registrations {
            latest[registration.entry.id] = registration.entry
        }
        return latest.values.sorted { $0.id < $1.id }
    }

    /// The on-screen box of one registered control, for drawing a pointer on it.
    /// Frames are captured at appear and on layout change, so a control that has
    /// moved without either is approximate — accepted (`agent-points-at-ui.md`,
    /// Track 5: the native side may work at lower fidelity than the DOM scan).
    func frame(of id: String) -> CGRect? {
        registrations.last { $0.entry.id == id }?.frame
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
    @Environment(\.nativeControlRegistry) private var registry
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .accessibilityIdentifier(entry.id)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear {
                            registry.register(entry, frame: proxy.frame(in: .global), token: token)
                        }
                        .onChange(of: entry) { _, updated in
                            registry.register(updated, frame: proxy.frame(in: .global), token: token)
                        }
                        .onChange(of: proxy.frame(in: .global)) { _, frame in
                            registry.register(entry, frame: frame, token: token)
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
    func controlAnchor(
        _ id: String,
        role: NativeControlEntry.Role = .button,
        label: String,
        does: String? = nil,
        container: String = NativeControlSurface.composer,
        disabled: Bool = false
    ) -> some View {
        modifier(ControlAnchorModifier(entry: NativeControlEntry(
            id: id,
            role: role,
            label: label,
            does: does,
            container: container,
            disabled: disabled
        )))
    }
}

/// The native surfaces controls are grouped under in the dump. One constant per
/// surface rather than a literal at each call site, because the string is a
/// group heading the agent reads and a typo would split one surface into two.
enum NativeControlSurface {
    static let composer = "Composer"
}
