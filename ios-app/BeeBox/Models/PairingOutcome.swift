import BeeBoxShared
import Foundation

/// What `PairedBoxStore.pair(from:)` did with a link.
enum PairingOutcome: Equatable {
    case paired
    /// Not a `beebox://pair` link with a usable base URL.
    case notAPairingLink
    /// This app is redeeming, or already redeemed, the same ticket: the link
    /// arrived twice.
    case duplicate
    case failed(PairingFailure)

    /// Text for the person holding the phone, or nil when there is nothing to say.
    var failureMessage: String? {
        switch self {
        case .paired, .duplicate:
            return nil
        case .notAPairingLink:
            return "That is not a Bee Box pairing link."
        case .failed(let failure):
            return failure.message
        }
    }
}

enum PairingFailure: Equatable {
    case redeem(PairingError)
    /// The box paired, but the device credential could not be saved here.
    case storeFailed

    var message: String {
        switch self {
        case .redeem(.rejected(status: 401, let serverMessage)):
            return (serverMessage ?? "This pairing link has expired or was already used.")
                + " Make a new one on the box and try again."
        case .redeem(.rejected(let status, let serverMessage)):
            return "The box refused pairing (HTTP \(status))." + (serverMessage.map { " \($0)" } ?? "")
        case .redeem(.transport):
            return "Could not reach the box. Check that it is running and that this phone can reach it."
        case .redeem(.malformedResponse):
            return "The box answered, but not with a pairing. It may be running an older version."
        case .storeFailed:
            return "The box paired, but this phone could not save the credential. Try again."
        }
    }
}

extension PairingError {
    /// A bounded, credential-free label for `BoxLog`.
    var logLabel: String {
        switch self {
        case .rejected(let status, _):
            return "rejected status=\(status)"
        case .transport(let code):
            return "transport code=\(code.rawValue)"
        case .malformedResponse:
            return "malformed-response"
        }
    }
}
