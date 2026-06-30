import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, NucoLockup, Screen, Text } from '@/ui';
import { Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.hero}>
        <NucoLockup size={64} />
        <Text variant="display" style={styles.title}>
          {t('onboarding.welcomeTitle')}
        </Text>
        <Text variant="body" color="textSecondary" style={styles.body}>
          {t('onboarding.welcomeBody')}
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label={t('onboarding.welcomeCta')} onPress={() => router.push('/(onboarding)/name')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  hero: { flex: 1, justifyContent: 'center', gap: Spacing.lg },
  title: { marginTop: Spacing.xxl },
  body: { maxWidth: 320 },
  footer: { gap: Spacing.lg, paddingBottom: Spacing.lg },
});
