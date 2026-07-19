import XCTest
@testable import CallbackBox

final class ChatAPITests: XCTestCase {
    func testUploadRequestCarriesAuthAndSanitizedMultipartMetadata() throws {
        let api = ChatAPI(box: makeBox(), transport: StubChatTransport())
        let request = try api.uploadFileRequest(
            data: Data("contents".utf8),
            filename: "../report\"\r\n.pdf",
            mimeType: "application/pdf"
        )

        XCTAssertEqual(request.url?.path, "/box/api/chat/upload-file")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = try XCTUnwrap(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(body.contains("filename=\"report___.pdf\""))
        XCTAssertTrue(body.contains("Content-Type: application/pdf"))
        XCTAssertTrue(body.contains("contents"))
    }

    func testUploadDecodesCanonicalResponse() async throws {
        let response = Data(#"{"path":"tmp/report.pdf","originalName":"report.pdf","size":8,"mimetype":"application/pdf"}"#.utf8)
        let transport = StubChatTransport(data: response)

        let uploaded = try await ChatAPI(box: makeBox(), transport: transport).uploadFile(
            data: Data("contents".utf8),
            filename: "report.pdf",
            mimeType: "application/pdf"
        )

        XCTAssertEqual(uploaded.path, "tmp/report.pdf")
        XCTAssertEqual(uploaded.size, 8)
    }

    func testUploadRejectsMalformedResponseAndOversizeInput() async {
        let malformed = StubChatTransport(data: Data(#"{"path":"","originalName":"x","size":1,"mimetype":"text/plain"}"#.utf8))
        await XCTAssertThrowsErrorAsync {
            _ = try await ChatAPI(box: makeBox(), transport: malformed).uploadFile(
                data: Data("x".utf8),
                filename: "x.txt",
                mimeType: "text/plain"
            )
        }

        let api = ChatAPI(box: makeBox(), transport: StubChatTransport())
        XCTAssertThrowsError(
            try api.uploadFileRequest(
                data: Data(count: ChatUploadLimits.maximumFileBytes + 1),
                filename: "large.bin",
                mimeType: "application/octet-stream"
            )
        )
    }

    private func makeBox() -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: "secret"
        )
    }
}

private struct StubChatTransport: ChatTransport {
    var statusCode = 200
    var data = Data(#"{"path":"tmp/x","originalName":"x","size":1,"mimetype":"text/plain"}"#.utf8)

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
