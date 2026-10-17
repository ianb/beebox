import BeeBoxMacCore
import Foundation
import ImageIO
import Photos
import UniformTypeIdentifiers

/// Exports new photos from a Photos album into an upload folder as JPEG, for
/// the folder sweep to upload. Replaces the old uploader's `osxphotos` step:
/// one Photos permission instead of a separate tool, Full Disk Access, and
/// Automation permission.
struct PhotosExporter: PhotosExporting {
    /// Where each album's export ledger lives.
    let ledgerDirectory: URL
    /// `photos-export.ts` bounds an export to ten minutes; so does this.
    var timeLimit: Duration = .seconds(600)

    static func requestAccess() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return status == .authorized || status == .limited
    }

    static func albums() -> [PhotosAlbumRef] {
        var result: [PhotosAlbumRef] = []
        let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        collections.enumerateObjects { collection, _, _ in
            result.append(PhotosAlbumRef(identifier: collection.localIdentifier, title: collection.localizedTitle ?? "Untitled album"))
        }
        return result.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    func export(album: PhotosAlbumRef, into folder: URL) async -> Result<Int, PhotosExportProblem> {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return .failure(.accessDenied) }
        guard let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [album.identifier], options: nil).firstObject else {
            return .failure(.albumMissing)
        }
        let ledgerURL = PhotosExportLedger.fileURL(directory: ledgerDirectory, album: album, folder: folder)
        var ledger: PhotosExportLedger
        do {
            ledger = try PhotosExportLedger.load(from: ledgerURL) ?? PhotosExportLedger()
        } catch {
            return .failure(.failed("the export record \(ledgerURL.lastPathComponent) cannot be read"))
        }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        let assets = PHAsset.fetchAssets(in: collection, options: options)
        var pending: [PHAsset] = []
        assets.enumerateObjects { asset, _, _ in
            if !ledger.contains(asset.localIdentifier) { pending.append(asset) }
        }

        let deadline = ContinuousClock.now + timeLimit
        var written = 0
        var skipped = 0
        for (index, asset) in pending.enumerated() {
            guard ContinuousClock.now < deadline else {
                skipped += pending.count - index
                break
            }
            switch await Self.jpegData(for: asset) {
            case .success(let jpeg):
                let name = PhotosExportLedger.fileName(assetIdentifier: asset.localIdentifier, created: asset.creationDate)
                do {
                    try Self.writeVisibleWhenComplete(jpeg, named: name, in: folder)
                } catch {
                    return .failure(.failed("could not write \(name): \(error.localizedDescription)"))
                }
                ledger.record(asset.localIdentifier)
                do {
                    try ledger.save(to: ledgerURL)
                } catch {
                    return .failure(.failed("could not save the export record: \(error.localizedDescription)"))
                }
                written += 1
            case .failure(let problem):
                // An iCloud original that would not download: left out of the
                // ledger, so the next sweep tries it again.
                appLog("photos export skipped one asset: \(problem)")
                skipped += 1
            }
        }
        if skipped > 0 {
            // The ones written are in the folder and the sweep sends them; the
            // problem stays visible until every photo has exported.
            return .failure(.failed("\(skipped) of \(pending.count) new photos could not be exported (an iCloud original may not have downloaded); they are tried again each sweep"))
        }
        return .success(written)
    }

    /// Writes a dotfile, then renames it, so the sweep (which skips dotfiles)
    /// never sees half a photo.
    private static func writeVisibleWhenComplete(_ data: Data, named name: String, in folder: URL) throws {
        let temp = folder.appending(path: ".\(name).partial")
        try data.write(to: temp, options: .atomic)
        let final = folder.appending(path: name)
        if FileManager.default.fileExists(atPath: final.path) {
            try FileManager.default.removeItem(at: temp)
            return
        }
        try FileManager.default.moveItem(at: temp, to: final)
    }

    private static func jpegData(for asset: PHAsset) async -> Result<Data, PhotosExportProblem> {
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.version = .current
        let (data, type): (Data?, String?) = await withCheckedContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, type, _, _ in
                continuation.resume(returning: (data, type))
            }
        }
        guard let data else { return .failure(.failed("no image data")) }
        if let type, UTType(type)?.conforms(to: .jpeg) == true {
            return .success(data)
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            return .failure(.failed("unreadable image"))
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            return .failure(.failed("JPEG encoder unavailable"))
        }
        CGImageDestinationAddImageFromSource(destination, source, 0, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return .failure(.failed("JPEG conversion failed")) }
        return .success(output as Data)
    }
}
