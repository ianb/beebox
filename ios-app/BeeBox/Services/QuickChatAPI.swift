import Foundation

/// The quick chat procedures (contract §5.11), called from native code with the
/// device token. The box screen has no web session mounted, so this is the one
/// native path that sends a chat message without the webview: the server stores,
/// routes, and delivers it in one request.
struct QuickChatAPI {
    enum APIError: LocalizedError, Equatable {
        case invalidResponse
        case server(status: Int, message: String)
        /// The hub's 503 `box_closed`: the box is closed for maintenance.
        case closed(reason: String?)
        /// Any other 503: the hub has no running box to answer.
        case notOpen

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                "The box returned an unexpected response."
            case .server(_, let message):
                message
            case .closed(let reason?):
                "The box is closed for \(reason)."
            case .closed(nil):
                "The box is closed right now."
            case .notOpen:
                "The box is not open right now."
            }
        }

        /// tRPC's answer for a procedure the box does not have: a box from
        /// before it. A missing record is also 404, with a different message.
        var isUnknownProcedure: Bool {
            guard case .server(404, let message) = self else {
                return false
            }
            return message.hasPrefix("No procedure found on path")
        }
    }

    /// The channel the server records on the delivered message, as the share
    /// extension sends.
    static let channel = "ios-native"

    var box: PairedBox
    var transport: any ChatTransport = URLSessionChatTransport()

    /// `origin` is nil for a repeat of a stored id: the server keeps the stored
    /// origin. `hqService` names the phone's HQ pass on a dictated thought.
    func submit(
        id: UUID,
        message: String,
        origin: QuickChatOrigin?,
        source: String? = nil,
        hqService: String? = nil
    ) async throws -> QuickChatView {
        try Self.decodeView(await send(submitRequest(id: id, message: message, origin: origin, source: source, hqService: hqService)))
    }

    func choose(id: UUID, candidateId: String) async throws -> QuickChatView {
        try Self.decodeView(await send(chooseRequest(id: id, candidateId: candidateId)))
    }

    func discard(id: UUID) async throws -> QuickChatView {
        try Self.decodeView(await send(discardRequest(id: id)))
    }

    /// Deliver a stored record again with its own words. Unlike a repeated
    /// `submit`, it needs no message, so it retries a page sent with no note.
    func retry(id: UUID) async throws -> QuickChatView {
        try Self.decodeView(await send(retryRequest(id: id)))
    }

    func home() async throws -> QuickChatHome {
        try Self.decodeHome(await send(homeRequest()))
    }

    func submitRequest(
        id: UUID,
        message: String,
        origin: QuickChatOrigin?,
        source: String? = nil,
        hqService: String? = nil
    ) throws -> URLRequest {
        try mutation(
            "quickChat.submit",
            body: SubmitBody(
                id: Self.wireID(id), message: message, origin: origin, source: source, hqService: hqService, channel: Self.channel
            ),
            timeoutInterval: origin == .external ? 20 : 60
        )
    }

    func chooseRequest(id: UUID, candidateId: String) throws -> URLRequest {
        try mutation("quickChat.choose", body: ChooseBody(id: Self.wireID(id), candidateId: candidateId, channel: Self.channel))
    }

    func discardRequest(id: UUID) throws -> URLRequest {
        try mutation("quickChat.discard", body: DiscardBody(id: Self.wireID(id)))
    }

    func retryRequest(id: UUID) throws -> URLRequest {
        try mutation("quickChat.retry", body: RetryBody(id: Self.wireID(id), channel: Self.channel))
    }

    /// Shorter than URLSession's default 60 s, so a box whose host is asleep
    /// reads as unreachable while the person is still looking.
    func homeRequest() -> URLRequest {
        var request = URLRequest(url: box.apiURL.appendingPathComponent("trpc/quickChat.home"))
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        BoxRequest.apply(to: &request, box: box)
        return request
    }

    static func decodeView(_ data: Data) throws -> QuickChatView {
        try decodeEnvelope(QuickChatView.self, from: data)
    }

    static func decodeHome(_ data: Data) throws -> QuickChatHome {
        try decodeEnvelope(QuickChatHome.self, from: data)
    }

    /// The server's ids are lowercase; the record id becomes the chat message id.
    static func wireID(_ id: UUID) -> String {
        id.uuidString.lowercased()
    }

    private func mutation(_ procedure: String, body: some Encodable, timeoutInterval: TimeInterval = 60) throws -> URLRequest {
        var request = URLRequest(url: box.apiURL.appendingPathComponent("trpc/\(procedure)"))
        request.httpMethod = "POST"
        request.timeoutInterval = timeoutInterval
        BoxRequest.apply(to: &request, box: box)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 503 {
            throw Self.unavailableError(from: data)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: http.statusCode, message: Self.errorMessage(from: data))
        }
        return data
    }

    /// The hub's 503 body (`beebox/src/hub/server/box-unavailable.ts`):
    /// `box_closed` with a short reason, or anything else.
    static func unavailableError(from data: Data) -> APIError {
        guard let body = try? JSONDecoder().decode(UnavailableBody.self, from: data), body.error == "box_closed" else {
            return .notOpen
        }
        let reason = body.reason.map { String($0.prefix(80)) }
        return .closed(reason: reason?.isEmpty == false ? reason : nil)
    }

    /// The tRPC error envelope's message, or a fixed sentence when the body is
    /// not one (a proxy's HTML page, an empty body).
    static func errorMessage(from data: Data) -> String {
        guard let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data),
              envelope.error.message.isEmpty == false else {
            return "The box could not answer."
        }
        return String(envelope.error.message.prefix(300))
    }

    private static func decodeEnvelope<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
        do {
            return try JSONDecoder().decode(Envelope<Value>.self, from: data).result.data
        } catch {
            throw APIError.invalidResponse
        }
    }

    private struct Envelope<Value: Decodable>: Decodable {
        struct Result: Decodable { var data: Value }
        var result: Result
    }

    private struct UnavailableBody: Decodable {
        var error: String
        var reason: String?
    }

    private struct ErrorEnvelope: Decodable {
        struct Body: Decodable { var message: String }
        var error: Body
    }

    private struct SubmitBody: Encodable {
        var id: String
        var message: String
        /// Omitted when nil.
        var origin: QuickChatOrigin?
        var source: String?
        var hqService: String?
        var channel: String
    }

    private struct ChooseBody: Encodable {
        var id: String
        var candidateId: String
        var channel: String
    }

    private struct DiscardBody: Encodable {
        var id: String
    }

    private struct RetryBody: Encodable {
        var id: String
        var channel: String
    }
}
