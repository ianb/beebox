import Foundation

/// Request shaping for the box's bulk file-upload endpoints (`/api/bulk/...`),
/// documented in `callback-box/docs/mobile-contract.md` §5.6.
///
/// This is the native client that section reserved: the server contract is
/// uploader-agnostic, and the web overlay is the other implementation of these
/// same rows. A batch is created against a target chat, its items are declared
/// up front, each item's bytes are streamed to its own endpoint, and finalize
/// seals the batch so the box lands an `upload-batch` card and injects an
/// `<upload>` message.
///
/// Deliberately NOT built on `CaptureAPI`: composer attachments must not route
/// through capture staging (`ios-app/CLAUDE.md`), and the bulk plan chose a
/// dedicated uploader over a parameterized capture coordinator
/// (`docs/implemented-plans/bulk-file-upload.md` §4). It does reuse capture's
/// HTTP outcome vocabulary — `CaptureRequestOutcome` / `CaptureRejection` /
/// `CaptureRetry` / `CaptureTransport` — because that is generic box-HTTP
/// classification rather than anything capture-specific; the `Capture` prefix is
/// historical (see `issues/code-quality/` for the rename).
struct BulkUploadAPI: Sendable {
    /// One item declared in the batch registry before its bytes are sent.
    struct Item: Encodable, Equatable, Sendable {
        var id: String
        var name: String
        var size: Int?
        var mimetype: String?
    }

    /// An item the uploader gave up on, reported at finalize so the batch names
    /// it rather than leaving it silently missing.
    struct FailedItem: Encodable, Equatable, Sendable {
        var id: String?
        var name: String
        var reason: String
    }

    struct Capabilities: Decodable, Equatable, Sendable {
        var acceptedUploadEncodings: [String]

        var supportsRawBodyUpload: Bool {
            acceptedUploadEncodings.contains("raw-body-v1")
        }
    }

    struct CreateResponse: Decodable, Equatable, Sendable {
        var sessionId: String
        var startedAt: String
        var capabilities: Capabilities
    }

    struct RegisterResponse: Decodable, Equatable, Sendable {
        var registered: Int
    }

    /// A registry item as the status endpoint reports it back.
    struct RegisteredItem: Decodable, Equatable, Sendable {
        var id: String
        var name: String
    }

    /// An item the box has actually received bytes for.
    struct ReceivedItem: Decodable, Equatable, Sendable {
        var itemId: String?
        var name: String
        var size: Int?
    }

    /// Resume state: what the box expects versus what actually arrived. The
    /// difference is what a relaunched uploader still has to send.
    struct StatusResponse: Decodable, Equatable, Sendable {
        var sessionId: String
        var state: String
        var targetSessionId: String?
        var registered: [RegisteredItem]
        var received: [ReceivedItem]

        /// Ids whose bytes the box already holds — the ones a resume must skip.
        var receivedItemIDs: Set<String> {
            Set(received.compactMap { $0.itemId })
        }
    }

    private struct CreateBody: Encodable {
        var targetSessionId: String
        var items: [Item]?
    }

    private struct RegisterBody: Encodable {
        var items: [Item]
    }

    private struct FinalizeBody: Encodable {
        var failedItems: [FailedItem]
        var note: String?
    }

    private struct LifecycleResponse: Decodable, Equatable {
        var sessionId: String?
        var staged: Bool?
        var success: Bool?
    }

    var box: PairedBox
    var transport: any CaptureTransport

    init(box: PairedBox, transport: any CaptureTransport = URLSessionCaptureTransport()) {
        self.box = box
        self.transport = transport
    }

    // MARK: - Request shaping

    func createSessionRequest(targetSessionID: String, items: [Item]) throws -> URLRequest {
        var request = authenticatedRequest(url: sessionsURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            CreateBody(targetSessionId: targetSessionID, items: items.isEmpty ? nil : items)
        )
        return request
    }

    func registerItemsRequest(sessionID: String, items: [Item]) throws -> URLRequest {
        var request = authenticatedRequest(url: itemsURL(sessionID: sessionID))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RegisterBody(items: items))
        return request
    }

    /// The per-item upload. The body is the raw bytes — **never multipart** — so
    /// a background `URLSession` can stream it straight from a file instead of
    /// building it in memory, which is what makes a 70-photo batch survive.
    func uploadRequest(sessionID: String, item: PreparedBulkItem) -> URLRequest {
        let url = itemsURL(sessionID: sessionID)
            .appendingPathComponent(item.id)
            .appendingPathComponent("upload")
        var request = authenticatedRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(item.stagedFilename, forHTTPHeaderField: "X-Upload-Filename")
        request.setValue(item.originalName, forHTTPHeaderField: "X-Upload-Original-Name")
        request.setValue(item.mimeType, forHTTPHeaderField: "X-Upload-Mime-Type")
        request.setValue(item.uploadedAt, forHTTPHeaderField: "X-Upload-Uploaded-At")
        return request
    }

    func statusRequest(sessionID: String) -> URLRequest {
        authenticatedRequest(url: sessionsURL.appendingPathComponent(sessionID))
    }

    func finalizeRequest(sessionID: String, failedItems: [FailedItem], note: String?) throws -> URLRequest {
        var request = authenticatedRequest(
            url: sessionsURL.appendingPathComponent(sessionID).appendingPathComponent("finalize")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // A blank note is sent as none at all, so an empty composer produces a
        // batch indistinguishable from one that never carried an introduction.
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        request.httpBody = try JSONEncoder().encode(
            FinalizeBody(failedItems: failedItems, note: (trimmed?.isEmpty == false) ? trimmed : nil)
        )
        return request
    }

    func cancelRequest(sessionID: String) -> URLRequest {
        var request = authenticatedRequest(url: sessionsURL.appendingPathComponent(sessionID))
        request.httpMethod = "DELETE"
        return request
    }

    // MARK: - Calls

    func createSession(targetSessionID: String, items: [Item]) async -> CaptureRequestOutcome<CreateResponse> {
        do {
            return await perform(try createSessionRequest(targetSessionID: targetSessionID, items: items), as: CreateResponse.self)
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    func registerItems(sessionID: String, items: [Item]) async -> CaptureRequestOutcome<RegisterResponse> {
        do {
            return await perform(try registerItemsRequest(sessionID: sessionID, items: items), as: RegisterResponse.self)
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    func status(sessionID: String) async -> CaptureRequestOutcome<StatusResponse> {
        await perform(statusRequest(sessionID: sessionID), as: StatusResponse.self)
    }

    func finalize(sessionID: String, failedItems: [FailedItem], note: String?) async -> CaptureRequestOutcome<Bool> {
        do {
            let request = try finalizeRequest(sessionID: sessionID, failedItems: failedItems, note: note)
            return await performLifecycle(request)
        } catch {
            return .rejected(.invalidResponse(error.localizedDescription))
        }
    }

    func cancel(sessionID: String) async -> CaptureRequestOutcome<Bool> {
        await performLifecycle(cancelRequest(sessionID: sessionID))
    }

    /// Classify one item-upload response. A 409 here is usually the server's
    /// concurrency gate ("too many concurrent uploads for this batch"), which is
    /// a *retry shortly*, not a terminal rejection — see `classifyUploadResponse`.
    static func classifyUploadResponse(_ response: HTTPURLResponse, data: Data) -> CaptureRequestOutcome<Bool> {
        let outcome = CaptureAPI.classify(response: response, data: data) { _ in true }
        // The bulk upload route uses 409 for three different things: a sealed
        // session and an unregistered item (both terminal), and back-pressure
        // (retryable). Only the back-pressure case should re-queue, so it is told
        // apart by the server's message rather than the status code alone.
        if case .rejected(.alreadySealed(let message)) = outcome, isConcurrencyBackPressure(message) {
            return .retryable(CaptureRetry(message: message, retryAfter: nil))
        }
        return outcome
    }

    /// True for the server's concurrent-stream back-pressure message
    /// (`bulk-upload.ts`: "Too many concurrent uploads for this batch; retry
    /// shortly", and the per-item "already uploading" guard).
    static func isConcurrencyBackPressure(_ message: String) -> Bool {
        let lowered = message.lowercased()
        return lowered.contains("too many concurrent uploads") || lowered.contains("already uploading")
    }

    // MARK: - Internals

    private var sessionsURL: URL {
        box.apiURL.appendingPathComponent("bulk/sessions")
    }

    private func itemsURL(sessionID: String) -> URL {
        sessionsURL.appendingPathComponent(sessionID).appendingPathComponent("items")
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
            return CaptureAPI.classify(response: http, data: data) { body in
                try JSONDecoder().decode(type, from: body)
            }
        } catch {
            return .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        }
    }

    private func performLifecycle(_ request: URLRequest) async -> CaptureRequestOutcome<Bool> {
        switch await perform(request, as: LifecycleResponse.self) {
        case .success:
            return .success(true)
        case .retryable(let retry):
            return .retryable(retry)
        case .rejected(let rejection):
            return .rejected(rejection)
        }
    }
}

/// One photo staged on disk and ready to upload: the bytes live in a file the
/// app owns, so the upload task streams them rather than holding them in memory.
struct PreparedBulkItem: Equatable, Sendable {
    /// Registry id — the batch's stable handle for this item, server-side too.
    var id: String
    /// Where the bytes live locally until the upload succeeds.
    var fileURL: URL
    /// Staged name, and the server's idempotency key for a retry of these bytes.
    var stagedFilename: String
    /// The name the user would recognise; preserved into the landed batch.
    var originalName: String
    var mimeType: String
    var uploadedAt: String
    var size: Int

    var registryItem: BulkUploadAPI.Item {
        BulkUploadAPI.Item(id: id, name: originalName, size: size, mimetype: mimeType)
    }
}
