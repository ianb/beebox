import Foundation
import PhotosUI
import SwiftUI
import UIKit

@MainActor
final class NativeCaptureController: ObservableObject {
    @Published private(set) var surfaceState: NativeCaptureSurfaceState
    @Published private(set) var isFinished = false

    let camera = CaptureCamera()

    private let box: PairedBox
    private let store: CaptureStore
    private let uploadRuntime: CaptureUploadRuntime
    private var sessionID: CaptureSessionID?
    private var elapsedTask: Task<Void, Never>?
    private var uploadObserverID: UUID?
    private var storedAudioRecorder: CaptureAudioRecorder?

    init(box: PairedBox, uploadRuntime: CaptureUploadRuntime = .shared) {
        self.box = box
        self.uploadRuntime = uploadRuntime
        store = uploadRuntime.store
        surfaceState = NativeCaptureSurfaceState(destinationLabel: box.label)
    }

    deinit {
        elapsedTask?.cancel()
        if let uploadObserverID {
            uploadRuntime.removeObserver(uploadObserverID)
        }
    }

    func start() async {
        guard box.sessionID?.isEmpty == false else {
            surfaceState.phase = .failed(message: "Send a message before starting a capture.")
            return
        }
        surfaceState.phase = .starting
        uploadRuntime.updateBox(box)
        if uploadObserverID == nil {
            uploadObserverID = uploadRuntime.addObserver { [weak self] event in
                Task { @MainActor in
                    await self?.handleUploadEvent(event)
                }
            }
        }
        do {
            let local = try await localManifest()
            let response = await CaptureAPI(box: box).resumableCaptures(
                targetSessionID: box.sessionID,
                clientSessionID: local?.sessionID
            )
            switch response {
            case .success(let captures) where captures.isEmpty == false:
                surfaceState.phase = .choosingResume(captures[0])
            case .success:
                await createNewSession()
            case .retryable(let retry):
                surfaceState.phase = .failed(message: retry.message)
            case .rejected(let rejection):
                surfaceState.phase = .failed(message: rejection.message)
            }
        } catch {
            surfaceState.phase = .failed(message: error.localizedDescription)
        }
    }

    func resume(_ capture: ResumableCapture) async {
        sessionID = capture.id
        do {
            if try await store.loadManifest(boxID: box.id, sessionID: capture.id) == nil {
                _ = try await store.createManifest(
                    boxID: box.id,
                    sessionID: capture.id,
                    targetSessionID: box.sessionID,
                    startedAt: capture.startedAt
                )
            }
            await beginActiveSession()
        } catch {
            surfaceState.phase = .failed(message: error.localizedDescription)
        }
    }

    func discardResumable(_ capture: ResumableCapture) async {
        switch await CaptureAPI(box: box).cancel(sessionID: capture.id) {
        case .success, .rejected(.sessionGone):
            try? await store.deleteCapture(boxID: box.id, sessionID: capture.id)
            await createNewSession()
        case .retryable(let retry):
            surfaceState.phase = .failed(message: "Could not discard: \(retry.message)")
        case .rejected(let rejection):
            surfaceState.phase = .failed(message: rejection.message)
        }
    }

    func submitResumable(_ capture: ResumableCapture) async {
        sessionID = capture.id
        surfaceState.phase = .sealing
        // Stop this capture's background uploads before sealing. The runtime
        // reschedules leftover tasks at launch, so a resumable capture can have
        // transfers in flight right now — they would spend the uplink on bytes
        // the sealed session rejects with a 409.
        await uploadRuntime.cancel(boxID: box.id, sessionID: capture.id)
        switch await CaptureAPI(box: box).finalize(sessionID: capture.id) {
        case .success:
            try? await store.deleteCapture(boxID: box.id, sessionID: capture.id)
            isFinished = true
        case .retryable(let retry):
            surfaceState.phase = .failed(message: retry.message)
        case .rejected(let rejection):
            handleLifecycleRejection(rejection)
        }
    }

    func takePhoto() async {
        guard sessionID != nil else { return }
        do {
            _ = try await camera.capturePhoto(into: acquisitionSink)
            await refreshSurface()
        } catch {
            showError(error.localizedDescription, retryable: false)
        }
    }

    func switchCamera() async {
        do {
            try await camera.switchCamera()
        } catch {
            showError(error.localizedDescription, retryable: false)
        }
    }

    func toggleRecording() async {
        if audioRecorder.isRecording {
            await audioRecorder.stop()
        } else {
            await audioRecorder.start()
        }
        await refreshSurface()
    }

    func addPhotos(_ selections: [PhotosPickerItem]) async {
        let results = await CaptureGalleryImporter.importItems(selections, into: acquisitionSink)
        showImportFailures(results)
        await refreshSurface()
    }

    func addFiles(_ urls: [URL]) async {
        let results = await CaptureFileImporter.importURLs(urls, into: acquisitionSink)
        showImportFailures(results)
        await refreshSurface()
    }

    func retryFailedUploads() async {
        guard let sessionID else { return }
        do {
            let candidates = try await store.retryFailedUploads(boxID: box.id, sessionID: sessionID)
            surfaceState.banner = nil
            surfaceState.canRetry = false
            for candidate in candidates {
                do {
                    try await uploadRuntime.schedule(candidate)
                } catch {
                    try? await store.transition(
                        boxID: candidate.boxID,
                        sessionID: candidate.sessionID,
                        itemID: candidate.itemID,
                        to: .failed(message: error.localizedDescription)
                    )
                    showError(error.localizedDescription, retryable: true)
                }
            }
            await refreshSurface()
        } catch {
            showError(error.localizedDescription, retryable: true)
        }
    }

    /// Guards against a second `finish()` running while one is already waiting
    /// — two concurrent waits would each call finalize.
    private var isFinishing = false

    /// Set by ``skipPendingUploads`` to break ``finish``'s wait. A capture on a
    /// weak uplink can legitimately take many minutes, so the wait has no
    /// deadline of its own — the user's explicit skip is the only thing that
    /// cuts it short.
    ///
    /// Sticky across a failed finalize. Cancelling an upload returns its item to
    /// `.local`, which `retryFailedUploads` does not pick up (it selects
    /// `.failed`), so clearing the flag on every `finish()` would leave a second
    /// Done waiting forever on items the user already chose to abandon. It is
    /// cleared when new media arrives instead — that media has not been skipped.
    private var skipPendingRequested = false

    func finish() async {
        guard let sessionID, isFinishing == false else { return }
        isFinishing = true
        defer { isFinishing = false }
        if audioRecorder.isRecording {
            await audioRecorder.stop()
        }
        surfaceState.phase = .sealing
        await refreshSurface(preservingPhase: true)

        // Wait for outstanding uploads with NO fixed deadline. The old version
        // gave up after 120 × 250ms and told the user "Try Done again in a
        // moment" — but on the slow link that causes the wait in the first
        // place, that moment never arrives, so Done became unpressable
        // forever. Now the wait persists (with a live count on screen) and
        // ``skipPendingUploads`` is the escape.
        while skipPendingRequested == false {
            guard let manifest = try? await store.loadManifest(boxID: box.id, sessionID: sessionID) else {
                surfaceState.phase = .failed(message: "The local capture record could not be read.")
                return
            }
            if manifest.pendingItemCount == 0 {
                break
            }
            await refreshSurface(preservingPhase: true)
            try? await Task.sleep(nanoseconds: 250_000_000)
        }

        if skipPendingRequested {
            // Stop the transfers before sealing: a background task still
            // uploading into a sealed session gets a 409 and its bytes are
            // wasted — on exactly the constrained link the user is escaping.
            await uploadRuntime.cancel(boxID: box.id, sessionID: sessionID)
        }

        guard let manifest = try? await store.loadManifest(boxID: box.id, sessionID: sessionID) else {
            surfaceState.phase = .failed(message: "The local capture record could not be read.")
            return
        }
        // A skip deliberately seals with failures present, so only an
        // unsolicited failure sends the user back to decide.
        if skipPendingRequested == false,
           manifest.items.contains(where: { if case .failed = $0.state { true } else { false } }) {
            surfaceState.phase = .active
            showError("Some items did not upload.", retryable: true)
            await refreshSurface()
            return
        }
        await finalize(sessionID: sessionID)
    }

    /// Abandon whatever is still uploading and seal with what the box already
    /// has. Mirrors the web capture surface's "Skip them".
    func skipPendingUploads() {
        skipPendingRequested = true
    }

    func submitUploadedItems() async {
        guard let sessionID, surfaceState.counts.uploaded > 0 else { return }
        // Same reasoning as the skip path above — cancel before sealing so the
        // in-flight tasks don't keep spending the uplink on bytes the sealed
        // session will reject.
        await uploadRuntime.cancel(boxID: box.id, sessionID: sessionID)
        await finalize(sessionID: sessionID)
    }


    func cancel() async {
        guard let sessionID else {
            isFinished = true
            return
        }
        if audioRecorder.isRecording {
            await audioRecorder.stop()
        }
        await camera.stop()
        await uploadRuntime.cancel(boxID: box.id, sessionID: sessionID)
        switch await CaptureAPI(box: box).cancel(sessionID: sessionID) {
        case .success, .rejected(.sessionGone):
            try? await store.deleteCapture(boxID: box.id, sessionID: sessionID)
            isFinished = true
        case .retryable(let retry):
            showError("Could not cancel: \(retry.message)", retryable: true)
            await beginActiveSession()
        case .rejected(let rejection):
            handleLifecycleRejection(rejection)
        }
    }

    func sendRemainingAsFollowUp() async {
        guard let oldSessionID = sessionID else { return }
        surfaceState.phase = .starting
        await uploadRuntime.cancel(boxID: box.id, sessionID: oldSessionID)
        switch await CaptureAPI(box: box).createSession(targetSessionID: box.sessionID) {
        case .success(let response) where response.capabilities.supportsNativeCapture:
            let newSessionID = CaptureSessionID(rawValue: response.sessionId)
            do {
                _ = try await store.createManifest(
                    boxID: box.id,
                    sessionID: newSessionID,
                    targetSessionID: box.sessionID,
                    startedAt: response.startedAt
                )
                try await store.moveUnacknowledgedItems(
                    boxID: box.id,
                    from: oldSessionID,
                    to: newSessionID
                )
                try await store.deleteCapture(boxID: box.id, sessionID: oldSessionID)
                sessionID = newSessionID
                storedAudioRecorder = nil
                await beginActiveSession()
            } catch {
                surfaceState.phase = .failed(message: error.localizedDescription)
            }
        case .success:
            surfaceState.phase = .failed(message: "The box must be updated before it can receive native captures.")
        case .retryable(let retry):
            surfaceState.phase = .failed(message: retry.message)
        case .rejected(let rejection):
            surfaceState.phase = .failed(message: rejection.message)
        }
    }

    func discardRemaining() async {
        guard let sessionID else { return }
        try? await store.deleteCapture(boxID: box.id, sessionID: sessionID)
        isFinished = true
    }

    func sceneDidEnterBackground() async {
        camera.handleSceneBackgrounding()
        await audioRecorder.handleSceneBackgrounding()
        await refreshSurface()
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private var requiredSessionID: CaptureSessionID {
        guard let sessionID else {
            preconditionFailure("Capture acquisition cannot start before a server session exists")
        }
        return sessionID
    }

    private var acquisitionSink: CaptureStoreAcquisitionSink {
        CaptureStoreAcquisitionSink(
            store: store,
            boxID: box.id,
            sessionID: requiredSessionID
        ) { [weak self] itemID in
            await self?.enqueue(itemID: itemID)
        }
    }

    private var audioRecorder: CaptureAudioRecorder {
        if let storedAudioRecorder {
            return storedAudioRecorder
        }
        let recorder = CaptureAudioRecorder(sink: acquisitionSink)
        recorder.onEvent = { [weak self] event in
            Task { @MainActor in
                await self?.handleAudioEvent(event)
            }
        }
        storedAudioRecorder = recorder
        return recorder
    }

    private func createNewSession() async {
        switch await CaptureAPI(box: box).createSession(targetSessionID: box.sessionID) {
        case .success(let response) where response.capabilities.supportsNativeCapture:
            let newSessionID = CaptureSessionID(rawValue: response.sessionId)
            sessionID = newSessionID
            do {
                _ = try await store.createManifest(
                    boxID: box.id,
                    sessionID: newSessionID,
                    targetSessionID: box.sessionID,
                    startedAt: response.startedAt
                )
                await beginActiveSession()
            } catch {
                surfaceState.phase = .failed(message: error.localizedDescription)
            }
        case .success(let response):
            _ = await CaptureAPI(box: box).cancel(sessionID: CaptureSessionID(rawValue: response.sessionId))
            surfaceState.phase = .failed(message: "The box must be updated before it can receive native captures.")
        case .retryable(let retry):
            surfaceState.phase = .failed(message: retry.message)
        case .rejected(let rejection):
            surfaceState.phase = .failed(message: rejection.message)
        }
    }

    private func beginActiveSession() async {
        do {
            if let sessionID {
                let interrupted = try await store.markInterruptedRecordings(boxID: box.id, sessionID: sessionID)
                if interrupted > 0 {
                    surfaceState.banner = CaptureStore.interruptedRecordingMessage
                }
            }
            try await uploadRuntime.start()
        } catch {
            showError(error.localizedDescription, retryable: true)
        }
        surfaceState.phase = .active
        await refreshSurface()
        do {
            try await camera.start()
            surfaceState.cameraAvailable = true
        } catch {
            surfaceState.cameraAvailable = false
            surfaceState.canOpenSettings = error as? CaptureAcquisitionError == .cameraPermissionDenied
            showError(error.localizedDescription, retryable: false)
        }
    }

    private func finalize(sessionID: CaptureSessionID) async {
        surfaceState.phase = .sealing
        switch await CaptureAPI(box: box).finalize(sessionID: sessionID) {
        case .success:
            await camera.stop()
            try? await store.deleteCapture(boxID: box.id, sessionID: sessionID)
            isFinished = true
        case .retryable(let retry):
            surfaceState.phase = .active
            showError(retry.message, retryable: true)
        case .rejected(let rejection):
            handleLifecycleRejection(rejection)
        }
    }

    private func handleLifecycleRejection(_ rejection: CaptureRejection) {
        switch rejection {
        case .sessionGone:
            surfaceState.phase = .recovery(
                title: "Capture no longer available",
                message: "This capture was already submitted or cancelled."
            )
        case .alreadySealed:
            surfaceState.phase = .recovery(
                title: "Capture already submitted",
                message: "This capture was submitted while the phone was away."
            )
        default:
            surfaceState.phase = .failed(message: rejection.message)
        }
    }

    private func handleUploadEvent(_ event: CaptureUploadEvent) async {
        guard eventBelongsToCurrentCapture(event) else {
            return
        }
        switch event {
        case .uploaded:
            break
        case .retryScheduled(_, let seconds):
            surfaceState.banner = "Upload interrupted. Retrying in \(seconds) seconds."
        case .failed(_, let message):
            showError(message, retryable: true)
        case .recovery(.sessionGone):
            surfaceState.phase = .recovery(
                title: "Capture no longer available",
                message: "This capture was already submitted or cancelled."
            )
            await camera.stop()
            await audioRecorder.stop(reason: .interruption)
        case .recovery(.alreadySealed):
            surfaceState.phase = .recovery(
                title: "Capture already submitted",
                message: "This capture was submitted while the phone was away."
            )
            await camera.stop()
            await audioRecorder.stop(reason: .interruption)
        }
        await refreshSurface(preservingPhase: true)
    }

    private func enqueue(itemID: UUID) async {
        guard let sessionID else {
            return
        }
        switch surfaceState.phase {
        case .active, .recording, .sealing:
            break
        case .starting, .choosingResume, .recovery, .failed:
            return
        }
        // New media is not covered by an earlier skip.
        skipPendingRequested = false
        let candidate = CaptureUploadCandidate(boxID: box.id, sessionID: sessionID, itemID: itemID)
        do {
            try await uploadRuntime.schedule(candidate)
        } catch {
            showError(error.localizedDescription, retryable: true)
        }
    }

    private func eventBelongsToCurrentCapture(_ event: CaptureUploadEvent) -> Bool {
        guard let sessionID else {
            return false
        }
        switch event {
        case .uploaded(let candidate), .retryScheduled(let candidate, _), .failed(let candidate, _):
            return candidate.boxID == box.id && candidate.sessionID == sessionID
        case .recovery(.sessionGone(let recoveredID)), .recovery(.alreadySealed(let recoveredID)):
            return recoveredID == sessionID
        }
    }

    private func handleAudioEvent(_ event: CaptureAudioEvent) async {
        switch event {
        case .recordingPersisted:
            surfaceState.phase = .recording
            startElapsedTimer()
        case .closed(_, let reason):
            elapsedTask?.cancel()
            switch surfaceState.phase {
            // `.sealing` must survive. `finish()` stops the recorder and THEN
            // enters `.sealing`, but this event is delivered on its own
            // `@MainActor` task, so it routinely lands afterwards. Resetting to
            // `.active` there put the Done button back mid-seal (inviting a
            // re-entrant finish), reopened acquisition, and hid the "waiting for
            // N uploads / Skip Them" banner — removing the user's only escape
            // from the wait.
            case .recovery, .failed, .sealing:
                break
            case .starting, .choosingResume, .active, .recording:
                surfaceState.phase = .active
            }
            if reason != .user {
                surfaceState.banner = audioRecorder.notice
            }
        case .failed(_, let message):
            elapsedTask?.cancel()
            // Same reasoning: surface the error, but don't yank the phase out
            // from under an in-flight seal.
            if surfaceState.phase != .sealing {
                surfaceState.phase = .active
            }
            showError(message, retryable: false)
            surfaceState.canOpenSettings = message == CaptureAcquisitionError.microphonePermissionDenied.localizedDescription
        }
        await refreshSurface(preservingPhase: true)
    }

    private func refreshSurface(preservingPhase: Bool = false) async {
        guard
            let sessionID,
            let manifest = try? await store.loadManifest(boxID: box.id, sessionID: sessionID)
        else {
            return
        }
        var counts = NativeCaptureSurfaceCounts()
        for item in manifest.items {
            switch item.kind {
            case .photo: counts.photos += 1
            case .file: counts.files += 1
            case .audio: counts.audioSegments += 1
            }
            switch item.state {
            case .local: counts.queued += 1
            case .uploading: counts.uploading += 1
            case .uploaded: counts.uploaded += 1
            case .failed: counts.failed += 1
            case .recording: break
            }
        }
        surfaceState.counts = counts
        surfaceState.canRetry = manifest.items.contains { item in
            guard case .failed(let message) = item.state else { return false }
            return message != CaptureStore.interruptedRecordingMessage
        }
        if preservingPhase == false {
            surfaceState.phase = audioRecorder.isRecording ? .recording : .active
        }
    }

    private func localManifest() async throws -> CaptureManifest? {
        let manifests = try await store.loadAllManifests()
        return manifests.last { manifest in
            manifest.boxID == box.id && manifest.targetSessionID == box.sessionID
        }
    }

    private func showImportFailures(_ results: [CaptureImportResult]) {
        let messages = results.compactMap(\.error?.localizedDescription)
        if messages.isEmpty == false {
            showError(messages.joined(separator: "\n"), retryable: false)
        }
    }

    private func showError(_ message: String, retryable: Bool) {
        surfaceState.banner = message
        surfaceState.canRetry = retryable
    }

    private func startElapsedTimer() {
        elapsedTask?.cancel()
        surfaceState.elapsedSeconds = 0
        elapsedTask = Task { [weak self] in
            while Task.isCancelled == false {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard Task.isCancelled == false else { return }
                self?.surfaceState.elapsedSeconds += 1
            }
        }
    }
}

struct NativeCaptureScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var controller: NativeCaptureController

    init(box: PairedBox) {
        _controller = StateObject(wrappedValue: NativeCaptureController(box: box))
    }

    var body: some View {
        NativeCaptureView(
            state: controller.surfaceState,
            preview: {
                if controller.surfaceState.cameraAvailable {
                    CaptureCameraPreview(session: controller.camera.session)
                } else {
                    Color.black
                }
            },
            onCancel: { Task { await controller.cancel() } },
            onShutter: { Task { await controller.takePhoto() } },
            onFlipCamera: { Task { await controller.switchCamera() } },
            onToggleRecording: { Task { await controller.toggleRecording() } },
            onAddPhotos: { items in Task { await controller.addPhotos(items) } },
            onAddFiles: { urls in Task { await controller.addFiles(urls) } },
            onRetry: { Task { await controller.retryFailedUploads() } },
            onOpenSettings: { controller.openSettings() },
            onFinish: { Task { await controller.finish() } },
            onSubmitUploadedItems: { Task { await controller.submitUploadedItems() } },
            onSkipPendingUploads: { controller.skipPendingUploads() },
            onSendFollowUp: { Task { await controller.sendRemainingAsFollowUp() } },
            onDiscardRemaining: { Task { await controller.discardRemaining() } }
        )
        .task { await controller.start() }
        .onChange(of: controller.isFinished) { _, finished in
            if finished { dismiss() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                Task { await controller.sceneDidEnterBackground() }
            }
        }
        .overlay {
            if case .choosingResume(let capture) = controller.surfaceState.phase {
                resumePanel(capture)
            }
        }
    }

    private func resumePanel(_ capture: ResumableCapture) -> some View {
        VStack(spacing: 14) {
            Text("Unfinished Capture").font(.headline)
            Text(resumeSummary(capture))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Resume", action: { Task { await controller.resume(capture) } })
                .buttonStyle(.borderedProminent)
            Button("Submit Uploaded Items", action: { Task { await controller.submitResumable(capture) } })
                .disabled(capture.counts.photos + capture.counts.files + capture.counts.audioSegments == 0)
            Button("Discard", role: .destructive) {
                Task { await controller.discardResumable(capture) }
            }
        }
        .padding(20)
        .frame(maxWidth: 360)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(20)
    }

    private func resumeSummary(_ capture: ResumableCapture) -> String {
        let count = capture.counts.photos + capture.counts.files + capture.counts.audioSegments
        return count == 1 ? "1 item is waiting in this capture." : "\(count) items are waiting in this capture."
    }
}
