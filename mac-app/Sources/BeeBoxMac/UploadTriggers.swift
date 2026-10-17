import AppKit
import BeeBoxMacCore
import Combine
import CoreServices
import Foundation
import UserNotifications

/// When to sweep: a change in any upload folder (FSEvents), every 15 minutes
/// as the backstop for missed events and scans that landed while asleep, on
/// wake, and at launch. The old launchd agent used the same two triggers
/// (`scan-uploader/README.md`, "Scheduling the sweep").
@MainActor
final class UploadTriggers {
    private let coordinator: UploadCoordinator
    private let folders: UploadFolderStore
    private var stream: FSEventStreamRef?
    private var watchedPaths: [String] = []
    private var timer: Timer?
    private var wakeObserver: NSObjectProtocol?
    private var foldersWatch: AnyCancellable?
    static let interval: TimeInterval = 15 * 60

    init(coordinator: UploadCoordinator, folders: UploadFolderStore) {
        self.coordinator = coordinator
        self.folders = folders
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sweep(reason: "interval") }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.sweep(reason: "wake") }
        }
        foldersWatch = folders.$folders.sink { [weak self] folders in
            self?.watch(folders.map(\.folderPath))
        }
        sweep(reason: "launch")
    }

    private func sweep(reason: String) {
        guard !folders.folders.isEmpty else { return }
        appLog("upload sweep reason=\(reason)")
        Task { await coordinator.sweepAll() }
    }

    private func watch(_ paths: [String]) {
        guard paths != watchedPaths else { return }
        watchedPaths = paths
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
        }
        guard !paths.isEmpty else { return }
        var context = FSEventStreamContext(
            version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let triggers = Unmanaged<UploadTriggers>.fromOpaque(info).takeUnretainedValue()
            MainActor.assumeIsolated { triggers.sweep(reason: "folder-change") }
        }
        // A 2 s latency coalesces the burst of events a multi-page scan writes.
        guard let created = FSEventStreamCreate(
            nil, callback, &context, paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 2.0,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagNoDefer)
        ) else {
            appLog("upload folder watch could not start; the 15-minute sweep still runs")
            return
        }
        FSEventStreamSetDispatchQueue(created, .main)
        FSEventStreamStart(created)
        stream = created
    }
}

/// One notification per sweep that sent or was refused something
/// (`scan-uploader/src/cli/notify.ts`: silent on a quiet sweep, only new events).
enum UploadNotifications {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error {
                appLog("notification permission request failed: \(error)")
            } else if !granted {
                appLog("notifications not allowed; upload results show only in the menu")
            }
        }
    }

    static func post(_ notice: UploadNotice) {
        let content = UNMutableNotificationContent()
        var lines: [String] = []
        if notice.uploaded > 0 {
            lines.append("\(notice.uploaded) \(notice.uploaded == 1 ? "file" : "files") from \(notice.folderName) sent to \(notice.boxLabel).")
        }
        if !notice.newlyRejected.isEmpty {
            lines.append("\(notice.boxLabel) refused \(notice.newlyRejected.joined(separator: ", ")); \(notice.newlyRejected.count == 1 ? "it stays" : "they stay") in \(notice.folderName).")
        }
        content.title = "Bee Box"
        content.body = lines.joined(separator: " ")
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error { appLog("notification failed: \(error)") }
        }
    }
}
