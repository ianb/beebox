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
        disabled: Bool = false
    ) -> NativeControlEntry {
        NativeControlEntry(
            id: id,
            role: .button,
            label: label,
            does: does,
            container: NativeControlSurface.composer,
            disabled: disabled
        )
    }

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
