import BeeBoxShared
import Foundation

/// One sweep of one upload folder, including the settle-retry rounds.
///
/// Ports `run-target.ts` (walk, settle gate, identity snapshot, hash, batch
/// check, PUT unknowns, restat before disposition) and the retry policy in
/// `run-all.ts`. See "Client obligations" in docs/scan-upload-contract.md.
public struct ScanSweep: Sendable {
    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    /// A run comes back for files the settle gate skipped: up to three more
    /// rounds, each after the settle window plus two seconds.
    static let maxSettleRetries = 3
    static let settleRetryWait: Duration = .seconds(ScanFiles.settleWindow + 2)
    static let maxRateLimitRetries = 5

    private let transport: any HTTPTransport
    private let clientBuild: String
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async -> Void
    private let trash: @Sendable (URL) throws -> Void

    /// - Parameter clientBuild: the full `x-scan-client-build` value, `mac-<app version>`.
    public init(
        transport: any HTTPTransport,
        clientBuild: String,
        now: @escaping @Sendable () -> Date,
        sleep: @escaping @Sendable (Duration) async -> Void
    ) {
        self.init(
            transport: transport,
            clientBuild: clientBuild,
            now: now,
            sleep: sleep,
            trash: { try FileManager.default.trashItem(at: $0, resultingItemURL: nil) }
        )
    }

    /// Tests pass a `trash` that records instead of moving files into the
    /// developer's Trash.
    init(
        transport: any HTTPTransport,
        clientBuild: String,
        now: @escaping @Sendable () -> Date,
        sleep: @escaping @Sendable (Duration) async -> Void,
        trash: @escaping @Sendable (URL) throws -> Void
    ) {
        self.transport = transport
        self.clientBuild = clientBuild
        self.now = now
        self.sleep = sleep
        self.trash = trash
    }

    public func run(_ target: UploadTarget, retryRejected: Bool) async -> SweepSummary {
        var total = SweepSummary()
        var round = 0
        while true {
            let summary = await sweepOnce(target, retryRejected: retryRejected)
            total = round == 0 ? summary : total.adding(summary)
            // A sweep that stopped on a standing problem is not retried: it
            // would meet the same answer, and the next trigger tries again.
            if summary.standingProblem != nil || summary.skippedUnsettled == 0 || round >= Self.maxSettleRetries {
                return total
            }
            await sleep(Self.settleRetryWait)
            round += 1
        }
    }

    // MARK: - One round

    private struct Candidate {
        let url: URL
        let identity: FileIdentity
        let hash: String
    }

    private func sweepOnce(_ target: UploadTarget, retryRejected: Bool) async -> SweepSummary {
        var summary = SweepSummary()
        let wire = ScanWire(transport: transport, baseURL: target.baseURL, token: target.scanToken, clientBuild: clientBuild)

        let candidates: [Candidate]
        do {
            candidates = try collectCandidates(in: target.folder, summary: &summary)
        } catch {
            summary.standingProblem = .folderMissing
            return summary
        }
        if candidates.isEmpty { return summary }

        let states: [String: CheckResult]
        do {
            let checked = try await checkAll(wire, hashes: candidates.map(\.hash))
            states = checked.states
            summary.contractVersion = checked.contractVersion
        } catch {
            record(error, in: &summary)
            return summary
        }

        for candidate in candidates {
            let proceed = await process(
                candidate,
                checkResult: states[candidate.hash],
                target: target,
                wire: wire,
                retryRejected: retryRejected,
                summary: &summary
            )
            if !proceed { break }
        }
        return summary
    }

    private func collectCandidates(in folder: URL, summary: inout SweepSummary) throws -> [Candidate] {
        let files = try ScanFiles.candidateFiles(in: folder)
        let now = now()
        var candidates: [Candidate] = []
        for url in files {
            // Identity is snapshotted before hashing: hashing reads the whole
            // file, and the scanner may still touch it meanwhile.
            guard let identity = FileIdentity.snapshot(url) else { continue }
            if !ScanFiles.isSettled(identity, now: now) {
                summary.skippedUnsettled += 1
                continue
            }
            guard let hash = try? ScanFiles.sha256Hex(of: url) else {
                summary.errors += 1
                continue
            }
            candidates.append(Candidate(url: url, identity: identity, hash: hash))
        }
        return candidates
    }

    private func checkAll(
        _ wire: ScanWire,
        hashes: [String]
    ) async throws(WireFailure) -> (states: [String: CheckResult], contractVersion: Int?) {
        var seen = Set<String>()
        let unique = hashes.filter { seen.insert($0).inserted }
        var states: [String: CheckResult] = [:]
        var contractVersion: Int?
        var start = 0
        while start < unique.count {
            let batch = Array(unique[start ..< min(start + ScanWire.checkBatchLimit, unique.count)])
            let response = try await wire.check(batch)
            states.merge(response.states) { _, new in new }
            contractVersion = response.contractVersion ?? contractVersion
            start += ScanWire.checkBatchLimit
        }
        return (states, contractVersion)
    }

    /// Returns false when the sweep must stop.
    private func process(
        _ candidate: Candidate,
        checkResult: CheckResult?,
        target: UploadTarget,
        wire: ScanWire,
        retryRejected: Bool,
        summary: inout SweepSummary
    ) async -> Bool {
        let state = checkResult?.state ?? .unknown
        if state == .rejected && !retryRejected {
            summary.rejected += 1
            return true
        }

        let freshUpload: Bool
        switch state {
        case .pending, .imported:
            freshUpload = false
        case .unknown, .rejected:
            guard let body = try? Data(contentsOf: candidate.url) else {
                summary.errors += 1
                return true
            }
            let result: PutResult
            do {
                result = try await putWithRetry(wire, candidate: candidate, body: body)
            } catch {
                record(error, in: &summary)
                return false
            }
            switch result {
            case .accepted:
                freshUpload = true
            case .duplicate:
                freshUpload = false
            case .rejected:
                summary.rejected += 1
                // Newly learned only if the box did not already know: under
                // retryRejected a remembered rejection is refused again, which
                // is the same fact a second time.
                if state != .rejected {
                    summary.rejectedOnUpload += 1
                    summary.rejectedFileNames.append(candidate.url.lastPathComponent)
                }
                return true
            case .hashMismatch, .tooLarge, .serverError:
                summary.errors += 1
                return true
            case .rateLimited:
                // putWithRetry never returns this; it throws once retries run out.
                summary.errors += 1
                return true
            }
        }

        if freshUpload { summary.uploaded += 1 } else { summary.duplicate += 1 }
        dispositionIfUnchanged(candidate, disposition: target.disposition, summary: &summary)
        return true
    }

    private func putWithRetry(
        _ wire: ScanWire,
        candidate: Candidate,
        body: Data
    ) async throws(WireFailure) -> PutResult {
        var lastRetryAfter = ScanWire.defaultRetryAfterSeconds
        for attempt in 0 ..< Self.maxRateLimitRetries {
            let result = try await wire.put(hash: candidate.hash, filename: candidate.url.lastPathComponent, body: body)
            guard case let .rateLimited(seconds) = result else { return result }
            lastRetryAfter = seconds
            if attempt < Self.maxRateLimitRetries - 1 {
                await sleep(.seconds(seconds))
            }
        }
        throw .rateLimited(retryAfterSeconds: lastRetryAfter)
    }

    /// Restat before any disposition: if the file is not the one that was
    /// hashed and confirmed, leave it.
    private func dispositionIfUnchanged(_ candidate: Candidate, disposition: UploadDisposition, summary: inout SweepSummary) {
        guard let current = FileIdentity.snapshot(candidate.url), current == candidate.identity else {
            summary.skippedIdentityChanged += 1
            return
        }
        do {
            try ScanFiles.apply(disposition, to: candidate.url, trash: trash)
        } catch {
            // The file stays; the next sweep finds it confirmed and tries again.
            summary.errors += 1
        }
    }

    private func record(_ failure: WireFailure, in summary: inout SweepSummary) {
        switch failure {
        case let .transport(code): summary.standingProblem = .boxUnreachable(code)
        case .credentialRefused: summary.standingProblem = .credentialRefused
        case .unavailable: summary.standingProblem = .boxUnavailable
        case let .rateLimited(seconds): summary.standingProblem = .rateLimited(retryAfterSeconds: Int(seconds.rounded(.up)))
        case .protocolViolation: summary.errors += 1
        }
    }
}
