import BeeBoxShared
import Combine
import Foundation
import os

/// What happened to one pairing attempt.
public enum PairResult: Equatable, Sendable {
    case paired(PairedBox)
    /// This app is redeeming, or already stored, the same ticket.
    case duplicate
    /// Plain http to an address outside the local network; nothing was sent.
    case refusedTransport
    /// The link carries no pairing ticket. The Mac never accepts a device token
    /// in a link (that shortcut is a DEBUG-only iOS affordance).
    case noTicket
    case failed(PairingError)
    /// The box paired, but the device token could not be stored here. The
    /// ticket is spent on the box.
    case storeFailed
}

/// The boxes this Mac is paired with: metadata in a JSON file, device tokens in
/// the Keychain.
@MainActor
public final class BoxStore: ObservableObject {
    @Published public private(set) var boxes: [PairedBox] = []
    /// Boxes whose device token the box refused (401) this session.
    @Published public private(set) var refused: Set<PairedBox.ID> = []
    /// Set when the file exists but cannot be read. Saving is refused while it
    /// is set, so a bad read never overwrites the boxholder's pairings.
    public private(set) var loadFailure: String?

    private let storageURL: URL
    private let credentials: any PairedBoxCredentialStoreProtocol
    private let redeemer: PairingRedeemer
    private let deviceLabel: String
    private var tickets = PairingTicketLedger()
    private let log = Logger(subsystem: "run.beebox.mac", category: "pairing")

    public init(
        storageURL: URL,
        credentials: any PairedBoxCredentialStoreProtocol,
        redeemer: PairingRedeemer,
        deviceLabel: String
    ) {
        self.storageURL = storageURL
        self.credentials = credentials
        self.redeemer = redeemer
        self.deviceLabel = deviceLabel
        load()
    }

    public func token(for box: PairedBox) -> String? {
        credentials.readToken(for: box.id)
    }

    public func pair(_ link: PairingLink) async -> PairResult {
        guard PairingTransport(baseURL: link.baseURL).allowsRedeem else {
            return .refusedTransport
        }
        guard let ticket = link.pairingToken else {
            return .noTicket
        }
        guard tickets.begin(ticket) else {
            log.info("pairing redeem skipped reason=duplicate-link")
            return .duplicate
        }
        let deviceToken: String
        do {
            deviceToken = try await redeemer.redeem(baseURL: link.baseURL, pairingToken: ticket, deviceLabel: deviceLabel)
        } catch {
            tickets.finish(ticket, stored: false)
            log.warning("pairing redeem failed error=\(String(describing: error), privacy: .public)")
            return .failed(error)
        }
        let result = store(link: link, deviceToken: deviceToken)
        if case .paired = result {
            tickets.finish(ticket, stored: true)
        } else {
            tickets.finish(ticket, stored: false)
        }
        return result
    }

    /// Adds the local box, or updates its URL. It has no device token until the
    /// boxholder pairs it like any other box.
    public func setLocalBox(label: String, baseURL: URL) {
        if let index = boxes.firstIndex(where: \.hostedLocally) {
            guard boxes[index].baseURL != baseURL || boxes[index].label != label else { return }
            boxes[index].baseURL = baseURL
            boxes[index].label = label
        } else if let index = boxes.firstIndex(where: { $0.isSameBox(as: baseURL) }) {
            boxes[index].hostedLocally = true
        } else {
            boxes.append(PairedBox(id: UUID(), label: label, baseURL: baseURL, hostedLocally: true))
        }
        _ = save()
    }

    public func markCredentialRefused(_ box: PairedBox) {
        refused.insert(box.id)
    }

    /// Deletes the device token first, then the record, so a failed delete
    /// never leaves a token with no box to name it.
    public func remove(_ box: PairedBox) throws {
        try credentials.deleteToken(for: box.id)
        boxes.removeAll { $0.id == box.id }
        refused.remove(box.id)
        guard save() else { throw BoxStoreError.saveFailed }
    }

    private func store(link: PairingLink, deviceToken: String) -> PairResult {
        guard loadFailure == nil else { return .storeFailed }
        var box = boxes.first { $0.isSameBox(as: link.baseURL) }
            ?? PairedBox(id: UUID(), label: link.label, baseURL: link.baseURL, hostedLocally: false)
        box.label = link.label
        do {
            try credentials.writeToken(deviceToken, for: box.id)
        } catch {
            log.error("pairing store failed stage=keychain")
            return .storeFailed
        }
        guard credentials.readToken(for: box.id) == deviceToken else {
            log.error("pairing store failed stage=keychain-readback")
            return .storeFailed
        }
        if let index = boxes.firstIndex(where: { $0.id == box.id }) {
            boxes[index] = box
        } else {
            boxes.append(box)
        }
        refused.remove(box.id)
        guard save() else { return .storeFailed }
        return .paired(box)
    }

    private func load() {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return }
        do {
            boxes = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: storageURL)).boxes
        } catch {
            loadFailure = "\(storageURL.lastPathComponent) could not be read: \(error.localizedDescription)"
            log.error("paired boxes load failed error=\(String(describing: error), privacy: .public)")
        }
    }

    private func save() -> Bool {
        guard loadFailure == nil else { return false }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(Snapshot(boxes: boxes)).write(to: storageURL, options: .atomic)
            return true
        } catch {
            log.error("paired boxes save failed error=\(String(describing: error), privacy: .public)")
            return false
        }
    }

    private struct Snapshot: Codable {
        var boxes: [PairedBox]
    }
}

public enum BoxStoreError: Error {
    case saveFailed
}
