import XCTest
@testable import BeeBox

final class OnDeviceHqTranscriberTests: XCTestCase {
    func testDiarizationRequestedSkipsBeforeTouchingTheModel() async {
        let missing = URL(fileURLWithPath: "/nonexistent/recording.wav")
        do {
            _ = try await OnDeviceHqTranscriber.transcribe(fileURL: missing, diarizationRequested: true)
            XCTFail("a diarized request must not run on the device")
        } catch let skip as OnDeviceHqTranscriber.Skip {
            XCTAssertEqual(skip, .diarizationRequested)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testTimeoutIsTwiceTheRecordingWithAThirtySecondFloor() {
        XCTAssertEqual(OnDeviceHqTranscriber.timeout(forAudioSeconds: 4), .seconds(30))
        XCTAssertEqual(OnDeviceHqTranscriber.timeout(forAudioSeconds: 90), .seconds(180))
    }

    func testSkipLabelsAreStableAndCarryNoMessageText() {
        XCTAssertEqual(OnDeviceHqTranscriber.Skip.assetsNotInstalled.logLabel, "assets-not-installed")
        XCTAssertEqual(OnDeviceHqTranscriber.Skip.failed("Speech.SpeechAnalyzerError").logLabel, "failed:Speech.SpeechAnalyzerError")
    }

    /// The on-device half of the HQ comparison. Opt-in: set
    /// `TEST_RUNNER_BBX_HQ_AUDIO_DIR` to a directory of `.wav` recordings and
    /// `TEST_RUNNER_BBX_HQ_RESULTS` to an output path. Writes one JSON object per
    /// recording with its transcript and wall time.
    func testMeasureOnDeviceTranscriptionOfAudioDirectory() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["BBX_HQ_AUDIO_DIR"], let output = environment["BBX_HQ_RESULTS"] else {
            throw XCTSkip("set TEST_RUNNER_BBX_HQ_AUDIO_DIR and TEST_RUNNER_BBX_HQ_RESULTS to measure")
        }
        let installStart = Date()
        let installed = await OnDeviceHqTranscriber.installAssets()
        let installSeconds = Date().timeIntervalSince(installStart)
        XCTAssertTrue(installed, "SpeechTranscriber assets could not be installed")
        let files = try FileManager.default.contentsOfDirectory(atPath: directory)
            .filter { $0.hasSuffix(".wav") }
            .sorted()
        var rows: [[String: Any]] = [["assetInstallSeconds": installSeconds]]
        for name in files {
            let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
            let start = Date()
            do {
                let result = try await OnDeviceHqTranscriber.transcribe(fileURL: url, diarizationRequested: false)
                rows.append([
                    "file": name,
                    "text": result.text,
                    "audioSeconds": result.audioSeconds,
                    "seconds": Date().timeIntervalSince(start),
                ])
            } catch {
                rows.append(["file": name, "error": "\(error)", "seconds": Date().timeIntervalSince(start)])
            }
        }
        let data = try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: output))
    }
}
