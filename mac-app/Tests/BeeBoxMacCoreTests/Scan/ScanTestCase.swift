import CryptoKit
import Foundation
import XCTest

@testable import BeeBoxMacCore

/// A clock the test moves. `sleep` advances it, so a settle-retry round sees
/// files that have aged by the wait without anyone sleeping for real.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date
    private var slept: [Duration] = []

    init(_ start: Date) { current = start }

    var now: Date { lock.withLock { current } }
    var sleeps: [Duration] { lock.withLock { slept } }

    func sleep(_ duration: Duration) {
        lock.withLock {
            slept.append(duration)
            let parts = duration.components
            current = current.addingTimeInterval(Double(parts.seconds) + Double(parts.attoseconds) / 1e18)
        }
    }
}

final class TrashRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []
    var failWith: Error?

    var trashed: [URL] { lock.withLock { urls } }

    func trash(_ url: URL) throws {
        if let failWith { throw failWith }
        lock.withLock { urls.append(url) }
    }
}

struct TrashFailure: Error {}

/// Real temp folders, a fake box, and a controlled clock. Whole-second
/// timestamps keep the settle boundary exact in floating point.
class ScanTestCase: XCTestCase {
    static let epoch = Date(timeIntervalSince1970: 1_800_000_000)

    var folder: URL!
    var server: FakeScanServer!
    var clock: TestClock!
    var trashRecorder: TrashRecorder!
    let baseURL = URL(string: "http://scan.test/family")!
    let token = "test-token"

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-sweep-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        server = FakeScanServer()
        clock = TestClock(Self.epoch)
        trashRecorder = TrashRecorder()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    /// Writes a file whose mtime is `age` seconds before the test clock.
    @discardableResult
    func writeFile(_ name: String, _ content: String = "scan bytes", age: TimeInterval = 60, in directory: URL? = nil) throws -> URL {
        let url = (directory ?? folder).appendingPathComponent(name)
        try Data(content.utf8).write(to: url)
        try setAge(url, age)
        return url
    }

    func setAge(_ url: URL, _ age: TimeInterval) throws {
        try FileManager.default.setAttributes([.modificationDate: Self.epoch.addingTimeInterval(-age)], ofItemAtPath: url.path)
    }

    func names(in directory: URL? = nil) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: (directory ?? folder).path).sorted()
    }

    func makeSweep(clientBuild: String = "mac-1.2.3") -> ScanSweep {
        let clock = clock!
        let recorder = trashRecorder!
        return ScanSweep(
            transport: server,
            clientBuild: clientBuild,
            now: { clock.now },
            sleep: { clock.sleep($0) },
            trash: { try recorder.trash($0) }
        )
    }

    func target(_ disposition: UploadDisposition = .keep, folder: URL? = nil) -> UploadTarget {
        UploadTarget(folder: folder ?? self.folder, baseURL: baseURL, scanToken: token, disposition: disposition)
    }

    func sweep(_ disposition: UploadDisposition = .keep, retryRejected: Bool = false) async -> SweepSummary {
        await makeSweep().run(target(disposition), retryRejected: retryRejected)
    }

    func sha256(_ string: String) -> String {
        SHA256.hash(data: Data(string.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
