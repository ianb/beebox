import XCTest
@testable import BeeBox

final class ChatAPITests: XCTestCase {
    func testUploadRequestCarriesAuthAndSanitizedMultipartMetadata() throws {
        let api = ChatAPI(box: makeBox(), transport: StubChatTransport())
        let request = try api.uploadFileRequest(
            data: Data("contents".utf8),
            filename: "../report\"\r\n.pdf",
            mimeType: "application/pdf",
            batch: nil
        )

        XCTAssertEqual(request.url?.path, "/box/api/chat/upload-file")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = try XCTUnwrap(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(body.contains("filename=\"report___.pdf\""))
        XCTAssertTrue(body.contains("Content-Type: application/pdf"))
        XCTAssertTrue(body.contains("contents"))
        // A draft restored from before batches existed uploads without the field.
        XCTAssertFalse(body.contains("name=\"batch\""))
    }

    /// The `batch` text field files the upload under one directory per composed
    /// message, and it MUST precede the file part: the server reads text fields
    /// off the file's own multipart entry, so a later field is invisible.
    func testUploadRequestPlacesTheBatchFieldBeforeTheFilePart() throws {
        let api = ChatAPI(box: makeBox(), transport: StubChatTransport())
        let request = try api.uploadFileRequest(
            data: Data("contents".utf8),
            filename: "report.pdf",
            mimeType: "application/pdf",
            batch: "aB3-_xYz01234567"
        )

        let body = try XCTUnwrap(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        let batchField = try XCTUnwrap(body.range(of: "Content-Disposition: form-data; name=\"batch\"\r\n\r\naB3-_xYz01234567\r\n"))
        let fileField = try XCTUnwrap(body.range(of: "name=\"file\"; filename=\"report.pdf\""))
        XCTAssertTrue(batchField.upperBound <= fileField.lowerBound, "batch must be written before the file part")
    }

    func testUploadDecodesCanonicalResponse() async throws {
        let response = Data(#"{"path":"_tmp/report.pdf","originalName":"report.pdf","size":8,"mimetype":"application/pdf"}"#.utf8)
        let transport = StubChatTransport(data: response)

        let progress = ProgressRecorder()
        let uploaded = try await ChatAPI(box: makeBox(), transport: transport).uploadFile(
            data: Data("contents".utf8),
            filename: "report.pdf",
            mimeType: "application/pdf",
            batch: "batch0123456789a",
            onProgress: { value in
                progress.append(value)
            }
        )

        XCTAssertEqual(uploaded.path, "_tmp/report.pdf")
        XCTAssertEqual(uploaded.size, 8)
        XCTAssertEqual(progress.values, [0, 1])
    }

    func testUploadRejectsMalformedResponseAndOversizeInput() async {
        let malformed = StubChatTransport(data: Data(#"{"path":"","originalName":"x","size":1,"mimetype":"text/plain"}"#.utf8))
        await XCTAssertThrowsErrorAsync {
            _ = try await ChatAPI(box: makeBox(), transport: malformed).uploadFile(
                data: Data("x".utf8),
                filename: "x.txt",
                mimeType: "text/plain",
                batch: nil
            )
        }

        let api = ChatAPI(box: makeBox(), transport: StubChatTransport())
        XCTAssertThrowsError(
            try api.uploadFileRequest(
                data: Data(count: ChatUploadLimits.maximumFileBytes + 1),
                filename: "large.bin",
                mimeType: "application/octet-stream",
                batch: nil
            )
        )
    }

    func testDefaultSessionFailureDoesNotStartNewSession() async {
        let transport = StubChatTransport(statusCode: 503)

        do {
            _ = try await ChatAPI(box: makeBox(), transport: transport).transcribeAudio(
                fileURL: URL(fileURLWithPath: "/missing.wav")
            )
            XCTFail("Expected default-session failure")
        } catch let error as ChatAPI.ChatAPIError {
            XCTAssertEqual(error.errorDescription, "Default-session lookup failed with HTTP status 503.")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeBox() -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: "secret",
            requiresDeviceUnlock: false
        )
    }
}

private final class ProgressRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Double] = []

    var values: [Double] {
        lock.withLock { recorded }
    }

    func append(_ value: Double) {
        lock.withLock {
            recorded.append(value)
        }
    }
}

private struct StubChatTransport: ChatTransport {
    var statusCode = 200
    var data = Data(#"{"path":"_tmp/x","originalName":"x","size":1,"mimetype":"text/plain"}"#.utf8)

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        return (data, response)
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        // Expected.
    }
}
