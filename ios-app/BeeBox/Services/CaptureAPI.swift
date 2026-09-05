import Foundation

protocol CaptureTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
    /// Send a request whose body is a file on disk, streamed rather than read
    /// into memory. Bulk photo batches depend on this: a 70-item batch that
    /// buffered each body would not survive import, let alone upload.
    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> (Data, URLResponse)
}

extension CaptureTransport {
    /// Test-stub default: stubs answer from canned responses and have no file to
    /// read, so this just forwards. Any transport that really talks to a box must
    /// override it — the forwarding version sends no body at all.
    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

struct URLSessionCaptureTransport: CaptureTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }

    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> (Data, URLResponse) {
        try await URLSession.shared.upload(for: request, fromFile: fileURL)
    }
}

struct CaptureCapabilities: Decodable, Equatable, Sendable {
    var acceptedAudioFormats: [CaptureAudioFormat]
    var acceptedUploadEncodings: [String]

    var supportsNativeCapture: Bool {
        acceptedAudioFormats.contains(.m4aAAC) && acceptedUploadEncodings.contains("raw-body-v1")
    }
}

struct CreateCaptureResponse: Decodable, Equatable, Sendable {
    var sessionId: String
    var startedAt: String
    var capabilities: CaptureCapabilities
}

private struct ResumableCapturesResponse: Decodable {
    var resumable: [ResumableCapture]
}

enum CaptureRejection: Equatable, Sendable {
    case badRequest(String)
    case authenticationRequired(String)
    case permissionDenied(String)
    case sessionGone(String)
    case alreadySealed(String)
    case payloadTooLarge(String)
    case unexpected(statusCode: Int, message: String)
    case invalidResponse(String)

    var message: String {
        switch self {
        case .badRequest(let message),
             .authenticationRequired(let message),
             .permissionDenied(let message),
             .sessionGone(let message),
             .alreadySealed(let message),
             .payloadTooLarge(let message),
             .invalidResponse(let message):
            message
        case .unexpected(_, let message):
            message
        }
    }
}

struct CaptureRetry: Equatable, Sendable {
    var message: String
    var retryAfter: String?
}

enum CaptureRequestOutcome<Value> {
    case success(Value)
    case retryable(CaptureRetry)
    case rejected(CaptureRejection)
}

extension CaptureRequestOutcome: Equatable where Value: Equatable {}

extension CaptureRequestOutcome where Value == Bool {
    var uploadFailure: CaptureUploadFailure? {
        switch self {
        case .success:
            nil
        case .retryable(let retry):
            .retryable(message: retry.message)
        case .rejected(let rejection):
            .terminal(message: rejection.message)
        }
    }
}

struct CaptureBackgroundTaskMetadata: Codable, Equatable, Sendable {
    var boxID: UUID
    var sessionID: CaptureSessionID
    var itemID: UUID
    var generation: Int

    var taskDescription: String {
        guard let data = try? JSONEncoder().encode(self) else {
            preconditionFailure("Capture background task metadata must be encodable")
        }
        return data.base64EncodedString()
    }

    init(boxID: UUID, sessionID: CaptureSessionID, itemID: UUID, generation: Int) {
        self.boxID = boxID
        self.sessionID = sessionID
        self.itemID = itemID
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

struct CaptureBackgroundTask: Equatable, Sendable {
    var taskIdentifier: Int
    var metadata: CaptureBackgroundTaskMetadata
}

enum CaptureBackgroundSession {
    static let identifier = "app.beebox.ios.capture-upload-v1"

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        return configuration
    }
}

struct CaptureAPI: Sendable {
    private struct CreateRequestBody: Encodable {
        var targetSessionId: String?
    }

    private struct ErrorBody: Decodable {
        var error: String?
    }

    private struct LifecycleResponse: Decodable, Equatable {
        var success: Bool?
        var sessionId: String?
        var staged: Bool?
    }

    var box: PairedBox
    var transport: any CaptureTransport

    init(box: PairedBox, transport: any CaptureTransport = URLSessionCaptureTransport()) {
        self.box = box
        self.transport = transport
    }

    func createSessionRequest(targetSessionID: String?) throws -> URLRequest {
        var request = authenticatedRequest(url: captureSessionsURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateRequestBody(targetSessionId: targetSessionID))
        return request
    }

    func resumableRequest(targetSessionID: String?, clientSessionID: CaptureSessionID?) -> URLRequest {
        var components = URLComponents(
            url: captureSessionsURL.appendingPathComponent("resumable"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "targetSessionId", value: targetSessionID),
            URLQueryItem(name: "clientSessionId", value: clientSessionID?.rawValue),
        ].filter { $0.value != nil }
        return authenticatedRequest(url: components?.url ?? captureSessionsURL)
    }

    func uploadRequest(sessionID: CaptureSessionID, item: CaptureItem) -> URLRequest {
        let url = captureSessionsURL
            .appendingPathComponent(sessionID.rawValue)
            .appendingPathComponent("upload")
        var request = authenticatedRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(item.filename, forHTTPHeaderField: "X-Capture-Filename")
        request.setValue(item.kind.rawValue, forHTTPHeaderField: "X-Capture-Kind")
        request.setValue(item.capturedAt, forHTTPHeaderField: "X-Capture-Started-At")
        request.setValue(item.source, forHTTPHeaderField: "X-Capture-Source")
        request.setValue(item.mimeType, forHTTPHeaderField: "X-Capture-Mime-Type")
        request.setValue(item.originalName, forHTTPHeaderField: "X-Capture-Original-Name")
        request.setValue(item.audioFormat?.rawValue, forHTTPHeaderField: "X-Capture-Audio-Format")
        request.setValue(item.segmentID, forHTTPHeaderField: "X-Capture-Segment-Id")
        request.setValue(item.segmentStartedAt, forHTTPHeaderField: "X-Capture-Segment-Started-At")
        return request
    }

    func finalizeRequest(sessionID: CaptureSessionID) -> URLRequest {
        var request = authenticatedRequest(
            url: captureSessionsURL.appendingPathComponent(sessionID.rawValue).appendingPathComponent("finalize")
        )
        request.httpMethod = "POST"
        return request
    }

    func cancelRequest(sessionID: CaptureSessionID) -> URLRequest {
        var request = authenticatedRequest(url: captureSessionsURL.appendingPathComponent(sessionID.rawValue))
        request.httpMethod = "DELETE"
        return request
    }

    func createSession(targetSessionID: String?) async -> CaptureRequestOutcome<CreateCaptureResponse> {
        do {
            return await perform(try createSessionRequest(targetSessionID: targetSessionID), as: CreateCaptureResponse.self)
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    func resumableCaptures(
        targetSessionID: String?,
        clientSessionID: CaptureSessionID?
    ) async -> CaptureRequestOutcome<[ResumableCapture]> {
        let result = await perform(
            resumableRequest(targetSessionID: targetSessionID, clientSessionID: clientSessionID),
            as: ResumableCapturesResponse.self
        )
        switch result {
        case .success(let response):
            return .success(response.resumable)
        case .retryable(let retry):
            return .retryable(retry)
        case .rejected(let rejection):
            return .rejected(rejection)
        }
    }

    func finalize(sessionID: CaptureSessionID) async -> CaptureRequestOutcome<Bool> {
        await performLifecycle(finalizeRequest(sessionID: sessionID))
    }

    func cancel(sessionID: CaptureSessionID) async -> CaptureRequestOutcome<Bool> {
        await performLifecycle(cancelRequest(sessionID: sessionID))
    }

    static func classifyUploadResponse(_ response: HTTPURLResponse, data: Data) -> CaptureRequestOutcome<Bool> {
        classify(response: response, data: data) { _ in true }
    }

    private var captureSessionsURL: URL {
        box.apiURL.appendingPathComponent("capture/sessions")
    }

    private func authenticatedRequest(url: URL) -> URLRequest {
        BoxRequest.authenticated(url: url, box: box)
    }

    private func perform<Value: Decodable>(
        _ request: URLRequest,
        as type: Value.Type
    ) async -> CaptureRequestOutcome<Value> {
        do {
            let (data, response) = try await transport.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .rejected(.invalidResponse("The box returned a non-HTTP response."))
            }
            return Self.classify(response: http, data: data) { body in
                try JSONDecoder().decode(type, from: body)
            }
        } catch {
            return .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        }
    }

    private func performLifecycle(_ request: URLRequest) async -> CaptureRequestOutcome<Bool> {
        let result = await perform(request, as: LifecycleResponse.self)
        switch result {
        case .success:
            return .success(true)
        case .retryable(let retry):
            return .retryable(retry)
        case .rejected(let rejection):
            return .rejected(rejection)
        }
    }

    /// Map an HTTP response to the box's shared request-outcome vocabulary.
    /// Internal rather than private because `BulkUploadAPI` classifies the same
    /// way — this is generic box-HTTP handling, not capture-specific.
    static func classify<Value>(
        response: HTTPURLResponse,
        data: Data,
        decode: (Data) throws -> Value
    ) -> CaptureRequestOutcome<Value> {
        let statusCode = response.statusCode
        if (200..<300).contains(statusCode) {
            do {
                return .success(try decode(data))
            } catch {
                return .rejected(.invalidResponse(error.localizedDescription))
            }
        }

        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data).error) ?? "HTTP \(statusCode)"
        if statusCode == 408 || statusCode == 429 || (500..<600).contains(statusCode) {
            return .retryable(CaptureRetry(
                message: message,
                retryAfter: response.value(forHTTPHeaderField: "Retry-After")
            ))
        }
        switch statusCode {
        case 400:
            return .rejected(.badRequest(message))
        case 401:
            return .rejected(.authenticationRequired(message))
        case 403:
            return .rejected(.permissionDenied(message))
        case 404:
            return .rejected(.sessionGone(message))
        case 409:
            return .rejected(.alreadySealed(message))
        case 413:
            return .rejected(.payloadTooLarge(message))
        default:
            return .rejected(.unexpected(statusCode: statusCode, message: message))
        }
    }
}
