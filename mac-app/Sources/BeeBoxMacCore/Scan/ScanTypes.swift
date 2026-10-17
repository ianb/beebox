import Foundation

/// What happens to a file once the box has confirmed it. `rejected` files are
/// never dispositioned. Names match the `disposition` values in the Node
/// uploader's config.
public enum UploadDisposition: String, Codable, Sendable, CaseIterable {
    case keep
    case archive
    case trash
}

/// One watched folder and the box it uploads to.
public struct UploadTarget: Sendable {
    public var folder: URL
    /// The box's scan root, including the box slug and any mount prefix, for
    /// example `https://host.example/family`. Routes are `<baseURL>/api/scan/...`.
    public var baseURL: URL
    public var scanToken: String
    public var disposition: UploadDisposition

    public init(folder: URL, baseURL: URL, scanToken: String, disposition: UploadDisposition) {
        self.folder = folder
        self.baseURL = baseURL
        self.scanToken = scanToken
        self.disposition = disposition
    }
}

/// A condition a person must see until it clears. Per-file problems are counts
/// in `SweepSummary`, not problems.
public enum SweepProblem: Equatable, Sendable {
    /// The folder cannot be listed: renamed, unmounted, or permission removed.
    case folderMissing
    /// The box answered 401: the scan token is revoked or wrong.
    case credentialRefused
    /// The request never got an HTTP answer.
    case boxUnreachable(URLError.Code)
    /// The box answered 503 to the check route (for example, not annex-converted).
    case boxUnavailable
    /// The box answered 429 and the retries ran out.
    case rateLimited(retryAfterSeconds: Int)
}

public struct SweepSummary: Equatable, Sendable {
    public var uploaded = 0
    public var duplicate = 0
    public var rejected = 0
    /// The subset of `rejected` the box first refused during this sweep, as
    /// opposed to a refusal it already remembered. Notify on this, not on
    /// `rejected`, which stays at 1 on every sweep while a refused file waits.
    public var rejectedOnUpload = 0
    public var skippedUnsettled = 0
    public var skippedIdentityChanged = 0
    public var errors = 0
    /// File names behind `rejectedOnUpload`, for one notification.
    public var rejectedFileNames: [String] = []
    /// The contract version the box reported, if it reported one and the sweep
    /// reached it.
    public var contractVersion: Int?
    public var standingProblem: SweepProblem?

    public init(
        uploaded: Int = 0,
        duplicate: Int = 0,
        rejected: Int = 0,
        rejectedOnUpload: Int = 0,
        skippedUnsettled: Int = 0,
        skippedIdentityChanged: Int = 0,
        errors: Int = 0,
        rejectedFileNames: [String] = [],
        contractVersion: Int? = nil,
        standingProblem: SweepProblem? = nil
    ) {
        self.uploaded = uploaded
        self.duplicate = duplicate
        self.rejected = rejected
        self.rejectedOnUpload = rejectedOnUpload
        self.skippedUnsettled = skippedUnsettled
        self.skippedIdentityChanged = skippedIdentityChanged
        self.errors = errors
        self.rejectedFileNames = rejectedFileNames
        self.contractVersion = contractVersion
        self.standingProblem = standingProblem
    }

    /// Sums two rounds the way `run-all.ts` does: counts add, the contract
    /// version is the later observation unless that round made no request.
    /// Combines a settle-retry round with the rounds before it. Each round
    /// re-walks the whole folder, so what happened (uploads, new refusals,
    /// errors) adds up, while what the folder holds (duplicates, refused files
    /// waiting there, unsettled files) is the later round's observation. Summing
    /// those would report one refused file as two after one retry. (The Node
    /// runner sums everything; its counts are only printed, never shown as a
    /// standing status.)
    func adding(_ later: SweepSummary) -> SweepSummary {
        SweepSummary(
            uploaded: uploaded + later.uploaded,
            duplicate: later.duplicate,
            rejected: later.rejected,
            rejectedOnUpload: rejectedOnUpload + later.rejectedOnUpload,
            skippedUnsettled: later.skippedUnsettled,
            skippedIdentityChanged: skippedIdentityChanged + later.skippedIdentityChanged,
            errors: errors + later.errors,
            rejectedFileNames: rejectedFileNames + later.rejectedFileNames,
            contractVersion: later.contractVersion ?? contractVersion,
            standingProblem: later.standingProblem ?? standingProblem
        )
    }
}
