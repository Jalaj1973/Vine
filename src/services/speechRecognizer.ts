import { invoke } from '@tauri-apps/api/core';

export interface RealTimeSpeechDelta {
  sessionId: string;
  speaker: string;
  text: string;
  timestampSec: number;
  formattedTime: string;
  isFinal: boolean;
}

export class RealTimeSpeechEngine {
  private recognition: any = null;
  private mediaStream: MediaStream | null = null;
  private isListening: boolean = false;
  private startTime: number = 0;
  private sessionId: string = '';
  private onDeltaCallback: ((delta: RealTimeSpeechDelta) => void) | null = null;

  async startListening(
    sessionId: string,
    selectedDeviceId: string,
    onDelta: (delta: RealTimeSpeechDelta) => void
  ): Promise<boolean> {
    this.stopListening();

    try {
      this.sessionId = sessionId;
      this.startTime = Date.now();
      this.onDeltaCallback = onDelta;
      this.isListening = true;

      // 1. Activate selected microphone device stream directly
      const audioConstraints: MediaTrackConstraints = selectedDeviceId && selectedDeviceId !== 'default'
        ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (streamErr) {
        console.warn('Fallback to default microphone stream:', streamErr);
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // 2. Initialize Web Speech API / SpeechRecognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        console.warn('SpeechRecognition API not available in this window environment');
        return false;
      }

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      let lastEmittedText = '';

      rec.onresult = (event: any) => {
        if (!this.isListening) return;

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptChunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcriptChunk;
          } else {
            interimTranscript += transcriptChunk;
          }
        }

        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        const formattedTime = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        const spokenText = (finalTranscript || interimTranscript).trim();

        if (spokenText && spokenText !== lastEmittedText) {
          const isFinal = Boolean(finalTranscript);
          if (isFinal) {
            lastEmittedText = spokenText;
          }

          const delta: RealTimeSpeechDelta = {
            sessionId: this.sessionId,
            speaker: 'You (Microphone)',
            text: spokenText,
            timestampSec: elapsedSec,
            formattedTime,
            isFinal,
          };

          if (this.onDeltaCallback) {
            this.onDeltaCallback(delta);
          }

          if (isFinal && window.__TAURI_INTERNALS__) {
            invoke('add_transcript_entry', {
              id: this.sessionId,
              speaker: 'You (Microphone)',
              text: spokenText,
              timestampSec: elapsedSec,
            }).catch(err => console.warn('IPC transcript save notice:', err));
          }
        }
      };

      rec.onerror = (event: any) => {
        console.warn('SpeechRecognition notice:', event.error);
        if (event.error === 'no-speech') return;
        if (this.isListening && (event.error === 'network' || event.error === 'aborted')) {
          setTimeout(() => {
            if (this.isListening) {
              try { rec.start(); } catch (_) {}
            }
          }, 500);
        }
      };

      rec.onend = () => {
        if (this.isListening) {
          try {
            rec.start();
          } catch (_) {}
        }
      };

      rec.start();
      this.recognition = rec;
      return true;
    } catch (err) {
      console.error('Failed to start real-time speech engine:', err);
      return false;
    }
  }

  stopListening() {
    this.isListening = false;

    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch (_) {}
      this.recognition = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  getStatus(): boolean {
    return this.isListening;
  }
}

export const globalSpeechEngine = new RealTimeSpeechEngine();
