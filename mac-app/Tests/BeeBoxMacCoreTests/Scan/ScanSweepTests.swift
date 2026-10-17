import Foundation
import XCTest

@testable import BeeBoxMacCore

/// Ports of `run-target.doctest.md`, `settle.retry.doctest.md` and the folder
/// parts of `disposition.doctest.md`.
final class ScanSweepTests: ScanTestCase {
    // MARK: run-target

    func testUnknownFileUploadsThenArchives() async throws {
        try writeFile("scan1.pdf", "brand new scan")
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(uploaded: 1))
        XCTAssertEqual(try names(), ["imported"])
        XCTAssertEqual(try names(in: folder.appendingPathComponent("imported")), ["scan1.pdf"])
        XCTAssertEqual(server.putRequests.count, 1)
    }

    func testPendingOrImportedFileIsConfirmedWithoutPut() async throws {
        for state in [FakeScanServer.CheckState.pending, .imported] {
            let name = "already-\(UUID().uuidString).pdf"
            try writeFile(name, "previously uploaded \(name)")
            server.checkState = { _ in state }
            let summary = await sweep(.keep)
            XCTAssertEqual(summary.duplicate, 1)
            XCTAssertEqual(summary.uploaded, 0)
            XCTAssertTrue(try names().contains(name))
            try FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
        XCTAssertEqual(server.putRequests.count, 0)
    }

    func testRejectedFileIsNeverDispositioned() async throws {
        try writeFile("smuggled.pdf", "<html>not a pdf</html>")
        server.checkState = { _ in .rejected(reason: "magic bytes say text/html but extension is .pdf") }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(rejected: 1))
        XCTAssertEqual(try names(), ["smuggled.pdf"])
        XCTAssertEqual(server.putRequests.count, 0)
    }

    func testRetryRejectedRePutsInsteadOfTrustingTheCheckVerdict() async throws {
        try writeFile("smuggled.pdf", "<html>not a pdf</html>")
        server.checkState = { _ in .rejected(reason: "stale verdict, should not be trusted") }
        let summary = await sweep(.archive, retryRejected: true)
        XCTAssertEqual(summary, SweepSummary(uploaded: 1))
        XCTAssertEqual(server.putRequests.count, 1)
        XCTAssertEqual(try names(), ["imported"])
    }

    func testRejectionLearnedOnPutCountsAsNewAndNeverMoves() async throws {
        try writeFile("first-sight.pdf", "<html>not a pdf</html>")
        server.putOutcome = { _ in .rejected(reason: "magic bytes say text/html") }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.rejected, 1)
        XCTAssertEqual(summary.rejectedOnUpload, 1)
        XCTAssertEqual(summary.rejectedFileNames, ["first-sight.pdf"])
        XCTAssertEqual(try names(), ["first-sight.pdf"])
    }

    func testRetryRejectedOfARememberedRejectionIsNotNew() async throws {
        try writeFile("first-sight.pdf", "<html>not a pdf</html>")
        server.checkState = { _ in .rejected(reason: "the server already knows") }
        server.putOutcome = { _ in .rejected(reason: "still not a pdf") }
        let summary = await sweep(.archive, retryRejected: true)
        XCTAssertEqual(summary.rejected, 1)
        XCTAssertEqual(summary.rejectedOnUpload, 0)
        XCTAssertEqual(summary.rejectedFileNames, [])
        XCTAssertEqual(try names(), ["first-sight.pdf"])
    }

    func testFileChangedBetweenHashAndDispositionIsLeftAlone() async throws {
        let racePath = try writeFile("growing.pdf", "first pass bytes")
        server.checkState = { _ in
            try? Data("scanner appended more bytes after this hash was taken".utf8).write(to: racePath)
            return .unknown
        }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(uploaded: 1, skippedIdentityChanged: 1))
        XCTAssertEqual(try names(), ["growing.pdf"])
    }

    func testRateLimitedPutIsRetriedAfterRetryAfter() async throws {
        try writeFile("throttled.pdf", "scan under load")
        let attempts = AttemptCounter()
        server.putOutcome = { _ in attempts.next() == 1 ? .rateLimited(retryAfter: "2") : .accepted }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary, SweepSummary(uploaded: 1))
        XCTAssertEqual(server.putRequests.count, 2)
        XCTAssertEqual(clock.sleeps, [.seconds(2)])
    }

    func testRateLimitWithoutRetryAfterWaitsFiveSeconds() async throws {
        try writeFile("throttled.pdf", "scan under load")
        let attempts = AttemptCounter()
        server.putOutcome = { _ in attempts.next() == 1 ? .rateLimited(retryAfter: nil) : .accepted }
        _ = await sweep(.keep)
        XCTAssertEqual(clock.sleeps, [.seconds(5)])
    }

    func testRateLimitOnEveryAttemptEndsTheSweepWithAStandingProblem() async throws {
        try writeFile("a.pdf", "a")
        try writeFile("b.pdf", "b")
        server.putOutcome = { _ in .rateLimited(retryAfter: "7") }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.standingProblem, .rateLimited(retryAfterSeconds: 7))
        XCTAssertEqual(server.putRequests.count, 5, "five attempts on the first file, none on the second")
        XCTAssertEqual(clock.sleeps.count, 4)
        XCTAssertEqual(try names(), ["a.pdf", "b.pdf"])
    }

    func testPerFilePutFailuresCountAsErrorsAndNeverMoveTheFile() async throws {
        try writeFile("a-hash-mismatch.pdf", "1")
        try writeFile("b-too-large.pdf", "2")
        try writeFile("c-server-error.pdf", "3")
        try writeFile("d-fine.pdf", "4")
        server.putOutcome = { request in
            switch request.filename {
            case "a-hash-mismatch.pdf": .hashMismatch
            case "b-too-large.pdf": .tooLarge
            case "c-server-error.pdf": .serverError(reason: "qpdf missing")
            default: .accepted
            }
        }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(uploaded: 1, errors: 3))
        XCTAssertEqual(try names(), ["a-hash-mismatch.pdf", "b-too-large.pdf", "c-server-error.pdf", "imported"])
    }

    // MARK: standing problems

    func testMissingFolderIsAStandingProblemAndIsNotRetried() async throws {
        let gone = folder.appendingPathComponent("does-not-exist")
        let summary = await makeSweep().run(target(.keep, folder: gone), retryRejected: false)
        XCTAssertEqual(summary, SweepSummary(standingProblem: .folderMissing))
        XCTAssertEqual(clock.sleeps, [])
    }

    func testRefusedCredentialOnCheck() async throws {
        try writeFile("a.pdf")
        server.checkAuthorization = { _ in false }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.standingProblem, .credentialRefused)
        XCTAssertEqual(try names(), ["a.pdf"])
    }

    func testRefusedCredentialOnPut() async throws {
        try writeFile("a.pdf")
        server.putOutcome = { _ in .unauthorized }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.standingProblem, .credentialRefused)
        XCTAssertEqual(try names(), ["a.pdf"])
    }

    func testUnreachableBox() async throws {
        try writeFile("a.pdf")
        server.transportError = .cannotConnectToHost
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.standingProblem, .boxUnreachable(.cannotConnectToHost))
        XCTAssertEqual(try names(), ["a.pdf"])
    }

    func testUnavailableBoxAnswersCheckWith503() async throws {
        try writeFile("a.pdf")
        server.checkFailure = { (503, ["status": "server-error", "reason": "box is not annex-converted"]) }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.standingProblem, .boxUnavailable)
        XCTAssertEqual(try names(), ["a.pdf"])
    }

    func testRateLimitedCheck() async throws {
        try writeFile("a.pdf")
        server.checkFailure = { (429, [:]) }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary.standingProblem, .rateLimited(retryAfterSeconds: 5))
    }

    func testUnexpectedCheckStatusIsAnErrorWithoutAStandingProblem() async throws {
        try writeFile("a.pdf")
        server.checkFailure = { (500, ["message": "database is in read-only mode"]) }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(errors: 1))
        XCTAssertEqual(try names(), ["a.pdf"])
    }

    func testUnexpectedPutStatusAbandonsTheSweep() async throws {
        try writeFile("a.pdf", "a")
        try writeFile("b.pdf", "b")
        server.putOutcome = { _ in .other(status: 500, message: "boom") }
        let summary = await sweep(.archive)
        XCTAssertEqual(summary, SweepSummary(errors: 1))
        XCTAssertEqual(server.putRequests.count, 1)
    }

    // MARK: walk, batching, requests

    func testWalkSkipsDotfilesDirectoriesAndTheImportedFolder() async throws {
        try writeFile("scan.pdf", "wanted")
        try writeFile(".DS_Store", "dot")
        try writeFile("imported-before.pdf", "archived", in: nil)
        let imported = folder.appendingPathComponent("imported")
        try FileManager.default.createDirectory(at: imported, withIntermediateDirectories: true)
        try writeFile("old.pdf", "already archived", in: imported)
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("subfolder"), withIntermediateDirectories: true)
        try writeFile("nested.pdf", "nested", in: folder.appendingPathComponent("subfolder"))
        let link = folder.appendingPathComponent("link.pdf")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: folder.appendingPathComponent("scan.pdf"))

        _ = await sweep(.keep)
        XCTAssertEqual(Set(server.putRequests.map(\.filename)), ["scan.pdf", "imported-before.pdf"])
    }

    func testChecksAreBatchedAtFiveHundredAndDeduplicated() async throws {
        for index in 0 ..< 501 {
            try writeFile("f\(index).bin", "content \(index)")
        }
        try writeFile("twin-a.bin", "twin")
        try writeFile("twin-b.bin", "twin")
        server.checkState = { _ in .imported }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary.duplicate, 503)
        // 502 unique hashes: one batch of 500, one of 2.
        XCTAssertEqual(server.checkRequests.map(\.hashes.count), [500, 2])
        XCTAssertEqual(Set(server.checkRequests.flatMap(\.hashes)).count, 502)
    }

    func testRequestsCarryTheDocumentedHeadersAndBytes() async throws {
        try writeFile("page1.pdf", "scan bytes")
        let summary = await makeSweep(clientBuild: "mac-9.9").run(target(.keep), retryRejected: false)
        XCTAssertEqual(summary.uploaded, 1)

        let check = try XCTUnwrap(server.checkRequests.first)
        XCTAssertEqual(check.url.absoluteString, "http://scan.test/family/api/scan/check")
        XCTAssertEqual(check.authorization, "Bearer test-token")
        XCTAssertEqual(check.hashes, [sha256("scan bytes")])
        XCTAssertEqual(check.identity, .init(contract: String(scanContractVersion), build: "mac-9.9", builtAt: nil, profile: nil))

        let put = try XCTUnwrap(server.putRequests.first)
        XCTAssertEqual(put.url.absoluteString, "http://scan.test/family/api/scan/files/\(sha256("scan bytes"))")
        XCTAssertEqual(put.pathHash, sha256("scan bytes"))
        XCTAssertEqual(put.authorization, "Bearer test-token")
        XCTAssertEqual(put.filename, "page1.pdf")
        XCTAssertEqual(put.contentType, "application/octet-stream")
        XCTAssertEqual(put.contentLength, "10")
        XCTAssertEqual(String(decoding: put.body, as: UTF8.self), "scan bytes")
        XCTAssertEqual(put.identity, check.identity, "identity rides both routes")
    }

    func testTrailingSlashOnTheBaseURLIsIgnored() async throws {
        try writeFile("a.pdf")
        let slashed = UploadTarget(folder: folder, baseURL: URL(string: "http://scan.test/family/")!, scanToken: token, disposition: .keep)
        _ = await makeSweep().run(slashed, retryRejected: false)
        XCTAssertEqual(server.checkRequests.first?.url.absoluteString, "http://scan.test/family/api/scan/check")
    }

    func testContractVersionIsReadFromTheCheckResponse() async throws {
        try writeFile("a.pdf")
        server.contractVersion = { 7 }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary.contractVersion, 7)
    }

    func testBoxWithoutContractVersionReportsNone() async throws {
        try writeFile("a.pdf")
        let summary = await sweep(.keep)
        XCTAssertNil(summary.contractVersion)
    }

    func testEmptyFolderMakesNoRequest() async throws {
        let summary = await sweep(.keep)
        XCTAssertEqual(summary, SweepSummary())
        XCTAssertEqual(server.checkRequests.count, 0)
    }

    // MARK: settle gate and settle-retry rounds

    func testSettleWindowBoundary() async throws {
        try writeFile("fresh.pdf", "fresh", age: 0)
        try writeFile("just-inside.pdf", "inside", age: 9)
        try writeFile("boundary.pdf", "boundary", age: 10)
        try writeFile("old.pdf", "old", age: 11)
        // A clock that never moves: every round sees the same two unsettled files.
        let summary = await ScanSweep(
            transport: server,
            clientBuild: "mac-1",
            now: { Self.epoch },
            sleep: { _ in }
        ).run(target(.keep), retryRejected: false)
        XCTAssertEqual(Set(server.putRequests.map(\.filename)), ["boundary.pdf", "old.pdf"])
        XCTAssertGreaterThan(summary.skippedUnsettled, 0)
    }

    func testUnsettledFileIsSkippedThenUploadedAfterTheWait() async throws {
        try writeFile("just-scanned.pdf", "still writing", age: 0)
        let summary = await sweep(.keep)
        // The clock moves 12 s per wait, so the file settles in round two.
        XCTAssertEqual(summary.uploaded, 1)
        XCTAssertEqual(clock.sleeps.count, 1)
    }

    func testSettledFilesNeverWait() async throws {
        try writeFile("a.pdf")
        _ = await sweep(.keep)
        XCTAssertEqual(clock.sleeps, [])
    }

    func testWaitCoversTheWholeSettleWindow() async throws {
        try writeFile("just-scanned.pdf", age: 0)
        _ = await sweep(.keep)
        let wait = try XCTUnwrap(clock.sleeps.first)
        XCTAssertGreaterThanOrEqual(wait, .seconds(10))
    }

    func testOnlyUnsettledFilesAreRetriedAndSettledOnesAreNotUploadedTwice() async throws {
        try writeFile("settled.pdf", "settled")
        try writeFile("late.pdf", "late", age: 0)
        let summary = await sweep(.archive)
        XCTAssertEqual(summary.uploaded, 2)
        // What the folder holds is the last round's view: nothing unsettled.
        XCTAssertEqual(summary.skippedUnsettled, 0)
        XCTAssertEqual(server.putRequests.map(\.filename).sorted(), ["late.pdf", "settled.pdf"])
        XCTAssertEqual(clock.sleeps.count, 1)
    }

    func testAFileThatNeverSettlesGivesUpAfterThreeRetries() async throws {
        try writeFile("never.pdf", "growing", age: -3600)
        let summary = await sweep(.keep)
        XCTAssertEqual(clock.sleeps.count, 3)
        XCTAssertEqual(server.checkRequests.count, 0)
        XCTAssertEqual(server.putRequests.count, 0)
        // One file is still unsettled after the last pass (not one per pass).
        XCTAssertEqual(summary.skippedUnsettled, 1)
        XCTAssertNil(summary.standingProblem)
    }

    func testContractVersionFromAnEarlierRoundSurvivesARoundWithoutOne() async throws {
        try writeFile("settled.pdf", "settled")
        try writeFile("late.pdf", "late", age: 0)
        let checks = AttemptCounter()
        server.contractVersion = { checks.next() == 1 ? 7 : nil }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary.contractVersion, 7)
        XCTAssertEqual(server.checkRequests.count, 2)
    }

    func testAStandingProblemEndsTheRoundsEvenWithUnsettledFiles() async throws {
        try writeFile("late.pdf", age: 0)
        try writeFile("settled.pdf", "settled")
        server.checkAuthorization = { _ in false }
        let summary = await sweep(.keep)
        XCTAssertEqual(summary.standingProblem, .credentialRefused)
        XCTAssertEqual(clock.sleeps, [])
    }

    // MARK: dispositions

    func testArchiveRenamesIntoImportedAndNumbersCollisions() async throws {
        try writeFile("Doc.pdf", "first")
        _ = await sweep(.archive)
        try writeFile("Doc.pdf", "second")
        _ = await sweep(.archive)
        try writeFile("Doc.pdf", "third")
        _ = await sweep(.archive)

        let imported = folder.appendingPathComponent("imported")
        XCTAssertEqual(try names(in: imported), ["Doc-2.pdf", "Doc-3.pdf", "Doc.pdf"])
        XCTAssertEqual(try String(contentsOf: imported.appendingPathComponent("Doc.pdf"), encoding: .utf8), "first")
        XCTAssertEqual(try String(contentsOf: imported.appendingPathComponent("Doc-2.pdf"), encoding: .utf8), "second")
        XCTAssertEqual(try String(contentsOf: imported.appendingPathComponent("Doc-3.pdf"), encoding: .utf8), "third")
    }

    func testKeepLeavesTheFile() async throws {
        try writeFile("Doc.pdf")
        _ = await sweep(.keep)
        XCTAssertEqual(try names(), ["Doc.pdf"])
    }

    func testTrashHandsTheFileToTheTrasher() async throws {
        let file = try writeFile("scan.pdf")
        let summary = await sweep(.trash)
        XCTAssertEqual(summary.uploaded, 1)
        XCTAssertEqual(trashRecorder.trashed.map(\.lastPathComponent), [file.lastPathComponent])
    }

    func testAFailedTrashIsAnErrorAndTheFileStays() async throws {
        try writeFile("scan.pdf")
        trashRecorder.failWith = TrashFailure()
        let summary = await sweep(.trash)
        XCTAssertEqual(summary.uploaded, 1)
        XCTAssertEqual(summary.errors, 1)
        XCTAssertEqual(try names(), ["scan.pdf"])
    }

    func testChangedFileIsNeverTrashed() async throws {
        let racePath = try writeFile("growing.pdf", "first pass bytes")
        server.checkState = { _ in
            try? Data("more".utf8).write(to: racePath)
            return .unknown
        }
        let summary = await sweep(.trash)
        XCTAssertEqual(summary.skippedIdentityChanged, 1)
        XCTAssertEqual(trashRecorder.trashed, [])
    }
}

final class AttemptCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func next() -> Int {
        lock.withLock {
            count += 1
            return count
        }
    }
}

extension ScanSweepTests {
    /// A refused file stays in the folder, so every settle-retry round sees it
    /// again. The summary counts it once.
    func testARefusedFileIsCountedOnceAcrossSettleRetries() async throws {
        try writeFile("bad.pdf", "bad")
        try writeFile("late.pdf", "late", age: 0)
        // The box remembers a refusal: later checks report the hash as rejected.
        let refused = RefusedHashes()
        server.putOutcome = { put in
            guard put.filename == "bad.pdf" else { return .accepted }
            refused.insert(put.pathHash)
            return .rejected(reason: "not a scan")
        }
        server.checkState = { hash in refused.contains(hash) ? .rejected(reason: "not a scan") : .unknown }
        let summary = await sweep(.keep)
        XCTAssertEqual(clock.sleeps.count, 1)
        XCTAssertEqual(summary.rejected, 1)
        XCTAssertEqual(summary.rejectedOnUpload, 1)
    }
}

private final class RefusedHashes: @unchecked Sendable {
    private let lock = NSLock()
    private var hashes: Set<String> = []

    func insert(_ hash: String) { lock.withLock { _ = hashes.insert(hash) } }
    func contains(_ hash: String) -> Bool { lock.withLock { hashes.contains(hash) } }
}
