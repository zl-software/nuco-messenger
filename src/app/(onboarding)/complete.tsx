import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, NucoMark, Screen, SendArrow, Text } from '@/ui';
import { completeOnboarding } from '@/services/onboarding';
import { Colors, Spacing } from '@/constants/theme';

export default function CompleteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onOpen() {
    if (busy) return;
    setBusy(true);
    try {
      await completeOnboarding();
      router.replace('/(tabs)/chats');
    } catch {
      setBusy(false);
    }
  }

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.body}>
        <View style={styles.tile}>
          <NucoMark size={56} color={Colors.accentInk} />
        </View>
        <Text variant="title" style={styles.title}>
          {t('onboarding.completeTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.subtitle}>
          {t('onboarding.completeBody')}
        </Text>
      </View>

      <Button
        label={t('onboarding.completeCta')}
        onPress={onOpen}
        loading={busy}
        icon={<SendArrow size={18} color={Colors.accentInk} />}
        style={styles.cta}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  cta: { marginBottom: Spacing.lg },
});
