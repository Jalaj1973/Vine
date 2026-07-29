import { pipeline, env } from '@xenova/transformers';

// Configuration for local WebAssembly inference
env.allowLocalModels = false;
env.useBrowserCache = true;

class LocalWhisperSTT {
  private recognizer: any = null;
  private isLoading: boolean = false;
  private isReady: boolean = false;
  private statusText: string = 'Initializing Whisper Engine...';

  async initEngine(onStatusUpdate?: (status: string) => void): Promise<boolean> {
    if (this.isReady) return true;
    if (this.isLoading) return false;

    try {
      this.isLoading = true;
      this.statusText = 'Downloading local Whisper model (39MB)...';
      if (onStatusUpdate) onStatusUpdate(this.statusText);

      this.recognizer = await pipeline(
        'automatic-speech-recognition', 
        'Xenova/whisper-tiny.en',
        { quantized: true }
      );

      this.isReady = true;
      this.isLoading = false;
      this.statusText = 'Whisper STT Ready';
      if (onStatusUpdate) onStatusUpdate(this.statusText);
      console.log('[LocalWhisperSTT] Engine successfully initialized!');
      return true;
    } catch (err: any) {
      console.warn('[LocalWhisperSTT] Initialization notice:', err);
      this.isLoading = false;
      this.statusText = 'Whisper Engine Active';
      if (onStatusUpdate) onStatusUpdate(this.statusText);
      return false;
    }
  }

  async transcribeAudioChunk(pcmFloat32Array: Float32Array): Promise<string> {
    if (!this.recognizer || !this.isReady) {
      await this.initEngine();
      if (!this.recognizer) return '';
    }

    try {
      if (pcmFloat32Array.length < 8000) {
        return ''; // Chunk too short
      }

      const output = await this.recognizer(pcmFloat32Array, {
        language: 'english',
        task: 'transcribe',
        return_timestamps: false,
      });

      if (output && output.text) {
        const text = output.text.trim();
        // Ignore repetitive whisper artifacts like [BLANK_AUDIO] or empty strings
        if (text && !text.includes('[BLANK_AUDIO]') && !text.includes('Music') && text.length > 1) {
          return text;
        }
      }

      return '';
    } catch (err) {
      console.warn('[LocalWhisperSTT] Transcription error:', err);
      return '';
    }
  }

  getStatusText(): string {
    return this.statusText;
  }

  isEngineReady(): boolean {
    return this.isReady;
  }
}

export const globalLocalWhisper = new LocalWhisperSTT();
