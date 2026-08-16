import Foundation

/// The one place a request to a paired box is authenticated.
///
/// `ChatAPI`, `CaptureAPI`, `BulkUploadAPI`, and `LogForwarder` all talk to the
/// same box over the same credential; before this existed the shaping was
/// copied three times and had already drifted (chat sent only the bearer
/// token). The `User-Agent` is informational — the box never gates on it — so
/// unifying every caller onto bearer + agent is safe.
enum BoxRequest {
    static let userAgent = "CallbackBox-iOS/0.1"

    /// A GET request carrying the box's credential, ready for a caller to set a
    /// method, content type, and body on.
    static func authenticated(url: URL, box: PairedBox) -> URLRequest {
        var request = URLRequest(url: url)
        apply(to: &request, box: box)
        return request
    }

    /// Authenticate a request the caller already built.
    static func apply(to request: inout URLRequest, box: PairedBox) {
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        guard let token = box.authToken, token.isEmpty == false else {
            return
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
}
