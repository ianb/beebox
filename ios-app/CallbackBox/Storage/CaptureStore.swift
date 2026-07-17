import Foundation

struct CaptureUploadCandidate: Equatable, Sendable {
    var boxID: UUID
    var sessionID: CaptureSessionID
    var itemID: UUID
}

actor CaptureStore {
    static let maximumUploadBytes: Int64 = 50 * 1024 * 1024
    static let maximumUploadAttempts = 4

    private let rootURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(rootURL: URL? = nil, fileManager: FileManager = .default) {
        if let rootURL {
            self.rootURL = rootURL
        } else {
            let supportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.rootURL = supportURL.appendingPathComponent("Capture", isDirectory: true)
        }
        self.fileManager = fileManager
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        decoder = JSONDecoder()
    }

    func createManifest(
        boxID: UUID,
        sessionID: CaptureSessionID,
        targetSessionID: String?,
        startedAt: String
    ) throws -> CaptureManifest {
        try validate(sessionID: sessionID)
        let manifest = CaptureManifest(
            boxID: boxID,
            sessionID: sessionID,
            targetSessionID: targetSessionID,
            startedAt: startedAt
        )
        try write(manifest)
        return manifest
    }

    func loadManifest(boxID: UUID, sessionID: CaptureSessionID) throws -> CaptureManifest? {
        try validate(sessionID: sessionID)
        let url = manifestURL(boxID: boxID, sessionID: sessionID)
        guard fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        let manifest = try decoder.decode(CaptureManifest.self, from: Data(contentsOf: url))
        try validate(manifest: manifest, expectedBoxID: boxID, expectedSessionID: sessionID)
        return manifest
    }

    func loadAllManifests() throws -> [CaptureManifest] {
        guard fileManager.fileExists(atPath: rootURL.path) else {
            return []
        }
        let keys: [URLResourceKey] = [.isRegularFileKey]
        guard let enumerator = fileManager.enumerator(
            at: rootURL,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        var manifests: [CaptureManifest] = []
        for case let url as URL in enumerator where url.lastPathComponent == "manifest.json" {
            let manifest = try decoder.decode(CaptureManifest.self, from: Data(contentsOf: url))
            try validate(manifest: manifest, expectedBoxID: manifest.boxID, expectedSessionID: manifest.sessionID)
            manifests.append(manifest)
        }
        return manifests.sorted { $0.startedAt < $1.startedAt }
    }

    func beginItem(boxID: UUID, sessionID: CaptureSessionID, item: CaptureItem) throws -> URL {
        try validate(item: item)
        var manifest = try requiredManifest(boxID: boxID, sessionID: sessionID)
        guard manifest.items.contains(where: { $0.id == item.id }) == false else {
            throw CaptureFailure.invalidManifest("Capture item \(item.id) already exists.")
        }
        manifest.items.append(item)
        try write(manifest)
        return payloadURL(boxID: boxID, sessionID: sessionID, filename: item.filename)
    }

    func importPayload(
        from sourceURL: URL,
        boxID: UUID,
        sessionID: CaptureSessionID,
        item: CaptureItem
    ) throws {
        guard item.state == .local else {
            throw CaptureFailure.invalidManifest("Imported capture items must begin in local state.")
        }
        try validate(item: item)
        _ = try preflightPayload(at: sourceURL)
        var manifest = try requiredManifest(boxID: boxID, sessionID: sessionID)
        guard manifest.items.contains(where: { $0.id == item.id }) == false else {
            throw CaptureFailure.invalidManifest("Capture item \(item.id) already exists.")
        }

        let destinationURL = payloadURL(boxID: boxID, sessionID: sessionID, filename: item.filename)
        try fileManager.createDirectory(
            at: destinationURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let temporaryURL = destinationURL.appendingPathExtension("importing")
        try? fileManager.removeItem(at: temporaryURL)
        do {
            try fileManager.copyItem(at: sourceURL, to: temporaryURL)
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
            manifest.items.append(item)
            try write(manifest)
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            try? fileManager.removeItem(at: destinationURL)
            throw error
        }
    }

    func markRecordingClosed(boxID: UUID, sessionID: CaptureSessionID, itemID: UUID) throws {
        let item = try item(boxID: boxID, sessionID: sessionID, itemID: itemID)
        let url = payloadURL(boxID: boxID, sessionID: sessionID, filename: item.filename)
        _ = try preflightPayload(at: url)
        try transition(boxID: boxID, sessionID: sessionID, itemID: itemID, to: .local)
    }

    func markUploading(
        boxID: UUID,
        sessionID: CaptureSessionID,
        itemID: UUID,
        taskIdentifier: Int
    ) throws -> CaptureBackgroundTaskMetadata {
        var manifest = try requiredManifest(boxID: boxID, sessionID: sessionID)
        let index = try itemIndex(in: manifest, itemID: itemID)
        let current = manifest.items[index]
        let url = payloadURL(boxID: boxID, sessionID: sessionID, filename: current.filename)
        _ = try preflightPayload(at: url)
        let next = CaptureItemState.uploading(taskIdentifier: taskIdentifier)
        guard current.state.canTransition(to: next) else {
            throw CaptureFailure.invalidTransition(from: current.state, to: next)
        }
        manifest.items[index].uploadGeneration += 1
        manifest.items[index].state = next
        let metadata = CaptureBackgroundTaskMetadata(
            boxID: boxID,
            sessionID: sessionID,
            itemID: itemID,
            generation: manifest.items[index].uploadGeneration
        )
        try write(manifest)
        return metadata
    }

    @discardableResult
    func acknowledgeUpload(metadata: CaptureBackgroundTaskMetadata, taskIdentifier: Int) throws -> Bool {
        var manifest = try requiredManifest(boxID: metadata.boxID, sessionID: metadata.sessionID)
        let index = try itemIndex(in: manifest, itemID: metadata.itemID)
        let item = manifest.items[index]
        if item.state == .uploaded {
            try removePayloadIfPresent(manifest: manifest, item: item)
            return true
        }
        guard
            item.uploadGeneration == metadata.generation,
            item.state == .uploading(taskIdentifier: taskIdentifier)
        else {
            return false
        }
        manifest.items[index].state = .uploaded
        try write(manifest)
        try removePayloadIfPresent(manifest: manifest, item: manifest.items[index])
        return true
    }

    func transition(
        boxID: UUID,
        sessionID: CaptureSessionID,
        itemID: UUID,
        to next: CaptureItemState
    ) throws {
        var manifest = try requiredManifest(boxID: boxID, sessionID: sessionID)
        let index = try itemIndex(in: manifest, itemID: itemID)
        let current = manifest.items[index].state
        guard current.canTransition(to: next) else {
            throw CaptureFailure.invalidTransition(from: current, to: next)
        }
        manifest.items[index].state = next
        try write(manifest)
    }

    func recordUploadFailure(
        metadata: CaptureBackgroundTaskMetadata,
        taskIdentifier: Int,
        failure: CaptureUploadFailure
    ) throws -> CaptureUploadFailureResolution {
        var manifest = try requiredManifest(boxID: metadata.boxID, sessionID: metadata.sessionID)
        let index = try itemIndex(in: manifest, itemID: metadata.itemID)
        let item = manifest.items[index]
        guard
            item.uploadGeneration == metadata.generation,
            item.state == .uploading(taskIdentifier: taskIdentifier)
        else {
            return .ignoredStaleCompletion
        }

        switch failure {
        case .retryable where item.uploadGeneration < Self.maximumUploadAttempts:
            manifest.items[index].state = .local
            try write(manifest)
            let delay = 1 << (item.uploadGeneration - 1)
            return .retry(afterSeconds: delay)
        case .retryable(let message), .terminal(let message):
            manifest.items[index].state = .failed(message: message)
            try write(manifest)
            return .failed
        }
    }

    func reconcileBackgroundTasks(_ tasks: [CaptureBackgroundTask]) throws -> [CaptureUploadCandidate] {
        let tasksByIdentifier = Dictionary(uniqueKeysWithValues: tasks.map { ($0.taskIdentifier, $0.metadata) })
        var candidates: [CaptureUploadCandidate] = []
        for var manifest in try loadAllManifests() {
            var changed = false
            for index in manifest.items.indices {
                let item = manifest.items[index]
                guard case .uploading(let taskIdentifier) = item.state else {
                    if item.state == .local {
                        candidates.append(candidate(manifest: manifest, itemID: item.id))
                    }
                    continue
                }
                let metadata = tasksByIdentifier[taskIdentifier]
                let matches = metadata?.boxID == manifest.boxID
                    && metadata?.sessionID == manifest.sessionID
                    && metadata?.itemID == item.id
                    && metadata?.generation == item.uploadGeneration
                if matches == false {
                    manifest.items[index].state = .local
                    candidates.append(candidate(manifest: manifest, itemID: item.id))
                    changed = true
                }
            }
            if changed {
                try write(manifest)
            }
        }
        return candidates
    }

    func preflightPayload(at url: URL) throws -> Int64 {
        guard fileManager.fileExists(atPath: url.path) else {
            throw CaptureFailure.payloadMissing(url.lastPathComponent)
        }
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        let byteCount = Int64(values.fileSize ?? 0)
        guard byteCount <= Self.maximumUploadBytes else {
            throw CaptureFailure.payloadTooLarge(byteCount: byteCount)
        }
        return byteCount
    }

    private func requiredManifest(boxID: UUID, sessionID: CaptureSessionID) throws -> CaptureManifest {
        guard let manifest = try loadManifest(boxID: boxID, sessionID: sessionID) else {
            throw CaptureFailure.invalidManifest("Capture manifest does not exist.")
        }
        return manifest
    }

    private func item(boxID: UUID, sessionID: CaptureSessionID, itemID: UUID) throws -> CaptureItem {
        let manifest = try requiredManifest(boxID: boxID, sessionID: sessionID)
        return manifest.items[try itemIndex(in: manifest, itemID: itemID)]
    }

    private func itemIndex(in manifest: CaptureManifest, itemID: UUID) throws -> Int {
        guard let index = manifest.items.firstIndex(where: { $0.id == itemID }) else {
            throw CaptureFailure.invalidManifest("Capture item \(itemID) does not exist.")
        }
        return index
    }

    private func write(_ manifest: CaptureManifest) throws {
        let url = manifestURL(boxID: manifest.boxID, sessionID: manifest.sessionID)
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(manifest).write(to: url, options: [.atomic])
    }

    private func manifestURL(boxID: UUID, sessionID: CaptureSessionID) -> URL {
        sessionDirectory(boxID: boxID, sessionID: sessionID).appendingPathComponent("manifest.json")
    }

    private func sessionDirectory(boxID: UUID, sessionID: CaptureSessionID) -> URL {
        rootURL
            .appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent(sessionID.rawValue, isDirectory: true)
    }

    private func payloadURL(boxID: UUID, sessionID: CaptureSessionID, filename: String) -> URL {
        sessionDirectory(boxID: boxID, sessionID: sessionID).appendingPathComponent(filename)
    }

    private func validate(sessionID: CaptureSessionID) throws {
        let value = sessionID.rawValue
        guard value.isEmpty == false, value != ".", value != "..", value.contains("/") == false else {
            throw CaptureFailure.invalidManifest("Capture session identifier is unsafe.")
        }
    }

    private func validate(item: CaptureItem) throws {
        guard item.filename == (item.filename as NSString).lastPathComponent else {
            throw CaptureFailure.invalidManifest("Capture filename is unsafe.")
        }
        if item.kind == .photo {
            try CaptureFilename.validatePhoto(filename: item.filename, mimeType: item.mimeType)
        }
    }

    private func validate(
        manifest: CaptureManifest,
        expectedBoxID: UUID,
        expectedSessionID: CaptureSessionID
    ) throws {
        try validate(sessionID: manifest.sessionID)
        guard
            manifest.version == CaptureManifest.currentVersion,
            manifest.boxID == expectedBoxID,
            manifest.sessionID == expectedSessionID
        else {
            throw CaptureFailure.invalidManifest("Capture manifest identity or version is invalid.")
        }
        try manifest.items.forEach(validate(item:))
    }

    private func candidate(manifest: CaptureManifest, itemID: UUID) -> CaptureUploadCandidate {
        CaptureUploadCandidate(boxID: manifest.boxID, sessionID: manifest.sessionID, itemID: itemID)
    }

    private func removePayloadIfPresent(manifest: CaptureManifest, item: CaptureItem) throws {
        let url = payloadURL(boxID: manifest.boxID, sessionID: manifest.sessionID, filename: item.filename)
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }
}
