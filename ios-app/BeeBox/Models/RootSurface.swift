import Foundation

/// What the person sees for the selected box: nothing yet, the native box
/// screen, or the web app.
enum RootSurface: Equatable, Sendable {
    /// Only the background. The launch rule has not run because the box's
    /// pending chat messages have not been restored yet.
    case undecided
    case boxScreen
    case web
}

/// The root's two pieces of surface state. `webMounted` says whether
/// `ChatWebView` exists; it can stay true behind the box screen so that
/// returning to the web app is immediate.
struct RootSurfaceState: Equatable, Sendable {
    var surface: RootSurface
    var webMounted: Bool

    /// A cold launch: no web view is created and nothing loads.
    static let launching = RootSurfaceState(surface: .undecided, webMounted: false)
}

enum RootSurfaceEvent: Equatable, Sendable {
    /// The selected box's pending-emission restore returned, after a cold
    /// launch or a box switch.
    case restoreCompleted(hasPendingEmissions: Bool)
    /// The app came back to the foreground. `webContentAlive` is false when
    /// the web content process ended while the app was in the background.
    case returnedToForeground(backgroundedFor: TimeInterval, webContentAlive: Bool, hasPendingEmissions: Bool)
    case notificationTap
    /// A recent chat, a box-wide page, or "All chats" on the box screen.
    case openWeb
    /// The web app's navigation to `/<box>/box`.
    case openBoxScreen
    case boxSwitched
    /// The web content process ended while the app was in the foreground.
    case webContentTerminated
}

enum RootSurfaceRule {
    /// A return from the background after this long shows the box screen.
    static let boxScreenReturnInterval: TimeInterval = 30 * 60

    /// The launch rule.
    ///
    /// A notification tap goes to the web app. A cold launch, a return after
    /// `boxScreenReturnInterval`, or a return after the web content process
    /// ended shows the box screen, unless the box has pending chat messages:
    /// those are delivered only through a mounted web view, so they open the
    /// web app. Any other return answers nil: stay where it was. A
    /// `hasPendingEmissions` of nil means the restore has not returned, and the
    /// answer is `.undecided` until it does.
    static func initialSurface(
        coldLaunch: Bool,
        backgroundedFor: TimeInterval?,
        webContentAlive: Bool,
        notificationTap: Bool,
        hasPendingEmissions: Bool?
    ) -> RootSurface? {
        if notificationTap {
            return .web
        }
        let returnedLong = backgroundedFor.map { $0 >= boxScreenReturnInterval } ?? false
        guard coldLaunch || returnedLong || webContentAlive == false else {
            return nil
        }
        guard let hasPendingEmissions else {
            return .undecided
        }
        return hasPendingEmissions ? .web : .boxScreen
    }

    static func transition(_ state: RootSurfaceState, on event: RootSurfaceEvent) -> RootSurfaceState {
        switch event {
        case .restoreCompleted(let hasPendingEmissions):
            // The rule runs once per launch or switch. A notification tap that
            // arrived first has already decided.
            guard state.surface == .undecided else {
                return state
            }
            // A box switch starts the box afresh, as a cold launch does.
            let surface = initialSurface(
                coldLaunch: true,
                backgroundedFor: nil,
                webContentAlive: true,
                notificationTap: false,
                hasPendingEmissions: hasPendingEmissions
            ) ?? state.surface
            return RootSurfaceState(surface: surface, webMounted: state.webMounted || surface == .web)
        case .returnedToForeground(let backgroundedFor, let webContentAlive, let hasPendingEmissions):
            guard let surface = initialSurface(
                coldLaunch: false,
                backgroundedFor: backgroundedFor,
                webContentAlive: webContentAlive,
                notificationTap: false,
                hasPendingEmissions: hasPendingEmissions
            ) else {
                return state
            }
            // The long return or the dead process unmounts the web view unless
            // pending chat messages need it. A dead one on screen reloads itself.
            return RootSurfaceState(surface: surface, webMounted: surface == .web)
        case .notificationTap, .openWeb:
            // `webMounted` turns true with `.web`, because `ChatWebView` must
            // exist to consume the navigation request that follows.
            return RootSurfaceState(surface: .web, webMounted: true)
        case .openBoxScreen:
            return RootSurfaceState(surface: .boxScreen, webMounted: state.webMounted)
        case .boxSwitched:
            return .launching
        case .webContentTerminated:
            // On screen, `ChatWebView` reloads itself. Hidden behind the box
            // screen, it is dropped and recreated by the next move to `.web`.
            guard state.surface != .web else {
                return state
            }
            return RootSurfaceState(surface: state.surface, webMounted: false)
        }
    }
}
