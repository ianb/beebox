import Combine
import CryptoKit
import Foundation
import UserNotifications

/// The APNs host this build's device token belongs to (contract §5.9). A token
/// sent to the other host is refused as `BadDeviceToken` and the box then
/// drops the registration, so the box cannot guess this: the app reports it.
enum PushEnvironment: String, Codable, Equatable, Sendable {
    case sandbox
    case production

    /// The `#if DEBUG` guess, used only when a provisioning profile is present
    /// but cannot be read.
    static func forBuild(isDebug: Bool) -> PushEnvironment {
        isDebug ? .sandbox : .production
    }

    /// `Entitlements` → `aps-environment` from an `embedded.mobileprovision`.
    /// The profile is a CMS (PKCS #7) envelope whose signed content is an XML
    /// plist stored as plain bytes, so the plist is cut out between `<?xml`
    /// and `</plist>` and parsed; the signature is not checked (the system
    /// already did when it installed the app). Nil when the plist is missing,
    /// unparseable, or has no recognized `aps-environment`.
    static func fromProvisioningProfile(_ profile: Data) -> PushEnvironment? {
        guard
            let start = profile.range(of: Data("<?xml".utf8)),
            let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex)
        else {
            return nil
        }
        let plistData = profile.subdata(in: start.lowerBound..<end.upperBound)
        guard
            let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any],
            let aps = entitlements["aps-environment"] as? String
        else {
            return nil
        }
        switch aps {
        case "development": return .sandbox
        case "production": return .production
        default: return nil
        }
    }

    /// Decide the environment from what the running app was signed with.
    ///
    /// - `isSimulator`: simulator tokens are sandbox tokens, and a simulator
    ///   build carries no profile.
    /// - `profile` nil (no `embedded.mobileprovision`): an App Store or
    ///   TestFlight install, which Apple re-signs for `production`.
    /// - A readable profile: its `aps-environment` (`development` → sandbox).
    /// - An unreadable profile: the `#if DEBUG` guess.
    static func resolve(isSimulator: Bool, profile: Data?, isDebug: Bool) -> PushEnvironmentResolution {
        if isSimulator {
            return PushEnvironmentResolution(environment: .sandbox, source: .simulator)
        }
        guard let profile else {
            return PushEnvironmentResolution(environment: .production, source: .noProfile)
        }
        if let environment = fromProvisioningProfile(profile) {
            return PushEnvironmentResolution(environment: environment, source: .profile)
        }
        return PushEnvironmentResolution(environment: forBuild(isDebug: isDebug), source: .buildFallback)
    }

    /// This install's environment, read once.
    static let current: PushEnvironmentResolution = {
        #if targetEnvironment(simulator)
        let isSimulator = true
        #else
        let isSimulator = false
        #endif
        #if DEBUG
        let isDebug = true
        #else
        let isDebug = false
        #endif
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").map {
            // A profile that exists but cannot be read is unparseable, not absent.
            (try? Data(contentsOf: $0)) ?? Data()
        }
        return resolve(isSimulator: isSimulator, profile: profile, isDebug: isDebug)
    }()
}

/// Which environment a build reports, and what decided it (logged with the
/// token so a wrong-host registration can be traced from the client log).
struct PushEnvironmentResolution: Equatable, Sendable {
    enum Source: String, Sendable {
        case simulator
        case profile
        case noProfile = "no-profile"
        case buildFallback = "build-fallback"
    }

    var environment: PushEnvironment
    var source: Source
}

enum PushToken {
    /// The APNs device token as lowercase hex, the form the box stores.
    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// The notification permission as the system reports it, collapsed to what the
/// shell shows and what gates registration.
enum NotificationPermission: Equatable, Sendable {
    /// Not read yet this launch.
    case unknown
    case notDetermined
    case denied
    /// `.authorized`, `.provisional`, or `.ephemeral`.
    case allowed

    init(_ status: UNAuthorizationStatus) {
        switch status {
        case .notDetermined:
            self = .notDetermined
        case .denied:
            self = .denied
        case .authorized, .provisional, .ephemeral:
            self = .allowed
        @unknown default:
            self = .denied
        }
    }

    var name: String {
        switch self {
        case .unknown: "unknown"
        case .notDetermined: "notDetermined"
        case .denied: "denied"
        case .allowed: "allowed"
        }
    }
}

/// `POST /api/pairing/push-token` body (contract §5.9).
struct PushTokenRequest: Codable, Equatable {
    var token: String
    var environment: PushEnvironment

    static func urlRequest(box: PairedBox, token: String, environment: PushEnvironment) throws -> URLRequest {
        var request = URLRequest(url: box.apiURL.appendingPathComponent("pairing/push-token"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        BoxRequest.apply(to: &request, box: box)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        request.httpBody = try encoder.encode(PushTokenRequest(token: token, environment: environment))
        return request
    }
}

/// Which registration each paired box last accepted, so a launch with an
/// unchanged token does not post again.
///
/// A record is a hash of (APNs token, environment, device credential), never
/// the token itself: re-pairing a box mints a new device record server-side
/// that has no registration, and the credential in the hash makes that a
/// change. A record older than `refreshInterval` counts as stale, because the
/// box drops a registration APNs rejects (§5.9) and relies on a later post to
/// restore it; the refresh bounds how long a phone can stay unregistered
/// without knowing.
struct PushRegistrationLedger {
    static let storageKey = "app.beebox.ios.pushRegistrations.v1"
    static let refreshInterval: TimeInterval = 24 * 60 * 60

    struct Record: Codable, Equatable {
        var fingerprint: String
        var postedAt: Date
    }

    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    static func fingerprint(token: String, environment: PushEnvironment, credential: String) -> String {
        let digest = SHA256.hash(data: Data("\(environment.rawValue)\n\(token)\n\(credential)".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    func needsPost(boxID: UUID, fingerprint: String, now: Date = Date()) -> Bool {
        guard let record = records()[boxID.uuidString] else {
            return true
        }
        return record.fingerprint != fingerprint
            || now.timeIntervalSince(record.postedAt) >= Self.refreshInterval
            || now < record.postedAt
    }

    func record(boxID: UUID, fingerprint: String, now: Date = Date()) {
        var all = records()
        all[boxID.uuidString] = Record(fingerprint: fingerprint, postedAt: now)
        write(all)
    }

    /// Drop records for boxes no longer paired.
    func retain(boxIDs: Set<UUID>) {
        let keep = Set(boxIDs.map(\.uuidString))
        let all = records()
        let kept = all.filter { keep.contains($0.key) }
        if kept.count != all.count {
            write(kept)
        }
    }

    private func records() -> [String: Record] {
        guard let data = defaults.data(forKey: Self.storageKey) else {
            return [:]
        }
        return (try? JSONDecoder().decode([String: Record].self, from: data)) ?? [:]
    }

    private func write(_ records: [String: Record]) {
        guard let data = try? JSONEncoder().encode(records) else {
            return
        }
        defaults.set(data, forKey: Self.storageKey)
    }
}

protocol PushTokenTransport: Sendable {
    /// Send the request and return the HTTP status.
    func send(_ request: URLRequest) async throws -> Int
}

struct URLSessionPushTokenTransport: PushTokenTransport {
    func send(_ request: URLRequest) async throws -> Int {
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return http.statusCode
    }
}

protocol NotificationAuthorizing: Sendable {
    func currentPermission() async -> NotificationPermission
    func requestAuthorization() async throws -> Bool
}

struct SystemNotificationAuthorizer: NotificationAuthorizing {
    func currentPermission() async -> NotificationPermission {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return NotificationPermission(settings.authorizationStatus)
    }

    func requestAuthorization() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
    }
}

/// Registers this phone's APNs token with every paired box (contract §5.9).
///
/// The app delegate owns the token callback and SwiftUI owns the
/// `PairedBoxStore`, so `BeeBoxApp` hands the store to this singleton at launch.
/// Both a new token and a pairing change reach the same `syncRegistrations()`.
/// Nothing is posted until notifications are allowed: a registration for a
/// phone that cannot show a notification would list it in Admin as reachable.
@MainActor
final class PushRegistrar: ObservableObject {
    static let shared = PushRegistrar()

    @Published private(set) var permission: NotificationPermission = .unknown

    private(set) var token: String?
    private var boxes: [PairedBox] = []
    private var boxesCancellable: AnyCancellable?
    private var inflight: Set<UUID> = []
    /// Last logged failure per box, so a box that stays unreachable logs one
    /// line per transition rather than one per launch-time retry.
    private var lastFailure: [UUID: String] = [:]

    private let ledger: PushRegistrationLedger
    private let transport: any PushTokenTransport
    private let authorizer: any NotificationAuthorizing
    let environment: PushEnvironment
    private let environmentSource: PushEnvironmentResolution.Source

    init(
        ledger: PushRegistrationLedger = PushRegistrationLedger(),
        transport: any PushTokenTransport = URLSessionPushTokenTransport(),
        authorizer: any NotificationAuthorizing = SystemNotificationAuthorizer(),
        environment: PushEnvironmentResolution = PushEnvironment.current
    ) {
        self.ledger = ledger
        self.transport = transport
        self.authorizer = authorizer
        self.environment = environment.environment
        environmentSource = environment.source
    }

    func attach(store: PairedBoxStore) {
        guard boxesCancellable == nil else {
            return
        }
        boxesCancellable = store.$boxes.sink { [weak self] boxes in
            Task { @MainActor in
                await self?.boxesDidChange(boxes)
            }
        }
    }

    func tokenDidChange(_ hex: String) async {
        let changed = token != hex
        token = hex
        if changed {
            BoxLog.info("apns token received env=\(environment.rawValue) source=\(environmentSource.rawValue)", category: .push)
        }
        await syncRegistrations()
    }

    /// Paired boxes changed. The first pairing is where permission is asked;
    /// a launch with a paired box and an undecided permission asks too.
    func boxesDidChange(_ boxes: [PairedBox]) async {
        self.boxes = boxes
        ledger.retain(boxIDs: Set(boxes.map(\.id)))
        await refreshPermission(requestIfUndetermined: boxes.isEmpty == false)
        await syncRegistrations()
    }

    /// The user may have changed the permission in Settings while away.
    func sceneDidBecomeActive() async {
        await refreshPermission(requestIfUndetermined: false)
        await syncRegistrations()
    }

    func refreshPermission(requestIfUndetermined: Bool) async {
        var current = await authorizer.currentPermission()
        if current == .notDetermined, requestIfUndetermined {
            do {
                _ = try await authorizer.requestAuthorization()
            } catch {
                BoxLog.warn("notification permission request failed: \(error.localizedDescription)", category: .push)
            }
            current = await authorizer.currentPermission()
        }
        if current != permission {
            BoxLog.info("notification permission=\(current.name)", category: .push)
            permission = current
        }
    }

    func syncRegistrations() async {
        guard let token, permission == .allowed else {
            return
        }
        for box in boxes {
            guard
                let credential = box.authToken?.trimmingCharacters(in: .whitespacesAndNewlines),
                credential.isEmpty == false,
                inflight.contains(box.id) == false
            else {
                continue
            }
            let fingerprint = PushRegistrationLedger.fingerprint(
                token: token,
                environment: environment,
                credential: credential
            )
            guard ledger.needsPost(boxID: box.id, fingerprint: fingerprint) else {
                continue
            }
            inflight.insert(box.id)
            defer { inflight.remove(box.id) }
            await post(token: token, fingerprint: fingerprint, box: box)
        }
    }

    private func post(token: String, fingerprint: String, box: PairedBox) async {
        let outcome: String
        do {
            let request = try PushTokenRequest.urlRequest(box: box, token: token, environment: environment)
            let status = try await transport.send(request)
            if (200..<300).contains(status) {
                ledger.record(boxID: box.id, fingerprint: fingerprint)
                lastFailure[box.id] = nil
                BoxLog.info("push token registered env=\(environment.rawValue)", category: .push, targetBoxID: box.id)
                return
            }
            outcome = "status=\(status)"
        } catch let error as URLError {
            outcome = "urlError=\(error.code.rawValue) (\(error.localizedDescription))"
        } catch {
            outcome = "error=\(error.localizedDescription)"
        }
        guard lastFailure[box.id] != outcome else {
            return
        }
        lastFailure[box.id] = outcome
        BoxLog.warn("push token registration failed \(outcome)", category: .push, targetBoxID: box.id)
    }
}
