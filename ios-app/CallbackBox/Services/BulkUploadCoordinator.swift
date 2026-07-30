import Foundation

/// Progress for one bulk photo batch, as the composer renders it.
struct BulkUploadProgress: Equatable, Sendable {
    var total: Int
    var uploaded: Int
    var failed: Int

    var pending: Int { max(0, total - uploaded - failed) }
    var isFinished: Bool { pending == 0 }
}

enum BulkUploadOutcome: Equatable, Sendable {
    /// The batch sealed; the box will land the card and inject `<upload>`.
    case delivered(uploaded: Int, failed: Int)
    /// Nothing could be sent and the batch was abandoned (with a reason to show).
    case failed(message: String)
}

/// Drives one bulk photo batch end to end: create → register → upload each item
/// under a bounded queue → finalize.
///
/// This is the deferred iOS Track 3 of
/// `callback-box/docs/implemented-plans/bulk-file-upload.md`, scoped by
/// `docs/plans/chat-photo-batch-upload.md`. It exists because inlining a photo
/// selection base64-encodes it into a single `/chat/send` that a large batch
/// cannot fit through — the reported failure.
///
/// Two properties are load-bearing and easy to lose:
///
/// - **Bounded concurrency.** The box rejects more than 8 concurrent streams per
///   batch with a 409, and an iOS webview will kill a fan-out of dozens of
///   requests. `maxConcurrent` is 3, matching the web uploader.
/// - **File-backed bodies.** Every item uploads from a file on disk
///   (`PreparedBulkItem.fileURL`), never an in-memory `Data` body, so 70 photos
///   never coexist in memory.
///
/// Failures are reported, never swallowed: an item that exhausts its retries is
/// named in `failedItems` at finalize, so the delivered `<upload>` message says
/// what did not make it instead of the batch quietly arriving short.
actor BulkUploadCoordinator {
    /// In-flight uploads allowed at once. The server 409s above 8 per batch;
    /// 3 leaves headroom and matches `use-bulk-upload.ts`'s `CONCURRENCY`.
    static let maxConcurrent = 3
    /// Attempts per item before it is reported failed (1 initial + 2 retries).
    static let maxAttempts = 3
    /// How long to wait for the box to confirm delivery after the seal.
    static let deliveryTimeout: TimeInterval = 30
    private static let deliveryPollNanos: UInt64 = 750_000_000

    typealias Sleep = @Sendable (UInt64) async throws -> Void

    private let api: BulkUploadAPI
    private let sleep: Sleep
    private let onProgress: @Sendable (BulkUploadProgress) -> Void

    private var sessionID: String?
    private var uploaded: [String] = []
    private var failed: [BulkUploadAPI.FailedItem] = []
    private var total = 0
    /// Items not yet claimed by a worker. Actor state, so the bounded queue's
    /// workers draw from it without a lock.
    private var queue: [PreparedBulkItem] = []

    init(
        api: BulkUploadAPI,
        sleep: @escaping Sleep = { try await Task.sleep(nanoseconds: $0) },
        onProgress: @escaping @Sendable (BulkUploadProgress) -> Void = { _ in }
    ) {
        self.api = api
        self.sleep = sleep
        self.onProgress = onProgress
    }

    /// Upload a whole batch and seal it. `note` is the composer text the photos
    /// were submitted with — the batch's introduction, without which the agent
    /// asks what the files are instead of filing them.
    /// `importFailures` are photos that never made it as far as an upload (an
    /// unreadable pick, an iCloud fetch that failed). They are reported at
    /// finalize alongside the upload failures, because a photo the user selected
    /// and never saw again is the failure this pipeline exists to prevent — the
    /// batch must be honest that it is short.
    func run(
        items: [PreparedBulkItem],
        targetSessionID: String,
        note: String?,
        importFailures: [BulkUploadAPI.FailedItem] = []
    ) async -> BulkUploadOutcome {
        failed = importFailures
        guard items.isEmpty == false else {
            // Nothing staged, but if photos failed to import the box still needs
            // to hear about them.
            guard importFailures.isEmpty == false else {
                return .failed(message: "There were no photos to upload.")
            }
            total = importFailures.count
            publishProgress()
            return await createAndFinalize(items: [], targetSessionID: targetSessionID, note: note)
        }
        total = items.count + importFailures.count
        publishProgress()

        return await createAndFinalize(items: items, targetSessionID: targetSessionID, note: note)
    }

    private func createAndFinalize(items: [PreparedBulkItem], targetSessionID: String, note: String?) async -> BulkUploadOutcome {
        let created = await api.createSession(
            targetSessionID: targetSessionID,
            items: items.map { $0.registryItem }
        )
        guard case .success(let session) = created else {
            return .failed(message: Self.message(for: created) ?? "The box would not start the upload.")
        }
        sessionID = session.sessionId

        await uploadAll(items: items, sessionID: session.sessionId)

        // Deliver even when everything failed: the boxholder pressed send, so the
        // chat must say what happened rather than showing nothing — silence is
        // exactly the bug this replaces.
        let sealed = await api.finalize(sessionID: session.sessionId, failedItems: failed, note: note)
        guard case .success = sealed else {
            return .failed(message: Self.message(for: sealed) ?? "The box would not finish the upload.")
        }
        return await confirmDelivery(sessionID: session.sessionId)
    }

    /// Wait for the box to actually deliver, rather than trusting the seal.
    ///
    /// `finalize` returns as soon as the batch is sealed and runs prepare→deliver
    /// in the background, so a success there means "accepted", never "delivered".
    /// Treating it as delivered is how the caller ends up deleting the staged
    /// photos and clearing the composer while the batch later fails and no
    /// `<upload>` message ever appears — the original bug in a new place.
    private func confirmDelivery(sessionID id: String) async -> BulkUploadOutcome {
        let deadline = Date().addingTimeInterval(Self.deliveryTimeout)
        while Date() < deadline {
            switch await api.status(sessionID: id) {
            case .success(let state):
                // `delivering` means the message is queued to a busy agent and
                // will land (reconciliation re-delivers if a crash loses the
                // queue), so it counts as delivered for releasing local state.
                if state.state == "delivered" || state.state == "delivering" {
                    return .delivered(uploaded: uploaded.count, failed: failed.count)
                }
                if state.state.hasPrefix("failed:") {
                    return .failed(message: "The box could not deliver the batch (\(state.state)). Your photos and message were kept.")
                }
            case .rejected(.sessionGone):
                // Staging is torn down only after a delivered batch.
                return .delivered(uploaded: uploaded.count, failed: failed.count)
            case .rejected(let rejection):
                return .failed(message: rejection.message)
            case .retryable:
                break // transient — keep waiting
            }
            try? await sleep(Self.deliveryPollNanos)
        }
        // Still working. Report it as unfinished rather than claiming success, so
        // the caller keeps the photos and the text.
        return .failed(message: "The box is still processing this batch; the upload message will appear in chat when it lands.")
    }

    /// Resume an interrupted batch: ask the box what it already holds and send
    /// only the rest. Bytes that landed before the app died are not re-sent.
    func resume(items: [PreparedBulkItem], sessionID id: String, targetSessionID: String, note: String?) async -> BulkUploadOutcome {
        let status = await api.status(sessionID: id)
        guard case .success(let state) = status else {
            // The batch is gone (cancelled, swept) — start over rather than
            // stranding the photos.
            return await run(items: items, targetSessionID: targetSessionID, note: note)
        }
        sessionID = id
        total = items.count
        let alreadyHave = state.receivedItemIDs
        uploaded = items.map(\.id).filter { alreadyHave.contains($0) }
        publishProgress()

        await uploadAll(items: items.filter { alreadyHave.contains($0.id) == false }, sessionID: id)

        let sealed = await api.finalize(sessionID: id, failedItems: failed, note: note)
        if case .success = sealed {
            return .delivered(uploaded: uploaded.count, failed: failed.count)
        }
        return .failed(message: Self.message(for: sealed) ?? "The box would not finish the upload.")
    }

    /// Discard the batch server-side (the user backed out).
    func cancel() async {
        guard let sessionID else { return }
        _ = await api.cancel(sessionID: sessionID)
    }

    // MARK: - The bounded queue

    /// Run every item through at most `maxConcurrent` in-flight uploads. A task
    /// group with a fixed number of workers pulling from a shared cursor keeps
    /// the ceiling exact — adding one task per item and hoping the system limits
    /// them is what produces the fan-out an iOS webview kills.
    private func uploadAll(items: [PreparedBulkItem], sessionID: String) async {
        guard items.isEmpty == false else { return }
        queue = items

        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<min(Self.maxConcurrent, items.count) {
                group.addTask { [weak self] in
                    while let item = await self?.claimNext() {
                        await self?.uploadWithRetries(item: item, sessionID: sessionID)
                    }
                }
            }
            await group.waitForAll()
        }
    }

    /// Hand the next queued item to a worker. Actor-isolated, so two workers can
    /// never claim the same item however they interleave.
    private func claimNext() -> PreparedBulkItem? {
        queue.isEmpty ? nil : queue.removeFirst()
    }

    private func uploadWithRetries(item: PreparedBulkItem, sessionID: String) async {
        var lastMessage = "The upload did not complete."
        for attempt in 1...Self.maxAttempts {
            let outcome = await api.upload(item: item, sessionID: sessionID)
            switch outcome {
            case .success:
                uploaded.append(item.id)
                publishProgress()
                return
            case .retryable(let retry):
                lastMessage = retry.message
            case .rejected(let rejection):
                // Terminal — a retry would fail identically (unregistered item,
                // sealed batch, over the batch cap, auth).
                recordFailure(item: item, message: rejection.message)
                return
            }
            if attempt < Self.maxAttempts {
                // Back off before retrying; a 409 here is the box telling us it
                // is saturated, so hammering it makes things worse.
                try? await sleep(UInt64(attempt) * 500_000_000)
            }
        }
        recordFailure(item: item, message: lastMessage)
    }

    private func recordFailure(item: PreparedBulkItem, message: String) {
        failed.append(BulkUploadAPI.FailedItem(id: item.id, name: item.originalName, reason: message))
        publishProgress()
    }

    private func publishProgress() {
        onProgress(BulkUploadProgress(total: total, uploaded: uploaded.count, failed: failed.count))
    }

    private static func message<Value>(for outcome: CaptureRequestOutcome<Value>) -> String? {
        switch outcome {
        case .success:
            return nil
        case .retryable(let retry):
            return retry.message
        case .rejected(let rejection):
            return rejection.message
        }
    }
}

extension BulkUploadAPI {
    /// Upload one prepared item's bytes, streaming from its file.
    ///
    /// Uses `uploadTask(fromFile:)` rather than a `Data` body so the payload is
    /// never resident in memory — the property that lets a large batch complete
    /// at all.
    func upload(item: PreparedBulkItem, sessionID: String) async -> CaptureRequestOutcome<Bool> {
        let request = uploadRequest(sessionID: sessionID, item: item)
        do {
            let (data, response) = try await transport.upload(request, fromFile: item.fileURL)
            guard let http = response as? HTTPURLResponse else {
                return .rejected(.invalidResponse("The box returned a non-HTTP response."))
            }
            return Self.classifyUploadResponse(http, data: data)
        } catch {
            return .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        }
    }
}
