import Foundation
import Network

/// Forwards `127.0.0.1:<port>` to the VM's server. The VM's own address
/// changes on every launch and is not a browser secure context (the web UI
/// needs `crypto.randomUUID`, which only secure contexts expose);
/// `localhost` is stable and secure. Raw TCP, so WebSockets pass through.
final class PortForwarder: @unchecked Sendable {
    private let listener: NWListener
    private let target: NWEndpoint
    private let queue = DispatchQueue(label: "beebox.port-forwarder")

    init(localPort: UInt16, targetHost: String, targetPort: UInt16) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: localPort)!)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
        target = .hostPort(host: NWEndpoint.Host(targetHost), port: NWEndpoint.Port(rawValue: targetPort)!)
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
            listener.newConnectionHandler = { [weak self] client in
                self?.bridge(client)
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func bridge(_ client: NWConnection) {
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

    private func pipe(from source: NWConnection, to destination: NWConnection) {
        source.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            if let data, !data.isEmpty {
                destination.send(content: data, completion: .contentProcessed { sendError in
                    if sendError != nil {
                        source.cancel()
                        destination.cancel()
                    }
                })
            }
            if isComplete || error != nil {
                // Half-close: tell the other side no more data is coming.
                destination.send(content: nil, isComplete: true, completion: .contentProcessed { _ in })
                return
            }
            self?.pipe(from: source, to: destination)
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
