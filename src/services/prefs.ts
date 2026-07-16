// Non sensitive app preferences that must be readable before unlock (language, server
// address, onboarding state). Stored in the keystore backed store without an auth
// requirement, so no sensitive data ever lands in plain AsyncStorage.

import * as SecureStore from 'expo-secure-store';

import type { LanguageSetting } from '@/i18n';

const PREFS_KEY = 'nuco.prefs';

export interface Prefs {
  onboardingComplete: boolean;
  tutorialSeen: boolean;
  language: LanguageSetting;
  serverMode: 'default' | 'custom';
  customServer: string | null;
  biometricEnabled: boolean;
  autoLockMs: number;
  requirePinAfterRestart: boolean;
  notificationsEnabled: boolean;
  // Masks the last message preview in the chats list (a neutral placeholder instead of
  // the text). Notifications are always content free, so this is an in app setting only.
  maskChatPreviews: boolean;
  distributor: string;
  // When the user agreed to the terms of use on the onboarding welcome screen (unix ms),
  // null before agreement. Onboarding cannot proceed without it.
  termsAcceptedAt: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  onboardingComplete: false,
  tutorialSeen: false,
  language: 'system',
  serverMode: 'default',
  customServer: null,
  biometricEnabled: false,
  autoLockMs: 60000,
  requirePinAfterRestart: true,
  // On by default: the push itself is content free, and the iOS permission prompt (asked
  // right after onboarding) remains the user's actual choice.
  notificationsEnabled: true,
  maskChatPreviews: true,
  distributor: 'https://ntfy.sh',
  termsAcceptedAt: null,
};

export async function loadPrefs(): Promise<Prefs> {
  const json = await SecureStore.getItemAsync(PREFS_KEY);
  if (!json) return { ...DEFAULT_PREFS };
  try {
    const stored = JSON.parse(json) as Partial<Prefs> & { showPreview?: boolean };
    // The retired showPreview pref inverted this setting's meaning; carry a stored
    // opt-in over so nobody's list previews flip back to masked.
    if (stored.maskChatPreviews === undefined && typeof stored.showPreview === 'boolean') {
      stored.maskChatPreviews = !stored.showPreview;
    }
    return { ...DEFAULT_PREFS, ...stored };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}
