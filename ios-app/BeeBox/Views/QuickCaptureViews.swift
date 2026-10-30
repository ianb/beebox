import SwiftUI
import AVKit
import CoreTransferable
import UniformTypeIdentifiers

private struct CaptureRow: Identifiable {
    var id: UUID
    var input: String?
    var material: QuickCaptureMaterial?
    var parentID: UUID?
    var state: String
    var error: String?
    var sourceRef: String?
    var transcript: String?
    var recordingInterrupted: Bool? = nil
    var delivery: QuickChatView?
    var local: QuickCaptureRecord?

    var title: String {
        if state == "gone" { return "Deleted capture" }
        if parentID != nil { return input ?? "Added context" }
        if material?.kind == "audio" { return "Voice note" }
        if let input, !input.isEmpty { return input }
        return material?.title ?? material?.url ?? material?.text ?? "Shared image"
    }
    var statusLine: String {
        if state == "gone" { return local?.status.serverAccepted == false ? "Discarded from phone" : "Deleted from box" }
        if let delivery {
            switch delivery.state {
            case .needsChoice: return "Saved — choose a conversation"
            case .sending: return delivery.expired == true ? "Saved — delivery needs attention" : "Saved — waiting for delivery"
            case .sent: return delivery.queued == true ? "Saved — queued in chat" : "Saved — sent to chat"
            case .discarded: return "Saved — chat delivery discarded"
            }
        }
        switch state {
        case "saved-on-phone": return "Saved on phone — waiting for the box"
        case "discard-pending": return "Discard requested — waiting for box confirmation"
        case "waiting-for-original": return "Saved on phone — waiting for original capture"
        case "uploading": return "Saved on phone — uploading"
        case "accepted", "preparing": return "Accepted by box — preparing"
        case "saved", "ready": return "Saved in box"
        case "gone": return "Deleted from box"
        case "interrupted-draft": return "Save interrupted — phone copy may be incomplete"
        case "failed", "needs-retry", "blocked", "unsupported", "needs-repair": return "Saved — needs attention"
        default: return state.replacingOccurrences(of: "-", with: " ").capitalized
        }
    }
}

@MainActor
private final class CaptureListModel: ObservableObject {
    @Published var rows: [CaptureRow] = []
    @Published var error: String?
    @Published var working = false
    #if DEBUG
    var fixtureMode = false
    var fixtureImage: UIImage?
    #endif
    var isFixture: Bool {
        #if DEBUG
        fixtureMode
        #else
        false
        #endif
    }
    func image(for row: CaptureRow) -> UIImage? {
        #if DEBUG
        if fixtureMode { return fixtureImage }
        #endif
        guard row.local != nil else { return nil }
        return UIImage(contentsOfFile: QuickCaptureStore.shared.materialURL(for: row.id).path)
    }
    private var remote: [QuickCaptureRemoteRecord] = []
    private var remoteBoxID: UUID?

    func localRefresh(box: PairedBox) {
        guard !isFixture else { return }
        if remoteBoxID != box.id { remote = []; remoteBoxID = box.id; rows = []; error = nil }
        do {
            let locals = try QuickCaptureStore.shared.records().filter { $0.boxID == box.id }
            var values = Dictionary(uniqueKeysWithValues: remote.map { record in
                (record.id, CaptureRow(id: record.id, input: record.input, material: record.material,
                    parentID: record.parentCaptureId, state: record.state, error: record.error,
                    sourceRef: record.sourceRef, transcript: record.transcript, recordingInterrupted: record.recordingInterrupted, delivery: record.delivery))
            })
            for record in locals {
                let prior = values[record.id]
                values[record.id] = CaptureRow(id: record.id, input: record.declaration.input,
                    material: record.declaration.material, parentID: record.declaration.parentCaptureId,
                    state: record.status.discardRequested == true ? record.status.state : prior?.state ?? record.status.state,
                    error: record.status.discardRequested == true ? record.status.error : prior?.error ?? record.status.error,
                    sourceRef: prior?.sourceRef ?? record.status.sourceRef,
                    transcript: prior?.transcript ?? record.status.transcript,
                    recordingInterrupted: record.declaration.recordingInterrupted,
                    delivery: prior?.delivery ?? record.status.delivery, local: record)
            }
            rows = values.values.sorted { first, second in
                let a = first.local?.createdAt ?? Date.distantPast
                let b = second.local?.createdAt ?? Date.distantPast
                return a == b ? first.id.uuidString < second.id.uuidString : a > b
            }
        } catch {
            self.error = "Could not read saved captures. Your existing files have not been discarded."
            BoxLog.warn("quick capture list read failed error=\(type(of: error))", category: .capture, targetBoxID: box.id)
        }
    }

    func refresh(box: PairedBox) async {
        guard !isFixture else { return }
        localRefresh(box: box)
        do {
            let loaded = try await QuickCaptureAPI(box: box).list()
            guard remoteBoxID == box.id, !Task.isCancelled else { return }
            remote = loaded
            error = nil
            for record in remote where (try? QuickCaptureStore.shared.record(record.id)) != nil {
                try QuickCaptureUploadCoordinator.shared.apply(remote: record)
            }
        } catch {
            guard remoteBoxID == box.id, !Task.isCancelled else { return }
            self.error = "Could not refresh from the box. Captures saved on this phone remain available."
            BoxLog.warn("quick capture remote list failed error=\(type(of: error))", category: .capture, targetBoxID: box.id)
        }
        localRefresh(box: box)
    }

    func delete(row: CaptureRow, box: PairedBox) async throws {
        guard !isFixture else { rows.removeAll { $0.id == row.id }; return }
        if let local = row.local {
            try await QuickCaptureUploadCoordinator.shared.requestDiscard(record: local, box: box)
        } else {
            _ = try await QuickCaptureAPI(box: box).delete(id: row.id)
        }
        await refresh(box: box)
    }

    func submitContext(parent: UUID, words: String, box: PairedBox) async throws {
        if isFixture {
            rows.insert(CaptureRow(id: UUID(), input: words, parentID: parent, state: "waiting-for-original"), at: 0)
            return
        }
        let record = try QuickCaptureStore.shared.accept(box: box, source: .nativeInput, input: words, parentCaptureID: parent)
        localRefresh(box: box)
        do { try await QuickCaptureUploadCoordinator.shared.schedule(record: record, box: box) }
        catch {
            // Words already persist. Delivery failure is visible in the capture status.
            BoxLog.warn("quick capture context pending id=\(record.id) error=\(type(of: error))", category: .capture, targetBoxID: box.id)
        }
        localRefresh(box: box)
    }

    func retry(row: CaptureRow, box: PairedBox) async {
        guard !isFixture else { return }
        working = true
        defer { working = false }
        do {
            if row.local?.status.serverAccepted == true || remote.contains(where: { $0.id == row.id }) {
                _ = try await QuickCaptureAPI(box: box).retry(id: row.id)
            } else if let local = row.local {
                try await QuickCaptureUploadCoordinator.shared.retry(record: local, box: box)
            }
            error = nil
            await refresh(box: box)
        } catch {
            self.error = "Could not safely retry. The original remains saved; check the box connection and receipt."
            BoxLog.warn("quick capture retry failed id=\(row.id) error=\(type(of: error))", category: .capture, targetBoxID: box.id)
        }
    }

    func choose(row: CaptureRow, candidate: String, box: PairedBox) async {
        guard !isFixture else { return }
        working = true
        defer { working = false }
        do { _ = try await QuickCaptureAPI(box: box).choose(id: row.id, candidateID: candidate); await refresh(box: box) }
        catch { self.error = error.localizedDescription }
    }
}

private struct RemoteListKey: Equatable {
    var boxID: UUID
    var boxAwake: Bool
}

struct QuickCaptureSection: View {
    let box: PairedBox
    let boxes: [PairedBox]
    /// The box screen's check since the app came forward found the box awake.
    /// Until then the list shows this phone's captures only: asking the box
    /// would wake a sleeping one (mobile-contract §5.11).
    var boxAwake: Bool
    var onOpen: (String) -> Void
    @StateObject private var model: CaptureListModel
    @State private var captureDefault: UUID?

    init(box: PairedBox, boxes: [PairedBox], boxAwake: Bool, onOpen: @escaping (String) -> Void) {
        self.box = box; self.boxes = boxes; self.boxAwake = boxAwake; self.onOpen = onOpen
        _model = StateObject(wrappedValue: CaptureListModel())
        _captureDefault = State(initialValue: CaptureDestinationStore().defaultBoxID)
    }
    #if DEBUG
    fileprivate init(box: PairedBox, boxes: [PairedBox], model: CaptureListModel, captureDefault: UUID?) {
        self.box = box; self.boxes = boxes; self.boxAwake = true; self.onOpen = { _ in }
        _model = StateObject(wrappedValue: model)
        _captureDefault = State(initialValue: captureDefault)
    }
    #endif
    @State private var voiceBox: PairedBox?
    @State private var voiceError: String?

    var body: some View {
        Section("Capture") {
            Picker("Capture default", selection: $captureDefault) {
                Text("Choose a box").tag(Optional<UUID>.none)
                ForEach(boxes) { candidate in Text(candidate.label).tag(Optional(candidate.id)) }
            }
            .onChange(of: captureDefault) { _, id in if !model.isFixture { CaptureDestinationStore().defaultBoxID = id } }
            Text("Browsing another box does not change this default. Siri cannot capture into a protected box.")
                .font(.caption).foregroundStyle(.secondary)
            Button("Record a voice note", systemImage: "mic") {
                guard !model.isFixture else { return }
                do {
                    voiceBox = try CaptureDestinationStore().resolve(boxes: boxes,
                        pinnedBoxID: VoiceNoteCoordinator.shared.draft?.boxID, allowsProtected: true)
                    voiceError = nil
                } catch { voiceError = error.localizedDescription }
            }
            if let voiceError { Text(voiceError).foregroundStyle(.red) }
            Button("Refresh captures") { Task { await model.refresh(box: box) } }
            if let error = model.error { Text(error).font(.caption).foregroundStyle(.secondary) }
            ForEach(model.rows) { row in
                NavigationLink {
                    QuickCaptureDetail(rowID: row.id, model: model, box: box, onOpen: onOpen)
                } label: {
                    VStack(alignment: .leading) {
                        Text(row.title).lineLimit(2)
                        Text(row.statusLine).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .task(id: RemoteListKey(boxID: box.id, boxAwake: boxAwake)) {
            if !model.isFixture { captureDefault = CaptureDestinationStore().defaultBoxID }
            if boxAwake {
                await model.refresh(box: box)
            } else {
                model.localRefresh(box: box)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: QuickCaptureStore.didChange).receive(on: DispatchQueue.main)) { _ in
            if !model.isFixture { captureDefault = CaptureDestinationStore().defaultBoxID }
            model.localRefresh(box: box)
        }
        .sheet(item: $voiceBox) { target in
            NavigationStack {
                VoiceNoteView(coordinator: .shared, box: target, boxes: boxes)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { voiceBox = nil } } }
            }
        }
    }
}

private struct QuickCaptureDetail: View {
    let rowID: UUID
    @ObservedObject var model: CaptureListModel
    let box: PairedBox
    var onOpen: (String) -> Void
    @State private var words = ""
    @State private var result: String?
    @State private var error: String?
    @State private var audioPlayer: AVPlayer?
    @State private var saving = false
    @State private var confirmingDelete = false

    private var row: CaptureRow? { model.rows.first { $0.id == rowID } }
    var body: some View {
        List {
            if let row {
                Section {
                    Text(box.label).font(.headline)
                    Text(row.statusLine)
                    if row.recordingInterrupted == true && row.state != "gone" {
                        Text("Interrupted recording — the saved audio may end early.").foregroundStyle(.secondary)
                    }
                    if let message = row.error { Text(message).foregroundStyle(.red) }
                    if let message = model.error { Text(message).foregroundStyle(.secondary) }
                    if let error { Text(error).foregroundStyle(.red) }
                }
                if row.state != "gone", let material = row.material {
                    Section("Original material") {
                        if material.kind == "image", let image = model.image(for: row) {
                            Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Saved image")
                        }
                        if material.kind == "audio", row.local != nil {
                            Button("Play saved audio", systemImage: "play.circle") {
                                audioPlayer = AVPlayer(url: QuickCaptureStore.shared.materialURL(for: row.id))
                                audioPlayer?.play()
                            }
                            Button("Stop playback", systemImage: "stop.circle") { audioPlayer?.pause() }
                        }
                        if let url = material.url { Text(url).textSelection(.enabled) }
                        if let text = material.text { Text(text).textSelection(.enabled) }
                        if let source = row.sourceRef { Button("Open saved source") { onOpen("card/\(source)") } }
                    }
                }
                if row.state != "gone", let input = row.input { Section("Your words") { Text(input).textSelection(.enabled) } }
                if row.state != "gone", let transcript = row.transcript { Section("Transcript from audio") { Text(transcript).textSelection(.enabled) } }
                if let choices = row.delivery?.choices, row.delivery?.state == .needsChoice {
                    Section("Choose a conversation") {
                        ForEach(choices) { choice in
                            Button(choice.label) { Task { await model.choose(row: row, candidate: choice.candidateId, box: box) } }
                                .disabled(model.working)
                        }
                    }
                }
                if row.state != "gone" && row.state != "discard-pending" {
                    Section("Add context to this item") {
                        TextField("What should the box know or do?", text: $words, axis: .vertical).lineLimit(3...8)
                            .disabled(saving)
                        Text("These words stay with this item in \(box.label), including while offline.").font(.caption).foregroundStyle(.secondary)
                        Button(saving ? "Saving…" : "Save context") {
                            saving = true
                            Task {
                                do {
                                    try await model.submitContext(parent: row.parentID ?? row.id, words: words, box: box)
                                    words = ""; result = "Saved on your phone for \(box.label)."; error = nil
                                } catch { self.error = error.localizedDescription }
                                saving = false
                            }
                        }.disabled(saving || words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if let result { Text(result).foregroundStyle(.secondary) }
                        if let error { Text(error).foregroundStyle(.red) }
                    }
                    Section {
                        Button("Refresh status") { Task { await model.refresh(box: box) } }
                        Button("Delete saved capture", role: .destructive) { confirmingDelete = true }
                            .disabled(model.working || saving)
                        Button("Retry delivery or transcription") { Task { await model.retry(row: row, box: box) } }
                            .disabled(model.working)
                    }
                }
            } else { Text("This capture is unavailable.") }
        }
        .navigationTitle("Capture")
        .onDisappear { audioPlayer?.pause() }
        .confirmationDialog("Delete this saved source permanently? Messages already sent to chat remain.", isPresented: $confirmingDelete) {
            Button("Delete saved source", role: .destructive) {
                guard let row else { return }
                Task {
                    do { try await model.delete(row: row, box: box) }
                    catch { self.error = error.localizedDescription }
                }
            }
        }
    }
}

#if DEBUG
/// Uses production section/detail views with synthetic in-memory rows. No
/// defaults, app-group storage, recording, or network mutations are enabled.
struct QuickCaptureFixtureScreen: View {
    @StateObject private var model: CaptureListModel
    private let box: PairedBox
    private let boxes: [PairedBox]
    private let detail: Bool
    private let orphan: Bool
    private let originalID = UUID(uuidString: "00000000-0000-0000-0000-000000000021")!

    init() {
        let argument = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--quick-capture-fixture=") }
        detail = argument?.split(separator: "=").last == "detail"
        orphan = argument?.split(separator: "=").last == "orphan"
        let first = PairedBox(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, label: "Personal Box", baseURL: URL(string: "https://fixture.invalid/personal")!, sessionID: nil, authToken: nil, requiresDeviceUnlock: false)
        let second = PairedBox(id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, label: "Project Box", baseURL: URL(string: "https://fixture.invalid/project")!, sessionID: nil, authToken: nil, requiresDeviceUnlock: false)
        box = first; boxes = [first, second]
        let originalID = UUID(uuidString: "00000000-0000-0000-0000-000000000021")!
        let fixture = CaptureListModel()
        fixture.fixtureMode = true
        fixture.error = "Offline. Captures saved on this phone remain available."
        fixture.rows = [
            CaptureRow(id: originalID, input: "Find the problem shown here", material: .file(kind: "image", mimeType: "image/png", fileName: "screenshot.png"), state: "saved-on-phone"),
            CaptureRow(id: UUID(uuidString: "00000000-0000-0000-0000-000000000022")!, material: QuickCaptureMaterial(kind: "url", url: "https://example.com/a-useful-reference"), state: "saved-on-phone"),
            CaptureRow(id: UUID(uuidString: "00000000-0000-0000-0000-000000000023")!, input: "This happened after the update", parentID: originalID, state: "waiting-for-original")
        ]
        fixture.fixtureImage = UIGraphicsImageRenderer(size: CGSize(width: 320, height: 140)).image { context in
            UIColor.systemGray6.setFill(); context.fill(CGRect(x: 0, y: 0, width: 320, height: 140))
            let text = "Connection failed\nThe service is unavailable.\nTry again later."
            text.draw(in: CGRect(x: 18, y: 28, width: 285, height: 100), withAttributes: [.font: UIFont.systemFont(ofSize: 17), .foregroundColor: UIColor.label])
        }
        _model = StateObject(wrappedValue: fixture)
    }
    var body: some View {
        NavigationStack {
            if orphan {
                OrphanedCaptureDetail(record: QuickCaptureRecord(id: originalID, boxID: box.id, boxLabel: box.label,
                    requiresDeviceUnlock: false,
                    declaration: QuickCaptureDeclaration(capturedAt: "2026-10-12T12:00:00Z", source: .shareExtension,
                        input: "Find the problem described here", material: QuickCaptureMaterial(kind: "clipping", text: "Connection failed. The service is unavailable.")),
                    status: QuickCaptureStatus(state: "needs-repair", attempts: 1), createdAt: Date()))
            } else if detail {
                QuickCaptureDetail(rowID: originalID, model: model, box: box, onOpen: { _ in })
            } else {
                List { QuickCaptureSection(box: box, boxes: boxes, model: model, captureDefault: box.id) }
                    .navigationTitle("Personal Box")
            }
        }
    }
}
#endif

/// Removed pairings must not hide accepted phone copies or redirect them.
struct OrphanedQuickCaptures: View {
    let boxes: [PairedBox]
    @State private var records: [QuickCaptureRecord] = []
    @State private var showingRecovery = false
    @ObservedObject private var voice = VoiceNoteCoordinator.shared

    private var missingVoiceBox: Bool {
        voice.draft.map { draft in !boxes.contains { $0.id == draft.boxID } } ?? false
    }
    private func refresh() {
        do {
            records = try QuickCaptureStore.shared.records().filter { record in
                record.status.state != "gone" && !boxes.contains { $0.id == record.boxID }
            }
        } catch { BoxLog.warn("orphaned captures read failed error=\(type(of: error))", category: .capture) }
    }
    var body: some View {
        Group {
            if !records.isEmpty || missingVoiceBox {
                Button("Captures from removed boxes", systemImage: "tray.full") { showingRecovery = true }
                    .padding(8).frame(maxWidth: .infinity).background(.bar)
            }
        }
        .task(id: boxes.map(\.id)) { refresh() }
        .onReceive(NotificationCenter.default.publisher(for: QuickCaptureStore.didChange).receive(on: DispatchQueue.main)) { _ in refresh() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.protectedDataDidBecomeAvailableNotification).receive(on: DispatchQueue.main)) { _ in refresh() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification).receive(on: DispatchQueue.main)) { _ in refresh() }
        .sheet(isPresented: $showingRecovery) {
            NavigationStack {
                List {
                    Text("These phone copies keep their original box. They will not be sent to another box automatically.")
                    if missingVoiceBox, let draft = voice.draft {
                        NavigationLink("Interrupted voice note for \(draft.boxLabel)") {
                            VoiceNoteView(coordinator: voice,
                                box: recoveryBox(id: draft.boxID, label: draft.boxLabel, protected: draft.requiresDeviceUnlock == true), boxes: boxes)
                        }
                    }
                    ForEach(records) { record in
                        NavigationLink {
                            OrphanedCaptureDetail(record: record)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(record.requiresDeviceUnlock ? "Protected capture" :
                                     record.declaration.input ?? record.declaration.material?.url ?? record.declaration.material?.text ??
                                     (record.declaration.material?.kind == "audio" ? "Voice note" : "Shared image")).lineLimit(2)
                                Text(record.boxLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .navigationTitle("Phone copies")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingRecovery = false } } }
            }
        }
    }
}

private func recoveryBox(id: UUID, label: String, protected: Bool) -> PairedBox {
    // Authentication uses identity/protection only. No server request uses this placeholder.
    PairedBox(id: id, label: label, baseURL: URL(fileURLWithPath: "/"),
              sessionID: nil, authToken: nil, requiresDeviceUnlock: protected)
}

private struct OrphanedCaptureDetail: View {
    let record: QuickCaptureRecord
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var error: String?
    @State private var confirmingDiscard = false
    private var box: PairedBox { recoveryBox(id: record.boxID, label: record.boxLabel, protected: record.requiresDeviceUnlock) }
    var body: some View {
        List {
            Text(record.boxLabel).font(.headline)
            if boxLockManager.isLocked(box) {
                Button("Unlock \(record.boxLabel)", systemImage: "lock.open") { boxLockManager.unlock(box) }
            } else {
                if record.status.state == "interrupted-draft" { Text("This save was interrupted. This phone copy may be incomplete.").foregroundStyle(.orange) }
                Text("The original pairing was removed. This source remains on your phone. Export it or copy your words to save elsewhere explicitly. Already delivered messages are not recalled.")
                if record.declaration.recordingInterrupted == true { Text("Interrupted recording — audio may end early.") }
                if let material = record.declaration.material {
                    if let url = material.url { Text(url).textSelection(.enabled) }
                    if let text = material.text { Text(text).textSelection(.enabled) }
                    if material.kind == "image", let image = UIImage(contentsOfFile: QuickCaptureStore.shared.materialURL(for: record.id).path) {
                        Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Saved image")
                    }
                    if material.kind == "audio" {
                        Button("Play saved audio") { player = AVPlayer(url: QuickCaptureStore.shared.materialURL(for: record.id)); player?.play() }
                        Button("Stop playback") { player?.pause() }
                    }
                    if let name = material.fileName {
                        ShareLink(item: RetainedCaptureFile(id: record.id, fileName: name, protected: record.requiresDeviceUnlock),
                                  preview: SharePreview(name)) { Label("Export phone copy", systemImage: "square.and.arrow.up") }
                    }
                }
                if let input = record.declaration.input { Section("Your words") { Text(input).textSelection(.enabled) } }
                if let transcript = record.status.transcript { Section("Transcript from audio") { Text(transcript).textSelection(.enabled) } }
                if record.status.attempts == 0 && !record.status.serverAccepted {
                    Button("Discard from phone", role: .destructive) { confirmingDiscard = true }
                } else {
                    Text("An upload may already have reached the original box. Its deletion needs confirmation there; exporting does not delete it.").font(.caption)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Retained capture")
        .onDisappear { player?.pause() }
        .onChange(of: boxLockManager.isLocked(box)) { _, locked in if locked { player?.pause() } }
        .confirmationDialog("Discard this unsent phone copy permanently?", isPresented: $confirmingDiscard) {
            Button("Discard from phone", role: .destructive) {
                guard !boxLockManager.isLocked(box) else { return }
                do { try QuickCaptureStore.shared.discard(record.id); dismiss() }
                catch { self.error = error.localizedDescription }
            }
        }
    }
}

private struct RetainedCaptureFile: Transferable {
    let id: UUID
    let fileName: String
    let protected: Bool
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .data) { file in
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.protectionKey: file.protected ? FileProtectionType.complete : .completeUntilFirstUserAuthentication])
            let destination = directory.appendingPathComponent(file.fileName)
            try FileManager.default.copyItem(at: QuickCaptureStore.shared.materialURL(for: file.id), to: destination)
            return SentTransferredFile(destination)
        }
    }
}
