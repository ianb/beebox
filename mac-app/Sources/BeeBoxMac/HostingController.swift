import AppKit
import BeeBoxMacCore
import Combine
import Foundation
import ServiceManagement

/// "Run a box on this Mac" and the other General settings. With hosting off
/// the runtime is never started, so nothing is downloaded and no VM disk is
/// made.
@MainActor
final class HostingController: ObservableObject {
    @Published private(set) var enabled: Bool
    @Published private(set) var runtimeExists: Bool
    @Published private(set) var opensAtLogin: Bool
    @Published private(set) var loginItemError: String?

    private let runtime: BoxRuntime
    private let boxStore: BoxStore
    private let defaults: UserDefaults
    private var phaseWatch: AnyCancellable?

    init(runtime: BoxRuntime, boxStore: BoxStore, defaults: UserDefaults) {
        self.runtime = runtime
        self.boxStore = boxStore
        self.defaults = defaults
        enabled = HostingPreference.read(
            defaults,
            existingBoxFolder: FileManager.default.fileExists(atPath: Paths.box.appending(path: ".beebox/box.json").path)
        )
        runtimeExists = FileManager.default.fileExists(atPath: Paths.runtime.path)
        opensAtLogin = SMAppService.mainApp.status == .enabled
        // The local box joins the box list when it is serving, at whatever URL
        // the runtime chose (BEEBOX_PORT moves it).
        phaseWatch = runtime.$phase.sink { [weak boxStore] phase in
            if case .running(let url) = phase {
                boxStore?.setLocalBox(label: "This Mac", baseURL: url)
            }
        }
    }

    /// At launch: start the box only when hosting is on.
    func startIfEnabled() {
        if enabled { runtime.start() }
    }

    func setEnabled(_ value: Bool) {
        guard value != enabled else { return }
        enabled = value
        HostingPreference.write(value, to: defaults)
        appLog("hosting \(value ? "on" : "off")")
        if value {
            runtime.start()
            runtimeExists = true
        } else {
            Task { await runtime.stop() }
        }
    }

    func confirmRemoveRuntime() {
        guard !enabled else { return }
        let alert = NSAlert()
        alert.messageText = "Remove the downloaded box image?"
        alert.informativeText = """
            This deletes the box image and virtual machine disks in \(Paths.runtime.path). \
            Your boxes in \(Paths.boxes.path) are kept. Turning hosting on again downloads the image again.
            """
        alert.addButton(withTitle: "Remove")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try FileManager.default.removeItem(at: Paths.runtime)
            appLog("removed runtime directory")
        } catch {
            appLog("could not remove runtime directory: \(error)")
            let failure = NSAlert(error: error)
            failure.runModal()
        }
        runtimeExists = FileManager.default.fileExists(atPath: Paths.runtime.path)
    }

    func setOpensAtLogin(_ value: Bool) {
        do {
            if value {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginItemError = nil
        } catch {
            loginItemError = "Could not change the login item: \(error.localizedDescription)"
            appLog("login item \(value ? "register" : "unregister") failed: \(error)")
        }
        opensAtLogin = SMAppService.mainApp.status == .enabled
    }
}
