import Foundation
import XCTest

@testable import BeeBoxMacCore

/// Ports of `hash.doctest.md`, `settle.identity.doctest.md` and the parse
/// parts of `wire-client.doctest.md`.
final class ScanFilesAndWireTests: ScanTestCase {
    // MARK: hash

    func testSHA256OfEmptyFile() throws {
        let file = try writeFile("empty.bin", "")
        XCTAssertEqual(try ScanFiles.sha256Hex(of: file), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testSHA256OfAbc() throws {
        let file = try writeFile("abc.bin", "abc")
        XCTAssertEqual(try ScanFiles.sha256Hex(of: file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testLargeFileHashesConsistentlyAndMatchesOneShot() throws {
        let file = folder.appendingPathComponent("big.bin")
        let bytes = Data(repeating: 7, count: 5 * 1024 * 1024 + 3)
        try bytes.write(to: file)
        let first = try ScanFiles.sha256Hex(of: file)
        XCTAssertEqual(first, try ScanFiles.sha256Hex(of: file))
        XCTAssertEqual(first, sha256Of(bytes))
    }

    private func sha256Of(_ data: Data) -> String {
        let temp = folder.appendingPathComponent("oneshot.bin")
        try? data.write(to: temp)
        return (try? ScanFiles.sha256Hex(of: temp)) ?? ""
    }

    // MARK: settle and identity

    func testSettledIsInclusiveAtTheWindowEdge() throws {
        let fresh = try writeFile("fresh.pdf", age: 0)
        let old = try writeFile("old.pdf", age: 11)
        let boundary = try writeFile("boundary.pdf", age: 10)
        let now = Self.epoch
        XCTAssertFalse(ScanFiles.isSettled(try XCTUnwrap(FileIdentity.snapshot(fresh)), now: now))
        XCTAssertTrue(ScanFiles.isSettled(try XCTUnwrap(FileIdentity.snapshot(old)), now: now))
        XCTAssertTrue(ScanFiles.isSettled(try XCTUnwrap(FileIdentity.snapshot(boundary)), now: now))
    }

    func testIdentityIsStableForAnUntouchedFileAndChangesWhenItGrows() throws {
        let file = try writeFile("stable.pdf", "unchanged bytes")
        let first = try XCTUnwrap(FileIdentity.snapshot(file))
        XCTAssertEqual(first, FileIdentity.snapshot(file))
        try Data("unchanged bytes and then some more".utf8).write(to: file)
        XCTAssertNotEqual(first, FileIdentity.snapshot(file))
    }

    func testIdentityChangesOnAnMtimeOnlyChange() throws {
        let file = try writeFile("touched.pdf", "same bytes", age: 60)
        let before = try XCTUnwrap(FileIdentity.snapshot(file))
        try setAge(file, 30)
        let after = try XCTUnwrap(FileIdentity.snapshot(file))
        XCTAssertEqual(before.size, after.size)
        XCTAssertNotEqual(before, after)
    }

    func testIdentityOfAMissingFileIsNil() {
        XCTAssertNil(FileIdentity.snapshot(folder.appendingPathComponent("nope")))
    }

    // MARK: wire parse

    func testContractVersionParsing() {
        XCTAssertNil(ScanWire.parseContractVersion(nil))
        XCTAssertNil(ScanWire.parseContractVersion("seven"))
        XCTAssertNil(ScanWire.parseContractVersion(1.5))
        XCTAssertNil(ScanWire.parseContractVersion(-1))
        XCTAssertNil(ScanWire.parseContractVersion(NSNull()))
        XCTAssertNil(ScanWire.parseContractVersion([String: Any]()))
        XCTAssertNil(ScanWire.parseContractVersion(true))
        XCTAssertEqual(ScanWire.parseContractVersion(0), 0)
        XCTAssertEqual(ScanWire.parseContractVersion(12), 12)
    }

    func testRetryAfterParsing() {
        XCTAssertEqual(ScanWire.parseRetryAfter(nil), 5)
        XCTAssertEqual(ScanWire.parseRetryAfter("2"), 2)
        XCTAssertEqual(ScanWire.parseRetryAfter("0"), 0)
        XCTAssertEqual(ScanWire.parseRetryAfter(" 1.5 "), 1.5)
        XCTAssertEqual(ScanWire.parseRetryAfter("-3"), 5)
        XCTAssertEqual(ScanWire.parseRetryAfter("soon"), 5)
        XCTAssertEqual(ScanWire.parseRetryAfter("inf"), 5)
    }

    private var wire: ScanWire {
        ScanWire(transport: server, baseURL: baseURL, token: "secret-123", clientBuild: "mac-1")
    }

    func testCheckParsesEveryStateIncludingTheRejectionReason() async throws {
        server.checkState = { hash in
            switch hash {
            case "aaa": .unknown
            case "bbb": .pending
            case "ccc": .imported
            default: .rejected(reason: "magic bytes say text/html but extension is .pdf")
            }
        }
        let response = try await wire.check(["aaa", "bbb", "ccc", "ddd"])
        XCTAssertEqual(response.states["aaa"], CheckResult(state: .unknown))
        XCTAssertEqual(response.states["bbb"], CheckResult(state: .pending))
        XCTAssertEqual(response.states["ccc"], CheckResult(state: .imported))
        XCTAssertEqual(response.states["ddd"], CheckResult(state: .rejected, reason: "magic bytes say text/html but extension is .pdf"))
    }

    func testAnEmptyCheckIsLegal() async throws {
        let response = try await wire.check([])
        XCTAssertEqual(response.states, [:])
        XCTAssertNil(response.contractVersion)
    }

    func testUnreadableContractVersionIsAbsentNotFatal() async throws {
        server.contractVersion = { "seven" }
        let response = try await wire.check([])
        XCTAssertNil(response.contractVersion)
    }

    func testPutReportsRateLimitWithoutSleeping() async throws {
        server.putOutcome = { _ in .rateLimited(retryAfter: "2") }
        let result = try await wire.put(hash: "abc123", filename: "page1.pdf", body: Data("x".utf8))
        XCTAssertEqual(result, .rateLimited(retryAfterSeconds: 2))
    }

    func testPutSendsTheTokenFilenameAndBytes() async throws {
        let result = try await wire.put(hash: "deadbeef", filename: "page1.pdf", body: Data("scan bytes".utf8))
        XCTAssertEqual(result, .accepted)
        let sent = try XCTUnwrap(server.putRequests.first)
        XCTAssertEqual(sent.authorization, "Bearer secret-123")
        XCTAssertEqual(sent.filename, "page1.pdf")
        XCTAssertEqual(String(decoding: sent.body, as: UTF8.self), "scan bytes")
        XCTAssertNil(sent.identity.profile)
        XCTAssertNil(sent.identity.builtAt)
    }

    func testPutStatusVocabulary() async throws {
        let cases: [(FakeScanServer.PutOutcome, PutResult)] = [
            (.accepted, .accepted),
            (.duplicate, .duplicate),
            (.rejected(reason: "bad"), .rejected(reason: "bad")),
            (.hashMismatch, .hashMismatch),
            (.tooLarge, .tooLarge),
            (.serverError(reason: "qpdf missing"), .serverError(reason: "qpdf missing")),
            (.serverError(reason: nil), .serverError(reason: "server temporarily unable to validate this file")),
        ]
        for (outcome, expected) in cases {
            server.putOutcome = { _ in outcome }
            let result = try await wire.put(hash: "abc", filename: "a.pdf", body: Data())
            XCTAssertEqual(result, expected)
        }
    }

    func testUnexpectedPutStatusIsAProtocolViolation() async {
        server.putOutcome = { _ in .other(status: 500, message: "database is in read-only mode") }
        do {
            _ = try await wire.put(hash: "abc", filename: "a.pdf", body: Data())
            XCTFail("expected a protocol violation")
        } catch {
            XCTAssertEqual(error, .protocolViolation("unexpected HTTP status 500"))
        }
    }

    func testUnknownCheckStateIsAProtocolViolation() async {
        server.checkFailure = { (200, ["states": ["aaa": ["state": "mystery"]]]) }
        do {
            _ = try await wire.check(["aaa"])
            XCTFail("expected a protocol violation")
        } catch {
            XCTAssertEqual(error, .protocolViolation("check response entry has an unrecognized state"))
        }
    }
}
