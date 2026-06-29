// Push: content free wakes only. A push is a signal to open the WebSocket, fetch queued
// ciphertext, decrypt locally, and post a LOCAL notification. No message content or cleartext
// sender ever travels through the push provider.
//
// iOS: the relay sends APNs directly. The app registers its raw APNs device token here.
// Android primary: UnifiedPush via a distributor (ntfy by default). The native registration
//   needs an Expo config plugin and a BroadcastReceiver; this module exposes the seam and
//   falls back to the foreground service path when no distributor is available.
// Android fallback / GrapheneOS: a foreground service holds the WebSocket and posts local
//   notifications itself. That is native config-plugin work tracked separately.
//
// Respect the lock: if the app is locked we never decrypt for a rich notification; we post
// the generic one.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { PushRegistration } from '@nuco/protocol';
import { getRelay } from '@/services/relay';
import { registerParamsFor, loadAccount } from '@/services/account';
import { isUnlocked } from '@/lock/lock-controller';
import { useSettings } from '@/state/settings';

const ANDROID_CHANNEL = 'messages';

// Local notifications are shown by the app, never opened by the system from remote content.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }
}

// Ask for notification permission and register the platform push route with the relay.
export async function registerPush(): Promise<void> {
  const settings = useSettings.getState();
  if (!settings.notificationsEnabled) return;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const account = await loadAccount();
  const relay = getRelay();
  if (!account || !relay) return;

  let push: PushRegistration = { kind: 'none' };
  if (Platform.OS === 'ios') {
    try {
      const token = await Notifications.getDevicePushTokenAsync();
      push = { kind: 'apns', token: String(token.data), apnsTopic: getBundleId() };
    } catch {
      push = { kind: 'none' };
    }
  } else if (Platform.OS === 'android') {
    // UnifiedPush registration returns an endpoint URL via the native receiver. Until that
    // native module is wired, Android relies on the foreground service WebSocket, registered
    // as kind 'none' (the relay will not send a wake; the live socket delivers).
    push = { kind: 'none' };
  }

  await relay.updateRegistration(registerParamsFor(account, push));
}

// Once a UnifiedPush distributor returns an endpoint, call this to route wakes to it.
export async function setUnifiedPushEndpoint(endpoint: string): Promise<void> {
  const account = await loadAccount();
  const relay = getRelay();
  if (!account || !relay) return;
  await relay.updateRegistration(registerParamsFor(account, { kind: 'unifiedpush', endpoint }));
}

// Post a local notification after a wake. Content is generic unless the user opted in to a
// sender name or preview AND the app is unlocked (so decryption is permitted).
export async function postWakeNotification(decrypted?: { sender?: string; preview?: string }): Promise<void> {
  const { showSender, showPreview } = useSettings.getState();
  const unlocked = isUnlocked();

  let title = 'New message';
  let body: string | undefined;
  if (unlocked && decrypted) {
    if (showSender && decrypted.sender) title = decrypted.sender;
    if (showPreview && decrypted.preview) body = decrypted.preview;
  }

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: null,
  });
}

function getBundleId(): string {
  // The iOS bundle id, used as the APNs topic. Kept in sync with app config.
  return 'com.zlsoftware.nuco';
}
