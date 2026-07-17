import Foundation

struct PairedBox: Codable, Equatable, Identifiable {
    var id: UUID
    var label: String
    var baseURL: URL
    var sessionID: String?
    var authToken: String?

    init(id: UUID, label: String, baseURL: URL, sessionID: String?, authToken: String?) {
        self.id = id
        self.label = label
        self.baseURL = baseURL
        self.sessionID = sessionID
        self.authToken = authToken
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
        PairedBox(id: id, label: label, baseURL: baseURL, sessionID: sessionID, authToken: authToken)
    }
}
