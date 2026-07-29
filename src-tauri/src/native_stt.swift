import Foundation
import AVFoundation
import Speech

@available(macOS 10.15, *)
class NativeSpeechTranscriber {
    private let audioEngine = AVAudioEngine()
    private var speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var startTime = Date()

    func start() {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            guard authStatus == .authorized else {
                print("{\"error\": \"Speech recognition authorization denied\"}")
                fflush(stdout)
                exit(1)
            }
            self.startRecording()
        }
    }

    private func startRecording() {
        if recognitionTask != nil {
            recognitionTask?.cancel()
            recognitionTask = nil
        }

        let audioSession = AVAudioEngine()
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

        guard let recognitionRequest = recognitionRequest else {
            print("{\"error\": \"Unable to create recognition request\"}")
            fflush(stdout)
            return
        }

        recognitionRequest.shouldReportPartialResults = true
        if #available(macOS 13.0, *) {
            recognitionRequest.addsPunctuation = true
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, when in
            self.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            print("{\"error\": \"Audio engine failed to start: \(error.localizedDescription)\"}")
            fflush(stdout)
            return
        }

        startTime = Date()

        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { result, error in
            if let result = result {
                let spokenText = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                let elapsedSec = Int(Date().timeIntervalSince(self.startTime))
                let mins = elapsedSec / 60
                let secs = elapsedSec % 60
                let formattedTime = String(format: "%02d:%02d", mins, secs)

                let isFinal = result.isFinal
                
                // Escape string for valid JSON
                let escapedText = spokenText.replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: " ")

                let jsonOutput = "{\"speaker\": \"You (Microphone)\", \"text\": \"\(escapedText)\", \"timestamp_sec\": \(elapsedSec), \"formatted_time\": \"\(formattedTime)\", \"is_final\": \(isFinal)}"
                print(jsonOutput)
                fflush(stdout)
            }

            if error != nil || (result?.isFinal ?? false) {
                self.audioEngine.stop()
                inputNode.removeTap(onBus: 0)
                self.recognitionRequest = nil
                self.recognitionTask = nil
            }
        }
    }

    func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
    }
}

if #available(macOS 10.15, *) {
    let transcriber = NativeSpeechTranscriber()
    transcriber.start()

    // Keep process alive reading stdin
    let runLoop = RunLoop.current
    while runLoop.run(mode: .default, before: Date.distantFuture) {
        // Run indefinitely until terminated
    }
} else {
    print("{\"error\": \"macOS version not supported\"}")
}
