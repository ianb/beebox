import AppKit
import BeeBoxMacCore
import SwiftUI

/// Preferences → Uploads: the watched folders and Photos albums, where each
/// sends its files, what happens to a file after upload, and its status.
struct UploadsTab: View {
    @ObservedObject var folders: UploadFolderStore
    @ObservedObject var coordinator: UploadCoordinator
    @ObservedObject var boxStore: BoxStore
    @State private var adding: AddUploadModel?
    @State private var selection: UploadFolder.ID?
    @State private var removalFailure: (folder: UploadFolder, message: String)?
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let failure = folders.loadFailure {
                Text("Upload settings could not be read, so nothing will be saved: \(failure)").foregroundStyle(.red)
            }
            if folders.folders.isEmpty {
                Text("No upload folders. Add the folder your scanner saves to, or a Photos album, and new files go to a box.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(folders.folders, selection: $selection) { folder in
                    UploadRow(folder: folder, status: coordinator.statuses[folder.id], box: box(for: folder), folders: folders) { box in
                        Task { message = await coordinator.reconnect(box: box)?.message }
                    }
                }
            }
            if let message {
                Text(message).foregroundStyle(.red)
            }
            HStack {
                Button("Add Folder…") { addFolder() }
                Button("Add Photos Album…") { Task { await addAlbum() } }
                Spacer()
                Button("Send Now") { Task { await coordinator.sweepAll() } }
                    .disabled(folders.folders.isEmpty)
                Button("Remove…") { Task { await remove(force: false) } }
                    .disabled(selection == nil)
            }
        }
        .sheet(item: $adding) { model in
            AddUploadSheet(model: model, boxes: pairedBoxes) { adding = nil } add: { box in
                await add(model, box: box)
            }
        }
        .alert(
            "The scanner credential was not revoked",
            isPresented: Binding(get: { removalFailure != nil }, set: { if !$0 { removalFailure = nil } }),
            presenting: removalFailure
        ) { failure in
            Button("Remove Anyway", role: .destructive) {
                Task {
                    _ = await coordinator.removeFolder(failure.folder, force: true)
                    removalFailure = nil
                }
            }
            Button("Keep", role: .cancel) {}
        } message: { failure in
            Text("\(failure.message)\n\nRemove anyway leaves the credential on the box until you revoke it there under Settings → Scan uploaders.")
        }
    }

    /// Boxes this Mac holds a device token for: only those can get a scanner
    /// credential.
    private var pairedBoxes: [PairedBox] {
        boxStore.boxes.filter { boxStore.token(for: $0) != nil }
    }

    private func box(for folder: UploadFolder) -> PairedBox? {
        boxStore.boxes.first { $0.id == folder.boxID }
    }

    private func addFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.message = "Choose the folder your scanner saves to."
        NSApp.activate()
        guard panel.runModal() == .OK, let url = panel.url else { return }
        adding = AddUploadModel(kind: .folder(url), boxID: pairedBoxes.first?.id)
    }

    private func addAlbum() async {
        guard await PhotosExporter.requestAccess() else {
            message = FolderProblem.photos(.accessDenied).message
            return
        }
        let albums = PhotosExporter.albums()
        guard let first = albums.first else {
            message = "Photos has no albums. Make one, add photos to it, and try again."
            return
        }
        adding = AddUploadModel(kind: .album(albums, chosen: first), boxID: pairedBoxes.first?.id)
    }

    private func add(_ model: AddUploadModel, box: PairedBox) async -> String? {
        switch model.kind {
        case .folder(let url):
            return await coordinator.addFolder(path: url.path, box: box, disposition: model.disposition)?.message
        case .album(_, let album):
            // Photos exports live in a visible folder, kept as exported: the
            // ledger and the files are what stop a photo from uploading twice.
            let folder = FileManager.default.homeDirectoryForCurrentUser
                .appending(path: "Pictures/Bee Box/\(album.title.replacingOccurrences(of: "/", with: "-"))", directoryHint: .isDirectory)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            } catch {
                return "Could not make \(folder.path): \(error.localizedDescription)"
            }
            return await coordinator.addFolder(path: folder.path, box: box, disposition: .keep, photosAlbum: album)?.message
        }
    }

    private func remove(force: Bool) async {
        guard let folder = folders.folders.first(where: { $0.id == selection }) else { return }
        switch await coordinator.removeFolder(folder, force: force) {
        case .removed:
            selection = nil
        case .revokeFailed(let reason):
            removalFailure = (folder, reason)
        }
    }
}

private struct UploadRow: View {
    let folder: UploadFolder
    let status: FolderStatus?
    let box: PairedBox?
    @ObservedObject var folders: UploadFolderStore
    let reconnect: (PairedBox) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: folder.photosAlbum == nil ? "folder" : "photo.on.rectangle")
                Text(folder.photosAlbum.map { "Photos “\($0.title)”" } ?? folder.folder.lastPathComponent)
                Text("→ \(box?.label ?? "missing box")").foregroundStyle(.secondary)
                Spacer()
                if folder.photosAlbum == nil {
                    Picker("After upload", selection: Binding(
                        get: { folder.disposition },
                        set: { value in
                            var changed = folder
                            changed.disposition = value
                            folders.update(changed)
                        }
                    )) {
                        Text("Keep").tag(UploadDisposition.keep)
                        Text("Move to “imported”").tag(UploadDisposition.archive)
                        Text("Move to Trash").tag(UploadDisposition.trash)
                    }
                    .labelsHidden()
                    .frame(width: 170)
                }
            }
            Text(UploadStatusText.line(for: status))
                .font(.caption)
                .foregroundStyle(status?.problem == nil ? Color.secondary : Color.red)
            if status?.problem == .sweep(.credentialRefused), let box {
                Button("Reconnect") { reconnect(box) }.controlSize(.small)
            }
        }
        .help(folder.folderPath)
    }
}

/// The one-line status the Uploads row and the menu share.
enum UploadStatusText {
    static func line(for status: FolderStatus?) -> String {
        guard let status else { return "Waiting for the first sweep" }
        if let problem = status.problem { return problem.message }
        var parts: [String] = []
        if let sent = status.lastSentAt {
            parts.append("last sent \(sent.formatted(date: .omitted, time: .shortened))")
        } else if let swept = status.lastSweepAt {
            parts.append("checked \(swept.formatted(date: .omitted, time: .shortened)), nothing new")
        }
        if status.rejectedInFolder > 0 {
            parts.append("\(status.rejectedInFolder) refused by the box, left in the folder")
        }
        return parts.joined(separator: " · ")
    }
}

/// The add sheet's state: a folder or an album, its box, and its disposition.
@MainActor
final class AddUploadModel: ObservableObject, Identifiable {
    enum Kind {
        case folder(URL)
        case album([PhotosAlbumRef], chosen: PhotosAlbumRef)
    }

    @Published var kind: Kind
    @Published var boxID: PairedBox.ID?
    @Published var disposition: UploadDisposition = .keep
    @Published var working = false
    @Published var failure: String?

    init(kind: Kind, boxID: PairedBox.ID?) {
        self.kind = kind
        self.boxID = boxID
    }
}

private struct AddUploadSheet: View {
    @ObservedObject var model: AddUploadModel
    let boxes: [PairedBox]
    let close: () -> Void
    let add: (PairedBox) async -> String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch model.kind {
            case .folder(let url):
                Text("Send new files in “\(url.lastPathComponent)”").font(.headline)
                Text(url.path).font(.caption).foregroundStyle(.secondary)
                Picker("After upload", selection: $model.disposition) {
                    Text("Keep the file").tag(UploadDisposition.keep)
                    Text("Move it into “imported”").tag(UploadDisposition.archive)
                    Text("Move it to the Trash").tag(UploadDisposition.trash)
                }
            case .album(let albums, let chosen):
                Text("Send new photos from a Photos album").font(.headline)
                Picker("Album", selection: Binding(
                    get: { chosen.identifier },
                    set: { id in
                        if let album = albums.first(where: { $0.identifier == id }) { model.kind = .album(albums, chosen: album) }
                    }
                )) {
                    ForEach(albums, id: \.identifier) { Text($0.title).tag($0.identifier) }
                }
                Text("Photos are exported to ~/Pictures/Bee Box and kept there.").font(.caption).foregroundStyle(.secondary)
            }
            if boxes.isEmpty {
                Text("Pair this Mac with a box first, on the Boxes tab.").foregroundStyle(.red)
            } else {
                Picker("Send to", selection: $model.boxID) {
                    ForEach(boxes) { Text($0.label).tag(Optional($0.id)) }
                }
                Text("The first folder for a box creates a scanner credential for this Mac on that box. It is listed under the box's Settings → Scan uploaders.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let failure = model.failure {
                Text(failure).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel", action: close).keyboardShortcut(.cancelAction)
                Button("Start Uploading") {
                    guard let box = boxes.first(where: { $0.id == model.boxID }) else { return }
                    model.working = true
                    Task {
                        let failure = await add(box)
                        model.working = false
                        if let failure {
                            model.failure = failure
                        } else {
                            UploadNotifications.requestPermission()
                            close()
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.working || boxes.first(where: { $0.id == model.boxID }) == nil)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}
