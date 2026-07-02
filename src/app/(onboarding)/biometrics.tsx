// Offered right after the PIN is confirmed: enable Face ID / Touch ID / fingerprint unlock.
// The biometric gated copy of the database key was already sealed during keygen
// (provisionDatabaseKey), so enabling is just flipping the pref after the OS prompt confirms
// the device can authenticate. Devices without enrolled biometrics skip straight to complete.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, FaceId, Screen, Text } from '@/ui';
import { biometricsAvailable, promptBiometrics } from '@/lock/biometrics';
import { useSettings } from '@/state/settings';
import { Colors, Spacing } from '@/constants/theme';

type Phase = 'checking' | 'offer';

export default function BiometricsScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('checking');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);

  // Skip the step entirely when the device has no enrolled biometrics: showing a toggle that
  // can never work would just confuse. The PIN remains the unlock path.
  useEffect(() => {
    active.current = true;
    void (async () => {
      const available = await biometricsAvailable();
      if (!active.current) return;
      if (available) setPhase('offer');
      else router.replace('/(onboarding)/complete');
    })();
    return () => {
      active.current = false;
    };
  }, [router]);

  async function onEnable() {
    if (busy) return;
    setBusy(true);
    // The prompt both confirms the hardware works and surfaces the OS permission dialog at a
    // natural moment. A cancel is not an error: the PIN still unlocks, so we let the user go on.
    const ok = await promptBiometrics(t('lock.biometricPrompt'), t('common.cancel'));
    if (!active.current) return;
    if (ok) {
      await useSettings.getState().update({ biometricEnabled: true });
      router.push('/(onboarding)/complete');
      return;
    }
    setBusy(false);
  }

  function onSkip() {
    if (busy) return;
    router.push('/(onboarding)/complete');
  }

  if (phase === 'checking') {
    return (
      <Screen glow contentStyle={styles.center}>
        <ActivityIndicator color={Colors.accent} />
      </Screen>
    );
  }

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.body}>
        <View style={styles.tile}>
          <FaceId size={48} color={Colors.accentInk} />
        </View>
        <Text variant="title" style={styles.title}>
          {t('onboarding.biometricsTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.subtitle}>
          {t('onboarding.biometricsBody')}
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.fallback}>
          {t('onboarding.biometricsFallback')}
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          label={t('onboarding.biometricsEnable')}
          onPress={onEnable}
          loading={busy}
          icon={<FaceId size={18} color={Colors.accentInk} />}
        />
        <Button label={t('common.notNow')} variant="ghost" onPress={onSkip} disabled={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg },
  tile: {
    width: 120,
    height: 120,
    borderRadius: 32,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center', marginTop: Spacing.sm },
  subtitle: { textAlign: 'center', maxWidth: 320 },
  fallback: { textAlign: 'center', marginTop: Spacing.sm },
  footer: { gap: Spacing.sm, paddingBottom: Spacing.lg },
});
