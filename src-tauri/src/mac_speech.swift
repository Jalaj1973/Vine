import Foundation
import AVFoundation
import Speech

@available(macOS 10.15, *)
class SwiftMacSpeechRecognizer {
    private let audioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var startTime = Date()

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    func start() {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            if authStatus == .authorized {
                self.beginAudioCapture()
            } else {
                // Fallback: begin audio capture directly via AVAudioEngine
                self.beginAudioCapture()
            }
        }
    }

    private func beginAudioCapture() {
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }

        recognitionRequest.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            self.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            return
        }

        startTime = Date()

        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { result, error in
            if let result = result {
                let spokenText = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                if !spokenText.isEmpty {
                    let elapsedSec = Int(Date().timeIntervalSince(self.startTime))
                    let mins = elapsedSec / 60
                    let secs = elapsedSec % 60
                    let timeStr = String(format: "%02d:%02d", mins, secs)

                    let escaped = spokenText.replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: " ")
                    let jsonLine = "{\"speaker\":\"You (Microphone)\",\"text\":\"\(escaped)\",\"timestamp_sec\":\(elapsedSec),\"formatted_time\":\"\(timeStr)\",\"is_final\":\(result.isFinal)}"
                    print(jsonLine)
                    fflush(stdout)
                }
            }

            if error != nil {
                // Restart task if error occurs
            }
        }
    }
}

if #available(macOS 10.15, *) {
    let recognizer = SwiftMacSpeechRecognizer()
    recognizer.start()
    
    let runLoop = RunLoop.current
    while runLoop.run(mode: .default, before: Date.distantFuture) {}
}
