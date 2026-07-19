import Foundation

struct ComposerDraftManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var draft: ComposerDraft

    init(boxID: UUID, draft: ComposerDraft) {
        version = Self.currentVersion
        self.boxID = boxID
        self.draft = draft
    }
}

actor ComposerDraftRepository {
    enum RepositoryError: Error {
        case unsupportedVersion(Int)
        case boxMismatch
        case corruptManifest
    }

    private let rootURL: URL
    private let fileManager: FileManager

    init(rootURL: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        self.rootURL = rootURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("composer-drafts", isDirectory: true)
    }

    func load(boxID: UUID) throws -> ComposerDraft? {
        let url = manifestURL(boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        do {
            let manifest = try JSONDecoder().decode(ComposerDraftManifest.self, from: Data(contentsOf: url))
            guard manifest.version == ComposerDraftManifest.currentVersion else {
                throw RepositoryError.unsupportedVersion(manifest.version)
            }
            guard manifest.boxID == boxID else {
                throw RepositoryError.boxMismatch
            }
            return manifest.draft
        } catch {
            try quarantineManifest(at: url)
            throw error
        }
    }

    func save(_ draft: ComposerDraft, boxID: UUID) throws {
        let directory = boxDirectory(boxID: boxID)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(ComposerDraftManifest(boxID: boxID, draft: draft))
        try data.write(to: manifestURL(boxID: boxID), options: .atomic)
    }

    func manifestURL(boxID: UUID) -> URL {
        boxDirectory(boxID: boxID).appendingPathComponent("manifest.json")
    }

    private func boxDirectory(boxID: UUID) -> URL {
        rootURL.appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
    }

    private func quarantineManifest(at url: URL) throws {
        let quarantineURL = url.deletingLastPathComponent()
            .appendingPathComponent("manifest.corrupt-\(UUID().uuidString.lowercased()).json")
        do {
            try fileManager.moveItem(at: url, to: quarantineURL)
        } catch {
            throw RepositoryError.corruptManifest
        }
    }
}
