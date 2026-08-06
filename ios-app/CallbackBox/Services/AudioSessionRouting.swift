import AVFoundation

/// What the app is doing with audio right now.
///
/// `AVAudioSession` is process-global shared state, so the app keeps exactly
/// two configurations and one owner for them. Design and the AVFoundation
/// citations behind every option below:
/// `callback-box/docs/plans/ios-audio-session-routing.md`.
enum AudioSessionRole: String {
    /// Nothing is recording. Playback (earcons, voice memos, web audio) is the
    /// only client.
    case idle
    /// Dictation or native capture is running.
    case recording
}

struct AudioSessionConfiguration: Equatable {
    let category: AVAudioSession.Category
    let mode: AVAudioSession.Mode
    let options: AVAudioSession.CategoryOptions
}

enum AudioSessionRouting {
    /// Pure decision core. `highQualityBluetoothAvailable` is passed in rather
    /// than probed so the decision is testable on any simulator.
    static func configuration(
        role: AudioSessionRole,
        highQualityBluetoothAvailable: Bool
    ) -> AudioSessionConfiguration {
        switch role {
        case .idle:
            // `.playback` keeps full dynamics processing and has Bluetooth A2DP
            // implicitly available, so playback is full-volume over Bluetooth.
            // `.mixWithOthers` rather than `.duckOthers`: ducking is only
            // restored when the session deactivates, and nothing deactivates
            // the idle session — AVAudioPlayer and WKWebView activate it
            // implicitly and never release it.
            return AudioSessionConfiguration(
                category: .playback,
                mode: .default,
                options: [.mixWithOthers]
            )
        case .recording:
            // `.default`, never `.measurement`/`.voiceChat`/`.videoChat`: those
            // disable dynamics processing, which is what made output quiet.
            // `.default` is also the only mode that makes `.duckOthers` legal
            // and the only one compatible with high-quality Bluetooth recording.
            //
            // `.defaultToSpeaker` applies only when no other route is
            // connected, so it keeps dictation earcons off the earpiece on a
            // bare phone without overriding Bluetooth.
            //
            // `.allowBluetoothA2DP` restores the high-quality output route that
            // a record category otherwise removes; `.allowBluetoothHFP` (not
            // the deprecated `.allowBluetooth` spelling) allows the Bluetooth
            // microphone.
            var options: AVAudioSession.CategoryOptions = [
                .duckOthers,
                .defaultToSpeaker,
                .allowBluetoothA2DP,
                .allowBluetoothHFP,
            ]
            if highQualityBluetoothAvailable, #available(iOS 26.0, *) {
                // Full-bandwidth audio in both directions on routes that
                // support it (certain AirPods); HFP is the documented fallback
                // everywhere else.
                options.insert(.bluetoothHighQualityRecording)
            }
            return AudioSessionConfiguration(
                category: .playAndRecord,
                mode: .default,
                options: options
            )
        }
    }

    /// Whether this OS knows about high-quality Bluetooth recording at all.
    /// Whether the connected route supports it is decided by the system.
    static var systemHighQualityBluetoothAvailable: Bool {
        if #available(iOS 26.0, *) {
            return true
        }
        return false
    }
}

protocol AudioSessionControlling {
    /// Install the recording configuration and activate the session.
    func activateRecording() throws
    /// Deactivate, then leave the idle configuration installed for playback.
    func deactivate()
    /// Install the idle configuration without activating. Used at launch.
    func prepareIdle()
}

struct SystemAudioSession: AudioSessionControlling {
    func activateRecording() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try apply(role: .recording, to: session)
            // No `.notifyOthersOnDeactivation` here: it is "only valid on session
            // deactivation" (AVAudioSessionTypes.h:658-660). Both original call
            // sites passed it on activation.
            try session.setActive(true)
            BoxLog.info("audio session role=recording", category: .audio)
        } catch {
            BoxLog.error(
                "audio session activation failed: \(error.localizedDescription)",
                category: .audio
            )
            throw error
        }
    }

    func deactivate() {
        let session = AVAudioSession.sharedInstance()
        // Deactivate while the recording configuration is still installed, so
        // other apps un-duck, then install the idle configuration for the next
        // implicit activation by AVAudioPlayer or WKWebView. Callers must have
        // stopped their I/O first.
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            BoxLog.error(
                "audio session deactivation failed: \(error.localizedDescription)",
                category: .audio
            )
        }
        prepareIdle()
    }

    func prepareIdle() {
        do {
            try apply(role: .idle, to: AVAudioSession.sharedInstance())
            BoxLog.info("audio session role=idle", category: .audio)
        } catch {
            // Leaves the previous category installed, which after a recording
            // means quiet, speaker-bound playback — the defect this file
            // exists to prevent. Loud enough to find in a device log.
            BoxLog.error(
                "idle audio configuration failed: \(error.localizedDescription)",
                category: .audio
            )
        }
    }

    private func apply(role: AudioSessionRole, to session: AVAudioSession) throws {
        let configuration = AudioSessionRouting.configuration(
            role: role,
            highQualityBluetoothAvailable: AudioSessionRouting.systemHighQualityBluetoothAvailable
        )
        try session.setCategory(
            configuration.category,
            mode: configuration.mode,
            options: configuration.options
        )
    }
}
