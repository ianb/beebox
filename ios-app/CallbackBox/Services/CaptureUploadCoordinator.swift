import Foundation

enum CaptureUploadEvent: Equatable, Sendable {
    case uploaded(CaptureUploadCandidate)
    case retryScheduled(CaptureUploadCandidate, afterSeconds: Int)
    case failed(CaptureUploadCandidate, message: String)
    case recovery(CaptureRecovery)
}

final class CaptureBackgroundEvents: @unchecked Sendable {
    static let shared = CaptureBackgroundEvents()

    private let lock = NSLock()
    private var completionHandlers: [String: () -> Void] = [:]

    func accept(identifier: String, completionHandler: @escaping () -> Void) {
        lock.withLock {
            completionHandlers[identifier] = completionHandler
        }
    }

    func finish(identifier: String) {
        let completionHandler = lock.withLock {
            completionHandlers.removeValue(forKey: identifier)
        }
        completionHandler?()
    }
}

final class CaptureUploadCoordinator: NSObject, @unchecked Sendable {
    typealias BoxProvider = (UUID) -> PairedBox?
    typealias EventHandler = @Sendable (CaptureUploadEvent) -> Void
    typealias Sleep = @Sendable (UInt64) async throws -> Void

    private let boxProvider: BoxProvider
    private let store: CaptureStore
    private let eventHandler: EventHandler
    private let sleep: Sleep
    private let eventBroker: CaptureBackgroundEvents
    private let responseLock = NSLock()
    private var responseData: [Int: Data] = [:]
    private var urlSession: URLSession!
    private var scopedBoxID: UUID?

    init(
        boxProvider: @escaping BoxProvider,
        store: CaptureStore,
        configuration: URLSessionConfiguration? = nil,
        eventBroker: CaptureBackgroundEvents = .shared,
        sleep: @escaping Sleep = { nanoseconds in try await Task.sleep(nanoseconds: nanoseconds) },
        eventHandler: @escaping EventHandler = { _ in }
    ) {
        self.boxProvider = boxProvider
        self.store = store
        self.eventBroker = eventBroker
        self.sleep = sleep
        self.eventHandler = eventHandler
        super.init()
        urlSession = URLSession(
            configuration: configuration ?? CaptureBackgroundSession.configuration(),
            delegate: self,
            delegateQueue: nil
        )
    }

    convenience init(
        box: PairedBox,
        store: CaptureStore,
        configuration: URLSessionConfiguration? = nil,
        eventBroker: CaptureBackgroundEvents = .shared,
        sleep: @escaping Sleep = { nanoseconds in try await Task.sleep(nanoseconds: nanoseconds) },
        eventHandler: @escaping EventHandler = { _ in }
    ) {
        self.init(
            boxProvider: { boxID in boxID == box.id ? box : nil },
            store: store,
            configuration: configuration,
            eventBroker: eventBroker,
            sleep: sleep,
            eventHandler: eventHandler
        )
        scopedBoxID = box.id
    }

    deinit {
        urlSession?.finishTasksAndInvalidate()
    }

    func start() async throws {
        let tasks = await urlSession.allTasks
        let liveTasks = tasks.compactMap { task -> CaptureBackgroundTask? in
            guard let metadata = CaptureBackgroundTaskMetadata(taskDescription: task.taskDescription) else {
                return nil
            }
            return CaptureBackgroundTask(taskIdentifier: task.taskIdentifier, metadata: metadata)
        }
        let candidates = try await store.reconcileBackgroundTasks(liveTasks)
        for candidate in candidates {
            do {
                try await schedule(candidate)
            } catch {
                eventHandler(.failed(candidate, message: error.localizedDescription))
            }
        }
    }

    func schedule(_ candidate: CaptureUploadCandidate) async throws {
        guard let box = boxProvider(candidate.boxID) else {
            throw CaptureFailure.invalidManifest("The paired box for this upload is unavailable.")
        }
        let payload = try await store.uploadPayload(for: candidate)
        let request = CaptureAPI(box: box).uploadRequest(sessionID: candidate.sessionID, item: payload.item)
        let task = urlSession.uploadTask(with: request, fromFile: payload.fileURL)
        do {
            let metadata = try await store.markUploading(
                boxID: candidate.boxID,
                sessionID: candidate.sessionID,
                itemID: candidate.itemID,
                taskIdentifier: task.taskIdentifier
            )
            task.taskDescription = metadata.taskDescription
            task.resume()
        } catch {
            task.cancel()
            throw error
        }
    }

    func cancel(boxID: UUID, sessionID: CaptureSessionID) async {
        let tasks = await urlSession.allTasks
        for task in tasks {
            guard
                let metadata = CaptureBackgroundTaskMetadata(taskDescription: task.taskDescription),
                metadata.boxID == boxID,
                metadata.sessionID == sessionID
            else {
                continue
            }
            task.cancel()
            try? await store.cancelUpload(metadata: metadata, taskIdentifier: task.taskIdentifier)
        }
    }

    func cancel(sessionID: CaptureSessionID) async {
        guard let scopedBoxID else {
            return
        }
        await cancel(boxID: scopedBoxID, sessionID: sessionID)
    }

    func handleCompletion(
        taskIdentifier: Int,
        metadata: CaptureBackgroundTaskMetadata,
        response: HTTPURLResponse?,
        data: Data,
        error: Error?
    ) async {
        let candidate = CaptureUploadCandidate(
            boxID: metadata.boxID,
            sessionID: metadata.sessionID,
            itemID: metadata.itemID
        )
        let outcome: CaptureRequestOutcome<Bool>
        if let error {
            outcome = .retryable(CaptureRetry(message: error.localizedDescription, retryAfter: nil))
        } else if let response {
            outcome = CaptureAPI.classifyUploadResponse(response, data: data)
        } else {
            outcome = .retryable(CaptureRetry(message: "The upload returned no HTTP response.", retryAfter: nil))
        }

        switch outcome {
        case .success:
            guard (try? await store.acknowledgeUpload(
                metadata: metadata,
                taskIdentifier: taskIdentifier
            )) == true else {
                return
            }
            eventHandler(.uploaded(candidate))
        case .retryable(let retry):
            await handleFailure(
                candidate: candidate,
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: .retryable(message: retry.message)
            )
        case .rejected(let rejection):
            await handleFailure(
                candidate: candidate,
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: .terminal(message: rejection.message)
            )
            switch rejection {
            case .sessionGone:
                eventHandler(.recovery(.sessionGone(metadata.sessionID)))
            case .alreadySealed:
                eventHandler(.recovery(.alreadySealed(metadata.sessionID)))
            default:
                break
            }
        }
    }

    private func handleFailure(
        candidate: CaptureUploadCandidate,
        metadata: CaptureBackgroundTaskMetadata,
        taskIdentifier: Int,
        failure: CaptureUploadFailure
    ) async {
        guard let resolution = try? await store.recordUploadFailure(
            metadata: metadata,
            taskIdentifier: taskIdentifier,
            failure: failure
        ) else {
            return
        }
        switch resolution {
        case .retry(let seconds):
            eventHandler(.retryScheduled(candidate, afterSeconds: seconds))
            do {
                try await sleep(UInt64(seconds) * 1_000_000_000)
                try await schedule(candidate)
            } catch is CancellationError {
                return
            } catch {
                eventHandler(.failed(candidate, message: error.localizedDescription))
            }
        case .failed:
            let message: String
            switch failure {
            case .retryable(let value), .terminal(let value):
                message = value
            }
            eventHandler(.failed(candidate, message: message))
        case .ignoredStaleCompletion:
            break
        }
    }
}

extension CaptureUploadCoordinator: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseLock.withLock {
            responseData[dataTask.taskIdentifier, default: Data()].append(data)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let metadata = CaptureBackgroundTaskMetadata(taskDescription: task.taskDescription) else {
            return
        }
        let data = responseLock.withLock {
            responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
        }
        Task {
            await handleCompletion(
                taskIdentifier: task.taskIdentifier,
                metadata: metadata,
                response: task.response as? HTTPURLResponse,
                data: data,
                error: error
            )
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        eventBroker.finish(identifier: CaptureBackgroundSession.identifier)
    }
}
