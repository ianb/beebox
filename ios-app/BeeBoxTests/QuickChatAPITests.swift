import XCTest
@testable import BeeBox

final class QuickChatAPITests: XCTestCase {
    private let recordID = UUID(uuidString: "5F0C2A9E-3B1D-4C7A-9E2F-8D6B1A4C3E70")!

    func testSubmitRequestMatchesSharedFixture() throws {
        let request = try api().submitRequest(id: recordID, message: "Remind me to renew my passport", origin: .voice)

        XCTAssertEqual(request.url?.path, "/main/test1/api/trpc/quickChat.submit")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.timeoutInterval, 60)
        try XCTAssertJSONEqual(request.httpBody, fixture: "submit-request.json")
    }

    func testExternalSubmitRequestMatchesSharedFixture() throws {
        let request = try api().submitRequest(id: recordID, message: "Remind me to renew my passport", origin: .external, source: "apple-app-intents")
        XCTAssertEqual(request.timeoutInterval, 20)
        try XCTAssertJSONEqual(request.httpBody, fixture: "submit-external-request.json")
    }

    /// A retry of a stored id sends no origin; the server keeps the stored one.
    func testSubmitRequestWithoutAnOriginOmitsTheKey() throws {
        let request = try api().submitRequest(id: recordID, message: "Remind me to renew my passport", origin: nil)
        XCTAssertEqual(request.timeoutInterval, 60)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])

        XCTAssertEqual(Set(body.keys), ["id", "message", "channel"])
    }

    func testChooseRequestMatchesSharedFixture() throws {
        let request = try api().chooseRequest(id: recordID, candidateId: "c2")

        XCTAssertEqual(request.url?.path, "/main/test1/api/trpc/quickChat.choose")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        try XCTAssertJSONEqual(request.httpBody, fixture: "choose-request.json")
    }

    func testDiscardRequestMatchesSharedFixture() throws {
        let request = try api().discardRequest(id: recordID)

        XCTAssertEqual(request.url?.path, "/main/test1/api/trpc/quickChat.discard")
        XCTAssertEqual(request.httpMethod, "POST")
        try XCTAssertJSONEqual(request.httpBody, fixture: "discard-request.json")
    }

    func testHomeIsAnAuthenticatedQueryWithNoInput() {
        let request = api().homeRequest()

        XCTAssertEqual(request.url?.path, "/main/test1/api/trpc/quickChat.home")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.httpBody)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), BoxRequest.userAgent)
    }

    func testEveryViewFixtureDecodes() throws {
        let views = try MobileContractFixtures.load("quick-chat").filter { $0.name.hasPrefix("view-") }
        XCTAssertEqual(views.count, 9)
        for (name, fixture) in views {
            let view = try QuickChatAPI.decodeView(MobileContractFixtures.jsonData(from: fixture))
            XCTAssertEqual(view.id, recordID, name)
        }
    }

    func testViewFixturesCarryEachFace() throws {
        let uncertain = try view("view-needs-choice-uncertain")
        XCTAssertEqual(uncertain.state, .needsChoice)
        XCTAssertEqual(uncertain.reason, .uncertain)
        XCTAssertEqual(uncertain.choices?.map(\.candidateId), ["c2", "c9", "c0"])
        XCTAssertNil(uncertain.choices?[1].detail)

        XCTAssertEqual(try view("view-needs-choice-routing-unavailable").reason, .routingUnavailable)
        XCTAssertEqual(try view("view-needs-choice-destination-gone").reason, .destinationGone)

        let notDelivered = try view("view-sending-not-delivered")
        XCTAssertEqual(notDelivered.state, .sending)
        XCTAssertNotNil(notDelivered.lastError)
        XCTAssertNil(notDelivered.expired)

        let expired = try view("view-sending-expired")
        XCTAssertEqual(expired.expired, true)
        XCTAssertEqual(expired.destination?.sessionId, "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40")

        XCTAssertEqual(try view("view-sent-queued").queued, true)
        let noSession = try view("view-sent-no-session")
        XCTAssertEqual(noSession.state, .sent)
        XCTAssertNil(noSession.destination?.sessionId)
        XCTAssertEqual(try view("view-discarded").state, .discarded)
    }

    func testHomeFixtureDecodes() throws {
        let data = try Data(contentsOf: MobileContractFixtures.root.appendingPathComponent("quick-chat/home.json"))
        let home = try QuickChatAPI.decodeHome(data)

        XCTAssertEqual(home.open.map(\.state), [.needsChoice, .sending])
        XCTAssertEqual(home.recentlySent.first?.queued, true)
        XCTAssertEqual(home.recentChats.map(\.label), ["Plan the week", "Trip planning", "Household"])
        XCTAssertNil(home.recentChats.first?.landmark)
        XCTAssertEqual(home.recentChats[1].landmark?.symbol, "✈️")
        XCTAssertNotNil(home.recentChats.last?.landmark)
        XCTAssertNil(home.recentChats.last?.landmark?.symbol)
        XCTAssertEqual(home.shortcuts.map(\.to), ["/questions", "/browse/_content/garden/Garden.landmark.card"])
    }

    func testAnUnknownStateFailsToDecode() {
        let data = Data(#"{"result":{"data":{"id":"5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70","message":"x","createdAt":"t","state":"routed"}}}"#.utf8)
        XCTAssertThrowsError(try QuickChatAPI.decodeView(data)) { error in
            XCTAssertEqual(error as? QuickChatAPI.APIError, .invalidResponse)
        }
    }

    func testServerErrorCarriesTheTRPCMessage() async {
        let body = Data(#"{"error":{"message":"Quick chat message 5f0c already has different text.","code":-32603,"data":{"code":"CONFLICT","httpStatus":409}}}"#.utf8)
        let api = QuickChatAPI(box: makeBox(), transport: QuickChatStubTransport(statusCode: 409, data: body))
        do {
            _ = try await api.submit(id: recordID, message: "x", origin: .typed)
            XCTFail("Expected a server error")
        } catch {
            XCTAssertEqual(
                error as? QuickChatAPI.APIError,
                .server(status: 409, message: "Quick chat message 5f0c already has different text.")
            )
        }
    }

    func testSubmitDecodesTheReturnedView() async throws {
        let data = try Data(contentsOf: MobileContractFixtures.root.appendingPathComponent("quick-chat/view-sent.json"))
        let view = try await QuickChatAPI(box: makeBox(), transport: QuickChatStubTransport(data: data))
            .submit(id: recordID, message: "Remind me to renew my passport", origin: .typed)
        XCTAssertEqual(view.destination?.label, "Trip planning")
    }

    private func view(_ name: String) throws -> QuickChatView {
        let data = try Data(contentsOf: MobileContractFixtures.root.appendingPathComponent("quick-chat/\(name).json"))
        return try QuickChatAPI.decodeView(data)
    }

    private func api() -> QuickChatAPI {
        QuickChatAPI(box: makeBox(), transport: QuickChatStubTransport())
    }

    private func makeBox() -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "http://127.0.0.1:3210/main/test1")!,
            sessionID: nil,
            authToken: "secret",
            requiresDeviceUnlock: false
        )
    }

    private func XCTAssertJSONEqual(_ body: Data?, fixture: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(body)) as? NSDictionary
        let expected = try JSONSerialization.jsonObject(
            with: Data(contentsOf: MobileContractFixtures.root.appendingPathComponent("quick-chat/\(fixture)"))
        ) as? NSDictionary
        XCTAssertEqual(sent, expected, file: file, line: line)
    }
}

private struct QuickChatStubTransport: ChatTransport {
    var statusCode = 200
    var data = Data()

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let response = HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!
        return (data, response)
    }
}
