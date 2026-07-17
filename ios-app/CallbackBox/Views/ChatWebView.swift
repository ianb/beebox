import Foundation
import SwiftUI
import UIKit
import WebKit

struct NativeChatEmission: Equatable, Identifiable {
    enum Origin: String {
        case typed
        case voice
    }

    var id = UUID()
    var text: String
    var origin: Origin
    var diarized: Bool
    var images: [ChatImageAttachment]
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

struct ChatWebView: UIViewRepresentable {
    var box: PairedBox
    var pendingEmissions: [NativeChatEmission]
    var onSessionChange: (String?) -> Void
    var onEmissionReceipt: (NativeEmissionReceipt) -> Void

    init(
        box: PairedBox,
        pendingEmissions: [NativeChatEmission] = [],
        onSessionChange: @escaping (String?) -> Void = { _ in },
        onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void = { _ in }
    ) {
        self.box = box
        self.pendingEmissions = pendingEmissions
        self.onSessionChange = onSessionChange
        self.onEmissionReceipt = onEmissionReceipt
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: "callbackboxSession")
        configuration.userContentController.add(context.coordinator, name: "callbackboxEmissionReceipt")
        if let script = startupScript() {
            configuration.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(request())
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onSessionChange = onSessionChange
        context.coordinator.onEmissionReceipt = onEmissionReceipt
        context.coordinator.allowedOrigin = Self.origin(from: box.baseURL)
        context.coordinator.pendingEmissions = pendingEmissions
        if webView.url == nil {
            webView.load(request())
        }
        context.coordinator.deliver(pendingEmissions, to: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            allowedOrigin: Self.origin(from: box.baseURL),
            onSessionChange: onSessionChange,
            onEmissionReceipt: onEmissionReceipt
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var allowedOrigin: String?
        var onSessionChange: (String?) -> Void
        var onEmissionReceipt: (NativeEmissionReceipt) -> Void
        var pendingEmissions: [NativeChatEmission] = []
        private var inflightEmissionIDs = Set<NativeChatEmission.ID>()
        private var receiptTimeouts: [NativeChatEmission.ID: DispatchWorkItem] = [:]
        private var pageLoaded = false

        init(
            allowedOrigin: String?,
            onSessionChange: @escaping (String?) -> Void,
            onEmissionReceipt: @escaping (NativeEmissionReceipt) -> Void
        ) {
            self.allowedOrigin = allowedOrigin
            self.onSessionChange = onSessionChange
            self.onEmissionReceipt = onEmissionReceipt
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageLoaded = true
            onSessionChange(ChatWebView.visibleSessionID(from: webView.url))
            deliver(pendingEmissions, to: webView)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            pageLoaded = false
            inflightEmissionIDs.removeAll()
            receiptTimeouts.values.forEach { $0.cancel() }
            receiptTimeouts.removeAll()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.targetFrame?.isMainFrame != false, let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if ChatWebView.origin(from: url) == allowedOrigin || url.scheme == "about" {
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "callbackboxEmissionReceipt" {
                receiveEmissionReceipt(message.body)
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
                inflightEmissionIDs.insert(emission.id)
                startReceiptTimeout(for: emission.id)
                let script = "window.callbackboxNativeReceive(\(detail));"
                webView.evaluateJavaScript(script) { [weak self] _, error in
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
                let payload = body as? [String: Any],
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
            DispatchQueue.main.asyncAfter(deadline: .now() + 35, execute: timeout)
        }

        private func finishInflightEmission(_ emissionID: NativeChatEmission.ID) {
            inflightEmissionIDs.remove(emissionID)
            receiptTimeouts.removeValue(forKey: emissionID)?.cancel()
        }

        private static func javascriptDetail(for emission: NativeChatEmission) -> String? {
            let payload = NativeEmissionPayload(
                id: emission.id.uuidString,
                text: emission.text,
                origin: emission.origin.rawValue,
                diarized: emission.diarized,
                images: emission.images
            )
            guard let data = try? JSONEncoder().encode(payload) else {
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

    private func request() -> URLRequest {
        URLRequest(url: authenticatedChatURL)
    }

    private var authenticatedChatURL: URL {
        guard
            let authToken = box.authToken?.trimmingCharacters(in: .whitespacesAndNewlines),
            authToken.isEmpty == false,
            var components = URLComponents(url: box.chatURL, resolvingAgainstBaseURL: false)
        else {
            return box.chatURL
        }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "mobileToken" }
        queryItems.append(URLQueryItem(name: "mobileToken", value: authToken))
        components.queryItems = queryItems
        return components.url ?? box.chatURL
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
          window.callbackboxNativeReceive = (detail) => {
            window.callbackboxNativeQueue.push(detail);
            window.dispatchEvent(new CustomEvent('callbackbox:native-emission', { detail }));
          };
          const post = () => {
            try { window.webkit.messageHandlers.callbackboxSession.postMessage(window.location.href); } catch (_) {}
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

private struct NativeEmissionPayload: Encodable {
    var id: String
    var text: String
    var origin: String
    var diarized: Bool
    var images: [ChatImageAttachment]
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
