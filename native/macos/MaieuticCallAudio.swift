import AVFoundation
import Foundation

private let arguments = Array(CommandLine.arguments.dropFirst())
private let playbackPath = arguments.first ?? ""
private let capturePath = arguments.dropFirst().first ?? ""
private let useAcousticGuard = arguments.dropFirst(2).first == "--acoustic-guard"

private func emit(_ event: String, message: String? = nil) {
    var payload: [String: String] = ["event": event]
    if let message { payload["message"] = message }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8)?.appending("\n"),
          let bytes = line.data(using: .utf8) else {
        return
    }
    FileHandle.standardOutput.write(bytes)
    try? FileHandle.standardOutput.synchronize()
}

private final class CallAudioSession: @unchecked Sendable {
    private var audioEngine = AVAudioEngine()
    private var playerNode = AVAudioPlayerNode()
    private let lock = NSLock()
    private var captureFile: AVAudioFile?
    private var playbackFile: AVAudioFile?
    private var monitor: DispatchSourceTimer?
    private var startedAt = Date()
    private var playbackFinishedAt: Date?
    private var lastSpeechAt: Date?
    private var candidateSpeechDuration = 0.0
    private var preRoll: [AVAudioPCMBuffer] = []
    private var preRollFrames = 0
    private var interruptionEmitted = false
    private var tapInstalled = false
    private var speechThreshold: Float = -40
    private var stopping = false

    func start() {
        guard !playbackPath.isEmpty, !capturePath.isEmpty else {
            stop(event: "error", message: "Private playback and capture paths are required.")
            return
        }

        if useAcousticGuard {
            do {
                try configureAndStart(voiceProcessing: false)
            } catch {
                stop(event: "error", message: "Could not start call audio for the selected input and output devices: \(error.localizedDescription)")
                return
            }
            finishStart(mode: "acoustic-guard")
            return
        }

        do {
            try configureAndStart(voiceProcessing: true)
        } catch {
            guard (error as NSError).code == -10_875 else {
                stop(event: "error", message: "Could not start duplex call audio: \(error.localizedDescription)")
                return
            }
            stop(event: "retry", message: "acoustic-guard")
            return
        }

        finishStart(mode: "voice-processing")
    }

    private func finishStart(mode: String) {
        startedAt = Date()
        startMonitor()
        emit("started", message: mode)
    }

    private func configureAndStart(voiceProcessing: Bool) throws {
        let playback = try AVAudioFile(forReading: URL(fileURLWithPath: playbackPath))
        playbackFile = playback

        let input = audioEngine.inputNode
        _ = audioEngine.outputNode
        if voiceProcessing {
            try input.setVoiceProcessingEnabled(true)
        }
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            throw NSError(
                domain: "MaieuticCallAudio",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "The selected microphone format is unavailable."]
            )
        }
        captureFile = try AVAudioFile(
            forWriting: URL(fileURLWithPath: capturePath),
            settings: inputFormat.settings
        )
        speechThreshold = voiceProcessing ? -40 : -32

        audioEngine.attach(playerNode)
        audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: nil)
        input.installTap(onBus: 0, bufferSize: 1_024, format: nil) { [weak self] buffer, _ in
            self?.consume(buffer)
        }
        tapInstalled = true

        audioEngine.prepare()
        try audioEngine.start()
        playerNode.scheduleFile(playback, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.playbackDidFinish() }
        }
        playerNode.play()
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        var shouldInterrupt = false
        lock.lock()
        guard !stopping, let captureFile else {
            lock.unlock()
            return
        }

        let speechWasDetected = lastSpeechAt != nil
        if !speechWasDetected {
            retainPreRoll(buffer)
        }

        if let channels = buffer.floatChannelData {
            let samples = channels.pointee
            let count = Int(buffer.frameLength)
            var offset = 0
            while offset < count {
                let end = min(offset + 256, count)
                var squareSum: Float = 0
                for index in offset..<end {
                    let sample = samples[index]
                    squareSum += sample * sample
                }
                let rms = sqrt(squareSum / Float(end - offset))
                let decibels = 20 * log10(max(rms, 0.000_001))
                if decibels > speechThreshold {
                    if lastSpeechAt == nil {
                        candidateSpeechDuration += Double(end - offset) / buffer.format.sampleRate
                    }
                    if candidateSpeechDuration >= 0.18 || lastSpeechAt != nil {
                        if lastSpeechAt == nil { shouldInterrupt = true }
                        lastSpeechAt = Date()
                    }
                } else if lastSpeechAt == nil {
                    candidateSpeechDuration = 0
                }
                offset = end
            }
        }

        if speechWasDetected {
            try? captureFile.write(from: buffer)
        } else if lastSpeechAt != nil {
            for retained in preRoll {
                try? captureFile.write(from: retained)
            }
            preRoll.removeAll(keepingCapacity: false)
            preRollFrames = 0
        }
        lock.unlock()

        if shouldInterrupt {
            DispatchQueue.main.async { [weak self] in self?.interruptPlayback() }
        }
    }

    private func retainPreRoll(_ buffer: AVAudioPCMBuffer) {
        guard let copy = AVAudioPCMBuffer(
            pcmFormat: buffer.format,
            frameCapacity: buffer.frameLength
        ), let source = buffer.floatChannelData, let destination = copy.floatChannelData else {
            return
        }
        copy.frameLength = buffer.frameLength
        let byteCount = Int(buffer.frameLength) * MemoryLayout<Float>.size
        for channel in 0..<Int(buffer.format.channelCount) {
            memcpy(destination[channel], source[channel], byteCount)
        }
        preRoll.append(copy)
        preRollFrames += Int(copy.frameLength)

        let frameLimit = Int(buffer.format.sampleRate * 0.6)
        while preRollFrames > frameLimit, preRoll.count > 1 {
            preRollFrames -= Int(preRoll.removeFirst().frameLength)
        }
    }

    private func interruptPlayback() {
        lock.lock()
        guard !stopping, lastSpeechAt != nil, !interruptionEmitted else {
            lock.unlock()
            return
        }
        interruptionEmitted = true
        lock.unlock()

        playerNode.stop()
        emit("interrupted")
    }

    private func playbackDidFinish() {
        lock.lock()
        if playbackFinishedAt == nil { playbackFinishedAt = Date() }
        lock.unlock()
    }

    private func startMonitor() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.05)
        timer.setEventHandler { [weak self] in self?.checkForStop() }
        timer.resume()
        monitor = timer
    }

    private func checkForStop() {
        lock.lock()
        let startedAt = self.startedAt
        let playbackFinishedAt = self.playbackFinishedAt
        let lastSpeechAt = self.lastSpeechAt
        let isStopping = stopping
        lock.unlock()
        guard !isStopping else { return }

        let now = Date()
        if let lastSpeechAt, now.timeIntervalSince(lastSpeechAt) >= 1.1 {
            stop(event: "recorded")
        } else if let playbackFinishedAt,
                  lastSpeechAt == nil,
                  now.timeIntervalSince(playbackFinishedAt) >= 0.35 {
            stop(event: "played")
        } else if lastSpeechAt != nil, now.timeIntervalSince(startedAt) >= 60 {
            stop(event: "recorded")
        } else if now.timeIntervalSince(startedAt) >= 120 {
            stop(event: "error", message: "Call audio exceeded its safety limit.")
        }
    }

    private func stop(event: String, message: String? = nil) {
        lock.lock()
        guard !stopping else {
            lock.unlock()
            return
        }
        stopping = true
        lock.unlock()

        monitor?.cancel()
        playerNode.stop()
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        lock.lock()
        captureFile = nil
        playbackFile = nil
        preRoll.removeAll(keepingCapacity: false)
        preRollFrames = 0
        lock.unlock()

        emit(event, message: message)
        exit(event == "error" ? EXIT_FAILURE : EXIT_SUCCESS)
    }
}

private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: completion(true)
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async { completion(granted) }
        }
    default: completion(false)
    }
}

private var retainedSession: CallAudioSession?

guard !playbackPath.isEmpty, !capturePath.isEmpty else {
    emit("error", message: "Private playback and capture paths are required.")
    exit(EXIT_FAILURE)
}

requestMicrophonePermission { allowed in
    guard allowed else {
        emit("error", message: "Microphone permission was denied. Enable Visual Studio Code in System Settings > Privacy & Security > Microphone.")
        exit(EXIT_FAILURE)
    }
    let session = CallAudioSession()
    retainedSession = session
    session.start()
}

RunLoop.main.run()
