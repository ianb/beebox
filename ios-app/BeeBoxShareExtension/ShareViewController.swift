import BeeBoxShared
import SwiftUI
import UniformTypeIdentifiers
import LocalAuthentication
import os
import ImageIO

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareExtensionView(model: ShareViewModel(extensionContext: extensionContext)))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
    }
}

@MainActor
final class ShareViewModel: ObservableObject {
    enum Selection: Hashable {
        case capture
        case chat(ShareChatRow)
        case save(ShareDestinationRow)
    }

    @Published var item: SharedTextualItem?
    @Published var imageData: Data?
    @Published var instructions = ""
    @Published var destinations: ShareDestinations?
    @Published var selection: Selection? = .capture
    @Published var errorMessage: String?
    @Published var isWorking = false
    @Published private(set) var pairedBoxes: [SharedPairedBoxMetadata] = []
    @Published private(set) var selectedBoxID: PairedBox.ID?
    @Published private(set) var isLoadingDestinations = false
    @Published private(set) var hasAttemptedSubmission = false
    @Published private(set) var showingAlternates = false

    private weak var extensionContext: NSExtensionContext?
    private var api: ShareExtensionAPI?
    private var material: QuickCaptureMaterial?
    private var imageURL: URL?
    private var destinationLoadTracker = ShareDestinationLoadTracker()
    private var unlockedBoxIDs: Set<PairedBox.ID> = []
    private let operationID = UUID()
    private let capturedAt = Date()
    private static let log = Logger(subsystem: "app.beebox.ios", category: "quick-capture-share")

    init(extensionContext: NSExtensionContext?) {
        self.extensionContext = extensionContext
        Task { await load() }
    }

    func cancel() {
        cleanupPreview()
        extensionContext?.cancelRequest(withError: CancellationError())
    }

    func submit() {
        guard let selectedBoxID, let metadata = pairedBoxes.first(where: { $0.id == selectedBoxID }),
              let selection, !isWorking else { return }
        guard selection == .capture || (imageURL == nil && instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) else {
            errorMessage = "Use Save to box to keep this material and your words together."
            return
        }
        hasAttemptedSubmission = true
        isWorking = true
        errorMessage = nil
        Task {
            var savedLocally = false
            do {
                try await unlockIfNeeded(metadata, loadID: nil)
                guard let token = PairedBoxCredentialStore.ios.readToken(for: metadata.id) else {
                    throw ShareLoadError.noCredential(metadata.label)
                }
                let box = metadata.pairedBox(withToken: token)
                switch selection {
                case .capture:
                    let record = try QuickCaptureStore.shared.accept(
                        box: box, source: .shareExtension, input: instructions,
                        material: material, fileURL: imageURL, id: operationID
                    )
                    savedLocally = true
                    do {
                        try await QuickCaptureUploadCoordinator.shared.schedule(record: record, box: box)
                    } catch {
                        // The durable source remains pending; networking cannot undo local acceptance.
                        Self.log.warning("share transfer pending id=\(record.id.uuidString, privacy: .public) error=\(String(describing: type(of: error)), privacy: .public)")
                    }
                case .chat(let chat):
                    guard let item else { throw ShareLoadError.unsupported }
                    try await ShareExtensionAPI(box: box).send(item, to: chat.sessionId, messageID: operationID)
                case .save(let destination):
                    guard let item else { throw ShareLoadError.unsupported }
                    try await ShareExtensionAPI(box: box).save(item, to: destination.destination, shareID: operationID, capturedAt: capturedAt)
                }
                cleanupPreview()
                extensionContext?.completeRequest(returningItems: nil)
            } catch {
                isWorking = false
                hasAttemptedSubmission = savedLocally
                errorMessage = error.localizedDescription
                Self.log.error("share save failed error=\(String(describing: type(of: error)), privacy: .public)")
            }
        }
    }

    func selectBox(_ boxID: PairedBox.ID) {
        guard !isWorking, !hasAttemptedSubmission, pairedBoxes.contains(where: { $0.id == boxID }) else { return }
        selectedBoxID = boxID
        destinations = nil
        api = nil
        showingAlternates = false
        selection = .capture
        errorMessage = nil
        _ = destinationLoadTracker.begin()
    }

    func loadAlternates() {
        guard item != nil, let selectedBoxID,
              let metadata = pairedBoxes.first(where: { $0.id == selectedBoxID }), !isWorking else { return }
        guard instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Save to box keeps your words with the shared item. Clear the words to use another destination."
            return
        }
        showingAlternates = true
        isLoadingDestinations = true
        errorMessage = nil
        let loadID = destinationLoadTracker.begin()
        Task {
            do {
                try await unlockIfNeeded(metadata, loadID: loadID)
                guard let token = PairedBoxCredentialStore.ios.readToken(for: metadata.id) else {
                    throw ShareLoadError.noCredential(metadata.label)
                }
                let loadedAPI = ShareExtensionAPI(box: metadata.pairedBox(withToken: token))
                let loaded = try await loadedAPI.destinations()
                guard destinationLoadTracker.accepts(loadID) else { return }
                api = loadedAPI
                destinations = loaded
                isLoadingDestinations = false
            } catch {
                guard destinationLoadTracker.accepts(loadID) else { return }
                isLoadingDestinations = false
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            guard let snapshot = SharedSelectedBoxStore().read(), !snapshot.boxes.isEmpty else { throw ShareLoadError.noBox }
            pairedBoxes = snapshot.boxes
            try await loadSharedItem()
            let defaultStore = CaptureDestinationStore()
            if defaultStore.defaultBoxID == nil, snapshot.boxes.count == 1 {
                defaultStore.defaultBoxID = snapshot.boxes[0].id
            }
            if let id = defaultStore.defaultBoxID, snapshot.boxes.contains(where: { $0.id == id }) {
                selectedBoxID = id
            } else {
                // Multiple boxes or a removed default require an explicit override, never boxes.first.
                errorMessage = "Choose a box for this share. Set your capture default in Bee Box."
            }
        } catch {
            cleanupPreview()
            errorMessage = error.localizedDescription
            Self.log.error("share load failed error=\(String(describing: type(of: error)), privacy: .public)")
        }
    }

    private func unlockIfNeeded(_ metadata: SharedPairedBoxMetadata, loadID: UUID?) async throws {
        guard metadata.requiresDeviceUnlock, !unlockedBoxIDs.contains(metadata.id) else { return }
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            if policyError?.code == LAError.passcodeNotSet.rawValue { throw ShareLoadError.passcodeRequired }
            throw policyError ?? ShareLoadError.unlockFailed
        }
        let allowed: Bool
        do {
            allowed = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock \(metadata.label) before sharing.")
        } catch let error as LAError where error.code == .userCancel || error.code == .appCancel {
            throw ShareLoadError.unlockCancelled
        }
        guard allowed else { throw ShareLoadError.unlockFailed }
        if let loadID, !destinationLoadTracker.accepts(loadID) { throw CancellationError() }
        unlockedBoxIDs.insert(metadata.id)
    }

    private func loadSharedItem() async throws {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard providers.count == 1, let provider = providers.first else { throw ShareLoadError.oneItemOnly }
        let title = items.first?.attributedTitle?.string
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            let allowedMIME = ["image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]
            guard let type = provider.registeredTypeIdentifiers.compactMap(UTType.init).first(where: {
                $0.conforms(to: .image) && $0.preferredMIMEType.map(allowedMIME.contains) == true
            }), let mime = type.preferredMIMEType else { throw ShareLoadError.unsupported }
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("share-\(operationID.uuidString).\(type.preferredFilenameExtension ?? "image")")
            let copied = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                    do {
                        if let error { throw error }
                        guard let url else { throw ShareLoadError.unsupported }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size > 0, size <= 20 * 1_024 * 1_024 else { throw ShareLoadError.imageTooLarge }
                        // Provider URLs expire with the callback. Copy the original bytes while valid.
                        try FileManager.default.copyItem(at: url, to: destination)
                        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
                        continuation.resume(returning: destination)
                    } catch { continuation.resume(throwing: error) }
                }
            }
            imageURL = copied
            guard let source = CGImageSourceCreateWithURL(copied as CFURL, nil),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1_000,
                    kCGImageSourceCreateThumbnailWithTransform: true
                  ] as CFDictionary), let preview = UIImage(cgImage: thumbnail).pngData() else {
                throw ShareLoadError.unsupported
            }
            imageData = preview
            material = .file(kind: "image", mimeType: mime, fileName: "shared-image.\(type.preferredFilenameExtension ?? "image")")
            return
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let value = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
            if let url = value as? URL, !url.isFileURL {
                guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { throw ShareLoadError.unsupported }
                item = SharedTextualItem(kind: .url, value: url.absoluteString, title: title)
                material = QuickCaptureMaterial(kind: "url", url: url.absoluteString, title: title)
                return
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let value = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
            if let text = value as? String, !text.isEmpty {
                item = SharedTextualItem(kind: .text, value: text, title: title)
                material = QuickCaptureMaterial(kind: "clipping", text: text, title: title)
                return
            }
        }
        throw ShareLoadError.unsupported
    }

    private func cleanupPreview() {
        if let imageURL {
            do { try FileManager.default.removeItem(at: imageURL) }
            catch { Self.log.warning("share preview cleanup failed error=\(String(describing: type(of: error)), privacy: .public)") }
        }
    }
}

private enum ShareLoadError: LocalizedError {
    case noBox, noCredential(String), oneItemOnly, unsupported, imageTooLarge, unlockFailed, unlockCancelled, passcodeRequired
    var errorDescription: String? {
        switch self {
        case .noBox: "Open Bee Box and pair a box first."
        case .noCredential(let label): "\(label) needs to be paired again."
        case .oneItemOnly: "Share one image, link, or text clipping at a time."
        case .unsupported: "Share an image, a web link, or text."
        case .imageTooLarge: "This image is too large to save. Share an image under 20 MB."
        case .unlockFailed: "The box could not be unlocked."
        case .unlockCancelled: "Unlock was cancelled."
        case .passcodeRequired: "Set a device passcode before sharing to this protected box."
        }
    }
}

private struct ShareExtensionView: View {
    @ObservedObject var model: ShareViewModel
    var body: some View {
        NavigationStack {
            List {
                if !model.pairedBoxes.isEmpty {
                    Section("Box") {
                        Menu {
                            ForEach(model.pairedBoxes) { box in
                                Button(box.displayLabel) { model.selectBox(box.id) }
                            }
                        } label: {
                            Label(model.pairedBoxes.first { $0.id == model.selectedBoxID }?.displayLabel ?? "Choose a box", systemImage: "shippingbox")
                        }
                        .disabled(model.isWorking || model.hasAttemptedSubmission)
                    }
                }
                if let data = model.imageData, let image = UIImage(data: data) {
                    Section("Shared image") {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 260)
                            .accessibilityLabel("Preview of the shared image")
                    }
                } else if let item = model.item {
                    Section("Shared material") { Text(item.value).lineLimit(8).textSelection(.enabled) }
                }
                if model.imageData != nil || model.item != nil {
                    Section("What should the box know or do?") {
                        TextField("Optional words", text: $model.instructions, axis: .vertical)
                            .lineLimit(3...8)
                            .disabled(model.isWorking || model.hasAttemptedSubmission)
                        Text("Leave this empty to save the material for later. You can use keyboard dictation.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Section {
                        Button { model.selection = .capture } label: {
                            Label("Save to box", systemImage: model.selection == .capture ? "checkmark.circle.fill" : "circle")
                        }.disabled(model.hasAttemptedSubmission)
                        if model.item != nil {
                            Button("Other destinations…") { model.loadAlternates() }
                                .disabled(model.isWorking || model.hasAttemptedSubmission)
                        }
                    }
                }
                if model.showingAlternates {
                    if model.isLoadingDestinations { ProgressView("Loading destinations…") }
                    if let destinations = model.destinations {
                        Section("Send to a chat") {
                            ForEach(destinations.chats) { chat in
                                Button(chat.label) { model.selection = .chat(chat) }
                            }
                        }
                        Section("Save in a place") {
                            ForEach(destinations.saves) { destination in
                                Button(destination.label) { model.selection = .save(destination) }
                            }
                        }
                    }
                }
                if let message = model.errorMessage { Text(message).foregroundStyle(.red) }
                if model.pairedBoxes.isEmpty && model.errorMessage == nil { ProgressView("Loading share…") }
            }
            .navigationTitle("Share to Bee Box")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancel() }.disabled(model.isWorking) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.isWorking ? "Saving…" : actionTitle) { model.submit() }
                        .disabled(model.selectedBoxID == nil || (model.imageData == nil && model.item == nil) || model.isWorking)
                }
            }
        }
    }
    private var actionTitle: String {
        if case .chat = model.selection { return "Send" }
        return "Save"
    }
}
