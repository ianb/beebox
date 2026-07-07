import Foundation

struct ChatAPI {
    enum SendState: Equatable {
        case sent
        case queued
        case deduplicated
    }

    enum ChatAPIError: LocalizedError {
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

    struct HqTranscriptionResult: Decodable, Equatable {
        var text: String
        var diarized: Bool
    }

    func send(
        message: String,
        messageId: String,
        origin: QueuedMessage.Origin,
        diarized: Bool,
        images: [ChatImageAttachment]
    ) async throws -> SendState {
        let session = try await resolvedSession()
        let body = SendBody(
            session: session,
            message: assembleMessage(message, origin: origin, diarized: diarized),
            messageId: messageId,
            images: images.isEmpty ? nil : images
        )
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/send"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw ChatAPIError.server(error?.error ?? "Chat send failed.")
        }
        let result = try JSONDecoder().decode(SendResult.self, from: data)
        if result.queued == true {
            return .queued
        }
        if result.deduplicated == true {
            return .deduplicated
        }
        return .sent
    }

    func transcribeAudio(fileURL: URL) async throws -> HqTranscriptionResult {
        let session = try await resolvedSession()
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/transcribe-audio"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        request.httpBody = try multipartAudioBody(fileURL: fileURL, session: session, boundary: boundary)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw ChatAPIError.server(error?.error ?? "HQ transcription failed.")
        }
        return try JSONDecoder().decode(HqTranscriptionResult.self, from: data)
    }

    private func resolvedSession() async throws -> String {
        if let sessionID = box.sessionID, sessionID.isEmpty == false {
            return sessionID
        }
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/default"))
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            return "new"
        }
        let result = try JSONDecoder().decode(DefaultSessionResult.self, from: data)
        return result.sessionId ?? "new"
    }

    private func assembleMessage(_ message: String, origin: QueuedMessage.Origin, diarized: Bool) -> String {
        let tag = origin == .voice ? "speech" : "typed"
        let diarizedAttr = origin == .voice && diarized ? " diarized=\"1\"" : ""
        let attrs = "\(diarizedAttr) local-time=\"\(Self.localTimeString())\""
        return "<\(tag)\(attrs)>\(message)</\(tag)>"
    }

    private func multipartAudioBody(fileURL: URL, session: String, boundary: String) throws -> Data {
        let audioData = try Data(contentsOf: fileURL)
        var body = Data()
        body.appendMultipartField(name: "session", value: session, boundary: boundary)
        body.appendMultipartFile(
            name: "file",
            filename: "segment.wav",
            contentType: "audio/wav",
            data: audioData,
            boundary: boundary
        )
        body.appendString("--\(boundary)--\r\n")
        return body
    }

    private static func localTimeString() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date())
    }
}

private struct DefaultSessionResult: Decodable {
    var sessionId: String?
}

private struct SendBody: Encodable {
    var session: String
    var message: String
    var messageId: String
    var images: [ChatImageAttachment]?
}

private struct SendResult: Decodable {
    var turnId: String?
    var queued: Bool?
    var deduplicated: Bool?
}

private struct ErrorBody: Decodable {
    var error: String?
}

private extension Data {
    mutating func appendMultipartField(name: String, value: String, boundary: String) {
        appendString("--\(boundary)\r\n")
        appendString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        appendString("\(value)\r\n")
    }

    mutating func appendMultipartFile(
        name: String,
        filename: String,
        contentType: String,
        data: Data,
        boundary: String
    ) {
        appendString("--\(boundary)\r\n")
        appendString("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        appendString("Content-Type: \(contentType)\r\n\r\n")
        append(data)
        appendString("\r\n")
    }

    mutating func appendString(_ value: String) {
        append(Data(value.utf8))
    }
}
