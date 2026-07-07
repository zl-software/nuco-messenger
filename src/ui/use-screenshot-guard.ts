// Focus-scoped screenshot blocking for conversations that negotiated protection. This is
// the ONLY file allowed to import expo-screen-capture (a native module): never import it
// from services, db, crypto, transport, or calls/controller, which must stay importable on
// Node (the e2e harness, crypto:selftest, and calls:check run there). The negotiation
// itself lives in services/messaging.ts; this hook only enforces the agreed state.

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';

// One key per screen, not one shared key: the chat screen stays mounted and blurs under a
// pushed contact detail, and expo-screen-capture re-allows capture only once every key is
// released, so a shared key released by the blurring screen would strip the protection the
// focusing screen just acquired.
export type ScreenshotGuardKey = 'nuco-chat' | 'nuco-contact';

// Blocks system screenshots and screen recording (Android FLAG_SECURE, iOS 13+) while the
// owning screen is focused and `active` holds. The catch keeps an outdated dev client
// (binary without the module) rendering normally, just without enforcement.
export function useScreenshotGuard(active: boolean, key: ScreenshotGuardKey): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      ScreenCapture.preventScreenCaptureAsync(key).catch(() => undefined);
      return () => {
        ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
      };
    }, [active, key]),
  );
}
