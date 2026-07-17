import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct NativeComposerView: View {
    var box: PairedBox
    var deliveredEmissionID: NativeChatEmission.ID? = nil
    var onSendEmission: (NativeChatEmission) -> Void

    @EnvironmentObject private var outbox: OutboxStore
    @State private var text = ""
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var images: [ChatImageAttachment] = []
    @State private var pendingVoiceMessage: PendingVoiceMessage?
    @State private var statusText: String?
    @State private var lastSentEmissionID: NativeChatEmission.ID?
    @StateObject private var dictation = SpeechDictation()
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let statusText = dictation.errorMessage ?? statusText {
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message", text: $text, axis: .vertical)
                    .focused($focused)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)

                PhotosPicker(
                    selection: $selectedPhotoItems,
                    maxSelectionCount: 4,
                    matching: .images
                ) {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 26))
                }
                .disabled(isSending)
                .accessibilityLabel("Attach photos")

                Button {
                    dictation.toggle(currentText: text)
                } label: {
                    Image(systemName: dictation.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(dictation.isRecording ? .red : .primary)
                }
                .disabled(isSending)
                .accessibilityLabel(dictation.isRecording ? "Stop dictation" : "Start dictation")

                Button(action: send) {
                    if isSending {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30))
                    }
                }
                .disabled(sendDisabled)
                .accessibilityLabel("Send")
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .padding(.top, 8)

            if images.isEmpty == false {
                ImageAttachmentStrip(images: images, onRemove: removeImage)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            }

            if let pendingVoiceMessage {
                VoiceConfirmationView(
                    message: pendingVoiceMessage,
                    currentText: text,
                    onSend: confirmVoiceSend,
                    onKeepEditing: keepEditingVoiceSend
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }

            let queuedMessages = outbox.messages(for: box)
            if queuedMessages.isEmpty == false {
                OutboxListView(
                    messages: queuedMessages,
                    onRetry: retry,
                    onDiscard: outbox.discard
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .background(.regularMaterial)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Send", systemImage: "arrow.up.circle.fill", action: send)
                    .disabled(sendDisabled)
            }
        }
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
        .onChange(of: deliveredEmissionID) { _, newValue in
            guard let newValue, newValue == lastSentEmissionID else {
                return
            }
            statusText = "Sent to chat."
            lastSentEmissionID = nil
        }
        .onDisappear {
            dictation.stop()
        }
        .task(id: box.id) {
            await outbox.retryPending(for: box)
        }
    }

    private func send() {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard sendDisabled == false else {
            return
        }
        dictation.stop()
        let origin: QueuedMessage.Origin = dictation.hasDictatedText ? .voice : .typed
        let emission = NativeChatEmission(text: message, origin: origin, diarized: false, images: images)
        pendingVoiceMessage = nil
        dictation.resetDictationState()
        text = ""
        images = []
        selectedPhotoItems = []
        UserDefaults.standard.removeObject(forKey: draftKey)
        focused = false
        lastSentEmissionID = emission.id
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
                text = prepared.text
                pendingVoiceMessage = PendingVoiceMessage(diarized: prepared.diarized)
                statusText = "Voice message ready."
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

    private func confirmVoiceSend() {
        guard let pendingVoiceMessage else {
            return
        }
        enqueuePreparedVoiceMessage(text: text, diarized: pendingVoiceMessage.diarized)
    }

    private func keepEditingVoiceSend() {
        pendingVoiceMessage = nil
        dictation.resetDictationState()
        statusText = "Voice message kept as a draft."
    }

    private func enqueuePreparedVoiceMessage(text preparedText: String, diarized: Bool) {
        guard preparedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            statusText = "Nothing to send."
            return
        }
        let emission = NativeChatEmission(text: preparedText, origin: .voice, diarized: diarized, images: images)
        pendingVoiceMessage = nil
        dictation.resetDictationState()
        text = ""
        images = []
        selectedPhotoItems = []
        UserDefaults.standard.removeObject(forKey: draftKey)
        focused = false
        lastSentEmissionID = emission.id
        statusText = "Sending to chat..."
        onSendEmission(emission)
    }

    private func retry(_ message: QueuedMessage) {
        statusText = "Retrying..."
        Task {
            await outbox.send(messageID: message.id, box: box)
        }
    }

    private var isSending: Bool {
        outbox.messages(for: box).contains { $0.state == .sending }
    }

    private var sendDisabled: Bool {
        pendingVoiceMessage != nil || (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty)
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
        var loaded: [ChatImageAttachment] = []
        for (index, item) in items.prefix(4).enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                continue
            }
            let mimeType = item.supportedContentTypes.first { type in
                type.conforms(to: .image) && type.preferredMIMEType != nil
            }?.preferredMIMEType ?? "image/jpeg"
            loaded.append(
                ChatImageAttachment(
                    id: index + 1,
                    mimeType: mimeType,
                    dataBase64: data.base64EncodedString()
                )
            )
        }
        images = loaded
    }

    private func removeImage(_ image: ChatImageAttachment) {
        images.removeAll { $0.id == image.id }
        images = images.enumerated().map { index, image in
            ChatImageAttachment(id: index + 1, mimeType: image.mimeType, dataBase64: image.dataBase64)
        }
    }
}

private struct PendingVoiceMessage: Equatable {
    var diarized: Bool
}

private struct VoiceConfirmationView: View {
    var message: PendingVoiceMessage
    var currentText: String
    var onSend: () -> Void
    var onKeepEditing: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "waveform")
                    .foregroundStyle(.secondary)
                Text(message.diarized ? "Diarized voice message ready" : "Voice message ready")
                    .font(.caption)
                    .fontWeight(.semibold)
                Spacer()
            }
            Text(currentText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack(spacing: 8) {
                Button("Send", action: onSend)
                    .buttonStyle(.borderedProminent)
                Button("Keep Editing", action: onKeepEditing)
                    .buttonStyle(.bordered)
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
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

private struct OutboxListView: View {
    var messages: [QueuedMessage]
    var onRetry: (QueuedMessage) -> Void
    var onDiscard: (QueuedMessage) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(messages) { message in
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: iconName(for: message))
                        .foregroundStyle(iconColor(for: message))
                        .frame(width: 20)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(title(for: message))
                            .font(.caption)
                            .fontWeight(.semibold)
                        Text(message.text)
                            .font(.caption)
                            .lineLimit(2)
                            .foregroundStyle(.secondary)
                        if message.images.isEmpty == false {
                            Text("\(message.images.count) photo\(message.images.count == 1 ? "" : "s") attached")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let lastError = message.lastError {
                            Text(lastError)
                                .font(.caption2)
                                .lineLimit(2)
                                .foregroundStyle(.red)
                        }
                    }

                    Spacer(minLength: 8)

                    if message.state != .sending {
                        Button {
                            onRetry(message)
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Retry")
                    }

                    Button(role: .destructive) {
                        onDiscard(message)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Discard")
                }
                .padding(8)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func title(for message: QueuedMessage) -> String {
        switch message.state {
        case .pending:
            "Pending"
        case .sending:
            "Sending..."
        case .failed:
            "Failed, saved for retry"
        }
    }

    private func iconName(for message: QueuedMessage) -> String {
        switch message.state {
        case .pending:
            "clock"
        case .sending:
            "paperplane"
        case .failed:
            "exclamationmark.circle"
        }
    }

    private func iconColor(for message: QueuedMessage) -> Color {
        switch message.state {
        case .pending, .sending:
            .secondary
        case .failed:
            .red
        }
    }
}
