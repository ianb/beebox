import Foundation
import OSLog

/// One file-backed transfer seals the complete capture even if its originating extension exits.
final class QuickCaptureUploadCoordinator: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = QuickCaptureUploadCoordinator()
    static let automaticRetryWindow: TimeInterval = 7 * 24 * 60 * 60
    static let maximumTransferDuration: TimeInterval = 60 * 60
    static let identifierPrefix = "app.beebox.ios.quick-capture."
    private let store: QuickCaptureStore
    private let transport: any QuickCaptureTransport
    private let cancelTransfersHandler: (@Sendable (UUID) async -> Void)?
    private let lock = NSLock()
    private let logger = Logger(subsystem: "app.beebox.ios", category: "quick-capture-transfer")
    private var sessions: [String: URLSession] = [:]
    private var responseBytes: [String: Data] = [:]
    private var completionHandlers: [String: () -> Void] = [:]
    private var scheduling: Set<UUID> = []
    private var receiptHandler: (@Sendable () async -> Void)?

    init(store: QuickCaptureStore = .shared,
         transport: any QuickCaptureTransport = URLSessionQuickCaptureTransport(),
         cancelTransfersHandler: (@Sendable (UUID) async -> Void)? = nil) {
        self.store = store; self.transport = transport; self.cancelTransfersHandler = cancelTransfersHandler
        super.init()
    }

    static func handles(_ identifier: String) -> Bool { identifier.hasPrefix(identifierPrefix) }

    func handleEvents(identifier: String, completion: @escaping () -> Void) {
        lock.withLock { completionHandlers[identifier] = completion }
        _ = session(identifier: identifier)
    }

    /// The app installs a lightweight handler so foreground receipts advance queued context too.
    func setReceiptHandler(_ handler: @escaping @Sendable () async -> Void) {
        lock.withLock { receiptHandler = handler }
    }

    /// Request is durable immediately; deletion is claimed only after an owner-scoped server tombstone.
    func requestDiscard(record: QuickCaptureRecord, box: PairedBox) async throws {
        guard record.boxID == box.id else { throw CaptureDestinationStore.DestinationError.removed }
        try store.updateStatus(record.id) {
            $0.discardRequested = true; $0.state = "discard-pending"
            $0.error = "Discard requested — waiting for box confirmation."; $0.nextAttemptAt = nil
        }
        await cancelTransfers(id: record.id)
        do { try await reconcileDiscard(record: record, box: box) }
        catch { logger.info("capture_discard_waiting id=\(record.id.uuidString, privacy: .public)") }
    }

    private func reconcileDiscard(record: QuickCaptureRecord, box: PairedBox) async throws {
        let api = QuickCaptureAPI(box: box, transport: transport)
        let capabilities = try await api.capabilities()
        guard capabilities.version == 1 else { throw QuickCaptureAPI.APIError.unsupported }
        let deleted = try await api.delete(id: record.id)
        guard deleted.state == "gone" else { throw QuickCaptureAPI.APIError.invalidResponse }
        try apply(remote: deleted)
        try store.purgeAcceptedSource(id: record.id)
    }

    /// A confirmed server tombstone makes cancellation safe even if acceptance raced this request.
    func cancelTransfers(id: UUID) async {
        if let cancelTransfersHandler { await cancelTransfersHandler(id); return }
        let known = lock.withLock { Array(sessions.keys) }
        let identifiers = Set(known + [Self.identifierPrefix + "app.beebox.ios", Self.identifierPrefix + "app.beebox.ios.share"])
        for identifier in identifiers {
            for task in await session(identifier: identifier).allTasks where task.taskDescription == id.uuidString.lowercased() {
                task.cancel()
            }
        }
    }

    /// Called only after local acceptance. Scheduling errors retain the accepted source.
    func schedule(record: QuickCaptureRecord, box: PairedBox, allowManualRetry: Bool = false) async throws {
        let inserted = lock.withLock { scheduling.insert(record.id).inserted }
        guard inserted else { return }
        defer { _ = lock.withLock { scheduling.remove(record.id) } }
        var record = record
        if let latest = try store.record(record.id) {
            guard latest.boxID == record.boxID else { throw QuickCaptureStore.StoreError.conflict }
            record.status = latest.status
        }
        if record.status.discardRequested == true || record.status.state == "gone" { return }
        guard record.boxID == box.id else { throw CaptureDestinationStore.DestinationError.removed }
        if record.status.serverAccepted || ["failed", "unsupported", "needs-repair", "gone", "blocked", "needs-retry", "interrupted-draft"].contains(record.status.state) { return }
        guard box.authToken?.isEmpty == false else {
            try store.updateStatus(record.id) { $0.state = "needs-repair"; $0.error = "Pair this box again." }
            throw CaptureDestinationStore.DestinationError.missingCredential
        }
        if box.requiresDeviceUnlock && (record.declaration.source == .appIntents || !record.requiresDeviceUnlock) {
            try store.updateStatus(record.id) { $0.state = "blocked"; $0.error = "This destination is now protected. Your capture is retained on this phone." }
            return
        }
        if let parentID = record.declaration.parentCaptureId {
            if let parent = try store.record(parentID) {
                guard parent.boxID == record.boxID else { throw QuickCaptureStore.StoreError.conflict }
                if ["gone", "failed", "blocked", "needs-repair", "discard-pending"].contains(parent.status.state) {
                    try store.updateStatus(record.id) { $0.state = "blocked"; $0.error = "The original capture needs recovery first." }
                    return
                }
                guard parent.status.serverAccepted else {
                    try store.updateStatus(record.id) { $0.state = "waiting-for-original" }
                    return
                }
            } else {
                // Explicit server-only originals are valid, including captures from another phone.
                do {
                    let parent = try await QuickCaptureAPI(box: box, transport: transport).detail(id: parentID)
                    guard parent.state != "gone" else {
                        try store.updateStatus(record.id) { $0.state = "blocked"; $0.error = "The original capture was deleted." }
                        return
                    }
                } catch {
                    try store.updateStatus(record.id) { $0.state = "waiting-for-original"; $0.error = "Waiting to verify the original capture in this box." }
                    return
                }
            }
        }
        // Reserve the whole transport lifetime; a last-minute background retry must not outlive the automatic window.
        let retryDeadline = Self.automaticRetryWindow - (allowManualRetry ? 0 : Self.maximumTransferDuration)
        guard Date().timeIntervalSince(record.createdAt) < retryDeadline else {
            try store.updateStatus(record.id) { $0.state = "needs-retry"; $0.error = "Automatic retry expired. Refresh the box receipt before retrying." }
            return
        }
        if let next = record.status.nextAttemptAt, next > Date() { return }
        let transferSession = session(identifier: initiatingIdentifier)
        let tasks = await transferSession.allTasks
        guard let current = try store.record(record.id), current.status.state != "gone", current.status.discardRequested != true else { return }
        if tasks.contains(where: { $0.taskDescription == record.id.uuidString.lowercased() }) { return }
        let boundary = "BeeBoxCapture\(record.id.uuidString.replacingOccurrences(of: "-", with: ""))"
        let body = try buildBody(record: record, boundary: boundary)
        let request = QuickCaptureAPI(box: box, transport: transport).acceptanceRequest(id: record.id, boundary: boundary)
        // Publish durable retry state before the task can complete in another process.
        try store.updateStatus(record.id) {
            $0.state = "uploading"; $0.error = nil; $0.attempts += 1
            $0.nextAttemptAt = Date().addingTimeInterval(min(6 * 60 * 60, pow(2, Double(min($0.attempts, 12))) * 15))
        }
        let task = transferSession.uploadTask(with: request, fromFile: body)
        task.taskDescription = record.id.uuidString.lowercased()
        task.resume()
        logger.info("capture_upload_scheduled id=\(record.id.uuidString, privacy: .public) attempts=\(record.status.attempts + 1)")
    }

    /// App activation and background-session recovery refresh receipts before replay.
    func recover(boxes: [PairedBox]) async {
        let records: [QuickCaptureRecord]
        do { records = try store.records() }
        catch { logger.error("capture_recovery_read_failed error=\(String(describing: type(of: error)), privacy: .public)"); return }
        var refreshedBoxes: Set<UUID> = []
        for record in records.reversed() {
            if record.status.state == "gone" {
                do { if record.status.serverAccepted { try store.purgeAcceptedSource(id: record.id) } }
                catch { logger.error("capture_deleted_source_cleanup_failed id=\(record.id.uuidString, privacy: .public)") }
                continue
            }
            guard let box = boxes.first(where: { $0.id == record.boxID }) else {
                persistStatus(record.id) { $0.state = "needs-repair"; $0.error = "The capture destination was removed. Your capture is still on this phone." }
                continue
            }
            if record.status.discardRequested == true {
                await cancelTransfers(id: record.id)
                do { try await reconcileDiscard(record: record, box: box) }
                catch { logger.info("capture_discard_recovery_waiting id=\(record.id.uuidString, privacy: .public)") }
                continue
            }
            if box.authToken?.isEmpty != false {
                persistStatus(record.id) { $0.state = "needs-repair"; $0.error = "Pair this box again." }
                continue
            }
            if refreshedBoxes.insert(box.id).inserted, let capabilities = try? await QuickCaptureAPI(box: box, transport: transport).capabilities() {
                do { try QuickCaptureCapabilityCache().save(capabilities, boxID: box.id) }
                catch { logger.error("capture_capability_cache_failed") }
            }
            do {
                let remote = try await QuickCaptureAPI(box: box, transport: transport).detail(id: record.id)
                try apply(remote: remote)
                continue
            } catch QuickCaptureAPI.APIError.server(let status, _) where status == 401 || status == 403 {
                persistStatus(record.id) { $0.state = "needs-repair"; $0.error = "The box credential is no longer valid. Pair again." }
                continue
            } catch {
                // A lost acceptance response and an offline box are both locally pending.
            }
            do { try await schedule(record: record, box: box) }
            catch { persistStatus(record.id) { $0.state = "saved-on-phone"; $0.error = "Delivery is pending. Open Bee Box when the box is reachable." } }
        }
    }

    /// Background completion advances only local dependent events, without a full remote sweep.
    func resumeWaitingContexts(boxes: [PairedBox]) async {
        do {
            let records = try store.records()
            for record in records where !record.status.serverAccepted {
                guard let parentID = record.declaration.parentCaptureId,
                      let parent = try store.record(parentID), parent.status.serverAccepted,
                      let box = boxes.first(where: { $0.id == record.boxID }) else { continue }
                do { try await schedule(record: record, box: box) }
                catch { logger.error("capture_context_resume_failed id=\(record.id.uuidString, privacy: .public) error=\(String(describing: type(of: error)), privacy: .public)") }
            }
        } catch { logger.error("capture_context_recovery_read_failed error=\(String(describing: type(of: error)), privacy: .public)") }
    }

    /// Manual retry reconciles the old identity. It never silently creates a replacement send.
    func retry(record: QuickCaptureRecord, box: PairedBox) async throws {
        guard record.status.discardRequested != true else { throw QuickCaptureStore.StoreError.unavailable }
        guard record.boxID == box.id else { throw CaptureDestinationStore.DestinationError.removed }
        if box.requiresDeviceUnlock && (record.declaration.source == .appIntents || !record.requiresDeviceUnlock) {
            throw CaptureDestinationStore.DestinationError.protected
        }
        guard record.status.state != "interrupted-draft" else { throw QuickCaptureStore.StoreError.incomplete }
        do {
            let remote = try await QuickCaptureAPI(box: box, transport: transport).detail(id: record.id)
            let retried = try await QuickCaptureAPI(box: box, transport: transport).retry(id: remote.id)
            try apply(remote: retried)
            return
        } catch QuickCaptureAPI.APIError.server(let status, _) where status == 404 {
            guard Date().timeIntervalSince(record.createdAt) < 7 * 24 * 60 * 60 else {
                try store.updateStatus(record.id) { $0.state = "needs-retry"; $0.error = "The old receipt could not be recovered. Your source is retained; choose an explicit new send in the box." }
                throw QuickCaptureStore.StoreError.unsupported
            }
            try store.updateStatus(record.id) { $0.state = "saved-on-phone"; $0.error = nil; $0.nextAttemptAt = nil }
            guard let current = try store.record(record.id) else { throw QuickCaptureStore.StoreError.incomplete }
            try await schedule(record: current, box: box, allowManualRetry: true)
        }
    }

    /// Shared receipt transition used by foreground and background URLSession completions.
    func recordReceipt(_ receipt: QuickCaptureReceipt) throws {
        guard receipt.state == "accepted" else { throw QuickCaptureAPI.APIError.invalidResponse }
        try store.updateStatus(receipt.id) { $0.state = "accepted"; $0.serverAccepted = true; $0.error = nil; $0.nextAttemptAt = nil }
        if let handler = lock.withLock({ receiptHandler }) { Task { await handler() } }
    }

    func apply(remote: QuickCaptureRemoteRecord) throws {
        try store.updateStatus(remote.id) {
            $0.serverAccepted = true; $0.state = remote.state; $0.error = remote.error
            $0.sourceRef = remote.sourceRef; $0.transcript = remote.transcript; $0.delivery = remote.delivery; $0.nextAttemptAt = nil
        }
    }

    /// Streaming avoids holding a voice recording/image plus its multipart copy in memory.
    func buildBody(record: QuickCaptureRecord, boundary: String) throws -> URL {
        try store.withCoordinatedAccess { try writeBody(record: record, boundary: boundary) }
    }

    private func writeBody(record: QuickCaptureRecord, boundary: String) throws -> URL {
        guard let current = try store.record(record.id), current.status.state != "gone", current.status.discardRequested != true else { throw QuickCaptureStore.StoreError.incomplete }
        let destination = store.bodyURL(for: record.id)
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        let temporary = destination.appendingPathExtension(UUID().uuidString)
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil,
            attributes: [.protectionKey: record.requiresDeviceUnlock ? FileProtectionType.complete : .completeUntilFirstUserAuthentication]) else {
            throw QuickCaptureStore.StoreError.unavailable
        }
        let writer = try FileHandle(forWritingTo: temporary)
        do {
            try writer.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"declaration\"\r\nContent-Type: application/json\r\n\r\n".utf8))
            try writer.write(contentsOf: JSONEncoder().encode(record.declaration))
            try writer.write(contentsOf: Data("\r\n".utf8))
            if let material = record.declaration.material, ["image", "audio"].contains(material.kind) {
                try writer.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"material\"; filename=\"\(material.fileName ?? "capture")\"\r\nContent-Type: \(material.mimeType ?? "application/octet-stream")\r\n\r\n".utf8))
                let reader = try FileHandle(forReadingFrom: store.materialURL(for: record.id))
                defer { try? reader.close() }
                while let chunk = try reader.read(upToCount: 1_048_576), !chunk.isEmpty { try writer.write(contentsOf: chunk) }
                try writer.write(contentsOf: Data("\r\n".utf8))
            }
            try writer.write(contentsOf: Data("--\(boundary)--\r\n".utf8))
            try writer.synchronize(); try writer.close()
            try FileManager.default.moveItem(at: temporary, to: destination)
            return destination
        } catch {
            try? writer.close(); try? FileManager.default.removeItem(at: temporary); throw error
        }
    }

    private func persistStatus(_ id: UUID, _ update: (inout QuickCaptureStatus) -> Void) {
        do { try store.updateStatus(id, update) }
        catch { logger.error("capture_status_persist_failed id=\(id.uuidString, privacy: .public) error=\(String(describing: type(of: error)), privacy: .public)") }
    }

    private var initiatingIdentifier: String {
        Self.identifierPrefix + (Bundle.main.bundleIdentifier ?? "app.beebox.ios")
    }

    private func session(identifier: String) -> URLSession {
        lock.withLock {
            if let existing = sessions[identifier] { return existing }
            let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
            configuration.sharedContainerIdentifier = QuickCaptureStore.group
            configuration.sessionSendsLaunchEvents = true
            configuration.isDiscretionary = false
            configuration.waitsForConnectivity = true
            configuration.timeoutIntervalForResource = Self.maximumTransferDuration
            let result = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            sessions[identifier] = result
            return result
        }
    }

    private func responseKey(_ session: URLSession, _ task: URLSessionTask) -> String {
        "\(session.configuration.identifier ?? ""):\(task.taskIdentifier)"
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.withLock {
            let key = responseKey(session, dataTask)
            // Acceptance is a tiny receipt; never retain an unbounded proxy response.
            if (responseBytes[key]?.count ?? 0) + data.count <= 65_536 { responseBytes[key, default: Data()].append(data) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let description = task.taskDescription, let id = UUID(uuidString: description) else { return }
        let data = lock.withLock { responseBytes.removeValue(forKey: responseKey(session, task)) ?? Data() }
        logger.info("capture_upload_completed id=\(id.uuidString, privacy: .public) error=\(error != nil)")
        let http = task.response as? HTTPURLResponse
        if error == nil, let http, (200..<300).contains(http.statusCode),
           let receipt = try? QuickCaptureAPI.decodeReceipt(data), receipt.id == id, receipt.state == "accepted" {
            do { try recordReceipt(receipt) }
            catch { logger.error("capture_receipt_persist_failed id=\(id.uuidString, privacy: .public)") }
        } else {
            persistStatus(id) {
                if let status = http?.statusCode, [401, 403].contains(status) { $0.state = "needs-repair"; $0.error = "Pair this box again." }
                else if let status = http?.statusCode, [400, 409, 413, 415, 422].contains(status) { $0.state = "failed"; $0.error = "The box refused this capture. Your source remains on this phone." }
                else if http?.statusCode == 404 { $0.state = "unsupported"; $0.error = "This box needs an update to support quick capture." }
                else { $0.state = "saved-on-phone"; $0.error = "Delivery is pending. Reopen Bee Box to recover." }
            }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        guard let identifier = session.configuration.identifier else { return }
        let completion = lock.withLock { completionHandlers.removeValue(forKey: identifier) }
        if let completion { DispatchQueue.main.async(execute: completion) }
    }
}
