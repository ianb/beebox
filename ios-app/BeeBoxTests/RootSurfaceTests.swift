import XCTest
@testable import BeeBox

final class RootSurfaceRuleTests: XCTestCase {
    private let minute: TimeInterval = 60

    private func rule(
        coldLaunch: Bool = false,
        backgroundedFor: TimeInterval? = nil,
        webContentAlive: Bool = true,
        notificationTap: Bool = false,
        hasPendingEmissions: Bool? = false
    ) -> RootSurface? {
        RootSurfaceRule.initialSurface(
            coldLaunch: coldLaunch,
            backgroundedFor: backgroundedFor,
            webContentAlive: webContentAlive,
            notificationTap: notificationTap,
            hasPendingEmissions: hasPendingEmissions
        )
    }

    // MARK: initialSurface, one input at a time

    func testColdLaunchShowsTheBoxScreen() {
        XCTAssertEqual(rule(coldLaunch: true), .boxScreen)
    }

    func testAShortReturnStaysWhereItWas() {
        XCTAssertNil(rule(backgroundedFor: 29 * minute))
        XCTAssertNil(rule(backgroundedFor: 0))
    }

    func testAReturnAfterThirtyMinutesShowsTheBoxScreen() {
        XCTAssertEqual(rule(backgroundedFor: 30 * minute), .boxScreen)
        XCTAssertEqual(rule(backgroundedFor: 8 * 60 * minute), .boxScreen)
    }

    func testAReturnAfterTheWebContentProcessEndedShowsTheBoxScreen() {
        XCTAssertEqual(rule(backgroundedFor: 1 * minute, webContentAlive: false), .boxScreen)
    }

    func testANotificationTapGoesToTheWebWhateverElseIsTrue() {
        XCTAssertEqual(rule(coldLaunch: true, notificationTap: true), .web)
        XCTAssertEqual(rule(backgroundedFor: 60 * minute, notificationTap: true), .web)
        XCTAssertEqual(rule(notificationTap: true, hasPendingEmissions: nil), .web, "a tap need not wait for the restore")
    }

    func testPendingChatMessagesOpenTheWeb() {
        XCTAssertEqual(rule(coldLaunch: true, hasPendingEmissions: true), .web)
        XCTAssertEqual(rule(backgroundedFor: 45 * minute, hasPendingEmissions: true), .web)
        XCTAssertEqual(rule(backgroundedFor: 1 * minute, webContentAlive: false, hasPendingEmissions: true), .web)
    }

    func testPendingChatMessagesDoNotMoveAShortReturn() {
        XCTAssertNil(rule(backgroundedFor: 5 * minute, hasPendingEmissions: true))
    }

    func testTheRuleWaitsForTheRestore() {
        XCTAssertEqual(rule(coldLaunch: true, hasPendingEmissions: nil), .undecided)
        XCTAssertEqual(rule(backgroundedFor: 30 * minute, hasPendingEmissions: nil), .undecided)
    }

    // MARK: transitions, one per root-state bullet

    private func apply(_ events: [RootSurfaceEvent], from state: RootSurfaceState = .launching) -> RootSurfaceState {
        events.reduce(state) { RootSurfaceRule.transition($0, on: $1) }
    }

    func testColdLaunchIsUndecidedWithNoWebView() {
        XCTAssertEqual(RootSurfaceState.launching, RootSurfaceState(surface: .undecided, webMounted: false))
    }

    func testTheRestoreDecidesTheColdLaunchWithoutMountingTheWeb() {
        XCTAssertEqual(
            apply([.restoreCompleted(hasPendingEmissions: false)]),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
    }

    func testTheRestoreWithPendingMessagesMountsTheWeb() {
        XCTAssertEqual(
            apply([.restoreCompleted(hasPendingEmissions: true)]),
            RootSurfaceState(surface: .web, webMounted: true)
        )
    }

    func testTheRuleRunsOnce() {
        let state = apply([
            .restoreCompleted(hasPendingEmissions: false),
            .openWeb,
            .restoreCompleted(hasPendingEmissions: false),
        ])
        XCTAssertEqual(state, RootSurfaceState(surface: .web, webMounted: true))
    }

    func testFirstMoveToTheWebMountsIt() {
        let boxScreen = apply([.restoreCompleted(hasPendingEmissions: false)])
        XCTAssertEqual(
            RootSurfaceRule.transition(boxScreen, on: .openWeb),
            RootSurfaceState(surface: .web, webMounted: true)
        )
    }

    func testANotificationTapMountsTheWebBeforeTheRestoreReturns() {
        let state = apply([.notificationTap, .restoreCompleted(hasPendingEmissions: false)])
        XCTAssertEqual(state, RootSurfaceState(surface: .web, webMounted: true), "the late restore does not override the tap")
    }

    func testBackToTheBoxScreenKeepsTheWebMounted() {
        let state = apply([.restoreCompleted(hasPendingEmissions: false), .openWeb, .openBoxScreen])
        XCTAssertEqual(state, RootSurfaceState(surface: .boxScreen, webMounted: true))
        XCTAssertEqual(
            RootSurfaceRule.transition(state, on: .openWeb),
            RootSurfaceState(surface: .web, webMounted: true)
        )
    }

    func testAShortReturnChangesNothing() {
        let onWeb = RootSurfaceState(surface: .web, webMounted: true)
        let behind = RootSurfaceState(surface: .boxScreen, webMounted: true)
        let event = RootSurfaceEvent.returnedToForeground(
            backgroundedFor: 10 * minute,
            webContentAlive: true,
            hasPendingEmissions: false
        )
        XCTAssertEqual(RootSurfaceRule.transition(onWeb, on: event), onWeb)
        XCTAssertEqual(RootSurfaceRule.transition(behind, on: event), behind)
    }

    func testTheThirtyMinuteReturnUnmountsTheWeb() {
        let event = RootSurfaceEvent.returnedToForeground(
            backgroundedFor: 31 * minute,
            webContentAlive: true,
            hasPendingEmissions: false
        )
        XCTAssertEqual(
            RootSurfaceRule.transition(RootSurfaceState(surface: .web, webMounted: true), on: event),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
        XCTAssertEqual(
            RootSurfaceRule.transition(RootSurfaceState(surface: .boxScreen, webMounted: true), on: event),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
    }

    func testAReturnAfterTheProcessEndedUnmountsTheWeb() {
        let event = RootSurfaceEvent.returnedToForeground(
            backgroundedFor: 2 * minute,
            webContentAlive: false,
            hasPendingEmissions: false
        )
        XCTAssertEqual(
            RootSurfaceRule.transition(RootSurfaceState(surface: .web, webMounted: true), on: event),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
    }

    func testALongReturnWithPendingMessagesKeepsTheWeb() {
        let event = RootSurfaceEvent.returnedToForeground(
            backgroundedFor: 31 * minute,
            webContentAlive: false,
            hasPendingEmissions: true
        )
        XCTAssertEqual(
            RootSurfaceRule.transition(RootSurfaceState(surface: .boxScreen, webMounted: false), on: event),
            RootSurfaceState(surface: .web, webMounted: true)
        )
    }

    func testABoxSwitchUnmountsTheWebAndWaitsForTheNewBoxsRestore() {
        let state = apply([.restoreCompleted(hasPendingEmissions: false), .openWeb, .boxSwitched])
        XCTAssertEqual(state, .launching)
        XCTAssertEqual(
            RootSurfaceRule.transition(state, on: .restoreCompleted(hasPendingEmissions: false)),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
    }

    func testTheProcessEndingBehindTheBoxScreenUnmountsTheWeb() {
        let behind = RootSurfaceState(surface: .boxScreen, webMounted: true)
        XCTAssertEqual(
            RootSurfaceRule.transition(behind, on: .webContentTerminated),
            RootSurfaceState(surface: .boxScreen, webMounted: false)
        )
    }

    func testTheProcessEndingOnScreenLeavesTheReloadingWebMounted() {
        let onWeb = RootSurfaceState(surface: .web, webMounted: true)
        XCTAssertEqual(RootSurfaceRule.transition(onWeb, on: .webContentTerminated), onWeb)
    }

    func testTheWebSurfaceAlwaysHasAMountedWebView() {
        let events: [RootSurfaceEvent] = [
            .restoreCompleted(hasPendingEmissions: false),
            .restoreCompleted(hasPendingEmissions: true),
            .returnedToForeground(backgroundedFor: 1 * minute, webContentAlive: true, hasPendingEmissions: false),
            .returnedToForeground(backgroundedFor: 31 * minute, webContentAlive: false, hasPendingEmissions: true),
            .returnedToForeground(backgroundedFor: 31 * minute, webContentAlive: true, hasPendingEmissions: false),
            .notificationTap, .openWeb, .openBoxScreen, .boxSwitched, .webContentTerminated,
        ]
        let surfaces: [RootSurface] = [.undecided, .boxScreen, .web]
        for surface in surfaces {
            for webMounted in [false, true] where surface != .web || webMounted {
                for event in events {
                    let next = RootSurfaceRule.transition(RootSurfaceState(surface: surface, webMounted: webMounted), on: event)
                    XCTAssertTrue(next.surface != .web || next.webMounted, "\(surface) \(webMounted) \(event)")
                }
            }
        }
    }

    // MARK: a notification tap and the pending foreground decision

    /// RootView's order of operations: each event updates the pending stay,
    /// then the surface; the scene becoming active turns the stay into its
    /// foreground event.
    private struct Lifecycle {
        var state: RootSurfaceState
        var stay: BackgroundStay?

        mutating func apply(_ event: RootSurfaceEvent) {
            stay = RootSurfaceRule.pendingStay(stay, after: event)
            state = RootSurfaceRule.transition(state, on: event)
        }

        mutating func becomeActive(at now: Date) {
            if let event = RootSurfaceRule.foregroundEvent(for: stay, now: now, hasPendingEmissions: false) {
                apply(event)
            }
        }
    }

    private let backgrounded = Date(timeIntervalSince1970: 1_000_000)

    func testATapBeforeTheForegroundEventAfterALongStayStaysOnTheWeb() {
        for start in [RootSurfaceState(surface: .web, webMounted: true), RootSurfaceState(surface: .boxScreen, webMounted: false)] {
            var lifecycle = Lifecycle(state: start, stay: BackgroundStay(since: backgrounded))
            lifecycle.apply(.notificationTap)
            lifecycle.becomeActive(at: backgrounded.addingTimeInterval(31 * minute))
            XCTAssertEqual(lifecycle.state, RootSurfaceState(surface: .web, webMounted: true), "from \(start)")
            XCTAssertNil(lifecycle.stay)
        }
    }

    func testAForegroundEventBeforeTheTapShowsTheBoxScreenThenTheTapOpensTheWeb() {
        var lifecycle = Lifecycle(state: RootSurfaceState(surface: .web, webMounted: true), stay: BackgroundStay(since: backgrounded))
        lifecycle.becomeActive(at: backgrounded.addingTimeInterval(31 * minute))
        XCTAssertEqual(lifecycle.state, RootSurfaceState(surface: .boxScreen, webMounted: false))
        lifecycle.apply(.notificationTap)
        XCTAssertEqual(lifecycle.state, RootSurfaceState(surface: .web, webMounted: true))
    }

    func testTheStayRecordsAWebContentProcessThatEnded() {
        var stay = BackgroundStay(since: backgrounded)
        stay.webContentEnded = true
        XCTAssertEqual(
            RootSurfaceRule.foregroundEvent(for: stay, now: backgrounded.addingTimeInterval(minute), hasPendingEmissions: false),
            .returnedToForeground(backgroundedFor: minute, webContentAlive: false, hasPendingEmissions: false)
        )
        XCTAssertNil(RootSurfaceRule.foregroundEvent(for: nil, now: backgrounded, hasPendingEmissions: false))
    }

    func testOnlyATapOrTheForegroundEventConsumesTheStay() {
        let stay = BackgroundStay(since: backgrounded)
        let kept: [RootSurfaceEvent] = [
            .restoreCompleted(hasPendingEmissions: false), .openWeb, .openBoxScreen, .boxSwitched, .webContentTerminated,
        ]
        for event in kept {
            XCTAssertEqual(RootSurfaceRule.pendingStay(stay, after: event), stay, "\(event)")
        }
        XCTAssertNil(RootSurfaceRule.pendingStay(stay, after: .notificationTap))
        XCTAssertNil(RootSurfaceRule.pendingStay(
            stay,
            after: .returnedToForeground(backgroundedFor: minute, webContentAlive: true, hasPendingEmissions: false)
        ))
    }
}
