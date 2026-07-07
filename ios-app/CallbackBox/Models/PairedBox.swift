import Foundation

struct PairedBox: Codable, Equatable, Identifiable {
    var id: UUID
    var label: String
    var baseURL: URL
    var sessionID: String?

    init(id: UUID, label: String, baseURL: URL, sessionID: String?) {
        self.id = id
        self.label = label
        self.baseURL = baseURL
        self.sessionID = sessionID
    }

    var chatURL: URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("chat"), resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "embed", value: "1")]
        if let sessionID, !sessionID.isEmpty {
            items.append(URLQueryItem(name: "session", value: sessionID))
        }
        components?.queryItems = items
        return components?.url ?? baseURL
    }

    var apiURL: URL {
        baseURL.appendingPathComponent("api")
    }
}
