import AVFoundation
import Foundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum CaptureAcquisitionError: Error, Equatable, LocalizedError {
    case cameraPermissionDenied
    case cameraUnavailable
    case microphonePermissionDenied
    case photoDecodeFailed
    case photoEncodeFailed
    case recordingDidNotStart
    case importFailed(name: String, message: String)

    var errorDescription: String? {
        switch self {
        case .cameraPermissionDenied:
            "Camera access is disabled."
        case .cameraUnavailable:
            "No camera is available."
        case .microphonePermissionDenied:
            "Microphone access is disabled."
        case .photoDecodeFailed:
            "The selected image could not be decoded."
        case .photoEncodeFailed:
            "The selected image could not be converted to JPEG or PNG."
        case .recordingDidNotStart:
            "The audio recording could not be started."
        case .importFailed(let name, let message):
            "\(name): \(message)"
        }
    }
}

protocol CaptureAcquisitionSink {
    func importFile(at url: URL, item: CaptureItem) async throws
    func beginRecording(item: CaptureItem) async throws -> URL
    func closeRecording(itemID: UUID) async throws
    func failRecording(itemID: UUID, message: String) async
}

struct CaptureStoreAcquisitionSink: CaptureAcquisitionSink, Sendable {
    var store: CaptureStore
    var boxID: UUID
    var sessionID: CaptureSessionID
    var enqueue: @Sendable (UUID) async -> Void

    init(
        store: CaptureStore,
        boxID: UUID,
        sessionID: CaptureSessionID,
        enqueue: @escaping @Sendable (UUID) async -> Void
    ) {
        self.store = store
        self.boxID = boxID
        self.sessionID = sessionID
        self.enqueue = enqueue
    }

    func importFile(at url: URL, item: CaptureItem) async throws {
        try await store.importPayload(from: url, boxID: boxID, sessionID: sessionID, item: item)
        await enqueue(item.id)
    }

    func beginRecording(item: CaptureItem) async throws -> URL {
        try await store.beginItem(boxID: boxID, sessionID: sessionID, item: item)
    }

    func closeRecording(itemID: UUID) async throws {
        try await store.markRecordingClosed(boxID: boxID, sessionID: sessionID, itemID: itemID)
        await enqueue(itemID)
    }

    func failRecording(itemID: UUID, message: String) async {
        try? await store.transition(
            boxID: boxID,
            sessionID: sessionID,
            itemID: itemID,
            to: .failed(message: message)
        )
    }
}

struct CaptureNormalizedImage: Equatable {
    var data: Data
    var format: CapturePhotoFormat

    var mimeType: String { format.mimeType }
    var fileExtension: String { format.fileExtension }
}

enum CaptureImageNormalizer {
    static let jpegCompressionQuality = 0.85

    static func normalize(data: Data) throws -> CaptureNormalizedImage {
        guard let image = UIImage(data: data) else {
            throw CaptureAcquisitionError.photoDecodeFailed
        }
        return try normalize(image: image)
    }

    static func normalize(image: UIImage) throws -> CaptureNormalizedImage {
        let retainsAlpha = hasAlpha(image)
        let rendererFormat = UIGraphicsImageRendererFormat()
        rendererFormat.scale = image.scale
        rendererFormat.opaque = retainsAlpha == false
        let bounds = CGRect(origin: .zero, size: image.size)
        let upright = UIGraphicsImageRenderer(size: image.size, format: rendererFormat).image { _ in
            if retainsAlpha == false {
                UIColor.white.setFill()
                UIRectFill(bounds)
            }
            image.draw(in: bounds)
        }

        if retainsAlpha {
            guard let data = upright.pngData() else {
                throw CaptureAcquisitionError.photoEncodeFailed
            }
            return CaptureNormalizedImage(data: data, format: .png)
        }
        guard let data = upright.jpegData(compressionQuality: jpegCompressionQuality) else {
            throw CaptureAcquisitionError.photoEncodeFailed
        }
        return CaptureNormalizedImage(data: data, format: .jpeg)
    }

    private static func hasAlpha(_ image: UIImage) -> Bool {
        guard let alphaInfo = image.cgImage?.alphaInfo else {
            return true
        }
        switch alphaInfo {
        case .first, .last, .premultipliedFirst, .premultipliedLast:
            return true
        case .none, .noneSkipFirst, .noneSkipLast, .alphaOnly:
            return false
        @unknown default:
            return true
        }
    }
}

enum CaptureAcquisitionItemFactory {
    static func photo(
        id: UUID = UUID(),
        format: CapturePhotoFormat,
        source: String,
        capturedAt: Date = Date()
    ) -> CaptureItem {
        CaptureItem(
            id: id,
            filename: CaptureFilename.photo(id: id, format: format),
            kind: .photo,
            capturedAt: timestamp(capturedAt),
            source: source,
            mimeType: format.mimeType,
            originalName: nil,
            audioFormat: nil,
            segmentID: nil,
            segmentStartedAt: nil,
            state: .local,
            uploadGeneration: 0
        )
    }

    static func file(
        id: UUID = UUID(),
        originalName: String,
        mimeType: String,
        capturedAt: Date = Date()
    ) -> CaptureItem {
        CaptureItem(
            id: id,
            filename: CaptureFilename.file(id: id, originalName: originalName),
            kind: .file,
            capturedAt: timestamp(capturedAt),
            source: "files",
            mimeType: mimeType,
            originalName: originalName,
            audioFormat: nil,
            segmentID: nil,
            segmentStartedAt: nil,
            state: .local,
            uploadGeneration: 0
        )
    }

    static func audio(id: UUID = UUID(), startedAt: Date = Date()) -> CaptureItem {
        let timestamp = timestamp(startedAt)
        return CaptureItem(
            id: id,
            filename: CaptureFilename.audio(id: id),
            kind: .audio,
            capturedAt: timestamp,
            source: "microphone",
            mimeType: "audio/mp4",
            originalName: nil,
            audioFormat: .m4aAAC,
            segmentID: id.uuidString.lowercased(),
            segmentStartedAt: timestamp,
            state: .recording,
            uploadGeneration: 0
        )
    }

    private static func timestamp(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}

struct CaptureImportResult: Identifiable {
    var id: UUID
    var item: CaptureItem?
    var error: CaptureAcquisitionError?
}

@MainActor
enum CaptureGalleryImporter {
    static func importItems(
        _ selections: [PhotosPickerItem],
        into sink: any CaptureAcquisitionSink
    ) async -> [CaptureImportResult] {
        var results: [CaptureImportResult] = []
        for selection in selections {
            let resultID = UUID()
            do {
                guard let data = try await selection.loadTransferable(type: Data.self) else {
                    throw CaptureAcquisitionError.photoDecodeFailed
                }
                let normalized = try CaptureImageNormalizer.normalize(data: data)
                let item = CaptureAcquisitionItemFactory.photo(
                    id: resultID,
                    format: normalized.format,
                    source: "gallery"
                )
                try await importData(normalized.data, item: item, into: sink)
                results.append(CaptureImportResult(id: resultID, item: item, error: nil))
            } catch let error as CaptureAcquisitionError {
                results.append(CaptureImportResult(id: resultID, item: nil, error: error))
            } catch {
                results.append(CaptureImportResult(
                    id: resultID,
                    item: nil,
                    error: .importFailed(name: "Photo", message: error.localizedDescription)
                ))
            }
        }
        return results
    }

    static func importData(
        _ data: Data,
        source: String = "gallery",
        into sink: any CaptureAcquisitionSink
    ) async throws -> CaptureItem {
        let normalized = try CaptureImageNormalizer.normalize(data: data)
        let item = CaptureAcquisitionItemFactory.photo(format: normalized.format, source: source)
        try await importData(normalized.data, item: item, into: sink)
        return item
    }

    private static func importData(
        _ data: Data,
        item: CaptureItem,
        into sink: any CaptureAcquisitionSink
    ) async throws {
        let temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("capture-import-\(item.id.uuidString)")
            .appendingPathExtension((item.filename as NSString).pathExtension)
        defer { try? FileManager.default.removeItem(at: temporaryURL) }
        try data.write(to: temporaryURL, options: .atomic)
        try await sink.importFile(at: temporaryURL, item: item)
    }
}

enum CaptureFileImporter {
    static func importURLs(
        _ urls: [URL],
        into sink: any CaptureAcquisitionSink
    ) async -> [CaptureImportResult] {
        var results: [CaptureImportResult] = []
        for url in urls {
            let id = UUID()
            let name = url.lastPathComponent.isEmpty ? "attachment" : url.lastPathComponent
            let accessed = url.startAccessingSecurityScopedResource()
            defer {
                if accessed {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            do {
                let values = try? url.resourceValues(forKeys: [.contentTypeKey])
                let mimeType = values?.contentType?.preferredMIMEType ?? "application/octet-stream"
                let item = CaptureAcquisitionItemFactory.file(
                    id: id,
                    originalName: name,
                    mimeType: mimeType
                )
                // The sink must finish its app-container copy before returning, while scope is still held.
                try await sink.importFile(at: url, item: item)
                results.append(CaptureImportResult(id: id, item: item, error: nil))
            } catch {
                results.append(CaptureImportResult(
                    id: id,
                    item: nil,
                    error: .importFailed(name: name, message: error.localizedDescription)
                ))
            }
        }
        return results
    }
}

enum CaptureCameraPosition: Equatable {
    case user
    case environment

    var source: String {
        switch self {
        case .user: "camera-user"
        case .environment: "camera-environment"
        }
    }

    fileprivate var devicePosition: AVCaptureDevice.Position {
        switch self {
        case .user: .front
        case .environment: .back
        }
    }
}

final class CaptureCameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    var previewLayer: AVCaptureVideoPreviewLayer {
        guard let layer = layer as? AVCaptureVideoPreviewLayer else {
            preconditionFailure("Capture preview must use AVCaptureVideoPreviewLayer")
        }
        return layer
    }
}

struct CaptureCameraPreview: UIViewRepresentable {
    var session: AVCaptureSession

    func makeUIView(context: Context) -> CaptureCameraPreviewView {
        let view = CaptureCameraPreviewView()
        view.previewLayer.videoGravity = .resizeAspectFill
        view.previewLayer.session = session
        return view
    }

    func updateUIView(_ view: CaptureCameraPreviewView, context: Context) {
        if view.previewLayer.session !== session {
            view.previewLayer.session = session
        }
    }
}

private final class CapturePhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    var completion: (Result<Data, Error>) -> Void

    init(completion: @escaping (Result<Data, Error>) -> Void) {
        self.completion = completion
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            completion(.failure(error))
        } else if let data = photo.fileDataRepresentation() {
            completion(.success(data))
        } else {
            completion(.failure(CaptureAcquisitionError.photoEncodeFailed))
        }
    }
}

@MainActor
final class CaptureCamera: ObservableObject {
    @Published private(set) var position: CaptureCameraPosition = .environment
    @Published private(set) var isRunning = false
    @Published private(set) var errorMessage: String?

    private let pipeline = CaptureCameraPipeline()

    var session: AVCaptureSession { pipeline.session }

    func start() async throws {
        guard await requestCameraPermission() else {
            throw CaptureAcquisitionError.cameraPermissionDenied
        }
        try await pipeline.start(position: position)
        isRunning = true
        errorMessage = nil
    }

    func stop() async {
        await pipeline.stop()
        isRunning = false
    }

    func switchCamera() async throws {
        let next: CaptureCameraPosition = position == .environment ? .user : .environment
        try await pipeline.switchCamera(from: position, to: next)
        position = next
    }

    func capturePhoto(into sink: any CaptureAcquisitionSink) async throws -> CaptureItem {
        let source = position.source
        let data = try await pipeline.capturePhotoData()
        return try await CaptureGalleryImporter.importData(data, source: source, into: sink)
    }

    func handleSceneBackgrounding() {
        Task { await stop() }
    }

    private func requestCameraPermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}

private final class CaptureCameraPipeline: @unchecked Sendable {
    let session = AVCaptureSession()

    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "app.callbackbox.capture.camera")
    private var currentInput: AVCaptureDeviceInput?
    private var delegates: [Int64: CapturePhotoDelegate] = [:]

    func start(position: CaptureCameraPosition) async throws {
        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                do {
                    try configureIfNeeded(position: position)
                    if session.isRunning == false {
                        session.startRunning()
                    }
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func stop() async {
        await withCheckedContinuation { continuation in
            sessionQueue.async { [self] in
                if session.isRunning {
                    session.stopRunning()
                }
                continuation.resume()
            }
        }
    }

    func switchCamera(from current: CaptureCameraPosition, to next: CaptureCameraPosition) async throws {
        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                do {
                    try replaceInput(from: current, to: next)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func capturePhotoData() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                let settings: AVCapturePhotoSettings
                if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                    settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                } else {
                    settings = AVCapturePhotoSettings()
                }
                let identifier = settings.uniqueID
                let delegate = CapturePhotoDelegate { [weak self] result in
                    self?.sessionQueue.async {
                        self?.delegates.removeValue(forKey: identifier)
                        continuation.resume(with: result)
                    }
                }
                delegates[identifier] = delegate
                photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
        }
    }

    private func configureIfNeeded(position: CaptureCameraPosition) throws {
        guard currentInput == nil else { return }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        try addInput(position: position)
        guard session.canAddOutput(photoOutput) else {
            throw CaptureAcquisitionError.cameraUnavailable
        }
        session.addOutput(photoOutput)
    }

    private func replaceInput(from current: CaptureCameraPosition, to next: CaptureCameraPosition) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        if let currentInput {
            session.removeInput(currentInput)
            self.currentInput = nil
        }
        do {
            try addInput(position: next)
        } catch {
            try? addInput(position: current)
            throw error
        }
    }

    private func addInput(position: CaptureCameraPosition) throws {
        guard let device = AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: position.devicePosition
        ) else {
            throw CaptureAcquisitionError.cameraUnavailable
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw CaptureAcquisitionError.cameraUnavailable
        }
        session.addInput(input)
        currentInput = input
    }
}

enum CaptureAudioStopReason: Equatable {
    case user
    case interruption
    case background
    case sizeLimit
}

enum CaptureAudioLifecycleState: Equatable {
    case idle
    case preparing(UUID)
    case recording(UUID)
    case stopping(UUID, CaptureAudioStopReason)
    case failed(String)
}

struct CaptureAudioLifecycle: Equatable {
    private(set) var state: CaptureAudioLifecycleState = .idle

    mutating func begin(itemID: UUID) -> Bool {
        switch state {
        case .idle, .failed:
            state = .preparing(itemID)
            return true
        case .preparing, .recording, .stopping:
            return false
        }
    }

    mutating func didStart(itemID: UUID) -> Bool {
        guard state == .preparing(itemID) else { return false }
        state = .recording(itemID)
        return true
    }

    mutating func requestStop(_ reason: CaptureAudioStopReason) -> UUID? {
        guard case .recording(let itemID) = state else { return nil }
        state = .stopping(itemID, reason)
        return itemID
    }

    mutating func didClose(itemID: UUID) -> Bool {
        guard case .stopping(let activeID, _) = state, activeID == itemID else { return false }
        state = .idle
        return true
    }

    mutating func fail(_ message: String) {
        state = .failed(message)
    }
}

protocol CaptureAudioRecording: AnyObject {
    var isRecording: Bool { get }
    func record() -> Bool
    func stop()
}

extension AVAudioRecorder: CaptureAudioRecording {}

protocol CaptureAudioRecorderFactory {
    func makeRecorder(url: URL, settings: [String: Any]) throws -> any CaptureAudioRecording
}

struct AVAudioRecorderFactory: CaptureAudioRecorderFactory {
    func makeRecorder(url: URL, settings: [String: Any]) throws -> any CaptureAudioRecording {
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.prepareToRecord()
        return recorder
    }
}

protocol CaptureMicrophoneAuthorizing {
    func requestPermission() async -> Bool
}

struct SystemCaptureMicrophoneAuthorizer: CaptureMicrophoneAuthorizing {
    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

enum CaptureAudioEvent: Equatable {
    case recordingPersisted(CaptureItem)
    case closed(CaptureItem, CaptureAudioStopReason)
    case failed(UUID?, String)
}

@MainActor
final class CaptureAudioRecorder: ObservableObject {
    nonisolated static let softLimitBytes: Int64 = 48 * 1024 * 1024
    static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]

    @Published private(set) var lifecycle = CaptureAudioLifecycle()
    @Published private(set) var notice: String?

    var onEvent: ((CaptureAudioEvent) -> Void)?

    private let sink: any CaptureAcquisitionSink
    private let factory: any CaptureAudioRecorderFactory
    private let audioSession: any AudioSessionControlling
    private let authorizer: any CaptureMicrophoneAuthorizing
    private var recorder: (any CaptureAudioRecording)?
    private var currentItem: CaptureItem?
    private var currentURL: URL?
    private var sizeTimer: Timer?
    private var observers: [NSObjectProtocol] = []

    init(
        sink: any CaptureAcquisitionSink,
        factory: any CaptureAudioRecorderFactory = AVAudioRecorderFactory(),
        audioSession: any AudioSessionControlling = SystemAudioSession(),
        authorizer: any CaptureMicrophoneAuthorizing = SystemCaptureMicrophoneAuthorizer(),
        notificationCenter: NotificationCenter = .default
    ) {
        self.sink = sink
        self.factory = factory
        self.audioSession = audioSession
        self.authorizer = authorizer
        observers.append(notificationCenter.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: rawType) == .began
            else {
                return
            }
            Task { @MainActor in await self?.stop(reason: .interruption) }
        })
        observers.append(notificationCenter.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.stop(reason: .background) }
        })
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        sizeTimer?.invalidate()
        recorder?.stop()
        audioSession.deactivate()
    }

    var isRecording: Bool {
        if case .recording = lifecycle.state { return true }
        return false
    }

    func start() async {
        let item = CaptureAcquisitionItemFactory.audio()
        guard lifecycle.begin(itemID: item.id) else { return }
        notice = nil
        var persisted = false
        do {
            guard await authorizer.requestPermission() else {
                throw CaptureAcquisitionError.microphonePermissionDenied
            }
            let url = try await sink.beginRecording(item: item)
            persisted = true
            onEvent?(.recordingPersisted(item))
            try audioSession.activate(role: .recording)
            let recorder = try factory.makeRecorder(url: url, settings: Self.settings)
            guard recorder.record() else {
                throw CaptureAcquisitionError.recordingDidNotStart
            }
            self.recorder = recorder
            currentItem = item
            currentURL = url
            guard lifecycle.didStart(itemID: item.id) else {
                recorder.stop()
                throw CaptureAcquisitionError.recordingDidNotStart
            }
            startSizeTimer()
        } catch {
            recorder?.stop()
            recorder = nil
            currentItem = nil
            currentURL = nil
            audioSession.deactivate()
            let message = error.localizedDescription
            lifecycle.fail(message)
            notice = message
            if persisted {
                await sink.failRecording(itemID: item.id, message: message)
            }
            onEvent?(.failed(persisted ? item.id : nil, message))
        }
    }

    func stop(reason: CaptureAudioStopReason = .user) async {
        guard
            let itemID = lifecycle.requestStop(reason),
            let item = currentItem,
            item.id == itemID
        else {
            return
        }
        sizeTimer?.invalidate()
        sizeTimer = nil
        recorder?.stop()
        recorder = nil
        audioSession.deactivate()
        do {
            try await sink.closeRecording(itemID: itemID)
            _ = lifecycle.didClose(itemID: itemID)
            currentItem = nil
            currentURL = nil
            if reason == .sizeLimit {
                notice = "Recording stopped at the 48 MiB segment limit. Start again to continue."
            } else if reason == .interruption || reason == .background {
                notice = "Recording paused. Start again to continue in a new segment."
            }
            onEvent?(.closed(item, reason))
        } catch {
            let message = error.localizedDescription
            lifecycle.fail(message)
            notice = message
            await sink.failRecording(itemID: itemID, message: message)
            onEvent?(.failed(itemID, message))
        }
    }

    func handleInterruptionBegan() async {
        await stop(reason: .interruption)
    }

    func handleSceneBackgrounding() async {
        await stop(reason: .background)
    }

    nonisolated static func shouldSoftStop(byteCount: Int64) -> Bool {
        byteCount >= softLimitBytes
    }

    private func startSizeTimer() {
        sizeTimer?.invalidate()
        sizeTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let url = self.currentURL else { return }
                let values = try? url.resourceValues(forKeys: [.fileSizeKey])
                let byteCount = Int64(values?.fileSize ?? 0)
                if Self.shouldSoftStop(byteCount: byteCount) {
                    await self.stop(reason: .sizeLimit)
                }
            }
        }
    }
}
