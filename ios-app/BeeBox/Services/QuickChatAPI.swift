import Foundation

/// The quick chat procedures (contract §5.11), called from native code with the
/// device token. The box screen has no web session mounted, so this is the one
/// native path that sends a chat message without the webview: the server stores,
/// routes, and delivers it in one request.
struct QuickChatAPI {
    enum APIError: LocalizedError, Equatable {
        case invalidResponse
        case server(status: Int, message: String)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                "The box returned an unexpected response."
            case .server(_, let message):
                message
            }
        }
    }

    /// The channel the server records on the delivered message, as the share
    /// extension sends.
    static let channel = "ios-native"

    var box: PairedBox
    var transport: any ChatTransport = URLSessionChatTransport()

    /// `origin` is nil for a repeat of a stored id: the server keeps the stored origin.
    func submit(id: UUID, message: String, origin: QuickChatOrigin?, source: String? = nil) async throws -> QuickChatView {
        try Self.decodeView(await send(submitRequest(id: id, message: message, origin: origin, source: source)))
    }

    func choose(id: UUID, candidateId: String) async throws -> QuickChatView {
        try Self.decodeView(await send(chooseRequest(id: id, candidateId: candidateId)))
    }

    func discard(id: UUID) async throws -> QuickChatView {
        try Self.decodeView(await send(discardRequest(id: id)))
    }

    func home() async throws -> QuickChatHome {
        try Self.decodeHome(await send(homeRequest()))
    }

    func submitRequest(id: UUID, message: String, origin: QuickChatOrigin?, source: String? = nil) throws -> URLRequest {
        try mutation(
            "quickChat.submit",
            body: SubmitBody(id: Self.wireID(id), message: message, origin: origin, source: source, channel: Self.channel),
            timeoutInterval: origin == .external ? 20 : 60
        )
    }

    func chooseRequest(id: UUID, candidateId: String) throws -> URLRequest {
        try mutation("quickChat.choose", body: ChooseBody(id: Self.wireID(id), candidateId: candidateId, channel: Self.channel))
    }

    func discardRequest(id: UUID) throws -> URLRequest {
        try mutation("quickChat.discard", body: DiscardBody(id: Self.wireID(id)))
    }

    func homeRequest() -> URLRequest {
        var request = URLRequest(url: box.apiURL.appendingPathComponent("trpc/quickChat.home"))
        request.httpMethod = "GET"
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
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: http.statusCode, message: Self.errorMessage(from: data))
        }
        return data
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
}
