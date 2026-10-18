/// Which pairing tickets this process is redeeming, or has redeemed and stored.
///
/// A ticket is single-use on the box, so a second delivery of the same link
/// must not POST it again: the second POST fails and would report a failure for
/// a pairing that worked. Only a ticket whose device token was stored counts as
/// done; after a failed save the ticket is spent on the box, and a repeat should
/// reach the box and get its "expired" answer.
public struct PairingTicketLedger: Sendable {
    private var inFlight: Set<String> = []
    private var stored: Set<String> = []

    public init() {}

    /// False when this ticket is in flight or already stored; otherwise marks it
    /// in flight and returns true. Every true must be followed by `finish`.
    public mutating func begin(_ ticket: String) -> Bool {
        guard !stored.contains(ticket) else { return false }
        return inFlight.insert(ticket).inserted
    }

    public mutating func finish(_ ticket: String, stored didStore: Bool) {
        inFlight.remove(ticket)
        if didStore {
            stored.insert(ticket)
        }
    }
}
