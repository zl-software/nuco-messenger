import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Card, NucoMark, Screen, Text, VerifiedShield } from '@/ui';
import { runKeyGeneration } from '@/services/onboarding';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

export default function KeygenScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [error, setError] = useState(false);

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

  const done = fingerprint !== null;

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
              <ActivityIndicator size="large" color={Colors.accent} />
              <View style={styles.markCenter}>
                <NucoMark size={36} color={Colors.accent} />
              </View>
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
            <Text variant="eyebrow" color="textTertiary" style={styles.fpEyebrow}>
              {t('onboarding.keysReadyFingerprint')}
            </Text>
            <Text variant="mono" color="accent">
              {fingerprint}
            </Text>
          </Card>
        ) : (
          <View style={styles.steps}>
            <Step label={t('onboarding.keygenStep1')} />
            <Step label={t('onboarding.keygenStep2')} />
            <Step label={t('onboarding.keygenStep3')} />
          </View>
        )}
      </View>

      {done ? (
        <Button
          label={t('common.continue')}
          onPress={() => router.push('/(onboarding)/create-pin')}
          style={styles.cta}
        />
      ) : (
        <View style={styles.cta} />
      )}

      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {t('errors.generic')}
        </Text>
      ) : null}
    </Screen>
  );
}

function Step({ label }: { label: string }) {
  return (
    <View style={styles.step}>
      <ActivityIndicator size="small" color={Colors.accent} />
      <Text variant="bodySecondary" color="textSecondary" style={styles.stepLabel}>
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
  markCenter: { position: 'absolute' },
  successCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center', marginTop: Spacing.sm },
  subtitle: { textAlign: 'center', maxWidth: 320 },
  fpCard: { alignSelf: 'stretch', marginTop: Spacing.lg, gap: Spacing.sm },
  fpEyebrow: {},
  steps: { alignSelf: 'stretch', marginTop: Spacing.lg, gap: Spacing.md },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface1,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Overlay.hairlineSoft,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  stepLabel: { flex: 1 },
  cta: { marginBottom: Spacing.lg },
  error: { textAlign: 'center', marginBottom: Spacing.lg },
});
