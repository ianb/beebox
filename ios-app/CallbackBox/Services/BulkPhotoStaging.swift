import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Copies picked photos out of the Photos picker and onto disk, ready to upload.
///
/// **Why a file representation and not `Data`.** The composer's inline path loads
/// each pick with `loadTransferable(type: Data.self)`, which holds the whole image
/// in memory. That is fine for a handful and fatal for a camera roll: 70 photos
/// (often large HEICs, sometimes still downloading from iCloud) cannot all be
/// resident at once. Apple's guidance is to take the *file* representation for
/// larger media and copy it somewhere the app owns, because the URL handed to the
/// transfer closure is temporary. That is what this does, and it is what lets the
/// batch survive import before a single byte is uploaded.
///
/// See `docs/plans/chat-photo-batch-upload.md` (Prior art) and
/// `docs/implemented-plans/bulk-file-upload.md` Track 3.
enum BulkPhotoStaging {
    /// A picked photo copied into app-owned storage.
    private struct PickedPhotoFile: Transferable {
        let url: URL

        static var transferRepresentation: some TransferRepresentation {
            FileRepresentation(importedContentType: .image) { received in
                // The received URL is temporary — copy before returning, or the
                // bytes are gone by the time the upload starts.
                let destination = BulkPhotoStaging.stagingRoot()
                    .appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(received.file.pathExtension.isEmpty ? "jpg" : received.file.pathExtension)
                try FileManager.default.createDirectory(
                    at: destination.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.copyItem(at: received.file, to: destination)
                return Self(url: destination)
            }
        }
    }

    /// Where staged batch photos live until their upload is confirmed. Caches, not
    /// Documents: these are reconstructible from the user's photo library, and the
    /// batch is discarded once the box has the bytes.
    static func stagingRoot() -> URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("bulk-upload-staging", isDirectory: true)
    }

    /// Import a picked selection to disk, one item at a time.
    ///
    /// Sequential on purpose: the point is to never hold more than one photo's
    /// bytes at once. `onProgress` reports items staged so far, so a 70-photo
    /// import isn't a silent wait.
    ///
    /// An item that can't be read is skipped and named in the returned
    /// `failures` rather than dropped silently — the caller reports those to the
    /// box at finalize so the batch is honest about what it is short.
    static func stage(
        items: [PhotosPickerItem],
        uploadedAt: String,
        onProgress: @MainActor (Int) -> Void
    ) async -> (prepared: [PreparedBulkItem], failures: [BulkUploadAPI.FailedItem]) {
        var prepared: [PreparedBulkItem] = []
        var failures: [BulkUploadAPI.FailedItem] = []

        for (index, item) in items.enumerated() {
            let displayName = "photo-\(String(format: "%03d", index + 1))"
            do {
                guard let picked = try await item.loadTransferable(type: PickedPhotoFile.self) else {
                    failures.append(BulkUploadAPI.FailedItem(
                        id: nil,
                        name: displayName,
                        reason: "The photo could not be read from the library."
                    ))
                    continue
                }
                let mimeType = item.supportedContentTypes
                    .first(where: { $0.conforms(to: .image) })?
                    .preferredMIMEType ?? "image/jpeg"
                let ext = picked.url.pathExtension.isEmpty ? "jpg" : picked.url.pathExtension
                let size = (try? FileManager.default.attributesOfItem(atPath: picked.url.path)[.size] as? Int) ?? nil
                let id = UUID().uuidString
                prepared.append(PreparedBulkItem(
                    id: id,
                    fileURL: picked.url,
                    // The staged filename doubles as the server's idempotency key
                    // for a retry of these exact bytes, so it must be stable per
                    // item — the registry id gives it that.
                    stagedFilename: "\(id).\(ext)",
                    originalName: "\(displayName).\(ext)",
                    mimeType: mimeType,
                    uploadedAt: uploadedAt,
                    size: size ?? 0
                ))
            } catch {
                failures.append(BulkUploadAPI.FailedItem(
                    id: nil,
                    name: displayName,
                    reason: error.localizedDescription
                ))
            }
            let staged = prepared.count
            await onProgress(staged)
        }
        return (prepared, failures)
    }

    /// Stage bytes already held in the composer (a photo pasted or picked
    /// earlier, downscaled and encoded) so it can join a batch.
    ///
    /// Used when a new selection crosses the inline threshold: the photos already
    /// in the composer come along, rather than being left behind with nothing
    /// describing them while the composer text goes off as the batch's
    /// introduction. One selection act, one destination.
    static func stageComposerImage(
        data: Data,
        mimeType: String,
        index: Int,
        uploadedAt: String
    ) -> PreparedBulkItem? {
        // Derive the extension from the actual type. Naming everything non-PNG
        // `.jpg` mislabels HEIC/WebP bytes, and the box's card records a
        // client-claimed mimetype the agent is told to distrust when it
        // disagrees with the bytes — so a wrong extension turns into a wrong
        // claim that survives into the batch.
        let ext = Self.fileExtension(for: mimeType)
        let id = UUID().uuidString
        let destination = stagingRoot().appendingPathComponent("\(id).\(ext)")
        do {
            try FileManager.default.createDirectory(at: stagingRoot(), withIntermediateDirectories: true)
            try data.write(to: destination)
        } catch {
            return nil
        }
        return PreparedBulkItem(
            id: id,
            fileURL: destination,
            stagedFilename: "\(id).\(ext)",
            originalName: "pasted-image-\(String(format: "%03d", index + 1)).\(ext)",
            mimeType: mimeType,
            uploadedAt: uploadedAt,
            size: data.count
        )
    }

    /// Map an image mimetype to its conventional file extension.
    static func fileExtension(for mimeType: String) -> String {
        switch mimeType.lowercased() {
        case "image/png": return "png"
        case "image/heic", "image/heif": return "heic"
        case "image/webp": return "webp"
        case "image/gif": return "gif"
        case "image/tiff": return "tiff"
        default: return "jpg"
        }
    }

    /// Delete every staged file left behind by a previous run.
    ///
    /// A retained batch does not survive a relaunch (there is no persisted
    /// record — see the parity matrix), so anything still here after a cold
    /// start is unreachable and would otherwise accumulate in Caches forever.
    /// Call once at composer start, before any batch could have staged.
    static func discardOrphans() {
        let root = stagingRoot()
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil
        ) else {
            return
        }
        for url in contents {
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// Delete the staged copies once the box has the bytes (or the batch is
    /// abandoned). Best-effort: these live in Caches, so the system reclaims
    /// anything missed.
    static func discard(_ items: [PreparedBulkItem]) {
        for item in items {
            try? FileManager.default.removeItem(at: item.fileURL)
        }
    }
}
