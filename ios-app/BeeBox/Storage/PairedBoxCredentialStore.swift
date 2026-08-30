import Foundation
import Security

protocol PairedBoxCredentialStoreProtocol {
    func readToken(for boxID: UUID) -> String?
    func writeToken(_ token: String, for boxID: UUID) throws
    func deleteToken(for boxID: UUID) throws
    func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int
}

struct PairedBoxCredentialStore: PairedBoxCredentialStoreProtocol {
    enum Error: Swift.Error {
        case status(OSStatus)
        case missingToken
    }

    let service: String
    let accessGroup: String

    init(
        service: String = "app.beebox.ios.device-token",
        accessGroup: String = "44AJ3D25ZD.group.app.beebox.ios"
    ) {
        self.service = service
        self.accessGroup = accessGroup
    }

    func readToken(for boxID: UUID) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: boxID.uuidString,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

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

    func writeToken(_ token: String, for boxID: UUID) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            try deleteToken(for: boxID)
            return
        }
        let account = boxID.uuidString
        let data = trimmed.data(using: .utf8) ?? Data()

        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

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

    func deleteToken(for boxID: UUID) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: boxID.uuidString,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw Error.status(status)
    }

    func listAccounts() -> [String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecAttrAccessGroup as String: accessGroup,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else {
            return []
        }

        return items.compactMap { item in
            item[kSecAttrAccount as String] as? String
        }
    }

    func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int {
        var purged = 0
        let known = Set(knownBoxIDs.map(\.uuidString))
        for account in listAccounts() where known.contains(account) == false {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecAttrAccessGroup as String: accessGroup,
            ]
            if SecItemDelete(query as CFDictionary) == errSecSuccess {
                purged += 1
            }
        }
        return purged
    }
}
