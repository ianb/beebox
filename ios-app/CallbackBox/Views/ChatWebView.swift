import Foundation
import SwiftUI
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
    var pendingEmission: NativeChatEmission?
    var onSessionChange: (String?) -> Void
    var onEmissionHandled: (NativeChatEmission.ID) -> Void

    init(
        box: PairedBox,
        pendingEmission: NativeChatEmission? = nil,
        onSessionChange: @escaping (String?) -> Void = { _ in },
        onEmissionHandled: @escaping (NativeChatEmission.ID) -> Void = { _ in }
    ) {
        self.box = box
        self.pendingEmission = pendingEmission
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
        if webView.url == nil {
            webView.load(request())
        }
        context.coordinator.deliver(pendingEmission, to: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSessionChange: onSessionChange, onEmissionHandled: onEmissionHandled)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var onSessionChange: (String?) -> Void
        var onEmissionHandled: (NativeChatEmission.ID) -> Void
        private var deliveredEmissionID: NativeChatEmission.ID?

        init(onSessionChange: @escaping (String?) -> Void, onEmissionHandled: @escaping (NativeChatEmission.ID) -> Void) {
            self.onSessionChange = onSessionChange
            self.onEmissionHandled = onEmissionHandled
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onSessionChange(ChatWebView.visibleSessionID(from: webView.url))
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "callbackboxSession", let urlString = message.body as? String, let url = URL(string: urlString) else {
                return
            }
            onSessionChange(ChatWebView.visibleSessionID(from: url))
        }

        func deliver(_ emission: NativeChatEmission?, to webView: WKWebView) {
            guard let emission, deliveredEmissionID != emission.id else {
                return
            }
            guard let detail = Self.javascriptDetail(for: emission) else {
                return
            }
            deliveredEmissionID = emission.id
            let script = "window.callbackboxNativeReceive(\(detail));"
            webView.evaluateJavaScript(script) { [weak self] _, error in
                if error == nil {
                    self?.onEmissionHandled(emission.id)
                } else {
                    self?.deliveredEmissionID = nil
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

    private func request() -> URLRequest {
        var request = URLRequest(url: box.chatURL)
        if let authToken = box.authToken?.trimmingCharacters(in: .whitespacesAndNewlines), !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func startupScript() -> WKUserScript? {
        let sessionObserver = """
        (() => {
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
            return WKUserScript(source: sessionObserver, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        }
        guard let data = try? JSONEncoder().encode(authToken), let encoded = String(data: data, encoding: .utf8) else {
            return nil
        }
        let source = "window.localStorage.setItem('callbackbox.mobileAuthToken', \(encoded));\n\(sessionObserver)"
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
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
