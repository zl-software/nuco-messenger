// Push: content free, always. The relay sends a generic visible banner ("New message",
// localized on the device via Localizable.strings, see locales/). No message content or
// cleartext sender ever travels through the push provider, and the app never decrypts
// for a notification. Tapping the banner just opens the app; there is nothing in the
// payload to deep link on.
//
// iOS: the relay sends APNs directly. The app registers its raw APNs device token here.
// Android primary: UnifiedPush via a distributor (ntfy by default). The native registration
//   needs an Expo config plugin and a BroadcastReceiver; this module exposes the seam and
//   falls back to the foreground service path when no distributor is available.
// Android fallback / GrapheneOS: a foreground service holds the WebSocket and posts local
//   notifications itself. That is native config-plugin work tracked separately.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { PushRegistration } from '@nuco/protocol';
import { getRelay } from '@/services/relay';
import { registerParamsFor, loadAccount } from '@/services/account';
import { isUnlocked } from '@/lock/lock-controller';
import { useSettings } from '@/state/settings';

const ANDROID_CHANNEL = 'messages';

// Foreground presentation: while the app is unlocked with a live socket, the message is
// already arriving in the open UI, so a banner for the race (push sent while our socket
// was still closing at the relay) would only duplicate it. Locked or offline, show it.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const suppress = isUnlocked() && (getRelay()?.isConnected() ?? false);
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: false,
    };
  },
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

// Route pushes away from this device (the user turned notifications off): replace the
// stored registration with kind none so the relay stops sending banners entirely.
export async function unregisterPush(): Promise<void> {
  const account = await loadAccount();
  const relay = getRelay();
  if (!account || !relay) return;
  await relay.updateRegistration(registerParamsFor(account, { kind: 'none' }));
}

// Once a UnifiedPush distributor returns an endpoint, call this to route wakes to it.
export async function setUnifiedPushEndpoint(endpoint: string): Promise<void> {
  const account = await loadAccount();
  const relay = getRelay();
  if (!account || !relay) return;
  await relay.updateRegistration(registerParamsFor(account, { kind: 'unifiedpush', endpoint }));
}

function getBundleId(): string {
  // The iOS bundle id, used as the APNs topic. Kept in sync with app config.
  return 'com.zlsoftware.nuco';
}
