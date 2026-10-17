import AppKit
import BeeBoxMacCore
import SwiftUI

/// The app's one window. A menu-bar app (`LSUIElement`) has no SwiftUI scene
/// that can be raised from an open-URL callback, so the window is AppKit-owned
/// and anything can call `show`.
@MainActor
final class PreferencesWindowController {
    enum Tab: Hashable {
        case boxes
        case uploads
        case general
    }

    /// Which tab is showing and whether the pairing sheet is up.
    final class Navigation: ObservableObject {
        @Published var tab: Tab = .boxes
        @Published var pairing: PairingSheetModel?
    }

    let navigation = Navigation()
    private let boxStore: BoxStore
    private let hosting: HostingController
    private let uploadFolders: UploadFolderStore
    private let uploads: UploadCoordinator
    private var window: NSWindow?

    init(boxStore: BoxStore, hosting: HostingController, uploadFolders: UploadFolderStore, uploads: UploadCoordinator) {
        self.boxStore = boxStore
        self.hosting = hosting
        self.uploadFolders = uploadFolders
        self.uploads = uploads
    }

    func show(_ tab: Tab) {
        navigation.tab = tab
        present()
    }

    /// Opens Boxes with the pairing sheet. `link` (from a `beebox://pair` URL)
    /// fills the field; otherwise the clipboard does, when it holds a link.
    func startPairing(link: String? = nil) {
        let model = PairingSheetModel { [boxStore] link in await boxStore.pair(link) }
        if let link {
            model.text = link
        } else {
            model.fill(fromPasteboard: NSPasteboard.general.string(forType: .string))
        }
        navigation.tab = .boxes
        navigation.pairing = model
        present()
    }

    private func present() {
        let window = window ?? makeWindow()
        self.window = window
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    private func makeWindow() -> NSWindow {
        let root = PreferencesView(
            navigation: navigation,
            boxStore: boxStore,
            hosting: hosting,
            uploadFolders: uploadFolders,
            uploads: uploads
        ) { [weak self] in
            self?.startPairing()
        }
        let window = NSWindow(contentViewController: NSHostingController(rootView: root))
        window.title = "Bee Box Preferences"
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.isReleasedWhenClosed = false
        window.setContentSize(NSSize(width: 560, height: 380))
        window.center()
        return window
    }
}

struct PreferencesView: View {
    @ObservedObject var navigation: PreferencesWindowController.Navigation
    @ObservedObject var boxStore: BoxStore
    @ObservedObject var hosting: HostingController
    let uploadFolders: UploadFolderStore
    let uploads: UploadCoordinator
    let startPairing: () -> Void

    var body: some View {
        TabView(selection: $navigation.tab) {
            BoxesTab(boxStore: boxStore, uploads: uploads, startPairing: startPairing)
                .tabItem { Label("Boxes", systemImage: "shippingbox") }
                .tag(PreferencesWindowController.Tab.boxes)
            UploadsTab(folders: uploadFolders, coordinator: uploads, boxStore: boxStore)
                .tabItem { Label("Uploads", systemImage: "tray.and.arrow.up") }
                .tag(PreferencesWindowController.Tab.uploads)
            GeneralTab(hosting: hosting)
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(PreferencesWindowController.Tab.general)
        }
        .padding(20)
        .frame(minWidth: 520, minHeight: 340)
        .sheet(item: $navigation.pairing) { model in
            PairingSheet(model: model) { navigation.pairing = nil }
        }
    }
}

extension PairingSheetModel: Identifiable {
    public nonisolated var id: ObjectIdentifier { ObjectIdentifier(self) }
}

struct BoxesTab: View {
    @ObservedObject var boxStore: BoxStore
    let uploads: UploadCoordinator
    let startPairing: () -> Void
    @State private var selection: PairedBox.ID?
    @State private var confirmingRemoval: PairedBox?
    @State private var removalError: String?
    @State private var forceRemoval: PairedBox?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let failure = boxStore.loadFailure {
                Text("Your paired boxes could not be read, so nothing will be saved: \(failure)")
                    .foregroundStyle(.red)
            }
            if boxStore.boxes.isEmpty {
                Text("No boxes yet. Pair this Mac with a box to open it from the menu and send it scans.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(boxStore.boxes, selection: $selection) { box in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(box.label)
                            Text(box.displayHost).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(status(of: box)).font(.caption).foregroundStyle(statusColor(of: box))
                    }
                }
            }
            if let removalError {
                Text(removalError).foregroundStyle(.red)
            }
            HStack {
                Button("Pair with a Box…", action: startPairing)
                Spacer()
                Button("Open in Browser") {
                    if let box = selectedBox { NSWorkspace.shared.open(box.baseURL) }
                }
                    .disabled(selectedBox == nil)
                Button("Remove…") { confirmingRemoval = selectedBox }
                    .disabled(selectedBox == nil)
            }
        }
        .alert(
            "Remove \(confirmingRemoval?.label ?? "this box")?",
            isPresented: Binding(get: { confirmingRemoval != nil }, set: { if !$0 { confirmingRemoval = nil } }),
            presenting: confirmingRemoval
        ) { box in
            Button("Remove", role: .destructive) { Task { await remove(box, force: false) } }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This Mac forgets the box, stops its upload folders, and revokes its scanner credential. The box still lists this Mac under its paired devices until you remove it there.")
        }
        .alert(
            "The scanner credential was not revoked",
            isPresented: Binding(get: { forceRemoval != nil }, set: { if !$0 { forceRemoval = nil } }),
            presenting: forceRemoval
        ) { box in
            Button("Remove Anyway", role: .destructive) { Task { await remove(box, force: true) } }
            Button("Keep", role: .cancel) {}
        } message: { _ in
            Text("\(removalError ?? "")\n\nRemove anyway leaves the credential on the box until you revoke it there under Settings → Scan uploaders.")
        }
    }

    private var selectedBox: PairedBox? {
        boxStore.boxes.first { $0.id == selection }
    }

    private func status(of box: PairedBox) -> String {
        if boxStore.refused.contains(box.id) { return "Credential refused — pair again" }
        if boxStore.token(for: box) == nil { return box.hostedLocally ? "On this Mac — not paired" : "Not paired" }
        return box.hostedLocally ? "On this Mac" : "Paired"
    }

    private func statusColor(of box: PairedBox) -> Color {
        boxStore.refused.contains(box.id) ? .red : .secondary
    }

    private func remove(_ box: PairedBox, force: Bool) async {
        switch await uploads.removeBox(box, force: force) {
        case .removed:
            removalError = nil
            forceRemoval = nil
        case .revokeFailed(let reason):
            removalError = reason
            if !force { forceRemoval = box }
        }
    }
}

struct PairingSheet: View {
    @ObservedObject var model: PairingSheetModel
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pair with a Box").font(.headline)
            Text(PairingSheetModel.helpText).foregroundStyle(.secondary)
            TextField("beebox://pair?…", text: $model.text)
                .textFieldStyle(.roundedBorder)
                .disabled(isPairing)
            stateView
            HStack {
                Spacer()
                if case .paired = model.state {
                    Button("Done", action: done).keyboardShortcut(.defaultAction)
                } else {
                    Button("Cancel", action: done).keyboardShortcut(.cancelAction)
                    Button("Add") { Task { await model.add() } }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!model.canAdd)
                }
            }
        }
        .padding(20)
        .frame(width: 460)
        .onChange(of: model.state) { _, state in
            if case .paired = state { clearPastedLink() }
        }
    }

    private var isPairing: Bool {
        if case .pairing = model.state { return true }
        return false
    }

    @ViewBuilder private var stateView: some View {
        switch model.state {
        case .empty:
            EmptyView()
        case .notALink:
            Text("That is not a Bee Box pairing link.").foregroundStyle(.red)
        case .refused(let preview):
            PreviewLine(preview: preview)
            Text("This link is not encrypted and does not point at a local network address, so this Mac will not send it.")
                .foregroundStyle(.red)
        case .ready(let preview):
            PreviewLine(preview: preview)
        case .pairing(let preview):
            PreviewLine(preview: preview)
            ProgressView().controlSize(.small)
        case .failed(let preview, let message):
            PreviewLine(preview: preview)
            Text(message).foregroundStyle(.red)
        case .paired(let label):
            Text("Added \(label). It is in the Bee Box menu.")
        }
    }

    /// The link holds a spent ticket now; leaving it on the clipboard invites a
    /// second paste that can only fail.
    private func clearPastedLink() {
        let board = NSPasteboard.general
        if board.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) == model.text {
            board.clearContents()
        }
    }
}

private struct PreviewLine: View {
    let preview: PairingSheetModel.Preview

    var body: some View {
        HStack {
            Image(systemName: preview.encrypted ? "lock.fill" : "lock.open")
            Text("\(preview.label) — \(preview.host)")
            if !preview.encrypted {
                Text("not encrypted").font(.caption).foregroundStyle(.orange)
            }
        }
    }
}

struct GeneralTab: View {
    @ObservedObject var hosting: HostingController

    var body: some View {
        Form {
            Section {
                Toggle("Run a box on this Mac", isOn: Binding(get: { hosting.enabled }, set: { hosting.setEnabled($0) }))
                Text("Runs a box in a virtual machine. The first start downloads about 1 GB and unpacks it to a few GB. While this is off, the app downloads nothing.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Remove Downloaded Box Image…") { hosting.confirmRemoveRuntime() }
                    .disabled(hosting.enabled || !hosting.runtimeExists)
            }
            Section {
                Toggle("Open at Login", isOn: Binding(get: { hosting.opensAtLogin }, set: { hosting.setOpensAtLogin($0) }))
                if let error = hosting.loginItemError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
    }
}
