import Combine
import Foundation
import os

/// A Photos album whose new photos are exported into an upload folder.
public struct PhotosAlbumRef: Codable, Equatable, Sendable {
    /// PhotoKit's `localIdentifier` for the album.
    public var identifier: String
    public var title: String

    public init(identifier: String, title: String) {
        self.identifier = identifier
        self.title = title
    }
}

/// A watched folder and the box its files go to. The scan token lives in the
/// Keychain under the box's id; its name is in `UploadFolderStore.scanTokenNames`.
public struct UploadFolder: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var folderPath: String
    public var boxID: UUID
    public var disposition: UploadDisposition
    public var photosAlbum: PhotosAlbumRef?

    public init(id: UUID, folderPath: String, boxID: UUID, disposition: UploadDisposition, photosAlbum: PhotosAlbumRef?) {
        self.id = id
        self.folderPath = folderPath
        self.boxID = boxID
        self.disposition = disposition
        self.photosAlbum = photosAlbum
    }

    public var folder: URL { URL(filePath: folderPath, directoryHint: .isDirectory) }
}

/// The upload folders, and the name of the scan token minted on each box (so
/// it can be revoked), in one JSON file.
@MainActor
public final class UploadFolderStore: ObservableObject {
    @Published public private(set) var folders: [UploadFolder] = []
    /// Box id → the name of this Mac's scan token on that box.
    @Published public private(set) var scanTokenNames: [UUID: String] = [:]
    /// Set when the file exists but cannot be read; saving is refused while it
    /// is set, so a bad read never overwrites the boxholder's settings.
    public private(set) var loadFailure: String?

    private let storageURL: URL
    private let log = Logger(subsystem: "run.beebox.mac", category: "uploads")

    public init(storageURL: URL) {
        self.storageURL = storageURL
        load()
    }

    // Each change is saved before it is published: a folder whose save failed
    // must not be swept, and a name that was not saved must not be relied on.

    @discardableResult
    public func add(_ folder: UploadFolder) -> Bool {
        guard !folders.contains(where: { $0.folderPath == folder.folderPath }) else { return false }
        return commit(folders: folders + [folder], scanTokenNames: scanTokenNames)
    }

    @discardableResult
    public func update(_ folder: UploadFolder) -> Bool {
        guard let index = folders.firstIndex(where: { $0.id == folder.id }) else { return false }
        var changed = folders
        changed[index] = folder
        return commit(folders: changed, scanTokenNames: scanTokenNames)
    }

    @discardableResult
    public func remove(_ folder: UploadFolder) -> Bool {
        commit(folders: folders.filter { $0.id != folder.id }, scanTokenNames: scanTokenNames)
    }

    @discardableResult
    public func setScanTokenName(_ name: String?, forBox boxID: UUID) -> Bool {
        var names = scanTokenNames
        names[boxID] = name
        return commit(folders: folders, scanTokenNames: names)
    }

    public func folders(forBox boxID: UUID) -> [UploadFolder] {
        folders.filter { $0.boxID == boxID }
    }

    private func load() {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return }
        do {
            let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: storageURL))
            folders = snapshot.folders
            scanTokenNames = snapshot.scanTokenNames
        } catch {
            loadFailure = "\(storageURL.lastPathComponent) could not be read: \(error.localizedDescription)"
            log.error("upload folders load failed error=\(String(describing: error), privacy: .public)")
        }
    }

    private func commit(folders newFolders: [UploadFolder], scanTokenNames newNames: [UUID: String]) -> Bool {
        guard loadFailure == nil else { return false }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(Snapshot(folders: newFolders, scanTokenNames: newNames)).write(to: storageURL, options: .atomic)
        } catch {
            log.error("upload folders save failed error=\(String(describing: error), privacy: .public)")
            return false
        }
        folders = newFolders
        scanTokenNames = newNames
        return true
    }

    private struct Snapshot: Codable {
        var folders: [UploadFolder]
        var scanTokenNames: [UUID: String]
    }
}

/// Whether the old command-line uploader's launchd agent already watches a
/// folder. Two uploaders on one folder race to move the same files.
public enum OldUploaderCheck {
    public static let label = "org.beebox.scan-uploader"

    public static func plistURL(home: URL) -> URL {
        home.appending(path: "Library/LaunchAgents/\(label).plist")
    }

    /// The folders the agent's plist watches (`WatchPaths`): [] when there is
    /// no agent, nil when a plist exists but cannot be read.
    public static func watchedFolders(plistURL: URL) -> [String]? {
        guard FileManager.default.fileExists(atPath: plistURL.path) else { return [] }
        guard let data = try? Data(contentsOf: plistURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
            return nil
        }
        return plist["WatchPaths"] as? [String] ?? []
    }

    /// True when the agent watches this folder, or when its plist exists but
    /// cannot be read (fail closed: two uploaders on one folder race).
    public static func conflicts(folderPath: String, plistURL: URL) -> Bool {
        guard let watched = watchedFolders(plistURL: plistURL) else { return true }
        let wanted = URL(filePath: folderPath).standardizedFileURL.path
        return watched.contains { URL(filePath: $0).standardizedFileURL.path == wanted }
    }
}
