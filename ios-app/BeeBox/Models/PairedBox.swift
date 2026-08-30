import Foundation

struct PairedBox: Codable, Equatable, Identifiable {
    var id: UUID
    var label: String
    var baseURL: URL
    var sessionID: String?
    var authToken: String?
    var requiresDeviceUnlock: Bool

    init(
        id: UUID,
        label: String,
        baseURL: URL,
        sessionID: String?,
        authToken: String?,
        requiresDeviceUnlock: Bool
    ) {
        self.id = id
        self.label = label
        self.baseURL = baseURL
        self.sessionID = sessionID
        self.authToken = authToken
        self.requiresDeviceUnlock = requiresDeviceUnlock
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        baseURL = try container.decode(URL.self, forKey: .baseURL)
        sessionID = try container.decodeIfPresent(String.self, forKey: .sessionID)
        authToken = try container.decodeIfPresent(String.self, forKey: .authToken)
        requiresDeviceUnlock = try container.decodeIfPresent(Bool.self, forKey: .requiresDeviceUnlock) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(label, forKey: .label)
        try container.encode(baseURL, forKey: .baseURL)
        try container.encodeIfPresent(sessionID, forKey: .sessionID)
        try container.encodeIfPresent(authToken, forKey: .authToken)
        try container.encode(requiresDeviceUnlock, forKey: .requiresDeviceUnlock)
    }

    var chatURL: URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("chat"), resolvingAgainstBaseURL: false)
        // Keep this query parameter in sync with ChatPage's nativeComposer search option.
        var items = [URLQueryItem(name: "nativeComposer", value: "1")]
        if let sessionID, !sessionID.isEmpty {
            items.append(URLQueryItem(name: "session", value: sessionID))
        }
        components?.queryItems = items
        return components?.url ?? baseURL
    }

    var apiURL: URL {
        baseURL.appendingPathComponent("api")
    }

    func withSessionID(_ sessionID: String?) -> PairedBox {
        PairedBox(
            id: id,
            label: label,
            baseURL: baseURL,
            sessionID: sessionID,
            authToken: authToken,
            requiresDeviceUnlock: requiresDeviceUnlock
        )
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case label
        case baseURL
        case sessionID
        case authToken
        case requiresDeviceUnlock
    }
}
