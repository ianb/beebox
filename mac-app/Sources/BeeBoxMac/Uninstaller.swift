import AppKit

/// "Uninstall Bee Box…": stops the box, deletes what the app keeps outside
/// its bundle, and moves the app to the Trash. Boxes are the user's data, so
/// they stay unless the user ticks the checkbox, and then they go to the Trash
/// rather than being deleted. Shared data is deleted outright so the space
/// comes back.
@MainActor
enum Uninstaller {
    /// What the app leaves outside its bundle, besides the boxes.
    private static var leftovers: [URL] {
        let library = Paths.home.appending(path: "Library", directoryHint: .isDirectory)
        let id = Bundle.main.bundleIdentifier ?? "run.beebox.mac"
        return [
            Paths.support,
            library.appending(path: "Preferences/\(id).plist"),
            library.appending(path: "Caches/\(id)", directoryHint: .isDirectory),
            library.appending(path: "HTTPStorages/\(id)", directoryHint: .isDirectory),
            library.appending(path: "HTTPStorages/\(id).binarycookies"),
        ]
    }

    static func run(stopBox: @escaping () async -> Void) {
        NSApp.activate()
        let boxes = boxFolders()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Uninstall Bee Box?"
        alert.informativeText = """
            This stops your box, deletes Bee Box's shared data (\(sizeText(of: Paths.support))): the downloaded \
            image, accounts, agent sign-ins, and logs. Then it moves Bee Box to the Trash.

            Your boxes in \(displayPath(Paths.boxes)) are kept unless you choose otherwise.
            """
        let deleteBoxes = NSButton(
            checkboxWithTitle: "Also move my boxes to the Trash (\(boxes.count) in \(displayPath(Paths.boxes)))",
            target: nil, action: nil
        )
        deleteBoxes.state = .off
        deleteBoxes.isEnabled = !boxes.isEmpty
        alert.accessoryView = deleteBoxes
        let uninstall = alert.addButton(withTitle: "Uninstall")
        uninstall.hasDestructiveAction = true
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let trashBoxes = deleteBoxes.state == .on
        Task { @MainActor in
            appLog("uninstalling\(trashBoxes ? " (boxes to the Trash)" : "")")
            await stopBox()
            var failures: [String] = []
            let fm = FileManager.default
            if trashBoxes {
                for box in boxes {
                    do { try fm.trashItem(at: box, resultingItemURL: nil) } catch { failures.append("\(box.path): \(error.localizedDescription)") }
                }
                // Leave ~/BeeBox itself only if something else is in it.
                if (try? fm.contentsOfDirectory(atPath: Paths.boxes.path))?.isEmpty == true {
                    try? fm.removeItem(at: Paths.boxes)
                }
            }
            if let id = Bundle.main.bundleIdentifier {
                UserDefaults.standard.removePersistentDomain(forName: id)
            }
            for url in leftovers where fm.fileExists(atPath: url.path) {
                do { try fm.removeItem(at: url) } catch { failures.append("\(url.path): \(error.localizedDescription)") }
            }
            do {
                try fm.trashItem(at: Bundle.main.bundleURL, resultingItemURL: nil)
            } catch {
                failures.append("\(Bundle.main.bundleURL.path): \(error.localizedDescription)")
            }
            if !failures.isEmpty {
                let report = NSAlert()
                report.messageText = "Bee Box could not remove everything"
                report.informativeText = "Remove these by hand:\n\n" + failures.joined(separator: "\n")
                report.runModal()
            }
            exit(0)
        }
    }

    private static func boxFolders() -> [URL] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: Paths.boxes.path) else { return [] }
        return names.sorted().map { Paths.box(named: $0) }.filter { url in
            fm.fileExists(atPath: url.appending(path: ".beebox/box.json").path)
        }
    }

    private static func displayPath(_ url: URL) -> String {
        url.path.replacingOccurrences(of: Paths.home.path, with: "~")
    }

    /// Allocated size, since the VM disk images are sparse.
    private static func sizeText(of url: URL) -> String {
        let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey]
        var total: Int64 = 0
        if let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys) {
            for case let file as URL in walker {
                total += Int64((try? file.resourceValues(forKeys: Set(keys)))?.totalFileAllocatedSize ?? 0)
            }
        }
        return ByteCountFormatter.string(fromByteCount: total, countStyle: .file)
    }
}
