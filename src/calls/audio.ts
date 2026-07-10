// The ONLY file that imports react-native-incall-manager. Owns the call audio session
// (audio focus, proximity sensor, earpiece default, speaker toggle) and the incoming ring
// (system ringtone plus a repeating haptic).
//
// With CallKit driving (iOS, the nuco-callkit module present) most of this yields to the
// system: CallKit plays the native ring and vibration, and it owns AVAudioSession
// activation (the native module hands the activated session to WebRTC via manual audio).
// Starting InCallManager there would fight the CallKit session and mute the call, so
// only the speaker route override remains active. The proximity screen off behavior is
// lost in CallKit mode for now; revisit with a dedicated proximity module if it stings.
//
// TODO seam: keeping the microphone alive while the app is backgrounded on Android needs a
// microphone foreground service (FOREGROUND_SERVICE_MICROPHONE), tracked together with the
// planned push foreground service work. Until then an Android call can lose the mic when
// the app leaves the foreground; iOS keeps it via the audio background mode.

import InCallManager from 'react-native-incall-manager';
import * as Haptics from 'expo-haptics';

import { getCallKit } from './callkit';
import type { CallAudio } from './types';

const RING_HAPTIC_INTERVAL_MS = 1200;

export function createNativeCallAudio(): CallAudio {
  let hapticTimer: ReturnType<typeof setInterval> | null = null;
  const callkitDriven = (): boolean => getCallKit().available;

  return {
    startIncomingRing(): void {
      if (callkitDriven()) return; // CallKit rings and vibrates natively
      InCallManager.startRingtone('_DEFAULT_', [1000, 2000], 'default', 30);
      if (!hapticTimer) {
        hapticTimer = setInterval(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
        }, RING_HAPTIC_INTERVAL_MS);
      }
    },

    stopIncomingRing(): void {
      InCallManager.stopRingtone();
      if (hapticTimer) {
        clearInterval(hapticTimer);
        hapticTimer = null;
      }
    },

    startCallAudio(): void {
      if (callkitDriven()) return; // CallKit owns the audio session
      // Audio focus, proximity screen off near the ear, earpiece routing by default.
      InCallManager.start({ media: 'audio' });
    },

    stopCallAudio(): void {
      if (callkitDriven()) {
        InCallManager.setSpeakerphoneOn(false);
        return;
      }
      InCallManager.stop();
      InCallManager.setSpeakerphoneOn(false);
    },

    setSpeaker(on: boolean): void {
      InCallManager.setSpeakerphoneOn(on);
    },
  };
}
