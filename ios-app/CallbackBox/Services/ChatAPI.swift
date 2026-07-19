import Foundation

protocol ChatTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionChatTransport: ChatTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}

enum ChatUploadLimits {
    static let maximumFileBytes = 50 * 1024 * 1024
}

struct UploadedChatFile: Decodable, Equatable, Sendable {
    var path: String
    var originalName: String
    var size: Int
    var mimetype: String
}

struct ChatAPI: Sendable {
    enum ChatAPIError: LocalizedError {
        case invalidResponse
        case fileTooLarge
        case server(String)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                "The box returned an unexpected response."
            case .fileTooLarge:
                "Files must be 50 MB or smaller."
            case .server(let message):
                message
            }
        }
    }

    var box: PairedBox
    var transport: any ChatTransport

    init(box: PairedBox, transport: any ChatTransport = URLSessionChatTransport()) {
        self.box = box
        self.transport = transport
    }

    struct HqTranscriptionResult: Decodable, Equatable {
        var text: String
        var diarized: Bool
    }

    func transcribeAudio(fileURL: URL) async throws -> HqTranscriptionResult {
        let session = try await resolvedSession()
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/transcribe-audio"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        applyAuth(to: &request)
        request.httpBody = try multipartAudioBody(fileURL: fileURL, session: session, boundary: boundary)

        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw ChatAPIError.server(error?.error ?? "HQ transcription failed.")
        }
        return try JSONDecoder().decode(HqTranscriptionResult.self, from: data)
    }

    func uploadFile(data: Data, filename: String, mimeType: String) async throws -> UploadedChatFile {
        let request = try uploadFileRequest(data: data, filename: filename, mimeType: mimeType)
        let (responseData, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: responseData)
            throw ChatAPIError.server(error?.error ?? "File upload failed.")
        }
        guard let uploaded = try? JSONDecoder().decode(UploadedChatFile.self, from: responseData) else {
            throw ChatAPIError.invalidResponse
        }
        guard
            uploaded.path.isEmpty == false,
            uploaded.originalName.isEmpty == false,
            uploaded.size >= 0,
            uploaded.mimetype.isEmpty == false
        else {
            throw ChatAPIError.invalidResponse
        }
        return uploaded
    }

    func uploadFileRequest(data: Data, filename: String, mimeType: String) throws -> URLRequest {
        guard data.count <= ChatUploadLimits.maximumFileBytes else {
            throw ChatAPIError.fileTooLarge
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/upload-file"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        applyAuth(to: &request)
        var body = Data()
        body.appendMultipartFile(
            name: "file",
            filename: Self.safeMultipartFilename(filename),
            contentType: mimeType,
            data: data,
            boundary: boundary
        )
        body.appendString("--\(boundary)--\r\n")
        request.httpBody = body
        return request
    }

    private func resolvedSession() async throws -> String {
        if let sessionID = box.sessionID, sessionID.isEmpty == false {
            return sessionID
        }
        var request = URLRequest(url: box.apiURL.appendingPathComponent("chat/default"))
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        applyAuth(to: &request)
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            return "new"
        }
        let result = try JSONDecoder().decode(DefaultSessionResult.self, from: data)
        return result.sessionId ?? "new"
    }

    private func applyAuth(to request: inout URLRequest) {
        guard let token = box.authToken, token.isEmpty == false else {
            return
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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

    private static func safeMultipartFilename(_ filename: String) -> String {
        let leaf = (filename as NSString).lastPathComponent
        let safe = leaf.replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
        return safe.isEmpty ? "attachment" : safe
    }
}

private struct DefaultSessionResult: Decodable {
    var sessionId: String?
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
