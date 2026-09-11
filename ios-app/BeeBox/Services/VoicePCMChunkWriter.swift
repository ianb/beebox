import AVFAudio
import Foundation

/// One finished 16 kHz mono `pcm-s16le-16k` chunk file
/// (`docs/plans/resilient-voice-recording.md`, Track 6): `pcm-000001.raw`, …
/// written into the writer's directory. `byteCount` is exactly
/// `VoicePCMChunkWriter.chunkByteCount` (480,000) except for the last chunk of
/// a recording, which `finish()` flushes short.
struct VoicePCMChunk: Equatable, Sendable {
    var index: Int
    var url: URL
    var byteCount: Int
}

/// Converts whatever format the `AVAudioEngine` input tap delivers into 16 kHz
/// mono signed 16-bit little-endian PCM, and slices the continuous stream into
/// exact 480,000-byte (15 s) chunk files.
///
/// The tap callback runs on AVFoundation's realtime audio thread, not the main
/// actor. `append` and `finish` run their work on a private serial queue via
/// `queue.sync` — synchronous from the caller's point of view (so buffer
/// order is preserved exactly, the same guarantee the tap's own
/// `audioFile.write(from:)` already relies on today) but off the main actor,
/// and bounded to a format conversion plus, at most once per ~15 s, one small
/// file write — nothing here ever waits on the network or on `@MainActor`
/// state.
final class VoicePCMChunkWriter: @unchecked Sendable {
    static let targetSampleRate: Double = 16_000
    static let bytesPerSample = 2
    static let chunkDurationSeconds: Double = 15
    static let chunkByteCount = Int(targetSampleRate) * bytesPerSample * Int(chunkDurationSeconds)

    /// Fixed, always-constructible parameters (mono Int16 PCM at a supported
    /// sample rate) — `AVAudioFormat` only returns `nil` for a genuinely
    /// invalid combination, which this never is.
    private static let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: targetSampleRate,
        channels: 1,
        interleaved: true
    )!

    private let directory: URL
    private let fileManager: FileManager
    private let onChunk: @Sendable (VoicePCMChunk) -> Void
    private let onWriteFailure: @Sendable (Error) -> Void
    private let queue = DispatchQueue(label: "app.beebox.ios.voice-pcm-chunk-writer")

    private var converter: AVAudioConverter?
    private var converterSourceFormat: AVAudioFormat?
    private var pendingBytes = Data()
    private var nextChunkIndex = 1
    private var finished = false

    init(
        directory: URL,
        fileManager: FileManager = .default,
        onChunk: @escaping @Sendable (VoicePCMChunk) -> Void,
        onWriteFailure: @escaping @Sendable (Error) -> Void = { _ in }
    ) {
        self.directory = directory
        self.fileManager = fileManager
        self.onChunk = onChunk
        self.onWriteFailure = onWriteFailure
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Chunks fully written so far, including any produced by `finish()`.
    var chunksWritten: Int {
        queue.sync { nextChunkIndex - 1 }
    }

    /// Append one tap buffer. A buffer whose format can't be converted is
    /// dropped silently, matching the tap's own best-effort write — losing one
    /// buffer's worth of audio (~1024 frames) is not worth failing the whole
    /// recording over.
    func append(_ buffer: AVAudioPCMBuffer) {
        queue.sync {
            guard finished == false else {
                return
            }
            guard let converted = convertedBytes(for: buffer) else {
                return
            }
            appendConverted(converted)
        }
    }

    /// Flush whatever is buffered as a final, possibly short, chunk. Safe to
    /// call more than once — including from an interruption/route-change
    /// teardown racing a normal stop — only the first call does anything.
    func finish() {
        queue.sync {
            guard finished == false else {
                return
            }
            finished = true
            guard pendingBytes.isEmpty == false else {
                return
            }
            writeChunk(pendingBytes)
            pendingBytes.removeAll()
        }
    }

    static func chunkFilename(_ oneIndexedChunkNumber: Int) -> String {
        "pcm-" + String(format: "%06d", oneIndexedChunkNumber) + ".raw"
    }

    /// Always called on `queue`.
    private func convertedBytes(for buffer: AVAudioPCMBuffer) -> Data? {
        // Already the target format (only reachable from a synthetic caller —
        // real hardware taps are never native 16 kHz Int16 — but exact and
        // free when it happens, and it keeps sample-accurate tests independent
        // of `AVAudioConverter`'s own passthrough behavior).
        if buffer.format == Self.outputFormat {
            guard let channelData = buffer.int16ChannelData else {
                return Data()
            }
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else {
                return Data()
            }
            return Data(bytes: channelData[0], count: frameLength * Self.bytesPerSample)
        }
        guard let converter = converter(for: buffer.format) else {
            return nil
        }
        return Self.convert(buffer, using: converter)
    }

    /// Always called on `queue`.
    private func converter(for format: AVAudioFormat) -> AVAudioConverter? {
        if let converter, converterSourceFormat == format {
            return converter
        }
        guard let newConverter = AVAudioConverter(from: format, to: Self.outputFormat) else {
            return nil
        }
        converterSourceFormat = format
        converter = newConverter
        return newConverter
    }

    /// Always called on `queue`.
    private func appendConverted(_ data: Data) {
        pendingBytes.append(data)
        while pendingBytes.count >= Self.chunkByteCount {
            let chunkData = Data(pendingBytes.prefix(Self.chunkByteCount))
            writeChunk(chunkData)
            pendingBytes.removeFirst(Self.chunkByteCount)
        }
    }

    /// Always called on `queue`.
    private func writeChunk(_ data: Data) {
        let index = nextChunkIndex
        nextChunkIndex += 1
        let url = directory.appendingPathComponent(Self.chunkFilename(index))
        do {
            try data.write(to: url, options: .atomic)
            onChunk(VoicePCMChunk(index: index, url: url, byteCount: data.count))
        } catch {
            onWriteFailure(error)
        }
    }

    /// Run one `AVAudioConverter` pass over a single input buffer and return
    /// the raw interleaved Int16 bytes it produced. The converter instance is
    /// reused across calls (cached above), so a stateful resampler keeps its
    /// fractional phase across tap buffers rather than resetting it every
    /// ~1024 frames.
    private static func convert(_ buffer: AVAudioPCMBuffer, using converter: AVAudioConverter) -> Data? {
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let outputCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outputCapacity) else {
            return nil
        }
        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
            guard suppliedInput == false else {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, conversionError == nil else {
            return nil
        }
        guard let channelData = outputBuffer.int16ChannelData else {
            return nil
        }
        let frameLength = Int(outputBuffer.frameLength)
        guard frameLength > 0 else {
            return Data()
        }
        return Data(bytes: channelData[0], count: frameLength * bytesPerSample)
    }
}
