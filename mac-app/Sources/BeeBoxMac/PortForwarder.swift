import Foundation
import Network

/// Forwards `127.0.0.1:<port>` to the box server. The target is a host Unix
/// socket that Containerization relays into the VM over vsock, not the VM's
/// IP: macOS treats a bundled app's connections to the VM's bridge address as
/// local-network access (a permission prompt, and "Local network prohibited"
/// until granted). `localhost` is also stable across launches and a browser
/// secure context. Raw byte relay, so WebSockets pass through.
final class PortForwarder: @unchecked Sendable {
    private let listener: NWListener
    private let target: NWEndpoint
    private let queue = DispatchQueue(label: "beebox.port-forwarder")

    init(localPort: UInt16, targetSocket: URL) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: localPort)!)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
        target = .unix(path: targetSocket.path)
    }

    /// Starts listening; returns once the listener is ready or has failed.
    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let resumed = Resumed()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if resumed.claim() { continuation.resume() }
                case .failed(let error):
                    if resumed.claim() { continuation.resume(throwing: error) }
                default:
                    break
                }
            }
            let target = self.target
            let queue = self.queue
            listener.newConnectionHandler = { client in
                Self.bridge(client, to: target, on: queue)
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
    }

    /// Static, so established connections keep relaying after the
    /// forwarder itself is released; they end when either side closes.
    private static func bridge(_ client: NWConnection, to target: NWEndpoint, on queue: DispatchQueue) {
        let upstream = NWConnection(to: target, using: .tcp)
        client.stateUpdateHandler = { state in
            if case .failed = state { upstream.cancel() }
            if case .cancelled = state { upstream.cancel() }
        }
        upstream.stateUpdateHandler = { state in
            if case .failed = state { client.cancel() }
            if case .cancelled = state { client.cancel() }
        }
        client.start(queue: queue)
        upstream.start(queue: queue)
        pipe(from: client, to: upstream)
        pipe(from: upstream, to: client)
    }

    private static func pipe(from source: NWConnection, to destination: NWConnection) {
        source.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
            if let data, !data.isEmpty {
                destination.send(content: data, completion: .contentProcessed { sendError in
                    if sendError != nil {
                        source.cancel()
                        destination.cancel()
                    }
                })
            }
            if isComplete || error != nil {
                // Half-close: tell the other side no more data is coming. TCP
                // sends a FIN only for the final message context; the default
                // context leaves the write side open, and the box server's
                // WebSocket close then waits out its 30 s close timeout.
                destination.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in })
                return
            }
            pipe(from: source, to: destination)
        }
    }
}

/// One-shot guard so a continuation resumes exactly once.
private final class Resumed: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.withLock {
            if done { return false }
            done = true
            return true
        }
    }
}
