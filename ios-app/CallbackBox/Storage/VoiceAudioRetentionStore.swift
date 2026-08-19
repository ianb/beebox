import Foundation

/// One retained recording's metadata. The WAV itself lives beside the index as
/// `<emissionID>.wav`; `text` and `recordedAt` ride the answer to the box as
/// multipart fields, so they are kept with the bytes rather than re-derived.
struct RetainedVoiceAudio: Codable, Equatable, Sendable {
    var emissionID: String
    var recordedAt: Date
    var text: String
    /// The chat session this was dictated INTO, not whichever session happens
    /// to be on screen when an agent asks for it. The answer carries it back so
    /// the retranscription lands on the right conversation even if the phone
    /// has since navigated elsewhere. Nil when the tab had no session yet.
    var sessionID: String?
}

private struct VoiceAudioRetentionManifest: Codable, Equatable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var entries: [RetainedVoiceAudio]

    init(boxID: UUID, entries: [RetainedVoiceAudio]) {
        version = Self.currentVersion
        self.boxID = boxID
        self.entries = entries
    }
}

/// Recordings kept after send so a box agent can retranscribe them
/// (`cb chat retranscribe --message <id>`), keyed by emission id.
///
/// This is the native half of what the web layer does in memory
/// (`callback-box/src/frontend/src/lib/audio/last-audio.ts`), and it keeps that
/// store's vocabulary: bounded to the `capacity` most recent recordings,
/// oldest evicted first. Unlike the web store it is on disk, so it survives an
/// app relaunch and the WKWebView content-process reload.
///
/// Deliberately NOT the `ComposerDraftRepository` payload store. That one's
/// lifecycle is draft-and-pending-scoped — payloads are swept the moment an
/// emission is delivered, which is exactly when retention has to begin.
///
/// Retention is per box: the recordings belong to the box they were dictated
/// into, and `forget(boxID:)` drops all of them when a box is unpaired.
actor VoiceAudioRetentionStore {
    /// Matches the web store's `RETENTION_CAPACITY`. Kept identical so "the
    /// last five recordings" means one thing across both composers.
    static let defaultCapacity = 5

    /// Retention is written by the composer and read by the webview's answer
    /// path — two views with no ownership relationship — so the app shares one
    /// instance rather than threading it through both. `init` stays injectable
    /// for tests, which use their own temporary root.
    static let shared = VoiceAudioRetentionStore()

    private let rootURL: URL
    private let fileManager: FileManager
    private let capacity: Int

    /// Where the shared store keeps its recordings. Exposed because unpairing
    /// deletes a box's recordings synchronously, on a non-async path — see
    /// `forgetSynchronously`.
    nonisolated static var defaultRootURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("voice-retention", isDirectory: true)
    }

    nonisolated static func boxDirectory(boxID: UUID, in root: URL) -> URL {
        root.appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
    }

    /// Delete a box's recordings without awaiting an actor.
    ///
    /// Unpairing runs on a synchronous path, and handing the deletion to a
    /// detached task would let the app be suspended between dropping the
    /// pairing and dropping the audio — leaving recordings on disk for a box
    /// the user has removed. Deleting a directory is one filesystem call, so
    /// there is nothing to gain by deferring it.
    nonisolated static func forgetSynchronously(boxID: UUID) {
        try? FileManager.default.removeItem(at: boxDirectory(boxID: boxID, in: defaultRootURL))
    }

    init(
        rootURL: URL? = nil,
        fileManager: FileManager = .default,
        capacity: Int = VoiceAudioRetentionStore.defaultCapacity
    ) {
        self.fileManager = fileManager
        self.capacity = capacity
        self.rootURL = rootURL ?? Self.defaultRootURL
    }

    /// Take ownership of a recording, moving it out of wherever it was staged.
    /// Moving rather than copying is deliberate: every caller was deleting the
    /// file on this line before, so a copy would leave the original behind.
    ///
    /// A failure here is swallowed by design — losing the ability to
    /// retranscribe must never fail a send that has otherwise succeeded. The
    /// agent-visible outcome of a lost recording is the same "no recording is
    /// cached" it already handles.
    func retain(_ audio: RetainedVoiceAudio, movingFrom sourceURL: URL, boxID: UUID) {
        let destination = audioURL(emissionID: audio.emissionID, boxID: boxID)
        do {
            try fileManager.createDirectory(at: boxDirectory(boxID: boxID), withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.moveItem(at: sourceURL, to: destination)
            var entries = load(boxID: boxID).filter { $0.emissionID != audio.emissionID }
            entries.append(audio)
            let (kept, evicted) = overCapacity(entries)
            // Save FIRST, delete the evicted bytes after. The other order can
            // fail between the two and leave the manifest naming audio that is
            // already gone.
            try save(kept, boxID: boxID)
            for entry in evicted {
                try? fileManager.removeItem(at: audioURL(emissionID: entry.emissionID, boxID: boxID))
            }
        } catch {
            BoxLog.error(
                "voice retention failed for emission \(audio.emissionID): \(error.localizedDescription)",
                category: .composer
            )
            // Both ends: the source if the move never happened, the destination
            // if it did and the manifest save is what failed. Either one left
            // behind is bytes no manifest will ever name again.
            try? fileManager.removeItem(at: sourceURL)
            try? fileManager.removeItem(at: destination)
        }
    }

    /// Forget one recording — used when a send is discarded or pulled back into
    /// the composer, so audio does not outlive the message it belongs to.
    func forget(emissionID: String, boxID: UUID) {
        let remaining = load(boxID: boxID).filter { $0.emissionID != emissionID }
        try? save(remaining, boxID: boxID)
        try? fileManager.removeItem(at: audioURL(emissionID: emissionID, boxID: boxID))
    }

    /// Replace a retained recording's transcript, leaving the bytes alone.
    ///
    /// The HQ path retains at send time, when only the realtime transcript
    /// exists; the message actually commits with the HQ transcript minutes
    /// later. The answer carries this text to the agent as the transcript to
    /// compare the audio against, so it has to be the one the message shipped
    /// with. A no-op if the recording has since been evicted.
    func updateText(emissionID: String, text: String, boxID: UUID) {
        var entries = load(boxID: boxID)
        guard let index = entries.firstIndex(where: { $0.emissionID == emissionID }) else {
            return
        }
        entries[index].text = text
        try? save(entries, boxID: boxID)
    }

    /// The retained recording for one emission id, or nil when this device
    /// never held it or has since evicted it. Returns nil rather than a
    /// dangling entry when the bytes are gone from under the index.
    func retained(emissionID: String, boxID: UUID) -> (audio: RetainedVoiceAudio, url: URL)? {
        guard let entry = load(boxID: boxID).first(where: { $0.emissionID == emissionID }) else {
            return nil
        }
        let url = audioURL(emissionID: emissionID, boxID: boxID)
        guard fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        return (entry, url)
    }

    /// Drop every recording for a box.
    func forget(boxID: UUID) {
        try? fileManager.removeItem(at: boxDirectory(boxID: boxID))
    }

    /// Entry count, for tests and diagnostics.
    func count(boxID: UUID) -> Int {
        load(boxID: boxID).count
    }

    /// Split into the `capacity` most recent and the ones falling off the end.
    /// Ordering is by `recordedAt`, so a recording staged for a slow HQ pass and
    /// retained late still sorts by when it was actually spoken.
    private func overCapacity(
        _ entries: [RetainedVoiceAudio]
    ) -> (kept: [RetainedVoiceAudio], evicted: [RetainedVoiceAudio]) {
        let sorted = entries.sorted { first, second in
            if first.recordedAt == second.recordedAt {
                return first.emissionID < second.emissionID
            }
            return first.recordedAt < second.recordedAt
        }
        guard sorted.count > capacity else {
            return (sorted, [])
        }
        return (Array(sorted.suffix(capacity)), Array(sorted.prefix(sorted.count - capacity)))
    }

    /// A corrupt or foreign-box manifest reads as empty rather than throwing:
    /// the whole store is a best-effort cache, and refusing to answer at all is
    /// worse than answering "no recording" for one that cannot be read.
    private func load(boxID: UUID) -> [RetainedVoiceAudio] {
        let url = manifestURL(boxID: boxID)
        guard
            let data = try? Data(contentsOf: url),
            let manifest = try? JSONDecoder().decode(VoiceAudioRetentionManifest.self, from: data),
            manifest.version == VoiceAudioRetentionManifest.currentVersion,
            manifest.boxID == boxID
        else {
            return []
        }
        return manifest.entries
    }

    private func save(_ entries: [RetainedVoiceAudio], boxID: UUID) throws {
        let data = try JSONEncoder().encode(VoiceAudioRetentionManifest(boxID: boxID, entries: entries))
        try data.write(to: manifestURL(boxID: boxID), options: .atomic)
    }

    private func boxDirectory(boxID: UUID) -> URL {
        Self.boxDirectory(boxID: boxID, in: rootURL)
    }

    private func manifestURL(boxID: UUID) -> URL {
        boxDirectory(boxID: boxID).appendingPathComponent("retained.json")
    }

    /// Emission ids are app-generated UUIDs, but this path is built from a
    /// value that crossed the bridge on the lookup side, so the id is reduced
    /// to a filename-safe form rather than trusted as a path component.
    private func audioURL(emissionID: String, boxID: UUID) -> URL {
        let safe = emissionID.map { character -> Character in
            character.isLetter || character.isNumber || character == "-" ? character : "_"
        }
        return boxDirectory(boxID: boxID)
            .appendingPathComponent(String(safe))
            .appendingPathExtension("wav")
    }
}
