import UIKit

@MainActor
protocol BackgroundTaskApplication: AnyObject {
    var applicationState: UIApplication.State { get }
    func beginBackgroundTask(
        withName taskName: String?,
        expirationHandler handler: (@Sendable () -> Void)?
    ) -> UIBackgroundTaskIdentifier
    func endBackgroundTask(_ identifier: UIBackgroundTaskIdentifier)
}

extension UIApplication: BackgroundTaskApplication {}

/// A single best-effort UIKit execution assertion.
///
/// The hold owns the identifier until an explicit end, expiration, or
/// deallocation. It does not decide whether the caller's work should be
/// cancelled; expiration policy stays with the operation that owns the hold.
@MainActor
final class BackgroundExecutionHold {
    private let application: any BackgroundTaskApplication
    private var identifier = UIBackgroundTaskIdentifier.invalid
    private var expirationHandler: (() -> Void)?

    private(set) var wasAcquired = false
    private(set) var expired = false

    init(application: any BackgroundTaskApplication) {
        self.application = application
    }

    convenience init() {
        self.init(application: UIApplication.shared)
    }

    @discardableResult
    func begin(name: String, onExpiration: (() -> Void)? = nil) -> Bool {
        guard identifier == .invalid else {
            return wasAcquired
        }
        expirationHandler = onExpiration
        let acquired = application.beginBackgroundTask(withName: name) { [weak self] in
            MainActor.assumeIsolated {
                self?.expire()
            }
        }
        guard acquired != .invalid else {
            expirationHandler = nil
            return false
        }
        identifier = acquired
        wasAcquired = true
        return true
    }

    func end() {
        expirationHandler = nil
        guard identifier != .invalid else {
            return
        }
        let ending = identifier
        identifier = .invalid
        application.endBackgroundTask(ending)
    }

    private func expire() {
        expired = true
        let handler = expirationHandler
        end()
        handler?()
    }

    deinit {
        let ending = identifier
        guard ending != .invalid else {
            return
        }
        let application = application
        MainActor.assumeIsolated {
            application.endBackgroundTask(ending)
        }
    }
}
