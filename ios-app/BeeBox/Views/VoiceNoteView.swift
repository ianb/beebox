import SwiftUI
import UniformTypeIdentifiers

struct VoiceNoteView: View {
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @ObservedObject var coordinator: VoiceNoteCoordinator
    let box: PairedBox
    var boxes: [PairedBox] = []
    @State private var errorMessage: String?
    @State private var discardConfirmation = false
    @State private var exporting = false
    @State private var showingExporter = false
    @State private var exportDocument: VoiceNoteAudioDocument?

    private var targetBox: PairedBox {
        var target = boxes.first { $0.id == coordinator.draft?.boxID } ?? box
        if let draft = coordinator.draft {
            target.id = draft.boxID
            target.label = draft.boxLabel
            if draft.requiresDeviceUnlock == true { target.requiresDeviceUnlock = true }
        }
        return target
    }
    private var targetMissing: Bool {
        if let id = coordinator.draft?.boxID { return !boxes.contains { $0.id == id } }
        return false
    }
    private var locked: Bool { boxLockManager.isLocked(targetBox) }

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: coordinator.isRecording ? "waveform" : "mic")
                .font(.system(size: 64))
                .foregroundStyle(coordinator.isRecording ? .red : .secondary)
            Text(coordinator.draft?.boxLabel ?? box.label).font(.title2)
            Text(coordinator.isRecording ? "Recording" : "Voice note")
                .font(.headline)
            Text(Duration.seconds(coordinator.elapsed).formatted(.time(pattern: .minuteSecond)))
                .font(.title.monospacedDigit())
            if coordinator.nearLimit {
                Text("The ten-minute limit is approaching. The note will stop and save at the limit.")
                    .foregroundStyle(.orange)
            }
            if let message = errorMessage ?? coordinator.message {
                Text(message).multilineTextAlignment(.center)
            }
            if targetMissing {
                Text("Reconnect the recording’s original box before saving, or export its playable audio.")
                Button(exporting ? "Preparing audio…" : "Export audio", systemImage: "square.and.arrow.up") {
                    guard !locked else { return }
                    exporting = true
                    Task {
                        defer { exporting = false }
                        do {
                            let id = coordinator.draft?.id
                            let url = try await coordinator.exportInterruptedAudio()
                            guard !locked, coordinator.draft?.id == id else { return }
                            exportDocument = VoiceNoteAudioDocument(data: try Data(contentsOf: url, options: .mappedIfSafe))
                            showingExporter = true
                            errorMessage = nil
                        } catch { errorMessage = error.localizedDescription }
                    }
                }.disabled(locked || exporting || coordinator.phase != .interrupted)
            }
            if locked {
                Button("Unlock \(targetBox.label)", systemImage: "lock.open") {
                    boxLockManager.unlock(targetBox)
                }.buttonStyle(.borderedProminent)
            }
            if coordinator.draft != nil {
                Button("Stop and Save", systemImage: "stop.circle.fill") {
                    Task {
                        guard !locked && !targetMissing else { return }
                        do { _ = try await coordinator.stopAndSave(boxes: boxes) }
                        catch { errorMessage = error.localizedDescription }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(locked || targetMissing || coordinator.phase == .saving || coordinator.phase == .starting)
                Button("Discard recording", role: .destructive) { discardConfirmation = true }
                    .disabled(locked || exporting || coordinator.phase == .saving || coordinator.phase == .starting)
            } else if coordinator.phase != .starting {
                Button("Start Voice Note", systemImage: "mic.circle.fill") { start() }
                    .buttonStyle(.borderedProminent)
                    .disabled(locked || targetMissing)
            }
            Text("Audio is saved independently of its transcript. Closing this screen does not discard a recording.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding()
        .navigationTitle("Voice Note")
        .task {
            if coordinator.draft == nil && !locked { await begin() }
        }
        .onChange(of: locked) { _, isLocked in
            if !isLocked && coordinator.draft == nil { start() }
        }
        .fileExporter(isPresented: $showingExporter, document: exportDocument, contentType: .mpeg4Audio, defaultFilename: "Recovered voice note") { outcome in
            if case .failure(let error) = outcome { errorMessage = error.localizedDescription }
            exportDocument = nil
        }
        .confirmationDialog("Discard this recording permanently?", isPresented: $discardConfirmation) {
            Button("Discard recording", role: .destructive) {
                Task {
                    guard !locked else { return }
                    do { try await coordinator.discard() }
                    catch { errorMessage = error.localizedDescription }
                }
            }
        }
    }
    private func start() { Task { await begin() } }
    private func begin() async {
        guard !locked && !targetMissing else { return }
        errorMessage = nil
        do {
            if #available(iOS 18.0, *) { try await coordinator.start(box: targetBox) }
            else { try await coordinator.start(box: targetBox, requireLiveActivity: false) }
        } catch { errorMessage = error.localizedDescription }
    }
}


private struct VoiceNoteAudioDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.mpeg4Audio] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
