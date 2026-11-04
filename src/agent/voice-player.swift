import AVFoundation
import Foundation

// PCM arrives on stdin only; voice is never written to a recording file.
let engine = AVAudioEngine()
let player = AVAudioPlayerNode()
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
engine.attach(player)
engine.connect(player, to: engine.mainMixerNode, format: format)
let lock = NSLock()
var queuedFrames = 0

do {
    try engine.start()
    player.play()
    FileHandle.standardOutput.write(Data("READY\n".utf8))
    var remainder = Data()
    while let data = try FileHandle.standardInput.read(upToCount: 4096), !data.isEmpty {
        remainder.append(data)
        let frames = remainder.count / 2
        if frames == 0 { continue }
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
        buffer.frameLength = AVAudioFrameCount(frames)
        let samples = buffer.floatChannelData![0]
        for index in 0..<frames {
            let bits = UInt16(remainder[index * 2]) | (UInt16(remainder[index * 2 + 1]) << 8)
            samples[index] = Float(Int16(bitPattern: bits)) / 32768.0
        }
        remainder = Data(remainder.dropFirst(frames * 2))
        // Bound queued speech. Backpressure eventually propagates to the agent.
        while true {
            lock.lock()
            let room = queuedFrames < 12000
            lock.unlock()
            if room { break }
            Thread.sleep(forTimeInterval: 0.005)
        }
        lock.lock()
        queuedFrames += frames
        lock.unlock()
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in
            lock.lock()
            queuedFrames -= frames
            lock.unlock()
        }
    }
    // Allow the final short packet to finish; never drain an unbounded queue.
    let deadline = Date().addingTimeInterval(0.3)
    while Date() < deadline {
        lock.lock()
        let finished = queuedFrames == 0
        lock.unlock()
        if finished { break }
        Thread.sleep(forTimeInterval: 0.005)
    }
    player.stop()
    engine.stop()
} catch {
    FileHandle.standardError.write(Data("Voice output failed: \(error)\n".utf8))
    exit(1)
}
