import Containerization
import ContainerizationExtras
import ContainerizationOCI
import Foundation

/// Gets the beebox image into the app's store: pulled from the registry at
/// the version this app pins, or loaded from a local OCI layout during
/// development (`BEEBOX_IMAGE_LAYOUT`).
struct ImageSource {
    let store: ImageStore
    /// Reports a status line while downloading or loading.
    let report: @Sendable (String) async -> Void

    /// The image, and whether this call had to fetch or load it.
    func image() async throws -> (image: Containerization.Image, fetched: Bool) {
        if let layout = Paths.imageLayout {
            return try await fromLayout(layout)
        }
        let reference = BundleConfig.image
        if let image = try? await store.get(reference: reference) {
            return (image, false)
        }
        await report("Downloading Bee Box…")
        let counter = DownloadCounter()
        let report = self.report
        let image: Containerization.Image
        do {
            image = try await store.pull(
                reference: reference,
                platform: Platform(arch: "arm64", os: "linux"),
                progress: { events in
                    if let line = await counter.add(events) { await report(line) }
                }
            )
        } catch {
            // GitHub's registry answers 401, not 404, for an image that does
            // not exist or is not public, so say both.
            throw RuntimeError("could not download the Bee Box image \(reference). Check the network; if it persists, this version's image may not be published (or not public) yet. Details: \(error)")
        }
        await removeOtherBeeboxImages(keeping: image.reference)
        return (image, true)
    }

    /// An app update pins a new image; drop the ones it replaced so the store
    /// does not grow with every release.
    private func removeOtherBeeboxImages(keeping reference: String) async {
        guard let images = try? await store.list() else { return }
        for old in images where old.reference != reference && Self.isBeebox(old.reference) {
            do {
                try await store.delete(reference: old.reference, performCleanup: true)
                appLog("removed replaced image \(old.reference)")
            } catch {
                appLog("could not remove \(old.reference): \(error)")
            }
        }
    }

    private static func isBeebox(_ reference: String) -> Bool {
        reference.contains("/beebox:") || reference.hasPrefix("beebox:")
    }

    /// Development: load the layout, replacing the stored copy when the layout
    /// holds a different digest (a rebuilt image).
    private func fromLayout(_ layout: URL) async throws -> (image: Containerization.Image, fetched: Bool) {
        let wanted = try Self.layoutDigest(layout)
        let reference = "beebox:dev"
        if let image = try? await store.get(reference: reference) {
            if image.digest == wanted { return (image, false) }
            appLog("image changed (\(image.digest) → \(wanted)); reloading")
            try await store.delete(reference: reference, performCleanup: true)
        }
        await report("Loading the beebox image…")
        guard let loaded = try await store.load(from: layout).first else {
            throw RuntimeError("no image in \(layout.path)")
        }
        let image = loaded.reference == reference ? loaded : try await store.tag(existing: loaded.reference, new: reference)
        await removeOtherBeeboxImages(keeping: reference)
        return (image, true)
    }

    private static func layoutDigest(_ layout: URL) throws -> String {
        struct Index: Decodable { struct Manifest: Decodable { let digest: String }; let manifests: [Manifest] }
        let index = try JSONDecoder().decode(Index.self, from: Data(contentsOf: layout.appending(path: "index.json")))
        guard let digest = index.manifests.first?.digest else { throw RuntimeError("no manifest in \(layout.path)") }
        return digest
    }
}

/// Turns the store's incremental progress events into "120 of 840 MB" lines,
/// at most one per whole percent.
private actor DownloadCounter {
    private var done: Int64 = 0
    private var total: Int64 = 0
    private var lastPercent = -1

    func add(_ events: [ProgressEvent]) -> String? {
        for event in events {
            switch event {
            case .addSize(let bytes): done += bytes
            case .addTotalSize(let bytes): total += bytes
            case .addItems, .addTotalItems: break
            }
        }
        guard total > 0 else { return nil }
        let percent = Int(done * 100 / total)
        guard percent != lastPercent else { return nil }
        lastPercent = percent
        return "Downloading Bee Box… \(done / 1_000_000) of \(total / 1_000_000) MB"
    }
}
