import Foundation

/// Loads the shared cross-platform golden fixtures from the monorepo working
/// tree, located from this file's compiled-in `#filePath`, as the iOS tests do
/// (`ios-app/BeeBoxTests/SpeechKeywordsTests.swift`, `MobileContractFixtures`).
enum MobileContractFixtures {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // BeeBoxSharedTests/
        .deletingLastPathComponent() // Tests/
        .deletingLastPathComponent() // apple-shared/
        .deletingLastPathComponent() // repo root
        .appendingPathComponent("beebox/test/mobile-contract/fixtures")

    struct Named<Fixture> {
        var name: String
        var fixture: Fixture
    }

    /// Every `*.json` in the family's folder, sorted by name, decoded as `Fixture`.
    static func load<Fixture: Decodable>(_ family: String, as _: Fixture.Type) throws -> [Named<Fixture>] {
        let files = try FileManager.default
            .contentsOfDirectory(at: root.appendingPathComponent(family), includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        return try files.map { url in
            Named(
                name: url.deletingPathExtension().lastPathComponent,
                fixture: try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
            )
        }
    }

    /// One named file in a family.
    static func load<Fixture: Decodable>(_ family: String, _ name: String, as _: Fixture.Type) throws -> Fixture {
        let url = root.appendingPathComponent(family).appendingPathComponent("\(name).json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
}
