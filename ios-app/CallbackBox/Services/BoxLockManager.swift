import Combine
import Foundation
import LocalAuthentication

enum DeviceAuthenticationResult: Equatable {
    case authenticated
    case cancelled
    case passcodeNotSet
    case failed
}

@MainActor
protocol DeviceAuthenticating: AnyObject {
    func authenticate(reason: String) async -> DeviceAuthenticationResult
    func cancel()
}

@MainActor
final class LocalDeviceAuthenticator: DeviceAuthenticating {
    private var context: LAContext?

    func authenticate(reason: String) async -> DeviceAuthenticationResult {
        cancel()
        let context = LAContext()
        self.context = context

        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            self.context = nil
            return Self.result(for: policyError)
        }

        do {
            let authenticated = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )
            guard self.context === context else {
                return .cancelled
            }
            self.context = nil
            return authenticated ? .authenticated : .failed
        } catch {
            guard self.context === context else {
                return .cancelled
            }
            self.context = nil
            return Self.result(for: error)
        }
    }

    func cancel() {
        context?.invalidate()
        context = nil
    }

    static func result(for error: Error?) -> DeviceAuthenticationResult {
        guard let error else {
            return .failed
        }
        let nsError = error as NSError
        guard nsError.domain == LAError.errorDomain, let code = LAError.Code(rawValue: nsError.code) else {
            return .failed
        }
        switch code {
        case .userCancel, .appCancel, .systemCancel:
            return .cancelled
        case .passcodeNotSet:
            return .passcodeNotSet
        default:
            return .failed
        }
    }
}

enum BoxLockStatus: Equatable {
    case locked
    case authenticating
    case failed
    case passcodeNotSet
}

@MainActor
final class BoxLockManager: ObservableObject {
    @Published private(set) var unlockedBoxID: PairedBox.ID?
    @Published private(set) var status: BoxLockStatus = .locked

    private let authenticator: DeviceAuthenticating
    private var authenticationTask: Task<Void, Never>?
    private var generation = 0

    init(authenticator: DeviceAuthenticating) {
        self.authenticator = authenticator
    }

    convenience init() {
        self.init(authenticator: LocalDeviceAuthenticator())
    }

    func isLocked(_ box: PairedBox) -> Bool {
        box.requiresDeviceUnlock && unlockedBoxID != box.id
    }

    func unlock(_ box: PairedBox) {
        guard box.requiresDeviceUnlock else {
            return
        }
        beginNewAttempt()
        let attemptGeneration = generation
        status = .authenticating
        authenticationTask = Task { [weak self] in
            guard let self else {
                return
            }
            let result = await authenticator.authenticate(reason: "Unlock this box.")
            apply(result, boxID: box.id, generation: attemptGeneration)
        }
    }

    func cancelAuthentication() {
        relock()
    }

    func relock() {
        beginNewAttempt()
        unlockedBoxID = nil
        status = .locked
    }

    func openWithoutPasscode(_ box: PairedBox) {
        guard box.requiresDeviceUnlock, status == .passcodeNotSet else {
            return
        }
        unlockedBoxID = box.id
        status = .locked
    }

    func authenticateForLockRemoval() async -> DeviceAuthenticationResult {
        beginNewAttempt()
        let attemptGeneration = generation
        let result = await authenticator.authenticate(reason: "Turn off the lock for this box.")
        guard generation == attemptGeneration else {
            return .cancelled
        }
        return result
    }

    private func beginNewAttempt() {
        generation += 1
        authenticationTask?.cancel()
        authenticationTask = nil
        authenticator.cancel()
    }

    private func apply(
        _ result: DeviceAuthenticationResult,
        boxID: PairedBox.ID,
        generation attemptGeneration: Int
    ) {
        guard generation == attemptGeneration else {
            return
        }
        authenticationTask = nil
        switch result {
        case .authenticated:
            unlockedBoxID = boxID
            status = .locked
        case .cancelled:
            unlockedBoxID = nil
            status = .locked
        case .passcodeNotSet:
            unlockedBoxID = nil
            status = .passcodeNotSet
        case .failed:
            unlockedBoxID = nil
            status = .failed
        }
    }
}
