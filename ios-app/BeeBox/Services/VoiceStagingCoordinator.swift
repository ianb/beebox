import Foundation

enum VoiceStagingEvent: Equatable, Sendable {
    case chunkUploaded(VoiceStagingUploadCandidate)
    case chunkRetryScheduled(VoiceStagingUploadCandidate, afterSeconds: Int)
    case chunkFailed(VoiceStagingUploadCandidate, message: String)
    case sessionCreateFailed(boxID: UUID, recordingID: VoiceRecordingID, message: String)
}

/// Creates a voice-staging session, uploads its PCM chunks as they are
/// produced (during recording, not only at the end), and finalizes it —
/// `docs/plans/resilient-voice-recording.md`, Track 6. Structured after
/// `CaptureUploadCoordinator` (background `URLSession`, task-description
/// metadata, launch-time reconciliation) but scoped to one chunk type and a
/// single owning recording lifecycle rather than a mixed photo/file/audio
/// batch.
final class VoiceStagingCoordinator: NSObject, @unchecked Sendable {
    typealias BoxProvider = (UUID) -> PairedBox?
    typealias EventHandler = @Sendable (VoiceStagingEvent) -> Void
    typealias Sleep = @Sendable (UInt64) async throws -> Void
    typealias Now = @Sendable () -> Date

    private let boxProvider: BoxProvider
    private let store: VoiceStagingStore
    private let eventHandler: EventHandler
    private let sleep: Sleep
    private let now: Now
    private let eventBroker: CaptureBackgroundEvents
    /// Transport for the two small JSON lifecycle calls (create, finalize) —
    /// separate from `urlSession`, which only ever carries chunk upload
    /// TASKS. Injectable so tests can stub these calls the same way
    /// `CaptureAPITests` stubs `CaptureAPI` (a `StubCaptureTransport`), rather
    /// than needing a second `URLProtocol` mock for JSON round trips.
    private let lifecycleTransport: any CaptureTransport
    private let responseLock = NSLock()
    private var responseData: [Int: Data] = [:]
    private let completionLock = NSLock()
    private var completionTasks: [UUID: Task<Void, Never>] = [:]
    private var urlSession: URLSession!

    init(
        boxProvider: @escaping BoxProvider,
        store: VoiceStagingStore,
        configuration: URLSessionConfiguration? = nil,
        lifecycleTransport: any CaptureTransport = URLSessionCaptureTransport(),
        eventBroker: CaptureBackgroundEvents = .shared,
        sleep: @escaping Sleep = { nanoseconds in try await Task.sleep(nanoseconds: nanoseconds) },
        now: @escaping Now = { Date() },
        eventHandler: @escaping EventHandler = { _ in }
    ) {
        self.boxProvider = boxProvider
        self.store = store
        self.lifecycleTransport = lifecycleTransport
        self.eventBroker = eventBroker
        self.sleep = sleep
        self.now = now
        self.eventHandler = eventHandler
        super.init()
        urlSession = URLSession(
            configuration: configuration ?? VoiceStagingBackgroundSession.configuration(),
            delegate: self,
            delegateQueue: nil
        )
    }

    convenience init(
        box: PairedBox,
        store: VoiceStagingStore,
        configuration: URLSessionConfiguration? = nil,
        lifecycleTransport: any CaptureTransport = URLSessionCaptureTransport(),
        eventBroker: CaptureBackgroundEvents = .shared,
        sleep: @escaping Sleep = { nanoseconds in try await Task.sleep(nanoseconds: nanoseconds) },
        now: @escaping Now = { Date() },
        eventHandler: @escaping EventHandler = { _ in }
    ) {
        self.init(
            boxProvider: { boxID in boxID == box.id ? box : nil },
            store: store,
            configuration: configuration,
            lifecycleTransport: lifecycleTransport,
            eventBroker: eventBroker,
            sleep: sleep,
            now: now,
            eventHandler: eventHandler
        )
    }

    deinit {
        urlSession?.finishTasksAndInvalidate()
    }

    /// Reconcile at launch: a chunk mid-upload with no matching live
    /// background task goes back to `.local` and is rescheduled; a recording
    /// whose session-create never landed is retried.
    func start() async throws {
        let tasks = await urlSession.allTasks
        let liveTasks = tasks.compactMap { task -> (taskIdentifier: Int, metadata: VoiceStagingBackgroundTaskMetadata)? in
            guard let metadata = VoiceStagingBackgroundTaskMetadata(taskDescription: task.taskDescription) else {
                return nil
            }
            return (task.taskIdentifier, metadata)
        }
        let candidates = try await store.reconcileBackgroundTasks(liveTasks)
        for candidate in candidates {
            do {
                try await scheduleUpload(candidate)
            } catch {
                BoxLog.error(
                    "voice staging upload could not be rescheduled at launch"
                        + " recording=\(candidate.recordingID.rawValue) chunk=\(candidate.chunkIndex):"
                        + " \(error.localizedDescription)",
                    category: .voice
                )
                eventHandler(.chunkFailed(candidate, message: error.localizedDescription))
            }
        }
        for manifest in try await store.recordingsPendingSessionCreation() {
            Task { await createSession(boxID: manifest.boxID, recordingID: manifest.recordingID) }
        }
    }

    /// Begin staging a new recording: persist it locally immediately (so a
    /// crash before the network call still leaves a resumable record) and
    /// kick off the session-create call in the background. Returns the
    /// recording id right away — `chunkProduced` may be called before or after
    /// the create call resolves; chunks queue locally until it succeeds.
    func beginRecording(boxID: UUID, targetSessionID: String) -> VoiceRecordingID {
        let recordingID = VoiceRecordingID()
        let createdAt = ISO8601DateFormatter().string(from: now())
        Task {
            do {
                try await store.createRecording(
                    boxID: boxID,
                    recordingID: recordingID,
                    targetSessionID: targetSessionID,
                    createdAt: createdAt
                )
            } catch {
                BoxLog.error(
                    "voice staging recording could not be persisted recording=\(recordingID.rawValue):"
                        + " \(error.localizedDescription)",
                    category: .voice
                )
                return
            }
            await createSession(boxID: boxID, recordingID: recordingID)
        }
        return recordingID
    }

    /// Register a chunk the writer just finished and schedule its upload once
    /// the recording's session-create has landed. Safe to call from any
    /// thread — the chunk writer runs off the main actor.
    func chunkProduced(boxID: UUID, recordingID: VoiceRecordingID, chunk: VoicePCMChunk) {
        Task {
            do {
                try await store.addChunk(
                    boxID: boxID,
                    recordingID: recordingID,
                    index: chunk.index,
                    filename: chunk.url.lastPathComponent,
                    byteCount: chunk.byteCount
                )
            } catch {
                BoxLog.error(
                    "voice staging chunk could not be registered recording=\(recordingID.rawValue)"
                        + " chunk=\(chunk.index): \(error.localizedDescription)",
                    category: .voice
                )
                return
            }
            guard let manifest = try? await store.loadManifest(boxID: boxID, recordingID: recordingID) else {
                return
            }
            guard manifest.sessionCreation == .created else {
                return
            }
            let candidate = VoiceStagingUploadCandidate(boxID: boxID, recordingID: recordingID, chunkIndex: chunk.index)
            try? await scheduleUpload(candidate)
        }
    }

    /// Seal the recording. Retries a retryable response a bounded number of
    /// times inline (this is a single caller-awaited call, not a
    /// background-queued upload) before surfacing `.terminal` for the
    /// composer to show; a 4xx — including the `missing-chunks` gap check —
    /// is terminal immediately.
    func finalize(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        chunkCount: Int,
        hq: VoiceHqFinalizePayload?
    ) async -> VoiceStagingFinalizeOutcome {
        try? await store.markFinalizeRequested(boxID: boxID, recordingID: recordingID, chunkCount: chunkCount, hq: hq)
        guard let box = boxProvider(boxID) else {
            let message = "The paired box for this recording is unavailable."
            try? await store.markFinalizeTerminal(boxID: boxID, recordingID: recordingID, message: message)
            return .terminal(message: message)
        }
        var attempt = 0
        while true {
            attempt += 1
            let outcome = await VoiceStagingAPI(box: box, transport: lifecycleTransport).finalize(recordingID: recordingID, chunkCount: chunkCount, hq: hq)
            switch outcome {
            case .success:
                try? await store.markSealed(boxID: boxID, recordingID: recordingID)
                BoxLog.info(
                    "voice staging finalized recording=\(recordingID.rawValue) chunks=\(chunkCount)"
                        + " hq=\(hq != nil)",
                    category: .voice
                )
                return .sealed
            case .retryable(let retry):
                guard attempt < 5 else {
                    try? await store.markFinalizeTerminal(boxID: boxID, recordingID: recordingID, message: retry.message)
                    BoxLog.error(
                        "voice staging finalize failed permanently recording=\(recordingID.rawValue)"
                            + " attempts=\(attempt): \(retry.message)",
                        category: .voice
                    )
                    return .terminal(message: retry.message)
                }
                let seconds = VoiceStagingRetryPolicy.backoffSeconds(attempt: attempt)
                BoxLog.warn(
                    "voice staging finalize failed, retrying in \(seconds)s recording=\(recordingID.rawValue)"
                        + " attempt=\(attempt): \(retry.message)",
                    category: .voice
                )
                try? await sleep(UInt64(seconds) * 1_000_000_000)
            case .rejected(let rejection):
                try? await store.markFinalizeTerminal(boxID: boxID, recordingID: recordingID, message: rejection.message)
                BoxLog.error(
                    "voice staging finalize rejected recording=\(recordingID.rawValue): \(rejection.message)",
                    category: .voice
                )
                return .terminal(message: rejection.message)
            }
        }
    }

    private func createSession(boxID: UUID, recordingID: VoiceRecordingID) async {
        guard let box = boxProvider(boxID) else {
            return
        }
        guard let manifest = try? await store.loadManifest(boxID: boxID, recordingID: recordingID) else {
            return
        }
        let outcome = await VoiceStagingAPI(box: box, transport: lifecycleTransport).createSession(
            recordingID: recordingID,
            targetSessionID: manifest.targetSessionID
        )
        switch outcome {
        case .success:
            try? await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
            BoxLog.info("voice staging session created recording=\(recordingID.rawValue)", category: .voice)
            for chunk in manifest.chunks where chunk.state == .local {
                let candidate = VoiceStagingUploadCandidate(boxID: boxID, recordingID: recordingID, chunkIndex: chunk.index)
                try? await scheduleUpload(candidate)
            }
        case .retryable(let retry):
            guard VoiceStagingRetryPolicy.isWithinRetryBound(createdAt: manifest.createdAt, now: now()) else {
                try? await store.markSessionCreationFailed(boxID: boxID, recordingID: recordingID, message: retry.message)
                eventHandler(.sessionCreateFailed(boxID: boxID, recordingID: recordingID, message: retry.message))
                return
            }
            BoxLog.warn(
                "voice staging session create failed, retrying recording=\(recordingID.rawValue): \(retry.message)",
                category: .voice
            )
            let seconds = VoiceStagingRetryPolicy.backoffSeconds(attempt: 1)
            do {
                try await sleep(UInt64(seconds) * 1_000_000_000)
            } catch {
                return
            }
            await createSession(boxID: boxID, recordingID: recordingID)
        case .rejected(let rejection):
            try? await store.markSessionCreationFailed(boxID: boxID, recordingID: recordingID, message: rejection.message)
            BoxLog.error(
                "voice staging session create failed permanently recording=\(recordingID.rawValue): \(rejection.message)",
                category: .voice
            )
            eventHandler(.sessionCreateFailed(boxID: boxID, recordingID: recordingID, message: rejection.message))
        }
    }

    func scheduleUpload(_ candidate: VoiceStagingUploadCandidate) async throws {
        guard let box = boxProvider(candidate.boxID) else {
            throw VoiceStagingFailure.invalidManifest("The paired box for this upload is unavailable.")
        }
        let payload = try await store.uploadPayload(for: candidate)
        let request = VoiceStagingAPI(box: box).uploadRequest(recordingID: candidate.recordingID, chunk: payload.chunk)
        let task = urlSession.uploadTask(with: request, fromFile: payload.fileURL)
        do {
            let metadata = try await store.markUploading(
                boxID: candidate.boxID,
                recordingID: candidate.recordingID,
                chunkIndex: candidate.chunkIndex,
                taskIdentifier: task.taskIdentifier
            )
            task.taskDescription = metadata.taskDescription
            task.resume()
        } catch {
            task.cancel()
            throw error
        }
    }

    private struct UploadAttempt {
        var statusCode: Int?
        var urlErrorCode: Int?
        var bytesSent: Int64
        var metadata: VoiceStagingBackgroundTaskMetadata

        var detail: String {
            var parts = [
                "recording=\(metadata.recordingID.rawValue)",
                "chunk=\(metadata.chunkIndex)",
                "attempt=\(metadata.generation)",
                "bytes=\(bytesSent)",
            ]
            if let statusCode {
                parts.append("status=\(statusCode)")
            }
            if let urlErrorCode {
                parts.append("urlError=\(urlErrorCode)")
            }
            return parts.joined(separator: " ")
        }
    }

    func trackCompletion(_ body: @escaping @Sendable () async -> Void) {
        let id = UUID()
        completionLock.lock()
        completionTasks[id] = Task { [weak self] in
            await body()
            self?.completionLock.withLock { _ = self?.completionTasks.removeValue(forKey: id) }
        }
        completionLock.unlock()
    }

    func awaitPendingCompletions() async {
        while true {
            let pending = completionLock.withLock { Array(completionTasks.values) }
            guard pending.isEmpty == false else {
                return
            }
            for task in pending {
                await task.value
            }
        }
    }

    func handleCompletion(
        taskIdentifier: Int,
        metadata: VoiceStagingBackgroundTaskMetadata,
        response: HTTPURLResponse?,
        data: Data,
        error: Error?,
        bytesSent: Int64
    ) async {
        let candidate = VoiceStagingUploadCandidate(
            boxID: metadata.boxID,
            recordingID: metadata.recordingID,
            chunkIndex: metadata.chunkIndex
        )
        let attempt = UploadAttempt(
            statusCode: response?.statusCode,
            urlErrorCode: (error as? URLError)?.code.rawValue,
            bytesSent: bytesSent,
            metadata: metadata
        )
        let outcome: CaptureRequestOutcome<Bool>
        if let error {
            outcome = .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        } else if let response {
            outcome = VoiceStagingAPI.classifyUploadResponse(response, data: data)
        } else {
            outcome = .retryable(CaptureRetry(message: "The upload returned no HTTP response.", retryAfter: nil))
        }

        switch outcome {
        case .success:
            do {
                guard try await store.acknowledgeUpload(metadata: metadata, taskIdentifier: taskIdentifier) else {
                    BoxLog.info("voice staging upload ack ignored as stale \(attempt.detail)", category: .voice)
                    return
                }
            } catch {
                await LogForwarder.shared.record(
                    level: .error,
                    category: .voice,
                    message: "voice staging upload succeeded but the local record could not be updated"
                        + " \(attempt.detail): \(error.localizedDescription)",
                    boxID: metadata.boxID
                )
                return
            }
            eventHandler(.chunkUploaded(candidate))
        case .retryable(let retry):
            await handleFailure(
                candidate: candidate,
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: .retryable(message: retry.message),
                attempt: attempt
            )
        case .rejected(let rejection):
            await handleFailure(
                candidate: candidate,
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: .terminal(message: rejection.message),
                attempt: attempt
            )
        }
    }

    private func handleFailure(
        candidate: VoiceStagingUploadCandidate,
        metadata: VoiceStagingBackgroundTaskMetadata,
        taskIdentifier: Int,
        failure: VoiceStagingUploadFailure,
        attempt: UploadAttempt
    ) async {
        let message: String
        switch failure {
        case .retryable(let value), .terminal(let value):
            message = value
        }

        let resolution: VoiceStagingUploadResolution
        do {
            resolution = try await store.recordUploadFailure(
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: failure,
                now: now()
            )
        } catch {
            await LogForwarder.shared.record(
                level: .error,
                category: .voice,
                message: "voice staging upload failed and the failure could not be recorded locally"
                    + " \(attempt.detail): \(message) (\(error.localizedDescription))",
                boxID: metadata.boxID
            )
            return
        }

        switch resolution {
        case .retry(let seconds):
            await LogForwarder.shared.record(
                level: .warn,
                category: .voice,
                message: "voice staging upload failed, retrying in \(seconds)s \(attempt.detail): \(message)",
                boxID: metadata.boxID
            )
            eventHandler(.chunkRetryScheduled(candidate, afterSeconds: seconds))
            scheduleRetry(candidate: candidate, boxID: metadata.boxID, seconds: seconds, detail: attempt.detail)
        case .failed:
            await LogForwarder.shared.record(
                level: .error,
                category: .voice,
                message: "voice staging upload failed permanently \(attempt.detail): \(message)",
                boxID: metadata.boxID
            )
            eventHandler(.chunkFailed(candidate, message: message))
        case .ignoredStaleCompletion:
            BoxLog.info("voice staging upload completion ignored as stale \(attempt.detail)", category: .voice)
        }
    }

    private func scheduleRetry(candidate: VoiceStagingUploadCandidate, boxID: UUID, seconds: Int, detail: String) {
        Task { [weak self] in
            guard let self else {
                return
            }
            do {
                try await self.sleep(UInt64(seconds) * 1_000_000_000)
                try await self.scheduleUpload(candidate)
            } catch is CancellationError {
                return
            } catch {
                await LogForwarder.shared.record(
                    level: .error,
                    category: .voice,
                    message: "voice staging upload retry could not be scheduled \(detail): \(error.localizedDescription)",
                    boxID: boxID
                )
                self.eventHandler(.chunkFailed(candidate, message: error.localizedDescription))
            }
        }
    }
}

extension VoiceStagingCoordinator: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseLock.withLock {
            responseData[dataTask.taskIdentifier, default: Data()].append(data)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let metadata = VoiceStagingBackgroundTaskMetadata(taskDescription: task.taskDescription) else {
            return
        }
        let data = responseLock.withLock { responseData.removeValue(forKey: task.taskIdentifier) ?? Data() }
        let bytesSent = task.countOfBytesSent
        let taskIdentifier = task.taskIdentifier
        let response = task.response as? HTTPURLResponse
        trackCompletion { [weak self] in
            await self?.handleCompletion(
                taskIdentifier: taskIdentifier,
                metadata: metadata,
                response: response,
                data: data,
                error: error,
                bytesSent: bytesSent
            )
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let broker = eventBroker
        Task { @MainActor in
            await awaitPendingCompletions()
            await LogForwarder.shared.awaitPersistence()
            Task {
                await LogForwarder.shared.flush()
            }
            broker.finish(identifier: VoiceStagingBackgroundSession.identifier)
        }
    }
}

/// App-wide singleton mirroring `CaptureUploadRuntime`: one coordinator per
/// process, boxes registered as they're paired/selected, observers fan out
/// staging events to whichever composer instance is currently showing them.
final class VoiceStagingRuntime: @unchecked Sendable {
    static let shared = VoiceStagingRuntime()

    let store: VoiceStagingStore

    private let lock = NSLock()
    private var boxes: [UUID: PairedBox] = [:]
    private var observers: [UUID: @Sendable (VoiceStagingEvent) -> Void] = [:]
    private var isStarting = false
    private lazy var coordinator = VoiceStagingCoordinator(
        boxProvider: { [weak self] boxID in self?.box(for: boxID) },
        store: store,
        eventHandler: { [weak self] event in self?.publish(event) }
    )

    init(store: VoiceStagingStore = VoiceStagingStore()) {
        self.store = store
    }

    func updateBox(_ box: PairedBox) {
        lock.withLock {
            boxes[box.id] = box
        }
    }

    func updateBoxes(_ boxes: [PairedBox]) {
        lock.withLock {
            self.boxes = Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0) })
        }
    }

    func start() async throws {
        let shouldStart = lock.withLock {
            guard isStarting == false else {
                return false
            }
            isStarting = true
            return true
        }
        guard shouldStart else {
            return
        }
        defer {
            lock.withLock {
                isStarting = false
            }
        }
        try await coordinator.start()
    }

    func beginRecording(boxID: UUID, targetSessionID: String) -> VoiceRecordingID {
        coordinator.beginRecording(boxID: boxID, targetSessionID: targetSessionID)
    }

    func chunkProduced(boxID: UUID, recordingID: VoiceRecordingID, chunk: VoicePCMChunk) {
        coordinator.chunkProduced(boxID: boxID, recordingID: recordingID, chunk: chunk)
    }

    func finalize(
        boxID: UUID,
        recordingID: VoiceRecordingID,
        chunkCount: Int,
        hq: VoiceHqFinalizePayload?
    ) async -> VoiceStagingFinalizeOutcome {
        await coordinator.finalize(boxID: boxID, recordingID: recordingID, chunkCount: chunkCount, hq: hq)
    }

    func addObserver(_ observer: @escaping @Sendable (VoiceStagingEvent) -> Void) -> UUID {
        let id = UUID()
        lock.withLock {
            observers[id] = observer
        }
        return id
    }

    func removeObserver(_ id: UUID) {
        _ = lock.withLock {
            observers.removeValue(forKey: id)
        }
    }

    private func box(for id: UUID) -> PairedBox? {
        lock.withLock { boxes[id] }
    }

    private func publish(_ event: VoiceStagingEvent) {
        let current = lock.withLock { Array(observers.values) }
        current.forEach { $0(event) }
    }
}
