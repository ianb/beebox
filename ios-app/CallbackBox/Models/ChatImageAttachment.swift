import Foundation

struct ChatImageAttachment: Codable, Equatable, Identifiable {
    var id: Int
    var mimeType: String
    var dataBase64: String
}
