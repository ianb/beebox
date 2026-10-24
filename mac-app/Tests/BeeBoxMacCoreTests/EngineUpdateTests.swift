import BeeBoxMacCore
import XCTest

final class EngineUpdateTests: XCTestCase {
    private let current = EngineImageInfo(digest: "sha256:aaa", version: "0.1.6", minAppVersion: "0.1.6")
    private let newer = EngineImageInfo(digest: "sha256:bbb", version: "0.1.7-main.20261024.abc1234", minAppVersion: "0.1.6")

    private func decide(
        current: EngineImageInfo? = nil,
        failed: String? = nil,
        remote: EngineImageInfo,
        appVersion: String = "0.1.7",
        minEngineVersion: String = "0.1.6",
        byRequest: Bool = false
    ) -> EngineUpdate.Decision {
        EngineUpdate.decide(current: current, failed: failed, remote: remote, appVersion: appVersion, minEngineVersion: minEngineVersion, byRequest: byRequest)
    }

    // MARK: Version grammar

    func testVersionsParseAndOrder() throws {
        let v6 = try XCTUnwrap(EngineVersion("0.1.6"))
        let v9 = try XCTUnwrap(EngineVersion("0.1.9"))
        let v10 = try XCTUnwrap(EngineVersion("0.1.10"))
        let pre = try XCTUnwrap(EngineVersion("0.1.6-main.20261024.abc1234"))
        let tagged = try XCTUnwrap(EngineVersion("v0.1.6"))
        XCTAssertLessThan(v9, v10, "numeric, not lexical")
        XCTAssertLessThan(pre, v6, "a pre-release sorts below the release it names")
        XCTAssertGreaterThan(pre, try XCTUnwrap(EngineVersion("0.1.5")), "and above the one before it")
        XCTAssertEqual(tagged, v6)
        XCTAssertEqual(pre.description, "0.1.6-main.20261024.abc1234")
    }

    func testMalformedVersionsAreRejected() {
        for text in ["", "dev", "0.1", "0.1.6.2", "0.1.x", "0.1.6-", "0.1.6-a b", "-1.0.0"] {
            XCTAssertNil(EngineVersion(text), text)
        }
    }

    // MARK: Decisions

    func testSameDigestIsUpToDateWhateverTheLabels() {
        let unlabeledTwin = EngineImageInfo(digest: current.digest, version: nil, minAppVersion: nil)
        XCTAssertEqual(decide(current: current, remote: unlabeledTwin), .upToDate)
    }

    func testNewerCompatibleImageIsAnUpdate() {
        XCTAssertEqual(decide(current: current, remote: newer), .update(to: newer))
        XCTAssertEqual(decide(current: nil, remote: newer), .update(to: newer), "first download")
    }

    func testImageWithoutLabelsIsNeverChosen() {
        let old = EngineImageInfo(digest: "sha256:ccc", version: nil, minAppVersion: nil)
        XCTAssertEqual(decide(current: current, remote: old), .unlabeled)
        let halfLabeled = EngineImageInfo(digest: "sha256:ccc", version: "0.1.7", minAppVersion: nil)
        XCTAssertEqual(decide(current: current, remote: halfLabeled), .unlabeled)
        let garbage = EngineImageInfo(digest: "sha256:ccc", version: "edge", minAppVersion: "0.1.6")
        XCTAssertEqual(decide(current: current, remote: garbage), .unlabeled)
    }

    func testImageThatNeedsANewerAppIsNotDownloaded() {
        let demanding = EngineImageInfo(digest: "sha256:ddd", version: "0.2.0", minAppVersion: "0.2.0")
        XCTAssertEqual(decide(current: current, remote: demanding, appVersion: "0.1.7"), .needsNewerApp(min: "0.2.0"))
        XCTAssertEqual(decide(current: current, remote: demanding, appVersion: "0.2.0"), .update(to: demanding))
    }

    func testDevelopmentBuildRunsAnyImage() {
        let demanding = EngineImageInfo(digest: "sha256:ddd", version: "0.2.0", minAppVersion: "0.2.0")
        XCTAssertEqual(decide(current: current, remote: demanding, appVersion: "dev"), .update(to: demanding))
    }

    func testAppThatNeedsANewerImageKeepsTheCurrentOne() {
        XCTAssertEqual(decide(current: current, remote: newer, minEngineVersion: "0.1.8"), .imageTooOld(min: "0.1.8"))
    }

    func testAFailedDigestIsRetriedOnlyByRequest() {
        XCTAssertEqual(decide(current: current, failed: newer.digest, remote: newer), .knownFailure(digest: newer.digest))
        XCTAssertEqual(decide(current: current, failed: newer.digest, remote: newer, byRequest: true), .update(to: newer))
        XCTAssertEqual(decide(current: current, failed: "sha256:other", remote: newer), .update(to: newer), "the channel moved on")
    }

    // MARK: Recovery from an update record

    private let record = UpdateRecord(previousDigest: "sha256:aaa", candidateDigest: "sha256:bbb", boxHead: "head0", startedAt: Date())

    func testQuitBeforeRetagDiscardsTheRecord() {
        XCTAssertEqual(record.recovery(currentDigest: "sha256:aaa", previousExists: false, boxHead: "head0", boxClean: true), .discardRecord)
    }

    func testQuitDuringTheStartRollsBack() {
        XCTAssertEqual(record.recovery(currentDigest: "sha256:bbb", previousExists: true, boxHead: "head0", boxClean: true), .rollBack(resetBox: false))
        XCTAssertEqual(record.recovery(currentDigest: "sha256:bbb", previousExists: true, boxHead: "head1", boxClean: true), .rollBack(resetBox: true), "the sweep committed")
        XCTAssertEqual(record.recovery(currentDigest: "sha256:bbb", previousExists: true, boxHead: "head0", boxClean: false), .rollBack(resetBox: true), "a failed migration left files")
    }

    func testAStoreThatDisagreesWithTheRecordStops() {
        guard case .stop = record.recovery(currentDigest: "sha256:zzz", previousExists: true, boxHead: "head0", boxClean: true) else {
            return XCTFail("a third digest must stop")
        }
        guard case .stop = record.recovery(currentDigest: "sha256:bbb", previousExists: false, boxHead: "head0", boxClean: true) else {
            return XCTFail("a missing previous image must stop")
        }
    }

    func testRecordRoundTripsThroughJSON() throws {
        let data = try JSONEncoder().encode(record)
        let back = try JSONDecoder().decode(UpdateRecord.self, from: data)
        XCTAssertEqual(back.previousDigest, record.previousDigest)
        XCTAssertEqual(back.candidateDigest, record.candidateDigest)
        XCTAssertEqual(back.boxHead, record.boxHead)
    }
}
