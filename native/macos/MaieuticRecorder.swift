import AVFoundation
import Foundation

private let arguments = Array(CommandLine.arguments.dropFirst())
private let eventsPath = arguments.first ?? ""
private let audioPath = arguments.dropFirst().first ?? ""
private let output: FileHandle = {
    guard !eventsPath.isEmpty, eventsPath != "-" else { return FileHandle.standardOutput }
    FileManager.default.createFile(atPath: eventsPath, contents: nil, attributes: [.posixPermissions: 0o600])
    return FileHandle(forWritingAtPath: eventsPath) ?? FileHandle.standardOutput
}()

private func emit(_ event: String, message: String? = nil) {
    var payload: [String: String] = ["event": event]
    if let message { payload["message"] = message }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8)?.appending("\n"),
          let bytes = line.data(using: .utf8) else {
        return
    }
    output.write(bytes)
    try? output.synchronize()
}

private final class RecordingSession: @unchecked Sendable {
    private let audioEngine = AVAudioEngine()
    private let lock = NSLock()
    private var audioFile: AVAudioFile?
    private var monitor: DispatchSourceTimer?
    private var startedAt = Date()
    private var lastSpeechAt: Date?
    private var candidateSpeechDuration = 0.0
    private var preRoll: [AVAudioPCMBuffer] = []
    private var preRollFrames = 0
    private var stopping = false

    func start() {
        guard !audioPath.isEmpty else {
            stop(success: false, message: "The private audio path is missing.")
            return
        }

        let input = audioEngine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            stop(success: false, message: "The selected microphone format is unavailable.")
            return
        }

        do {
            audioFile = try AVAudioFile(forWriting: URL(fileURLWithPath: audioPath), settings: inputFormat.settings)
        } catch {
            stop(success: false, message: "Could not create the private recording.")
            return
        }

        input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { [weak self] buffer, _ in
            self?.consume(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            stop(success: false, message: "Could not start microphone capture: \(error.localizedDescription)")
            return
        }

        startedAt = Date()
        startMonitor()
        emit("started")
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !stopping, let audioFile else { return }

        let speechWasDetected = lastSpeechAt != nil
        if !speechWasDetected {
            retainPreRoll(buffer)
        }

        if let samples = buffer.floatChannelData?.pointee {
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
                if decibels > -42 {
                    if lastSpeechAt == nil {
                        candidateSpeechDuration += Double(end - offset) / buffer.format.sampleRate
                    }
                    if candidateSpeechDuration >= 0.12 || lastSpeechAt != nil {
                        lastSpeechAt = Date()
                    }
                } else if lastSpeechAt == nil {
                    candidateSpeechDuration = 0
                }
                offset = end
            }
        }

        if speechWasDetected {
            try? audioFile.write(from: buffer)
        } else if lastSpeechAt != nil {
            for retained in preRoll {
                try? audioFile.write(from: retained)
            }
            preRoll.removeAll(keepingCapacity: false)
            preRollFrames = 0
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

        let frameLimit = Int(buffer.format.sampleRate * 0.75)
        while preRollFrames > frameLimit, preRoll.count > 1 {
            preRollFrames -= Int(preRoll.removeFirst().frameLength)
        }
    }

    private func startMonitor() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.2, repeating: 0.1)
        timer.setEventHandler { [weak self] in self?.checkForStop() }
        timer.resume()
        monitor = timer
    }

    private func checkForStop() {
        lock.lock()
        let startedAt = self.startedAt
        let lastSpeechAt = self.lastSpeechAt
        let isStopping = stopping
        lock.unlock()
        guard !isStopping else { return }

        let now = Date()
        if let lastSpeechAt, now.timeIntervalSince(lastSpeechAt) >= 1.25 {
            stop(success: true)
        } else if lastSpeechAt != nil, now.timeIntervalSince(startedAt) >= 60 {
            stop(success: true)
        }
    }

    private func stop(success: Bool, message: String? = nil) {
        lock.lock()
        guard !stopping else {
            lock.unlock()
            return
        }
        stopping = true
        lock.unlock()

        monitor?.cancel()
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        lock.lock()
        audioFile = nil
        preRoll.removeAll(keepingCapacity: false)
        preRollFrames = 0
        lock.unlock()

        if success {
            emit("recorded")
            exit(EXIT_SUCCESS)
        } else {
            emit("error", message: message ?? "Microphone recording failed.")
            exit(EXIT_FAILURE)
        }
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

private var retainedSession: RecordingSession?

requestMicrophonePermission { allowed in
    guard allowed else {
        emit("error", message: "Microphone permission was denied. Enable Visual Studio Code in System Settings > Privacy & Security > Microphone.")
        exit(EXIT_FAILURE)
    }
    let session = RecordingSession()
    retainedSession = session
    session.start()
}

RunLoop.main.run()
