// Relay selection during onboarding. Runs BEFORE the app ever contacts a relay: the account
// registration and prekey publish happen only at the end of onboarding, against the server
// chosen here. Picking a custom relay up front means the default relay never learns this
// identity.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, SegmentedControl, Text, TextField } from '@/ui';
import { useSettings } from '@/state/settings';
import { healthUrlFor, resolveServerUrl } from '@/services/server';
import type { Prefs } from '@/services/prefs';
import { Colors, Spacing } from '@/constants/theme';

type ConnState = 'idle' | 'testing' | 'connected' | 'offline';

export default function RelayScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const settings = useSettings();
  const update = useSettings((s) => s.update);

  const [mode, setMode] = useState<Prefs['serverMode']>(settings.serverMode);
  const [address, setAddress] = useState(settings.customServer ?? '');
  const [conn, setConn] = useState<ConnState>('idle');

  const trimmed = address.trim();
  const canContinue = mode === 'default' || trimmed.length > 0;

  async function testConnection() {
    setConn('testing');
    const prefs: Prefs = { ...settings, serverMode: mode, customServer: trimmed || null };
    try {
      const res = await fetch(healthUrlFor(resolveServerUrl(prefs)));
      setConn(res.ok ? 'connected' : 'offline');
    } catch {
      setConn('offline');
    }
  }

  async function onContinue() {
    if (!canContinue) return;
    // Persisted before key generation and completion, so the first relay contact (register
    // plus prekey publish, fired by completeOnboarding) goes to the server chosen here. A
    // failed or skipped test does not block: the relay client retries in the background.
    await update({ serverMode: mode, customServer: mode === 'custom' ? trimmed : settings.customServer });
    router.push('/(onboarding)/keygen');
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.body}>
        <Text variant="title" style={styles.title}>
          {t('onboarding.relayTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.helper}>
          {t('onboarding.relayBody')}
        </Text>

        <Card>
          <SegmentedControl
            options={[
              { key: 'default', label: t('settings.serverDefault') },
              { key: 'custom', label: t('settings.serverCustom') },
            ]}
            value={mode}
            onChange={(key) => {
              setConn('idle');
              setMode(key as Prefs['serverMode']);
            }}
          />
          {mode === 'custom' ? (
            <View style={styles.serverBody}>
              <TextField
                mono
                placeholder={t('settings.serverAddress')}
                autoCapitalize="none"
                autoCorrect={false}
                value={address}
                onChangeText={(text) => {
                  setConn('idle');
                  setAddress(text);
                }}
              />
            </View>
          ) : null}
          <View style={styles.serverBody}>
            <Button
              label={t('settings.testConnection')}
              variant="secondary"
              loading={conn === 'testing'}
              onPress={() => void testConnection()}
            />
            {conn === 'connected' || conn === 'offline' ? (
              <View style={styles.connRow}>
                <View
                  style={[styles.dot, { backgroundColor: conn === 'connected' ? Colors.accent : Colors.danger }]}
                />
                <Text variant="caption" color={conn === 'connected' ? 'accent' : 'danger'}>
                  {conn === 'connected' ? t('settings.connected') : t('settings.offline')}
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        <Text variant="caption" color="textTertiary" style={styles.footnote}>
          {t('onboarding.relayFootnote')}
        </Text>
      </View>

      <Button label={t('common.continue')} onPress={() => void onContinue()} disabled={!canContinue} style={styles.cta} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  body: { flex: 1, paddingTop: Spacing.xxl },
  title: { marginBottom: Spacing.sm },
  helper: { marginBottom: Spacing.xl },
  serverBody: { marginTop: Spacing.lg, gap: Spacing.md },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footnote: { marginTop: Spacing.lg, textAlign: 'center' },
  cta: { marginBottom: Spacing.lg },
});
