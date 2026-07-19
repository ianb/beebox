import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct NativeComposerView: View {
    var box: PairedBox
    @ObservedObject var draftStore: ComposerDraftStore
    var captureAvailable: Bool
    var emissionReceipt: NativeEmissionReceipt?
    var locationShareResult: NativeLocationShareResult?
    var screenshotResult: NativeScreenshotResult?
    var onSendEmission: (NativeChatEmission) -> Void
    var onShareLocation: () -> Void
    var onTakeScreenshot: () -> Void

    @EnvironmentObject private var store: PairedBoxStore
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var statusText: String?
    @State private var lastSentEmission: NativeChatEmission?
    @State private var lastSentDraft: ComposerDraft?
    @State private var lastSentBoxID: UUID?
    @State private var isPreparingSend = false
    @State private var editorHeight: CGFloat = 58
    @State private var focused = false
    @State private var showingActions = false
    @State private var showingPairing = false
    @State private var showingCamera = false
    @State private var showingCapture = false
    @State private var showingFileImporter = false
    @StateObject private var dictation = SpeechDictation()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let statusText = dictation.errorMessage ?? dictation.preparationMessage ?? statusText ?? draftStore.restoreNotice {
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }
            if draftStore.draft.images.isEmpty == false {
                ImageAttachmentStrip(images: draftStore.draft.images, draftStore: draftStore)
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
        .background(.regularMaterial)
        .ignoresSafeArea(.container, edges: .bottom)
        .onChange(of: draftStore.draft.text) { _, newValue in
            dictation.noteManualTextChange(newValue)
        }
        .onChange(of: dictation.transcript) { _, newValue in
            draftStore.setText(newValue)
        }
        .onChange(of: dictation.keywordIntent) { _, newValue in
            guard let newValue else {
                return
            }
            handleKeywordIntent(newValue)
        }
        .onChange(of: selectedPhotoItems) { _, newValue in
            Task {
                await loadPhotos(from: newValue)
            }
        }
        .onChange(of: emissionReceipt) { _, receipt in
            guard let receipt, let emission = lastSentEmission, receipt.emissionID == emission.id else {
                return
            }
            let sentDraft = lastSentDraft
            let sentBoxID = lastSentBoxID
            lastSentEmission = nil
            lastSentDraft = nil
            lastSentBoxID = nil
            switch receipt.disposition {
            case .sent, .queued:
                statusText = nil
                if let sentDraft, let sentBoxID {
                    Task {
                        await draftStore.discard(sentDraft, boxID: sentBoxID)
                    }
                }
            case .rejected:
                statusText = receipt.reason ?? "The message was not accepted."
                if let sentDraft, let sentBoxID {
                    Task {
                        await draftStore.restore(sentDraft, boxID: sentBoxID)
                    }
                }
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
            dictation.stop()
        }
        .sheet(isPresented: $showingActions) {
            ComposerActionsView(
                selectedPhotoItems: $selectedPhotoItems,
                canCapture: captureAvailable,
                canTakePhoto: UIImagePickerController.isSourceTypeAvailable(.camera),
                canPasteImage: UIPasteboard.general.hasImages,
                onCapture: openCapture,
                onTakePhoto: openCamera,
                onPasteImage: pasteImage,
                onChooseFile: openFileImporter,
                onScreenshot: takeScreenshot,
                onShareLocation: shareLocation,
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
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(isSending == false)
    }

    @ViewBuilder
    private var trailingControl: some View {
        if isSending {
            ProgressView()
                .frame(width: 58, height: 58)
                .background(.quaternary, in: Circle())
        } else if dictation.isRecording {
            composerButton(
                systemImage: "stop.fill",
                accessibilityLabel: "Stop dictation",
                foregroundStyle: .red,
                action: { dictation.stop() }
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
            action: { dictation.toggle(currentText: text) }
        )
    }

    private func openCapture() {
        guard captureAvailable else {
            return
        }
        dictation.stop()
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
        dictation.stop()
        let origin: NativeChatEmission.Origin = dictation.hasDictatedText ? .voice : .typed
        enqueueMessage(text: message, origin: origin, diarized: false)
    }

    private func handleKeywordIntent(_ intent: SpeechKeywordResult) {
        dictation.clearKeywordIntent()
        switch intent.action {
        case .send, .sendClose:
            sendKeywordIntent(intent)
        case .cancel:
            selectedPhotoItems = []
            dictation.resetDictationState()
            statusText = "Message cancelled."
            Task {
                await draftStore.discardCurrentDraft()
            }
        case .micOff:
            dictation.stop()
            statusText = "Microphone off."
        case .erase:
            selectedPhotoItems = []
            dictation.resetDictationState()
            statusText = "Message erased."
            Task {
                await draftStore.discardCurrentDraft()
            }
        }
    }

    private func sendKeywordIntent(_ intent: SpeechKeywordResult) {
        let audioURL = dictation.consumeRecordedAudioURL()
        let priorInput = dictation.consumeKeywordSeedText()
        statusText = audioURL == nil ? "Sending..." : "Improving transcription..."
        Task {
            let prepared = await prepareKeywordMessage(
                intent: intent,
                priorInput: priorInput,
                audioURL: audioURL
            )
            await MainActor.run {
                enqueuePreparedVoiceMessage(text: prepared.text, diarized: prepared.diarized)
            }
        }
    }

    private func prepareKeywordMessage(
        intent: SpeechKeywordResult,
        priorInput: String,
        audioURL: URL?
    ) async -> (text: String, diarized: Bool) {
        guard let audioURL else {
            return (intent.processedTranscript, false)
        }
        do {
            let hqResult = try await ChatAPI(box: box).transcribeAudio(fileURL: audioURL)
            let processed = SpeechKeywords.detect(hqResult.text)?.processedTranscript
                ?? SpeechKeywords.appendSendKeywordTag(
                    to: hqResult.text,
                    action: intent.action,
                    matchedPhrase: intent.matchedPhrase
                )
            try? FileManager.default.removeItem(at: audioURL)
            return (Self.joinTranscript(priorInput, processed), hqResult.diarized)
        } catch {
            await MainActor.run {
                statusText = "HQ transcription failed; sending live dictation."
            }
            return (intent.processedTranscript, false)
        }
    }

    private static func joinTranscript(_ first: String, _ second: String) -> String {
        let cleanFirst = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSecond = second.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleanFirst.isEmpty {
            return cleanSecond
        }
        if cleanSecond.isEmpty {
            return cleanFirst
        }
        return "\(cleanFirst) \(cleanSecond)"
    }

    private func enqueuePreparedVoiceMessage(text preparedText: String, diarized: Bool) {
        guard preparedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            statusText = "Nothing to send."
            return
        }
        enqueueMessage(text: preparedText, origin: .voice, diarized: diarized)
    }

    private func enqueueMessage(
        text: String,
        origin: NativeChatEmission.Origin,
        diarized: Bool
    ) {
        let snapshot = draftStore.draft
        let sendingBoxID = box.id
        isPreparingSend = true
        statusText = "Preparing attachments..."
        Task {
            do {
                let attachments = try await draftStore.emissionImages(from: snapshot, boxID: sendingBoxID)
                let files = try draftStore.emissionFiles(from: snapshot)
                let emission = NativeChatEmission(
                    text: text,
                    origin: origin,
                    diarized: diarized,
                    images: attachments,
                    files: files
                )
                await draftStore.clearForSending(boxID: sendingBoxID)
                dictation.resetDictationState()
                selectedPhotoItems = []
                focused = false
                lastSentDraft = snapshot
                lastSentBoxID = sendingBoxID
                lastSentEmission = emission
                isPreparingSend = false
                statusText = "Sending to chat..."
                onSendEmission(emission)
            } catch {
                isPreparingSend = false
                statusText = "An attachment could not be read."
            }
        }
    }

    private var isSending: Bool {
        isPreparingSend || lastSentEmission != nil
    }

    private var hasSendableContent: Bool {
        hasTextContent || draftStore.draft.images.isEmpty == false
    }

    private var hasTextContent: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private var sendDisabled: Bool {
        isSending || hasIncompleteFiles || hasSendableContent == false
    }

    private var hasIncompleteFiles: Bool {
        draftStore.draft.files.contains { file in
            guard case .uploaded = file.state else {
                return true
            }
            return false
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
                mimeType: file.mimetype
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

    private func openPairing() {
        showingActions = false
        DispatchQueue.main.async {
            showingPairing = true
        }
    }

    private func shareLocation() {
        showingActions = false
        statusText = "Requesting location..."
        onShareLocation()
    }

    private func appendCameraImage(_ image: UIImage) async {
        guard let encoded = ComposerImageEncoder.encode(image: image, sourceMimeType: "image/jpeg") else {
            return
        }
        await draftStore.addImage(
            data: encoded.data,
            mimeType: encoded.mimeType,
            fileExtension: encoded.fileExtension
        )
    }

    private func appendImage(data: Data, sourceMimeType: String) async {
        guard let encoded = ComposerImageEncoder.encode(data: data, sourceMimeType: sourceMimeType) else {
            statusText = "The image could not be processed."
            return
        }
        await draftStore.addImage(
            data: encoded.data,
            mimeType: encoded.mimeType,
            fileExtension: encoded.fileExtension
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

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(images) { image in
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
                        .offset(x: 5, y: -5)
                        .accessibilityLabel("Remove photo")
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
        .task(id: image.filename) {
            guard let data = await draftStore.imageData(for: image) else {
                return
            }
            uiImage = UIImage(data: data)
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
                    if case .uploading = file.state {
                        ProgressView()
                    } else if canRetry(file) {
                        Button("Retry") {
                            onRetry(file)
                        }
                        .font(.caption)
                    }
                    Button {
                        onRemove(file)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .accessibilityLabel("Remove file")
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
        case .uploading:
            "Uploading..."
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
