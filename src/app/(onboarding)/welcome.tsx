import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';

import { Button, Check, NucoLockup, Screen, Text } from '@/ui';
import { useSettings } from '@/state/settings';
import { Colors, Overlay, Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // The terms gate: creating an account (later, on the keygen screen) is only reachable
  // after an explicit agreement here. The link opens the hosted terms in the browser.
  const [agreed, setAgreed] = useState(false);

  function onContinue() {
    void useSettings.getState().update({ termsAcceptedAt: Date.now() });
    router.push('/(onboarding)/name');
  }

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
        <Pressable style={styles.termsRow} onPress={() => setAgreed((v) => !v)} hitSlop={8}>
          <View style={[styles.checkbox, agreed ? styles.checkboxOn : null]}>
            {agreed ? <Check size={14} color={Colors.accentInk} /> : null}
          </View>
          <Text variant="bodySecondary" color="textSecondary" style={styles.termsText}>
            {t('onboarding.termsAgree')}{' '}
            <Text
              variant="bodySecondary"
              color="accent"
              onPress={() => void WebBrowser.openBrowserAsync(t('onboarding.termsUrl'))}
            >
              {t('onboarding.termsLink')}
            </Text>
          </Text>
        </Pressable>
        <Button label={t('onboarding.welcomeCta')} disabled={!agreed} onPress={onContinue} />
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
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Overlay.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  termsText: { flex: 1 },
});
