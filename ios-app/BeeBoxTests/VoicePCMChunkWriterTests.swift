import AVFAudio
import XCTest
@testable import BeeBox

final class VoicePCMChunkWriterTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    /// Feeding buffers already in the target format (16 kHz mono Int16) takes
    /// the writer's identity shortcut, so the byte accounting must be exact —
    /// no `AVAudioConverter` rounding to allow for.
    func testProducesExactByteCountChunksFromNativeFormatAcrossManyBuffers() {
        let recorder = ChunkRecorder()
        let writer = VoicePCMChunkWriter(directory: directory, onChunk: { recorder.record($0) })
        let nativeFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: VoicePCMChunkWriter.targetSampleRate,
            channels: 1,
            interleaved: true
        )!
        let totalFrames = (VoicePCMChunkWriter.chunkByteCount / VoicePCMChunkWriter.bytesPerSample) * 3
        feedInt16Buffers(to: writer, format: nativeFormat, totalFrames: totalFrames, bufferSize: 1024)
        writer.finish()

        let chunks = recorder.chunks
        XCTAssertEqual(chunks.count, 3)
        for (index, chunk) in chunks.enumerated() {
            XCTAssertEqual(chunk.index, index + 1)
            XCTAssertEqual(chunk.byteCount, VoicePCMChunkWriter.chunkByteCount)
            XCTAssertEqual(chunk.url.lastPathComponent, VoicePCMChunkWriter.chunkFilename(index + 1))
            XCTAssertEqual(try Data(contentsOf: chunk.url).count, VoicePCMChunkWriter.chunkByteCount)
        }
        XCTAssertEqual(writer.chunksWritten, 3)
    }

    func testFlushesFinalPartialChunkOnFinish() {
        let recorder = ChunkRecorder()
        let writer = VoicePCMChunkWriter(directory: directory, onChunk: { recorder.record($0) })
        let nativeFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: VoicePCMChunkWriter.targetSampleRate,
            channels: 1,
            interleaved: true
        )!
        let halfChunkFrames = (VoicePCMChunkWriter.chunkByteCount / VoicePCMChunkWriter.bytesPerSample) / 2
        feedInt16Buffers(to: writer, format: nativeFormat, totalFrames: halfChunkFrames, bufferSize: 1024)

        XCTAssertTrue(recorder.chunks.isEmpty, "nothing should flush before finish()")
        writer.finish()

        XCTAssertEqual(recorder.chunks.count, 1)
        let chunk = try! XCTUnwrap(recorder.chunks.first)
        XCTAssertEqual(chunk.byteCount, halfChunkFrames * VoicePCMChunkWriter.bytesPerSample)
        XCTAssertGreaterThan(chunk.byteCount, 0)
        XCTAssertLessThan(chunk.byteCount, VoicePCMChunkWriter.chunkByteCount)

        // Idempotent: a second finish() (an interruption racing an explicit
        // stop) must not produce a second, empty chunk.
        writer.finish()
        XCTAssertEqual(recorder.chunks.count, 1)
    }

    func testResamplesFrom48kHzMonoFloat32() {
        assertResampling(sourceSampleRate: 48_000, seconds: 3)
    }

    func testResamplesFrom44100HzMonoFloat32() {
        assertResampling(sourceSampleRate: 44_100, seconds: 3)
    }

    private func assertResampling(sourceSampleRate: Double, seconds: Double) {
        let recorder = ChunkRecorder()
        let writer = VoicePCMChunkWriter(directory: directory, onChunk: { recorder.record($0) })
        guard let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: sourceSampleRate, channels: 1) else {
            return XCTFail("could not build a standard source format")
        }
        let totalSourceFrames = Int(sourceSampleRate * seconds)
        feedFloatBuffers(to: writer, format: sourceFormat, totalFrames: totalSourceFrames, bufferSize: 1024)
        writer.finish()

        let totalBytes = recorder.chunks.reduce(0) { $0 + $1.byteCount }
        let expectedBytes = Int(VoicePCMChunkWriter.targetSampleRate * seconds) * VoicePCMChunkWriter.bytesPerSample
        // Resampling filter latency and per-buffer rounding can shift the
        // total by a small amount; this is checking "roughly the right
        // duration came out", not sample-exact accounting (the native-format
        // test above covers the exact-byte-count guarantee).
        XCTAssertEqual(Double(totalBytes), Double(expectedBytes), accuracy: Double(expectedBytes) * 0.05)
        // Every chunk but (optionally) the last must be exactly full-size.
        for chunk in recorder.chunks.dropLast() {
            XCTAssertEqual(chunk.byteCount, VoicePCMChunkWriter.chunkByteCount)
        }
    }

    // MARK: - Buffer helpers

    private func feedInt16Buffers(
        to writer: VoicePCMChunkWriter,
        format: AVAudioFormat,
        totalFrames: Int,
        bufferSize: Int
    ) {
        var remaining = totalFrames
        while remaining > 0 {
            let frames = min(bufferSize, remaining)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else {
                return XCTFail("could not allocate a buffer")
            }
            buffer.frameLength = AVAudioFrameCount(frames)
            if let data = buffer.int16ChannelData {
                for frame in 0..<frames {
                    data[0][frame] = Int16(truncatingIfNeeded: frame)
                }
            }
            writer.append(buffer)
            remaining -= frames
        }
    }

    private func feedFloatBuffers(
        to writer: VoicePCMChunkWriter,
        format: AVAudioFormat,
        totalFrames: Int,
        bufferSize: Int
    ) {
        var remaining = totalFrames
        var phase = 0
        while remaining > 0 {
            let frames = min(bufferSize, remaining)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else {
                return XCTFail("could not allocate a buffer")
            }
            buffer.frameLength = AVAudioFrameCount(frames)
            if let data = buffer.floatChannelData {
                for frame in 0..<frames {
                    data[0][frame] = Float(sin(Double(phase + frame) * 0.05)) * 0.2
                }
            }
            writer.append(buffer)
            remaining -= frames
            phase += frames
        }
    }
}

private final class ChunkRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [VoicePCMChunk] = []

    var chunks: [VoicePCMChunk] {
        lock.withLock { storage }
    }

    func record(_ chunk: VoicePCMChunk) {
        lock.withLock { storage.append(chunk) }
    }
}
