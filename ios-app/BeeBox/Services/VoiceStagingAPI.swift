import Foundation

/// Metadata carried on a background upload task's `taskDescription`, matching
/// `CaptureBackgroundTaskMetadata`'s pattern one-for-one but keyed on a
/// recording id and chunk index rather than a capture session/item pair.
struct VoiceStagingBackgroundTaskMetadata: Codable, Equatable, Sendable {
    var boxID: UUID
    var recordingID: VoiceRecordingID
    var chunkIndex: Int
    var generation: Int

    var taskDescription: String {
        guard let data = try? JSONEncoder().encode(self) else {
            preconditionFailure("Voice staging background task metadata must be encodable")
        }
        return data.base64EncodedString()
    }

    init(boxID: UUID, recordingID: VoiceRecordingID, chunkIndex: Int, generation: Int) {
        self.boxID = boxID
        self.recordingID = recordingID
        self.chunkIndex = chunkIndex
        self.generation = generation
    }

    init?(taskDescription: String?) {
        guard
            let taskDescription,
            let data = Data(base64Encoded: taskDescription),
            let value = try? JSONDecoder().decode(Self.self, from: data)
        else {
            return nil
        }
        self = value
    }
}

/// A separate background-session identifier from `CaptureBackgroundSession`:
/// a voice recording's chunk uploads are unrelated to a capture batch's photo
/// uploads and must not share retry/queueing state with it.
enum VoiceStagingBackgroundSession {
    static let identifier = "app.beebox.ios.voice-staging-upload-v1"

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        return configuration
    }
}

struct VoiceStagingCreateResponse: Decodable, Equatable, Sendable {
    var sessionId: String
    var startedAt: String
}

struct VoiceStagingFinalizeResponse: Decodable, Equatable, Sendable {
    var sessionId: String
    var staged: Bool
}

/// Request building and response classification for the voice-staging wire
/// contract (`beebox/src/webapp/routes/capture-create.ts`,
/// `capture-upload.ts`, `capture-finalize-voice.ts`). Deliberately not
/// `CaptureAPI`: capture's request builders assume a `CaptureItem` (m4a
/// filenames, capture-batch headers) that a PCM chunk never has. Response
/// classification IS shared — `CaptureAPI.classify` is generic box-HTTP
/// handling, not capture-specific.
struct VoiceStagingAPI: Sendable {
    private struct CreateRequestBody: Encodable {
        var id: String
        var kind = "voice"
        var targetSessionId: String
    }

    private struct FinalizeRequestBody: Encodable {
        struct HQ: Encodable {
            var emissionId: String
            var sessionId: String
        }

        var chunkCount: Int
        var hq: HQ?
    }

    var box: PairedBox
    var transport: any CaptureTransport

    init(box: PairedBox, transport: any CaptureTransport = URLSessionCaptureTransport()) {
        self.box = box
        self.transport = transport
    }

    private var sessionsURL: URL {
        box.apiURL.appendingPathComponent("capture/sessions")
    }

    func createSessionRequest(recordingID: VoiceRecordingID, targetSessionID: String) throws -> URLRequest {
        var request = BoxRequest.authenticated(url: sessionsURL, box: box)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            CreateRequestBody(id: recordingID.rawValue, targetSessionId: targetSessionID)
        )
        return request
    }

    func uploadRequest(recordingID: VoiceRecordingID, chunk: VoiceStagingChunk) -> URLRequest {
        let url = sessionsURL.appendingPathComponent(recordingID.rawValue).appendingPathComponent("upload")
        var request = BoxRequest.authenticated(url: url, box: box)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue("audio", forHTTPHeaderField: "X-Capture-Kind")
        request.setValue("pcm-s16le-16k", forHTTPHeaderField: "X-Capture-Audio-Format")
        request.setValue(recordingID.rawValue, forHTTPHeaderField: "X-Capture-Segment-Id")
        request.setValue(chunk.filename, forHTTPHeaderField: "X-Capture-Filename")
        return request
    }

    func finalizeRequest(
        recordingID: VoiceRecordingID,
        chunkCount: Int,
        hq: VoiceHqFinalizePayload?
    ) throws -> URLRequest {
        let url = sessionsURL.appendingPathComponent(recordingID.rawValue).appendingPathComponent("finalize")
        var request = BoxRequest.authenticated(url: url, box: box)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            FinalizeRequestBody(
                chunkCount: chunkCount,
                hq: hq.map { FinalizeRequestBody.HQ(emissionId: $0.emissionID, sessionId: $0.sessionID) }
            )
        )
        return request
    }

    func createSession(
        recordingID: VoiceRecordingID,
        targetSessionID: String
    ) async -> CaptureRequestOutcome<VoiceStagingCreateResponse> {
        do {
            return await perform(try createSessionRequest(recordingID: recordingID, targetSessionID: targetSessionID))
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    func finalize(
        recordingID: VoiceRecordingID,
        chunkCount: Int,
        hq: VoiceHqFinalizePayload?
    ) async -> CaptureRequestOutcome<VoiceStagingFinalizeResponse> {
        do {
            return await perform(try finalizeRequest(recordingID: recordingID, chunkCount: chunkCount, hq: hq))
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    static func classifyUploadResponse(_ response: HTTPURLResponse, data: Data) -> CaptureRequestOutcome<Bool> {
        CaptureAPI.classify(response: response, data: data) { _ in true }
    }

    private func perform<Value: Decodable>(_ request: URLRequest) async -> CaptureRequestOutcome<Value> {
        do {
            let (data, response) = try await transport.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .rejected(.invalidResponse("The box returned a non-HTTP response."))
            }
            return CaptureAPI.classify(response: http, data: data) { body in
                try JSONDecoder().decode(Value.self, from: body)
            }
        } catch {
            return .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        }
    }
}
