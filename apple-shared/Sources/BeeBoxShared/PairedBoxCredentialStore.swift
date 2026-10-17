import Foundation
import Security

/// Per-box secrets in the Keychain, keyed by the box's id. The iOS app keeps
/// device tokens here; the Mac app keeps device and scan tokens.
public protocol PairedBoxCredentialStoreProtocol {
    func readToken(for boxID: UUID) -> String?
    func writeToken(_ token: String, for boxID: UUID) throws
    func deleteToken(for boxID: UUID) throws
    func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int
}

public struct PairedBoxCredentialStore: PairedBoxCredentialStoreProtocol, Sendable {
    public enum Error: Swift.Error {
        case status(OSStatus)
        case missingToken
    }

    public let service: String
    /// The Keychain access group shared with app extensions (iOS), or nil for
    /// the app's own default group (the Mac app, which has no extensions).
    public let accessGroup: String?

    public init(service: String, accessGroup: String?) {
        self.service = service
        self.accessGroup = accessGroup
    }

    /// The query attributes every call starts from.
    private func baseQuery(account: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        if let account { query[kSecAttrAccount as String] = account }
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func readToken(for boxID: UUID) -> String? {
        let query = baseQuery(account: boxID.uuidString).merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]) { _, new in new }

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else {
            return nil
        }
        guard
            let result = item as? Data,
            let token = String(data: result, encoding: .utf8)
        else {
            return nil
        }
        return token
    }

    public func writeToken(_ token: String, for boxID: UUID) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            try deleteToken(for: boxID)
            return
        }
        let account = boxID.uuidString
        let data = trimmed.data(using: .utf8) ?? Data()

        let base = baseQuery(account: account).merging([
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]) { _, new in new }

        let add: [String: Any] = base.merging([kSecValueData as String: data]) { _, new in new }
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let update: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(base as CFDictionary, update as CFDictionary)
            if updateStatus != errSecSuccess {
                throw Error.status(updateStatus)
            }
            return
        }
        if addStatus != errSecSuccess {
            throw Error.status(addStatus)
        }
    }

    public func deleteToken(for boxID: UUID) throws {
        let query = baseQuery(account: boxID.uuidString)
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw Error.status(status)
    }

    public func listAccounts() -> [String] {
        let query = baseQuery(account: nil).merging([
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]) { _, new in new }

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else {
            return []
        }

        return items.compactMap { item in
            item[kSecAttrAccount as String] as? String
        }
    }

    public func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int {
        var purged = 0
        let known = Set(knownBoxIDs.map(\.uuidString))
        for account in listAccounts() where known.contains(account) == false {
            if SecItemDelete(baseQuery(account: account) as CFDictionary) == errSecSuccess {
                purged += 1
            }
        }
        return purged
    }
}
