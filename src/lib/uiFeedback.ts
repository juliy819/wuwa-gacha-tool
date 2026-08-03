export type UiFeedbackTone = 'scan-complete' | 'record-inserted' | 'data-rebuilt';

const STORAGE_KEY = 'wuwa-gacha-tool:ui-sound-enabled';
const CHANGE_EVENT = 'wuwa-ui-sound-change';
export const UI_RESONANCE_EVENT = 'wuwa-ui-resonance';

let audioContext: AudioContext | null = null;

export function isUiSoundEnabled() {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setUiSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(CHANGE_EVENT, { detail: enabled }));
}

export function subscribeUiSound(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

type ToneStep = {
  frequency: number;
  offset: number;
  duration: number;
  gain: number;
  endFrequency?: number;
};

const tonePatterns: Record<UiFeedbackTone, ToneStep[]> = {
  'scan-complete': [
    { frequency: 246.94, endFrequency: 329.63, offset: 0, duration: 0.18, gain: 0.025 },
    { frequency: 493.88, endFrequency: 659.25, offset: 0.08, duration: 0.22, gain: 0.018 },
  ],
  'record-inserted': [
    { frequency: 329.63, endFrequency: 440, offset: 0, duration: 0.16, gain: 0.022 },
    { frequency: 554.37, endFrequency: 659.25, offset: 0.07, duration: 0.2, gain: 0.02 },
    { frequency: 880, offset: 0.14, duration: 0.24, gain: 0.012 },
  ],
  'data-rebuilt': [
    { frequency: 196, endFrequency: 293.66, offset: 0, duration: 0.24, gain: 0.022 },
    { frequency: 392, endFrequency: 440, offset: 0.11, duration: 0.24, gain: 0.016 },
  ],
};

export async function playUiFeedback(tone: UiFeedbackTone) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UiFeedbackTone>(UI_RESONANCE_EVENT, { detail: tone }));
  if (!isUiSoundEnabled()) return;

  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;

  try {
    audioContext ??= new AudioContextConstructor();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    master.gain.setValueAtTime(0.9, now);
    master.connect(audioContext.destination);

    tonePatterns[tone].forEach((step) => {
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      const start = now + step.offset;
      const end = start + step.duration;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(step.frequency, start);
      if (step.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(step.endFrequency, end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(step.gain, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });
  } catch {
    // Audio feedback is optional and must never interrupt the primary action.
  }
}
