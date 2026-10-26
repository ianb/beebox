import AppKit
import BeeBoxMacCore
import BeeBoxShared
import Darwin
import SwiftUI

struct BeeBoxMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            BoxMenu(
                runtime: delegate.runtime,
                updates: delegate.updates,
                boxStore: delegate.boxStore,
                hosting: delegate.hosting,
                uploadFolders: delegate.uploadFolders,
                uploads: delegate.uploads,
                preferences: delegate.preferences,
                quit: delegate.stopAndExit
            )
        } label: {
            BoxIcon(runtime: delegate.runtime, uploads: delegate.uploads)
        }
    }
}

/// Dispatch command-line operations before SwiftUI constructs the app, app
/// delegate, or Sparkle update controller.
@main
enum BeeBoxMacMain {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.first == "backup" else {
            BeeBoxMacApp.main()
            return
        }
        let code = BackupControlClient.run(
            arguments: Array(arguments.dropFirst()),
            socketPath: Paths.run.appending(path: "backup-control.sock").path
        )
        exit(code)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let runtime = BoxRuntime()
    let updates = Updates()
    let boxStore = BoxStore(
        storageURL: Paths.support.appending(path: "paired-boxes.json"),
        credentials: MacKeychain.deviceTokens,
        redeemer: PairingRedeemer(
            transport: URLSessionTransport(session: .shared),
            userAgent: "BeeBox-Mac/\(BundleConfig.version)"
        ),
        deviceLabel: Host.current().localizedName ?? "Mac"
    )
    lazy var hosting = HostingController(runtime: runtime, boxStore: boxStore, defaults: .standard)
    let uploadFolders = UploadFolderStore(storageURL: Paths.support.appending(path: "upload-folders.json"))
    lazy var uploads = UploadCoordinator(
        folders: uploadFolders,
        boxes: boxStore,
        scanTokens: MacKeychain.scanTokens,
        tokenClient: ScanTokenClient(transport: URLSessionTransport(session: .shared), userAgent: "BeeBox-Mac/\(BundleConfig.version)"),
        sweeper: ScanSweep(
            transport: URLSessionTransport(session: .shared),
            clientBuild: "mac-\(BundleConfig.version)",
            now: { Date() },
            sleep: { duration in
                do {
                    try await Task.sleep(for: duration)
                } catch {
                    // Cancelled: the sweep is being torn down with the app.
                }
            }
        ),
        photos: PhotosExporter(ledgerDirectory: Paths.support.appending(path: "photos", directoryHint: .isDirectory)),
        hostName: Host.current().localizedName ?? "mac",
        oldUploaderPlist: OldUploaderCheck.plistURL(home: Paths.home),
        now: { Date() },
        notify: UploadNotifications.post
    )
    private lazy var uploadTriggers = UploadTriggers(coordinator: uploads, folders: uploadFolders)
    lazy var preferences = PreferencesWindowController(
        boxStore: boxStore,
        hosting: hosting,
        runtime: runtime,
        updates: updates,
        uploadFolders: uploadFolders,
        uploads: uploads
    ) { [runtime, uploads] in
        Uninstaller.run {
            await runtime.stop()
        } revokeScanTokens: {
            await uploads.revokeAllScanTokens()
        }
    }

    private var termSource: DispatchSourceSignal?
    private var backupControl: BackupControlServer?

    override init() {
        MacLog.setFileSink { line in AppLogFile.shared.append(line) }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        // SIGTERM (launchd, `kill`) stops the VM cleanly, then exits. It does
        // not go through NSApp.terminate: this handler runs as a main-queue
        // block, and terminateLater would wait on a stop task that needs the
        // same queue.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in self?.stopAndExit() }
        source.resume()
        termSource = source
        do {
            backupControl = try BackupControlServer(path: Paths.run.appending(path: "backup-control.sock").path) { [runtime] command in
                await runtime.runBackupCommand(command)
            }
        } catch {
            appLog("backup control socket failed: \(error)")
        }
        appLog("launch version=\(BundleConfig.version) hosting=\(hosting.enabled ? "on" : "off") boxes=\(boxStore.boxes.count) watched=\(uploadFolders.folders.count)")
        hosting.startIfEnabled()
        if !uploadFolders.folders.isEmpty { UploadNotifications.requestPermission() }
        uploadTriggers.start()
    }

    /// `beebox://pair` links clicked in a browser. Every link goes to the
    /// pairing sheet; nothing is redeemed until the person clicks Add.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard url.scheme == "beebox", url.host() == "pair" else {
                appLog("open url ignored reason=unhandled-link")
                continue
            }
            preferences.startPairing(link: url.absoluteString)
        }
    }

    /// Stop the box, then exit. Quit and SIGTERM both come here; neither goes
    /// through NSApp.terminate's terminateLater, which left the app running
    /// after the box stopped (a second Quit was needed).
    func stopAndExit() {
        Task { @MainActor in
            await runtime.stop()
            exit(0)
        }
    }

    /// Anything else that asks the app to terminate (logout, restart) also
    /// stops the box first.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stopAndExit()
        return .terminateCancel
    }
}

struct BoxIcon: View {
    @ObservedObject var runtime: BoxRuntime
    @ObservedObject var uploads: UploadCoordinator

    var body: some View {
        // An upload problem marks the icon until a sweep clears it; it is
        // never a notification (the design doc's "Uploads stuck" row).
        if uploads.hasStandingProblem, !runtime.isFailedPhase {
            Image(systemName: "exclamationmark.triangle")
                .accessibilityLabel("Bee Box Desktop: a watched folder needs attention")
        } else {
            Image(systemName: runtime.menuIcon)
                .accessibilityLabel("Bee Box Desktop: \(runtime.statusText)")
        }
    }
}

struct BoxMenu: View {
    @ObservedObject var runtime: BoxRuntime
    @ObservedObject var updates: Updates
    @ObservedObject var boxStore: BoxStore
    @ObservedObject var hosting: HostingController
    @ObservedObject var uploadFolders: UploadFolderStore
    @ObservedObject var uploads: UploadCoordinator
    let preferences: PreferencesWindowController
    let quit: () -> Void

    var body: some View {
        Button("Preferences…") { preferences.show(.boxes) }
            .keyboardShortcut(",")
        Button("Pair with a Box…") { preferences.startPairing() }
        Divider()
        let remoteBoxes = boxStore.boxes.filter { !$0.hostedLocally }
        if remoteBoxes.isEmpty && !hosting.enabled {
            Text("No boxes paired")
        }
        ForEach(remoteBoxes) { box in
            Button("Open \(box.label)") { NSWorkspace.shared.open(box.baseURL) }
        }
        if !uploadFolders.folders.isEmpty {
            Divider()
            Text("Watched Folders")
            ForEach(uploadFolders.folders) { folder in
                Menu("\(WatchedFolderText.name(folder)) — \(UploadStatusText.line(for: uploads.statuses[folder.id]))") {
                    Button("Show in Finder") { NSWorkspace.shared.open(folder.folder) }
                    Button("Send New Files Now") { Task { await uploads.sweepAll() } }
                    Button("Watched Folder Settings…") { preferences.show(.watched) }
                }
            }
        }
        if hosting.enabled {
            Divider()
            Text("Box on this Mac: \(runtime.statusText)")
            ForEach(runtime.timingLines, id: \.self) { Text($0) }
            if case .running(let url) = runtime.phase {
                Button("Open Box on this Mac") { NSWorkspace.shared.open(url) }
                if let setup = runtime.firstRunSetupURL {
                    Button("Open First-Run Setup") { NSWorkspace.shared.open(setup) }
                }
            }
            Button("Show Box Files") { NSWorkspace.shared.open(Paths.box) }
            if runtime.isRunning {
                Button("Stop Box") { Task { await runtime.stop() } }
            } else if runtime.phase == .stopped || runtime.isFailedPhase {
                Button("Start Box") { runtime.start() }
            }
        }
        Divider()
        if let version = updates.available {
            Button("Update to Bee Box Desktop \(version)…") { updates.checkForUpdates() }
        }
        Button(runtime.isRunning ? "Stop Box and Quit" : "Quit Bee Box Desktop") { quit() }
    }
}

extension BoxRuntime {
    var statusText: String {
        switch phase {
        case .stopped: "Stopped"
        case .working(let step): step
        case .running(let url): "Running at \(url.host() ?? ""):\(url.port.map(String.init) ?? "")"
        case .failed(let reason): "Failed: \(reason)"
        }
    }

    var isFailedPhase: Bool {
        if case .failed = phase { return true }
        return false
    }

    /// Elapsed time and what to expect while starting or stopping; the last
    /// duration otherwise.
    var timingLines: [String] {
        if let progress {
            let elapsed = now.timeIntervalSince(progress.startedAt)
            let (estimate, measured) = timings.estimate(progress.operation)
            var lines = ["\(formatDuration(elapsed)) so far"]
            let range = timings.range(progress.operation)
            let wide = range.map { $0.upperBound > max($0.lowerBound * 3, $0.lowerBound + 5) } ?? false
            if let range, elapsed > range.upperBound * 1.5 {
                lines[0] += " — longer than recent runs (up to \(formatDuration(range.upperBound)))"
            } else if let range, wide {
                lines[0] += " · recently between \(formatDuration(range.lowerBound)) and \(formatDuration(range.upperBound))"
            } else if measured {
                lines[0] += " · usually about \(formatDuration(estimate))"
            } else {
                lines[0] += " · allow up to about \(formatDuration(estimate)) the first time"
            }
            if !measured, elapsed > estimate * 1.5 {
                lines[0] += " — longer than expected"
            }
            if phase == .working("Waiting for the server…"), elapsed > 60 {
                lines.append("The box may be waiting on a lock from an earlier forced stop; that clears within 5 minutes.")
            }
            return lines
        }
        guard let last = lastCompleted else { return [] }
        let verb = switch last.operation {
        case .firstStart: "First start took"
        case .start: "Started in"
        case .stop: "Stopped in"
        }
        return ["\(verb) \(formatDuration(last.seconds))"]
    }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    /// Filled box: serving. Hourglass: starting or stopping. Outline box:
    /// stopped. Warning: failed.
    var menuIcon: String {
        switch phase {
        case .running: "shippingbox.fill"
        case .working: "hourglass"
        case .failed: "exclamationmark.triangle.fill"
        case .stopped: "shippingbox"
        }
    }
}
