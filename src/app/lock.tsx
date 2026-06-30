// The lock screen. Gates decryption: a successful biometric or PIN unlock releases the
// database key, then we bring the app online and route to the chats tab. Falls back to a
// six digit PIN keypad, and shows a timed lockout after too many failed attempts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NucoMark, PinDots, PinKeypad, PIN_LENGTH, Text, Button, FaceId } from '@/ui';
import { Screen } from '@/ui';
import { Colors, Spacing } from '@/constants/theme';
import { useSettings } from '@/state/settings';
import { biometricsAvailable } from '@/lock/biometrics';
import {
  unlockWithBiometrics,
  unlockWithPin,
  lockoutRemainingMs,
  failedAttemptsRemaining,
} from '@/lock/lock-controller';
import { bringOnline } from '@/services/boot';

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function LockScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const biometricEnabled = useSettings((s) => s.biometricEnabled);

  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockoutMs, setLockoutMs] = useState(lockoutRemainingMs());
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const triedBiometrics = useRef(false);

  const succeed = useCallback(() => {
    // The database is already open, so the chats tab can render local data immediately. Do not
    // wait on bringOnline (account load, relay connect); let it finish in the background.
    router.replace('/(tabs)/chats');
    void bringOnline();
  }, [router]);

  const tryBiometrics = useCallback(async () => {
    if (lockoutRemainingMs() > 0) return;
    setBusy(true);
    const ok = await unlockWithBiometrics(t('lock.biometricPrompt'));
    if (ok) {
      succeed();
      return;
    }
    setBusy(false);
  }, [succeed, t]);

  // Probe biometric availability and try an automatic unlock once on mount.
  useEffect(() => {
    let active = true;
    void (async () => {
      const available = await biometricsAvailable();
      if (!active) return;
      const usable = available && biometricEnabled;
      setCanUseBiometrics(usable);
      if (usable && !triedBiometrics.current) {
        triedBiometrics.current = true;
        await tryBiometrics();
      }
    })();
    return () => {
      active = false;
    };
  }, [biometricEnabled, tryBiometrics]);

  // Tick the lockout countdown while it is active.
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const id = setInterval(() => {
      const remaining = lockoutRemainingMs();
      setLockoutMs(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [lockoutMs]);

  const submitPin = useCallback(
    (value: string) => {
      setBusy(true);
      // Wait two frames so the sixth dot and the spinner paint before scrypt blocks the JS
      // thread. An effect or microtask runs before the native paint, so deferring there still
      // freezes with the last dot empty. The spinner is a native view and keeps animating.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void (async () => {
            const ok = await unlockWithPin(value);
            if (ok) {
              // Navigate straight away; keep the spinner up rather than flashing the keypad.
              succeed();
              return;
            }
            setBusy(false);
            setError(true);
            setPin('');
            setLockoutMs(lockoutRemainingMs());
          })();
        });
      });
    },
    [succeed],
  );

  const onDigit = useCallback(
    (digit: string) => {
      if (busy || lockoutRemainingMs() > 0) return;
      setError(false);
      setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
    },
    [busy],
  );

  // Submit once the sixth digit lands; submitPin defers the heavy work past the paint itself.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !busy) submitPin(pin);
  }, [pin, busy, submitPin]);

  const onDelete = useCallback(() => {
    setError(false);
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const lockedOut = lockoutMs > 0;
  const attemptsLeft = failedAttemptsRemaining();

  if (lockedOut) {
    return (
      <Screen glow contentStyle={styles.center}>
        <NucoMark size={48} />
        <View style={styles.head}>
          <Text variant="title" color="text" style={styles.title}>
            {t('lock.lockedTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary" style={styles.subtitle}>
            {t('lock.lockedBody')}
          </Text>
        </View>
        <Text variant="label" color="textSecondary">
          {t('lock.lockedTryAgainIn')}
        </Text>
        <Text variant="display" color="text" style={styles.countdown}>
          {formatRemaining(lockoutMs)}
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.footnote}>
          {t('lock.lockedDataSafe')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.top}>
        <NucoMark size={48} />
        <View style={styles.head}>
          <Text variant="title" color="text" style={styles.title}>
            {t('lock.pinTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary" style={styles.subtitle}>
            {t('lock.pinBody')}
          </Text>
        </View>
        <PinDots filled={pin.length} error={error} />
        <View style={styles.status}>
          {busy ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : error ? (
            <Text variant="caption" color="danger">
              {t('lock.attemptsLeft', { count: attemptsLeft })}
            </Text>
          ) : (
            <Text variant="caption" color="textTertiary">
              {' '}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.bottom}>
        <PinKeypad onDigit={onDigit} onDelete={onDelete} showLetters />
        {canUseBiometrics ? (
          <Button
            label={t('lock.useBiometrics')}
            variant="ghost"
            onPress={tryBiometrics}
            disabled={busy}
            icon={<FaceId size={20} color={Colors.accent} />}
            style={styles.bioBtn}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'space-between',
    paddingVertical: Spacing.xxl,
  },
  center: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  top: { alignItems: 'center', gap: Spacing.xl, marginTop: Spacing.xxl },
  head: { alignItems: 'center', gap: Spacing.sm },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  status: { minHeight: 22, alignItems: 'center', justifyContent: 'center' },
  countdown: { marginVertical: Spacing.sm },
  footnote: { textAlign: 'center', marginTop: Spacing.lg },
  bottom: { alignItems: 'center', gap: Spacing.lg },
  bioBtn: { alignSelf: 'center' },
});
