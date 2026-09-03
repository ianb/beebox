import Foundation
import SwiftUI
import UIKit
import WebKit

struct NativeChatEmission: Equatable, Identifiable {
    typealias Origin = NativeEmissionV2.Origin

    var id = UUID()
    var text: String
    var origin: Origin
    var diarized: Bool
    var hqText: Bool? = nil
    var hqService: String? = nil
    var images: [ChatImageAttachment]
    var files: [NativeEmissionFile] = []
    var selections: [NativeEmissionSelection] = []
}

struct NativeEmissionReceipt: Equatable {
    enum Disposition: String {
        case sent
        case queued
        case rejected
    }

    var emissionID: NativeChatEmission.ID
    var disposition: Disposition
    var reason: String?
}

struct NativeLocationShareRequest: Equatable, Identifiable {
    var id = UUID()
}

struct NativeLocationShareResult: Equatable {
    var requestID: NativeLocationShareRequest.ID
    var success: Bool
    var enabled: Bool?
    var message: String
}

/// A request to abandon the in-flight delivery attempt for these emissions so
/// the next `deliver` pass hands them to the page again. Identified so the
/// coordinator acts once per request instead of on every SwiftUI update.
struct NativeEmissionRedeliveryRequest: Equatable, Identifiable {
    var id = UUID()
    var emissionIDs: Set<NativeChatEmission.ID>
}

/// One press of the record button asking the page to stop speaking (contract
/// §4.9). Identified so the coordinator sends it once per press rather than on
/// every SwiftUI update.
struct NativeSpeechStopRequest: Equatable, Identifiable {
    var id = UUID()
}

struct NativeScreenshotRequest: Equatable, Identifiable {
    var id = UUID()
}

/// One press of the shell's back control. The webview's own
/// `allowsBackForwardNavigationGestures` swipe is invisible and competes with
/// horizontal gestures inside the page, so it cannot be the only way out of a
/// card or the browse view — see
/// `issues/bugs/2026-08-23-no-consistent-way-back-to-chat.md`. Identified so a
/// SwiftUI update that re-sends the same request does not walk the history
/// twice.
struct NativeBackRequest: Equatable, Identifiable {
    var id = UUID()
}

struct NativeScreenshotResult: Equatable {
    var requestID: NativeScreenshotRequest.ID
    var data: Data?
    var message: String?
}

enum NativeComposerCommandDelivery {
    case command(NativeComposerCommand)
    case rejection(NativeComposerCommandAcknowledgement)
}

struct ChatWebView: UIViewRepresentable {
    enum NewWindowDestination: Equatable {
        case currentContext
        case browser
    }

    var box: PairedBox
    var pendingEmissions: [NativeChatEmission]
    var emissionRedeliveryRequest: NativeEmissionRedeliveryRequest?
    var locationShareRequest: NativeLocationShareRequest?
    var screenshotRequest: NativeScreenshotRequest?
    var speechStopRequest: NativeSpeechStopRequest?
    var backRequest: NativeBackRequest?
    var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement]
    var composerCommandResults: [NativeComposerCommandResult]
    var onSessionChange: (String?) -> Void
    var onEmissionDeliveryAttempt: (NativeChatEmission.ID) -> Void
    var onEmissionReceipt: (NativeEmissionReceipt) -> Void
    var onLocationShareResult: (NativeLocationShareResult) -> Void
    var onLocationSharingStateChange: (Bool) -> Void
    var onNarrationStateChange: (Bool) -> Void
    var onHqDictationStateChange: (Bool) -> Void
    var onSpeechPlaybackStateChange: (Bool) -> Void
    var onResponseStateChange: (Bool) -> Void
    var onScreenshotResult: (NativeScreenshotResult) -> Void
    var onComposerCommand: (NativeComposerCommandDelivery) -> Void
    var onComposerCommandAcknowledgementDelivered: (String) -> Void
    var onComposerCommandResultDelivered: (String) -> Void
    var onLastAudioRequest: (NativeLastAudioRequest) -> Void
    var onSpeechStopRequestSettled: (NativeSpeechStopRequest.ID) -> Void
    var onCanGoBackChange: (Bool) -> Void

    init(
        box: PairedBox,
        pendingEmissions: [NativeChatEmission] = [],
        emissionRedeliveryRequest: NativeEmissionRedeliveryRequest? = nil,
        locationShareRequest: NativeLocationShareRequest? = nil,
        screenshotRequest: NativeScreenshotRequest? = nil,
        speechStopRequest: NativeSpeechStopRequest? = nil,
        backRequest: NativeBackRequest? = nil,
        composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = [],
        composerCommandResults: [NativeComposerCommandResult] = [],
        onSessionChange: @escaping (String?) -> Void = { _ in },
        onEmissionDeliveryAttempt: @escaping (NativeChatEmission.ID) -> Void = { _ in },
        onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void = { _ in },
        onLocationShareResult: @escaping (NativeLocationShareResult) -> Void = { _ in },
        onLocationSharingStateChange: @escaping (Bool) -> Void = { _ in },
        onNarrationStateChange: @escaping (Bool) -> Void = { _ in },
        onHqDictationStateChange: @escaping (Bool) -> Void = { _ in },
        onSpeechPlaybackStateChange: @escaping (Bool) -> Void = { _ in },
        onResponseStateChange: @escaping (Bool) -> Void = { _ in },
        onScreenshotResult: @escaping (NativeScreenshotResult) -> Void = { _ in },
        onComposerCommand: @escaping (NativeComposerCommandDelivery) -> Void = { _ in },
        onComposerCommandAcknowledgementDelivered: @escaping (String) -> Void = { _ in },
        onComposerCommandResultDelivered: @escaping (String) -> Void = { _ in },
        onLastAudioRequest: @escaping (NativeLastAudioRequest) -> Void = { _ in },
        onSpeechStopRequestSettled: @escaping (NativeSpeechStopRequest.ID) -> Void = { _ in },
        onCanGoBackChange: @escaping (Bool) -> Void = { _ in }
    ) {
        self.box = box
        self.pendingEmissions = pendingEmissions
        self.emissionRedeliveryRequest = emissionRedeliveryRequest
        self.locationShareRequest = locationShareRequest
        self.screenshotRequest = screenshotRequest
        self.speechStopRequest = speechStopRequest
        self.composerCommandAcknowledgements = composerCommandAcknowledgements
        self.composerCommandResults = composerCommandResults
        self.onSessionChange = onSessionChange
        self.onEmissionDeliveryAttempt = onEmissionDeliveryAttempt
        self.onEmissionReceipt = onEmissionReceipt
        self.onLocationShareResult = onLocationShareResult
        self.onLocationSharingStateChange = onLocationSharingStateChange
        self.onNarrationStateChange = onNarrationStateChange
        self.onHqDictationStateChange = onHqDictationStateChange
        self.onSpeechPlaybackStateChange = onSpeechPlaybackStateChange
        self.onResponseStateChange = onResponseStateChange
        self.onScreenshotResult = onScreenshotResult
        self.onComposerCommand = onComposerCommand
        self.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
        self.onComposerCommandResultDelivered = onComposerCommandResultDelivered
        self.onLastAudioRequest = onLastAudioRequest
        self.onSpeechStopRequestSettled = onSpeechStopRequestSettled
        self.backRequest = backRequest
        self.onCanGoBackChange = onCanGoBackChange
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = Self.makeConfiguration()
        configuration.userContentController.add(context.coordinator, name: "beeboxSession")
        configuration.userContentController.add(context.coordinator, name: "beeboxEmissionReceipt")
        configuration.userContentController.add(context.coordinator, name: "beeboxLocationResult")
        configuration.userContentController.add(context.coordinator, name: "beeboxLocationState")
        configuration.userContentController.add(context.coordinator, name: "beeboxNarrationState")
        configuration.userContentController.add(context.coordinator, name: "beeboxHqDictationState")
        configuration.userContentController.add(context.coordinator, name: "beeboxSpeechPlaybackState")
        configuration.userContentController.add(context.coordinator, name: "beeboxResponseState")
        configuration.userContentController.add(context.coordinator, name: "beeboxComposerCommand")
        configuration.userContentController.add(context.coordinator, name: "beeboxLastAudioRequest")
        if let script = startupScript() {
            configuration.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.observeCanGoBack(webView)
        webView.load(request())
        return webView
    }

    static func makeConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        return configuration
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onSessionChange = onSessionChange
        context.coordinator.onEmissionDeliveryAttempt = onEmissionDeliveryAttempt
        context.coordinator.onEmissionReceipt = onEmissionReceipt
        context.coordinator.onLocationShareResult = onLocationShareResult
        context.coordinator.onLocationSharingStateChange = onLocationSharingStateChange
        context.coordinator.onNarrationStateChange = onNarrationStateChange
        context.coordinator.onHqDictationStateChange = onHqDictationStateChange
        context.coordinator.onSpeechPlaybackStateChange = onSpeechPlaybackStateChange
        context.coordinator.onResponseStateChange = onResponseStateChange
        context.coordinator.onScreenshotResult = onScreenshotResult
        context.coordinator.onComposerCommand = onComposerCommand
        context.coordinator.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
        context.coordinator.onComposerCommandResultDelivered = onComposerCommandResultDelivered
        context.coordinator.onLastAudioRequest = onLastAudioRequest
        context.coordinator.onSpeechStopRequestSettled = onSpeechStopRequestSettled
        context.coordinator.boxID = box.id
        context.coordinator.allowedOrigin = Self.origin(from: box.baseURL)
        context.coordinator.pendingEmissions = pendingEmissions
        context.coordinator.emissionRedeliveryRequest = emissionRedeliveryRequest
        context.coordinator.locationShareRequest = locationShareRequest
        context.coordinator.screenshotRequest = screenshotRequest
        context.coordinator.speechStopRequest = speechStopRequest
        context.coordinator.backRequest = backRequest
        context.coordinator.composerCommandAcknowledgements = composerCommandAcknowledgements
        context.coordinator.composerCommandResults = composerCommandResults
        if webView.url == nil {
            webView.load(request())
        }
        context.coordinator.abandonRequestedInflightEmissions()
        context.coordinator.deliver(pendingEmissions, to: webView)
        context.coordinator.deliverLocationRequest(to: webView)
        context.coordinator.captureScreenshot(from: webView)
        context.coordinator.deliverComposerCommandAcknowledgements(to: webView)
        context.coordinator.deliverComposerCommandResults(to: webView)
        context.coordinator.deliverSpeechStopRequest(to: webView)
        context.coordinator.goBackIfRequested(webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            boxID: box.id,
            allowedOrigin: Self.origin(from: box.baseURL),
            onSessionChange: onSessionChange,
            onEmissionDeliveryAttempt: onEmissionDeliveryAttempt,
            onEmissionReceipt: onEmissionReceipt,
            onLocationShareResult: onLocationShareResult,
            onLocationSharingStateChange: onLocationSharingStateChange,
            onNarrationStateChange: onNarrationStateChange,
            onHqDictationStateChange: onHqDictationStateChange,
            onSpeechPlaybackStateChange: onSpeechPlaybackStateChange,
            onResponseStateChange: onResponseStateChange,
            onScreenshotResult: onScreenshotResult,
            onComposerCommand: onComposerCommand,
            onComposerCommandAcknowledgementDelivered: onComposerCommandAcknowledgementDelivered,
            onComposerCommandResultDelivered: onComposerCommandResultDelivered,
            onLastAudioRequest: onLastAudioRequest,
            onSpeechStopRequestSettled: onSpeechStopRequestSettled,
            onCanGoBackChange: onCanGoBackChange
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
        var boxID: PairedBox.ID
        var allowedOrigin: String?
        var onSessionChange: (String?) -> Void
        var onEmissionDeliveryAttempt: (NativeChatEmission.ID) -> Void
        var onEmissionReceipt: (NativeEmissionReceipt) -> Void
        var onLocationShareResult: (NativeLocationShareResult) -> Void
        var onLocationSharingStateChange: (Bool) -> Void
        var onNarrationStateChange: (Bool) -> Void
        var onHqDictationStateChange: (Bool) -> Void
        var onSpeechPlaybackStateChange: (Bool) -> Void
        var onResponseStateChange: (Bool) -> Void
        var onScreenshotResult: (NativeScreenshotResult) -> Void
        var onComposerCommand: (NativeComposerCommandDelivery) -> Void
        var onComposerCommandAcknowledgementDelivered: (String) -> Void
        var onComposerCommandResultDelivered: (String) -> Void
        var onLastAudioRequest: (NativeLastAudioRequest) -> Void
        var onSpeechStopRequestSettled: (NativeSpeechStopRequest.ID) -> Void
        var onCanGoBackChange: (Bool) -> Void
        var pendingEmissions: [NativeChatEmission] = []
        var emissionRedeliveryRequest: NativeEmissionRedeliveryRequest?
        var locationShareRequest: NativeLocationShareRequest?
        var screenshotRequest: NativeScreenshotRequest?
        var speechStopRequest: NativeSpeechStopRequest?
        var backRequest: NativeBackRequest?
        var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = []
        var composerCommandResults: [NativeComposerCommandResult] = []
        /// The delivery attempt currently in flight for each emission ID, keyed
        /// by ID and valued by the attempt's generation. Redelivery abandons an
        /// attempt and starts a new one under the SAME emission ID, so an ID
        /// alone cannot tell the abandoned attempt's late callback apart from
        /// the live one — see `deliver`.
        private var inflightEmissionGenerations: [NativeChatEmission.ID: Int] = [:]
        /// Monotonic across every emission; only equality against the stored
        /// generation is ever asked, so one counter is enough.
        private var lastEmissionGeneration = 0
        private var handledRedeliveryRequestID: NativeEmissionRedeliveryRequest.ID?
        private var inflightLocationRequestID: NativeLocationShareRequest.ID?
        private var locationRequestTimeout: DispatchWorkItem?
        private var inflightScreenshotRequestID: NativeScreenshotRequest.ID?
        private var inflightSpeechStopRequestID: NativeSpeechStopRequest.ID?
        private var handledBackRequestID: NativeBackRequest.ID?
        /// KVO rather than the navigation delegate: the web client routes
        /// client-side, and a `pushState` grows the back-forward list without
        /// firing `didFinish`. Held so it can be torn down with the coordinator.
        private var canGoBackObservation: NSKeyValueObservation?
        private var inflightComposerCommandAcknowledgementIDs = Set<String>()
        private var inflightComposerCommandResultIDs = Set<String>()
        private var pageLoaded: Bool
        /// One log line per transition into navigation failure; cleared by the
        /// next successful load.
        private var navigationFailureLogged = false
        /// Start is latched through offline retries and cleared only by a
        /// successful load, matching the failure latch below.
        private var navigationStartLogged = false
        private let evaluateEmission: ((String, @escaping (Error?) -> Void) -> Void)?
        private let openExternalURL: (URL) -> Void
        private let loadInCurrentContext: (WKWebView, URLRequest) -> Void

        init(
            boxID: PairedBox.ID,
            allowedOrigin: String?,
            onSessionChange: @escaping (String?) -> Void,
            onEmissionDeliveryAttempt: @escaping (NativeChatEmission.ID) -> Void,
            onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void,
            onLocationShareResult: @escaping (NativeLocationShareResult) -> Void,
            onLocationSharingStateChange: @escaping (Bool) -> Void,
            onNarrationStateChange: @escaping (Bool) -> Void,
            onHqDictationStateChange: @escaping (Bool) -> Void = { _ in },
            onSpeechPlaybackStateChange: @escaping (Bool) -> Void,
            onResponseStateChange: @escaping (Bool) -> Void,
            onScreenshotResult: @escaping (NativeScreenshotResult) -> Void,
            onComposerCommand: @escaping (NativeComposerCommandDelivery) -> Void,
            onComposerCommandAcknowledgementDelivered: @escaping (String) -> Void,
            onComposerCommandResultDelivered: @escaping (String) -> Void = { _ in },
            onLastAudioRequest: @escaping (NativeLastAudioRequest) -> Void = { _ in },
            onSpeechStopRequestSettled: @escaping (NativeSpeechStopRequest.ID) -> Void = { _ in },
            onCanGoBackChange: @escaping (Bool) -> Void = { _ in },
            pageLoaded: Bool = false,
            evaluateEmission: ((String, @escaping (Error?) -> Void) -> Void)? = nil,
            openExternalURL: @escaping (URL) -> Void = { UIApplication.shared.open($0) },
            loadInCurrentContext: @escaping (WKWebView, URLRequest) -> Void = { webView, request in
                webView.load(request)
            }
        ) {
            self.boxID = boxID
            self.allowedOrigin = allowedOrigin
            self.onSessionChange = onSessionChange
            self.onEmissionDeliveryAttempt = onEmissionDeliveryAttempt
            self.onEmissionReceipt = onEmissionReceipt
            self.onLocationShareResult = onLocationShareResult
            self.onLocationSharingStateChange = onLocationSharingStateChange
            self.onNarrationStateChange = onNarrationStateChange
            self.onHqDictationStateChange = onHqDictationStateChange
            self.onSpeechPlaybackStateChange = onSpeechPlaybackStateChange
            self.onResponseStateChange = onResponseStateChange
            self.onScreenshotResult = onScreenshotResult
            self.onComposerCommand = onComposerCommand
            self.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
            self.onComposerCommandResultDelivered = onComposerCommandResultDelivered
            self.onLastAudioRequest = onLastAudioRequest
            self.onSpeechStopRequestSettled = onSpeechStopRequestSettled
            self.onCanGoBackChange = onCanGoBackChange
            self.pageLoaded = pageLoaded
            self.evaluateEmission = evaluateEmission
            self.openExternalURL = openExternalURL
            self.loadInCurrentContext = loadInCurrentContext
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageLoaded = true
            navigationFailureLogged = false
            navigationStartLogged = false
            BoxLog.info("chat navigation finished", category: .webview, targetBoxID: boxID)
            onSessionChange(ChatWebView.visibleSessionID(from: webView.url))
            deliver(pendingEmissions, to: webView)
            deliverLocationRequest(to: webView)
            captureScreenshot(from: webView)
            deliverComposerCommandAcknowledgements(to: webView)
            deliverComposerCommandResults(to: webView)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            pageLoaded = false
            if navigationStartLogged == false {
                navigationStartLogged = true
                BoxLog.info("chat navigation started", category: .webview, targetBoxID: boxID)
            }
            inflightLocationRequestID = nil
            locationRequestTimeout?.cancel()
            locationRequestTimeout = nil
            inflightScreenshotRequestID = nil
            // A barge-in is aimed at the utterance a specific document is
            // playing. The replacement document is not playing it, so the
            // request is abandoned rather than re-armed — stopping speech the
            // new page just started is worse than the press already being
            // honoured natively (the microphone opened on the press).
            inflightSpeechStopRequestID = nil
            if let request = speechStopRequest {
                speechStopRequest = nil
                onSpeechStopRequestSettled(request.id)
            }
            inflightComposerCommandAcknowledgementIDs.removeAll()
            inflightComposerCommandResultIDs.removeAll()
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            // The old document can still deliver a real receipt while a
            // provisional navigation is pending. Only clear its inflight IDs
            // once the replacement document commits; didFinish then redelivers
            // the same persisted IDs into the new page.
            inflightEmissionGenerations.removeAll()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            noteNavigationFailure("provisional", error: error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            noteNavigationFailure("committed", error: error)
        }

        /// The chat page reloads on its own while offline, so this logs the
        /// TRANSITION into failure, not every retry — a reconnecting phone must
        /// not fill the box's debug log with the same line.
        private func noteNavigationFailure(_ stage: String, error: Error) {
            guard navigationFailureLogged == false else {
                return
            }
            navigationFailureLogged = true
            BoxLog.warn(
                "chat navigation failed stage=\(stage)"
                    + " urlError=\((error as? URLError)?.code.rawValue ?? -1): \(error.localizedDescription)",
                category: .webview
            )
        }

        /// The web content process died — the transcript, its session state, and
        /// every pending native emission went with it. Nothing else in the app
        /// can see this.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            BoxLog.error(
                "web content process terminated pendingEmissions=\(pendingEmissions.count)"
                    + " inflight=\(inflightEmissionGenerations.count)",
                category: .webview
            )
            pageLoaded = false
            inflightEmissionGenerations.removeAll()
            webView.reload()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.targetFrame == nil {
                decisionHandler(.allow)
                return
            }
            guard navigationAction.targetFrame?.isMainFrame != false, let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if ChatWebView.origin(from: url) == allowedOrigin || url.scheme == "about" {
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
            openExternalURL(url)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else {
                return nil
            }
            handleNewWindowRequest(navigationAction.request, url: url, in: webView)
            return nil
        }

        func handleNewWindowRequest(_ request: URLRequest, url: URL, in webView: WKWebView) {
            switch ChatWebView.newWindowDestination(for: url, allowedOrigin: allowedOrigin) {
            case .currentContext:
                loadInCurrentContext(webView, request)
            case .browser:
                openExternalURL(url)
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "beeboxEmissionReceipt" {
                receiveEmissionReceipt(message.body)
                return
            }
            if message.name == "beeboxLocationResult" {
                receiveLocationResult(message.body)
                return
            }
            if message.name == "beeboxLocationState" {
                receiveLocationState(message.body)
                return
            }
            if message.name == "beeboxNarrationState" {
                receiveNarrationState(message.body)
                return
            }
            if message.name == "beeboxHqDictationState" {
                receiveHqDictationState(message.body)
                return
            }
            if message.name == "beeboxSpeechPlaybackState" {
                receiveSpeechPlaybackState(message.body)
                return
            }
            if message.name == "beeboxResponseState" {
                receiveResponseState(message.body)
                return
            }
            if message.name == "beeboxComposerCommand" {
                receiveComposerCommand(message.body)
                return
            }
            if message.name == "beeboxLastAudioRequest" {
                receiveLastAudioRequest(message.body)
                return
            }
            guard message.name == "beeboxSession", let urlString = message.body as? String, let url = URL(string: urlString) else {
                return
            }
            guard ChatWebView.origin(from: url) == allowedOrigin else {
                return
            }
            onSessionChange(ChatWebView.visibleSessionID(from: url))
        }

        /// Drop the in-flight attempt for the requested emissions so the next
        /// `deliver` pass hands them to the page again. A receipt that arrives
        /// late from the abandoned attempt is dropped by the inflight guard in
        /// `receiveEmissionReceipt`; the fresh attempt re-asks the box, whose
        /// claim registry answers the repeated emission ID idempotently. A late
        /// evaluate FAILURE from the abandoned attempt is dropped by the
        /// generation guard in `deliver`.
        func abandonRequestedInflightEmissions() {
            guard
                let request = emissionRedeliveryRequest,
                request.id != handledRedeliveryRequestID
            else {
                return
            }
            handledRedeliveryRequestID = request.id
            for emissionID in request.emissionIDs {
                inflightEmissionGenerations.removeValue(forKey: emissionID)
            }
        }

        func deliver(_ emissions: [NativeChatEmission], to webView: WKWebView) {
            guard pageLoaded else {
                return
            }
            for emission in emissions where inflightEmissionGenerations[emission.id] == nil {
                guard let detail = Self.javascriptDetail(for: emission) else {
                    continue
                }
                onEmissionDeliveryAttempt(emission.id)
                lastEmissionGeneration += 1
                let generation = lastEmissionGeneration
                inflightEmissionGenerations[emission.id] = generation
                let script = "window.beeboxNativeReceive(\(detail));"
                evaluate(script, in: webView) { [weak self] error in
                    guard error != nil else {
                        return
                    }
                    guard let self else {
                        return
                    }
                    // This failure is a fact about THIS evaluate call, not about
                    // the emission: it says the script never reached the page.
                    // Redelivery (or a navigation) can have abandoned this
                    // attempt and started another under the same ID, and that
                    // one may already be sending or sent — rejecting it here
                    // would show the user a failure that did not happen.
                    guard self.inflightEmissionGenerations[emission.id] == generation else {
                        BoxLog.info(
                            "abandoned emission delivery error ignored generation=\(generation)"
                                + " current=\(self.inflightEmissionGenerations[emission.id].map(String.init) ?? "none")",
                            category: .webview,
                            targetBoxID: self.boxID
                        )
                        return
                    }
                    self.finishInflightEmission(emission.id)
                    self.onEmissionReceipt(NativeEmissionReceipt(
                        emissionID: emission.id,
                        disposition: .rejected,
                        reason: "The chat page could not receive the message."
                    ))
                }
            }
        }

        /// Receipts are matched by emission ID only, deliberately — they carry
        /// no generation and do not need one. A receipt is the box's answer
        /// about the EMISSION (its claim registry answers a repeated ID
        /// idempotently), so whichever attempt provoked it, it settles the
        /// emission truthfully. The two orderings both come out right: a late
        /// receipt from an abandoned attempt that lands before the next
        /// delivery finds no inflight entry and is dropped, and the box answers
        /// the fresh attempt again; one that lands after settles the current
        /// attempt, which is the same emission and the same answer.
        func receiveEmissionReceipt(_ body: Any) {
            guard
                let payload = ChatWebView.dictionaryPayload(from: body),
                let idString = payload["emissionId"] as? String,
                let emissionID = UUID(uuidString: idString),
                let dispositionString = payload["disposition"] as? String,
                let disposition = NativeEmissionReceipt.Disposition(rawValue: dispositionString),
                inflightEmissionGenerations[emissionID] != nil
            else {
                return
            }
            finishInflightEmission(emissionID)
            onEmissionReceipt(NativeEmissionReceipt(
                emissionID: emissionID,
                disposition: disposition,
                reason: payload["reason"] as? String
            ))
        }

        private func evaluate(
            _ script: String,
            in webView: WKWebView,
            completion: @escaping (Error?) -> Void
        ) {
            if let evaluateEmission {
                evaluateEmission(script, completion)
                return
            }
            webView.evaluateJavaScript(script) { _, error in
                completion(error)
            }
        }

        private func finishInflightEmission(_ emissionID: NativeChatEmission.ID) {
            inflightEmissionGenerations.removeValue(forKey: emissionID)
        }

        func deliverLocationRequest(to webView: WKWebView) {
            guard
                pageLoaded,
                let request = locationShareRequest,
                request.id != inflightLocationRequestID
            else {
                return
            }
            inflightLocationRequestID = request.id
            startLocationRequestTimeout(for: request.id)
            let script = "window.beeboxNativeShareLocation(\"\(request.id.uuidString)\", \"toggle\");"
            webView.evaluateJavaScript(script) { [weak self] _, error in
                guard error != nil else {
                    return
                }
                self?.inflightLocationRequestID = nil
                self?.locationRequestTimeout?.cancel()
                self?.locationRequestTimeout = nil
                self?.onLocationShareResult(NativeLocationShareResult(
                    requestID: request.id,
                    success: false,
                    enabled: nil,
                    message: "The chat page could not request location."
                ))
            }
        }

        private func receiveLocationResult(_ body: Any) {
            guard
                let payload = ChatWebView.dictionaryPayload(from: body),
                let idString = payload["id"] as? String,
                let requestID = UUID(uuidString: idString),
                requestID == inflightLocationRequestID,
                let success = payload["success"] as? Bool,
                let enabled = payload["enabled"] as? Bool,
                let message = payload["message"] as? String
            else {
                return
            }
            inflightLocationRequestID = nil
            locationRequestTimeout?.cancel()
            locationRequestTimeout = nil
            onLocationShareResult(NativeLocationShareResult(
                requestID: requestID,
                success: success,
                enabled: enabled,
                message: message
            ))
        }

        private func receiveLocationState(_ body: Any) {
            guard let enabled = ChatWebView.locationSharingEnabled(from: body) else {
                return
            }
            onLocationSharingStateChange(enabled)
        }

        private func receiveNarrationState(_ body: Any) {
            guard let enabled = ChatWebView.narrationEnabled(from: body) else {
                return
            }
            onNarrationStateChange(enabled)
        }

        private func receiveHqDictationState(_ body: Any) {
            guard let enabled = ChatWebView.hqDictationEnabled(from: body) else {
                return
            }
            onHqDictationStateChange(enabled)
        }

        private func receiveSpeechPlaybackState(_ body: Any) {
            guard let playing = ChatWebView.speechPlaybackActive(from: body) else {
                return
            }
            onSpeechPlaybackStateChange(playing)
        }

        private func receiveResponseState(_ body: Any) {
            guard let active = ChatWebView.responseActive(from: body) else {
                return
            }
            onResponseStateChange(active)
        }

        private func startLocationRequestTimeout(for requestID: NativeLocationShareRequest.ID) {
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.inflightLocationRequestID == requestID else {
                    return
                }
                self.inflightLocationRequestID = nil
                self.locationRequestTimeout = nil
                self.onLocationShareResult(NativeLocationShareResult(
                    requestID: requestID,
                    success: false,
                    enabled: nil,
                    message: "Location sharing timed out."
                ))
            }
            locationRequestTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
        }

        private func receiveComposerCommand(_ body: Any) {
            guard let payload = ChatWebView.dictionaryPayload(from: body) else {
                return
            }
            let commandID = payload["id"] as? String
            guard
                let data = try? JSONSerialization.data(withJSONObject: payload),
                let command = try? JSONDecoder().decode(NativeComposerCommand.self, from: data)
            else {
                if let commandID, commandID.isEmpty == false {
                    onComposerCommand(.rejection(.rejected(
                        id: commandID,
                        reason: "The native composer command was malformed."
                    )))
                }
                return
            }
            onComposerCommand(.command(command))
        }

        /// A box agent asked for one voice message's original recording
        /// (contract §4.8). There is no acknowledgement channel: the shell
        /// answers the box directly over HTTP, and a malformed request is
        /// dropped, because without a usable `requestId` there is nowhere to
        /// report the problem to.
        private func receiveLastAudioRequest(_ body: Any) {
            guard
                let payload = ChatWebView.dictionaryPayload(from: body),
                let data = try? JSONSerialization.data(withJSONObject: payload),
                let request = try? JSONDecoder().decode(NativeLastAudioRequest.self, from: data)
            else {
                BoxLog.warn("last-audio request was malformed", category: .webview, targetBoxID: boxID)
                return
            }
            onLastAudioRequest(request)
        }

        func deliverComposerCommandAcknowledgements(to webView: WKWebView) {
            guard pageLoaded else {
                return
            }
            for acknowledgement in composerCommandAcknowledgements
            where inflightComposerCommandAcknowledgementIDs.contains(acknowledgement.id) == false {
                guard let detail = Self.javascriptDetail(for: acknowledgement) else {
                    continue
                }
                inflightComposerCommandAcknowledgementIDs.insert(acknowledgement.id)
                let script = "window.beeboxNativeComposerCommandAck(\(detail));"
                webView.evaluateJavaScript(script) { [weak self] _, error in
                    guard let self else {
                        return
                    }
                    self.inflightComposerCommandAcknowledgementIDs.remove(acknowledgement.id)
                    if error == nil {
                        self.onComposerCommandAcknowledgementDelivered(acknowledgement.id)
                    }
                }
            }
        }

        /// Post the answers to V2 commands into the page.
        ///
        /// Mirrors the acknowledgement delivery beside it — same inflight set,
        /// same "clear on delivery" handshake — because it is the same problem:
        /// `evaluateJavaScript` can be called before the page is ready, twice, or
        /// against a page that has navigated away. The web side's queue is
        /// authoritative and the event is only a wake signal, so a result that
        /// lands before the scan subscribed is still read.
        func deliverComposerCommandResults(to webView: WKWebView) {
            guard pageLoaded else {
                return
            }
            for result in composerCommandResults
            where inflightComposerCommandResultIDs.contains(result.id) == false {
                guard let detail = Self.javascriptDetail(for: result) else {
                    continue
                }
                inflightComposerCommandResultIDs.insert(result.id)
                let script = "window.beeboxNativeCommandResult(\(detail));"
                webView.evaluateJavaScript(script) { [weak self] _, error in
                    guard let self else {
                        return
                    }
                    self.inflightComposerCommandResultIDs.remove(result.id)
                    if error == nil {
                        self.onComposerCommandResultDelivered(result.id)
                    }
                }
            }
        }

        /// Tell the page to stop speaking. Unacknowledged by design (contract
        /// §4.9): the microphone is already open, and the speech-playback state
        /// the page posts anyway reports whether the speech actually stopped.
        /// Settled either way — a delivered request and an abandoned one both
        /// clear, so a press can never queue behind a page load and fire into
        /// whatever the next document is saying.
        func deliverSpeechStopRequest(to webView: WKWebView) {
            guard let request = speechStopRequest, request.id != inflightSpeechStopRequestID else {
                return
            }
            guard pageLoaded else {
                // No document to speak, so nothing to stop. Settled now rather
                // than parked: a request that waited for a load would fire into
                // whatever the freshly-loaded page says next.
                speechStopRequest = nil
                onSpeechStopRequestSettled(request.id)
                return
            }
            guard let detail = Self.javascriptDetail(for: NativeSpeechCommand.stop) else {
                return
            }
            inflightSpeechStopRequestID = request.id
            let script = "window.beeboxNativeSpeechCommand(\(detail));"
            webView.evaluateJavaScript(script) { [weak self] _, error in
                guard let self else {
                    return
                }
                if let error {
                    // Nothing is retried: the turn is already listening, and a
                    // page that cannot be reached will not be reachable a
                    // moment later either. Say so in the log and move on.
                    BoxLog.warn(
                        "speech stop was not delivered: \(error.localizedDescription)",
                        category: .webview,
                        targetBoxID: self.boxID
                    )
                }
                self.onSpeechStopRequestSettled(request.id)
            }
        }

        /// Report whether there is anywhere to go back to, so the shell can show
        /// its back control only when it would do something. Fires on the
        /// initial value too: a webview restored mid-history must not wait for
        /// the next navigation before the control appears.
        func observeCanGoBack(_ webView: WKWebView) {
            canGoBackObservation = webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] observed, _ in
                // The property read happens inside the hop, not before it: KVO
                // makes no thread promise, and `canGoBack` is a WebKit property
                // that must be read on the main thread. (`change.newValue` is
                // not a substitute — it is nil for the `.initial` callback.)
                DispatchQueue.main.async {
                    self?.onCanGoBackChange(observed.canGoBack)
                }
            }
        }

        /// Walk one entry back, once per press. A request that arrives when
        /// there is nowhere to go is dropped rather than queued — the control
        /// is hidden in that state, so this is the race where the last entry
        /// was consumed between render and tap.
        func goBackIfRequested(_ webView: WKWebView) {
            guard let request = backRequest, request.id != handledBackRequestID else {
                return
            }
            handledBackRequestID = request.id
            guard webView.canGoBack else {
                return
            }
            webView.goBack()
        }

        func captureScreenshot(from webView: WKWebView) {
            guard
                pageLoaded,
                let request = screenshotRequest,
                request.id != inflightScreenshotRequestID
            else {
                return
            }
            inflightScreenshotRequestID = request.id
            webView.takeSnapshot(with: nil) { [weak self] image, error in
                guard let self, self.inflightScreenshotRequestID == request.id else {
                    return
                }
                let data = image?.pngData()
                self.onScreenshotResult(NativeScreenshotResult(
                    requestID: request.id,
                    data: data,
                    message: data == nil ? error?.localizedDescription ?? "The visible chat could not be captured." : nil
                ))
            }
        }

        private static func javascriptDetail(for emission: NativeChatEmission) -> String? {
            let payload = NativeEmissionV2(emission: emission)
            guard let data = try? JSONEncoder().encode(payload) else {
                return nil
            }
            return String(data: data, encoding: .utf8)
        }

        private static func javascriptDetail(for command: NativeSpeechCommand) -> String? {
            guard let data = try? JSONEncoder().encode(command) else {
                return nil
            }
            return String(data: data, encoding: .utf8)
        }

        private static func javascriptDetail(for acknowledgement: NativeComposerCommandAcknowledgement) -> String? {
            guard let data = try? JSONEncoder().encode(acknowledgement) else {
                return nil
            }
            return String(data: data, encoding: .utf8)
        }

        private static func javascriptDetail(for result: NativeComposerCommandResult) -> String? {
            guard let data = try? JSONEncoder().encode(result) else {
                return nil
            }
            return String(data: data, encoding: .utf8)
        }
    }

    static func visibleSessionID(from url: URL?) -> String? {
        guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let value = components.queryItems?.first { $0.name == "session" }?.value
        return value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    static func origin(from url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host else {
            return nil
        }
        if let port = url.port {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }

    static func newWindowDestination(for url: URL, allowedOrigin: String?) -> NewWindowDestination {
        if url.scheme == "about" {
            return .currentContext
        }
        guard let allowedOrigin, origin(from: url) == allowedOrigin else {
            return .browser
        }
        return .currentContext
    }

    static func locationSharingEnabled(from body: Any) -> Bool? {
        dictionaryPayload(from: body)?["enabled"] as? Bool
    }

    static func narrationEnabled(from body: Any) -> Bool? {
        dictionaryPayload(from: body)?["enabled"] as? Bool
    }

    static func hqDictationEnabled(from body: Any) -> Bool? {
        dictionaryPayload(from: body)?["enabled"] as? Bool
    }

    static func speechPlaybackActive(from body: Any) -> Bool? {
        dictionaryPayload(from: body)?["playing"] as? Bool
    }

    static func responseActive(from body: Any) -> Bool? {
        dictionaryPayload(from: body)?["active"] as? Bool
    }

    /// Script-message payloads arrive as a dictionary from legacy direct
    /// `webkit.messageHandlers` posts and as a JSON string from the neutral
    /// `beeboxNativePost` transport; accept both.
    static func dictionaryPayload(from body: Any) -> [String: Any]? {
        if let payload = body as? [String: Any] {
            return payload
        }
        guard
            let string = body as? String,
            let data = string.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data),
            let payload = parsed as? [String: Any]
        else {
            return nil
        }
        return payload
    }

    /// The initial chat navigation, authenticated by header rather than by a
    /// URL query parameter.
    ///
    /// The device token does not expire, so anywhere it lands is a permanent
    /// credential — an access log, a `Referer`, WebKit history. It used to ride
    /// `?mobileToken=` here because the webview has to satisfy the box's auth
    /// gate before the startup script has run and localStorage exists.
    ///
    /// A header solves that ordering without the URL: WKWebView honors custom
    /// headers on the initial `URLRequest`, and the box answers with a
    /// short-lived `bbx_mobile` cookie. WebKit stores that cookie itself, so
    /// every later request carries it — including the tRPC WebSocket upgrade
    /// (the browser WebSocket API cannot set headers at all) and reloads WebKit
    /// starts on its own, which never come back through this method.
    ///
    /// Deliberately NOT written into `WKHTTPCookieStore` before loading:
    /// `setCookie`'s completion handler is documented-unreliable and can hang
    /// (WebKit bug 185483). Letting the navigation response set the cookie uses
    /// WebKit's own network stack and sidesteps that entirely.
    static func authenticatedRequest(for box: PairedBox) -> URLRequest {
        var request = URLRequest(url: box.chatURL)
        if let authToken = box.authToken?.trimmingCharacters(in: .whitespacesAndNewlines),
           authToken.isEmpty == false {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func request() -> URLRequest {
        Self.authenticatedRequest(for: box)
    }

    private func startupScript() -> WKUserScript? {
        guard
            let originData = try? JSONEncoder().encode(Self.origin(from: box.baseURL) ?? ""),
            let allowedOrigin = String(data: originData, encoding: .utf8)
        else {
            return nil
        }
        let sessionObserver = """
        (() => {
          const allowedOrigin = \(allowedOrigin);
          if (window.location.origin !== allowedOrigin) return;
          window.beeboxNativeQueue = window.beeboxNativeQueue || [];
          window.beeboxNativeLocationQueue = window.beeboxNativeLocationQueue || [];
          window.beeboxNativeComposerCommandAckQueue = window.beeboxNativeComposerCommandAckQueue || [];
          window.beeboxNativeCommandResultQueue = window.beeboxNativeCommandResultQueue || [];
          window.beeboxNativeSpeechCommandQueue = window.beeboxNativeSpeechCommandQueue || [];
          window.beeboxNativeReceive = (detail) => {
            window.beeboxNativeQueue.push(detail);
            window.dispatchEvent(new CustomEvent('beebox:native-emission', { detail }));
          };
          window.beeboxNativeShareLocation = (id, action = 'toggle') => {
            const detail = { id, action };
            window.beeboxNativeLocationQueue.push(detail);
            window.dispatchEvent(new CustomEvent('beebox:native-share-location', { detail }));
          };
          window.beeboxNativeSpeechCommand = (detail) => {
            window.beeboxNativeSpeechCommandQueue.push(detail);
            window.dispatchEvent(new CustomEvent('beebox:native-speech-command'));
          };
          window.beeboxNativeComposerCommandAck = (detail) => {
            window.beeboxNativeComposerCommandAckQueue.push(detail);
            window.dispatchEvent(new CustomEvent('beebox:native-composer-command-ack'));
          };
          // The answer to a V2 command (contract §4.8). Separate from the ack
          // above: the ack says whether native took the command, this says what
          // the command produced. Queue is authoritative; the event is a wake
          // signal. Keep in sync with
          // beebox/src/frontend/src/components/chat/native-control-scan.ts.
          window.beeboxNativeCommandResult = (detail) => {
            window.beeboxNativeCommandResultQueue.push(detail);
            window.dispatchEvent(new CustomEvent('beebox:native-command-result'));
          };
          // Neutral web→native transport shared with the Android shell; the web
          // layer prefers it over direct webkit.messageHandlers access.
          // Keep in sync with beebox/src/frontend/src/components/chat/native-post.ts.
          window.beeboxNativePost = (channel, payload) => {
            try { window.webkit.messageHandlers[channel].postMessage(payload); } catch (_) {}
          };
          const post = () => {
            window.beeboxNativePost('beeboxSession', window.location.href);
          };
          const wrap = (name) => {
            const original = history[name];
            history[name] = function(...args) {
              const result = original.apply(this, args);
              post();
              return result;
            };
          };
          wrap('pushState');
          wrap('replaceState');
          window.addEventListener('popstate', post);
          post();
        })();
        """
        guard let authToken = box.authToken?.trimmingCharacters(in: .whitespacesAndNewlines), !authToken.isEmpty else {
            return WKUserScript(source: sessionObserver, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        }
        guard let data = try? JSONEncoder().encode(authToken), let encoded = String(data: data, encoding: .utf8) else {
            return nil
        }
        // Keep this key name in sync with beebox/src/frontend/src/api-client.ts.
        let source = """
        (() => {
          const allowedOrigin = \(allowedOrigin);
          if (window.location.origin === allowedOrigin) {
            window.localStorage.setItem('beebox.mobileAuthToken', \(encoded));
          }
        })();
        \(sessionObserver)
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}
