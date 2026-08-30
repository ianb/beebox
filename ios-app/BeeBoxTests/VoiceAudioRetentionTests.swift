import XCTest
@testable import BeeBox

/// Covers the native half of audio retranscription
/// (`beebox/docs/plans/ios-audio-retranscription.md`): the on-disk
/// retention store, the answer request's shape against mobile-contract §4.8,
/// and strict decoding of the relayed request.
///
/// What these cannot cover is the end of the path — that a dictated message on
/// a real phone comes back from `bbx chat retranscribe`. No agent can speak into
/// a live box, so that step is a device check, not a test.
final class VoiceAudioRetentionTests: XCTestCase {
    // MARK: - Retention

    func testRetainedRecordingIsFoundByEmissionID() async throws {
        let store = makeStore()
        let boxID = UUID()
        let source = try writeRecording("hello")

        await store.retain(
            RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(timeIntervalSince1970: 10), text: "hello", sessionID: nil),
            movingFrom: source,
            boxID: boxID
        )

        let retained = await store.retained(emissionID: "EMISSION-1", boxID: boxID)
        let found = try XCTUnwrap(retained)
        XCTAssertEqual(found.audio.text, "hello")
        XCTAssertEqual(try Data(contentsOf: found.url), Data("hello".utf8))
        // The store takes the file rather than copying it — every caller was
        // deleting the source on that line before.
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
    }

    func testUnknownEmissionAnswersNothing() async {
        let store = makeStore()
        let found = await store.retained(emissionID: "NEVER-RETAINED", boxID: UUID())
        XCTAssertNil(found)  // no entry, so nothing to answer with
    }

    /// The web store keeps five; so does this one, so "the last five
    /// recordings" means one thing across both composers.
    func testCapacityEvictsTheOldestRecordingAndItsBytes() async throws {
        let store = makeStore(capacity: 3)
        let boxID = UUID()
        for index in 0..<4 {
            await store.retain(
                RetainedVoiceAudio(
                    emissionID: "EMISSION-\(index)",
                    recordedAt: Date(timeIntervalSince1970: TimeInterval(index)),
                    text: "message \(index)",
                    sessionID: nil
                ),
                movingFrom: try writeRecording("audio \(index)"),
                boxID: boxID
            )
        }

        let count = await store.count(boxID: boxID)
        let evicted = await store.retained(emissionID: "EMISSION-0", boxID: boxID)
        let kept = await store.retained(emissionID: "EMISSION-3", boxID: boxID)
        XCTAssertEqual(count, 3)
        XCTAssertNil(evicted)
        XCTAssertNotNil(kept)
        let evictedBytes = root.appendingPathComponent(boxID.uuidString.lowercased())
            .appendingPathComponent("EMISSION-0.wav")
        XCTAssertFalse(FileManager.default.fileExists(atPath: evictedBytes.path))
    }

    func testRecordingsAreScopedToTheirBox() async throws {
        let store = makeStore()
        let dictatedInto = UUID()
        let otherBox = UUID()
        await store.retain(
            RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "private", sessionID: nil),
            movingFrom: try writeRecording("private"),
            boxID: dictatedInto
        )

        let own = await store.retained(emissionID: "EMISSION-1", boxID: dictatedInto)
        let foreign = await store.retained(emissionID: "EMISSION-1", boxID: otherBox)
        XCTAssertNotNil(own)
        XCTAssertNil(foreign)
    }

    /// The reason this store is on disk rather than in memory like the web's:
    /// it has to survive an app relaunch and the WKWebView content-process
    /// reload, both of which happen between dictating and retranscribing.
    func testRetentionSurvivesANewStoreOverTheSameRoot() async throws {
        let boxID = UUID()
        await makeStore().retain(
            RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "durable", sessionID: nil),
            movingFrom: try writeRecording("durable"),
            boxID: boxID
        )

        let reopened = await makeStore().retained(emissionID: "EMISSION-1", boxID: boxID)
        XCTAssertEqual(reopened?.audio.text, "durable")
    }

    /// The HQ path retains at send time, when only the realtime transcript
    /// exists; the message commits with the HQ one minutes later.
    func testUpdatedTextReplacesTheRealtimeTranscript() async throws {
        let store = makeStore()
        let boxID = UUID()
        await store.retain(
            RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "rough draft", sessionID: nil),
            movingFrom: try writeRecording("audio"),
            boxID: boxID
        )

        await store.updateText(emissionID: "EMISSION-1", text: "polished transcript", boxID: boxID)

        let found = await store.retained(emissionID: "EMISSION-1", boxID: boxID)
        XCTAssertEqual(found?.audio.text, "polished transcript")
    }

    /// Retention outlives delivery on purpose — that is what makes
    /// retranscription work — but must not outlive a message the user withdrew.
    func testForgettingOneRecordingLeavesTheRest() async throws {
        let store = makeStore()
        let boxID = UUID()
        for id in ["EMISSION-1", "EMISSION-2"] {
            await store.retain(
                RetainedVoiceAudio(emissionID: id, recordedAt: Date(), text: id, sessionID: nil),
                movingFrom: try writeRecording(id),
                boxID: boxID
            )
        }

        await store.forget(emissionID: "EMISSION-1", boxID: boxID)

        let discarded = await store.retained(emissionID: "EMISSION-1", boxID: boxID)
        let kept = await store.retained(emissionID: "EMISSION-2", boxID: boxID)
        XCTAssertNil(discarded)
        XCTAssertNotNil(kept)
        let bytes = root.appendingPathComponent(boxID.uuidString.lowercased())
            .appendingPathComponent("EMISSION-1.wav")
        XCTAssertFalse(FileManager.default.fileExists(atPath: bytes.path))
    }

    /// The relayed session is the fallback, not the answer, and is used when a
    /// recording predates this field or was made before the tab had a session.
    func testAnswerFallsBackToTheRelayedSession() async throws {
        let transport = RecordingTransport()
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: "session-9")

        try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(
            request,
            retained: (
                audio: RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "hi", sessionID: nil),
                url: try writeRecording("bytes")
            )
        )

        let body = try XCTUnwrap(transport.request?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(body.contains("name=\"sessionId\"\r\n\r\nsession-9"))
    }

    func testForgettingABoxDropsItsRecordings() async throws {
        let store = makeStore()
        let boxID = UUID()
        await store.retain(
            RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "gone", sessionID: nil),
            movingFrom: try writeRecording("gone"),
            boxID: boxID
        )

        await store.forget(boxID: boxID)

        let forgotten = await store.retained(emissionID: "EMISSION-1", boxID: boxID)
        XCTAssertNil(forgotten)
    }

    // MARK: - The answer (mobile-contract §4.8)

    func testAnswerEchoesTheRequestedMessageIDWithTheAudio() async throws {
        let transport = RecordingTransport()
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: "session-9")
        let audio = try writeRecording("wav bytes")

        try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(
            request,
            retained: (
                audio: RetainedVoiceAudio(
                    emissionID: "EMISSION-1",
                    recordedAt: Date(timeIntervalSince1970: 0),
                    text: "what was said",
                    sessionID: "session-dictated-into"
                ),
                url: audio
            )
        )

        let recorded = try XCTUnwrap(transport.request)
        XCTAssertEqual(recorded.url?.path, "/box/api/chat/last-audio/req-1")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        let body = try XCTUnwrap(recorded.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        // Load-bearing: the server discards any answer that does not echo the
        // id it asked for, silently rather than as an error.
        XCTAssertTrue(body.contains("name=\"messageId\"\r\n\r\nEMISSION-1"))
        // The session the recording was DICTATED into wins over the relaying
        // tab's current one: the phone may have navigated since.
        XCTAssertTrue(body.contains("name=\"sessionId\"\r\n\r\nsession-dictated-into"))
        XCTAssertFalse(body.contains("session-9"))
        XCTAssertTrue(body.contains("name=\"text\"\r\n\r\nwhat was said"))
        XCTAssertTrue(body.contains("1970-01-01T00:00:00Z"))
        XCTAssertTrue(body.contains("wav bytes"))
    }

    /// A tab with no session yet relays a null one; the field is then absent
    /// rather than sent as the string "null".
    func testAnswerOmitsAnUnassignedSession() async throws {
        let transport = RecordingTransport()
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: nil)

        try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(
            request,
            retained: (
                audio: RetainedVoiceAudio(emissionID: "EMISSION-1", recordedAt: Date(), text: "hi", sessionID: nil),
                url: try writeRecording("bytes")
            )
        )

        let body = try XCTUnwrap(transport.request?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertFalse(body.contains("name=\"sessionId\""))
    }

    /// A device that does not hold the recording answers anyway. Silence would
    /// be indistinguishable from a phone that is asleep.
    func testDeviceWithoutTheRecordingReportsNone() async throws {
        let transport = RecordingTransport()
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: nil)

        try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(request, retained: nil)

        let recorded = try XCTUnwrap(transport.request)
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(recorded.httpBody, Data(#"{"none":true}"#.utf8))
    }

    /// 404 is the ordinary multi-answerer outcome — another tab's answer won,
    /// or the request timed out while this upload was in flight.
    func testAnswerTreatsAnAlreadySettledRequestAsSuccess() async throws {
        let transport = RecordingTransport(statusCode: 404)
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: nil)

        try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(request, retained: nil)
    }

    func testAnswerSurfacesAServerFailure() async {
        let transport = RecordingTransport(statusCode: 500)
        let request = NativeLastAudioRequest(requestID: "req-1", messageID: "EMISSION-1", sessionID: nil)

        do {
            try await ChatAPI(box: makeBox(), transport: transport).answerLastAudio(request, retained: nil)
            XCTFail("Expected a server error to surface")
        } catch {
            // Expected.
        }
    }

    // MARK: - The relayed request

    func testLastAudioRequestFixturesDecodeStrictly() throws {
        let fixtures = try MobileContractFixtures.load("last-audio-request")
        var decoded = 0
        var rejected = 0
        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [String: Any], "\(name): missing input")
            let data = try MobileContractFixtures.jsonData(from: input)
            if fixture["expected"] is [String: Any] {
                let request = try JSONDecoder().decode(NativeLastAudioRequest.self, from: data)
                XCTAssertEqual(request.requestID, input["requestId"] as? String, "\(name): requestId")
                XCTAssertEqual(request.messageID, input["messageId"] as? String, "\(name): messageId")
                XCTAssertEqual(request.sessionID, input["sessionId"] as? String, "\(name): sessionId")
                decoded += 1
            } else {
                XCTAssertThrowsError(
                    try JSONDecoder().decode(NativeLastAudioRequest.self, from: data),
                    "\(name): malformed request decoded"
                )
                rejected += 1
            }
        }
        XCTAssertGreaterThan(decoded, 0, "no last-audio request fixture decoded")
        XCTAssertGreaterThan(rejected, 0, "no malformed last-audio request fixture rejected")
    }

    // MARK: - Helpers

    private lazy var root: URL = FileManager.default.temporaryDirectory
        .appendingPathComponent("voice-retention-tests-\(UUID().uuidString)", isDirectory: true)

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    private func makeStore() -> VoiceAudioRetentionStore {
        VoiceAudioRetentionStore(rootURL: root)
    }

    private func makeStore(capacity: Int) -> VoiceAudioRetentionStore {
        VoiceAudioRetentionStore(rootURL: root, capacity: capacity)
    }

    private func writeRecording(_ contents: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("recording-\(UUID().uuidString)")
            .appendingPathExtension("wav")
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func makeBox() -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: "secret",
            requiresDeviceUnlock: false
        )
    }
}

/// Keeps the request it was handed so the multipart body can be inspected.
private final class RecordingTransport: ChatTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: URLRequest?
    private let statusCode: Int

    init(statusCode: Int = 200) {
        self.statusCode = statusCode
    }

    var request: URLRequest? {
        lock.withLock { recorded }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { recorded = request }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        return (Data("{}".utf8), response)
    }
}
