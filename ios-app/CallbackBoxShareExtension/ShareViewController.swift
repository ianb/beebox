import SwiftUI
import UniformTypeIdentifiers
import LocalAuthentication

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareViewModel(extensionContext: extensionContext)
        let host = UIHostingController(rootView: ShareExtensionView(model: model))
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
        case chat(ShareChatRow)
        case save(ShareDestinationRow)
    }

    @Published var item: SharedTextualItem?
    @Published var destinations: ShareDestinations?
    @Published var selection: Selection?
    @Published var errorMessage: String?
    @Published var isWorking = false
    @Published private(set) var pairedBoxes: [SharedPairedBoxMetadata] = []
    @Published private(set) var selectedBoxID: PairedBox.ID?
    @Published private(set) var isLoadingDestinations = false
    @Published private(set) var hasAttemptedSubmission = false

    private weak var extensionContext: NSExtensionContext?
    private var api: ShareExtensionAPI?
    private var destinationLoadTracker = ShareDestinationLoadTracker()
    private var unlockedBoxIDs: Set<PairedBox.ID> = []
    private let operationID = UUID()
    private let capturedAt = Date()

    init(extensionContext: NSExtensionContext?) {
        self.extensionContext = extensionContext
        Task { await load() }
    }

    func cancel() {
        extensionContext?.cancelRequest(withError: CancellationError())
    }

    func submit() {
        guard let item, let selection, let api else { return }
        hasAttemptedSubmission = true
        isWorking = true
        errorMessage = nil
        Task {
            do {
                switch selection {
                case .chat(let chat):
                    try await api.send(item, to: chat.sessionId, messageID: operationID)
                case .save(let destination):
                    try await api.save(
                        item,
                        to: destination.destination,
                        shareID: operationID,
                        capturedAt: capturedAt
                    )
                }
                extensionContext?.completeRequest(returningItems: nil)
            } catch {
                isWorking = false
                errorMessage = error.localizedDescription
            }
        }
    }

    func selectBox(_ boxID: PairedBox.ID) {
        guard
            isWorking == false,
            hasAttemptedSubmission == false,
            let metadata = pairedBoxes.first(where: { $0.id == boxID })
        else { return }
        selectedBoxID = boxID
        destinations = nil
        selection = nil
        errorMessage = nil
        isLoadingDestinations = true
        api = nil
        let loadID = destinationLoadTracker.begin()
        Task { await loadDestinations(for: metadata, loadID: loadID) }
    }

    func retryDestinationLoad() {
        guard let selectedBoxID else { return }
        selectBox(selectedBoxID)
    }

    var canRetryDestinationLoad: Bool {
        selectedBoxID != nil && destinations == nil && isLoadingDestinations == false && hasAttemptedSubmission == false
    }

    private func load() async {
        do {
            guard
                let snapshot = SharedSelectedBoxStore().read(),
                let defaultBox = snapshot.selectedBox
            else {
                throw ShareLoadError.noBox
            }
            item = try await loadSharedItem()
            pairedBoxes = snapshot.boxes
            selectBox(defaultBox.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadDestinations(for metadata: SharedPairedBoxMetadata, loadID: UUID) async {
        do {
            try await unlockIfNeeded(metadata, loadID: loadID)
            guard destinationLoadTracker.accepts(loadID) else { return }
            guard let token = PairedBoxCredentialStore().readToken(for: metadata.id) else {
                throw ShareLoadError.noCredential(metadata.label)
            }
            let box = metadata.pairedBox(withToken: token)
            let loadedAPI = ShareExtensionAPI(box: box)
            let loadedDestinations = try await loadedAPI.destinations()
            guard destinationLoadTracker.accepts(loadID) else { return }
            api = loadedAPI
            destinations = loadedDestinations
            isLoadingDestinations = false
        } catch {
            guard destinationLoadTracker.accepts(loadID) else { return }
            isLoadingDestinations = false
            errorMessage = error.localizedDescription
        }
    }

    private func unlockIfNeeded(_ metadata: SharedPairedBoxMetadata, loadID: UUID) async throws {
        guard metadata.requiresDeviceUnlock, unlockedBoxIDs.contains(metadata.id) == false else { return }
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            if policyError?.code == LAError.passcodeNotSet.rawValue {
                throw ShareLoadError.passcodeRequired
            }
            throw policyError ?? ShareLoadError.unlockFailed
        }
        let allowed: Bool
        do {
            allowed = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock \(metadata.label) before sharing."
            )
        } catch let error as LAError where error.code == .userCancel || error.code == .appCancel {
            throw ShareLoadError.unlockCancelled
        }
        if allowed == false {
            throw ShareLoadError.unlockFailed
        }
        guard destinationLoadTracker.accepts(loadID) else { return }
        unlockedBoxIDs.insert(metadata.id)
    }

    private func loadSharedItem() async throws -> SharedTextualItem {
        guard
            let input = extensionContext?.inputItems.first as? NSExtensionItem,
            let providers = input.attachments,
            providers.count == 1,
            let provider = providers.first
        else {
            throw ShareLoadError.oneItemOnly
        }
        let title = input.attributedTitle?.string
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let value = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
            if let url = value as? URL, url.isFileURL == false {
                return SharedTextualItem(kind: .url, value: url.absoluteString, title: title)
            }
            if let url = value as? NSURL, let absoluteURL = url.absoluteURL, absoluteURL.isFileURL == false {
                return SharedTextualItem(kind: .url, value: absoluteURL.absoluteString, title: title)
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let value = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
            if let text = value as? String, text.isEmpty == false {
                return SharedTextualItem(kind: .text, value: text, title: title)
            }
        }
        throw ShareLoadError.unsupported
    }
}

private enum ShareLoadError: LocalizedError {
    case noBox
    case noCredential(String)
    case oneItemOnly
    case unsupported
    case unlockFailed
    case unlockCancelled
    case passcodeRequired

    var errorDescription: String? {
        switch self {
        case .noBox:
            "Open Callback Box and pair a box first."
        case .noCredential(let label):
            "\(label) needs to be paired again."
        case .oneItemOnly:
            "Share one item at a time."
        case .unsupported:
            "This version can share a web link or text."
        case .unlockFailed:
            "Callback Box could not be unlocked."
        case .unlockCancelled:
            "Unlock was cancelled."
        case .passcodeRequired:
            "Set a device passcode before sharing to this protected box."
        }
    }
}

private struct ShareExtensionView: View {
    @ObservedObject var model: ShareViewModel

    var body: some View {
        NavigationStack {
            Group {
                if model.pairedBoxes.isEmpty == false {
                    List {
                        Section("Box") {
                            Menu {
                                ForEach(model.pairedBoxes) { box in
                                    Button {
                                        model.selectBox(box.id)
                                    } label: {
                                        if model.selectedBoxID == box.id {
                                            Label(box.displayLabel, systemImage: "checkmark")
                                        } else {
                                            Text(box.displayLabel)
                                        }
                                    }
                                }
                            } label: {
                                HStack {
                                    Label(selectedBoxLabel, systemImage: "shippingbox")
                                    Spacer()
                                    if model.pairedBoxes.count > 1 {
                                        Image(systemName: "chevron.up.chevron.down")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .disabled(
                                model.pairedBoxes.count < 2
                                    || model.isWorking
                                    || model.hasAttemptedSubmission
                            )
                        }
                        if let destinations = model.destinations {
                            if destinations.chats.isEmpty == false {
                                Section("Send to a chat") {
                                    ForEach(destinations.chats) { chat in
                                        Button {
                                            model.selection = .chat(chat)
                                        } label: {
                                            destinationRow(
                                                symbol: chat.landmark.symbol,
                                                title: chat.landmark.label,
                                                subtitle: chat.label,
                                                selected: model.selection == .chat(chat)
                                            )
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(model.hasAttemptedSubmission)
                                    }
                                }
                            }
                            Section("Save in") {
                                ForEach(destinations.saves) { destination in
                                    Button {
                                        model.selection = .save(destination)
                                    } label: {
                                        destinationRow(
                                            symbol: destination.symbol,
                                            title: destination.label,
                                            subtitle: nil,
                                            selected: model.selection == .save(destination)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(model.hasAttemptedSubmission)
                                }
                            }
                        } else if model.isLoadingDestinations {
                            Section { ProgressView("Loading destinations…") }
                        }
                        if let message = model.errorMessage {
                            Section {
                                Text(message).foregroundStyle(.red)
                                if model.canRetryDestinationLoad {
                                    Button("Retry") { model.retryDestinationLoad() }
                                }
                            }
                        }
                    }
                } else if let message = model.errorMessage {
                    ContentUnavailableView("Cannot Share", systemImage: "exclamationmark.triangle", description: Text(message))
                } else {
                    ProgressView("Loading destinations…")
                }
            }
            .navigationTitle("Share to Callback Box")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(actionTitle) { model.submit() }
                        .disabled(model.selection == nil || model.isWorking)
                }
            }
        }
    }

    private var selectedBoxLabel: String {
        model.pairedBoxes.first { $0.id == model.selectedBoxID }?.displayLabel ?? "Choose a box"
    }

    private var actionTitle: String {
        if model.isWorking { return "Working…" }
        if case .chat = model.selection { return "Send" }
        return "Save"
    }

    private func destinationRow(symbol: String?, title: String, subtitle: String?, selected: Bool) -> some View {
        HStack {
            Text(symbol ?? "□")
            VStack(alignment: .leading) {
                Text(title)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark").foregroundStyle(.tint)
            }
        }
    }
}
