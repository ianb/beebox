import CryptoKit
import Foundation

/// The filesystem half of a sweep: walk, settle gate, identity, hash,
/// disposition. Ports `walk.ts`, `settle.ts`, `identity.ts`, `hash.ts` and
/// `disposition.ts`.
enum ScanFiles {
    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    /// Files modified more recently than this may still be growing.
    static let settleWindow: TimeInterval = 10

    /// Non-recursive listing of regular files. Dotfiles are excluded and so is
    /// everything that is not a regular file (symlinks included, as with
    /// `Dirent.isFile()`), which drops the `imported/` archive folder. Sorted
    /// by name so a sweep is repeatable; the Node version uses readdir order.
    static func candidateFiles(in folder: URL) throws -> [URL] {
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.path)
        return names.sorted().compactMap { name in
            guard !name.hasPrefix(".") else { return nil }
            let url = folder.appendingPathComponent(name)
            guard let info = FileIdentity.stat(url, followLinks: false), (info.st_mode & S_IFMT) == S_IFREG else {
                return nil
            }
            return url
        }
    }

    static func isSettled(_ identity: FileIdentity, now: Date) -> Bool {
        let nowMs = now.timeIntervalSince1970 * 1000
        return nowMs - identity.mtimeMilliseconds >= settleWindow * 1000
    }

    /// Streaming SHA-256, lowercase hex.
    static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// `keep` is a no-op, `archive` renames into `<folder>/imported/` with
    /// `-2`, `-3`, ... on a name collision, `trash` goes to the Trash.
    static func apply(
        _ disposition: UploadDisposition,
        to file: URL,
        trash: (URL) throws -> Void
    ) throws {
        switch disposition {
        case .keep:
            return
        case .archive:
            let imported = file.deletingLastPathComponent().appendingPathComponent("imported", isDirectory: true)
            try FileManager.default.createDirectory(at: imported, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: file, to: uniqueDestination(in: imported, name: file.lastPathComponent))
        case .trash:
            try trash(file)
        }
    }

    private static func uniqueDestination(in directory: URL, name: String) -> URL {
        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        var candidate = directory.appendingPathComponent(name)
        var attempt = 1
        while FileManager.default.fileExists(atPath: candidate.path) {
            attempt += 1
            let numbered = ext.isEmpty ? "\(stem)-\(attempt)" : "\(stem)-\(attempt).\(ext)"
            candidate = directory.appendingPathComponent(numbered)
        }
        return candidate
    }
}

/// Device, inode, size and nanosecond mtime: the strongest signal available
/// without reading the bytes again. Compared before and after the upload round
/// trip so a file the scanner touched in between is left alone.
struct FileIdentity: Equatable {
    let device: Int64
    let inode: UInt64
    let size: Int64
    let mtimeNanoseconds: Int64

    var mtimeMilliseconds: Double {
        Double(mtimeNanoseconds) / 1_000_000
    }

    /// `stat` (following symlinks, as `identity.ts` does) or nil if the file is gone.
    static func snapshot(_ url: URL) -> FileIdentity? {
        guard let info = stat(url, followLinks: true) else { return nil }
        return FileIdentity(
            device: Int64(info.st_dev),
            inode: info.st_ino,
            size: info.st_size,
            mtimeNanoseconds: Int64(info.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(info.st_mtimespec.tv_nsec)
        )
    }

    static func stat(_ url: URL, followLinks: Bool) -> Darwin.stat? {
        var info = Darwin.stat()
        let result = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            // fstatat rather than stat(2): the struct's name shadows the function.
            return fstatat(AT_FDCWD, path, &info, followLinks ? 0 : AT_SYMLINK_NOFOLLOW)
        }
        return result == 0 ? info : nil
    }
}
