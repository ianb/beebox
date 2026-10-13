import Foundation

protocol QuickCaptureTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}
struct URLSessionQuickCaptureTransport: QuickCaptureTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}

struct QuickCaptureCapabilities: Codable {
    var version: Int
    var maxFileBytes: Int
    var maxInputCharacters: Int
    var materialKinds: [String]
}

struct QuickCaptureRemoteRecord: Codable, Identifiable {
    var id: UUID
    var state: String
    var capturedAt: String?
    var source: String?
    var input: String?
    var material: QuickCaptureMaterial?
    var parentCaptureId: UUID?
    var sourceRef: String?
    var transcript: String?
    var error: String?
    var delivery: QuickChatView?
    var recordingInterrupted: Bool?
}

struct QuickCaptureReceipt: Codable {
    var id: UUID
    var state: String
}

struct QuickCaptureAPI {
    var box: PairedBox
    var transport: any QuickCaptureTransport = URLSessionQuickCaptureTransport()

    enum APIError: LocalizedError {
        case invalidResponse, unsupported, server(Int, String)
        var errorDescription: String? {
            switch self {
            case .invalidResponse: "The box returned an unexpected capture response."
            case .unsupported: "This box does not support quick capture yet."
            case .server(_, let message): message
            }
        }
    }

    static func decodeDeclaration(_ data: Data) throws -> QuickCaptureDeclaration {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys).isSubset(of: ["version", "capturedAt", "source", "input", "material", "parentCaptureId", "recordingInterrupted"]) else { throw APIError.invalidResponse }
        if let material = object["material"] as? [String: Any] {
            guard Set(material.keys).isSubset(of: ["kind", "url", "text", "title", "id", "mimeType", "byteLength", "sha256", "fileName"]) else { throw APIError.invalidResponse }
        }
        let declaration = try JSONDecoder().decode(QuickCaptureDeclaration.self, from: data)
        try declaration.validate()
        return declaration
    }
    static func decodeReceipt(_ data: Data) throws -> QuickCaptureReceipt {
        let receipt = try JSONDecoder().decode(QuickCaptureReceipt.self, from: data)
        guard receipt.state == "accepted" else { throw APIError.invalidResponse }
        return receipt
    }

    func capabilities() async throws -> QuickCaptureCapabilities {
        try await query("capabilities", query: nil)
    }
    func detail(id: UUID) async throws -> QuickCaptureRemoteRecord {
        try await query("detail", query: ["id": id.uuidString.lowercased()])
    }
    func list() async throws -> [QuickCaptureRemoteRecord] {
        struct List: Decodable { var captures: [QuickCaptureRemoteRecord] }
        let list: List = try await query("list", query: nil)
        return list.captures
    }
    func retry(id: UUID) async throws -> QuickCaptureRemoteRecord {
        try await mutation("retry", input: ["id": id.uuidString.lowercased()])
    }
    func choose(id: UUID, candidateID: String) async throws -> QuickCaptureRemoteRecord {
        try await mutation("choose", input: ["id": id.uuidString.lowercased(), "candidateId": candidateID])
    }
    func delete(id: UUID) async throws -> QuickCaptureRemoteRecord {
        try await mutation("delete", input: ["id": id.uuidString.lowercased()])
    }

    func acceptanceRequest(id: UUID, boundary: String) -> URLRequest {
        var request = BoxRequest.authenticated(url: box.apiURL.appendingPathComponent("quick-captures/\(id.uuidString.lowercased())"), box: box)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        return request
    }

    private func query<T: Decodable>(_ name: String, query: [String: String]?) async throws -> T {
        var components = URLComponents(url: box.apiURL.appendingPathComponent("trpc/quickCapture.\(name)"), resolvingAgainstBaseURL: false)!
        if let query {
            let bytes = try JSONSerialization.data(withJSONObject: query)
            components.queryItems = [URLQueryItem(name: "input", value: String(decoding: bytes, as: UTF8.self))]
        }
        return try await send(BoxRequest.authenticated(url: components.url!, box: box))
    }

    private func mutation<T: Decodable>(_ name: String, input: [String: String]) async throws -> T {
        var request = BoxRequest.authenticated(url: box.apiURL.appendingPathComponent("trpc/quickCapture.\(name)"), box: box)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: input)
        return try await send(request)
    }

    private static func errorMessage(from data: Data) -> String {
        struct Failure: Decodable {
            struct Details: Decodable { var message: String }
            var error: Details
        }
        guard let failure = try? JSONDecoder().decode(Failure.self, from: data) else { return "The box could not answer." }
        return String(failure.error.message.prefix(300))
    }

    private struct Envelope<Value: Decodable>: Decodable {
        struct Result: Decodable { var data: Value }
        var result: Result
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            throw APIError.server(response.statusCode, Self.errorMessage(from: data))
        }
        return try JSONDecoder().decode(Envelope<T>.self, from: data).result.data
    }
}

/// Cached limits are advisory preflight; the server validates every complete request.
struct QuickCaptureCapabilityCache {
    private let defaults: UserDefaults?
    init(defaults: UserDefaults? = UserDefaults(suiteName: QuickCaptureStore.group)) { self.defaults = defaults }
    func save(_ capabilities: QuickCaptureCapabilities, boxID: UUID) throws {
        defaults?.set(try JSONEncoder().encode(capabilities), forKey: "quickCaptureCapabilities.\(boxID.uuidString)")
    }
    func read(boxID: UUID) -> QuickCaptureCapabilities? {
        guard let data = defaults?.data(forKey: "quickCaptureCapabilities.\(boxID.uuidString)") else { return nil }
        return try? JSONDecoder().decode(QuickCaptureCapabilities.self, from: data)
    }
    func maxFileBytes(boxID: UUID) -> Int { read(boxID: boxID)?.maxFileBytes ?? 25 * 1_024 * 1_024 }
}
