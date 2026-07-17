import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct NativeComposerView: View {
    var box: PairedBox
    var emissionReceipt: NativeEmissionReceipt?
    var locationShareResult: NativeLocationShareResult?
    var onSendEmission: (NativeChatEmission) -> Void
    var onShareLocation: () -> Void

    @EnvironmentObject private var store: PairedBoxStore
    @State private var text = ""
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var images: [ChatImageAttachment] = []
    @State private var statusText: String?
    @State private var lastSentEmission: NativeChatEmission?
    @State private var showingActions = false
    @State private var showingPairing = false
    @State private var showingCamera = false
    @StateObject private var dictation = SpeechDictation()
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let statusText = dictation.errorMessage ?? dictation.preparationMessage ?? statusText {
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }
            if images.isEmpty == false {
                ImageAttachmentStrip(images: images, onRemove: removeImage)
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
        .onAppear(perform: loadDraft)
        .onChange(of: text) { _, newValue in
            UserDefaults.standard.set(newValue, forKey: draftKey)
            dictation.noteManualTextChange(newValue)
        }
        .onChange(of: dictation.transcript) { _, newValue in
            text = newValue
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
            switch receipt.disposition {
            case .sent, .queued:
                statusText = nil
            case .rejected:
                text = emission.text
                images = emission.images
                statusText = receipt.reason ?? "The message was not accepted."
            }
            lastSentEmission = nil
        }
        .onChange(of: locationShareResult) { _, result in
            guard let result else {
                return
            }
            statusText = result.message
        }
        .onDisappear {
            dictation.stop()
        }
        .sheet(isPresented: $showingActions) {
            ComposerActionsView(
                selectedPhotoItems: $selectedPhotoItems,
                canTakePhoto: UIImagePickerController.isSourceTypeAvailable(.camera),
                onTakePhoto: openCamera,
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
                appendCameraImage(image)
            } onCancel: {
                showingCamera = false
            }
            .ignoresSafeArea()
        }
    }

    private var textEntry: some View {
        TextField("Type...", text: $text, axis: .vertical)
            .focused($focused)
            .lineLimit(1...5)
            .font(.body)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 58)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Type a message")
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
        } else if images.isEmpty == false {
            HStack(spacing: 10) {
                microphoneButton
                composerButton(
                    systemImage: "arrow.up",
                    accessibilityLabel: "Send photo",
                    foregroundStyle: .white,
                    backgroundStyle: Color.accentColor,
                    action: send
                )
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
        let emission = NativeChatEmission(text: message, origin: origin, diarized: false, images: images)
        dictation.resetDictationState()
        text = ""
        images = []
        selectedPhotoItems = []
        UserDefaults.standard.removeObject(forKey: draftKey)
        focused = false
        lastSentEmission = emission
        statusText = "Sending to chat..."
        onSendEmission(emission)
    }

    private func handleKeywordIntent(_ intent: SpeechKeywordResult) {
        dictation.clearKeywordIntent()
        switch intent.action {
        case .send, .sendClose:
            sendKeywordIntent(intent)
        case .cancel:
            text = ""
            images = []
            selectedPhotoItems = []
            dictation.resetDictationState()
            UserDefaults.standard.removeObject(forKey: draftKey)
            statusText = "Message cancelled."
        case .micOff:
            dictation.stop()
            statusText = "Microphone off."
        case .erase:
            text = ""
            images = []
            selectedPhotoItems = []
            dictation.resetDictationState()
            UserDefaults.standard.removeObject(forKey: draftKey)
            statusText = "Message erased."
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
        let emission = NativeChatEmission(text: preparedText, origin: .voice, diarized: diarized, images: images)
        dictation.resetDictationState()
        text = ""
        images = []
        selectedPhotoItems = []
        UserDefaults.standard.removeObject(forKey: draftKey)
        focused = false
        lastSentEmission = emission
        statusText = "Sending to chat..."
        onSendEmission(emission)
    }

    private var isSending: Bool {
        lastSentEmission != nil
    }

    private var hasSendableContent: Bool {
        hasTextContent || images.isEmpty == false
    }

    private var hasTextContent: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private var sendDisabled: Bool {
        isSending || hasSendableContent == false
    }

    private var draftKey: String {
        "draft.\(box.id.uuidString)"
    }

    private func loadDraft() {
        guard text.isEmpty else {
            return
        }
        text = UserDefaults.standard.string(forKey: draftKey) ?? ""
    }

    private func loadPhotos(from items: [PhotosPickerItem]) async {
        guard items.isEmpty == false else {
            return
        }
        var loaded = images
        for item in items.prefix(max(0, 4 - loaded.count)) {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                continue
            }
            let mimeType = item.supportedContentTypes.first { type in
                type.conforms(to: .image) && type.preferredMIMEType != nil
            }?.preferredMIMEType ?? "image/jpeg"
            loaded.append(
                ChatImageAttachment(
                    id: loaded.count + 1,
                    mimeType: mimeType,
                    dataBase64: data.base64EncodedString()
                )
            )
        }
        images = Array(loaded.prefix(4))
        selectedPhotoItems = []
    }

    private func removeImage(_ image: ChatImageAttachment) {
        images.removeAll { $0.id == image.id }
        images = images.enumerated().map { index, image in
            ChatImageAttachment(id: index + 1, mimeType: image.mimeType, dataBase64: image.dataBase64)
        }
    }

    private func openCamera() {
        showingActions = false
        DispatchQueue.main.async {
            showingCamera = true
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

    private func appendCameraImage(_ image: UIImage) {
        guard images.count < 4, let data = CameraImageEncoder.jpegData(from: image) else {
            return
        }
        images.append(
            ChatImageAttachment(
                id: images.count + 1,
                mimeType: "image/jpeg",
                dataBase64: data.base64EncodedString()
            )
        )
    }
}

enum CameraImageEncoder {
    static func jpegData(from image: UIImage) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = true
        let bounds = CGRect(origin: .zero, size: image.size)
        let uprightImage = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(bounds)
            image.draw(in: bounds)
        }
        return uprightImage.jpegData(compressionQuality: 0.85)
    }
}

private struct ImageAttachmentStrip: View {
    var images: [ChatImageAttachment]
    var onRemove: (ChatImageAttachment) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(images) { image in
                    ZStack(alignment: .topTrailing) {
                        thumbnail(for: image)
                            .frame(width: 58, height: 58)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay {
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(.separator, lineWidth: 1)
                            }
                        Button {
                            onRemove(image)
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

    @ViewBuilder
    private func thumbnail(for image: ChatImageAttachment) -> some View {
        if
            let data = Data(base64Encoded: image.dataBase64),
            let uiImage = UIImage(data: data)
        {
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
}
