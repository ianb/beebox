import XCTest
@testable import CallbackBox

final class CaptureAPITests: XCTestCase {
    func testCreateAndUploadRequestsCarryAuthAndRawMetadata() throws {
        let box = makeBox(token: "secret")
        let api = CaptureAPI(box: box, transport: StubCaptureTransport())
        let create = try api.createSessionRequest(targetSessionID: "chat-1")
        let item = makeAudioItem()
        let upload = api.uploadRequest(sessionID: CaptureSessionID(rawValue: "capture-1"), item: item)

        XCTAssertEqual(create.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertEqual(create.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(create.url?.path, "/box/api/capture/sessions")
        let body = try XCTUnwrap(create.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json["targetSessionId"], "chat-1")

        XCTAssertEqual(upload.httpMethod, "POST")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "X-Capture-Kind"), "audio")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "X-Capture-Mime-Type"), "audio/mp4")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "X-Capture-Audio-Format"), "m4a-aac")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "X-Capture-Segment-Id"), "segment-1")
        XCTAssertEqual(upload.url?.path, "/box/api/capture/sessions/capture-1/upload")
        XCTAssertNil(upload.httpBody)
    }

    func testResumableRequestOmitsNilQueryAndCarriesClientID() {
        let api = CaptureAPI(box: makeBox(token: nil), transport: StubCaptureTransport())
        let request = api.resumableRequest(
            targetSessionID: nil,
            clientSessionID: CaptureSessionID(rawValue: "capture-1")
        )
        let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)

        XCTAssertEqual(components?.path, "/box/api/capture/sessions/resumable")
        XCTAssertEqual(components?.queryItems, [URLQueryItem(name: "clientSessionId", value: "capture-1")])
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }

    func testCreateDecodesCapabilitiesThroughFakeTransport() async {
        let data = Data(#"{"sessionId":"capture-1","startedAt":"2026-07-17T12:00:00Z","capabilities":{"acceptedAudioFormats":["webm-opus","m4a-aac"],"acceptedUploadEncodings":["raw-body-v1"]}}"#.utf8)
        let transport = StubCaptureTransport(statusCode: 200, data: data)
        let outcome = await CaptureAPI(box: makeBox(token: nil), transport: transport).createSession(targetSessionID: nil)

        guard case .success(let response) = outcome else {
            return XCTFail("Expected a decoded create response")
        }
        XCTAssertEqual(response.sessionId, "capture-1")
        XCTAssertTrue(response.capabilities.supportsNativeCapture)
    }

    func testResumableCapturesDecodeServerEnvelopeAndStringID() async {
        let data = Data(#"{"resumable":[{"id":"capture-1","counts":{"photos":2,"files":1,"audioSegments":3},"startedAt":"2026-07-17T12:00:00Z"}]}"#.utf8)
        let transport = StubCaptureTransport(statusCode: 200, data: data)
        let outcome = await CaptureAPI(box: makeBox(token: nil), transport: transport).resumableCaptures(
            targetSessionID: "chat-1",
            clientSessionID: nil
        )

        guard case .success(let captures) = outcome else {
            return XCTFail("Expected a decoded resumable response")
        }
        XCTAssertEqual(captures.first?.id, CaptureSessionID(rawValue: "capture-1"))
        XCTAssertEqual(captures.first?.counts.audioSegments, 3)
    }

    func testTerminalAndRetryableResponsesAreTyped() {
        let url = URL(string: "https://example.test")!
        let body = Data(#"{"error":"specific failure"}"#.utf8)

        XCTAssertEqual(classification(status: 404, body: body, url: url), .rejected(.sessionGone("specific failure")))
        XCTAssertEqual(classification(status: 409, body: body, url: url), .rejected(.alreadySealed("specific failure")))
        XCTAssertEqual(classification(status: 413, body: body, url: url), .rejected(.payloadTooLarge("specific failure")))
        XCTAssertEqual(
            classification(status: 503, body: body, url: url),
            .retryable(CaptureRetry(message: "specific failure", retryAfter: nil))
        )
    }

    func testNetworkErrorIsRetryable() async {
        let transport = StubCaptureTransport(error: URLError(.notConnectedToInternet))
        let outcome = await CaptureAPI(box: makeBox(token: nil), transport: transport).cancel(
            sessionID: CaptureSessionID(rawValue: "capture-1")
        )

        guard case .retryable = outcome else {
            return XCTFail("Expected network errors to remain retryable")
        }
    }

    func testBackgroundSessionIdentifierIsFixed() {
        XCTAssertEqual(CaptureBackgroundSession.identifier, "app.callbackbox.ios.capture-upload-v1")
        XCTAssertEqual(CaptureBackgroundSession.configuration().identifier, CaptureBackgroundSession.identifier)
    }

    private func classification(status: Int, body: Data, url: URL) -> CaptureRequestOutcome<Bool> {
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        return CaptureAPI.classifyUploadResponse(response, data: body)
    }

    private func makeBox(token: String?) -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: token,
            requiresDeviceUnlock: false
        )
    }

    private func makeAudioItem() -> CaptureItem {
        CaptureItem(
            id: UUID(),
            filename: "ios-audio-test.m4a",
            kind: .audio,
            capturedAt: "2026-07-17T12:00:00Z",
            source: "microphone",
            mimeType: "audio/mp4",
            originalName: nil,
            audioFormat: .m4aAAC,
            segmentID: "segment-1",
            segmentStartedAt: "2026-07-17T12:00:00Z",
            state: .local,
            uploadGeneration: 0
        )
    }
}

private struct StubCaptureTransport: CaptureTransport {
    var statusCode = 200
    var data = Data(#"{"success":true}"#.utf8)
    var error: Error?

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        if let error {
            throw error
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        return (data, response)
    }
}
