export interface MicDevice {
  deviceId: string;
  label: string;
}

export async function getMicrophoneDevices(): Promise<MicDevice[]> {
  try {
    // Request microphone permission first so labels are populated
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(track => track.stop());
    } catch (_) {}

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter(d => d.kind === 'audioinput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1} (${d.deviceId.slice(0, 5)})`
      }));

    if (audioInputs.length === 0) {
      return [{ deviceId: 'default', label: 'Default System Microphone' }];
    }

    return audioInputs;
  } catch (err) {
    console.warn('Error enumerating mic devices:', err);
    return [{ deviceId: 'default', label: 'Default System Microphone' }];
  }
}
