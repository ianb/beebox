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

    /// Whether the pairing sheet is up.
    final class Navigation: ObservableObject {
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
        present(tab)
    }

    /// Opens Boxes with the pairing sheet. `link` (from a `beebox://pair` URL)
    /// fills the field; otherwise the clipboard does, when it holds a link.
    func startPairing(link: String? = nil) {
        let model = PairingSheetModel { [boxStore] link in await boxStore.pair(link) }
        if let link {
            model.text = link
        } else {
            model.offer(fromPasteboard: NSPasteboard.general.string(forType: .string))
        }
        navigation.pairing = model
        appLog("pairing sheet opened source=\(link == nil ? "menu" : "link") clipboardOffer=\(model.clipboardOffer != nil)")
        present(.boxes)
    }

    private static let order: [Tab] = [.boxes, .watched, .localBox, .general]
    private var tabs: NSTabViewController?

    private func present(_ tab: Tab) {
        let firstShow = window == nil
        let window = window ?? makeWindow()
        self.window = window
        if let index = Self.order.firstIndex(of: tab) {
            tabs?.selectedTabViewItemIndex = index
        }
        NSApp.setActivationPolicy(.regular)
        // A menu item's action runs while the menu is still closing, and an
        // app that has just become regular is not yet active; ordering the
        // window front then can leave it hidden. Show it on the next turn.
        DispatchQueue.main.async {
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
            appLog("preferences shown tab=\(tab) first=\(firstShow) visible=\(window.isVisible) key=\(window.isKeyWindow) frame=\(Int(window.frame.width))x\(Int(window.frame.height)) active=\(NSApp.isActive)")
        }
    }

    func windowWillClose(_ notification: Notification) {
        appLog("preferences closed")
        NSApp.setActivationPolicy(.accessory)
    }

    /// The macOS settings convention: tabs as labeled icons in the toolbar,
    /// the window titled by the selected tab.
    private func makeWindow() -> NSWindow {
        let controller = TitledTabViewController()
        controller.tabStyle = .toolbar
        controller.addTabViewItem(item(.boxes, "Boxes", "shippingbox", BoxesTab(
            boxStore: boxStore, uploads: uploads, navigation: navigation
        ) { [weak self] in self?.startPairing() }))
        controller.addTabViewItem(item(.watched, "Watched Folders", "folder.badge.gearshape", UploadsTab(
            folders: uploadFolders, coordinator: uploads, boxStore: boxStore
        )))
        controller.addTabViewItem(item(.localBox, "Box on this Mac", "desktopcomputer", LocalBoxTab(
            hosting: hosting, runtime: runtime
        )))
        controller.addTabViewItem(item(.general, "General", "gearshape", GeneralTab(
            hosting: hosting, updates: updates, uninstall: uninstall
        )))
        tabs = controller
        let window = NSWindow(contentViewController: controller)
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.toolbarStyle = .preference
        window.isReleasedWhenClosed = false
        window.delegate = self
        // Size it now: the tab's preferred size is only known after its first
        // layout, and a window shown before that can come up empty.
        window.setContentSize(Self.pageSize)
        window.center()
        return window
    }

    private static let pageSize = NSSize(width: 620, height: 440)

    private func item(_ tab: Tab, _ label: String, _ symbol: String, _ page: some View) -> NSTabViewItem {
        let hosting = NSHostingController(rootView: page.frame(width: Self.pageSize.width, height: Self.pageSize.height))
        hosting.sizingOptions = [.preferredContentSize]
        hosting.preferredContentSize = Self.pageSize
        let item = NSTabViewItem(viewController: hosting)
        item.label = label
        item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        return item
    }
}

/// Titles the window after the selected tab, as macOS settings windows do.
private final class TitledTabViewController: NSTabViewController {
    override func tabView(_ tabView: NSTabView, didSelect tabViewItem: NSTabViewItem?) {
        super.tabView(tabView, didSelect: tabViewItem)
        // The tab controller resets the title while it swaps the page in; set
        // it once that has finished.
        let label = tabViewItem?.label ?? "Bee Box Desktop"
        DispatchQueue.main.async { [weak self] in
            self?.view.window?.title = label
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.title = tabView.selectedTabViewItem?.label ?? "Bee Box Desktop"
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
    @ObservedObject var navigation: PreferencesWindowController.Navigation
    let startPairing: () -> Void
    @State private var selection: PairedBox.ID?
    @State private var confirmingRemoval: PairedBox?
    @State private var removalError: String?
    @State private var forceRemoval: PairedBox?

    var body: some View {
        TabPage(explanation: """
            A paired box opens from the Bee Box Desktop menu and can receive files from watched folders. \
            To pair, open the box in a browser, go to Settings → Companion Apps, choose Copy Link (Mac), \
            then choose Pair with a Box… here. Each box lists this Mac under its paired devices, where you can remove it.
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
        .sheet(item: $navigation.pairing) { model in
            PairingSheet(model: model) { navigation.pairing = nil }
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
            if let offer = model.clipboardOffer, model.text.isEmpty {
                HStack {
                    Image(systemName: "doc.on.clipboard")
                    Text("The clipboard has a pairing link for \(offer.label) (\(offer.host)).")
                    Spacer()
                    Button("Use It") { model.useClipboardOffer() }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.6)))
            }
            TextField("Paste a beebox://pair link", text: $model.text)
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
            Text("Added \(label). It is in the Bee Box Desktop menu.")
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
            Bee Box Desktop can run a box on this Mac, in a small virtual machine, instead of (or as well as) \
            pairing with a box that runs somewhere else. Its files are in \(Paths.box.path.replacingOccurrences(of: Paths.home.path, with: "~")), \
            and it opens in your browser at a localhost address that only this Mac can reach. \
            It needs the Mac to be awake; for a box your phone can reach all day, run it on a server instead.
            """) {
            Form {
                Section {
                    Toggle("Run a box on this Mac", isOn: Binding(get: { hosting.enabled }, set: { hosting.setEnabled($0) }))
                    Text("The first start downloads about 1 GB and unpacks it to a few GB. While this is off, Bee Box Desktop downloads nothing and runs no virtual machine.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if hosting.enabled {
                    Section("Status") {
                        Text(runtime.statusText)
                        ForEach(runtime.timingLines, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                        if !runtime.memorySummary.isEmpty {
                            Text(runtime.memorySummary).font(.caption).foregroundStyle(.secondary)
                        }
                        if let version = runtime.engine.version {
                            Text("Engine \(version)\(runtime.engine.checkedAt.map { " · checked \($0.formatted(.relative(presentation: .named)))" } ?? "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let note = runtime.engine.note {
                            Text(note).font(.caption).foregroundStyle(.secondary)
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
                        HStack {
                            Button("Check for Engine Updates…") { runtime.checkForEngineUpdate() }
                                .disabled(runtime.progress != nil)
                            Text("Looks for a newer engine and restarts the box on it. The box also checks at every start.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Section {
                        Text("To send this box files from a watched folder, pair with it like any other box: open it in the browser, then Settings → Companion Apps → Copy Link (Mac).")
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
    @State private var notifications: UploadNotifications.Status?

    var body: some View {
        TabPage(explanation: "Bee Box Desktop lives in the menu bar. It needs to be running to watch folders and to run a box on this Mac.") {
            Form {
                Section {
                    Toggle("Open at Login", isOn: Binding(get: { hosting.opensAtLogin }, set: { hosting.setOpensAtLogin($0) }))
                    Text("Starts Bee Box Desktop when you log in, so watched folders keep sending after a restart.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let error = hosting.loginItemError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
                Section("Notifications") {
                    HStack {
                        Text(notifications?.sentence ?? "…")
                        Spacer()
                        if notifications == .undecided {
                            Button("Allow Notifications…") {
                                Task { notifications = await UploadNotifications.requestAndReport() }
                            }
                        } else {
                            Button("Open Notification Settings") { UploadNotifications.openSettings() }
                        }
                    }
                    Text("Bee Box Desktop sends one notification when a watched folder sends files or a box refuses one. Problems that last show in the menu instead.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Updates") {
                    HStack {
                        Text("Bee Box Desktop \(BundleConfig.version)")
                        Spacer()
                        Button("Check for App Updates…") { updates.checkForUpdates() }
                            .disabled(!updates.enabled)
                    }
                    if !updates.enabled {
                        Text("This build does not update itself.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section {
                    HStack {
                        Text("Removes Bee Box Desktop, its downloaded image, and its settings. You choose whether your box files go too.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Uninstall Bee Box Desktop…", action: uninstall)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
        .task {
            notifications = await UploadNotifications.status()
            appLog("notifications status=\(notifications?.rawValue ?? "nil")")
        }
    }
}
