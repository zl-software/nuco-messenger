// Settings state, hydrated from and written through to the keystore backed prefs.

import { create } from 'zustand';

import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '@/services/prefs';
import { setLanguage } from '@/i18n';
import { setAutoLockMs } from '@/lock/lock-controller';

interface SettingsState extends Prefs {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<Prefs>) => Promise<void>;
}

function extractPrefs(state: SettingsState): Prefs {
  return {
    onboardingComplete: state.onboardingComplete,
    tutorialSeen: state.tutorialSeen,
    language: state.language,
    serverMode: state.serverMode,
    customServer: state.customServer,
    biometricEnabled: state.biometricEnabled,
    autoLockMs: state.autoLockMs,
    requirePinAfterRestart: state.requirePinAfterRestart,
    notificationsEnabled: state.notificationsEnabled,
    showSender: state.showSender,
    showPreview: state.showPreview,
    distributor: state.distributor,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_PREFS,
  hydrated: false,
  hydrate: async () => {
    const prefs = await loadPrefs();
    set({ ...prefs, hydrated: true });
    setLanguage(prefs.language);
    setAutoLockMs(prefs.autoLockMs);
  },
  update: async (patch) => {
    set(patch);
    const prefs = extractPrefs(get());
    if (patch.language !== undefined) setLanguage(prefs.language);
    if (patch.autoLockMs !== undefined) setAutoLockMs(prefs.autoLockMs);
    await savePrefs(prefs);
  },
}));
