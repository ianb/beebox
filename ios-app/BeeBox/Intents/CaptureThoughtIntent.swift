import AppIntents
import Foundation
import UniformTypeIdentifiers

struct CaptureBoxEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Box")
    static let defaultQuery = CaptureBoxQuery()
    var id: UUID
    var label: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(label)") }
}
struct CaptureBoxQuery: EntityQuery {
    @Dependency private var pairedBoxStore: PairedBoxStore
    @MainActor func entities(for identifiers: [UUID]) async throws -> [CaptureBoxEntity] {
        pairedBoxStore.boxes.filter { identifiers.contains($0.id) }.map { .init(id: $0.id, label: $0.label) }
    }
    @MainActor func suggestedEntities() async throws -> [CaptureBoxEntity] {
        pairedBoxStore.boxes.map { .init(id: $0.id, label: $0.label) }
    }
}

/// Required text prompts after the trigger; arbitrary dictated content is not
/// interpolated into an App Shortcut phrase.
struct CaptureThoughtIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Thought to Bee Box"
    static let description = IntentDescription("Save a thought for your capture default or a specified box.")
    @available(iOS 26.0, *) static let supportedModes: IntentModes = [.background]
    @available(iOS, deprecated: 26.0, message: "iOS 26 uses supportedModes") static var openAppWhenRun: Bool { false }
    @Parameter(title: "Thought", requestValueDialog: "What would you like to save?") var thought: String
    @Parameter(title: "Box") var box: CaptureBoxEntity?
    @Dependency private var pairedBoxStore: PairedBoxStore

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = thought.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .result(dialog: "Tell me what thought to save.") }
        do {
            let target = try CaptureDestinationStore().resolve(boxes: pairedBoxStore.boxes, pinnedBoxID: box?.id)
            let record = try QuickCaptureStore.shared.accept(box: target, source: .appIntents, input: text)
            BoxLog.info("intent capture accepted id=\(record.id)", category: .capture, targetBoxID: target.id)
            do { try await QuickCaptureUploadCoordinator.shared.schedule(record: record, box: target) }
            catch { BoxLog.warn("intent capture pending transfer type=\(type(of: error))", category: .upload, targetBoxID: target.id) }
            return .result(dialog: "Saved on your phone for \(target.label).")
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "Not saved. \(error.localizedDescription)"))
        }
    }
}

struct SaveToBoxIntent: AppIntent {
    static let title: LocalizedStringResource = "Save to Box"
    static let description = IntentDescription("Save words, one URL, or one image with optional instructions.")
    @available(iOS 26.0, *) static let supportedModes: IntentModes = [.background]
    @available(iOS, deprecated: 26.0, message: "iOS 26 uses supportedModes") static var openAppWhenRun: Bool { false }
    @Parameter(title: "Text") var text: String?
    @Parameter(title: "URL") var url: URL?
    @Parameter(title: "Image") var file: IntentFile?
    @Parameter(title: "Instructions") var instructions: String?
    @Parameter(title: "Box") var box: CaptureBoxEntity?
    @Dependency private var pairedBoxStore: PairedBoxStore

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let target = try CaptureDestinationStore().resolve(boxes: pairedBoxStore.boxes, pinnedBoxID: box?.id)
            let content = text?.trimmingCharacters(in: .whitespacesAndNewlines)
            let words = instructions?.trimmingCharacters(in: .whitespacesAndNewlines)
            let materialCount = (url == nil ? 0 : 1) + (file == nil ? 0 : 1) + (content?.isEmpty == false ? 1 : 0)
            guard materialCount <= 1 else { return .result(dialog: "Not saved. Supply one image, URL, or text clipping at a time.") }
            var material: QuickCaptureMaterial?
            var fileURL: URL?
            var temporary: URL?
            var scopedURL: URL?
            defer { scopedURL?.stopAccessingSecurityScopedResource() }
            defer { if let temporary { try? FileManager.default.removeItem(at: temporary) } }
            if let file {
                guard let type = file.type ?? UTType(filenameExtension: (file.filename as NSString).pathExtension), type.conforms(to: .image), let mime = type.preferredMIMEType else {
                    return .result(dialog: "Not saved. This action supports one image, URL, or text clipping.")
                }
                material = .file(kind: "image", mimeType: mime, fileName: file.filename)
                if let suppliedURL = file.fileURL {
                    if suppliedURL.startAccessingSecurityScopedResource() { scopedURL = suppliedURL }
                    fileURL = suppliedURL
                }
                else {
                    let location = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                    let data = file.data
                    guard data.count <= QuickCaptureCapabilityCache().maxFileBytes(boxID: target.id) else {
                        return .result(dialog: "Not saved. The image exceeds this box’s capture limit.")
                    }
                    try data.write(to: location, options: .atomic)
                    fileURL = location
                    temporary = location
                }
            } else if let url {
                guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
                    return .result(dialog: "Not saved. Use a web URL.")
                }
                material = QuickCaptureMaterial(kind: "url", url: url.absoluteString)
            } else if let content, !content.isEmpty {
                material = QuickCaptureMaterial(kind: "clipping", text: content)
            }
            guard material != nil || words?.isEmpty == false else {
                return .result(dialog: "Not saved. Supply some words or material.")
            }
            let record = try QuickCaptureStore.shared.accept(box: target, source: .appIntents, input: words, material: material, fileURL: fileURL)
            do { try await QuickCaptureUploadCoordinator.shared.schedule(record: record, box: target) }
            catch { BoxLog.warn("intent material pending transfer type=\(type(of: error))", category: .upload, targetBoxID: target.id) }
            return .result(dialog: "Saved on your phone for \(target.label).")
        } catch { return .result(dialog: IntentDialog(stringLiteral: "Not saved. \(error.localizedDescription)")) }
    }
}

struct BeeBoxAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CaptureThoughtIntent(), phrases: ["Add a thought to \(.applicationName)", "Save a thought in \(.applicationName)"], shortTitle: "Add a Thought", systemImageName: "tray.and.arrow.down")
        AppShortcut(intent: StartVoiceNoteIntent(), phrases: ["Start a voice note in \(.applicationName)"], shortTitle: "Start Voice Note", systemImageName: "mic")
        AppShortcut(intent: StopVoiceNoteIntent(), phrases: ["Stop and save my voice note in \(.applicationName)"], shortTitle: "Stop and Save", systemImageName: "stop.circle")
    }
}
