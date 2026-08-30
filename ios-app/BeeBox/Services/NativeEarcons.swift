import AVFAudio
import Foundation

struct NativeEarconResource: Equatable {
    var filename: String
    var volume: Float
}

enum NativeEarcon: CaseIterable, Equatable {
    case send
    case tick
    case stillListening
    case recordingStart
    case recordingStop
    case recordingError
    case recordingDropped

    var resource: NativeEarconResource {
        switch self {
        case .send:
            NativeEarconResource(filename: "beeprising.wav", volume: 0.3)
        case .tick:
            NativeEarconResource(filename: "tick2.wav", volume: 0.6)
        case .stillListening:
            NativeEarconResource(filename: "book-close.wav", volume: 0.3)
        case .recordingStart:
            NativeEarconResource(filename: "recording-start.mp3", volume: 0.7)
        case .recordingStop:
            NativeEarconResource(filename: "recording-stop.mp3", volume: 0.7)
        case .recordingError:
            NativeEarconResource(filename: "recording-error.wav", volume: 0.7)
        case .recordingDropped:
            NativeEarconResource(filename: "krell-alarm-7.wav", volume: 0.7)
        }
    }
}

enum NativeEarconCommand: Equatable {
    case play(NativeEarcon)
    case startWaitingTicks
    case stopWaitingTicks
    case restartStillListening
    case stopStillListening
}

enum NativeEarconEvent: Equatable {
    case microphoneRequested
    case microphoneStopped
    case recordingInterrupted
    case dictationStateChanged(VoiceCompositionState)
    case transcriptChanged(hasText: Bool)
    case voiceMessageSent(responseAlreadyActive: Bool)
    case responseActiveChanged(Bool)
    case cancelWaiting
}

struct NativeEarconState: Equatable {
    private var startCueArmed = false
    private var recording = false
    private var transcriptHasText = false
    private var waitingForResponse = false
    private var observedActiveResponse = false

    mutating func handle(_ event: NativeEarconEvent) -> [NativeEarconCommand] {
        switch event {
        case .microphoneRequested:
            startCueArmed = true
            return []
        case .microphoneStopped:
            startCueArmed = false
            recording = false
            return [.play(.recordingStop), .stopStillListening]
        case .recordingInterrupted:
            startCueArmed = false
            recording = false
            return [.play(.recordingDropped), .stopStillListening]
        case .dictationStateChanged(let state):
            return handleDictationState(state)
        case .transcriptChanged(let hasText):
            transcriptHasText = hasText
            return recording && hasText ? [.restartStillListening] : [.stopStillListening]
        case .voiceMessageSent(let responseAlreadyActive):
            waitingForResponse = true
            observedActiveResponse = responseAlreadyActive
            return [.play(.send), .startWaitingTicks]
        case .responseActiveChanged(let active):
            if active {
                observedActiveResponse = true
                return []
            }
            guard waitingForResponse, observedActiveResponse else {
                return []
            }
            waitingForResponse = false
            observedActiveResponse = false
            return [.stopWaitingTicks]
        case .cancelWaiting:
            waitingForResponse = false
            observedActiveResponse = false
            return [.stopWaitingTicks]
        }
    }

    private mutating func handleDictationState(
        _ state: VoiceCompositionState
    ) -> [NativeEarconCommand] {
        recording = state == .recording
        if recording {
            let startCommand: [NativeEarconCommand]
            if startCueArmed {
                startCueArmed = false
                startCommand = [.play(.recordingStart)]
            } else {
                startCommand = []
            }
            return transcriptHasText
                ? startCommand + [.restartStillListening]
                : startCommand
        }
        if case .requestingPermission = state {
            return []
        }
        let failureCommand: [NativeEarconCommand]
        if case .failed = state, startCueArmed {
            failureCommand = [.play(.recordingError)]
        } else {
            failureCommand = []
        }
        startCueArmed = false
        return failureCommand + [.stopStillListening]
    }
}

@MainActor
final class NativeEarconPlayer: NSObject {
    static let shared = NativeEarconPlayer()

    private var activePlayers: [AVAudioPlayer] = []
    private var waitingTickTimer: Timer?
    private var waitingTickStartedAt: Date?
    private var stillListeningTimer: Timer?

    func execute(_ commands: [NativeEarconCommand]) {
        for command in commands {
            switch command {
            case .play(let earcon):
                play(earcon)
            case .startWaitingTicks:
                startWaitingTicks()
            case .stopWaitingTicks:
                stopWaitingTicks()
            case .restartStillListening:
                restartStillListening()
            case .stopStillListening:
                stopStillListening()
            }
        }
    }

    func stopAllTimers() {
        stopWaitingTicks()
        stopStillListening()
    }

    private func play(_ earcon: NativeEarcon) {
        let resource = earcon.resource
        let file = resource.filename as NSString
        guard
            let url = Bundle.main.url(
                forResource: file.deletingPathExtension,
                withExtension: file.pathExtension
            ),
            let player = try? AVAudioPlayer(contentsOf: url)
        else {
            return
        }
        player.volume = resource.volume
        player.prepareToPlay()
        activePlayers.removeAll { $0.isPlaying == false }
        activePlayers.append(player)
        player.play()
    }

    private func startWaitingTicks() {
        stopWaitingTicks()
        waitingTickStartedAt = Date()
        play(.tick)
        waitingTickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) {
            [weak self] timer in
            Task { @MainActor in
                guard
                    let self,
                    let startedAt = self.waitingTickStartedAt,
                    Date().timeIntervalSince(startedAt) <= 30
                else {
                    timer.invalidate()
                    self?.waitingTickTimer = nil
                    self?.waitingTickStartedAt = nil
                    return
                }
                self.play(.tick)
            }
        }
    }

    private func stopWaitingTicks() {
        waitingTickTimer?.invalidate()
        waitingTickTimer = nil
        waitingTickStartedAt = nil
    }

    private func restartStillListening() {
        stopStillListening()
        stillListeningTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) {
            [weak self] _ in
            Task { @MainActor in
                self?.play(.stillListening)
            }
        }
    }

    private func stopStillListening() {
        stillListeningTimer?.invalidate()
        stillListeningTimer = nil
    }
}
