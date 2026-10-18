import BeeBoxMacCore
import BeeBoxShared
import Foundation
import XCTest

/// One sweep against a real box, to check the Swift client against the real
/// scan routes rather than a fake written from the contract. Skipped unless
/// `BEEBOX_LIVE_SCAN_URL` (a test box's base URL) and `BEEBOX_LIVE_SCAN_TOKEN`
/// (a scan token minted on that box) are set. Use only a test box.
final class LiveScanSweepTests: XCTestCase {
    func testOneFileUploadsThenReadsAsDuplicate() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let base = env["BEEBOX_LIVE_SCAN_URL"].flatMap(URL.init(string:)),
              let token = env["BEEBOX_LIVE_SCAN_TOKEN"] else {
            throw XCTSkip("set BEEBOX_LIVE_SCAN_URL and BEEBOX_LIVE_SCAN_TOKEN to run against a test box")
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("beebox-live-scan-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        // A minimal valid PDF, unique per run so the box has not seen it.
        let pdf = """
            %PDF-1.4
            1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
            2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
            3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
            % live-scan \(UUID().uuidString)
            trailer << /Root 1 0 R >>
            %%EOF
            """
        let file = folder.appendingPathComponent("live-scan.pdf")
        try Data(pdf.utf8).write(to: file)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-60)], ofItemAtPath: file.path)

        let sweep = ScanSweep(
            transport: URLSessionTransport(session: .shared),
            clientBuild: "mac-live-test",
            now: { Date() },
            sleep: { _ in }
        )
        let target = UploadTarget(folder: folder, baseURL: base, scanToken: token, disposition: .keep)

        let first = await sweep.run(target, retryRejected: false)
        XCTAssertNil(first.standingProblem, "\(first)")
        XCTAssertEqual(first.uploaded + first.rejected, 1, "\(first)")
        XCTAssertNotNil(first.contractVersion)
        XCTAssertEqual(first.contractVersion, scanContractVersion)

        let second = await sweep.run(target, retryRejected: false)
        XCTAssertNil(second.standingProblem, "\(second)")
        XCTAssertEqual(second.uploaded, 0, "\(second)")
    }
}
