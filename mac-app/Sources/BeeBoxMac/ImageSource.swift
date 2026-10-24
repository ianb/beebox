import BeeBoxMacCore
import Containerization
import ContainerizationExtras
import ContainerizationOCI
import Foundation

/// Gets the beebox image into the app's store and keeps it current.
///
/// The app follows a channel: the moving registry tag `latest` (or
/// `BEEBOX_IMAGE_CHANNEL`). At each start it asks the registry which digest
/// the tag names, reads that image's labels, and lets `EngineUpdate.decide`
/// say whether to download it. Images are stored by digest and named by
/// role: `beebox:current` is what a start uses, `beebox:previous` is what the
/// last update replaced (kept until the next update succeeds), and
/// `beebox:failed` is an update that did not start. Promotion and rollback
/// are BoxRuntime's calls, made around its update record.
///
/// Two development paths bypass the channel: `BEEBOX_IMAGE` pulls one fixed
/// reference, and `BEEBOX_IMAGE_LAYOUT` loads a local OCI layout.
struct ImageSource {
    let store: ImageStore
    /// Reports a status line while downloading or loading.
    let report: @Sendable (String) async -> Void

    static let current = "beebox:current"
    static let previous = "beebox:previous"
    static let failed = "beebox:failed"
    static let dev = "beebox:dev"
    static let platform = Platform(arch: "arm64", os: "linux")

    /// The image to start with, and the downloaded update waiting to replace
    /// it, if any (BoxRuntime promotes it inside its update record).
    struct Selection {
        let image: Containerization.Image
        let candidate: Containerization.Image?
        /// What the check concluded, for Preferences; nil when no check ran
        /// (a development path, or a first download).
        let decision: EngineUpdate.Decision?
        /// Why the check did not run or did not complete.
        let checkFailure: String?
    }

    /// - Parameters:
    ///   - byRequest: the person pressed the check button; a known failed
    ///     digest is tried again.
    ///   - offline: start on `beebox:current` without asking the channel (the
    ///     restart after a rollback must not begin another update).
    func select(byRequest: Bool, offline: Bool = false) async throws -> Selection {
        if let layout = Paths.imageLayout {
            let image = try await fromLayout(layout)
            return Selection(image: image, candidate: nil, decision: nil, checkFailure: nil)
        }
        if let fixed = BundleConfig.imageOverride {
            let image = try await fixedReference(fixed)
            return Selection(image: image, candidate: nil, decision: nil, checkFailure: nil)
        }
        try await adoptTagPinnedImage()
        let current = try? await store.get(reference: Self.current)
        if offline {
            guard let current else { throw RuntimeError("no Bee Box image is downloaded") }
            return Selection(image: current, candidate: nil, decision: nil, checkFailure: nil)
        }
        let remote: EngineImageInfo
        do {
            remote = try await remoteInfo()
        } catch {
            guard let current else {
                // GitHub's registry answers 401, not 404, for an image that does
                // not exist or is not public, so say both.
                throw RuntimeError("could not reach the Bee Box image channel \(BundleConfig.channelReference). Check the network; if it persists, the channel may not be published (or not public). Details: \(error)")
            }
            appLog("engine check failed; staying on \(Self.describe(current)): \(error)")
            return Selection(image: current, candidate: nil, decision: nil, checkFailure: String(describing: error))
        }
        let failedDigest = (try? await store.get(reference: Self.failed))?.digest
        var currentInfo: EngineImageInfo?
        if let current { currentInfo = await info(current) }
        let decision = EngineUpdate.decide(
            current: currentInfo,
            failed: failedDigest,
            remote: remote,
            appVersion: BundleConfig.version,
            minEngineVersion: BundleConfig.minimumEngineVersion,
            byRequest: byRequest
        )
        appLog("engine check: channel \(BundleConfig.channel) names \(remote.version ?? "unlabeled") \(remote.digest.prefix(19)); \(decision)")
        guard case .update(let target) = decision else {
            guard let current else {
                throw RuntimeError("no Bee Box image is downloaded, and the channel's image cannot be used: \(Self.explain(decision))")
            }
            return Selection(image: current, candidate: nil, decision: decision, checkFailure: nil)
        }
        let pulled: Containerization.Image
        do {
            pulled = try await pull(digest: target.digest, version: target.version)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // A download that fails (network, disk) must not stop a box that
            // has an engine; the next start tries again.
            guard let current else { throw error }
            appLog("engine download failed; staying on \(Self.describe(current)): \(error)")
            return Selection(image: current, candidate: nil, decision: decision, checkFailure: String(describing: error))
        }
        guard pulled.digest == target.digest else {
            try? await store.delete(reference: pulled.reference, performCleanup: true)
            throw RuntimeError("the registry served \(pulled.digest) for \(target.digest); not using it")
        }
        guard let current else {
            // First download: nothing to roll back to, so it is current at once.
            let image = try await store.tag(existing: pulled.reference, new: Self.current)
            try await store.delete(reference: pulled.reference)
            await removeOtherBeeboxImages()
            return Selection(image: image, candidate: nil, decision: nil, checkFailure: nil)
        }
        return Selection(image: current, candidate: pulled, decision: decision, checkFailure: nil)
    }

    // MARK: Promotion and rollback (called by BoxRuntime around its record)

    /// `candidate` becomes current; what was current becomes previous.
    func promote(_ candidate: Containerization.Image) async throws {
        try? await store.delete(reference: Self.previous)
        _ = try await store.tag(existing: Self.current, new: Self.previous)
        _ = try await store.tag(existing: candidate.reference, new: Self.current)
        try await store.delete(reference: candidate.reference)
        await removeOtherBeeboxImages()
        appLog("engine promoted \(Self.describe(candidate))")
    }

    /// The digest `beebox:previous` names, or nil when there is none.
    func previousDigest() async -> String? {
        (try? await store.get(reference: Self.previous))?.digest
    }

    /// The current image failed to start: keep it as `beebox:failed` and put
    /// the previous one back. Any reset of the box happens before this, on
    /// the previous image, so a failed reset leaves the record and the
    /// references for the next start to settle.
    func rollBack() async throws {
        try? await store.delete(reference: Self.failed)
        _ = try await store.tag(existing: Self.current, new: Self.failed)
        _ = try await store.tag(existing: Self.previous, new: Self.current)
        try await store.delete(reference: Self.previous, performCleanup: true)
        appLog("engine rolled back to \(Self.describe(try await store.get(reference: Self.current)))")
    }

    /// The digest `beebox:current` names, or nil when there is none.
    func currentDigest() async -> String? {
        (try? await store.get(reference: Self.current))?.digest
    }

    /// The labels of a stored image, read from its config.
    func info(_ image: Containerization.Image) async -> EngineImageInfo {
        let labels = (try? await image.config(for: Self.platform))?.config?.labels ?? [:]
        return EngineImageInfo(digest: image.digest, version: labels[Self.versionLabel], minAppVersion: labels[Self.minAppLabel])
    }

    static let versionLabel = "org.opencontainers.image.version"
    static let minAppLabel = "run.beebox.min-app-version"

    // MARK: The registry

    /// What the channel names now: a HEAD for the digest, then the index,
    /// the arm64 manifest and its config, before any layer is downloaded.
    private func remoteInfo() async throws -> EngineImageInfo {
        let reference = BundleConfig.channelReference
        let ref = try Reference.parse(reference)
        guard let tag = ref.tag else { throw RuntimeError("the image channel \(reference) has no tag") }
        let client = try RegistryClient(reference: reference)
        let root = try await client.resolve(name: ref.path, tag: tag)
        let manifestDescriptor: Descriptor
        if root.mediaType == MediaTypes.index || root.mediaType == MediaTypes.dockerManifestList {
            let index: Index = try await client.fetch(name: ref.path, descriptor: root)
            guard let arm = index.manifests.first(where: { $0.platform == Self.platform }) else {
                throw RuntimeError("the channel's image \(root.digest) has no linux/arm64 build")
            }
            manifestDescriptor = arm
        } else {
            manifestDescriptor = root
        }
        let manifest: Manifest = try await client.fetch(name: ref.path, descriptor: manifestDescriptor)
        let config: ContainerizationOCI.Image = try await client.fetch(name: ref.path, descriptor: manifest.config)
        let labels = config.config?.labels ?? [:]
        return EngineImageInfo(digest: root.digest, version: labels[Self.versionLabel], minAppVersion: labels[Self.minAppLabel])
    }

    private func pull(digest: String, version: String?) async throws -> Containerization.Image {
        let reference = "\(BundleConfig.channelRepository)@\(digest)"
        if let already = try? await store.get(reference: reference) { return already }
        let label = version.map { "engine \($0)" } ?? "Bee Box"
        await report("Downloading \(label)…")
        // A start abandoned while the lookup or the report above ran (hosting
        // turned off) must not begin the download. Nothing awaits between this
        // check and the pull.
        try Task.checkCancellation()
        let counter = DownloadCounter(label: label)
        let report = self.report
        do {
            return try await store.pull(
                reference: reference,
                platform: Self.platform,
                progress: { events in
                    if let line = await counter.add(events) { await report(line) }
                }
            )
        } catch {
            throw RuntimeError("could not download \(label) (\(reference)). Check the network and free disk space (the previous engine stays until the new one starts). Details: \(error)")
        }
    }

    /// An app from before the channel stored the image under its own tag
    /// (`ghcr.io/ianb/beebox:0.1.6`). Make it current, so the first start of
    /// this app downloads nothing until the channel moves.
    private func adoptTagPinnedImage() async throws {
        if (try? await store.get(reference: Self.current)) != nil { return }
        guard let images = try? await store.list(),
              let old = images.first(where: { Self.isBeebox($0.reference) && !Self.roles.contains($0.reference) })
        else { return }
        _ = try await store.tag(existing: old.reference, new: Self.current)
        try await store.delete(reference: old.reference)
        appLog("adopted \(old.reference) as \(Self.current)")
    }

    private static let roles: Set<String> = [current, previous, failed, dev]

    /// Drop every beebox image that has no role, so the store does not grow
    /// with each update (a digest reference left by an interrupted promote,
    /// an old tag-pinned image).
    private func removeOtherBeeboxImages() async {
        guard let images = try? await store.list() else { return }
        for old in images where Self.isBeebox(old.reference) && !Self.roles.contains(old.reference) {
            do {
                try await store.delete(reference: old.reference, performCleanup: true)
                appLog("removed image \(old.reference)")
            } catch {
                appLog("could not remove \(old.reference): \(error)")
            }
        }
    }

    private static func isBeebox(_ reference: String) -> Bool {
        reference.contains("/beebox:") || reference.contains("/beebox@") || reference.hasPrefix("beebox:")
    }

    private static func describe(_ image: Containerization.Image) -> String {
        "\(image.reference) (\(image.digest.prefix(19)))"
    }

    static func explain(_ decision: EngineUpdate.Decision) -> String {
        switch decision {
        case .upToDate: "the engine is current"
        case .update(let to): "engine \(to.version ?? "?") is ready"
        case .needsNewerApp(let min): "the current engine needs Bee Box Desktop \(min) or newer"
        case .imageTooOld(let min): "this Bee Box Desktop needs engine \(min) or newer; the channel offers an older one"
        case .unlabeled: "the channel's image carries no version labels, so it cannot be checked"
        case .knownFailure: "the channel still offers the engine that failed to start here; Check for Engine Updates tries it again"
        case .downgrade(let to): "the channel offers engine \(to), older than the one in use; the box never moves back"
        }
    }

    // MARK: Development paths

    /// `BEEBOX_IMAGE`: one fixed reference, pulled when absent, never checked.
    private func fixedReference(_ reference: String) async throws -> Containerization.Image {
        if let image = try? await store.get(reference: reference) { return image }
        await report("Downloading \(reference)…")
        try Task.checkCancellation()
        let counter = DownloadCounter(label: reference)
        let report = self.report
        return try await store.pull(reference: reference, platform: Self.platform) { events in
            if let line = await counter.add(events) { await report(line) }
        }
    }

    /// Load the layout, replacing the stored copy when the layout holds a
    /// different digest (a rebuilt image).
    private func fromLayout(_ layout: URL) async throws -> Containerization.Image {
        let wanted = try Self.layoutDigest(layout)
        let reference = Self.dev
        if let image = try? await store.get(reference: reference) {
            if image.digest == wanted { return image }
            appLog("image changed (\(image.digest) → \(wanted)); reloading")
            try await store.delete(reference: reference, performCleanup: true)
        }
        await report("Loading the beebox image…")
        guard let loaded = try await store.load(from: layout).first else {
            throw RuntimeError("no image in \(layout.path)")
        }
        return loaded.reference == reference ? loaded : try await store.tag(existing: loaded.reference, new: reference)
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
    private let label: String
    private var done: Int64 = 0
    private var total: Int64 = 0
    private var lastPercent = -1

    init(label: String) { self.label = label }

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
        return "Downloading \(label)… \(done / 1_000_000) of \(total / 1_000_000) MB"
    }
}
