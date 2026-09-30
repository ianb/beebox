import AppKit
import SwiftUI

@main
struct BeeBoxMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            BoxMenu(runtime: delegate.runtime)
        } label: {
            BoxIcon(runtime: delegate.runtime)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let runtime = BoxRuntime()

    private var termSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        // SIGTERM (launchd, `kill`) stops the VM cleanly, then exits. It does
        // not go through NSApp.terminate: this handler runs as a main-queue
        // block, and terminateLater would wait on a stop task that needs the
        // same queue.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [runtime] in
            Task { @MainActor in
                await runtime.stop()
                exit(0)
            }
        }
        source.resume()
        termSource = source
        runtime.start()
    }

    /// Stop the VM cleanly before quitting so the box's git state is settled.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { @MainActor in
            await runtime.stop()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

struct BoxIcon: View {
    @ObservedObject var runtime: BoxRuntime

    var body: some View {
        Image(systemName: runtime.menuIcon)
            .accessibilityLabel("Bee Box: \(runtime.statusText)")
    }
}

struct BoxMenu: View {
    @ObservedObject var runtime: BoxRuntime

    var body: some View {
        Text(runtime.statusText)
        if !runtime.memorySummary.isEmpty {
            Text(runtime.memorySummary)
        }
        Divider()
        if case .running(let url) = runtime.phase {
            Button("Open Box") { NSWorkspace.shared.open(url) }
            if let setup = runtime.firstRunSetupURL {
                Button("Open First-Run Setup") { NSWorkspace.shared.open(setup) }
            }
            Button("Stop") { Task { await runtime.stop() } }
        } else if runtime.phase == .stopped || runtime.isFailedPhase {
            Button("Start") { runtime.start() }
        }
        Divider()
        Button("Show Box Folder") { NSWorkspace.shared.open(Paths.box) }
        Button("Show Log") { NSWorkspace.shared.open(Paths.log) }
        Divider()
        Button("Quit Bee Box") { NSApp.terminate(nil) }
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

    var menuIcon: String {
        switch phase {
        case .running: "shippingbox.fill"
        case .failed: "exclamationmark.triangle"
        case .stopped, .working: "shippingbox"
        }
    }
}
