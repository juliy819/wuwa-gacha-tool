import { useSyncExternalStore } from 'react';
import { isUiSoundEnabled, setUiSoundEnabled, subscribeUiSound } from '../lib/uiFeedback';

export function useUiFeedback() {
  const enabled = useSyncExternalStore(subscribeUiSound, isUiSoundEnabled, () => true);
  return { enabled, setEnabled: setUiSoundEnabled };
}
