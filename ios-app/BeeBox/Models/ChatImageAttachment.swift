import Foundation

struct ChatImageAttachment: Codable, Equatable, Identifiable {
    var id: Int
    var mimeType: String
    var dataBase64: String
    /// Box-relative path of the uploaded ORIGINAL, when it landed. Nil when the
    /// upload failed or the image predates originals; the synthesized coding
    /// omits the key entirely rather than sending null, and tolerates its
    /// absence on decode. Contract: `beebox/docs/mobile-contract.md` §4.1.
    var path: String? = nil
}
