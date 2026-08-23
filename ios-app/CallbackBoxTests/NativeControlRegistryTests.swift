import XCTest
@testable import CallbackBox

/// The native control registry and the V2 command envelope that carries it.
///
/// The registry is exercised directly rather than through SwiftUI: what matters
/// is the bookkeeping the modifier relies on — a departing view removing only
/// its own entry, a re-registration replacing rather than duplicating, and a
/// stable order regardless of the order `onAppear` ran in.
final class NativeControlRegistryTests: XCTestCase {
    private func entry(
        _ id: String,
        label: String = "Label",
        does: String? = nil,
        disabled: Bool = false,
        actions: [NativeControlEntry.Action] = [.point]
    ) -> NativeControlEntry {
        NativeControlEntry(
            id: id,
            role: .button,
            label: label,
            does: does,
            container: NativeControlSurface.composer,
            disabled: disabled,
            actions: actions
        )
    }

    /// A box big enough for the registry to believe it is a real laid-out frame.
    private let box = CGRect(x: 10, y: 20, width: 58, height: 58)

    func testRegistersAndDeregistersByToken() {
        let registry = NativeControlRegistry()
        let mic = UUID()
        registry.register(entry("cb-composer-mic"), frame: .zero, token: mic)
        XCTAssertEqual(registry.entries.map(\.id), ["cb-composer-mic"])
        registry.unregister(token: mic)
        XCTAssertEqual(registry.entries, [])
    }

    /// The composer's trailing control swaps mic → send. SwiftUI may run the
    /// arriving view's `onAppear` before the departing view's `onDisappear`, so
    /// deregistration matches on the view instance's token, never on the id.
    func testDepartingViewCannotRemoveTheArrivingOne() {
        let registry = NativeControlRegistry()
        let departing = UUID()
        let arriving = UUID()
        registry.register(entry("cb-composer-mic", label: "Start dictation"), frame: .zero, token: departing)
        registry.register(entry("cb-composer-send", label: "Send"), frame: .zero, token: arriving)
        registry.unregister(token: departing)
        XCTAssertEqual(registry.entries.map(\.id), ["cb-composer-send"])
    }

    /// A state change re-registers the same view: the entry is replaced, not
    /// duplicated, so a control whose label tracks its state reports one entry.
    func testReRegistrationReplacesInPlace() {
        let registry = NativeControlRegistry()
        let token = UUID()
        registry.register(entry("cb-composer-send", label: "Send"), frame: .zero, token: token)
        registry.register(entry("cb-composer-send", label: "Send photo", disabled: true), frame: .zero, token: token)
        XCTAssertEqual(registry.entries.count, 1)
        XCTAssertEqual(registry.entries.first?.label, "Send photo")
        XCTAssertEqual(registry.entries.first?.disabled, true)
    }

    /// Both views can be registered for one runloop turn during a swap. Reporting
    /// both would tell the agent two mutually exclusive controls are on screen;
    /// the newest registration is the one that just appeared, so it wins.
    func testOverlappingRegistrationsForOneAddressCoalesce() {
        let registry = NativeControlRegistry()
        registry.register(entry("cb-composer-send", label: "Send"), frame: .zero, token: UUID())
        let arriving = UUID()
        registry.register(entry("cb-composer-send", label: "Send photo"), frame: CGRect(x: 1, y: 2, width: 3, height: 4), token: arriving)
        XCTAssertEqual(registry.entries.count, 1)
        XCTAssertEqual(registry.entries.first?.label, "Send photo")
        XCTAssertEqual(registry.frame(of: "cb-composer-send"), CGRect(x: 1, y: 2, width: 3, height: 4))
    }

    func testEntriesAreOrderedByAddress() {
        let registry = NativeControlRegistry()
        for id in ["cb-composer-send", "cb-composer-add", "cb-composer-mic"] {
            registry.register(entry(id), frame: .zero, token: UUID())
        }
        XCTAssertEqual(
            registry.entries.map(\.id),
            ["cb-composer-add", "cb-composer-mic", "cb-composer-send"]
        )
    }

    func testFrameLookupFindsTheRegisteredBox() {
        let registry = NativeControlRegistry()
        let box = CGRect(x: 10, y: 20, width: 58, height: 58)
        registry.register(entry("cb-composer-mic"), frame: box, token: UUID())
        XCTAssertEqual(registry.frame(of: "cb-composer-mic"), box)
        XCTAssertNil(registry.frame(of: "cb-composer-send"))
    }
}

/// The command envelope, both versions, and the result channel — checked against
/// the shared golden fixtures under
/// `callback-box/test/mobile-contract/fixtures/`, which the TypeScript doctest
/// reads too. A contract change edits a fixture once and both suites fail.
final class NativeComposerCommandV2Tests: XCTestCase {
    private func decodeCommand(_ input: [String: Any]) throws -> NativeComposerCommand? {
        let data = try JSONSerialization.data(withJSONObject: input)
        return try? JSONDecoder().decode(NativeComposerCommand.self, from: data)
    }

    /// V1 is still the shape installed web bundles send, so it must keep
    /// decoding with `selection` at the top level.
    func testV1SelectionStillDecodes() throws {
        let command = try XCTUnwrap(decodeCommand([
            "version": 1,
            "id": "c-1",
            "kind": "add-selection",
            "selection": ["ref": "/notes/plan.md", "text": "t", "position": "line 1"],
        ]))
        XCTAssertEqual(command.version, 1)
        guard case .addSelection(let selection) = command.payload else {
            return XCTFail("expected an add-selection payload")
        }
        XCTAssertEqual(selection.ref, "/notes/plan.md")
    }

    /// V1 cannot express a kind that carries no selection; a V1 envelope claiming
    /// one is a malformed command rather than a scan request.
    func testV1CannotCarryAV2Kind() throws {
        XCTAssertNil(try decodeCommand(["version": 1, "id": "c-1", "kind": "scan-controls"]))
    }

    func testUnknownKindIsRefusedRatherThanGuessed() throws {
        XCTAssertNil(try decodeCommand(["version": 2, "id": "c-1", "kind": "point-at-control"]))
    }

    /// The `id` is what lets an older build's failed decode answer with a
    /// rejection instead of returning silently, so an empty one is refused here
    /// as loudly as anywhere else.
    func testEmptyIDIsRefused() throws {
        XCTAssertNil(try decodeCommand(["version": 2, "id": "  ", "kind": "scan-controls"]))
    }

    func testResultFixturesRoundTripThroughTheEncoder() throws {
        let fixtures = try MobileContractFixtures.load("composer-command-result")
        XCTAssertFalse(fixtures.isEmpty, "no composer-command-result fixtures found")
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try JSONSerialization.data(withJSONObject: input)
            let result = try? JSONDecoder().decode(NativeComposerCommandResult.self, from: data)
            guard let expected = fixture["expected"] as? [String: Any] else {
                XCTAssertNil(result, "\(name): expected a refusal")
                continue
            }
            let decoded = try XCTUnwrap(result, "\(name): expected a decoded result")
            XCTAssertEqual(decoded.id, expected["id"] as? String, "\(name): id")
            XCTAssertEqual(decoded.ok, expected["ok"] as? Bool, "\(name): ok")
            XCTAssertEqual(decoded.reason, expected["reason"] as? String, "\(name): reason")
            let expectedControls = expected["controls"] as? [[String: Any]]
            XCTAssertEqual(decoded.controls?.count, expectedControls?.count, "\(name): control count")
            for (got, want) in zip(decoded.controls ?? [], expectedControls ?? []) {
                XCTAssertEqual(got.id, want["id"] as? String, "\(name): control id")
                XCTAssertEqual(got.role.rawValue, want["role"] as? String, "\(name): control role")
                XCTAssertEqual(got.label, want["label"] as? String, "\(name): control label")
                XCTAssertEqual(got.does, want["does"] as? String, "\(name): control does")
                XCTAssertEqual(got.container, want["container"] as? String, "\(name): control container")
                XCTAssertEqual(got.disabled, want["disabled"] as? Bool, "\(name): control disabled")
            }
        }
    }

    /// An empty inventory is a successful answer, and it encodes as one: the web
    /// reads `ok` rather than inferring failure from an absent list.
    func testEmptyInventoryEncodesAsSuccess() throws {
        let encoded = try JSONEncoder().encode(NativeComposerCommandResult.controls(id: "c-1", []))
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        XCTAssertEqual(json["version"] as? Int, 2)
        XCTAssertEqual(json["kind"] as? String, "scan-controls")
        XCTAssertEqual(json["ok"] as? Bool, true)
        XCTAssertEqual((json["controls"] as? [Any])?.count, 0)
        XCTAssertNil(json["reason"])
    }

    /// A nil `does` is omitted rather than written as null — the web treats an
    /// absent key and an explicit null identically, and this pins which one the
    /// encoder actually produces.
    func testAbsentDescriptionIsOmittedFromTheWire() throws {
        let result = NativeComposerCommandResult.controls(id: "c-1", [
            NativeControlEntry(
                id: "cb-composer-input",
                role: .textbox,
                label: "Type a message",
                does: nil,
                container: NativeControlSurface.composer,
                disabled: false
            ),
        ])
        let json = try XCTUnwrap(String(data: try JSONEncoder().encode(result), encoding: .utf8))
        XCTAssertFalse(json.contains("does"), "expected the nil description to be omitted: \(json)")
    }
}


/// Acting on a native control for a `control:` pointer.
///
/// The refusals carry the weight here. The plan accepts that the native side
/// works at lower fidelity than the DOM scan — a declared registry, and
/// `focus`/`reveal` only where they mean something — on the condition that every
/// gap answers with a sentence rather than doing nothing, so each of those
/// sentences is pinned by a test.
final class NativeControlPointingTests: XCTestCase {
    private let box = CGRect(x: 10, y: 20, width: 58, height: 58)

    private func registry(
        id: String = "cb-composer-mic",
        disabled: Bool = false,
        frame: CGRect? = nil,
        onFocus: (() -> Void)? = nil,
        onReveal: (() -> Void)? = nil
    ) -> NativeControlRegistry {
        let registry = NativeControlRegistry()
        let handlers = NativeControlHandlers(focus: onFocus, reveal: onReveal)
        registry.register(
            NativeControlEntry(
                id: id,
                role: .button,
                label: "Label",
                does: nil,
                container: NativeControlSurface.composer,
                disabled: disabled,
                actions: handlers.actions
            ),
            frame: frame ?? box,
            handlers: handlers,
            token: UUID()
        )
        return registry
    }

    /// `actions` is derived from the handlers, never declared beside them, so the
    /// list the agent reads cannot promise something the view has no way to do.
    func testActionsFollowTheHandlersThatExist() {
        XCTAssertEqual(NativeControlHandlers().actions, [.point])
        XCTAssertEqual(NativeControlHandlers(focus: {}).actions, [.point, .focus])
        XCTAssertEqual(NativeControlHandlers(reveal: {}).actions, [.point, .reveal])
    }

    /// The inventory and the dispatch must agree. A control the registry has no
    /// usable frame for is still listed — it is on screen — but with no actions,
    /// so the dump prints it `(not pointable)` instead of handing out a link
    /// `perform` would refuse a moment later.
    func testAnUnpointableControlIsListedWithNoActions() {
        let stale = registry(id: "cb-composer-input", frame: .zero, onFocus: {})
        XCTAssertEqual(stale.entries.map(\.id), ["cb-composer-input"])
        XCTAssertEqual(stale.entries.first?.actions, [])
        guard case .refused = stale.perform(.point, on: "cb-composer-input") else {
            return XCTFail("expected the dispatch to refuse what the inventory did not advertise")
        }
    }

    func testAPointableControlKeepsItsActionsInTheInventory() {
        let live = registry(id: "cb-composer-input", onFocus: {})
        XCTAssertEqual(live.entries.first?.actions, [.point, .focus])
    }

    func testPointReturnsTheRegisteredBox() {
        XCTAssertEqual(registry().perform(.point, on: "cb-composer-mic"), .pointed(box))
    }

    func testUnknownAddressIsRefusedWithItsName() {
        guard case .refused(let reason) = registry().perform(.point, on: "cb-nav-voice") else {
            return XCTFail("expected a refusal")
        }
        XCTAssertTrue(reason.contains("cb-nav-voice"), reason)
    }

    /// A frame the registry never got a real layout for would put the ring
    /// somewhere the control is not, which is worse than saying so.
    func testAStaleFrameIsRefusedRatherThanRungInTheWrongPlace() {
        let stale = registry(frame: .zero)
        guard case .refused(let reason) = stale.perform(.point, on: "cb-composer-mic") else {
            return XCTFail("expected a refusal")
        }
        XCTAssertTrue(reason.contains("not where it is"), reason)
    }

    /// `focus` is the composer text field and nothing else on this surface.
    func testFocusRunsOnlyWhereTheSurfaceHasAFirstResponder() {
        var focused = 0
        let field = registry(id: "cb-composer-input", onFocus: { focused += 1 })
        XCTAssertEqual(field.perform(.focus, on: "cb-composer-input"), .pointed(box))
        XCTAssertEqual(focused, 1)

        guard case .refused(let reason) = registry().perform(.focus, on: "cb-composer-mic") else {
            return XCTFail("expected a refusal")
        }
        XCTAssertEqual(reason, "focus is not supported for this control on this surface (cb-composer-mic).")
    }

    /// `reveal` presents the sheet a control opens — the Add button's actions
    /// sheet, and nothing else. It never operates the control for the user.
    func testRevealRunsOnlyWhereTheControlOpensSomething() {
        var revealed = 0
        let add = registry(id: "cb-composer-add", onReveal: { revealed += 1 })
        XCTAssertEqual(add.perform(.reveal, on: "cb-composer-add"), .pointed(box))
        XCTAssertEqual(revealed, 1)

        guard case .refused(let reason) = registry().perform(.reveal, on: "cb-composer-mic") else {
            return XCTFail("expected a refusal")
        }
        XCTAssertEqual(reason, "reveal is not supported for this control on this surface (cb-composer-mic).")
    }

    /// Pointing at a control that is on screen but not operable is fine — that is
    /// exactly the "where is it, and why can I not use it" question. Acting on
    /// one is not.
    func testADisabledControlCanBePointedAtButNotOperated() {
        var focused = 0
        let locked = registry(id: "cb-composer-input", disabled: true, onFocus: { focused += 1 })
        XCTAssertEqual(locked.perform(.point, on: "cb-composer-input"), .pointed(box))
        guard case .refused(let reason) = locked.perform(.focus, on: "cb-composer-input") else {
            return XCTFail("expected a refusal")
        }
        XCTAssertTrue(reason.contains("not usable right now"), reason)
        XCTAssertEqual(focused, 0, "a refused action must not have run the handler")
    }

    /// A departing view's handler must not outlive it: re-registering under the
    /// same token replaces the closure along with the frame.
    func testReRegistrationReplacesTheHandlerToo() {
        let registry = NativeControlRegistry()
        let token = UUID()
        var first = 0
        var second = 0
        for handler in [{ first += 1 }, { second += 1 }] {
            let handlers = NativeControlHandlers(focus: handler)
            registry.register(
                NativeControlEntry(
                    id: "cb-composer-input",
                    role: .textbox,
                    label: "Type a message",
                    does: nil,
                    container: NativeControlSurface.composer,
                    disabled: false,
                    actions: handlers.actions
                ),
                frame: box,
                handlers: handlers,
                token: token
            )
        }
        XCTAssertEqual(registry.perform(.focus, on: "cb-composer-input"), .pointed(box))
        XCTAssertEqual(first, 0)
        XCTAssertEqual(second, 1)
    }
}

/// The `point-at-control` half of the V2 envelope.
final class NativePointAtControlCommandTests: XCTestCase {
    private func decode(_ input: [String: Any]) throws -> NativeComposerCommand? {
        let data = try JSONSerialization.data(withJSONObject: input)
        return try? JSONDecoder().decode(NativeComposerCommand.self, from: data)
    }

    func testPointAtControlDecodesItsTarget() throws {
        let command = try XCTUnwrap(decode([
            "version": 2,
            "id": "point-1",
            "kind": "point-at-control",
            "payload": ["id": "cb-composer-input", "action": "focus"],
        ]))
        guard case .pointAtControl(let target) = command.payload else {
            return XCTFail("expected a point-at-control payload")
        }
        XCTAssertEqual(target.id, "cb-composer-input")
        XCTAssertEqual(target.action, .focus)
        XCTAssertEqual(command.kind, .pointAtControl)
    }

    /// The web degrades an unrecognised `action=` to `point` before it builds a
    /// command, so a fourth value here is a bundle skew — and acting on the
    /// interface on a guess is the one thing this feature must not do.
    func testUnknownActionIsRefusedRatherThanGuessed() throws {
        XCTAssertNil(try decode([
            "version": 2,
            "id": "point-1",
            "kind": "point-at-control",
            "payload": ["id": "cb-composer-input", "action": "operate"],
        ]))
    }

    func testEmptyControlAddressIsRefused() throws {
        XCTAssertNil(try decode([
            "version": 2,
            "id": "point-1",
            "kind": "point-at-control",
            "payload": ["id": "  ", "action": "point"],
        ]))
    }

    func testV1CannotCarryPointAtControl() throws {
        XCTAssertNil(try decode([
            "version": 1,
            "id": "point-1",
            "kind": "point-at-control",
            "payload": ["id": "cb-composer-input", "action": "point"],
        ]))
    }

    /// A successful point carries no answer beyond the fact that it happened —
    /// the ring is already on the phone — so `controls` must stay absent without
    /// making the result look like a failure.
    func testPointedResultEncodesAsSuccessWithNoPayload() throws {
        let encoded = try JSONEncoder().encode(NativeComposerCommandResult.pointed(id: "point-1"))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(json["version"] as? Int, 2)
        XCTAssertEqual(json["kind"] as? String, "point-at-control")
        XCTAssertEqual(json["ok"] as? Bool, true)
        XCTAssertNil(json["controls"])
        XCTAssertNil(json["reason"])
    }

    /// The round trip in the direction the web reads it, through the same golden
    /// fixture the TypeScript doctest asserts against.
    func testPointResultFixturesDecode() throws {
        let fixtures = try MobileContractFixtures.load("composer-command-result")
        for (name, fixture) in fixtures where name.hasPrefix("point-at-control") {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try JSONSerialization.data(withJSONObject: input)
            let decoded = try XCTUnwrap(
                try? JSONDecoder().decode(NativeComposerCommandResult.self, from: data),
                "\(name): expected a decoded result"
            )
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): missing expected")
            XCTAssertEqual(decoded.kind, .pointAtControl, "\(name): kind")
            XCTAssertEqual(decoded.ok, expected["ok"] as? Bool, "\(name): ok")
            XCTAssertEqual(decoded.reason, expected["reason"] as? String, "\(name): reason")
        }
    }

    /// An entry from a build older than `point-at-control` has no `actions` key,
    /// and absent must read as NONE rather than as `point`: that build can list a
    /// control and cannot act on one.
    func testAbsentActionsDecodeAsNoneNotAsPoint() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "id": "cb-composer-mic",
            "role": "button",
            "label": "Start dictation",
            "container": "Composer",
            "disabled": false,
        ])
        let entry = try JSONDecoder().decode(NativeControlEntry.self, from: data)
        XCTAssertEqual(entry.actions, [])
    }

    func testActionsRoundTripThroughTheWire() throws {
        let entry = NativeControlEntry(
            id: "cb-composer-input",
            role: .textbox,
            label: "Type a message",
            does: nil,
            container: NativeControlSurface.composer,
            disabled: false,
            actions: [.point, .focus]
        )
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try JSONEncoder().encode(entry)) as? [String: Any]
        )
        XCTAssertEqual(json["actions"] as? [String], ["point", "focus"])
    }
}
