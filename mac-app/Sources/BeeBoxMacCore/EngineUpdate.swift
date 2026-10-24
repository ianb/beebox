import Foundation

/// A version of the app or of the engine image: `MAJOR.MINOR.PATCH` with an
/// optional pre-release suffix (`0.1.7-main.20261024.abc1234`). The same
/// grammar as the repository's `v*` tags and the image workflow's stamps.
/// Pre-release sorts below the release it names and above the one before it,
/// as in semver; two pre-releases of one version compare by their suffix text.
public struct EngineVersion: Equatable, Comparable, CustomStringConvertible, Sendable {
    public let major: Int
    public let minor: Int
    public let patch: Int
    public let preRelease: String?

    public init?(_ text: String) {
        let trimmed = text.hasPrefix("v") ? String(text.dropFirst()) : text
        let dash = trimmed.firstIndex(of: "-")
        let core = dash.map { String(trimmed[..<$0]) } ?? trimmed
        let suffix = dash.map { String(trimmed[trimmed.index(after: $0)...]) }
        let parts = core.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let major = Int(parts[0]), let minor = Int(parts[1]), let patch = Int(parts[2]),
              major >= 0, minor >= 0, patch >= 0
        else { return nil }
        if let suffix, suffix.isEmpty || suffix.contains(where: { $0.isWhitespace }) { return nil }
        self.major = major
        self.minor = minor
        self.patch = patch
        self.preRelease = suffix
    }

    public var description: String {
        "\(major).\(minor).\(patch)" + (preRelease.map { "-\($0)" } ?? "")
    }

    public static func < (lhs: EngineVersion, rhs: EngineVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        switch (lhs.preRelease, rhs.preRelease) {
        case (nil, nil): return false
        case (.some, nil): return true
        case (nil, .some): return false
        case (.some(let l), .some(let r)): return l < r
        }
    }
}

/// What an engine image says about itself: its digest and the two labels the
/// Dockerfile writes (`org.opencontainers.image.version`,
/// `run.beebox.min-app-version`). A label is nil when the image has none.
public struct EngineImageInfo: Equatable, Sendable {
    public let digest: String
    public let version: String?
    public let minAppVersion: String?

    public init(digest: String, version: String?, minAppVersion: String?) {
        self.digest = digest
        self.version = version
        self.minAppVersion = minAppVersion
    }
}

/// Whether to move the box to the image the channel names now. Pure, so the
/// cases are testable without a registry or a VM.
public enum EngineUpdate {
    public enum Decision: Equatable, Sendable {
        /// The channel names the image already in use.
        case upToDate
        /// Download `remote` and use it at this start.
        case update(to: EngineImageInfo)
        /// The image needs a newer Bee Box Desktop; keep the current image.
        case needsNewerApp(min: String)
        /// This app needs a newer image than the channel offers; keep current.
        case imageTooOld(min: String)
        /// The image carries no readable version or minimum; keep current.
        case unlabeled
        /// The channel still names an image that failed to start here. An
        /// automatic check leaves it alone; a check the person asked for
        /// tries it again.
        case knownFailure(digest: String)
    }

    /// - Parameters:
    ///   - current: the image in use (`beebox:current`), or nil before the first download.
    ///   - failed: the digest of the image that last failed to start here, if any.
    ///   - remote: what the channel names now.
    ///   - appVersion: this app's `CFBundleShortVersionString`.
    ///   - minEngineVersion: the oldest image this app can run.
    ///   - byRequest: the person pressed the check button, as opposed to an automatic check at start.
    public static func decide(
        current: EngineImageInfo?,
        failed: String?,
        remote: EngineImageInfo,
        appVersion: String,
        minEngineVersion: String,
        byRequest: Bool
    ) -> Decision {
        if let current, current.digest == remote.digest { return .upToDate }
        guard let remoteVersion = remote.version.flatMap(EngineVersion.init),
              let minApp = remote.minAppVersion.flatMap(EngineVersion.init)
        else {
            // Nothing downloaded yet: take what the channel names, labels or
            // not, as the tag-pinned app did. The check protects an image in
            // use; it cannot leave a new install with no image at all.
            return current == nil ? .update(to: remote) : .unlabeled
        }
        // A development build ("dev") runs anything; it is never released.
        if let app = EngineVersion(appVersion), app < minApp { return .needsNewerApp(min: minApp.description) }
        if let minEngine = EngineVersion(minEngineVersion), remoteVersion < minEngine {
            return .imageTooOld(min: minEngine.description)
        }
        if let failed, failed == remote.digest, !byRequest { return .knownFailure(digest: failed) }
        return .update(to: remote)
    }
}

/// What a start does with an update record left by an earlier start: the
/// record is written before the image references change (see BoxRuntime), so
/// the references say how far that update got.
public struct UpdateRecord: Codable, Equatable, Sendable {
    /// The image in use before the update (`beebox:current` at the time).
    public var previousDigest: String
    /// The image the update moved to.
    public var candidateDigest: String
    /// The box's git HEAD before the update began; the tree was clean.
    public var boxHead: String
    public var startedAt: Date

    public init(previousDigest: String, candidateDigest: String, boxHead: String, startedAt: Date) {
        self.previousDigest = previousDigest
        self.candidateDigest = candidateDigest
        self.boxHead = boxHead
        self.startedAt = startedAt
    }

    public enum Recovery: Equatable, Sendable {
        /// The app quit before the references changed: forget the record.
        case discardRecord
        /// The update's start never finished: put the previous image back,
        /// keep the failed one as `beebox:failed`, and reset the box to
        /// `boxHead` when its tree moved or is dirty.
        case rollBack(resetBox: Bool)
        /// The store does not match the record; stop and say so.
        case stop(reason: String)
    }

    /// - Parameters:
    ///   - currentDigest: the digest `beebox:current` names now, or nil when absent.
    ///   - previousExists: whether `beebox:previous` exists.
    ///   - boxHead: the box's HEAD now.
    ///   - boxClean: whether `git status --porcelain` is empty now.
    public func recovery(currentDigest: String?, previousExists: Bool, boxHead: String, boxClean: Bool) -> Recovery {
        if currentDigest == previousDigest { return .discardRecord }
        guard currentDigest == candidateDigest else {
            return .stop(reason: "the image store names \(currentDigest ?? "no image") as current; the update record expected \(previousDigest) or \(candidateDigest)")
        }
        guard previousExists else {
            return .stop(reason: "the previous image \(previousDigest) is no longer in the store")
        }
        return .rollBack(resetBox: boxHead != self.boxHead || !boxClean)
    }
}
