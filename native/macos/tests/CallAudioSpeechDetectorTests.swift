import Foundation

@main
private enum CallAudioSpeechDetectorTests {
    static func main() {
        ignoresEchoDuringVoiceProcessingWarmup()
        ignoresCalibratedPlaybackEcho()
        detectsSustainedLearnerSpeechAboveEcho()
        rejectsBriefNearEndNoise()
        detectsSpeechWhenPlaybackIsSilent()
        keepsFallbackDetectionConservative()
        detectsLoudLearnerSpeechInFallback()
        print("CallAudioSpeechDetector tests passed")
    }

    private static func ignoresEchoDuringVoiceProcessingWarmup() {
        var detector = CallAudioSpeechDetector(voiceProcessing: true, startedAt: 0)
        for step in 1...6 {
            expectFalse(detector.observe(
                microphoneDecibels: -27,
                playbackDecibels: -15,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "voice-processing warmup must reject playback echo")
        }
    }

    private static func ignoresCalibratedPlaybackEcho() {
        var detector = CallAudioSpeechDetector(voiceProcessing: true, startedAt: 0)
        calibrate(&detector, microphoneDecibels: -29, playbackDecibels: -16)
        for step in 8...15 {
            expectFalse(detector.observe(
                microphoneDecibels: -28,
                playbackDecibels: -16,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "sustained far-end speech must not become a learner interruption")
        }
    }

    private static func detectsSustainedLearnerSpeechAboveEcho() {
        var detector = CallAudioSpeechDetector(voiceProcessing: true, startedAt: 0)
        calibrate(&detector, microphoneDecibels: -31, playbackDecibels: -16)
        expectFalse(detector.observe(
            microphoneDecibels: -19,
            playbackDecibels: -16,
            duration: 0.1,
            now: 0.8
        ), "one near-end frame is not sustained speech")
        expectFalse(detector.observe(
            microphoneDecibels: -19,
            playbackDecibels: -16,
            duration: 0.1,
            now: 0.9
        ), "two near-end frames are not sustained speech")
        expectTrue(detector.observe(
            microphoneDecibels: -19,
            playbackDecibels: -16,
            duration: 0.1,
            now: 1.0
        ), "sustained learner speech must interrupt playback")
    }

    private static func rejectsBriefNearEndNoise() {
        var detector = CallAudioSpeechDetector(voiceProcessing: true, startedAt: 0)
        calibrate(&detector, microphoneDecibels: -32, playbackDecibels: -18)
        expectFalse(detector.observe(
            microphoneDecibels: -17,
            playbackDecibels: -18,
            duration: 0.1,
            now: 0.8
        ), "a brief near-end spike must not interrupt")
        expectFalse(detector.observe(
            microphoneDecibels: -40,
            playbackDecibels: -18,
            duration: 0.1,
            now: 0.9
        ), "silence must reset an interruption candidate")
        expectFalse(detector.observe(
            microphoneDecibels: -17,
            playbackDecibels: -18,
            duration: 0.1,
            now: 1.0
        ), "a reset candidate must start over")
    }

    private static func detectsSpeechWhenPlaybackIsSilent() {
        var detector = CallAudioSpeechDetector(voiceProcessing: true, startedAt: 0)
        for step in 8...9 {
            expectFalse(detector.observe(
                microphoneDecibels: -25,
                playbackDecibels: nil,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "speech still needs the minimum duration without playback")
        }
        expectTrue(detector.observe(
            microphoneDecibels: -25,
            playbackDecibels: nil,
            duration: 0.1,
            now: 1.0
        ), "speech during a playback pause must remain interruptible")
    }

    private static func keepsFallbackDetectionConservative() {
        var detector = CallAudioSpeechDetector(voiceProcessing: false, startedAt: 0)
        for step in 1...8 {
            expectFalse(detector.observe(
                microphoneDecibels: -25,
                playbackDecibels: -14,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "fallback warmup must calibrate loudspeaker leakage")
        }
        for step in 9...14 {
            expectFalse(detector.observe(
                microphoneDecibels: -24,
                playbackDecibels: -14,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "fallback playback leakage must not interrupt narration")
        }
    }

    private static func detectsLoudLearnerSpeechInFallback() {
        var detector = CallAudioSpeechDetector(voiceProcessing: false, startedAt: 0)
        for step in 1...8 {
            expectFalse(detector.observe(
                microphoneDecibels: -25,
                playbackDecibels: -14,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "fallback calibration must reject loudspeaker leakage")
        }
        for step in 9...11 {
            expectFalse(detector.observe(
                microphoneDecibels: -12,
                playbackDecibels: -14,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "fallback learner speech must still be sustained")
        }
        expectTrue(detector.observe(
            microphoneDecibels: -12,
            playbackDecibels: -14,
            duration: 0.1,
            now: 1.2
        ), "fallback must remain interruptible when near-end speech exceeds echo")
    }

    private static func calibrate(
        _ detector: inout CallAudioSpeechDetector,
        microphoneDecibels: Float,
        playbackDecibels: Float
    ) {
        for step in 1...7 {
            expectFalse(detector.observe(
                microphoneDecibels: microphoneDecibels,
                playbackDecibels: playbackDecibels,
                duration: 0.1,
                now: Double(step) * 0.1
            ), "calibration must not interrupt playback")
        }
    }

    private static func expectTrue(_ value: Bool, _ message: String) {
        if !value {
            fatalError(message)
        }
    }

    private static func expectFalse(_ value: Bool, _ message: String) {
        if value {
            fatalError(message)
        }
    }
}
