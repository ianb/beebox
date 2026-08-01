import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct NativeComposerView: View {
    var box: PairedBox
    @ObservedObject var draftStore: ComposerDraftStore
    @ObservedObject var pendingStore: PendingEmissionStore
    var captureAvailable: Bool
    var narrationEnabled: Bool
    var speechPlaybackActive: Bool
    var responseActive: Bool
    var locationSharingEnabled: Bool
    var locationShareResult: NativeLocationShareResult?
    var screenshotResult: NativeScreenshotResult?
    var onToggleLocationSharing: () -> Void
    var onTakeScreenshot: () -> Void
    var automaticallyResumeVoicePreparations = true
    var voiceStateOverride: VoiceCompositionState?
    var initiallyFocused = false
    var initialDetailedSelection: DraftSelection?

    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var statusText: String?
    /// Non-nil while a large photo selection is uploading as a bulk batch.
    @State private var batchProgress: BulkUploadProgress?
    @State private var isPreparingSend = false
    @State private var editorHeight: CGFloat = 58
    @State private var focused = false
    @State private var showingActions = false
    @State private var showingPairing = false
    @State private var showingCamera = false
    @State private var showingCapture = false
    @State private var showingFileImporter = false
    @State private var detailedSelection: DraftSelection?
    @State private var activeVoicePreparationIDs: Set<UUID> = []
    @State private var voiceTurn = NativeVoiceTurnState()
    @State private var earconState = NativeEarconState()
    @StateObject private var dictation = SpeechDictation()

    var body: some View {
        presentedComposer
    }

    private var composerLifecycle: some View {
        composerSurface
        .background(.regularMaterial)
        .ignoresSafeArea(.container, edges: .bottom)
        .onChange(of: draftStore.draft.text) { _, newValue in
            dictation.noteManualTextChange(newValue)
        }
        .onChange(of: dictation.transcript) { _, newValue in
            draftStore.setDictationTranscript(newValue)
            draftStore.setVoiceSelectionContext(transcript: newValue, active: dictation.isRecording)
            applyEarcon(.transcriptChanged(
                hasText: newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ))
        }
        .onChange(of: dictation.isRecording) { _, isRecording in
            draftStore.setVoiceSelectionContext(transcript: dictation.transcript, active: isRecording)
        }
        .onChange(of: dictation.state) { _, state in
            applyEarcon(.dictationStateChanged(state))
        }
        .onChange(of: dictation.interruptionCount) {
            applyEarcon(.recordingInterrupted)
        }
        .onChange(of: dictation.keywordIntent) { _, newValue in
            guard let newValue else {
                return
            }
            handleKeywordIntent(newValue)
        }
        .onChange(of: speechPlaybackActive) { _, playing in
            applyVoiceTurn(.speechPlaybackChanged(playing: playing))
        }
        .onChange(of: responseActive) { _, active in
            applyEarcon(.responseActiveChanged(active))
        }
        .onChange(of: pendingStore.voicePreparations) { _, preparations in
            if automaticallyResumeVoicePreparations {
                resumeVoicePreparations(preparations)
            }
        }
        .onAppear {
            applyVoiceTurn(.speechPlaybackChanged(playing: speechPlaybackActive))
            applyEarcon(.responseActiveChanged(responseActive))
            if initiallyFocused {
                focused = true
            }
            if let initialDetailedSelection {
                detailedSelection = initialDetailedSelection
            }
        }
        .onChange(of: selectedPhotoItems) { _, newValue in
            Task {
                await loadPhotos(from: newValue)
            }
        }
        .onChange(of: boxLockManager.isLocked(box)) { _, isLocked in
            if isLocked {
                dismissPresentedContentForLock()
            }
        }
        .onChange(of: locationShareResult) { _, result in
            guard let result else {
                return
            }
            statusText = result.message
        }
        .onChange(of: screenshotResult) { _, result in
            guard let result else {
                return
            }
            guard let data = result.data else {
                statusText = result.message ?? "The visible chat could not be captured."
                return
            }
            Task {
                await appendImage(data: data, sourceMimeType: "image/png")
                statusText = nil
            }
        }
        .onDisappear {
            applyVoiceTurn(.microphoneStopped)
            applyEarcon(.cancelWaiting)
            NativeEarconPlayer.shared.stopAllTimers()
            draftStore.setVoiceSelectionContext(transcript: "", active: false)
        }
    }

    private var presentedComposer: some View {
        composerLifecycle
        .sheet(isPresented: $showingActions) {
            ComposerActionsView(
                selectedPhotoItems: $selectedPhotoItems,
                canCapture: captureAvailable,
                canTakePhoto: UIImagePickerController.isSourceTypeAvailable(.camera),
                canPasteImage: UIPasteboard.general.hasImages,
                locationSharingEnabled: locationSharingEnabled,
                onCapture: openCapture,
                onTakePhoto: openCamera,
                onPasteImage: pasteImage,
                onChooseFile: openFileImporter,
                onScreenshot: takeScreenshot,
                onToggleLocationSharing: toggleLocationSharing,
                onPairBox: openPairing,
                onDismiss: { showingActions = false }
            )
        }
        .sheet(isPresented: $showingPairing) {
            PairBoxView()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraImagePicker { image in
                showingCamera = false
                Task {
                    await appendCameraImage(image)
                }
            } onCancel: {
                showingCamera = false
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showingCapture) {
            NativeCaptureScreen(box: box)
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.data, .content],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else {
                return
            }
            Task {
                await importFiles(urls)
            }
        }
        .sheet(item: $detailedSelection) { selection in
            SelectionDetailView(selection: selection)
        }
    }

    private var composerSurface: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let visibleStatusText {
                Text(visibleStatusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }
            if hasScrollableComposerContext {
                ScrollView(.vertical, showsIndicators: true) {
                    composerContext
                }
                .frame(maxHeight: 220)
                .fixedSize(horizontal: false, vertical: true)
                .scrollBounceBehavior(.basedOnSize)
            }

            HStack(alignment: .bottom, spacing: 10) {
                composerButton(
                    systemImage: "plus",
                    accessibilityLabel: "Add",
                    action: { showingActions = true }
                )
                .disabled(isSending)

                textEntry

                trailingControl
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 5)
            .offset(y: 10)
        }
    }

    private var composerContext: some View {
        VStack(alignment: .leading, spacing: 0) {
            if pendingStore.pending.isEmpty == false || pendingStore.voicePreparations.isEmpty == false {
                PendingEmissionList(
                    emissions: pendingStore.pending,
                    voicePreparations: pendingStore.voicePreparations,
                    canRestore: draftIsEmpty,
                    onRetry: retryPendingEmission,
                    onRestore: restorePendingEmission,
                    onDiscard: discardPendingEmission
                )
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
            if draftStore.draft.images.isEmpty == false {
                ImageAttachmentStrip(
                    images: draftStore.draft.images,
                    draftStore: draftStore,
                    onRetry: retryImage
                )
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
            if draftStore.draft.files.isEmpty == false {
                FileAttachmentList(
                    files: draftStore.draft.files,
                    onRetry: retryFile,
                    onRemove: removeFile
                )
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
            if draftStore.draft.selections.isEmpty == false {
                SelectionAttachmentList(
                    selections: draftStore.draft.selections,
                    onOpen: { detailedSelection = $0 },
                    onRemove: removeSelection
                )
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
        }
    }

    private var visibleStatusText: String? {
        // Batch progress outranks the rest while it is live: a 70-photo upload
        // takes real time, and a silent composer during it reads as a hang —
        // which is how the original failure looked to the boxholder.
        batchProgressText
            ?? voiceStateOverrideMessage
            ?? dictation.errorMessage
            ?? dictation.preparationMessage
            ?? statusText
            ?? draftStore.restoreNotice
            ?? pendingStore.notice
    }

    private var batchProgressText: String? {
        guard let batchProgress, batchProgress.isFinished == false else {
            return nil
        }
        let done = batchProgress.uploaded + batchProgress.failed
        let base = "Uploading photos — \(done) of \(batchProgress.total)"
        return batchProgress.failed > 0 ? "\(base) (\(batchProgress.failed) failed)" : base
    }

    private var voiceStateOverrideMessage: String? {
        guard case .failed(let message) = voiceStateOverride else {
            return nil
        }
        return message
    }

    private var hasScrollableComposerContext: Bool {
        Self.contextNeedsScrolling(
            pendingCount: pendingStore.pending.count,
            voicePreparationCount: pendingStore.voicePreparations.count,
            imageCount: draftStore.draft.images.count,
            fileCount: draftStore.draft.files.count,
            selectionCount: draftStore.draft.selections.count
        )
    }

    static func contextNeedsScrolling(
        pendingCount: Int,
        voicePreparationCount: Int,
        imageCount: Int,
        fileCount: Int,
        selectionCount: Int
    ) -> Bool {
        pendingCount > 0
            || voicePreparationCount > 0
            || imageCount > 0
            || fileCount > 0
            || selectionCount > 0
    }

    private var textEntry: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text("Type...")
                    .font(.body)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 19)
                    .allowsHitTesting(false)
            }
            ComposerTextView(
                text: textBinding,
                selection: selectionBinding,
                isFocused: $focused,
                height: $editorHeight
            )
        }
        .frame(height: editorHeight)
        .frame(minWidth: 0, maxWidth: .infinity)
        .layoutPriority(1)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(isTextEntryLocked == false)
    }

    @ViewBuilder
    private var trailingControl: some View {
        if isSending {
            ProgressView()
                .frame(width: 58, height: 58)
                .background(.quaternary, in: Circle())
        } else if voiceTurn.isActive || isVoiceRecording {
            composerButton(
                systemImage: "stop.fill",
                accessibilityLabel: "Stop continuous dictation",
                foregroundStyle: .red,
                action: stopMicrophoneWithEarcon
            )
        } else if hasTextContent {
            composerButton(
                systemImage: "arrow.up",
                accessibilityLabel: "Send",
                foregroundStyle: .white,
                backgroundStyle: Color.accentColor,
                action: send
            )
            .disabled(sendDisabled)
        } else if draftStore.draft.images.isEmpty == false {
            HStack(spacing: 10) {
                microphoneButton
                composerButton(
                    systemImage: "arrow.up",
                    accessibilityLabel: "Send photo",
                    foregroundStyle: .white,
                    backgroundStyle: Color.accentColor,
                    action: send
                )
                .disabled(sendDisabled)
            }
        } else {
            microphoneButton
        }
    }

    private var microphoneButton: some View {
        composerButton(
            systemImage: "mic.fill",
            accessibilityLabel: "Start dictation",
            action: requestMicrophone
        )
    }

    private var isVoiceRecording: Bool {
        voiceStateOverride == .recording || dictation.isRecording
    }

    private func openCapture() {
        guard captureAvailable else {
            return
        }
        applyVoiceTurn(.microphoneStopped)
        focused = false
        showingActions = false
        DispatchQueue.main.async {
            showingCapture = true
        }
    }

    private func composerButton(
        systemImage: String,
        accessibilityLabel: String,
        foregroundStyle: Color = .primary,
        backgroundStyle: Color = Color(uiColor: .tertiarySystemFill),
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(foregroundStyle)
                .frame(width: 58, height: 58)
                .background(backgroundStyle, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private func send() {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard sendDisabled == false else {
            return
        }
        if voiceTurn.isActive || isVoiceRecording {
            stopMicrophoneWithEarcon()
        } else {
            applyVoiceTurn(.microphoneStopped)
        }
        let origin: NativeChatEmission.Origin = dictation.hasDictatedText ? .voice : .typed
        enqueueMessage(text: message, origin: origin, diarized: false)
    }

    private func handleKeywordIntent(_ intent: SpeechKeywordResult) {
        dictation.clearKeywordIntent()
        // Spoken commands go through the same in-flight lock as the buttons.
        // Without this the visible controls are disabled during a batch upload
        // while "send" still enqueues an overlapping message and "cancel"/"erase"
        // still discard the draft — including the text the running batch took as
        // its introduction. A voice path that can do what a disabled button
        // cannot is worse than no lock, because nothing on screen explains it.
        if isSending {
            statusText = batchProgress == nil
                ? "Still sending — try again in a moment."
                : "Photos are still uploading — try again when they finish."
            applyEarcon(.microphoneStopped)
            applyVoiceTurn(.microphoneStopped)
            return
        }
        switch intent.action {
        case .send, .sendClose:
            sendKeywordIntent(intent)
        case .cancel:
            selectedPhotoItems = []
            applyVoiceTurn(.microphoneStopped)
            dictation.resetDictationState()
            statusText = "Message cancelled."
            Task {
                await draftStore.discardCurrentDraft()
            }
        case .micOff:
            applyEarcon(.microphoneStopped)
            applyVoiceTurn(.microphoneStopped)
            statusText = "Microphone off."
        case .erase:
            selectedPhotoItems = []
            applyVoiceTurn(.microphoneStopped)
            dictation.resetDictationState()
            statusText = "Message erased."
            Task {
                await draftStore.discardCurrentDraft()
            }
        }
    }

    private func sendKeywordIntent(_ intent: SpeechKeywordResult) {
        applyEarcon(.voiceMessageSent(responseAlreadyActive: responseActive))
        if intent.action == .sendClose {
            applyVoiceTurn(.voiceMessageSent(closeMicrophone: true))
        }
        let audioURL = dictation.consumeRecordedAudioURL()
        switch NativeVoiceKeywordSendPlan.make(
            liveTranscript: intent.processedTranscript,
            narrationEnabled: narrationEnabled
        ) {
        case .live(let text):
            if let audioURL {
                try? FileManager.default.removeItem(at: audioURL)
            }
            enqueueMessage(
                text: text,
                origin: .voice,
                diarized: false,
                voiceKeywordAction: intent.action
            )
            return
        case .hq:
            break
        }
        let priorInput = dictation.consumeKeywordSeedText()
        let snapshot = draftStore.draft
        let sendingBox = box
        isPreparingSend = true
        statusText = "Saving voice message..."
        Task {
            do {
                let preparation = try await pendingStore.stageVoicePreparation(
                    draft: snapshot,
                    liveTranscript: intent.processedTranscript,
                    priorInput: priorInput,
                    action: intent.action,
                    matchedPhrase: intent.matchedPhrase,
                    audioURL: audioURL,
                    boxID: sendingBox.id
                )
                if let audioURL {
                    try? FileManager.default.removeItem(at: audioURL)
                }
                await draftStore.clearForSending(boxID: sendingBox.id)
                dictation.resetDictationState()
                selectedPhotoItems = []
                focused = false
                isPreparingSend = false
                statusText = nil
                applyVoiceTurn(.voiceMessageSent(closeMicrophone: intent.action == .sendClose))
                resumeVoicePreparation(preparation, box: sendingBox)
            } catch {
                applyEarcon(.cancelWaiting)
                isPreparingSend = false
                let message = "The voice message could not be saved."
                statusText = message
                dictation.failPreparation(message)
            }
        }
    }

    private func resumeVoicePreparations(_ preparations: [VoicePreparation]) {
        for preparation in preparations where preparation.boxID == box.id {
            resumeVoicePreparation(preparation, box: box)
        }
    }

    private func resumeVoicePreparation(_ preparation: VoicePreparation, box: PairedBox) {
        guard activeVoicePreparationIDs.insert(preparation.id).inserted else {
            return
        }
        Task {
            defer { activeVoicePreparationIDs.remove(preparation.id) }
            let prepared = await prepareVoiceMessage(preparation, box: box)
            do {
                try await pendingStore.finishVoicePreparation(
                    id: preparation.id,
                    text: prepared.text,
                    diarized: prepared.diarized
                )
            } catch {
                if pendingStore.voicePreparations.contains(where: { $0.id == preparation.id }) {
                    statusText = "Voice preparation is saved and will retry."
                }
            }
        }
    }

    private func prepareVoiceMessage(
        _ preparation: VoicePreparation,
        box: PairedBox
    ) async -> (text: String, diarized: Bool) {
        guard let audioURL = await pendingStore.voiceAudioURL(for: preparation) else {
            return (preparation.liveTranscript, false)
        }
        do {
            let hqResult = try await ChatAPI(box: box).transcribeAudio(fileURL: audioURL)
            return (
                VoicePreparationResolver.text(for: preparation, hqTranscript: hqResult.text),
                hqResult.diarized
            )
        } catch {
            statusText = "HQ transcription failed; sending live dictation."
            return (VoicePreparationResolver.text(for: preparation, hqTranscript: nil), false)
        }
    }

    private func enqueueMessage(
        text: String,
        origin: NativeChatEmission.Origin,
        diarized: Bool,
        voiceKeywordAction: SpeechKeywordAction? = nil
    ) {
        let snapshot = draftStore.draft
        let sendingBoxID = box.id
        isPreparingSend = true
        statusText = "Preparing attachments..."
        Task {
            do {
                _ = try await pendingStore.enqueue(
                    draft: snapshot,
                    text: text,
                    origin: origin,
                    diarized: diarized,
                    boxID: sendingBoxID
                )
                await draftStore.clearForSending(boxID: sendingBoxID)
                dictation.resetDictationState()
                selectedPhotoItems = []
                focused = false
                isPreparingSend = false
                statusText = nil
                if let voiceKeywordAction {
                    applyVoiceTurn(.voiceMessageSent(closeMicrophone: voiceKeywordAction == .sendClose))
                }
            } catch {
                if voiceKeywordAction != nil {
                    applyEarcon(.cancelWaiting)
                }
                isPreparingSend = false
                statusText = "An attachment could not be read."
            }
        }
    }

    /// Gates the SEND path (button, voice "send", overlapping submits).
    ///
    /// A running batch counts, so a spoken or tapped send can't race it — but it
    /// deliberately does NOT gate the text field. Typing while photos upload is
    /// the normal way to caption a batch: the introduction is read at finalize,
    /// so whatever is typed during the upload becomes the batch's note.
    private var isSending: Bool {
        isPreparingSend || batchProgress != nil || draftStore.isReady == false
    }

    /// Gates only the TEXT SURFACE. A batch in flight must not lock it — the user
    /// is expected to be writing the caption while it uploads.
    private var isTextEntryLocked: Bool {
        isPreparingSend || draftStore.isReady == false
    }

    private func applyVoiceTurn(_ event: NativeVoiceTurnEvent) {
        switch voiceTurn.handle(event) {
        case .none:
            break
        case .startDictation:
            dictation.startIfNeeded(currentText: text)
        case .stopDictation:
            dictation.stop()
        }
    }

    private func applyEarcon(_ event: NativeEarconEvent) {
        NativeEarconPlayer.shared.execute(earconState.handle(event))
    }

    private func requestMicrophone() {
        applyEarcon(.microphoneRequested)
        applyVoiceTurn(.microphoneStarted)
    }

    private func stopMicrophoneWithEarcon() {
        applyEarcon(.microphoneStopped)
        applyVoiceTurn(.microphoneStopped)
    }

    private var hasSendableContent: Bool {
        hasTextContent || draftStore.draft.images.isEmpty == false
    }

    private var hasTextContent: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private var sendDisabled: Bool {
        isSending || hasIncompleteImages || hasIncompleteFiles || hasSendableContent == false
    }

    private var hasIncompleteImages: Bool {
        draftStore.draft.images.contains { image in
            guard case .local = image.state else {
                return true
            }
            return false
        }
    }

    private var hasIncompleteFiles: Bool {
        draftStore.draft.files.contains { file in
            guard case .uploaded = file.state else {
                return true
            }
            return false
        }
    }

    private var draftIsEmpty: Bool {
        draftStore.draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && draftStore.draft.images.isEmpty
            && draftStore.draft.files.isEmpty
            && draftStore.draft.selections.isEmpty
    }

    private func retryPendingEmission(_ emission: PendingEmission) {
        Task {
            await pendingStore.retry(id: emission.id)
        }
    }

    private func restorePendingEmission(_ emission: PendingEmission) {
        guard draftIsEmpty else {
            statusText = "Restore is available when the current draft is empty."
            return
        }
        Task {
            guard let restored = await pendingStore.takeForRestore(id: emission.id) else {
                return
            }
            await draftStore.restore(restored, boxID: emission.boxID)
            statusText = nil
        }
    }

    private func discardPendingEmission(_ emission: PendingEmission) {
        Task {
            await pendingStore.discard(id: emission.id)
        }
    }

    private var text: String {
        draftStore.draft.text
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { draftStore.draft.text },
            set: { draftStore.setText($0) }
        )
    }

    private var selectionBinding: Binding<NSRangeValue> {
        Binding(
            get: { draftStore.draft.selection },
            set: { draftStore.setSelection($0) }
        )
    }

    private func loadPhotos(from items: [PhotosPickerItem]) async {
        guard items.isEmpty == false else {
            return
        }
        // Too many to ride inline: base64-ing this many photos into one
        // /chat/send is the failure this branch exists to prevent. Upload them
        // and let the agent file them instead. Mirrors the web composer's
        // `shouldBatchPhotos` — see docs/mobile-contract.md §8, INLINE_PHOTO_LIMIT.
        if BulkPhotoThreshold.shouldBatch(existingInline: draftStore.draft.images.count, incoming: items.count) {
            selectedPhotoItems = []
            await uploadPhotoBatch(items)
            return
        }

        for item in items {
            guard let sourceData = try? await item.loadTransferable(type: Data.self) else {
                continue
            }
            let sourceMimeType = item.supportedContentTypes
                .first(where: { $0.conforms(to: .image) })?.preferredMIMEType ?? "image/jpeg"
            await appendImage(data: sourceData, sourceMimeType: sourceMimeType)
        }
        selectedPhotoItems = []
    }

    /// Stage a large photo selection to disk, upload it as a bulk batch, and let
    /// the box deliver an `<upload>` message the agent files. The composer text
    /// rides along as the batch's introduction and is cleared once the box
    /// confirms delivery — the same "consumed on send" semantics as an ordinary
    /// message.
    private func uploadPhotoBatch(_ items: [PhotosPickerItem]) async {
        // The batch binds to a specific chat, and only the webview knows which one
        // is visible (it arrives here as the composer box's session id). Without
        // it there is nothing to deliver into, so say so rather than silently
        // falling back to the inline path that cannot carry this many.
        guard let targetSessionID = box.sessionID, targetSessionID.isEmpty == false else {
            statusText = "Send a message first, then add these photos."
            return
        }

        batchProgress = BulkUploadProgress(total: items.count, uploaded: 0, failed: 0)
        statusText = "Preparing \(items.count) photos…"

        let uploadedAt = ISO8601DateFormatter().string(from: Date())
        // NOTE deliberately not read here. It is read at finalize (below), so the
        // caption the user types WHILE the photos upload is the one that ships.
        // Photos already in the composer join this batch. Leaving them behind
        // would split one intended message: the batch would carry the whole
        // composer text as its introduction while the older photos sat in the
        // composer with nothing describing them.
        let foldedIn = await stageComposerImages(uploadedAt: uploadedAt)

        var staged = await BulkPhotoStaging.stage(
            items: items,
            uploadedAt: uploadedAt,
            onProgress: { count in
                statusText = "Preparing \(count) of \(items.count) photos…"
            }
        )
        staged.prepared.insert(contentsOf: foldedIn.prepared, at: 0)
        staged.failures.append(contentsOf: foldedIn.failures)
        // No early return when nothing staged: if photos FAILED to import, the
        // box still needs to hear about them, otherwise the user is told "none
        // could be read" and no card, message or record of the attempt exists
        // anywhere. Only a genuinely empty selection (nothing staged AND nothing
        // failed) has nothing to report.
        guard staged.prepared.isEmpty == false || staged.failures.isEmpty == false else {
            batchProgress = nil
            statusText = "None of those photos could be read."
            return
        }

        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: box),
            onProgress: { progress in
                Task { @MainActor in batchProgress = progress }
            }
        )
        // Photos that failed to import are reported to the box too. They were
        // never registered, so without this the batch card would simply not
        // mention them and the user would be told "69 uploaded" with no sign the
        // 70th ever existed.
        // The introduction is whatever is in the composer when the batch seals —
        // read on the main actor at that moment, not captured up front.
        var consumedNote = ""
        let outcome = await coordinator.run(
            items: staged.prepared,
            targetSessionID: targetSessionID,
            note: { @MainActor in
                let text = draftStore.draft.text
                consumedNote = text
                return text.isEmpty ? nil : text
            },
            importFailures: staged.failures
        )

        batchProgress = nil

        switch outcome {
        case .delivered(let uploaded, let failed), .accepted(let uploaded, let failed):
            // Sealed either way, so the box holds the bytes AND the note: the
            // staged copies are redundant and the text has been carried away.
            // If delivery ultimately fails, the box surfaces it to the chat agent
            // rather than this client retrying — see `notifyStranded`.
            BulkPhotoStaging.discard(staged.prepared)
            clearComposerTextIfUnchanged(from: consumedNote)
            if case .accepted = outcome {
                statusText = "\(uploaded) photos sent — the box is still processing them."
            } else {
                statusText = failed == 0
                    ? "\(uploaded) photos uploaded."
                    : "\(uploaded) photos uploaded, \(failed) failed."
            }
        case .failed(let message):
            // Never sealed, so the box does NOT have this batch. Drop the staged
            // copies (nothing can use them) but keep the text, so the user can
            // simply try again.
            BulkPhotoStaging.discard(staged.prepared)
            statusText = "\(message) Your message was kept — try again."
        }
    }

    /// Move the composer's existing inline photos into the batch being started,
    /// clearing only the ones that actually made it to disk.
    ///
    /// Two things are deliberate. An image whose bytes can't be read, or whose
    /// staging write fails (disk full), is LEFT IN THE COMPOSER and reported as a
    /// failure — removing it would delete the only remaining copy, since
    /// `removeImage` drops the draft's payload. And an image still `.uploading`
    /// is skipped entirely: it has no final bytes yet, so staging it would ship a
    /// half-processed image and bypass the upright re-encode.
    private func stageComposerImages(uploadedAt: String) async -> (prepared: [PreparedBulkItem], failures: [BulkUploadAPI.FailedItem]) {
        let existing = draftStore.draft.images
        guard existing.isEmpty == false else { return ([], []) }
        var staged: [PreparedBulkItem] = []
        var failures: [BulkUploadAPI.FailedItem] = []
        var stagedImageIDs: [Int] = []

        for (index, image) in existing.enumerated() {
            if case .uploading = image.state { continue }
            let displayName = "pasted-image-\(String(format: "%03d", index + 1))"
            guard let data = await draftStore.imageData(for: image, boxID: box.id) else {
                failures.append(BulkUploadAPI.FailedItem(
                    id: nil, name: displayName, reason: "The image data could not be read."
                ))
                continue
            }
            guard let item = BulkPhotoStaging.stageComposerImage(
                data: data,
                mimeType: image.mimeType,
                index: index,
                uploadedAt: uploadedAt
            ) else {
                failures.append(BulkUploadAPI.FailedItem(
                    id: nil, name: displayName, reason: "The image could not be written to disk."
                ))
                continue
            }
            staged.append(item)
            stagedImageIDs.append(image.id)
        }

        // Remove ONLY what is safely on disk; anything skipped or failed stays in
        // the composer so the user still has it.
        for id in stagedImageIDs {
            await draftStore.removeImage(id: id)
        }
        return (staged, failures)
    }


    /// Clear the composer only if it still holds the text the batch took as its
    /// introduction.
    ///
    /// A batch can take a long time, and the composer is locked while it runs —
    /// but a queued keystroke, a restored draft, or a dictation commit can still
    /// land in between. Blindly clearing would delete a message the user wrote
    /// after the batch started, which is the same silent-loss failure this whole
    /// feature exists to remove.
    private func clearComposerTextIfUnchanged(from snapshot: String) {
        guard draftStore.draft.text == snapshot else { return }
        draftStore.setText("")
    }

    private func dismissPresentedContentForLock() {
        showingActions = false
        showingPairing = false
        showingCamera = false
        showingCapture = false
        showingFileImporter = false
        detailedSelection = nil
        focused = false
        selectedPhotoItems = []
        applyVoiceTurn(.microphoneStopped)
        draftStore.setVoiceSelectionContext(transcript: "", active: false)
    }

    private func openCamera() {
        showingActions = false
        DispatchQueue.main.async {
            showingCamera = true
        }
    }

    private func pasteImage() {
        showingActions = false
        if let pngData = UIPasteboard.general.data(forPasteboardType: UTType.png.identifier) {
            Task {
                await appendImage(data: pngData, sourceMimeType: "image/png")
            }
            return
        }
        guard let image = UIPasteboard.general.image else {
            statusText = "The clipboard does not contain an image."
            return
        }
        Task {
            await appendCameraImage(image)
        }
    }

    private func openFileImporter() {
        showingActions = false
        DispatchQueue.main.async {
            showingFileImporter = true
        }
    }

    private func takeScreenshot() {
        showingActions = false
        statusText = "Capturing visible chat..."
        onTakeScreenshot()
    }

    private func importFiles(_ urls: [URL]) async {
        for url in urls {
            await importFile(url)
        }
    }

    private func importFile(_ url: URL) async {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            let values = try url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
            let size = values.fileSize ?? 0
            guard size <= ChatUploadLimits.maximumFileBytes else {
                statusText = ChatAPI.ChatAPIError.fileTooLarge.localizedDescription
                return
            }
            let name = url.lastPathComponent.isEmpty ? "attachment" : url.lastPathComponent
            let mimeType = values.contentType?.preferredMIMEType ?? "application/octet-stream"
            guard let file = await draftStore.addFile(
                from: url,
                originalName: name,
                mimeType: mimeType,
                size: size
            ) else {
                return
            }
            await uploadFile(file)
        } catch {
            statusText = "File could not be imported: \(error.localizedDescription)"
        }
    }

    private func retryFile(_ file: DraftFile) {
        Task {
            await uploadFile(file)
        }
    }

    private func uploadFile(_ file: DraftFile) async {
        await draftStore.setFileState(id: file.id, state: .uploading(progress: 0), boxID: box.id)
        guard let data = await draftStore.fileData(for: file, boxID: box.id) else {
            await draftStore.setFileState(
                id: file.id,
                state: .failed(message: "Local file data is missing."),
                boxID: box.id
            )
            return
        }
        do {
            let uploaded = try await ChatAPI(box: box).uploadFile(
                data: data,
                filename: file.originalName,
                mimeType: file.mimetype,
                onProgress: { progress in
                    Task {
                        await draftStore.setFileProgress(id: file.id, progress: progress, boxID: box.id)
                    }
                }
            )
            await draftStore.markFileUploaded(id: file.id, upload: uploaded, boxID: box.id)
        } catch {
            await draftStore.setFileState(
                id: file.id,
                state: .failed(message: error.localizedDescription),
                boxID: box.id
            )
        }
    }

    private func removeFile(_ file: DraftFile) {
        Task {
            await draftStore.removeFile(id: file.id)
        }
    }

    private func removeSelection(_ selection: DraftSelection) {
        Task {
            await draftStore.removeSelection(id: selection.id)
        }
    }

    private func openPairing() {
        showingActions = false
        DispatchQueue.main.async {
            showingPairing = true
        }
    }

    private func toggleLocationSharing() {
        showingActions = false
        statusText = locationSharingEnabled ? "Turning location sharing off..." : "Requesting location..."
        onToggleLocationSharing()
    }

    private func appendCameraImage(_ image: UIImage) async {
        guard let sourceData = image.jpegData(compressionQuality: 1) else {
            statusText = "The camera image could not be prepared."
            return
        }
        await appendImage(data: sourceData, sourceMimeType: "image/jpeg")
    }

    private func appendImage(data: Data, sourceMimeType: String) async {
        guard let image = await draftStore.beginImageImport(data: data, mimeType: sourceMimeType) else {
            return
        }
        await processImage(image)
    }

    private func retryImage(_ image: DraftImage) {
        Task {
            await draftStore.setImageState(
                id: image.id,
                state: .uploading(progress: 0),
                boxID: box.id
            )
            await processImage(image)
        }
    }

    private func processImage(_ image: DraftImage) async {
        guard let sourceData = await draftStore.imageData(for: image, boxID: box.id) else {
            await draftStore.failImageImport(
                id: image.id,
                message: "Local image data is missing.",
                boxID: box.id
            )
            return
        }
        guard let encoded = ComposerImageEncoder.encode(data: sourceData, sourceMimeType: image.mimeType) else {
            await draftStore.failImageImport(
                id: image.id,
                message: "The image could not be processed.",
                boxID: box.id
            )
            return
        }
        await draftStore.completeImageImport(
            id: image.id,
            data: encoded.data,
            mimeType: encoded.mimeType,
            fileExtension: encoded.fileExtension,
            boxID: box.id
        )
    }
}

struct EncodedComposerImage {
    var data: Data
    var mimeType: String
    var fileExtension: String
}

enum ComposerImageEncoder {
    static let maximumDimension: CGFloat = 1_920

    static func encode(data: Data, sourceMimeType: String) -> EncodedComposerImage? {
        guard let image = UIImage(data: data) else {
            return nil
        }
        return encode(image: image, sourceMimeType: sourceMimeType)
    }

    static func encode(image: UIImage, sourceMimeType: String) -> EncodedComposerImage? {
        let longestSide = max(image.size.width, image.size.height)
        let scale = longestSide > maximumDimension ? maximumDimension / longestSide : 1
        let targetSize = CGSize(
            width: max(1, round(image.size.width * scale)),
            height: max(1, round(image.size.height * scale))
        )
        let preservesPNG = sourceMimeType.lowercased() == "image/png"
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = preservesPNG == false
        let bounds = CGRect(origin: .zero, size: targetSize)
        let normalized = UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            if preservesPNG == false {
                UIColor.white.setFill()
                UIRectFill(bounds)
            }
            image.draw(in: bounds)
        }
        if preservesPNG, let data = normalized.pngData() {
            return EncodedComposerImage(data: data, mimeType: "image/png", fileExtension: "png")
        }
        guard let data = normalized.jpegData(compressionQuality: 0.85) else {
            return nil
        }
        return EncodedComposerImage(data: data, mimeType: "image/jpeg", fileExtension: "jpg")
    }
}

enum CameraImageEncoder {
    static func jpegData(from image: UIImage) -> Data? {
        ComposerImageEncoder.encode(image: image, sourceMimeType: "image/jpeg")?.data
    }
}

private struct ImageAttachmentStrip: View {
    var images: [DraftImage]
    @ObservedObject var draftStore: ComposerDraftStore
    var onRetry: (DraftImage) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(images) { image in
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            DraftImageThumbnail(image: image, draftStore: draftStore)
                                .frame(width: 58, height: 58)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(.separator, lineWidth: 1)
                                }
                            Button {
                                Task {
                                    await draftStore.removeImage(id: image.id)
                                }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .black.opacity(0.65))
                            }
                            .frame(width: 44, height: 44, alignment: .topTrailing)
                            .accessibilityLabel("Remove photo \(image.id)")
                            if case .uploading = image.state {
                                ProgressView()
                                    .padding(5)
                                    .background(.regularMaterial, in: Circle())
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                            } else if case .failed(let message) = image.state {
                                Button {
                                    onRetry(image)
                                } label: {
                                    Image(systemName: "arrow.clockwise.circle.fill")
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .red)
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                                .frame(minWidth: 44, minHeight: 44)
                                .accessibilityLabel("Retry photo \(image.id)")
                                .accessibilityHint(message)
                            }
                        }
                        if case .failed = image.state {
                            Text("Failed")
                                .font(.caption2)
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
    }
}

private struct DraftImageThumbnail: View {
    var image: DraftImage
    @ObservedObject var draftStore: ComposerDraftStore
    @State private var uiImage: UIImage?

    var body: some View {
        Group {
            if let uiImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "photo")
                    .font(.title2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.thinMaterial)
            }
        }
        .accessibilityLabel("Photo \(image.id)")
        .accessibilityValue(accessibilityStatus)
        .task(id: image.filename) {
            guard let data = await draftStore.imageData(for: image) else {
                return
            }
            uiImage = UIImage(data: data)
        }
    }

    private var accessibilityStatus: String {
        switch image.state {
        case .local:
            "Ready"
        case .uploading(let progress):
            "Processing \(Int(progress * 100)) percent"
        case .uploaded:
            "Uploaded"
        case .failed(let message):
            "Failed: \(message)"
        }
    }
}

private struct FileAttachmentList: View {
    var files: [DraftFile]
    var onRetry: (DraftFile) -> Void
    var onRemove: (DraftFile) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(files) { file in
                HStack(spacing: 10) {
                    Image(systemName: "doc")
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.originalName)
                            .font(.subheadline)
                            .lineLimit(1)
                        Text(status(for: file))
                            .font(.caption)
                            .foregroundStyle(statusColor(for: file))
                            .lineLimit(2)
                    }
                    Spacer()
                    if case .uploading(let progress) = file.state {
                        ProgressView(value: progress)
                            .frame(width: 54)
                    } else if canRetry(file) {
                        Button("Retry") {
                            onRetry(file)
                        }
                        .font(.caption)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                    Button {
                        onRemove(file)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .frame(width: 44, height: 44)
                    .accessibilityLabel("Remove \(file.originalName)")
                }
                .padding(10)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func status(for file: DraftFile) -> String {
        switch file.state {
        case .local:
            "Waiting to upload"
        case .uploading(let progress):
            "Uploading \(Int(progress * 100))%"
        case .uploaded:
            ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)
        case .failed(let message):
            message
        }
    }

    private func statusColor(for file: DraftFile) -> Color {
        if case .failed = file.state {
            return .red
        }
        return .secondary
    }

    private func canRetry(_ file: DraftFile) -> Bool {
        switch file.state {
        case .local, .failed:
            true
        case .uploading, .uploaded:
            false
        }
    }
}

private struct PendingEmissionList: View {
    var emissions: [PendingEmission]
    var voicePreparations: [VoicePreparation]
    var canRestore: Bool
    var onRetry: (PendingEmission) -> Void
    var onRestore: (PendingEmission) -> Void
    var onDiscard: (PendingEmission) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(voicePreparations) { _ in
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Improving voice transcription…")
                        .font(.caption)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(emissions) { emission in
                switch emission.state {
                case .awaitingWebView, .awaitingReceipt:
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Sending message…")
                            .font(.caption)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                case .rejected(let reason):
                    VStack(alignment: .leading, spacing: 6) {
                        Label(reason, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                        HStack(spacing: 12) {
                            Button("Retry") { onRetry(emission) }
                                .frame(minHeight: 44)
                            Button("Restore") { onRestore(emission) }
                                .disabled(canRestore == false)
                                .frame(minHeight: 44)
                            Button("Discard", role: .destructive) { onDiscard(emission) }
                                .frame(minHeight: 44)
                        }
                        .font(.caption.weight(.semibold))
                    }
                }
            }
        }
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct SelectionAttachmentList: View {
    var selections: [DraftSelection]
    var onOpen: (DraftSelection) -> Void
    var onRemove: (DraftSelection) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(selections) { selection in
                    HStack(spacing: 6) {
                        Button {
                            onOpen(selection)
                        } label: {
                            Label(selection.ref, systemImage: "text.quote")
                                .font(.caption)
                                .lineLimit(1)
                        }
                        .buttonStyle(.plain)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Show selection from \(selection.ref)")
                        Button {
                            onRemove(selection)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel("Remove selection from \(selection.ref)")
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(.quaternary, in: Capsule())
                }
            }
        }
    }
}

private struct SelectionDetailView: View {
    var selection: DraftSelection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Source") {
                    Text(selection.ref)
                    Text(selection.position)
                        .foregroundStyle(.secondary)
                }
                Section("Selected text") {
                    Text(selection.text)
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("Selection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
