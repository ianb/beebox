import Foundation
import SwiftUI
import UIKit
import WebKit

struct NativeChatEmission: Equatable, Identifiable {
    var id = UUID()
    var text: String
    var origin: QueuedMessage.Origin
    var diarized: Bool
    var images: [ChatImageAttachment]
}

struct ChatWebView: UIViewRepresentable {
    var box: PairedBox
    var pendingEmissions: [NativeChatEmission]
    var onSessionChange: (String?) -> Void
    var onEmissionHandled: (NativeChatEmission.ID) -> Void

    init(
        box: PairedBox,
        pendingEmissions: [NativeChatEmission] = [],
        onSessionChange: @escaping (String?) -> Void = { _ in },
        onEmissionHandled: @escaping (NativeChatEmission.ID) -> Void = { _ in }
    ) {
        self.box = box
        self.pendingEmissions = pendingEmissions
        self.onSessionChange = onSessionChange
        self.onEmissionHandled = onEmissionHandled
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: "callbackboxSession")
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
        context.coordinator.onEmissionHandled = onEmissionHandled
        context.coordinator.allowedOrigin = Self.origin(from: box.baseURL)
        if webView.url == nil {
            webView.load(request())
        }
        context.coordinator.deliver(pendingEmissions, to: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            allowedOrigin: Self.origin(from: box.baseURL),
            onSessionChange: onSessionChange,
            onEmissionHandled: onEmissionHandled
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var allowedOrigin: String?
        var onSessionChange: (String?) -> Void
        var onEmissionHandled: (NativeChatEmission.ID) -> Void
        private var inflightEmissionIDs = Set<NativeChatEmission.ID>()

        init(
            allowedOrigin: String?,
            onSessionChange: @escaping (String?) -> Void,
            onEmissionHandled: @escaping (NativeChatEmission.ID) -> Void
        ) {
            self.allowedOrigin = allowedOrigin
            self.onSessionChange = onSessionChange
            self.onEmissionHandled = onEmissionHandled
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onSessionChange(ChatWebView.visibleSessionID(from: webView.url))
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
            guard message.name == "callbackboxSession", let urlString = message.body as? String, let url = URL(string: urlString) else {
                return
            }
            guard ChatWebView.origin(from: url) == allowedOrigin else {
                return
            }
            onSessionChange(ChatWebView.visibleSessionID(from: url))
        }

        func deliver(_ emissions: [NativeChatEmission], to webView: WKWebView) {
            for emission in emissions where inflightEmissionIDs.contains(emission.id) == false {
                guard let detail = Self.javascriptDetail(for: emission) else {
                    continue
                }
                inflightEmissionIDs.insert(emission.id)
                let script = "window.callbackboxNativeReceive(\(detail));"
                webView.evaluateJavaScript(script) { [weak self] _, error in
                    if error == nil {
                        self?.onEmissionHandled(emission.id)
                    } else {
                        self?.inflightEmissionIDs.remove(emission.id)
                    }
                }
            }
        }

        private static func javascriptDetail(for emission: NativeChatEmission) -> String? {
            let payload = NativeEmissionPayload(
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
