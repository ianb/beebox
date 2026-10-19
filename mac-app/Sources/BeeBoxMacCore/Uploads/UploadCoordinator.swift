import BeeBoxShared
import Combine
import Foundation
import os

/// One sweep of one folder; `ScanSweep` in the app, a fake in tests.
public protocol FolderSweeping: Sendable {
    func run(_ target: UploadTarget, retryRejected: Bool) async -> SweepSummary
}

extension ScanSweep: FolderSweeping {}

/// Exports new photos from an album into its upload folder before the sweep.
public protocol PhotosExporting: Sendable {
    /// The number of photos written, or a person-readable reason it could not run.
    func export(album: PhotosAlbumRef, into folder: URL) async -> Result<Int, PhotosExportProblem>
}

public enum PhotosExportProblem: Error, Equatable, Sendable {
    case accessDenied
    case albumMissing
    case failed(String)
}

/// Why a folder is not uploading, held until a sweep clears it.
public enum FolderProblem: Error, Equatable, Sendable {
    case sweep(SweepProblem)
    case boxMissing
    case boxNotPaired
    case deviceRefused
    case pairedByNobody
    case scanTokenUnavailable(String)
    case credentialNotSaved
    case oldUploaderWatching
    case photos(PhotosExportProblem)

    public var message: String {
        switch self {
        case .sweep(.folderMissing): "The folder is missing or cannot be read."
        case .sweep(.credentialRefused): "The box refused the scanner credential. Reconnect to make a new one."
        case .sweep(.boxUnreachable(let code)): "Could not reach the box (error \(code.rawValue))."
        case .sweep(.boxUnavailable): "The box cannot take scans right now."
        case .sweep(.rateLimited(let seconds)): "The box asked to wait \(seconds) s before more uploads."
        case .boxMissing: "Its box is no longer paired."
        case .boxNotPaired: "Pair this Mac with the box first."
        case .deviceRefused: "The box no longer accepts this Mac. Pair again."
        case .pairedByNobody: "The box does not know who paired this Mac. Remove the box, then pair again."
        case .scanTokenUnavailable(let detail): "Could not set up the scanner credential: \(detail)"
        case .credentialNotSaved: "Could not save the scanner credential in the Keychain."
        case .oldUploaderWatching: "The command-line uploader already watches this folder. Remove it with `bin/scan-uploader schedule uninstall` first."
        case .photos(.accessDenied): "Bee Box Desktop has no access to Photos. Allow it in System Settings → Privacy & Security → Photos."
        case .photos(.albumMissing): "The Photos album is gone."
        case .photos(.failed(let detail)): "Photos export failed: \(detail)"
        }
    }
}

public struct FolderStatus: Equatable, Sendable {
    public var lastSweepAt: Date?
    public var lastSentAt: Date?
    public var totalSent = 0
    public var rejectedInFolder = 0
    /// Files the last sweep could not send (too large, a server error); they
    /// stay in the folder and are tried again.
    public var failedInFolder = 0
    public var problem: FolderProblem?
}

/// What a sweep learned that a person should hear about once.
public struct UploadNotice: Equatable, Sendable {
    public var folderName: String
    public var boxLabel: String
    public var uploaded: Int
    public var newlyRejected: [String]
}

public enum FolderRemoval: Equatable, Sendable {
    case removed
    /// The scan token could not be revoked; nothing was removed.
    case revokeFailed(String)
}

/// Runs upload sweeps for every folder, one at a time, and keeps each folder's
/// status. The app decides when (folder events, a timer, wake, launch).
@MainActor
public final class UploadCoordinator: ObservableObject {
    @Published public private(set) var statuses: [UploadFolder.ID: FolderStatus] = [:]
    /// True while a sweep runs; settings that a sweep reads are locked then.
    @Published public private(set) var isSweeping = false

    private let folders: UploadFolderStore
    private let boxes: BoxStore
    private let scanTokens: any PairedBoxCredentialStoreProtocol
    private let tokenClient: ScanTokenClient
    private let sweeper: any FolderSweeping
    private let photos: (any PhotosExporting)?
    private let hostName: String
    private let oldUploaderPlist: URL
    private let now: () -> Date
    private let notify: (UploadNotice) -> Void
    private var sweepAgain = false
    /// A box that answered 429 is not asked again before this time, whatever
    /// triggers the next sweep.
    private var notBefore: [PairedBox.ID: Date] = [:]
    private let log = MacLogger(category: "uploads")

    public init(
        folders: UploadFolderStore,
        boxes: BoxStore,
        scanTokens: any PairedBoxCredentialStoreProtocol,
        tokenClient: ScanTokenClient,
        sweeper: any FolderSweeping,
        photos: (any PhotosExporting)?,
        hostName: String,
        oldUploaderPlist: URL,
        now: @escaping () -> Date,
        notify: @escaping (UploadNotice) -> Void
    ) {
        self.folders = folders
        self.boxes = boxes
        self.scanTokens = scanTokens
        self.tokenClient = tokenClient
        self.sweeper = sweeper
        self.photos = photos
        self.hostName = hostName
        self.oldUploaderPlist = oldUploaderPlist
        self.now = now
        self.notify = notify
    }

    public var hasStandingProblem: Bool {
        statuses.values.contains { $0.problem != nil }
    }

    /// Sweeps every folder. A call while a sweep runs schedules one more pass
    /// after it instead of running two at once.
    public func sweepAll() async {
        if isSweeping {
            sweepAgain = true
            return
        }
        isSweeping = true
        defer { isSweeping = false }
        repeat {
            sweepAgain = false
            for folder in folders.folders {
                await sweep(folder)
            }
        } while sweepAgain
    }

    /// Adds a folder after checking for the old uploader, and sets up the box's
    /// scan token if it has none.
    public func addFolder(
        path: String,
        box: PairedBox,
        disposition: UploadDisposition,
        photosAlbum: PhotosAlbumRef? = nil
    ) async -> FolderProblem? {
        if OldUploaderCheck.conflicts(folderPath: path, plistURL: oldUploaderPlist) {
            log.warning("watched folder refused reason=old-uploader folder=\(URL(filePath: path).lastPathComponent)")
            return .oldUploaderWatching
        }
        if case .failure(let problem) = await ensureScanToken(for: box) {
            return problem
        }
        let folder = UploadFolder(id: UUID(), folderPath: path, boxID: box.id, disposition: disposition, photosAlbum: photosAlbum)
        guard folders.add(folder) else { return .credentialNotSaved }
        log.info("watched folder added folder=\(folder.folder.lastPathComponent) box=\(box.displayHost) after=\(disposition.rawValue) photos=\(photosAlbum != nil)")
        await sweepAll()
        return nil
    }

    /// Removes a folder. When it is the box's last one, the box's scan token
    /// is revoked first; a failed revoke removes nothing unless `force`.
    public func removeFolder(_ folder: UploadFolder, force: Bool) async -> FolderRemoval {
        let last = folders.folders(forBox: folder.boxID).count == 1
        if last, !force, let failure = await revokeScanToken(forBox: folder.boxID) {
            return .revokeFailed(failure)
        }
        guard folders.remove(folder) else {
            return .revokeFailed("The upload settings could not be saved, so the folder is still watched.")
        }
        if last {
            forgetScanToken(forBox: folder.boxID)
        }
        statuses[folder.id] = nil
        log.info("watched folder removed folder=\(folder.folder.lastPathComponent) force=\(force)")
        return .removed
    }

    /// Removes a box's folders (revoking its scan token), then the box.
    public func removeBox(_ box: PairedBox, force: Bool) async -> FolderRemoval {
        if !folders.folders(forBox: box.id).isEmpty || scanTokens.readToken(for: box.id) != nil {
            if !force, let failure = await revokeScanToken(forBox: box.id) {
                return .revokeFailed(failure)
            }
            forgetScanToken(forBox: box.id)
            for folder in folders.folders(forBox: box.id) {
                folders.remove(folder)
                statuses[folder.id] = nil
            }
        }
        do {
            try boxes.remove(box)
        } catch {
            return .revokeFailed("Could not remove the box: \(error.localizedDescription)")
        }
        return .removed
    }

    /// Replaces a refused scan token: revoke the old name (best effort; the
    /// box may have revoked it already), then mint a new one.
    public func reconnect(box: PairedBox) async -> FolderProblem? {
        if let failure = await revokeScanToken(forBox: box.id) {
            log.warning("reconnect: old scan token not revoked: \(failure)")
        }
        forgetScanToken(forBox: box.id)
        if case .failure(let problem) = await ensureScanToken(for: box) {
            return problem
        }
        await sweepAll()
        return nil
    }

    private func sweep(_ folder: UploadFolder) async {
        var status = statuses[folder.id] ?? FolderStatus()
        defer { statuses[folder.id] = status }
        guard let box = boxes.boxes.first(where: { $0.id == folder.boxID }) else {
            status.problem = .boxMissing
            return
        }
        if let wait = notBefore[box.id], now() < wait {
            return
        }
        guard let scanToken = scanTokens.readToken(for: box.id) else {
            status.problem = boxes.token(for: box) == nil ? .boxNotPaired : .scanTokenUnavailable("no scanner credential on this Mac")
            return
        }
        var photosProblem: PhotosExportProblem?
        if let album = folder.photosAlbum, let photos {
            // A failed export still sweeps: the folder may hold earlier exports.
            if case .failure(let problem) = await photos.export(album: album, into: folder.folder) {
                photosProblem = problem
            }
        }
        let target = UploadTarget(folder: folder.folder, baseURL: box.baseURL, scanToken: scanToken, disposition: folder.disposition)
        let summary = await sweeper.run(target, retryRejected: false)
        status.lastSweepAt = now()
        status.rejectedInFolder = summary.rejected
        status.failedInFolder = summary.errors
        if case .rateLimited(let seconds) = summary.standingProblem {
            notBefore[box.id] = now().addingTimeInterval(TimeInterval(seconds))
        }
        if summary.uploaded > 0 {
            status.lastSentAt = now()
            status.totalSent += summary.uploaded
        }
        let problem = summary.standingProblem.map(FolderProblem.sweep) ?? photosProblem.map(FolderProblem.photos)
        if problem != status.problem {
            if let problem {
                log.warning("watched folder problem folder=\(folder.folder.lastPathComponent) problem=\(String(describing: problem))")
            } else if status.problem != nil {
                log.info("watched folder problem cleared folder=\(folder.folder.lastPathComponent)")
            }
        }
        if summary.uploaded > 0 || summary.rejectedOnUpload > 0 || summary.errors > 0 || summary.skippedIdentityChanged > 0 {
            log.info("sweep folder=\(folder.folder.lastPathComponent) box=\(box.displayHost) uploaded=\(summary.uploaded) duplicate=\(summary.duplicate) rejected=\(summary.rejected) newlyRejected=\(summary.rejectedOnUpload) failed=\(summary.errors) unsettled=\(summary.skippedUnsettled) changed=\(summary.skippedIdentityChanged)")
        }
        status.problem = problem
        if summary.uploaded > 0 || !summary.rejectedFileNames.isEmpty {
            notify(UploadNotice(
                folderName: folder.folder.lastPathComponent,
                boxLabel: box.label,
                uploaded: summary.uploaded,
                newlyRejected: summary.rejectedFileNames
            ))
        }
    }

    private func ensureScanToken(for box: PairedBox) async -> Result<Void, FolderProblem> {
        if scanTokens.readToken(for: box.id) != nil { return .success(()) }
        guard let deviceToken = boxes.token(for: box) else { return .failure(.boxNotPaired) }
        // A name recorded with no token in the Keychain is left from an attempt
        // that stopped after recording it (a crash, or a revoke that failed).
        // Revoke it before replacing it; a name that was never minted is a
        // no-op (404).
        if let failure = await revokeScanToken(forBox: box.id) {
            return .failure(.scanTokenUnavailable(failure))
        }
        // The name is recorded before the mint, so a crash after the mint still
        // leaves this Mac able to revoke it.
        let name = ScanTokenClient.newTokenName(host: hostName, now: now(), random: UUID().uuidString.lowercased())
        guard folders.setScanTokenName(name, forBox: box.id) else { return .failure(.credentialNotSaved) }
        let token: String
        do {
            token = try await tokenClient.mint(baseURL: box.baseURL, deviceToken: deviceToken, name: name)
        } catch {
            folders.setScanTokenName(nil, forBox: box.id)
            return .failure(problem(for: error, box: box))
        }
        do {
            try scanTokens.writeToken(token, for: box.id)
            guard scanTokens.readToken(for: box.id) == token else { throw PairedBoxCredentialStore.Error.missingToken }
        } catch {
            // The box holds a token this Mac cannot use; take it back.
            log.error("scan token keychain write failed; revoking name=\(name)")
            if await revokeAfterFailedSave(box: box, deviceToken: deviceToken, name: name) {
                forgetScanToken(forBox: box.id)
            }
            return .failure(.credentialNotSaved)
        }
        log.info("scan token minted name=\(name)")
        return .success(())
    }

    /// The box holds a token this Mac could not keep; take it back. A failure
    /// leaves it listed by name in the box's Settings → Scan uploaders.
    /// False when the revoke failed; the name then stays recorded, so removing
    /// the box later tries again.
    private func revokeAfterFailedSave(box: PairedBox, deviceToken: String, name: String) async -> Bool {
        do {
            try await tokenClient.revoke(baseURL: box.baseURL, deviceToken: deviceToken, name: name)
            return true
        } catch {
            log.error("unsaved scan token not revoked name=\(name) error=\(String(describing: error))")
            return false
        }
    }

    /// For uninstall: revokes every scan token this Mac minted. Returns a line
    /// per token it could not revoke, naming the box and the token, so the
    /// person can revoke it in the box's Settings → Scan uploaders.
    public func revokeAllScanTokens() async -> [String] {
        var failures: [String] = []
        for (boxID, name) in folders.scanTokenNames {
            if let failure = await revokeScanToken(forBox: boxID) {
                let label = boxes.boxes.first { $0.id == boxID }?.label ?? "a box"
                failures.append("\(name) on \(label): \(failure)")
            }
        }
        return failures
    }

    private func forgetScanToken(forBox boxID: UUID) {
        do {
            try scanTokens.deleteToken(for: boxID)
        } catch {
            log.error("scan token keychain delete failed box=\(boxID)")
        }
        folders.setScanTokenName(nil, forBox: boxID)
    }

    /// Nil on success (or nothing to revoke); otherwise a reason to show.
    private func revokeScanToken(forBox boxID: UUID) async -> String? {
        guard let name = folders.scanTokenNames[boxID] else { return nil }
        guard let box = boxes.boxes.first(where: { $0.id == boxID }), let deviceToken = boxes.token(for: box) else {
            return "This Mac is no longer paired with the box, so it cannot revoke the scanner credential \(name). Revoke it in the box's Settings → Scan uploaders."
        }
        do {
            try await tokenClient.revoke(baseURL: box.baseURL, deviceToken: deviceToken, name: name)
            return nil
        } catch {
            return "Could not revoke the scanner credential \(name): \(problem(for: error, box: box).message)"
        }
    }

    private func problem(for error: ScanTokenError, box: PairedBox) -> FolderProblem {
        log.warning("scan token request failed host=\(box.displayHost) error=\(error)")
        switch error {
        case .pairedByNobody:
            return .pairedByNobody
        case .deviceRefused:
            boxes.markCredentialRefused(box)
            return .deviceRefused
        case .transport(let code):
            return .sweep(.boxUnreachable(code))
        case .rejected(let status, let message):
            return .scanTokenUnavailable("HTTP \(status)" + (message.map { " \($0)" } ?? ""))
        case .malformedResponse:
            return .scanTokenUnavailable("unexpected answer from the box")
        }
    }
}
