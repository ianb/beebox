import BeeBoxShared
import Foundation

/// Reads each Keychain item at most once per launch. Views redraw and sweeps
/// run often; every Keychain read can raise a permission prompt (a rebuilt or
/// re-signed app must be allowed again), so reads go through memory. Writes and
/// deletes go to the Keychain first and update memory only when they succeed.
public final class CachedCredentialStore: PairedBoxCredentialStoreProtocol, @unchecked Sendable {
    private let backing: any PairedBoxCredentialStoreProtocol
    private let lock = NSLock()
    /// `.some(nil)` records a read that found nothing.
    private var cache: [UUID: String?] = [:]

    public init(_ backing: any PairedBoxCredentialStoreProtocol) {
        self.backing = backing
    }

    public func readToken(for boxID: UUID) -> String? {
        if let cached = lock.withLock({ cache[boxID] }) {
            return cached
        }
        let token = backing.readToken(for: boxID)
        lock.withLock { cache[boxID] = .some(token) }
        return token
    }

    public func writeToken(_ token: String, for boxID: UUID) throws {
        do {
            try backing.writeToken(token, for: boxID)
            // Callers verify a write by reading it back; that must reach the
            // Keychain, not this cache.
            guard backing.readToken(for: boxID) == token else { throw PairedBoxCredentialStore.Error.missingToken }
        } catch {
            // The Keychain may hold either value now; read it again next time.
            lock.withLock { cache[boxID] = nil }
            throw error
        }
        lock.withLock { cache[boxID] = .some(token) }
    }

    public func deleteToken(for boxID: UUID) throws {
        do {
            try backing.deleteToken(for: boxID)
        } catch {
            lock.withLock { cache[boxID] = nil }
            throw error
        }
        lock.withLock { cache[boxID] = .some(nil) }
    }

    public func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int {
        let purged = backing.purgeOrphanTokens(knownBoxIDs: knownBoxIDs)
        lock.withLock { cache = cache.filter { knownBoxIDs.contains($0.key) } }
        return purged
    }
}
