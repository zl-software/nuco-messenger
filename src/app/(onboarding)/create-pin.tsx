import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PinDots, PinKeypad, PIN_LENGTH, Pill, Screen, Text } from '@/ui';
import { setPin } from '@/services/onboarding';
import { Colors, Spacing } from '@/constants/theme';

type Phase = 'create' | 'confirm';

export default function CreatePinScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('create');
  const [firstPin, setFirstPin] = useState('');
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const committing = useRef(false);

  const runShake = useCallback(() => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shake]);

  const onDigit = useCallback((digit: string) => {
    setError(false);
    setEntry((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
  }, []);

  const onDelete = useCallback(() => {
    setError(false);
    setEntry((prev) => prev.slice(0, -1));
  }, []);

  const resetToCreate = useCallback(() => {
    setEntry('');
    setPhase('create');
    setFirstPin('');
  }, []);

  const finishSetup = useCallback(
    async (pin: string) => {
      try {
        await setPin(pin);
        router.push('/(onboarding)/complete');
      } catch {
        setBusy(false);
        setError(true);
        runShake();
        setTimeout(resetToCreate, 450);
      }
    },
    [router, runShake, resetToCreate],
  );

  const commit = useCallback(
    (pin: string) => {
      if (phase === 'create') {
        setFirstPin(pin);
        setTimeout(() => {
          setEntry('');
          setPhase('confirm');
        }, 140);
        return;
      }
      // confirm phase
      if (pin !== firstPin) {
        setError(true);
        runShake();
        setTimeout(resetToCreate, 450);
        return;
      }
      setBusy(true);
      // Wait two frames so the sixth dot and the spinner actually paint before scrypt blocks
      // the JS thread. An effect or microtask runs before the native paint, so deferring there
      // still freezes with the last dot empty. The spinner is a native view, so it keeps
      // animating through the derivation.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void finishSetup(pin);
        });
      });
    },
    [phase, firstPin, runShake, resetToCreate, finishSetup],
  );

  // Commit once the sixth digit lands. The ref guards against the effect re-firing while the
  // same full entry is still being processed.
  useEffect(() => {
    if (entry.length < PIN_LENGTH) {
      committing.current = false;
      return;
    }
    if (committing.current || busy) return;
    committing.current = true;
    commit(entry);
  }, [entry, busy, commit]);

  const title = phase === 'create' ? t('onboarding.createPinTitle') : t('onboarding.confirmPinTitle');
  const body = phase === 'create' ? t('onboarding.createPinBody') : t('onboarding.confirmPinBody');

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] });

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title" style={styles.title}>
          {title}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.body}>
          {body}
        </Text>
      </View>

      <View style={styles.middle}>
        <Animated.View style={{ transform: [{ translateX }] }}>
          <PinDots filled={entry.length} error={error} />
        </Animated.View>
        {busy ? (
          <ActivityIndicator color={Colors.accent} />
        ) : error ? (
          <View style={styles.errorPill}>
            <Pill label={t('onboarding.pinMismatch')} tone="danger" />
          </View>
        ) : null}
      </View>

      <View style={styles.keypad}>
        <PinKeypad onDigit={onDigit} onDelete={onDelete} showLetters={false} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  header: { paddingTop: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 300 },
  middle: { alignItems: 'center', gap: Spacing.lg },
  errorPill: { marginTop: Spacing.sm },
  keypad: { paddingBottom: Spacing.lg },
});
