import Foundation

struct ShareSaveDestination: Codable, Hashable {
    var kind: String
    var dir: String?
}

struct ShareDestinationRow: Decodable, Hashable, Identifiable {
    var destination: ShareSaveDestination
    var label: String
    var symbol: String?

    var id: String { "\(destination.kind):\(destination.dir ?? "")" }
}

struct ShareChatLandmark: Decodable, Hashable {
    var dir: String
    var label: String
    var symbol: String?
}

struct ShareChatRow: Decodable, Hashable, Identifiable {
    var sessionId: String
    var label: String
    var lastActivity: String
    var landmark: ShareChatLandmark

    var id: String { sessionId }
}

struct ShareDestinations: Decodable {
    var chats: [ShareChatRow]
    var saves: [ShareDestinationRow]
}

struct SharedTextualItem {
    enum Kind: String, Encodable {
        case url
        case text
    }

    var kind: Kind
    var value: String
    var title: String?
}

struct ShareExtensionAPI {
    enum APIError: LocalizedError {
        case invalidResponse
        case server(String)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                "The box returned an unexpected response."
            case .server(let message):
                message
            }
        }
    }

    var box: PairedBox

    func destinations() async throws -> ShareDestinations {
        let data = try await request(path: "trpc/share.destinations", method: "GET", body: nil)
        return try Self.decodeDestinationsEnvelope(data)
    }

    static func decodeDestinationsEnvelope(_ data: Data) throws -> ShareDestinations {
        do {
            return try JSONDecoder().decode(Envelope<ShareDestinations>.self, from: data).result.data
        } catch {
            throw APIError.invalidResponse
        }
    }

    func send(_ item: SharedTextualItem, to sessionID: String, messageID: UUID) async throws {
        let body = try JSONEncoder().encode(ChatSendBody(
            message: item.value,
            messageId: messageID.uuidString,
            session: sessionID,
            exactSession: true
        ))
        _ = try await request(path: "chat/send", method: "POST", body: body)
    }

    func save(
        _ item: SharedTextualItem,
        to destination: ShareSaveDestination,
        shareID: UUID,
        capturedAt: Date
    ) async throws {
        let body: SaveBody
        switch item.kind {
        case .url:
            body = SaveBody(
                kind: item.kind,
                shareId: shareID.uuidString,
                title: item.title,
                capturedAt: ISO8601DateFormatter().string(from: capturedAt),
                destination: destination,
                url: item.value,
                text: nil
            )
        case .text:
            body = SaveBody(
                kind: item.kind,
                shareId: shareID.uuidString,
                title: item.title,
                capturedAt: ISO8601DateFormatter().string(from: capturedAt),
                destination: destination,
                url: nil,
                text: item.value
            )
        }
        let data = try JSONEncoder().encode(body)
        let response = try await request(path: "trpc/share.saveTextual", method: "POST", body: data)
        let saved = try decodeEnvelope(SaveResult.self, from: response)
        if saved.created.count != 1 || saved.created[0].isEmpty {
            throw APIError.invalidResponse
        }
    }

    private func request(path: String, method: String, body: Data?) async throws -> Data {
        var request = URLRequest(url: box.apiURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("CallbackBox-iOS-Share/0.1", forHTTPHeaderField: "User-Agent")
        if let token = box.authToken, token.isEmpty == false {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Request failed."
            throw APIError.server(String(message.prefix(300)))
        }
        return data
    }

    private func decodeEnvelope<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
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

    private struct ChatSendBody: Encodable {
        var message: String
        var messageId: String
        var session: String
        var exactSession: Bool
    }

    private struct SaveBody: Encodable {
        var kind: SharedTextualItem.Kind
        var shareId: String
        var title: String?
        var capturedAt: String
        var destination: ShareSaveDestination
        var url: String?
        var text: String?
    }

    private struct SaveResult: Decodable {
        var created: [String]
    }
}
