import BeeBoxMacCore
import Foundation
import XCTest

final class PhotosExportLedgerTests: XCTestCase {
    func testRoundTripAndMissingFile() throws {
        let url = scratchFile("ledger.json")
        XCTAssertNil(try PhotosExportLedger.load(from: url))
        var ledger = PhotosExportLedger()
        ledger.record("A1/L0/001")
        try ledger.save(to: url)
        let loaded = try XCTUnwrap(PhotosExportLedger.load(from: url))
        XCTAssertTrue(loaded.contains("A1/L0/001"))
        XCTAssertFalse(loaded.contains("B2/L0/001"))
    }

    /// A damaged record must not read as "nothing exported", which would
    /// upload the whole album again.
    func testADamagedLedgerThrows() throws {
        let url = scratchFile("ledger.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{".utf8).write(to: url)
        XCTAssertThrowsError(try PhotosExportLedger.load(from: url))
    }

    func testOneLedgerPerAlbumAndFolder() {
        let directory = URL(filePath: "/tmp/ledgers")
        let album = PhotosAlbumRef(identifier: "album-1", title: "Bee Box")
        let a = PhotosExportLedger.fileURL(directory: directory, album: album, folder: URL(filePath: "/Users/x/Pictures/A"))
        let b = PhotosExportLedger.fileURL(directory: directory, album: album, folder: URL(filePath: "/Users/x/Pictures/B"))
        XCTAssertNotEqual(a, b)
        XCTAssertEqual(a, PhotosExportLedger.fileURL(directory: directory, album: album, folder: URL(filePath: "/Users/x/Pictures/A/")))
    }

    func testFileNamesSortByDateAndKeepPhotosApart() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let date = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 17, hour: 9, minute: 14)))
        let first = PhotosExportLedger.fileName(assetIdentifier: "one", created: date)
        let second = PhotosExportLedger.fileName(assetIdentifier: "two", created: date)
        XCTAssertTrue(first.hasPrefix("2026-10-17 0914 "))
        XCTAssertTrue(first.hasSuffix(".jpg"))
        XCTAssertNotEqual(first, second)
        XCTAssertFalse(first.hasPrefix("."), "the sweep skips dotfiles")
    }
}
