import CryptoKit
import Foundation

/// Which photos of an album were already exported into its upload folder, so
/// each one is exported once (the job `osxphotos export --update` did). A photo
/// removed from the folder after upload is not exported again.
public struct PhotosExportLedger: Codable, Equatable, Sendable {
    public private(set) var exported: Set<String> = []

    public init() {}

    public mutating func record(_ assetIdentifier: String) {
        exported.insert(assetIdentifier)
    }

    public func contains(_ assetIdentifier: String) -> Bool {
        exported.contains(assetIdentifier)
    }

    /// One ledger file per album and folder pair.
    public static func fileURL(directory: URL, album: PhotosAlbumRef, folder: URL) -> URL {
        let key = "\(album.identifier)\n\(folder.standardizedFileURL.path)"
        let digest = SHA256.hash(data: Data(key.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        return directory.appending(path: "photos-exported-\(digest).json")
    }

    /// Nil when there is no file yet; throws when a file exists but cannot be
    /// read, so a damaged ledger never causes the whole album to upload again.
    public static func load(from url: URL) throws -> PhotosExportLedger? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(PhotosExportLedger.self, from: Data(contentsOf: url))
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }

    /// `2026-10-17 0914 3f2a9c1b.jpg`: sorts by when the photo was taken, and the
    /// asset-derived suffix keeps two photos from the same minute apart.
    public static func fileName(assetIdentifier: String, created: Date?) -> String {
        let suffix = SHA256.hash(data: Data(assetIdentifier.utf8)).prefix(4).map { String(format: "%02x", $0) }.joined()
        guard let created else { return "photo \(suffix).jpg" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HHmm"
        return "\(formatter.string(from: created)) \(suffix).jpg"
    }
}
