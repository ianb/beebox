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

    private weak var extensionContext: NSExtensionContext?
    private var api: ShareExtensionAPI?
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

    private func load() async {
        do {
            guard let snapshot = SharedSelectedBoxStore().read() else {
                throw ShareLoadError.noBox
            }
            guard let token = PairedBoxCredentialStore().readToken(for: snapshot.id) else {
                throw ShareLoadError.noCredential
            }
            let box = PairedBox(
                id: snapshot.id,
                label: snapshot.label,
                baseURL: snapshot.baseURL,
                sessionID: nil,
                authToken: token,
                requiresDeviceUnlock: snapshot.requiresDeviceUnlock
            )
            try await unlockIfNeeded(snapshot.requiresDeviceUnlock)
            let loadedItem = try await loadSharedItem()
            let loadedAPI = ShareExtensionAPI(box: box)
            let loadedDestinations = try await loadedAPI.destinations()
            item = loadedItem
            api = loadedAPI
            destinations = loadedDestinations
            selection = loadedDestinations.saves.first.map(Selection.save)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unlockIfNeeded(_ required: Bool) async throws {
        guard required else { return }
        let context = LAContext()
        let allowed = try await context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: "Unlock your Callback Box before sharing."
        )
        if allowed == false {
            throw ShareLoadError.unlockFailed
        }
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
    case noCredential
    case oneItemOnly
    case unsupported
    case unlockFailed

    var errorDescription: String? {
        switch self {
        case .noBox:
            "Open Callback Box and pair a box first."
        case .noCredential:
            "The selected box needs to be paired again."
        case .oneItemOnly:
            "Share one item at a time."
        case .unsupported:
            "This version can share a web link or text."
        case .unlockFailed:
            "Callback Box could not be unlocked."
        }
    }
}

private struct ShareExtensionView: View {
    @ObservedObject var model: ShareViewModel

    var body: some View {
        NavigationStack {
            Group {
                if let destinations = model.destinations {
                    List {
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
                            }
                        }
                        if let message = model.errorMessage {
                            Section { Text(message).foregroundStyle(.red) }
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
