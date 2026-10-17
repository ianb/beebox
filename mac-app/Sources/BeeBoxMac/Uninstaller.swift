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

    /// `revokeScanTokens` takes back the scan tokens this Mac minted on its
    /// boxes and returns a line for each it could not revoke.
    static func run(stopBox: @escaping () async -> Void, revokeScanTokens: @escaping () async -> [String]) {
        NSApp.activate()
        let boxes = boxFolders()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Uninstall Bee Box?"
        alert.informativeText = """
            This stops your box, deletes Bee Box's shared data (\(sizeText(of: Paths.support))): the downloaded \
            image, accounts, agent sign-ins, logs, and the paired boxes and their credentials. Then it moves \
            Bee Box to the Trash.

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
            // Revoke before the Keychain is cleared: after that this Mac can no
            // longer reach its boxes as itself.
            let unrevoked = await revokeScanTokens()
            for line in unrevoked {
                appLog("scan token not revoked: \(line)")
            }
            // Paired boxes' credentials live in the Keychain, outside the
            // shared data folder.
            for store in MacKeychain.all {
                let removed = store.purgeOrphanTokens(knownBoxIDs: [])
                appLog("removed \(removed) Keychain item(s) for \(store.service)")
            }
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
            if !failures.isEmpty || !unrevoked.isEmpty {
                let report = NSAlert()
                report.messageText = "Bee Box could not remove everything"
                var text = ""
                if !failures.isEmpty {
                    text += "Remove these by hand:\n\n" + failures.joined(separator: "\n")
                }
                if !unrevoked.isEmpty {
                    if !text.isEmpty { text += "\n\n" }
                    text += "These scanner credentials are still active. Revoke them in each box's Settings → Scan uploaders:\n\n"
                        + unrevoked.joined(separator: "\n")
                }
                report.informativeText = text
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
