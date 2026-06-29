import { useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PinDots, PinKeypad, PIN_LENGTH, Pill, Screen, Text } from '@/ui';
import { setPin } from '@/services/onboarding';
import { Spacing } from '@/constants/theme';

type Phase = 'create' | 'confirm';

export default function CreatePinScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('create');
  const [firstPin, setFirstPin] = useState('');
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  function runShake() {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  function onDigit(digit: string) {
    if (entry.length >= PIN_LENGTH) return;
    if (error) setError(false);
    const next = entry + digit;
    setEntry(next);
    if (next.length === PIN_LENGTH) {
      void commit(next);
    }
  }

  function onDelete() {
    if (error) setError(false);
    setEntry((prev) => prev.slice(0, -1));
  }

  async function commit(pin: string) {
    if (phase === 'create') {
      setFirstPin(pin);
      setTimeout(() => {
        setEntry('');
        setPhase('confirm');
      }, 120);
      return;
    }
    // confirm phase
    if (pin === firstPin) {
      await setPin(pin);
      router.push('/(onboarding)/complete');
    } else {
      setError(true);
      runShake();
      setTimeout(() => {
        setEntry('');
        setPhase('create');
        setFirstPin('');
      }, 450);
    }
  }

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
        {error ? (
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
