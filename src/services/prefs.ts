// Non sensitive app preferences that must be readable before unlock (language, server
// address, onboarding state). Stored in the keystore backed store without an auth
// requirement, so no sensitive data ever lands in plain AsyncStorage.

import * as SecureStore from 'expo-secure-store';

import type { LanguageSetting } from '@/i18n';

const PREFS_KEY = 'nuco.prefs';

export interface Prefs {
  onboardingComplete: boolean;
  language: LanguageSetting;
  serverMode: 'default' | 'custom';
  customServer: string | null;
  biometricEnabled: boolean;
  autoLockMs: number;
  requirePinAfterRestart: boolean;
  notificationsEnabled: boolean;
  showSender: boolean;
  showPreview: boolean;
  distributor: string;
}

export const DEFAULT_PREFS: Prefs = {
  onboardingComplete: false,
  language: 'system',
  serverMode: 'default',
  customServer: null,
  biometricEnabled: false,
  autoLockMs: 60000,
  requirePinAfterRestart: true,
  notificationsEnabled: false,
  showSender: false,
  showPreview: false,
  distributor: 'https://ntfy.sh',
};

export async function loadPrefs(): Promise<Prefs> {
  const json = await SecureStore.getItemAsync(PREFS_KEY);
  if (!json) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(json) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}
