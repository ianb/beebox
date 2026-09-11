import Foundation

struct VoiceStagingUploadCandidate: Equatable, Sendable {
    var boxID: UUID
    var recordingID: VoiceRecordingID
    var chunkIndex: Int
}

struct VoiceStagingUploadPayload: Sendable {
    var chunk: VoiceStagingChunk
    var fileURL: URL
}

/// Persisted per box, on disk, so a killed app resumes a recording exactly
/// where it left off — the manifest is the only source of truth for what has
/// been staged, uploaded, and finalized (`docs/plans/resilient-voice-recording.md`,
/// Track 6). Deliberately not `CaptureStore`: that store validates audio as
/// `.m4aAAC` only, has no PCM-chunk state, fixes `.m4a` filenames, and caps
/// retries by attempt count rather than age — none of which fit a
/// chunked-while-recording PCM upload.
actor VoiceStagingStore {
    private let rootURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(rootURL: URL? = nil, fileManager: FileManager = .default) {
        if let rootURL {
            self.rootURL = rootURL
        } else {
            let supportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.rootURL = supportURL.appendingPathComponent("VoiceStaging", isDirectory: true)
        }
        self.fileManager = fileManager
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        decoder = JSONDecoder()
    }

    /// Where chunk files for this recording live. The chunk writer writes
    /// directly here; the store only ever reads what lands in it.
    func directoryURL(boxID: UUID, recordingID: VoiceRecordingID) -> URL {
        sessionDirectory(boxID: boxID, recordingID: recordingID)
    }

    /// Idempotent: a repeat call (e.g. a relaunch replaying a queued start)
    /// returns the existing manifest rather than resetting it.
    @discardableResult
    func createRecording(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        targetSessionID: String,
        createdAt: String
    ) throws -> VoiceStagingManifest {
        if let existing = try loadManifest(boxID: boxID, recordingID: recordingID) {
            return existing
        }
        let manifest = VoiceStagingManifest(
            boxID: boxID,
            recordingID: recordingID,
            targetSessionID: targetSessionID,
            createdAt: createdAt
        )
        try write(manifest)
        return manifest
    }

    func loadManifest(boxID: UUID, recordingID: VoiceRecordingID) throws -> VoiceStagingManifest? {
        let url = manifestURL(boxID: boxID, recordingID: recordingID)
        guard fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        return try decoder.decode(VoiceStagingManifest.self, from: Data(contentsOf: url))
    }

    func loadAllManifests() throws -> [VoiceStagingManifest] {
        guard fileManager.fileExists(atPath: rootURL.path) else {
            return []
        }
        guard let enumerator = fileManager.enumerator(
            at: rootURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        var manifests: [VoiceStagingManifest] = []
        for case let url as URL in enumerator where url.lastPathComponent == "manifest.json" {
            manifests.append(try decoder.decode(VoiceStagingManifest.self, from: Data(contentsOf: url)))
        }
        return manifests.sorted { $0.createdAt < $1.createdAt }
    }

    func markSessionCreated(boxID: UUID, recordingID: VoiceRecordingID) throws {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        manifest.sessionCreation = .created
        try write(manifest)
    }

    func markSessionCreationFailed(boxID: UUID, recordingID: VoiceRecordingID, message: String) throws {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        manifest.sessionCreation = .failed(message: message)
        try write(manifest)
    }

    /// Register a chunk the writer just finished. A repeat with the same
    /// index (a re-delivered tap flush racing teardown) is a no-op rather than
    /// a duplicate-entry error — the writer's chunk indices are monotonic and
    /// unique by construction, but persistence must stay idempotent regardless.
    @discardableResult
    func addChunk(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        index: Int,
        filename: String,
        byteCount: Int
    ) throws -> VoiceStagingChunk {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        if let existing = manifest.chunks.first(where: { $0.index == index }) {
            return existing
        }
        let chunk = VoiceStagingChunk(
            index: index,
            filename: filename,
            byteCount: byteCount,
            state: .local,
            uploadGeneration: 0
        )
        manifest.chunks.append(chunk)
        manifest.chunks.sort { $0.index < $1.index }
        try write(manifest)
        return chunk
    }

    func uploadPayload(for candidate: VoiceStagingUploadCandidate) throws -> VoiceStagingUploadPayload {
        let manifest = try required(boxID: candidate.boxID, recordingID: candidate.recordingID)
        guard let chunk = manifest.chunks.first(where: { $0.index == candidate.chunkIndex }) else {
            throw VoiceStagingFailure.invalidManifest("Chunk \(candidate.chunkIndex) does not exist.")
        }
        let url = payloadURL(boxID: candidate.boxID, recordingID: candidate.recordingID, filename: chunk.filename)
        guard fileManager.fileExists(atPath: url.path) else {
            throw VoiceStagingFailure.payloadMissing(chunk.filename)
        }
        return VoiceStagingUploadPayload(chunk: chunk, fileURL: url)
    }

    func markUploading(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        chunkIndex: Int,
        taskIdentifier: Int
    ) throws -> VoiceStagingBackgroundTaskMetadata {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        guard let index = manifest.chunks.firstIndex(where: { $0.index == chunkIndex }) else {
            throw VoiceStagingFailure.invalidManifest("Chunk \(chunkIndex) does not exist.")
        }
        let generation = manifest.chunks[index].uploadGeneration + 1
        manifest.chunks[index].uploadGeneration = generation
        manifest.chunks[index].state = .uploading(taskIdentifier: taskIdentifier)
        try write(manifest)
        return VoiceStagingBackgroundTaskMetadata(
            boxID: boxID,
            recordingID: recordingID,
            chunkIndex: chunkIndex,
            generation: generation
        )
    }

    /// Returns `true` once this chunk is durably marked uploaded — including
    /// when it already was (a replayed completion for a chunk another
    /// completion already acknowledged), so callers can treat both as success
    /// without re-deriving the distinction.
    @discardableResult
    func acknowledgeUpload(metadata: VoiceStagingBackgroundTaskMetadata, taskIdentifier: Int) throws -> Bool {
        var manifest = try required(boxID: metadata.boxID, recordingID: metadata.recordingID)
        guard let index = manifest.chunks.firstIndex(where: { $0.index == metadata.chunkIndex }) else {
            return false
        }
        if manifest.chunks[index].state == .uploaded {
            return true
        }
        guard
            manifest.chunks[index].uploadGeneration == metadata.generation,
            manifest.chunks[index].state == .uploading(taskIdentifier: taskIdentifier)
        else {
            return false
        }
        manifest.chunks[index].state = .uploaded
        try write(manifest)
        removePayloadIfPresent(manifest: manifest, chunk: manifest.chunks[index])
        return true
    }

    /// `now` decides only the retry-vs-terminal split (against the
    /// recording's own `createdAt`, via `VoiceStagingRetryPolicy`) — injected
    /// so tests can simulate a 7-day-old recording without sleeping.
    func recordUploadFailure(
        metadata: VoiceStagingBackgroundTaskMetadata,
        taskIdentifier: Int,
        failure: VoiceStagingUploadFailure,
        now: Date
    ) throws -> VoiceStagingUploadResolution {
        var manifest = try required(boxID: metadata.boxID, recordingID: metadata.recordingID)
        guard let index = manifest.chunks.firstIndex(where: { $0.index == metadata.chunkIndex }) else {
            return .ignoredStaleCompletion
        }
        guard
            manifest.chunks[index].uploadGeneration == metadata.generation,
            manifest.chunks[index].state == .uploading(taskIdentifier: taskIdentifier)
        else {
            return .ignoredStaleCompletion
        }
        let withinBound = VoiceStagingRetryPolicy.isWithinRetryBound(createdAt: manifest.createdAt, now: now)
        switch failure {
        case .retryable where withinBound:
            manifest.chunks[index].state = .local
            try write(manifest)
            return .retry(afterSeconds: VoiceStagingRetryPolicy.backoffSeconds(attempt: metadata.generation))
        case .retryable(let message), .terminal(let message):
            manifest.chunks[index].state = .failed(message: message)
            try write(manifest)
            return .failed
        }
    }

    /// A chunk mid-upload with no matching live background task (killed,
    /// evicted, or a stale generation) goes back to `.local` and is returned
    /// as a candidate to reschedule — mirrors `CaptureStore.reconcileBackgroundTasks`.
    /// Only recordings whose session-create has actually landed are eligible:
    /// uploading before the box has acknowledged the recording would 404.
    func reconcileBackgroundTasks(
        _ tasks: [(taskIdentifier: Int, metadata: VoiceStagingBackgroundTaskMetadata)]
    ) throws -> [VoiceStagingUploadCandidate] {
        let tasksByIdentifier = Dictionary(uniqueKeysWithValues: tasks.map { ($0.taskIdentifier, $0.metadata) })
        var candidates: [VoiceStagingUploadCandidate] = []
        for var manifest in try loadAllManifests() {
            guard manifest.sessionCreation == .created else {
                continue
            }
            var changed = false
            for index in manifest.chunks.indices {
                let chunk = manifest.chunks[index]
                guard case .uploading(let taskIdentifier) = chunk.state else {
                    if chunk.state == .local {
                        candidates.append(candidate(manifest: manifest, chunkIndex: chunk.index))
                    }
                    continue
                }
                let metadata = tasksByIdentifier[taskIdentifier]
                let matches = metadata?.boxID == manifest.boxID
                    && metadata?.recordingID == manifest.recordingID
                    && metadata?.chunkIndex == chunk.index
                    && metadata?.generation == chunk.uploadGeneration
                if matches == false {
                    manifest.chunks[index].state = .local
                    candidates.append(candidate(manifest: manifest, chunkIndex: chunk.index))
                    changed = true
                }
            }
            if changed {
                try write(manifest)
            }
        }
        return candidates
    }

    /// Recordings whose session-create never succeeded and never reached its
    /// own terminal failure — resumed at launch the same way a mid-upload
    /// chunk is.
    func recordingsPendingSessionCreation() throws -> [VoiceStagingManifest] {
        try loadAllManifests().filter { $0.sessionCreation == .pending }
    }

    func markFinalizeRequested(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        chunkCount: Int,
        hq: VoiceHqFinalizePayload?
    ) throws {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        manifest.finalize = .pending(chunkCount: chunkCount, hq: hq)
        try write(manifest)
    }

    func markSealed(boxID: UUID, recordingID: VoiceRecordingID) throws {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        manifest.finalize = .sealed
        try write(manifest)
    }

    func markFinalizeTerminal(boxID: UUID, recordingID: VoiceRecordingID, message: String) throws {
        var manifest = try required(boxID: boxID, recordingID: recordingID)
        manifest.finalize = .terminal(message: message)
        try write(manifest)
    }

    func deleteRecording(boxID: UUID, recordingID: VoiceRecordingID) throws {
        let directory = sessionDirectory(boxID: boxID, recordingID: recordingID)
        if fileManager.fileExists(atPath: directory.path) {
            try fileManager.removeItem(at: directory)
        }
    }

    private func required(boxID: UUID, recordingID: VoiceRecordingID) throws -> VoiceStagingManifest {
        guard let manifest = try loadManifest(boxID: boxID, recordingID: recordingID) else {
            throw VoiceStagingFailure.invalidManifest("Voice staging manifest does not exist.")
        }
        return manifest
    }

    private func write(_ manifest: VoiceStagingManifest) throws {
        let url = manifestURL(boxID: manifest.boxID, recordingID: manifest.recordingID)
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(manifest).write(to: url, options: [.atomic])
    }

    private func manifestURL(boxID: UUID, recordingID: VoiceRecordingID) -> URL {
        sessionDirectory(boxID: boxID, recordingID: recordingID).appendingPathComponent("manifest.json")
    }

    private func sessionDirectory(boxID: UUID, recordingID: VoiceRecordingID) -> URL {
        rootURL
            .appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent(recordingID.rawValue, isDirectory: true)
    }

    private func payloadURL(boxID: UUID, recordingID: VoiceRecordingID, filename: String) -> URL {
        sessionDirectory(boxID: boxID, recordingID: recordingID).appendingPathComponent(filename)
    }

    private func candidate(manifest: VoiceStagingManifest, chunkIndex: Int) -> VoiceStagingUploadCandidate {
        VoiceStagingUploadCandidate(boxID: manifest.boxID, recordingID: manifest.recordingID, chunkIndex: chunkIndex)
    }

    private func removePayloadIfPresent(manifest: VoiceStagingManifest, chunk: VoiceStagingChunk) {
        let url = payloadURL(boxID: manifest.boxID, recordingID: manifest.recordingID, filename: chunk.filename)
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: url)
        }
    }
}
