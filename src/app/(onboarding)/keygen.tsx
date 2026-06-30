import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Card, NucoMark, Screen, Text, VerifiedShield } from '@/ui';
import { runKeyGeneration } from '@/services/onboarding';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

const STAGE_DURATION_MS = 1050;
const TOTAL_MS = STAGE_DURATION_MS * 3;

export default function KeygenScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [step, setStep] = useState(0);
  const [stagesDone, setStagesDone] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    runKeyGeneration()
      .then((res) => {
        if (active) setFingerprint(res.fingerprint);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), STAGE_DURATION_MS);
    const t2 = setTimeout(() => setStep(2), STAGE_DURATION_MS * 2);
    const t3 = setTimeout(() => setStagesDone(true), TOTAL_MS);
    Animated.timing(progress, {
      toValue: 1,
      duration: TOTAL_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [progress]);

  const done = stagesDone && fingerprint !== null;
  const stepLabels = [t('onboarding.keygenStep1'), t('onboarding.keygenStep2'), t('onboarding.keygenStep3')];

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.body}>
        <View style={styles.medallion}>
          {done ? (
            <View style={styles.successCircle}>
              <VerifiedShield size={40} color={Colors.accentInk} />
            </View>
          ) : (
            <View style={styles.spinnerWrap}>
              <NucoMark size={56} color={Colors.accent} />
            </View>
          )}
        </View>

        <Text variant="title" style={styles.title}>
          {done ? t('onboarding.keysReadyTitle') : t('onboarding.keygenTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.subtitle}>
          {done ? t('onboarding.keysReadyBody') : t('onboarding.keygenBody')}
        </Text>

        {done ? (
          <Card style={styles.fpCard}>
            <Text variant="eyebrow" color="textTertiary">
              {t('onboarding.keysReadyFingerprint')}
            </Text>
            <Text variant="mono" color="accent" style={styles.fpText}>
              {fingerprint}
            </Text>
          </Card>
        ) : (
          <View style={styles.progressBlock}>
            <View
              style={styles.track}
              onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
            >
              <Animated.View
                style={[
                  styles.fill,
                  { width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, trackWidth] }) },
                ]}
              />
            </View>
            <View style={styles.steps}>
              {stepLabels.map((label, i) => {
                const state = i < step ? 'done' : i === step ? 'active' : 'pending';
                return <Step key={i} label={label} state={state} />;
              })}
            </View>
          </View>
        )}
      </View>

      {done ? (
        <Button label={t('common.continue')} onPress={() => router.push('/(onboarding)/create-pin')} style={styles.cta} />
      ) : (
        <View style={styles.cta} />
      )}

      {error ? (
        <Text variant="caption" color="danger" style={styles.errorText}>
          {t('errors.generic')}
        </Text>
      ) : null}
    </Screen>
  );
}

function Step({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        {state === 'active' ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : state === 'done' ? (
          <VerifiedShield size={18} color={Colors.accent} />
        ) : (
          <View style={styles.pendingDot} />
        )}
      </View>
      <Text
        variant="bodySecondary"
        color={state === 'pending' ? 'textTertiary' : 'text'}
        style={styles.stepLabel}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg },
  medallion: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  spinnerWrap: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  successCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', marginTop: Spacing.sm },
  subtitle: { textAlign: 'center', maxWidth: 320 },
  fpCard: { alignSelf: 'stretch', marginTop: Spacing.lg, gap: Spacing.sm },
  fpText: { lineHeight: 22 },
  progressBlock: { alignSelf: 'stretch', marginTop: Spacing.lg, gap: Spacing.lg },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.surface2, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  steps: { gap: Spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: { width: 20, alignItems: 'center' },
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.surface2 },
  stepLabel: { flex: 1 },
  cta: { marginBottom: Spacing.lg },
  errorText: { textAlign: 'center', marginBottom: Spacing.lg },
});
