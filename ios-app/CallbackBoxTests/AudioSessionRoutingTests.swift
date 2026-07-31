import AVFoundation
import XCTest

@testable import CallbackBox

final class AudioSessionRoutingTests: XCTestCase {
    func testIdleUsesPlaybackSoOutputIsFullVolumeOverBluetooth() {
        let configuration = AudioSessionRouting.configuration(
            role: .idle,
            highQualityBluetoothAvailable: false
        )
        XCTAssertEqual(configuration.category, .playback)
        XCTAssertEqual(configuration.mode, .default)
        XCTAssertEqual(configuration.options, [.mixWithOthers])
    }

    func testIdleDoesNotDuckOthers() {
        // Ducking is only released on deactivation, and nothing deactivates the
        // idle session, so `.duckOthers` here would leave other apps quiet
        // indefinitely.
        let configuration = AudioSessionRouting.configuration(
            role: .idle,
            highQualityBluetoothAvailable: true
        )
        XCTAssertFalse(configuration.options.contains(.duckOthers))
    }

    func testRecordingAllowsBothBluetoothProfiles() {
        let configuration = AudioSessionRouting.configuration(
            role: .recording,
            highQualityBluetoothAvailable: false
        )
        XCTAssertEqual(configuration.category, .playAndRecord)
        XCTAssertEqual(
            configuration.options,
            [.duckOthers, .defaultToSpeaker, .allowBluetoothA2DP, .allowBluetoothHFP]
        )
    }

    func testRecordingNeverUsesAModeThatLowersOutputLevel() {
        // The regression anchor for the reported low volume: `.measurement`,
        // `.voiceChat`, and `.videoChat` all disable dynamics processing.
        let configuration = AudioSessionRouting.configuration(
            role: .recording,
            highQualityBluetoothAvailable: true
        )
        XCTAssertEqual(configuration.mode, .default)
    }

    func testRecordingKeepsDefaultToSpeakerSoEarconsAvoidTheEarpiece() {
        let configuration = AudioSessionRouting.configuration(
            role: .recording,
            highQualityBluetoothAvailable: false
        )
        XCTAssertTrue(configuration.options.contains(.defaultToSpeaker))
    }

    func testHighQualityBluetoothAddsExactlyOneOption() throws {
        guard #available(iOS 26.0, *) else {
            throw XCTSkip("Bluetooth high-quality recording requires iOS 26.")
        }
        let baseline = AudioSessionRouting.configuration(
            role: .recording,
            highQualityBluetoothAvailable: false
        )
        let enhanced = AudioSessionRouting.configuration(
            role: .recording,
            highQualityBluetoothAvailable: true
        )
        XCTAssertEqual(
            enhanced.options,
            baseline.options.union(.bluetoothHighQualityRecording)
        )
        XCTAssertEqual(enhanced.category, baseline.category)
        XCTAssertEqual(enhanced.mode, baseline.mode)
    }

    func testHighQualityBluetoothIsAvailableOnlyFromIOS26() {
        if #available(iOS 26.0, *) {
            XCTAssertTrue(AudioSessionRouting.systemHighQualityBluetoothAvailable)
        } else {
            XCTAssertFalse(AudioSessionRouting.systemHighQualityBluetoothAvailable)
        }
    }
}
