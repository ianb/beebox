import Foundation
import Darwin

enum BackupOperation: String, Codable, Sendable {
    case configure
    case run
    case status
    case check
}

struct BackupCommand: Codable, Sendable {
    static let guestHome = "/home/" + "node"
    let operation: BackupOperation
    var repository: String?
    var passwordFile: String?
    var keepDaily: String?
    var keepWeekly: String?
    var keepMonthly: String?
    var backupId: String?
    var configureOnly = false
    var json: Bool = false
    var readData: Bool = false

    var engineArguments: [String] {
        var result = ["bbx", "engine", "backup", operation.rawValue, "/data/box"]
        if let repository { result += ["--repository", repository] }
        if let passwordFile { result += ["--password-file", passwordFile] }
        if let keepDaily { result += ["--keep-daily", keepDaily] }
        if let keepWeekly { result += ["--keep-weekly", keepWeekly] }
        if let keepMonthly { result += ["--keep-monthly", keepMonthly] }
        if let backupId { result += ["--backup-id", backupId] }
        if configureOnly { result.append("--configure-only") }
        if json { result.append("--json") }
        if readData { result.append("--read-data") }
        return result
    }

    static func parse(_ arguments: [String]) throws -> Self {
        guard let action = arguments.first, let operation = BackupOperation(rawValue: action) else {
            throw BackupCommandError.usage
        }
        var command = Self(operation: operation)
        var index = 1
        while index < arguments.count {
            let key = arguments[index]
            if key == "--json", operation == .status, !command.json {
                command.json = true
                index += 1
                continue
            }
            if key == "--read-data", operation == .check, !command.readData {
                command.readData = true
                index += 1
                continue
            }
            if key == "--configure-only", operation == .configure, !command.configureOnly {
                command.configureOnly = true
                index += 1
                continue
            }
            guard index + 1 < arguments.count else { throw BackupCommandError.usage }
            let value = arguments[index + 1]
            switch key {
            case "--repository" where operation == .configure:
                guard command.repository == nil else { throw BackupCommandError.usage }
                command.repository = value
            case "--password-file" where operation == .configure:
                guard command.passwordFile == nil else { throw BackupCommandError.usage }
                guard URL(filePath: value).standardizedFileURL.path.hasPrefix(Self.guestHome + "/") else {
                    throw BackupCommandError.passwordPath
                }
                command.passwordFile = value
            case "--keep-daily" where operation == .configure:
                guard command.keepDaily == nil else { throw BackupCommandError.usage }
                command.keepDaily = value
            case "--keep-weekly" where operation == .configure:
                guard command.keepWeekly == nil else { throw BackupCommandError.usage }
                command.keepWeekly = value
            case "--keep-monthly" where operation == .configure:
                guard command.keepMonthly == nil else { throw BackupCommandError.usage }
                command.keepMonthly = value
            case "--backup-id" where operation == .configure:
                guard command.backupId == nil else { throw BackupCommandError.usage }
                command.backupId = value
            default:
                throw BackupCommandError.usage
            }
            index += 2
        }
        if operation == .configure, (command.repository == nil || command.passwordFile == nil) {
            throw BackupCommandError.usage
        }
        return command
    }
}

enum BackupCommandError: Error, LocalizedError {
    case usage
    case passwordPath

    var errorDescription: String? {
        switch self {
        case .usage:
            return "usage: BeeBoxMac backup configure --repository <url> --password-file \(BackupCommand.guestHome)/<path> [--keep-daily N --keep-weekly N --keep-monthly N --backup-id UUID --configure-only] | run | status [--json] | check [--read-data]"
        case .passwordPath:
            return "the password file must be in the Mac app's mounted home; place it under ~/Library/Application Support/Bee Box/home and pass its \(BackupCommand.guestHome)/... path"
        }
    }
}

struct BackupCommandResponse: Codable, Sendable {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

/// A mode of the app's existing executable that sends only typed backup
/// requests to the already running app process.
enum BackupControlClient {
    static func run(arguments: [String], socketPath: String) -> Int32 {
        do {
            let command = try BackupCommand.parse(arguments)
            let response = try request(command, socketPath: socketPath)
            if !response.stdout.isEmpty { FileHandle.standardOutput.write(Data(response.stdout.utf8)) }
            if !response.stderr.isEmpty { FileHandle.standardError.write(Data(response.stderr.utf8)) }
            return response.exitCode
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 64
        }
    }

    private static func request(_ command: BackupCommand, socketPath: String) throws -> BackupCommandResponse {
        let fd = try connect(path: socketPath)
        defer { Darwin.close(fd) }
        var requestData = try JSONEncoder().encode(command)
        requestData.append(0x0A)
        try sendAll(fd: fd, data: requestData)
        let responseData = try readToEnd(fd: fd, limit: 4 * 1024 * 1024)
        return try JSONDecoder().decode(BackupCommandResponse.self, from: responseData)
    }
}

/// Private, app-owned local control surface. The socket accepts only the
/// BackupCommand schema and never exposes arbitrary process execution.
final class BackupControlServer: @unchecked Sendable {
    typealias Handler = @Sendable (BackupCommand) async -> BackupCommandResponse

    private let path: String
    private let handler: Handler
    private let descriptor: Int32
    private var source: DispatchSourceRead!

    init(path: String, handler: @escaping Handler) throws {
        self.path = path
        self.handler = handler
        try FileManager.default.createDirectory(
            at: URL(filePath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posixError("create backup control socket") }
        do {
            if FileManager.default.fileExists(atPath: path) {
                guard !Self.probe(path: path) else { throw BackupControlError.alreadyRunning }
                _ = unlink(path)
            }
            var address = try Self.address(path: path)
            let bindResult = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard bindResult == 0 else { throw posixError("bind backup control socket") }
            guard chmod(path, 0o600) == 0 else { throw posixError("protect backup control socket") }
            guard listen(fd, 8) == 0 else { throw posixError("listen on backup control socket") }
            descriptor = fd
        } catch {
            Darwin.close(fd)
            throw error
        }
        source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: DispatchQueue(label: "beebox.backup-control"))
        source.setEventHandler { [weak self] in self?.acceptOne() }
        source.setCancelHandler { [path] in
            Darwin.close(fd)
            _ = unlink(path)
        }
        source.resume()
    }

    deinit { source.cancel() }

    private func acceptOne() {
        let client = accept(descriptor, nil, nil)
        guard client >= 0 else { return }
        guard setNoSigpipe(client) else { Darwin.close(client); return }
        DispatchQueue.global(qos: .userInitiated).async { [handler] in
            do {
                let data = try readLine(fd: client, limit: 64 * 1024)
                let command = try JSONDecoder().decode(BackupCommand.self, from: data)
                Task {
                    defer { Darwin.close(client) }
                    let response = await handler(command)
                    if let encoded = try? JSONEncoder().encode(response) {
                        var line = encoded
                        line.append(0x0A)
                        try? sendAll(fd: client, data: line)
                    }
                }
            } catch {
                defer { Darwin.close(client) }
                let response = BackupCommandResponse(exitCode: 64, stdout: "", stderr: "Invalid backup request: \(error.localizedDescription)\n")
                if let encoded = try? JSONEncoder().encode(response) {
                    var line = encoded
                    line.append(0x0A)
                    try? sendAll(fd: client, data: line)
                }
            }
        }
    }

    private static func probe(path: String) -> Bool {
        guard let fd = try? connect(path: path) else { return false }
        Darwin.close(fd)
        return true
    }

    fileprivate static func address(path: String) throws -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bytes = Array(path.utf8CString)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard bytes.count <= capacity else { throw BackupControlError.pathTooLong }
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { destination in
                for (index, byte) in bytes.enumerated() { destination[index] = byte }
            }
        }
        return address
    }
}

enum BackupControlError: Error, LocalizedError {
    case alreadyRunning
    case pathTooLong
    case appUnavailable
    case requestTooLarge
    case responseTooLarge

    var errorDescription: String? {
        switch self {
        case .alreadyRunning: return "Bee Box Desktop already has a backup control socket open"
        case .pathTooLong: return "the backup control socket path is too long"
        case .appUnavailable: return "Bee Box Desktop is not running; open it and start the box first"
        case .requestTooLarge: return "backup control request is too large"
        case .responseTooLarge: return "backup control response is too large"
        }
    }
}

private func connect(path: String) throws -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw posixError("create backup control client") }
    guard setNoSigpipe(fd) else {
        let error = posixError("protect backup control client")
        Darwin.close(fd)
        throw error
    }
    var address = try BackupControlServer.address(path: path)
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard result == 0 else {
        let error = posixError("connect to Bee Box Desktop")
        Darwin.close(fd)
        if errno == ENOENT || errno == ECONNREFUSED { throw BackupControlError.appUnavailable }
        throw error
    }
    return fd
}

private func setNoSigpipe(_ fd: Int32) -> Bool {
    var enabled: Int32 = 1
    return setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout<Int32>.size)) == 0
}

private func sendAll(fd: Int32, data: Data) throws {
    try data.withUnsafeBytes { bytes in
        guard let base = bytes.baseAddress else { return }
        var offset = 0
        while offset < bytes.count {
            let count = Darwin.send(fd, base.advanced(by: offset), bytes.count - offset, 0)
            guard count > 0 else { throw posixError("send backup control request") }
            offset += count
        }
    }
}

private func readToEnd(fd: Int32, limit: Int) throws -> Data {
    var output = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while output.count < limit {
        let count = Darwin.recv(fd, &chunk, min(chunk.count, limit - output.count), 0)
        if count == 0 { return output }
        guard count > 0 else { throw posixError("read backup control response") }
        output.append(contentsOf: chunk.prefix(count))
    }
    throw BackupControlError.responseTooLarge
}

private func readLine(fd: Int32, limit: Int) throws -> Data {
    var output = Data()
    var byte: UInt8 = 0
    while output.count < limit {
        let count = Darwin.recv(fd, &byte, 1, 0)
        guard count == 1 else { throw posixError("read backup request") }
        if byte == 0x0A { return output }
        output.append(byte)
    }
    throw BackupControlError.requestTooLarge
}

private func posixError(_ action: String) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [NSLocalizedDescriptionKey: action])
}
