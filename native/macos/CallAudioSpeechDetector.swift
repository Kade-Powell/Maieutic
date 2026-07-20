import Foundation

struct CallAudioSpeechDetector {
    struct Configuration {
        let absoluteSpeechThreshold: Float
        let minimumSpeechDuration: TimeInterval
        let settlingDuration: TimeInterval
        let echoMargin: Float
        let initialEchoGain: Float
        let minimumPlaybackLevel: Float
    }

    private let configuration: Configuration
    private let startedAt: TimeInterval
    private var candidateSpeechDuration = 0.0
    private var echoGain: Float

    init(voiceProcessing: Bool, startedAt: TimeInterval) {
        // Raw fallback input needs a longer calibration and a more conservative floor.
        configuration = voiceProcessing
            ? Configuration(
                absoluteSpeechThreshold: -36,
                minimumSpeechDuration: 0.30,
                settlingDuration: 0.70,
                echoMargin: 6,
                initialEchoGain: -28,
                minimumPlaybackLevel: -55
            )
            : Configuration(
                absoluteSpeechThreshold: -28,
                minimumSpeechDuration: 0.40,
                settlingDuration: 0.85,
                echoMargin: 6,
                initialEchoGain: -16,
                minimumPlaybackLevel: -55
            )
        self.startedAt = startedAt
        echoGain = configuration.initialEchoGain
    }

    mutating func observe(
        microphoneDecibels: Float,
        playbackDecibels: Float?,
        duration: TimeInterval,
        now: TimeInterval
    ) -> Bool {
        let activePlayback = playbackDecibels.flatMap {
            $0 > configuration.minimumPlaybackLevel ? $0 : nil
        }

        if now - startedAt < configuration.settlingDuration {
            candidateSpeechDuration = 0
            if let activePlayback {
                calibrateEcho(microphoneDecibels: microphoneDecibels, playbackDecibels: activePlayback)
            }
            return false
        }

        var threshold = configuration.absoluteSpeechThreshold
        if let activePlayback {
            threshold = max(threshold, activePlayback + echoGain + configuration.echoMargin)
        }

        if microphoneDecibels > threshold {
            candidateSpeechDuration += max(0, duration)
            return candidateSpeechDuration >= configuration.minimumSpeechDuration
        }

        candidateSpeechDuration = 0
        if let activePlayback {
            adaptEcho(microphoneDecibels: microphoneDecibels, playbackDecibels: activePlayback)
        }
        return false
    }

    private mutating func calibrateEcho(microphoneDecibels: Float, playbackDecibels: Float) {
        echoGain = max(echoGain, observedEchoGain(
            microphoneDecibels: microphoneDecibels,
            playbackDecibels: playbackDecibels
        ))
    }

    private mutating func adaptEcho(microphoneDecibels: Float, playbackDecibels: Float) {
        let observed = observedEchoGain(
            microphoneDecibels: microphoneDecibels,
            playbackDecibels: playbackDecibels
        )
        let adjustment: Float = observed > echoGain ? 0.20 : 0.01
        echoGain += (observed - echoGain) * adjustment
    }

    private func observedEchoGain(microphoneDecibels: Float, playbackDecibels: Float) -> Float {
        min(-6, max(-60, microphoneDecibels - playbackDecibels))
    }
}
