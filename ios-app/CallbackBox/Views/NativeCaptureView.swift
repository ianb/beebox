import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

enum NativeCaptureSurfacePhase: Equatable {
    case starting
    case choosingResume(ResumableCapture)
    case active
    case recording
    case sealing
    case recovery(title: String, message: String)
    case failed(message: String)
}

struct NativeCaptureSurfaceCounts: Equatable {
    var photos = 0
    var files = 0
    var audioSegments = 0
    /// Staged locally, not yet handed to a background upload task.
    var queued = 0
    var uploading = 0
    var uploaded = 0
    var failed = 0

    var totalItems: Int {
        photos + files + audioSegments
    }

    /// Everything still owed to the box. `queued` counts because a `.local`
    /// item is pending work the user cannot see any other way — leaving it out
    /// let Done sail past the "some items have not uploaded" prompt and into a
    /// wait it could not escape.
    var pending: Int {
        queued + uploading
    }

    /// Whether Done must ask the user what to do rather than sealing straight
    /// away. True while anything is still owed to the box or has failed — the
    /// prompt is what makes those two outcomes escapable.
    var needsFinishPrompt: Bool {
        failed > 0 || pending > 0
    }
}

struct NativeCaptureSurfaceState: Equatable {
    var destinationLabel: String
    var phase: NativeCaptureSurfacePhase = .starting
    var counts = NativeCaptureSurfaceCounts()
    /// Advances only when the camera produces a photo, never for gallery imports.
    var captureFeedbackSequence = 0
    var elapsedSeconds = 0
    var banner: String?
    var cameraAvailable = true
    var canRetry = false
    var canOpenSettings = false

    var isRecording: Bool {
        phase == .recording
    }

    var isBusy: Bool {
        switch phase {
        case .starting, .choosingResume, .sealing:
            true
        case .active, .recording, .recovery, .failed:
            false
        }
    }

    var blocksAcquisition: Bool {
        switch phase {
        case .active, .recording:
            false
        case .starting, .choosingResume, .sealing, .recovery, .failed:
            true
        }
    }

    var canFinish: Bool {
        counts.totalItems > 0 && blocksAcquisition == false
    }
}

struct NativeCaptureView<Preview: View>: View {
    var state: NativeCaptureSurfaceState
    @ViewBuilder var preview: () -> Preview
    var onCancel: () -> Void
    var onShutter: () -> Void
    var onFlipCamera: () -> Void
    var onToggleRecording: () -> Void
    var onAddPhotos: ([PhotosPickerItem]) -> Void
    var onAddFiles: ([URL]) -> Void
    var onRetry: () -> Void
    var onOpenSettings: () -> Void
    var onFinish: () -> Void
    var onSubmitUploadedItems: () -> Void
    var onSkipPendingUploads: () -> Void
    var onSendFollowUp: () -> Void
    var onDiscardRemaining: () -> Void

    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var showingFileImporter = false
    @State private var showingCancelConfirmation = false
    @State private var showingFinishChoices = false
    @State private var showingCaptureFlash = false
    @State private var captureFlashTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            preview()
                .ignoresSafeArea()

            Color.white
                .opacity(showingCaptureFlash ? 0.82 : 0)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                topChrome
                Spacer(minLength: 24)
                interruptionPanel
                bottomChrome
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .sensoryFeedback(.impact(weight: .medium), trigger: state.captureFeedbackSequence)
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.data, .content],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                onAddFiles(urls)
            }
        }
        .confirmationDialog("Discard this capture?", isPresented: $showingCancelConfirmation) {
            Button("Discard Capture", role: .destructive, action: onCancel)
            Button("Keep Capturing", role: .cancel) {}
        } message: {
            Text("Media that has not been submitted will be removed from this phone.")
        }
        .confirmationDialog("Some items have not uploaded", isPresented: $showingFinishChoices) {
            if state.canRetry {
                Button("Retry Uploads", action: onRetry)
            }
            if state.counts.uploaded > 0 {
                Button("Submit Uploaded Items", action: onSubmitUploadedItems)
            }
            Button("Wait for Them", action: onFinish)
            Button("Stay Here", role: .cancel) {}
        } message: {
            Text("You can retry, wait for the uploads to finish, or submit only the items the box has received.")
        }
        .onChange(of: selectedPhotos) { _, items in
            guard items.isEmpty == false else {
                return
            }
            onAddPhotos(items)
            selectedPhotos = []
        }
        .onChange(of: state.captureFeedbackSequence) { oldSequence, newSequence in
            guard newSequence > oldSequence else { return }
            showCaptureFeedback()
        }
        .onDisappear {
            captureFlashTask?.cancel()
        }
    }

    private var topChrome: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Button(action: requestCancel) {
                    Image(systemName: "xmark")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(CaptureChromeButtonStyle())
                .accessibilityLabel("Cancel capture")

                VStack(alignment: .leading, spacing: 2) {
                    Text(state.destinationLabel)
                        .font(.headline)
                        .lineLimit(1)
                    Text(statusSummary)
                        .font(.footnote.monospacedDigit().weight(.medium))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                if state.isBusy {
                    ProgressView()
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(state.phase == .sealing ? "Finishing capture" : "Working")
                } else {
                    Button(action: finish) {
                        Image(systemName: "checkmark")
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(CaptureChromeButtonStyle(prominent: true))
                    .disabled(state.canFinish == false)
                    .accessibilityLabel("Finish capture")
                }
            }

            if state.phase == .sealing && state.counts.pending > 0 {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.up.circle")
                    Text(pendingUploadSummary)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Skip Them", action: onSkipPendingUploads)
                        .font(.footnote.bold())
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            if let banner = state.banner {
                HStack(spacing: 10) {
                    Image(systemName: state.canRetry ? "wifi.exclamationmark" : "exclamationmark.triangle.fill")
                    Text(banner)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if state.canRetry {
                        Button("Retry", action: onRetry)
                            .font(.footnote.bold())
                    }
                    if state.canOpenSettings {
                        Button("Settings", action: onOpenSettings)
                            .font(.footnote.bold())
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(Color.black.opacity(0.62))
    }

    private var bottomChrome: some View {
        VStack(spacing: 14) {
            HStack(spacing: 18) {
                PhotosPicker(selection: $selectedPhotos, maxSelectionCount: 50, matching: .images) {
                    Image(systemName: "photo.on.rectangle")
                        .frame(width: 50, height: 50)
                }
                .buttonStyle(CaptureChromeButtonStyle())
                .disabled(state.blocksAcquisition)
                .accessibilityLabel("Add photos")

                Button(action: { showingFileImporter = true }) {
                    Image(systemName: "folder")
                        .frame(width: 50, height: 50)
                }
                .buttonStyle(CaptureChromeButtonStyle())
                .disabled(state.blocksAcquisition)
                .accessibilityLabel("Add files")

                Spacer()

                Button(action: onFlipCamera) {
                    Image(systemName: "camera.rotate")
                        .frame(width: 50, height: 50)
                }
                .buttonStyle(CaptureChromeButtonStyle())
                .disabled(state.cameraAvailable == false || state.blocksAcquisition)
                .accessibilityLabel("Switch camera")
            }

            HStack(spacing: 34) {
                Button(action: onToggleRecording) {
                    Image(systemName: state.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(state.isRecording ? Color.white : Color.red)
                        .frame(width: 64, height: 64)
                        .background(state.isRecording ? Color.red : Color.white, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(state.blocksAcquisition)
                .accessibilityLabel(state.isRecording ? "Stop recording" : "Start recording")

                Button(action: onShutter) {
                    ZStack {
                        Circle().fill(.white).frame(width: 76, height: 76)
                        Circle().stroke(.black.opacity(0.7), lineWidth: 2).frame(width: 66, height: 66)
                    }
                }
                .buttonStyle(.plain)
                .disabled(state.cameraAvailable == false || state.blocksAcquisition)
                .accessibilityLabel("Take photo")

                Color.clear.frame(width: 64, height: 64)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .background(.ultraThinMaterial)
    }

    private func recoveryPanel(title: String, message: String) -> some View {
        VStack(spacing: 14) {
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Send Remaining Items as a Follow-up", action: onSendFollowUp)
                .buttonStyle(.borderedProminent)
            Button("Discard Remaining Items", role: .destructive, action: onDiscardRemaining)
        }
        .padding(20)
        .frame(maxWidth: 420)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(20)
    }

    private func failurePanel(message: String) -> some View {
        VStack(spacing: 14) {
            Text("Capture Unavailable").font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Close", action: onCancel)
                .buttonStyle(.borderedProminent)
        }
        .padding(20)
        .frame(maxWidth: 420)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(20)
    }

    private var statusSummary: String {
        var captureParts: [String] = []
        if state.counts.photos > 0 {
            captureParts.append(countLabel(state.counts.photos, singular: "photo", plural: "photos"))
        }
        if state.counts.audioSegments > 0 {
            captureParts.append("\(state.counts.audioSegments) audio")
        }
        if state.counts.files > 0 {
            captureParts.append(countLabel(state.counts.files, singular: "file", plural: "files"))
        }
        if state.isRecording {
            captureParts.append(Self.duration(state.elapsedSeconds))
        }

        var uploadParts: [String] = []
        if state.counts.uploading > 0 {
            uploadParts.append("\(state.counts.uploading) uploading")
        }
        if state.counts.uploaded > 0 {
            uploadParts.append("\(state.counts.uploaded) uploaded")
        }
        if state.counts.failed > 0 {
            uploadParts.append("\(state.counts.failed) failed")
        }

        let lines = [captureParts, uploadParts]
            .filter { $0.isEmpty == false }
            .map { $0.joined(separator: "  •  ") }
        return lines.isEmpty ? "Ready" : lines.joined(separator: "\n")
    }

    private func countLabel(_ count: Int, singular: String, plural: String) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    @ViewBuilder
    private var interruptionPanel: some View {
        switch state.phase {
        case .recovery(let title, let message):
            recoveryPanel(title: title, message: message)
        case .failed(let message):
            failurePanel(message: message)
        default:
            EmptyView()
        }
    }

    private var pendingUploadSummary: String {
        let pending = state.counts.pending
        return pending == 1 ? "Waiting for 1 upload." : "Waiting for \(pending) uploads."
    }

    private func requestCancel() {
        if state.counts.totalItems == 0 {
            onCancel()
        } else {
            showingCancelConfirmation = true
        }
    }

    private func finish() {
        // `needsFinishPrompt` covers items still staged locally, not just ones
        // actively uploading — otherwise Done slipped straight into a wait with
        // no way out.
        if state.counts.needsFinishPrompt {
            showingFinishChoices = true
        } else {
            onFinish()
        }
    }

    private func showCaptureFeedback() {
        captureFlashTask?.cancel()
        withAnimation(.linear(duration: 0.04)) {
            showingCaptureFlash = true
        }
        captureFlashTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard Task.isCancelled == false else { return }
            withAnimation(.easeOut(duration: 0.16)) {
                showingCaptureFlash = false
            }
        }
    }

    private static func duration(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

private struct CaptureChromeButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(prominent ? Color.black : Color.white)
            .background(prominent ? Color.white : Color.black.opacity(configuration.isPressed ? 0.72 : 0.5))
            .clipShape(Circle())
            .opacity(configuration.isPressed ? 0.82 : 1)
    }
}

#Preview("Capture") {
    NativeCaptureView(
        state: NativeCaptureSurfaceState(
            destinationLabel: "Family",
            phase: .recording,
            counts: NativeCaptureSurfaceCounts(photos: 3, files: 1, audioSegments: 1, uploading: 2, uploaded: 3),
            elapsedSeconds: 42
        ),
        preview: {
            LinearGradient(colors: [.gray, .black], startPoint: .top, endPoint: .bottom)
        },
        onCancel: {},
        onShutter: {},
        onFlipCamera: {},
        onToggleRecording: {},
        onAddPhotos: { _ in },
        onAddFiles: { _ in },
        onRetry: {},
        onOpenSettings: {},
        onFinish: {},
        onSubmitUploadedItems: {},
        onSkipPendingUploads: {},
        onSendFollowUp: {},
        onDiscardRemaining: {}
    )
}

#if DEBUG
struct NativeCaptureFixtureScreen: View {
    private let fixture = ProcessInfo.processInfo.arguments
        .first { $0.hasPrefix("--capture-fixture=") }?
        .replacingOccurrences(of: "--capture-fixture=", with: "") ?? "recording"
    @State private var captureFeedbackSequence = 0

    var body: some View {
        NativeCaptureView(
            state: state,
            preview: {
                ZStack {
                    Color(uiColor: .darkGray)
                    Image(systemName: "viewfinder")
                        .font(.system(size: 80, weight: .thin))
                        .foregroundStyle(.white.opacity(0.3))
                }
            },
            onCancel: {},
            onShutter: { captureFeedbackSequence += 1 },
            onFlipCamera: {},
            onToggleRecording: {},
            onAddPhotos: { _ in },
            onAddFiles: { _ in },
            onRetry: {},
            onOpenSettings: {},
            onFinish: {},
            onSubmitUploadedItems: {},
            onSkipPendingUploads: {},
            onSendFollowUp: {},
            onDiscardRemaining: {}
        )
    }

    private var state: NativeCaptureSurfaceState {
        var result: NativeCaptureSurfaceState
        switch fixture {
        case "failure":
            result = NativeCaptureSurfaceState(
                destinationLabel: "Family",
                phase: .active,
                counts: NativeCaptureSurfaceCounts(
                    photos: 5,
                    files: 2,
                    audioSegments: 2,
                    uploaded: 6,
                    failed: 3
                ),
                banner: "Three items could not upload.",
                canRetry: true
            )
        case "recovery":
            result = NativeCaptureSurfaceState(
                destinationLabel: "Family",
                phase: .recovery(
                    title: "Capture already submitted",
                    message: "This capture was submitted while the phone was away."
                ),
                counts: NativeCaptureSurfaceCounts(photos: 4, files: 1, uploaded: 3, failed: 2)
            )
        case "sealing":
            result = NativeCaptureSurfaceState(
                destinationLabel: "Family",
                phase: .sealing,
                counts: NativeCaptureSurfaceCounts(photos: 4, files: 1, audioSegments: 2, uploading: 2, uploaded: 5)
            )
        default:
            result = NativeCaptureSurfaceState(
                destinationLabel: "Family",
                phase: .recording,
                counts: NativeCaptureSurfaceCounts(photos: 3, files: 1, audioSegments: 1, uploading: 2, uploaded: 3),
                elapsedSeconds: 42
            )
        }
        result.captureFeedbackSequence = captureFeedbackSequence
        return result
    }
}
#endif
