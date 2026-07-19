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

struct PendingEmissionManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var emissions: [PendingEmission]

    init(boxID: UUID, emissions: [PendingEmission]) {
        version = Self.currentVersion
        self.boxID = boxID
        self.emissions = emissions
    }
}

struct VoicePreparationManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var preparations: [VoicePreparation]

    init(boxID: UUID, preparations: [VoicePreparation]) {
        version = Self.currentVersion
        self.boxID = boxID
        self.preparations = preparations
    }
}

actor ComposerDraftRepository {
    enum RepositoryError: Error {
        case unsupportedVersion(Int)
        case boxMismatch
        case corruptManifest
        case invalidPayloadFilename
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

    func loadPendingEmissions(boxID: UUID) throws -> [PendingEmission] {
        let url = pendingManifestURL(boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return []
        }
        do {
            let manifest = try JSONDecoder().decode(PendingEmissionManifest.self, from: Data(contentsOf: url))
            guard manifest.version == PendingEmissionManifest.currentVersion else {
                throw RepositoryError.unsupportedVersion(manifest.version)
            }
            guard manifest.boxID == boxID else {
                throw RepositoryError.boxMismatch
            }
            guard manifest.emissions.allSatisfy({ $0.boxID == boxID }) else {
                throw RepositoryError.boxMismatch
            }
            return manifest.emissions
        } catch {
            try quarantineManifest(at: url)
            throw error
        }
    }

    func savePendingEmissions(_ emissions: [PendingEmission], boxID: UUID) throws {
        let directory = boxDirectory(boxID: boxID)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let manifest = PendingEmissionManifest(boxID: boxID, emissions: emissions)
        try JSONEncoder().encode(manifest).write(to: pendingManifestURL(boxID: boxID), options: .atomic)
    }

    func loadVoicePreparations(boxID: UUID) throws -> [VoicePreparation] {
        let url = voicePreparationManifestURL(boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return []
        }
        do {
            let manifest = try JSONDecoder().decode(VoicePreparationManifest.self, from: Data(contentsOf: url))
            guard manifest.version == VoicePreparationManifest.currentVersion else {
                throw RepositoryError.unsupportedVersion(manifest.version)
            }
            guard manifest.boxID == boxID,
                  manifest.preparations.allSatisfy({ $0.boxID == boxID }) else {
                throw RepositoryError.boxMismatch
            }
            return manifest.preparations
        } catch {
            try quarantineManifest(at: url)
            throw error
        }
    }

    func saveVoicePreparations(_ preparations: [VoicePreparation], boxID: UUID) throws {
        guard preparations.allSatisfy({ $0.boxID == boxID }) else {
            throw RepositoryError.boxMismatch
        }
        let directory = boxDirectory(boxID: boxID)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let manifest = VoicePreparationManifest(boxID: boxID, preparations: preparations)
        try JSONEncoder().encode(manifest).write(to: voicePreparationManifestURL(boxID: boxID), options: .atomic)
    }

    func clearVoicePreparation(boxID: UUID) throws {
        let url = voicePreparationManifestURL(boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return
        }
        try fileManager.removeItem(at: url)
    }

    func savePayload(_ data: Data, filename: String, boxID: UUID) throws {
        let url = try payloadURL(filename: filename, boxID: boxID)
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    func importPayload(from sourceURL: URL, filename: String, boxID: UUID) throws {
        let destinationURL = try payloadURL(filename: filename, boxID: boxID)
        try fileManager.createDirectory(
            at: destinationURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let temporaryURL = destinationURL.deletingLastPathComponent()
            .appendingPathComponent(".import-\(UUID().uuidString.lowercased())")
        defer { try? fileManager.removeItem(at: temporaryURL) }
        try fileManager.copyItem(at: sourceURL, to: temporaryURL)
        try fileManager.moveItem(at: temporaryURL, to: destinationURL)
    }

    func loadPayload(filename: String, boxID: UUID) throws -> Data {
        try Data(contentsOf: payloadURL(filename: filename, boxID: boxID))
    }

    func emissionImages(_ images: [DraftImage], boxID: UUID) throws -> [ChatImageAttachment] {
        try images.map { image in
            let data = try Data(contentsOf: payloadURL(filename: image.filename, boxID: boxID))
            return ChatImageAttachment(
                id: image.id,
                mimeType: image.mimeType,
                dataBase64: data.base64EncodedString()
            )
        }
    }

    func removePayload(filename: String, boxID: UUID) throws {
        let url = try payloadURL(filename: filename, boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return
        }
        try fileManager.removeItem(at: url)
    }

    func removePayloads(for images: [DraftImage], boxID: UUID) {
        for image in images {
            try? removePayload(filename: image.filename, boxID: boxID)
        }
    }

    func removePayloads(for files: [DraftFile], boxID: UUID) {
        for file in files {
            try? removePayload(filename: file.filename, boxID: boxID)
        }
    }

    func missingImageIDs(_ images: [DraftImage], boxID: UUID) -> [Int] {
        images.compactMap { image in
            guard
                let url = try? payloadURL(filename: image.filename, boxID: boxID),
                fileManager.fileExists(atPath: url.path)
            else {
                return image.id
            }
            return nil
        }
    }

    func missingFileIDs(_ files: [DraftFile], boxID: UUID) -> [Int] {
        files.compactMap { file in
            guard
                let url = try? payloadURL(filename: file.filename, boxID: boxID),
                fileManager.fileExists(atPath: url.path)
            else {
                return file.id
            }
            return nil
        }
    }

    func manifestURL(boxID: UUID) -> URL {
        boxDirectory(boxID: boxID).appendingPathComponent("manifest.json")
    }

    func pendingManifestURL(boxID: UUID) -> URL {
        boxDirectory(boxID: boxID).appendingPathComponent("pending-emissions.json")
    }

    func voicePreparationManifestURL(boxID: UUID) -> URL {
        boxDirectory(boxID: boxID).appendingPathComponent("voice-preparation.json")
    }

    private func boxDirectory(boxID: UUID) -> URL {
        rootURL.appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
    }

    func payloadURL(filename: String, boxID: UUID) throws -> URL {
        guard
            filename.isEmpty == false,
            filename == (filename as NSString).lastPathComponent,
            filename != ".",
            filename != ".."
        else {
            throw RepositoryError.invalidPayloadFilename
        }
        return boxDirectory(boxID: boxID).appendingPathComponent(filename, isDirectory: false)
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
