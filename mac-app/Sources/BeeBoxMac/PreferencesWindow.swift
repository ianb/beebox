import AppKit
import BeeBoxMacCore
import SwiftUI

/// The app's one window. A menu-bar app (`LSUIElement`) has no SwiftUI scene
/// that can be raised from an open-URL callback, so the window is AppKit-owned
/// and anything can call `show`. While it is open the app is a regular app
/// (Dock icon, Cmd-Tab, menu bar), so switching away and back finds it again;
/// closing it returns the app to the menu bar only.
@MainActor
final class PreferencesWindowController: NSObject, NSWindowDelegate {
    enum Tab: Hashable {
        case boxes
        case watched
        case localBox
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
    private let runtime: BoxRuntime
    private let updates: Updates
    private let uploadFolders: UploadFolderStore
    private let uploads: UploadCoordinator
    private let uninstall: () -> Void
    private var window: NSWindow?

    init(
        boxStore: BoxStore,
        hosting: HostingController,
        runtime: BoxRuntime,
        updates: Updates,
        uploadFolders: UploadFolderStore,
        uploads: UploadCoordinator,
        uninstall: @escaping () -> Void
    ) {
        self.boxStore = boxStore
        self.hosting = hosting
        self.runtime = runtime
        self.updates = updates
        self.uploadFolders = uploadFolders
        self.uploads = uploads
        self.uninstall = uninstall
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
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    private func makeWindow() -> NSWindow {
        let root = PreferencesView(
            navigation: navigation,
            boxStore: boxStore,
            hosting: hosting,
            runtime: runtime,
            updates: updates,
            uploadFolders: uploadFolders,
            uploads: uploads,
            uninstall: uninstall
        ) { [weak self] in
            self?.startPairing()
        }
        let window = NSWindow(contentViewController: NSHostingController(rootView: root))
        window.title = "Bee Box"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setContentSize(NSSize(width: 640, height: 480))
        window.center()
        window.setFrameAutosaveName("BeeBoxPreferences")
        return window
    }
}

struct PreferencesView: View {
    @ObservedObject var navigation: PreferencesWindowController.Navigation
    @ObservedObject var boxStore: BoxStore
    @ObservedObject var hosting: HostingController
    let runtime: BoxRuntime
    let updates: Updates
    let uploadFolders: UploadFolderStore
    let uploads: UploadCoordinator
    let uninstall: () -> Void
    let startPairing: () -> Void

    var body: some View {
        TabView(selection: $navigation.tab) {
            BoxesTab(boxStore: boxStore, uploads: uploads, startPairing: startPairing)
                .tabItem { Label("Boxes", systemImage: "shippingbox") }
                .tag(PreferencesWindowController.Tab.boxes)
            UploadsTab(folders: uploadFolders, coordinator: uploads, boxStore: boxStore)
                .tabItem { Label("Watched Folders", systemImage: "folder.badge.gearshape") }
                .tag(PreferencesWindowController.Tab.watched)
            LocalBoxTab(hosting: hosting, runtime: runtime)
                .tabItem { Label("Box on this Mac", systemImage: "desktopcomputer") }
                .tag(PreferencesWindowController.Tab.localBox)
            GeneralTab(hosting: hosting, updates: updates, uninstall: uninstall)
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(PreferencesWindowController.Tab.general)
        }
        .frame(minWidth: 600, minHeight: 440)
        .sheet(item: $navigation.pairing) { model in
            PairingSheet(model: model) { navigation.pairing = nil }
        }
    }
}

/// One tab's page: what it is for, then its content, with the window's margins.
struct TabPage<Content: View>: View {
    let explanation: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(explanation)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            content()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The empty state of a list, framed so it does not touch the edges.
struct EmptyListNote: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.5)))
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
        TabPage(explanation: """
            A paired box opens from the Bee Box menu and can receive files from watched folders. \
            To pair, open the box in a browser, go to Settings → Companion Apps, choose Create QR, then Copy Link, \
            and paste the link here. Each box lists this Mac under its paired devices, where you can remove it.
            """) {
            if let failure = boxStore.loadFailure {
                Text("Your paired boxes could not be read, so nothing will be saved: \(failure)")
                    .foregroundStyle(.red)
            }
            if boxStore.boxes.isEmpty {
                EmptyListNote(text: "No boxes yet.")
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

struct LocalBoxTab: View {
    @ObservedObject var hosting: HostingController
    @ObservedObject var runtime: BoxRuntime

    var body: some View {
        TabPage(explanation: """
            Bee Box can run a box on this Mac, in a small virtual machine, instead of (or as well as) \
            pairing with a box that runs somewhere else. Its files are in \(Paths.box.path.replacingOccurrences(of: Paths.home.path, with: "~")), \
            and it opens in your browser at a localhost address that only this Mac can reach. \
            It needs the Mac to be awake; for a box your phone can reach all day, run it on a server instead.
            """) {
            Form {
                Section {
                    Toggle("Run a box on this Mac", isOn: Binding(get: { hosting.enabled }, set: { hosting.setEnabled($0) }))
                    Text("The first start downloads about 1 GB and unpacks it to a few GB. While this is off, Bee Box downloads nothing and runs no virtual machine.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if hosting.enabled {
                    Section("Status") {
                        Text(runtime.statusText)
                        ForEach(runtime.timingLines, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                        if !runtime.memorySummary.isEmpty {
                            Text(runtime.memorySummary).font(.caption).foregroundStyle(.secondary)
                        }
                        HStack {
                            if case .running(let url) = runtime.phase {
                                Button("Open in Browser") { NSWorkspace.shared.open(url) }
                                if let setup = runtime.firstRunSetupURL {
                                    Button("Open First-Run Setup") { NSWorkspace.shared.open(setup) }
                                }
                                Button("Stop") { Task { await runtime.stop() } }
                            } else if runtime.phase == .stopped || runtime.isFailedPhase {
                                Button("Start") { runtime.start() }
                            }
                            Spacer()
                            Button("Show Box Files") { NSWorkspace.shared.open(Paths.box) }
                        }
                    }
                    Section {
                        Text("To send this box files from a watched folder, pair with it like any other box: open it in the browser, then Settings → Companion Apps → Copy Link.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Button("Remove Downloaded Box Image…") { hosting.confirmRemoveRuntime() }
                            .disabled(!hosting.runtimeExists)
                        Text("Frees the disk space the virtual machine used. Your box files are kept.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
    }
}

struct GeneralTab: View {
    @ObservedObject var hosting: HostingController
    @ObservedObject var updates: Updates
    let uninstall: () -> Void

    var body: some View {
        TabPage(explanation: "Bee Box lives in the menu bar. It needs to be running to watch folders and to run a box on this Mac.") {
            Form {
                Section {
                    Toggle("Open at Login", isOn: Binding(get: { hosting.opensAtLogin }, set: { hosting.setOpensAtLogin($0) }))
                    Text("Starts Bee Box when you log in, so watched folders keep sending after a restart.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let error = hosting.loginItemError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
                Section("Updates") {
                    HStack {
                        Text("Bee Box \(BundleConfig.version)")
                        Spacer()
                        Button("Check for Updates…") { updates.checkForUpdates() }
                            .disabled(!updates.enabled)
                    }
                    if !updates.enabled {
                        Text("This build does not update itself.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section {
                    HStack {
                        Text("Removes Bee Box, its downloaded image, and its settings. You choose whether your box files go too.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Uninstall Bee Box…", action: uninstall)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
    }
}
