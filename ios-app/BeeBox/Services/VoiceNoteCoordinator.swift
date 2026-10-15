import ActivityKit
import AVFoundation
import Combine
import CryptoKit
import Foundation

enum VoiceNoteLimits {
    static let maximumSeconds: TimeInterval = 600
    static let warningSeconds: TimeInterval = 540
    static func reached(elapsed: TimeInterval, bytes: Int, byteLimit: Int) -> Bool {
        elapsed >= maximumSeconds || bytes >= max(0, byteLimit - 65_536)
    }
}

/// Owns a recording independently of a view, speech recognizer, or browsed box.
@MainActor
final class VoiceNoteCoordinator: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let shared = VoiceNoteCoordinator()
    enum Phase: Equatable { case idle, starting, recording, interrupted, saving, failed }
    enum Failure: LocalizedError {
        case activeElsewhere, interruptedPending(String), alreadyStarting, microphoneDenied, liveActivitiesDisabled, storageUnavailable, retainedUnavailable, noRecording, recordingFailed
        var errorDescription: String? {
            switch self {
            case .interruptedPending(let label): "An interrupted voice note for \(label) is waiting. Open Bee Box to save or discard it."
            case .alreadyStarting: "The voice note is still starting. Wait for the recording indicator."
            case .activeElsewhere: "A voice note is already recording for another box. Stop and save it first."
            case .microphoneDenied: "Microphone access is unavailable. Enable it in Settings before recording."
            case .liveActivitiesDisabled: "Enable Live Activities for Bee Box before recording."
            case .storageUnavailable: "The recording could not be saved on this phone."
            case .retainedUnavailable: "A retained recording is unavailable. Unlock this phone and open Bee Box to recover it before starting another note."
            case .noRecording: "There is no voice note to save."
            case .recordingFailed: "Recording did not start. Open Bee Box and try again."
            }
        }
    }
    struct Draft: Codable {
        var id: UUID
        var boxID: UUID
        var boxLabel: String
        var startedAt: Date
        var interrupted: Bool
        var segmentCount: Int? = 0
        var requiresDeviceUnlock: Bool? = false
    }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var message: String?
    @Published private(set) var draft: Draft?
    private var recorder: AVAudioRecorder?
    private var targetBox: PairedBox?
    private var latestBoxes: [PairedBox]?
    private var lastSavedBoxLabel: String?
    private var completedSeconds: TimeInterval = 0
    private var saveInProgress = false
    private var exportInProgress = false
    private var activity: Activity<VoiceNoteActivityAttributes>?
    private var activityMonitor: Task<Void, Never>?
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private let fileManager = FileManager.default
    private let directoryOverride: URL?
    private let captureStore: QuickCaptureStore
    private let uploadCoordinator: QuickCaptureUploadCoordinator
    private let scheduleHandler: (@MainActor (QuickCaptureRecord, PairedBox) async throws -> Void)?
    private var directory: URL? {
        directoryOverride ?? fileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.app.beebox.ios")?
            .appendingPathComponent("voice-note-draft", isDirectory: true)
    }
    private var audioURL: URL? { directory?.appendingPathComponent("recording.m4a") }
    private func segmentURL(_ index: Int) -> URL? { directory?.appendingPathComponent("segment-\(index).m4a") }
    private var manifestURL: URL? { directory?.appendingPathComponent("draft.json") }
    var isRecording: Bool { phase == .recording }
    var nearLimit: Bool { elapsed >= VoiceNoteLimits.warningSeconds }

    override convenience init() { self.init(directoryURL: nil) }

    init(directoryURL: URL?, captureStore: QuickCaptureStore = .shared, uploadCoordinator: QuickCaptureUploadCoordinator = .shared, scheduleHandler: (@MainActor (QuickCaptureRecord, PairedBox) async throws -> Void)? = nil) {
        directoryOverride = directoryURL
        self.captureStore = captureStore
        self.uploadCoordinator = uploadCoordinator
        self.scheduleHandler = scheduleHandler
        super.init()
        do { try recoverRetainedDraftIfNeeded() } catch { /* The failure is visible and retained bytes stay untouched. */ }
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            Task { @MainActor in await self?.interrupt() }
        }
    }

    /// Pairing changes invalidate an active destination synchronously, before
    /// an automatic recording limit can schedule a transfer using stale credentials.
    func updatePairedBoxes(_ boxes: [PairedBox]) {
        latestBoxes = boxes
        do { try recoverRetainedDraftIfNeeded() } catch { return }
        guard let draft else { return }
        let current = boxes.first { $0.id == draft.boxID }
        let becameProtected = current?.requiresDeviceUnlock == true && draft.requiresDeviceUnlock != true
        if current?.requiresDeviceUnlock == true { self.draft?.requiresDeviceUnlock = true }
        targetBox = current
        if current == nil || current?.authToken?.isEmpty != false || becameProtected {
            recorder?.stop(); recorder = nil
            timer?.invalidate(); timer = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self.draft?.interrupted = true
            phase = .interrupted
            message = becameProtected ? "The recording's box is now protected. Unlock it before saving the retained audio." : "Reconnect the recording's original box before saving. Its audio remains on this phone."
            try? persistDraft()
            if becameProtected, let directory,
               let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                for file in files { try? protect(file) }
            }
            let previousActivity = activity
            activity = nil
            activityMonitor?.cancel(); activityMonitor = nil
            Task {
                if let previousActivity { await previousActivity.end(nil, dismissalPolicy: .immediate) }
                await uploadCoordinator.cancelTransfers(id: draft.id)
            }
            BoxLog.warn("voice recording destination unavailable id=\(draft.id)", category: .audio, targetBoxID: draft.boxID)
        }
    }

    /// File presence is checked separately from decoding. Protected data can
    /// be unreadable during a Siri background launch; that is never an empty
    /// draft slot and must never authorize overwriting its retained audio.
    private func recoverRetainedDraftIfNeeded() throws {
        guard draft == nil else { return }
        guard let directory, let manifestURL else { return }
        do {
            _ = try fileManager.attributesOfItem(atPath: directory.path)
        } catch {
            let failure = error as NSError
            if failure.domain == NSCocoaErrorDomain && [CocoaError.fileNoSuchFile.rawValue, CocoaError.fileReadNoSuchFile.rawValue].contains(failure.code) { return }
            try refuseUnavailableRetainedDraft()
        }
        do {
            var recovered = try JSONDecoder().decode(Draft.self, from: Data(contentsOf: manifestURL))
            guard (0...60).contains(recovered.segmentCount ?? 0) else { throw Failure.retainedUnavailable }
            recovered.interrupted = true
            draft = recovered
            phase = .interrupted
            message = "Interrupted voice note. Save the playable audio or discard it."
            BoxLog.warn("voice recording recovered interrupted id=\(recovered.id)", category: .audio, targetBoxID: recovered.boxID)
        } catch { try refuseUnavailableRetainedDraft() }
    }

    private func refuseUnavailableRetainedDraft() throws -> Never {
        let text = Failure.retainedUnavailable.localizedDescription
        if message != text { BoxLog.warn("voice recording recovery refused reason=retained-data-unavailable", category: .audio) }
        phase = .failed
        message = text
        throw Failure.retainedUnavailable
    }

    private func freshTarget(boxes: [PairedBox]? = nil) throws -> PairedBox {
        guard let draft else { throw Failure.noRecording }
        if let current = boxes ?? latestBoxes {
            var resolved = try CaptureDestinationStore().resolve(boxes: current, pinnedBoxID: draft.boxID, allowsProtected: true)
            if draft.requiresDeviceUnlock == true { resolved.requiresDeviceUnlock = true }
            return resolved
        }
        guard let targetBox, targetBox.authToken?.isEmpty == false else { throw Failure.storageUnavailable }
        return targetBox
    }

    func start(box: PairedBox, requireLiveActivity: Bool = true) async throws {
        try recoverRetainedDraftIfNeeded()
        if phase == .starting {
            guard targetBox?.id == box.id else { throw Failure.activeElsewhere }
            throw Failure.alreadyStarting
        }
        if let draft {
            if phase == .interrupted { throw Failure.interruptedPending(draft.boxLabel) }
            guard draft.boxID == box.id else { throw Failure.activeElsewhere }
            if phase == .recording || phase == .starting { return }
            throw Failure.activeElsewhere
        }
        if let latestBoxes {
            _ = try CaptureDestinationStore().resolve(boxes: latestBoxes, pinnedBoxID: box.id, allowsProtected: true)
        }
        phase = .starting
        targetBox = box
        lastSavedBoxLabel = nil
        completedSeconds = 0
        elapsed = 0
        message = nil
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            phase = .failed
            BoxLog.warn("voice recording refused reason=microphone-denied", category: .audio, targetBoxID: box.id)
            throw Failure.microphoneDenied
        }
        if let latestBoxes {
            do {
                let current = try CaptureDestinationStore().resolve(boxes: latestBoxes, pinnedBoxID: box.id, allowsProtected: true)
                guard current.requiresDeviceUnlock == box.requiresDeviceUnlock else { throw CaptureDestinationStore.DestinationError.protected }
            } catch { phase = .failed; throw error }
        }
        if requireLiveActivity && !ActivityAuthorizationInfo().areActivitiesEnabled {
            phase = .failed
            BoxLog.warn("voice recording refused reason=live-activities-disabled", category: .audio, targetBoxID: box.id)
            throw Failure.liveActivitiesDisabled
        }
        guard let directory else { phase = .failed; throw Failure.storageUnavailable }
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: box.requiresDeviceUnlock ? FileProtectionType.complete : FileProtectionType.completeUntilFirstUserAuthentication])
            let newDraft = Draft(id: UUID(), boxID: box.id, boxLabel: box.label, startedAt: Date(), interrupted: false, requiresDeviceUnlock: box.requiresDeviceUnlock)
            draft = newDraft
            targetBox = box
            try persistDraft()
            if requireLiveActivity {
                activity = try Activity.request(
                    attributes: VoiceNoteActivityAttributes(recordingID: newDraft.id, boxLabel: box.label),
                    content: ActivityContent(state: .init(startedAt: newDraft.startedAt, isRecording: true), staleDate: nil),
                    pushType: nil
                )
            }
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default, options: [.allowBluetoothHFP])
            try session.setActive(true)
            try beginSegment()
            phase = .recording
            if let activity {
                activityMonitor = Task { [weak self] in
                    for await state in activity.activityStateUpdates {
                        guard !Task.isCancelled else { return }
                        if state == .ended || state == .dismissed { await self?.interrupt(); return }
                    }
                }
            }
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
            BoxLog.info("voice recording started id=\(newDraft.id)", category: .audio, targetBoxID: box.id)
        } catch {
            recorder?.stop()
            recorder = nil
            await endActivity()
            // A failed activation is not an accepted capture. Preserve any audio
            // that was written, otherwise allow a fresh explicit start.
            if let audioURL = segmentURL(draft?.segmentCount ?? 0),
               let size = (try? audioURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > 0 {
                phase = .interrupted
                draft?.interrupted = true
                try? persistDraft()
            } else {
                try? fileManager.removeItem(at: directory)
                draft = nil
                targetBox = nil
                phase = .failed
            }
            message = error.localizedDescription
            BoxLog.warn("voice recording start refused type=\(type(of: error))", category: .audio, targetBoxID: box.id)
            throw error
        }
    }

    func stopAndSave(boxes: [PairedBox]? = nil) async throws -> String {
        if draft == nil {
            try recoverRetainedDraftIfNeeded()
            if let recovered = draft {
                // The invoking adapter may have checked an empty in-memory
                // slot before recovery. Require a fresh original-box policy
                // check instead of saving a newly discovered private draft.
                throw Failure.interruptedPending(recovered.boxLabel)
            }
        }
        guard let draft else {
            if let lastSavedBoxLabel { return lastSavedBoxLabel }
            throw Failure.noRecording
        }
        guard !saveInProgress && !exportInProgress else { throw Failure.activeElsewhere }
        if let boxes { updatePairedBoxes(boxes) }
        var box: PairedBox
        do { box = try freshTarget(boxes: boxes) }
        catch {
            message = "Reconnect the recording's original box before saving. Its audio remains on this phone."
            throw error
        }
        saveInProgress = true
        defer { saveInProgress = false }
        phase = .saving
        BoxLog.info("voice recording flushing id=\(draft.id)", category: .audio, targetBoxID: box.id)
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        await endActivity()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let audioURL else { phase = .interrupted; throw Failure.storageUnavailable }
        do {
            try await assembleRecording()
            // Recheck after asynchronous container export; a pairing may have
            // been removed while the playable audio was being assembled.
            box = try freshTarget(boxes: latestBoxes ?? boxes)
            guard phase == .saving else { throw Failure.interruptedPending(draft.boxLabel) }
            let material = QuickCaptureMaterial.file(kind: "audio", id: draft.id, mimeType: "audio/mp4", fileName: "voice-note.m4a")
            let record: QuickCaptureRecord
            if let incomplete = try captureStore.record(draft.id), incomplete.status.state == "interrupted-draft" {
                guard incomplete.boxID == box.id, incomplete.declaration.source == .voiceRecording else {
                    throw QuickCaptureStore.StoreError.conflict
                }
                try captureStore.removeInterruptedDraft(draft.id)
            }
            if let existing = try captureStore.record(draft.id) {
                guard existing.boxID == box.id, existing.declaration.source == .voiceRecording,
                      !["gone", "interrupted-draft"].contains(existing.status.state),
                      existing.status.discardRequested != true else { throw QuickCaptureStore.StoreError.conflict }
                try existing.declaration.validate()
                guard let savedMaterial = existing.declaration.material, savedMaterial.kind == "audio" else {
                    throw QuickCaptureStore.StoreError.incomplete
                }
                let cap = QuickCaptureCapabilityCache().maxFileBytes(boxID: box.id)
                let saved = try fingerprint(captureStore.materialURL(for: draft.id), cap: cap)
                let exported = try fingerprint(audioURL, cap: cap)
                guard saved.length == savedMaterial.byteLength, saved.sha256 == savedMaterial.sha256,
                      saved.length == exported.length, saved.sha256 == exported.sha256 else {
                    throw QuickCaptureStore.StoreError.incomplete
                }
                // A process can terminate after acceptance but before draft
                // cleanup. Keep the original completeness provenance on replay.
                record = existing
            } else {
                record = try captureStore.accept(
                    box: box, source: .voiceRecording, material: material, fileURL: audioURL,
                    id: draft.id, capturedAt: draft.startedAt, recordingInterrupted: draft.interrupted ? true : nil
                )
            }
            // Transfer scheduling failure leaves an honest durable pending capture.
            do {
                if let scheduleHandler { try await scheduleHandler(record, box) }
                else { try await uploadCoordinator.schedule(record: record, box: box) }
            }
            catch { BoxLog.warn("voice capture pending transfer type=\(type(of: error))", category: .upload, targetBoxID: box.id) }
            if let directory { try? fileManager.removeItem(at: directory) }
            self.draft = nil
            lastSavedBoxLabel = box.label
            targetBox = nil
            phase = .idle
            elapsed = 0
            message = "Saved on your phone for \(box.label)."
            BoxLog.info("voice capture accepted id=\(draft.id)", category: .audio, targetBoxID: box.id)
            return box.label
        } catch {
            phase = .interrupted
            message = "The voice note was not accepted. Its audio remains on this phone."
            BoxLog.warn("voice capture acceptance failed type=\(type(of: error))", category: .audio, targetBoxID: box.id)
            throw error
        }
    }

    /// Exports playable local audio without rebinding the original box or
    /// accepting a new capture. The draft remains available until explicit discard.
    func exportInterruptedAudio() async throws -> URL {
        guard let original = draft, phase == .interrupted, !saveInProgress, !exportInProgress else {
            throw Failure.noRecording
        }
        exportInProgress = true
        defer { exportInProgress = false }
        try await assembleRecording()
        guard draft?.id == original.id, phase == .interrupted, let audioURL else { throw Failure.noRecording }
        return audioURL
    }

    private func fingerprint(_ url: URL, cap: Int) throws -> (length: Int, sha256: String) {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        var count = 0
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            count += data.count
            guard count <= cap else { throw QuickCaptureStore.StoreError.incomplete }
            hash.update(data: data)
        }
        guard count > 0 else { throw QuickCaptureStore.StoreError.incomplete }
        return (count, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }

    func discard() async throws {
        try recoverRetainedDraftIfNeeded()
        guard !saveInProgress && !exportInProgress else { throw Failure.activeElsewhere }
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        await endActivity()
        if let directory { try fileManager.removeItem(at: directory) }
        draft = nil
        targetBox = nil
        lastSavedBoxLabel = nil
        phase = .idle
        elapsed = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func persistDraft() throws {
        guard let draft, let manifestURL else { throw Failure.storageUnavailable }
        try JSONEncoder().encode(draft).write(to: manifestURL, options: .atomic)
        try protect(manifestURL)
    }
    private func beginSegment() throws {
        guard let url = segmentURL(draft?.segmentCount ?? 0) else { throw Failure.storageUnavailable }
        let next = try AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 96_000
        ])
        next.delegate = self
        guard next.prepareToRecord() else { throw Failure.recordingFailed }
        try protect(url)
        guard next.record(forDuration: max(1, VoiceNoteLimits.maximumSeconds - completedSeconds)) else { throw Failure.recordingFailed }
        recorder = next
    }
    private func protect(_ url: URL) throws {
        let protection: FileProtectionType = draft?.requiresDeviceUnlock == true ? .complete : .completeUntilFirstUserAuthentication
        try fileManager.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
    }
    private func tick() {
        elapsed = completedSeconds + (recorder?.currentTime ?? 0)
        guard phase == .recording else { return }
        guard let directory, let draft else { return }
        let totalBytes = (try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]))?
            .reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) } ?? 0
        if VoiceNoteLimits.reached(elapsed: elapsed, bytes: totalBytes, byteLimit: QuickCaptureCapabilityCache().maxFileBytes(boxID: draft.boxID)) {
            message = "The recording limit was reached. Saving your voice note."
            Task { do { _ = try await stopAndSave() } catch { phase = .interrupted } }
            return
        }
        // Finalize short AAC containers while recording, so a killed process
        // leaves playable completed segments rather than one unfinished file.
        if let recorder, recorder.currentTime >= 10 {
            completedSeconds += recorder.currentTime
            self.recorder = nil
            recorder.stop()
            self.draft?.segmentCount = (draft.segmentCount ?? 0) + 1
            do { try persistDraft(); try beginSegment() }
            catch { Task { await interrupt() } }
        }
    }
    private func assembleRecording() async throws {
        guard let directory, let audioURL else { throw Failure.storageUnavailable }
        // Replay after accepted source persistence uses the original exported
        // bytes instead of nondeterministically rebuilding the MP4 container.
        if fileManager.fileExists(atPath: audioURL.path) { return }
        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw Failure.storageUnavailable
        }
        var cursor = CMTime.zero
        let count = draft?.segmentCount ?? 0
        guard count >= 0 && count <= 60 else { throw Failure.storageUnavailable }
        for index in 0...count {
            guard let segment = segmentURL(index), fileManager.fileExists(atPath: segment.path) else { continue }
            let asset = AVURLAsset(url: segment)
            do {
                guard let source = try await asset.loadTracks(withMediaType: .audio).first else { continue }
                let duration = try await asset.load(.duration)
                guard duration.isNumeric && duration.seconds > 0 else { continue }
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
                cursor = CMTimeAdd(cursor, duration)
            } catch {
                // A crash can leave the currently open container unfinished.
                // Completed segments remain playable; retain raw draft bytes.
                BoxLog.warn("voice recovery skipped unfinished segment index=\(index)", category: .audio)
            }
        }
        guard cursor.seconds > 0 else { throw Failure.storageUnavailable }
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            throw Failure.storageUnavailable
        }
        let output = directory.appendingPathComponent("export.m4a")
        try? fileManager.removeItem(at: output)
        if #available(iOS 18.0, *) {
            try await exporter.export(to: output, as: .m4a)
        } else {
            exporter.outputURL = output
            exporter.outputFileType = .m4a
            await exporter.export()
            guard exporter.status == .completed else { throw Failure.storageUnavailable }
        }
        try fileManager.moveItem(at: output, to: audioURL)
        try protect(audioURL)
    }
    private func interrupt() async {
        guard phase == .recording else { return }
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        draft?.interrupted = true
        try? persistDraft()
        phase = .interrupted
        message = "Recording interrupted. Save the playable audio or discard it."
        await endActivity()
        if let draft { BoxLog.warn("voice recording interrupted", category: .audio, targetBoxID: draft.boxID) }
    }
    private func endActivity() async {
        activityMonitor?.cancel()
        activityMonitor = nil
        if let activity { await activity.end(nil, dismissalPolicy: .immediate) }
        activity = nil
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            guard self.phase == .recording, self.recorder === recorder else { return }
            if flag {
                self.message = "The recording limit was reached. Saving your voice note."
                do { _ = try await self.stopAndSave() }
                catch { self.phase = .interrupted }
            } else { await self.interrupt() }
        }
    }
}
