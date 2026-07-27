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

struct NativeScreenshotRequest: Equatable, Identifiable {
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
    var locationShareRequest: NativeLocationShareRequest?
    var screenshotRequest: NativeScreenshotRequest?
    var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement]
    var onSessionChange: (String?) -> Void
    var onEmissionDeliveryAttempt: (NativeChatEmission.ID) -> Void
    var onEmissionReceipt: (NativeEmissionReceipt) -> Void
    var onLocationShareResult: (NativeLocationShareResult) -> Void
    var onLocationSharingStateChange: (Bool) -> Void
    var onNarrationStateChange: (Bool) -> Void
    var onScreenshotResult: (NativeScreenshotResult) -> Void
    var onComposerCommand: (NativeComposerCommandDelivery) -> Void
    var onComposerCommandAcknowledgementDelivered: (String) -> Void

    init(
        box: PairedBox,
        pendingEmissions: [NativeChatEmission] = [],
        locationShareRequest: NativeLocationShareRequest? = nil,
        screenshotRequest: NativeScreenshotRequest? = nil,
        composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = [],
        onSessionChange: @escaping (String?) -> Void = { _ in },
        onEmissionDeliveryAttempt: @escaping (NativeChatEmission.ID) -> Void = { _ in },
        onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void = { _ in },
        onLocationShareResult: @escaping (NativeLocationShareResult) -> Void = { _ in },
        onLocationSharingStateChange: @escaping (Bool) -> Void = { _ in },
        onNarrationStateChange: @escaping (Bool) -> Void = { _ in },
        onScreenshotResult: @escaping (NativeScreenshotResult) -> Void = { _ in },
        onComposerCommand: @escaping (NativeComposerCommandDelivery) -> Void = { _ in },
        onComposerCommandAcknowledgementDelivered: @escaping (String) -> Void = { _ in }
    ) {
        self.box = box
        self.pendingEmissions = pendingEmissions
        self.locationShareRequest = locationShareRequest
        self.screenshotRequest = screenshotRequest
        self.composerCommandAcknowledgements = composerCommandAcknowledgements
        self.onSessionChange = onSessionChange
        self.onEmissionDeliveryAttempt = onEmissionDeliveryAttempt
        self.onEmissionReceipt = onEmissionReceipt
        self.onLocationShareResult = onLocationShareResult
        self.onLocationSharingStateChange = onLocationSharingStateChange
        self.onNarrationStateChange = onNarrationStateChange
        self.onScreenshotResult = onScreenshotResult
        self.onComposerCommand = onComposerCommand
        self.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = Self.makeConfiguration()
        configuration.userContentController.add(context.coordinator, name: "callbackboxSession")
        configuration.userContentController.add(context.coordinator, name: "callbackboxEmissionReceipt")
        configuration.userContentController.add(context.coordinator, name: "callbackboxLocationResult")
        configuration.userContentController.add(context.coordinator, name: "callbackboxLocationState")
        configuration.userContentController.add(context.coordinator, name: "callbackboxNarrationState")
        configuration.userContentController.add(context.coordinator, name: "callbackboxComposerCommand")
        if let script = startupScript() {
            configuration.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
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
        context.coordinator.onScreenshotResult = onScreenshotResult
        context.coordinator.onComposerCommand = onComposerCommand
        context.coordinator.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
        context.coordinator.allowedOrigin = Self.origin(from: box.baseURL)
        context.coordinator.pendingEmissions = pendingEmissions
        context.coordinator.locationShareRequest = locationShareRequest
        context.coordinator.screenshotRequest = screenshotRequest
        context.coordinator.composerCommandAcknowledgements = composerCommandAcknowledgements
        if webView.url == nil {
            webView.load(request())
        }
        context.coordinator.deliver(pendingEmissions, to: webView)
        context.coordinator.deliverLocationRequest(to: webView)
        context.coordinator.captureScreenshot(from: webView)
        context.coordinator.deliverComposerCommandAcknowledgements(to: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            allowedOrigin: Self.origin(from: box.baseURL),
            onSessionChange: onSessionChange,
            onEmissionDeliveryAttempt: onEmissionDeliveryAttempt,
            onEmissionReceipt: onEmissionReceipt,
            onLocationShareResult: onLocationShareResult,
            onLocationSharingStateChange: onLocationSharingStateChange,
            onNarrationStateChange: onNarrationStateChange,
            onScreenshotResult: onScreenshotResult,
            onComposerCommand: onComposerCommand,
            onComposerCommandAcknowledgementDelivered: onComposerCommandAcknowledgementDelivered
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
        var allowedOrigin: String?
        var onSessionChange: (String?) -> Void
        var onEmissionDeliveryAttempt: (NativeChatEmission.ID) -> Void
        var onEmissionReceipt: (NativeEmissionReceipt) -> Void
        var onLocationShareResult: (NativeLocationShareResult) -> Void
        var onLocationSharingStateChange: (Bool) -> Void
        var onNarrationStateChange: (Bool) -> Void
        var onScreenshotResult: (NativeScreenshotResult) -> Void
        var onComposerCommand: (NativeComposerCommandDelivery) -> Void
        var onComposerCommandAcknowledgementDelivered: (String) -> Void
        var pendingEmissions: [NativeChatEmission] = []
        var locationShareRequest: NativeLocationShareRequest?
        var screenshotRequest: NativeScreenshotRequest?
        var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = []
        private var inflightEmissionIDs = Set<NativeChatEmission.ID>()
        private var receiptTimeouts: [NativeChatEmission.ID: DispatchWorkItem] = [:]
        private var inflightLocationRequestID: NativeLocationShareRequest.ID?
        private var locationRequestTimeout: DispatchWorkItem?
        private var inflightScreenshotRequestID: NativeScreenshotRequest.ID?
        private var inflightComposerCommandAcknowledgementIDs = Set<String>()
        private var pageLoaded: Bool
        private let receiptTimeoutDelay: TimeInterval
        private let evaluateEmission: ((String, @escaping (Error?) -> Void) -> Void)?
        private let openExternalURL: (URL) -> Void
        private let loadInCurrentContext: (WKWebView, URLRequest) -> Void

        init(
            allowedOrigin: String?,
            onSessionChange: @escaping (String?) -> Void,
            onEmissionDeliveryAttempt: @escaping (NativeChatEmission.ID) -> Void,
            onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void,
            onLocationShareResult: @escaping (NativeLocationShareResult) -> Void,
            onLocationSharingStateChange: @escaping (Bool) -> Void,
            onNarrationStateChange: @escaping (Bool) -> Void,
            onScreenshotResult: @escaping (NativeScreenshotResult) -> Void,
            onComposerCommand: @escaping (NativeComposerCommandDelivery) -> Void,
            onComposerCommandAcknowledgementDelivered: @escaping (String) -> Void,
            receiptTimeoutDelay: TimeInterval = 35,
            pageLoaded: Bool = false,
            evaluateEmission: ((String, @escaping (Error?) -> Void) -> Void)? = nil,
            openExternalURL: @escaping (URL) -> Void = { UIApplication.shared.open($0) },
            loadInCurrentContext: @escaping (WKWebView, URLRequest) -> Void = { webView, request in
                webView.load(request)
            }
        ) {
            self.allowedOrigin = allowedOrigin
            self.onSessionChange = onSessionChange
            self.onEmissionDeliveryAttempt = onEmissionDeliveryAttempt
            self.onEmissionReceipt = onEmissionReceipt
            self.onLocationShareResult = onLocationShareResult
            self.onLocationSharingStateChange = onLocationSharingStateChange
            self.onNarrationStateChange = onNarrationStateChange
            self.onScreenshotResult = onScreenshotResult
            self.onComposerCommand = onComposerCommand
            self.onComposerCommandAcknowledgementDelivered = onComposerCommandAcknowledgementDelivered
            self.receiptTimeoutDelay = receiptTimeoutDelay
            self.pageLoaded = pageLoaded
            self.evaluateEmission = evaluateEmission
            self.openExternalURL = openExternalURL
            self.loadInCurrentContext = loadInCurrentContext
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageLoaded = true
            onSessionChange(ChatWebView.visibleSessionID(from: webView.url))
            deliver(pendingEmissions, to: webView)
            deliverLocationRequest(to: webView)
            captureScreenshot(from: webView)
            deliverComposerCommandAcknowledgements(to: webView)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            pageLoaded = false
            inflightEmissionIDs.removeAll()
            receiptTimeouts.values.forEach { $0.cancel() }
            receiptTimeouts.removeAll()
            inflightLocationRequestID = nil
            locationRequestTimeout?.cancel()
            locationRequestTimeout = nil
            inflightScreenshotRequestID = nil
            inflightComposerCommandAcknowledgementIDs.removeAll()
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
            if message.name == "callbackboxEmissionReceipt" {
                receiveEmissionReceipt(message.body)
                return
            }
            if message.name == "callbackboxLocationResult" {
                receiveLocationResult(message.body)
                return
            }
            if message.name == "callbackboxLocationState" {
                receiveLocationState(message.body)
                return
            }
            if message.name == "callbackboxNarrationState" {
                receiveNarrationState(message.body)
                return
            }
            if message.name == "callbackboxComposerCommand" {
                receiveComposerCommand(message.body)
                return
            }
            guard message.name == "callbackboxSession", let urlString = message.body as? String, let url = URL(string: urlString) else {
                return
            }
            guard ChatWebView.origin(from: url) == allowedOrigin else {
                return
            }
            onSessionChange(ChatWebView.visibleSessionID(from: url))
        }

        func deliver(_ emissions: [NativeChatEmission], to webView: WKWebView) {
            guard pageLoaded else {
                return
            }
            for emission in emissions where inflightEmissionIDs.contains(emission.id) == false {
                guard let detail = Self.javascriptDetail(for: emission) else {
                    continue
                }
                onEmissionDeliveryAttempt(emission.id)
                inflightEmissionIDs.insert(emission.id)
                startReceiptTimeout(for: emission.id)
                let script = "window.callbackboxNativeReceive(\(detail));"
                evaluate(script, in: webView) { [weak self] error in
                    guard error != nil else {
                        return
                    }
                    self?.finishInflightEmission(emission.id)
                    self?.onEmissionReceipt(NativeEmissionReceipt(
                        emissionID: emission.id,
                        disposition: .rejected,
                        reason: "The chat page could not receive the message."
                    ))
                }
            }
        }

        private func receiveEmissionReceipt(_ body: Any) {
            guard
                let payload = ChatWebView.dictionaryPayload(from: body),
                let idString = payload["emissionId"] as? String,
                let emissionID = UUID(uuidString: idString),
                let dispositionString = payload["disposition"] as? String,
                let disposition = NativeEmissionReceipt.Disposition(rawValue: dispositionString),
                inflightEmissionIDs.contains(emissionID)
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

        private func startReceiptTimeout(for emissionID: NativeChatEmission.ID) {
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.inflightEmissionIDs.contains(emissionID) else {
                    return
                }
                self.finishInflightEmission(emissionID)
                self.onEmissionReceipt(NativeEmissionReceipt(
                    emissionID: emissionID,
                    disposition: .rejected,
                    reason: "The chat did not confirm the message. Try sending it again."
                ))
            }
            receiptTimeouts[emissionID] = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + receiptTimeoutDelay, execute: timeout)
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
            inflightEmissionIDs.remove(emissionID)
            receiptTimeouts.removeValue(forKey: emissionID)?.cancel()
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
            let script = "window.callbackboxNativeShareLocation(\"\(request.id.uuidString)\", \"toggle\");"
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
                let script = "window.callbackboxNativeComposerCommandAck(\(detail));"
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

        private static func javascriptDetail(for acknowledgement: NativeComposerCommandAcknowledgement) -> String? {
            guard let data = try? JSONEncoder().encode(acknowledgement) else {
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

    /// Script-message payloads arrive as a dictionary from legacy direct
    /// `webkit.messageHandlers` posts and as a JSON string from the neutral
    /// `callbackboxNativePost` transport; accept both.
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
    /// short-lived `cb_mobile` cookie. WebKit stores that cookie itself, so
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
          window.callbackboxNativeQueue = window.callbackboxNativeQueue || [];
          window.callbackboxNativeLocationQueue = window.callbackboxNativeLocationQueue || [];
          window.callbackboxNativeComposerCommandAckQueue = window.callbackboxNativeComposerCommandAckQueue || [];
          window.callbackboxNativeReceive = (detail) => {
            window.callbackboxNativeQueue.push(detail);
            window.dispatchEvent(new CustomEvent('callbackbox:native-emission', { detail }));
          };
          window.callbackboxNativeShareLocation = (id, action = 'toggle') => {
            const detail = { id, action };
            window.callbackboxNativeLocationQueue.push(detail);
            window.dispatchEvent(new CustomEvent('callbackbox:native-share-location', { detail }));
          };
          window.callbackboxNativeComposerCommandAck = (detail) => {
            window.callbackboxNativeComposerCommandAckQueue.push(detail);
            window.dispatchEvent(new CustomEvent('callbackbox:native-composer-command-ack'));
          };
          // Neutral web→native transport shared with the Android shell; the web
          // layer prefers it over direct webkit.messageHandlers access.
          // Keep in sync with callback-box/src/frontend/src/components/chat/native-post.ts.
          window.callbackboxNativePost = (channel, payload) => {
            try { window.webkit.messageHandlers[channel].postMessage(payload); } catch (_) {}
          };
          const post = () => {
            window.callbackboxNativePost('callbackboxSession', window.location.href);
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
        // Keep this key name in sync with callback-box/src/frontend/src/api-client.ts.
        let source = """
        (() => {
          const allowedOrigin = \(allowedOrigin);
          if (window.location.origin === allowedOrigin) {
            window.localStorage.setItem('callbackbox.mobileAuthToken', \(encoded));
          }
        })();
        \(sessionObserver)
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
