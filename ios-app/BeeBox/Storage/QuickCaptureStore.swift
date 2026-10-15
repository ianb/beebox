import CryptoKit
import Foundation
import OSLog

// These source values identify acquisition APIs, not an inferred Siri/Action Button caller.
enum QuickCaptureSource: String, Codable { case nativeInput = "apple-native-input", appIntents = "apple-app-intents", shareExtension = "apple-share-extension", voiceRecording = "apple-voice-recording" }

struct QuickCaptureMaterial: Codable, Equatable {
    var kind: String
    var url: String?
    var text: String?
    var title: String?
    var id: UUID?
    var mimeType: String?
    var byteLength: Int?
    var sha256: String?
    var fileName: String?

    static func file(kind: String, id: UUID = UUID(), mimeType: String, fileName: String) -> Self {
        Self(kind: kind, id: id, mimeType: mimeType, fileName: fileName)
    }
}

struct QuickCaptureDeclaration: Codable, Equatable {
    var version = 1
    var capturedAt: String
    var source: QuickCaptureSource
    var input: String?
    var material: QuickCaptureMaterial?
    var parentCaptureId: UUID?
    var recordingInterrupted: Bool?

    private static func parsedDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    func validate() throws {
        guard version == 1, Self.parsedDate(capturedAt) != nil,
              (input?.utf16.count ?? 0) <= 10_000,
              !(input?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty || material != nil,
              parentCaptureId == nil || material == nil else { throw QuickCaptureStore.StoreError.unsupported }
        if let recordingInterrupted {
            guard recordingInterrupted, material?.kind == "audio" else { throw QuickCaptureStore.StoreError.unsupported }
        }
        guard let material else { return }
        guard (material.title?.utf16.count ?? 0) <= 500 else { throw QuickCaptureStore.StoreError.unsupported }
        switch material.kind {
        case "url":
            guard material.text == nil, material.id == nil, material.mimeType == nil, material.byteLength == nil,
                  material.sha256 == nil, material.fileName == nil else { throw QuickCaptureStore.StoreError.unsupported }
            guard let url = material.url, url.utf16.count <= 10_000,
                  let parsed = URL(string: url), ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") else { throw QuickCaptureStore.StoreError.unsupported }
        case "clipping":
            guard material.url == nil, material.id == nil, material.mimeType == nil, material.byteLength == nil,
                  material.sha256 == nil, material.fileName == nil else { throw QuickCaptureStore.StoreError.unsupported }
            guard let text = material.text, !text.isEmpty, text.utf16.count <= 100_000 else { throw QuickCaptureStore.StoreError.unsupported }
        case "image", "audio":
            guard material.url == nil, material.text == nil, material.title == nil else { throw QuickCaptureStore.StoreError.unsupported }
            guard material.id != nil, let size = material.byteLength, size > 0, size <= 50 * 1_024 * 1_024,
                  let digest = material.sha256, digest.count == 64, digest.allSatisfy({ "0123456789abcdef".contains($0) }),
                  let name = material.fileName, !name.isEmpty, name.utf16.count <= 200,
                  !name.contains("/"), !name.contains("\\"), ![".", ".."].contains(name),
                  name.rangeOfCharacter(from: .controlCharacters) == nil,
                  let mime = material.mimeType,
                  (material.kind == "image" ? ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] : ["audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/webm", "audio/mpeg"]).contains(mime)
            else { throw QuickCaptureStore.StoreError.unsupported }
        default: throw QuickCaptureStore.StoreError.unsupported
        }
    }
}

struct QuickCaptureStatus: Codable, Equatable {
    var state = "saved-on-phone"
    var error: String?
    var attempts = 0
    var nextAttemptAt: Date?
    var serverAccepted = false
    var sourceRef: String?
    var transcript: String?
    var delivery: QuickChatView?
    var discardRequested: Bool?
}

struct QuickCaptureRecord: Codable, Equatable, Identifiable {
    var id: UUID
    var boxID: UUID
    var boxLabel: String
    var requiresDeviceUnlock: Bool
    var declaration: QuickCaptureDeclaration
    var status = QuickCaptureStatus()
    var createdAt: Date
}

/// Immutable source plus separately coordinated status. Credentials never enter this store.
final class QuickCaptureStore: @unchecked Sendable {
    static let group = "group.app.beebox.ios"
    static let shared = QuickCaptureStore()
    static let didChange = Notification.Name("QuickCaptureStoreDidChange")
    let rootURL: URL
    private let fileManager = FileManager.default
    private let protectionWriter: (URL, FileProtectionType) throws -> Void
    private let logger = Logger(subsystem: "app.beebox.ios", category: "quick-capture")

    enum StoreError: LocalizedError {
        case unavailable, empty, unsupported, conflict, incomplete
        var errorDescription: String? {
            switch self {
            case .unavailable: "Shared capture storage is unavailable. Open Bee Box to repair setup."
            case .empty: "Add words or material before saving."
            case .unsupported: "This capture type or size is not supported."
            case .conflict: "A capture with this identity already contains different material."
            case .incomplete: "The complete capture could not be saved on your phone."
            }
        }
    }

    init(rootURL: URL? = nil, protectionWriter: ((URL, FileProtectionType) throws -> Void)? = nil) {
        self.protectionWriter = protectionWriter ?? { url, protection in
            try FileManager.default.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
        }
        self.rootURL = rootURL ?? fileManager.containerURL(forSecurityApplicationGroupIdentifier: Self.group)?
            .appendingPathComponent("quick-captures", isDirectory: true)
            ?? URL(fileURLWithPath: "/dev/null/quick-captures")
    }

    func directory(for id: UUID) -> URL { rootURL.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true) }
    func materialURL(for id: UUID) -> URL { directory(for: id).appendingPathComponent("material") }
    func bodyURL(for id: UUID) -> URL { directory(for: id).appendingPathComponent("request.multipart") }

    @discardableResult
    func accept(box: PairedBox, source: QuickCaptureSource, input: String? = nil,
                material: QuickCaptureMaterial? = nil, fileURL: URL? = nil,
                parentCaptureID: UUID? = nil, id: UUID = UUID(), capturedAt: Date = Date(), recordingInterrupted: Bool? = nil) throws -> QuickCaptureRecord {
        if let material {
            guard ["url", "clipping", "image", "audio"].contains(material.kind) else { throw StoreError.unsupported }
            guard (material.title?.utf16.count ?? 0) <= 500 else { throw StoreError.unsupported }
            if material.kind == "url" {
                guard let value = material.url, value.utf16.count <= 10_000, let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { throw StoreError.unsupported }
            }
            if material.kind == "clipping" {
                guard let text = material.text, !text.isEmpty else { throw StoreError.empty }
                guard text.utf16.count <= 100_000 else { throw StoreError.unsupported }
            }
        }
        let words = input?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !(words ?? "").isEmpty || material != nil else { throw StoreError.empty }
        guard (words?.utf16.count ?? 0) <= 10_000, parentCaptureID == nil || material == nil else { throw StoreError.unsupported }
        var declaration = QuickCaptureDeclaration(capturedAt: ISO8601DateFormatter().string(from: capturedAt), source: source,
                                                 input: words?.isEmpty == false ? words : nil, material: material, parentCaptureId: parentCaptureID, recordingInterrupted: recordingInterrupted)
        let protection: FileProtectionType = box.requiresDeviceUnlock ? .complete : .completeUntilFirstUserAuthentication
        return try coordinated {
            let temporary = self.rootURL.appendingPathComponent(".draft-\(UUID().uuidString)", isDirectory: true)
            try self.fileManager.createDirectory(at: temporary, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: protection])
            do {
                var draft = QuickCaptureRecord(id: id, boxID: box.id, boxLabel: box.label,
                    requiresDeviceUnlock: box.requiresDeviceUnlock, declaration: declaration, createdAt: Date())
                draft.status.state = "interrupted-draft"
                draft.status.error = "Saving was interrupted before the complete capture was accepted. Review the retained draft."
                try self.write(draft, to: temporary.appendingPathComponent("manifest.json"), protection: protection)
                try self.write(draft.status, to: temporary.appendingPathComponent("status.json"), protection: protection)
                if let fileURL {
                    guard var file = declaration.material, ["image", "audio"].contains(file.kind) else { throw StoreError.unsupported }
                    let destination = temporary.appendingPathComponent("material")
                    try self.fileManager.copyItem(at: fileURL, to: destination)
                    let handle = try FileHandle(forReadingFrom: destination)
                    var hash = SHA256()
                    var count = 0
                    while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty { hash.update(data: bytes); count += bytes.count }
                    try handle.close()
                    guard count > 0, count <= QuickCaptureCapabilityCache().maxFileBytes(boxID: box.id) else { throw StoreError.incomplete }
                    file.id = file.id ?? id
                    file.byteLength = count
                    file.sha256 = hash.finalize().map { String(format: "%02x", $0) }.joined()
                    guard let mime = file.mimeType,
                          (file.kind == "image" ? ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] : ["audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/webm", "audio/mpeg"]).contains(mime) else { throw StoreError.unsupported }
                    let suppliedName = file.fileName ?? "capture"
                    let safeName = String(suppliedName.unicodeScalars.filter {
                        !CharacterSet.controlCharacters.contains($0) && !["/", "\\", "\""].contains(String($0))
                    }.map(String.init).joined().prefix(100))
                    file.fileName = safeName.isEmpty || [".", ".."].contains(safeName) ? "capture" : safeName
                    declaration.material = file
                    try self.fileManager.setAttributes([.protectionKey: protection], ofItemAtPath: destination.path)
                    let writer = try FileHandle(forWritingTo: destination)
                    try writer.synchronize(); try writer.close()
                } else if let kind = declaration.material?.kind, ["image", "audio"].contains(kind) { throw StoreError.incomplete }
                try declaration.validate()
                if let old = try self.record(id) {
                    declaration.capturedAt = old.declaration.capturedAt
                    guard old.boxID == box.id, old.declaration == declaration else { throw StoreError.conflict }
                    try self.fileManager.removeItem(at: temporary)
                    return old
                }
                let record = QuickCaptureRecord(id: id, boxID: box.id, boxLabel: box.label,
                                                requiresDeviceUnlock: box.requiresDeviceUnlock, declaration: declaration, createdAt: Date())
                try self.write(record, to: temporary.appendingPathComponent("manifest.json"), protection: protection)
                try self.write(record.status, to: temporary.appendingPathComponent("status.json"), protection: protection)
                try self.fileManager.moveItem(at: temporary, to: self.directory(for: id))
                self.logger.info("capture_local_accepted id=\(id.uuidString, privacy: .public) box=\(box.id.uuidString, privacy: .public)")
                self.changed()
                return record
            } catch {
                do { try self.fileManager.removeItem(at: temporary) }
                catch { self.logger.error("capture_draft_cleanup_failed error=\(String(describing: type(of: error)), privacy: .public)") }
                throw error
            }
        }
    }

    /// Only an incomplete local publication with no transfer attempt can be
    /// replaced by its still-retained source draft. Accepted sources need their
    /// normal receipt/delete flow; this method never creates a remote tombstone.
    func removeInterruptedDraft(_ id: UUID) throws {
        try coordinated {
            guard let record = try self.record(id), record.status.state == "interrupted-draft",
                  !record.status.serverAccepted, record.status.attempts == 0 else { throw StoreError.conflict }
            try self.fileManager.removeItem(at: self.directory(for: id))
            self.changed()
        }
    }

    func record(_ id: UUID) throws -> QuickCaptureRecord? {
        let manifest = directory(for: id).appendingPathComponent("manifest.json")
        guard fileManager.fileExists(atPath: manifest.path) else { return nil }
        var record = try JSONDecoder().decode(QuickCaptureRecord.self, from: Data(contentsOf: manifest))
        record.status = try JSONDecoder().decode(QuickCaptureStatus.self, from: Data(contentsOf: directory(for: id).appendingPathComponent("status.json")))
        return record
    }

    func records() throws -> [QuickCaptureRecord] {
        return try coordinated {
            let directories = try self.fileManager.contentsOfDirectory(at: self.rootURL, includingPropertiesForKeys: nil)
            // Coordination excludes an active publisher. Only abandoned drafts are recovered.
            for draft in directories where draft.lastPathComponent.hasPrefix(".draft-") {
                let manifest = draft.appendingPathComponent("manifest.json")
                guard self.fileManager.fileExists(atPath: manifest.path) else {
                    self.logger.warning("capture_orphan_draft_unreadable")
                    continue
                }
                let record = try JSONDecoder().decode(QuickCaptureRecord.self, from: Data(contentsOf: manifest))
                if !self.fileManager.fileExists(atPath: self.directory(for: record.id).path) {
                    try self.fileManager.moveItem(at: draft, to: self.directory(for: record.id))
                    self.logger.warning("capture_draft_recovered id=\(record.id.uuidString, privacy: .public)")
                }
            }
            return try self.fileManager.contentsOfDirectory(at: self.rootURL, includingPropertiesForKeys: nil)
                .compactMap { url in
                    guard let id = UUID(uuidString: url.lastPathComponent) else { return nil }
                    return try self.record(id)
                }.sorted { $0.createdAt > $1.createdAt }
        }
    }

    /// Pairing metadata may disappear later; protection upgrades must survive that removal.
    /// This changes only local access metadata, never immutable source declarations or wire identity.
    func preserveProtection(boxes: [PairedBox]) throws {
        let protectedIDs = Set(boxes.filter(\.requiresDeviceUnlock).map(\.id))
        guard !protectedIDs.isEmpty else { return }
        try coordinated {
            var changed = false
            defer { if changed { self.changed() } }
            for directory in try self.fileManager.contentsOfDirectory(at: self.rootURL, includingPropertiesForKeys: nil) {
                guard UUID(uuidString: directory.lastPathComponent) != nil || directory.lastPathComponent.hasPrefix(".draft-") else { continue }
                let manifest = directory.appendingPathComponent("manifest.json")
                guard self.fileManager.fileExists(atPath: manifest.path) else { continue }
                var record = try JSONDecoder().decode(QuickCaptureRecord.self, from: Data(contentsOf: manifest))
                guard protectedIDs.contains(record.boxID) else { continue }
                if !record.requiresDeviceUnlock {
                    // Persist the refusal flag first; a later filesystem failure must not expose an orphan.
                    record.requiresDeviceUnlock = true
                    try self.write(record, to: directory.appendingPathComponent("manifest.json"), protection: .complete)
                    changed = true
                }
                try self.protectionWriter(directory, .complete)
                var traversalError: Error?
                guard let enumerator = self.fileManager.enumerator(at: directory, includingPropertiesForKeys: nil,
                    errorHandler: { _, error in traversalError = error; return false }) else { throw StoreError.unavailable }
                for case let url as URL in enumerator {
                    try self.protectionWriter(url, .complete)
                }
                if let traversalError { throw traversalError }
            }
        }
    }

    func updateStatus(_ id: UUID, _ update: (inout QuickCaptureStatus) -> Void) throws {
        try coordinated {
            guard let record = try self.record(id) else { throw StoreError.incomplete }
            // Confirmed deletion is terminal, including callbacks from an older transfer.
            guard record.status.state != "gone" else { return }
            var status = record.status
            update(&status)
            if record.status.discardRequested == true && status.state != "gone" {
                status.discardRequested = true
                status.state = "discard-pending"
                status.error = "Discard requested — waiting for box confirmation."
                status.nextAttemptAt = nil
            }
            try self.write(status, to: self.directory(for: id).appendingPathComponent("status.json"),
                           protection: record.requiresDeviceUnlock ? .complete : .completeUntilFirstUserAuthentication)
            if status.serverAccepted { try self.removeTransferBody(id: id) }
            self.changed()
        }
    }

    /// Call only after the server has confirmed deletion. Keep a content-free identity tombstone.
    func purgeAcceptedSource(id: UUID) throws {
        try coordinated {
            guard var record = try self.record(id), record.status.serverAccepted, record.status.state == "gone" else { throw StoreError.incomplete }
            let protection: FileProtectionType = record.requiresDeviceUnlock ? .complete : .completeUntilFirstUserAuthentication
            record.status = QuickCaptureStatus(state: "gone", serverAccepted: true)
            // Mark terminal first so late callbacks cannot revive state during content removal.
            try self.write(record.status, to: self.directory(for: id).appendingPathComponent("status.json"), protection: protection)
            record.declaration.input = nil
            record.declaration.material = nil
            record.declaration.parentCaptureId = nil
            record.declaration.recordingInterrupted = nil
            try self.write(record, to: self.directory(for: id).appendingPathComponent("manifest.json"), protection: protection)
            try self.removeSourceFiles(id: id)
            self.logger.info("capture_source_purged id=\(id.uuidString, privacy: .public)")
            self.changed()
        }
    }

    /// Unsent local discard keeps an identity tombstone so queued context cannot target a replacement.
    func discard(_ id: UUID) throws {
        try coordinated {
            guard var record = try self.record(id), !record.status.serverAccepted, record.status.attempts == 0 else { throw StoreError.incomplete }
            let protection: FileProtectionType = record.requiresDeviceUnlock ? .complete : .completeUntilFirstUserAuthentication
            record.status = QuickCaptureStatus(state: "gone", serverAccepted: false)
            try self.write(record.status, to: self.directory(for: id).appendingPathComponent("status.json"), protection: protection)
            record.declaration.input = nil; record.declaration.material = nil; record.declaration.parentCaptureId = nil
            record.declaration.recordingInterrupted = nil
            try self.write(record, to: self.directory(for: id).appendingPathComponent("manifest.json"), protection: protection)
            try self.removeSourceFiles(id: id)
            self.changed()
        }
    }

    private func removeTransferBody(id: UUID) throws {
        for url in try fileManager.contentsOfDirectory(at: directory(for: id), includingPropertiesForKeys: nil)
            where url.lastPathComponent.hasPrefix("request.multipart") {
            try fileManager.removeItem(at: url)
        }
    }

    private func removeSourceFiles(id: UUID) throws {
        for url in try fileManager.contentsOfDirectory(at: directory(for: id), includingPropertiesForKeys: nil)
            where !["manifest.json", "status.json"].contains(url.lastPathComponent) {
            try fileManager.removeItem(at: url)
        }
        // A replay interrupted before cleanup may leave a sibling draft with the same identity.
        for draft in try fileManager.contentsOfDirectory(at: rootURL, includingPropertiesForKeys: nil)
            where draft.lastPathComponent.hasPrefix(".draft-") {
            let manifest = draft.appendingPathComponent("manifest.json")
            if let bytes = try? Data(contentsOf: manifest),
               let record = try? JSONDecoder().decode(QuickCaptureRecord.self, from: bytes), record.id == id {
                try fileManager.removeItem(at: draft)
            }
        }
    }

    func withCoordinatedAccess<T>(_ operation: () throws -> T) throws -> T { try coordinated(operation) }

    /// File coordination serializes app/extension publishers; no process-local array is authoritative.
    private func coordinated<T>(_ operation: () throws -> T) throws -> T {
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        var coordinationError: NSError?
        var outcome: Result<T, Error>?
        NSFileCoordinator().coordinate(writingItemAt: rootURL, options: [], error: &coordinationError) { _ in
            outcome = Result { try operation() }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw StoreError.unavailable }
        return try outcome.get()
    }

    private func write(_ value: some Encodable, to url: URL, protection: FileProtectionType) throws {
        let bytes = try JSONEncoder().encode(value)
        try bytes.write(to: url, options: [.atomic])
        try fileManager.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
        let handle = try FileHandle(forWritingTo: url)
        try handle.synchronize(); try handle.close()
    }

    private func changed() { NotificationCenter.default.post(name: Self.didChange, object: nil) }
}
