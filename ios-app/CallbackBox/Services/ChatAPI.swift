import Foundation

protocol ChatTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
    func upload(
        for request: URLRequest,
        body: Data,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> (Data, URLResponse)
}

extension ChatTransport {
    func upload(
        for request: URLRequest,
        body: Data,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> (Data, URLResponse) {
        var request = request
        request.httpBody = body
        onProgress(0)
        let result = try await data(for: request)
        onProgress(1)
        return result
    }
}

struct URLSessionChatTransport: ChatTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }

    func upload(
        for request: URLRequest,
        body: Data,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = URLSession.shared.uploadTask(with: request, from: body) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let data, let response else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                    return
                }
                onProgress(1)
                continuation.resume(returning: (data, response))
            }
            Task {
                var lastReported = -1.0
                while task.state == .suspended || task.state == .running {
                    let progress = task.progress.fractionCompleted
                    if progress - lastReported >= 0.01 {
                        lastReported = progress
                        onProgress(progress)
                    }
                    try? await Task.sleep(for: .milliseconds(100))
                }
            }
            task.resume()
        }
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

        let requestBytes = request.httpBody?.count ?? 0
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            // Until now a transport failure left no trace at all: the throw
            // surfaced as a composer error with nothing behind it.
            BoxLog.error(
                "transcribe-audio transport failed bytes=\(requestBytes)"
                    + " urlError=\(Self.urlErrorCode(error)): \(error.localizedDescription)",
                category: .composer
            )
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            BoxLog.error("transcribe-audio got a non-HTTP response", category: .composer)
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
            let message = error?.error ?? "HQ transcription failed."
            BoxLog.error(
                "transcribe-audio failed status=\(http.statusCode) bytes=\(request.httpBody?.count ?? 0): \(message)",
                category: .composer
            )
            throw ChatAPIError.server(message)
        }
        do {
            return try JSONDecoder().decode(HqTranscriptionResult.self, from: data)
        } catch {
            BoxLog.error(
                "transcribe-audio response could not be decoded bytes=\(data.count):"
                    + " \(error.localizedDescription)",
                category: .composer
            )
            throw error
        }
    }

    func uploadFile(
        data: Data,
        filename: String,
        mimeType: String,
        onProgress: @escaping @Sendable (Double) -> Void = { _ in }
    ) async throws -> UploadedChatFile {
        var request = try uploadFileRequest(data: data, filename: filename, mimeType: mimeType)
        guard let body = request.httpBody else {
            throw ChatAPIError.invalidResponse
        }
        request.httpBody = nil
        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await transport.upload(
                for: request,
                body: body,
                onProgress: onProgress
            )
        } catch {
            BoxLog.error(
                "file upload transport failed bytes=\(data.count) mime=\(mimeType)"
                    + " urlError=\(Self.urlErrorCode(error)): \(error.localizedDescription)",
                category: .composer
            )
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            BoxLog.error("file upload got a non-HTTP response bytes=\(data.count)", category: .composer)
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: responseData)
            let message = error?.error ?? "File upload failed."
            BoxLog.error(
                "file upload failed status=\(http.statusCode) bytes=\(data.count) mime=\(mimeType): \(message)",
                category: .composer
            )
            throw ChatAPIError.server(message)
        }
        guard let uploaded = try? JSONDecoder().decode(UploadedChatFile.self, from: responseData) else {
            BoxLog.error(
                "file upload response could not be decoded bytes=\(responseData.count)",
                category: .composer
            )
            throw ChatAPIError.invalidResponse
        }
        guard
            uploaded.path.isEmpty == false,
            uploaded.originalName.isEmpty == false,
            uploaded.size >= 0,
            uploaded.mimetype.isEmpty == false
        else {
            BoxLog.error("file upload response was incomplete size=\(uploaded.size)", category: .composer)
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
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            BoxLog.error(
                "default-session lookup transport failed urlError=\(Self.urlErrorCode(error)):"
                    + " \(error.localizedDescription)",
                category: .net
            )
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            BoxLog.error("default-session lookup got a non-HTTP response", category: .net)
            throw ChatAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = "Default-session lookup failed with HTTP status \(http.statusCode)."
            BoxLog.error(
                "default-session lookup failed status=\(http.statusCode)",
                category: .net
            )
            throw ChatAPIError.server(message)
        }
        let result: DefaultSessionResult
        do {
            result = try JSONDecoder().decode(DefaultSessionResult.self, from: data)
        } catch {
            BoxLog.error(
                "default-session response could not be decoded bytes=\(data.count):"
                    + " \(error.localizedDescription)",
                category: .net
            )
            throw error
        }
        return result.sessionId ?? "new"
    }

    /// The `URLError` code behind a thrown transport error, or `none` when the
    /// error is not a `URLError` — metadata only, never the request body.
    private static func urlErrorCode(_ error: Error) -> String {
        guard let urlError = error as? URLError else {
            return "none"
        }
        return String(urlError.code.rawValue)
    }

    private func applyAuth(to request: inout URLRequest) {
        BoxRequest.apply(to: &request, box: box)
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
