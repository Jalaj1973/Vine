import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export interface TranscriptionDelta {
  session_id: string;
  speaker: string;
  text: string;
  timestamp_sec: number;
  formatted_time: string;
  is_final: boolean;
  audio_source?: string;
}

export class AudioStreamRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private speechRecognition: any = null;
  private isRecording: boolean = false;
  private startTime: number = 0;
  private sessionId: string = '';
  private unlistenDelta: UnlistenFn | null = null;

  async startRecording(
    sessionId: string, 
    selectedDeviceId: string,
    onTranscriptDelta: (delta: TranscriptionDelta) => void
  ): Promise<boolean> {
    this.stopRecording();

    try {
      this.sessionId = sessionId;
      this.startTime = Date.now();
      this.isRecording = true;

      console.log(`[AudioRecorder] Starting recording session ${sessionId} with mic: ${selectedDeviceId}`);

      // 1. Listen for Tauri IPC transcript-delta events
      if (window.__TAURI_INTERNALS__) {
        try {
          this.unlistenDelta = await listen<TranscriptionDelta>('transcript-delta', (event) => {
            if (event.payload && event.payload.text) {
              onTranscriptDelta(event.payload);
            }
          });

          await invoke('start_native_stt', { sessionId: this.sessionId });
        } catch (err) {
          console.warn('[AudioRecorder] Native STT launch notice:', err);
        }
      }

      // 2. Obtain chosen microphone stream
      try {
        const audioConstraints: MediaTrackConstraints = (selectedDeviceId && selectedDeviceId !== 'default')
          ? { deviceId: selectedDeviceId, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true };

        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (_) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      if (!this.mediaStream) {
        console.error('[AudioRecorder] MediaStream is null');
        return false;
      }

      // 3. AudioContext using native hardware sample rate
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const nativeSampleRate = this.audioContext.sampleRate;
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      let rawSamples: number[] = [];
      let lastSendTime = Date.now();

      this.processor.onaudioprocess = async (e) => {
        if (!this.isRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        rawSamples.push(...Array.from(inputData));

        const now = Date.now();
        if (now - lastSendTime >= 2500) {
          const elapsedSec = Math.floor((now - this.startTime) / 1000);
          const chunk = rawSamples.splice(0, rawSamples.length);
          lastSendTime = now;

          if (chunk.length > 0 && window.__TAURI_INTERNALS__) {
            try {
              const float32Samples = new Float32Array(chunk);
              const resampled16k = await this.resampleTo16kOffline(float32Samples, nativeSampleRate);
              
              // Invoke native Rust whisper-rs and render returned TranscriptionDelta directly
              const delta = await invoke<TranscriptionDelta>('process_audio_chunk', {
                sessionId: this.sessionId,
                samples: Array.from(resampled16k),
                elapsedSec,
                sourceType: 'mic',
              });

              if (delta && delta.text) {
                onTranscriptDelta(delta);
              }
            } catch (resampleErr) {
              // Silence empty speech errors
            }
          }
        }
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // 4. Web Speech API SpeechRecognition stream fallback
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';

          let lastEmittedText = '';

          rec.onresult = (event: any) => {
            if (!this.isRecording) return;

            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const text = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                final += text;
              } else {
                interim += text;
              }
            }

            const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
            const mins = Math.floor(elapsedSec / 60);
            const secs = elapsedSec % 60;
            const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

            const spokenText = (final || interim).trim();

            if (spokenText && spokenText !== lastEmittedText) {
              const isFinal = Boolean(final);
              if (isFinal) lastEmittedText = spokenText;

              onTranscriptDelta({
                session_id: this.sessionId,
                speaker: 'You (Microphone)',
                text: spokenText,
                timestamp_sec: elapsedSec,
                formatted_time: timeStr,
                is_final: isFinal,
                audio_source: 'mic',
              });

              if (isFinal && window.__TAURI_INTERNALS__) {
                invoke('add_transcript_entry', {
                  id: this.sessionId,
                  speaker: 'You (Microphone)',
                  text: spokenText,
                  timestampSec: elapsedSec,
                }).catch(err => console.warn('Save transcript error:', err));
              }
            }
          };

          rec.onerror = (e: any) => {
            console.warn('[SpeechRecognition] notice:', e.error);
            if (this.isRecording && e.error !== 'no-speech') {
              setTimeout(() => {
                if (this.isRecording) {
                  try { rec.start(); } catch (_) {}
                }
              }, 500);
            }
          };

          rec.onend = () => {
            if (this.isRecording) {
              try { rec.start(); } catch (_) {}
            }
          };

          rec.start();
          this.speechRecognition = rec;
        } catch (recErr) {
          console.warn('SpeechRecognition init error:', recErr);
        }
      }

      return true;
    } catch (err) {
      console.error('[AudioRecorder] Fatal error in startRecording:', err);
      return false;
    }
  }

  // Native WebAudio OfflineAudioContext sinc-interpolation resampling to 16000Hz
  private async resampleTo16kOffline(samples: Float32Array, inputSampleRate: number): Promise<Float32Array> {
    if (inputSampleRate === 16000 || samples.length === 0) {
      return samples;
    }

    const targetLength = Math.ceil(samples.length * 16000 / inputSampleRate);
    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
      1,
      targetLength,
      16000
    );

    const buffer = offlineCtx.createBuffer(1, samples.length, inputSampleRate);
    const channelData = buffer.getChannelData(0);
    channelData.set(samples);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
  }

  stopRecording(): void {
    this.isRecording = false;

    if (window.__TAURI_INTERNALS__) {
      invoke('stop_native_stt').catch(_ => {});
    }

    if (this.unlistenDelta) {
      this.unlistenDelta();
      this.unlistenDelta = null;
    }

    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.stop();
      } catch (_) {}
      this.speechRecognition = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (_) {}
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  getRecordingStatus(): boolean {
    return this.isRecording;
  }
}

export const globalAudioRecorder = new AudioStreamRecorder();
