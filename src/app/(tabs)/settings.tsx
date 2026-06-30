// Settings screen: identity, security, server, app, notifications and the danger zone.
// Scrollable. Every setting writes through useSettings().update so it persists.

import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';
import {
  BottomSheet,
  Button,
  Card,
  ChevronRight,
  SegmentedControl,
  Text,
  TextField,
  Toggle,
} from '@/ui';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { formatFingerprint } from '@/services/onboarding';
import { healthUrlFor, resolveServerUrl } from '@/services/server';
import { reconnectRelay } from '@/services/boot';
import type { Prefs } from '@/services/prefs';
import type { LanguageSetting } from '@/i18n';
import { lock } from '@/lock/lock-controller';
import { wipeSecrets } from '@/crypto/secure-storage';

type ConnState = 'idle' | 'testing' | 'connected' | 'offline';

const AUTO_LOCK_OPTIONS = [
  { ms: 0, key: 'settings.autoLockImmediately' },
  { ms: 30000, key: 'settings.autoLock30s' },
  { ms: 60000, key: 'settings.autoLock1m' },
  { ms: 300000, key: 'settings.autoLock5m' },
] as const;

const LANGUAGE_OPTIONS: { key: LanguageSetting; label?: string }[] = [
  { key: 'system' },
  { key: 'en', label: 'English' },
  { key: 'de', label: 'Deutsch' },
];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const account = useSession((s) => s.account);
  const settings = useSettings();
  const update = useSettings((s) => s.update);

  const [conn, setConn] = useState<ConnState>('idle');
  const [autoLockSheet, setAutoLockSheet] = useState(false);

  const fingerprint = account ? formatFingerprint(account.identityKeyB64) : '';

  const currentAutoLock =
    AUTO_LOCK_OPTIONS.find((o) => o.ms === settings.autoLockMs) ?? AUTO_LOCK_OPTIONS[2];

  async function testConnection() {
    setConn('testing');
    const prefs: Prefs = settings;
    const url = healthUrlFor(resolveServerUrl(prefs));
    try {
      const res = await fetch(url);
      setConn(res.ok ? 'connected' : 'offline');
      // The health probe is just HTTP; point the live relay socket at this server too, so the
      // app actually talks to it (otherwise the socket keeps the URL it had at unlock).
      if (res.ok) void reconnectRelay();
    } catch {
      setConn('offline');
    }
  }

  function confirmWipe() {
    Alert.alert(
      t('settings.wipeConfirmTitle'),
      t('settings.wipeConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.wipeData'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await wipeSecrets();
              await lock();
            })();
          },
        },
      ],
      { cancelable: true },
    );
  }

  return (
    <>
    <View style={styles.root}>
      <View style={[styles.headerBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Text variant="display" color="text">
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      {/* IDENTITY */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.identity')}
      </Text>
      <Card>
        <NavRow label={t('settings.myQrCode')} onPress={() => router.push('/add-contact')} />
        <Divider />
        <View style={styles.rowStack}>
          <Text variant="rowTitle" color="text">
            {t('settings.keyFingerprint')}
          </Text>
          <Text variant="mono" color="textSecondary" style={styles.mono}>
            {fingerprint}
          </Text>
        </View>
      </Card>

      {/* SECURITY */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.security')}
      </Text>
      <Card>
        <ToggleRow
          label={t('settings.biometricUnlock')}
          value={settings.biometricEnabled}
          onChange={(v) => void update({ biometricEnabled: v })}
        />
        <Divider />
        <NavRow
          label={t('settings.autoLock')}
          value={t(currentAutoLock.key)}
          onPress={() => setAutoLockSheet(true)}
        />
        <Divider />
        <ToggleRow
          label={t('settings.requirePinAfterRestart')}
          value={settings.requirePinAfterRestart}
          onChange={(v) => void update({ requirePinAfterRestart: v })}
        />
      </Card>

      {/* SERVER */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.server')}
      </Text>
      <Card>
        <SegmentedControl
          options={[
            { key: 'default', label: t('settings.serverDefault') },
            { key: 'custom', label: t('settings.serverCustom') },
          ]}
          value={settings.serverMode}
          onChange={(key) => {
            setConn('idle');
            void (async () => {
              await update({ serverMode: key as Prefs['serverMode'] });
              await reconnectRelay();
            })();
          }}
        />
        {settings.serverMode === 'custom' ? (
          <View style={styles.serverBody}>
            <TextField
              mono
              placeholder={t('settings.serverAddress')}
              autoCapitalize="none"
              autoCorrect={false}
              value={settings.customServer ?? ''}
              onChangeText={(text) => {
                setConn('idle');
                void update({ customServer: text });
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
                style={[
                  styles.dot,
                  { backgroundColor: conn === 'connected' ? Colors.accent : Colors.danger },
                ]}
              />
              <Text variant="caption" color={conn === 'connected' ? 'accent' : 'danger'}>
                {conn === 'connected' ? t('settings.connected') : t('settings.offline')}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      {/* APP */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.app')}
      </Text>
      <Card>
        <View style={styles.row}>
          <Text variant="rowTitle" color="text">
            {t('settings.appearance')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('appearance.themeDark')}
          </Text>
        </View>
        <Divider />
        <View style={styles.rowStack}>
          <Text variant="rowTitle" color="text">
            {t('settings.language')}
          </Text>
          <View style={styles.langControl}>
            <SegmentedControl
              options={LANGUAGE_OPTIONS.map((opt) => ({
                key: opt.key,
                label: opt.label ?? t('settings.languageSystem'),
              }))}
              value={settings.language}
              onChange={(key) => void update({ language: key as LanguageSetting })}
            />
          </View>
        </View>
        <Divider />
        <View style={styles.rowStack}>
          <Text variant="rowTitle" color="text">
            {t('settings.about')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary">
            {t('about.privacyBody')}
          </Text>
        </View>
      </Card>

      {/* NOTIFICATIONS */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.notifications')}
      </Text>
      <Card>
        <ToggleRow
          label={t('settings.allowNotifications')}
          value={settings.notificationsEnabled}
          onChange={(v) => void update({ notificationsEnabled: v })}
        />
        <Divider />
        <ToggleRow
          label={t('settings.showSender')}
          detail={t('settings.showSenderDetail')}
          value={settings.showSender}
          onChange={(v) => void update({ showSender: v })}
        />
        <Divider />
        <ToggleRow
          label={t('settings.showPreview')}
          detail={t('settings.showPreviewDetail')}
          value={settings.showPreview}
          onChange={(v) => void update({ showPreview: v })}
        />
      </Card>

      {/* DANGER */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {t('settings.dangerZone')}
      </Text>
      <Card tone="danger">
        <Text variant="bodySecondary" color="textSecondary" style={styles.dangerDetail}>
          {t('settings.wipeDataDetail')}
        </Text>
        <Button
          label={t('settings.wipeData')}
          variant="destructive"
          onPress={confirmWipe}
        />
      </Card>
      </ScrollView>
    </View>

    <BottomSheet
      visible={autoLockSheet}
      title={t('settings.autoLock')}
      onClose={() => setAutoLockSheet(false)}
    >
      {AUTO_LOCK_OPTIONS.map((option) => {
        const selected = settings.autoLockMs === option.ms;
        return (
          <Pressable
            key={option.ms}
            style={({ pressed }) => [styles.sheetRow, pressed ? styles.rowPressed : null]}
            onPress={() => {
              void update({ autoLockMs: option.ms });
              setAutoLockSheet(false);
            }}
          >
            <Text variant="rowTitle" color={selected ? 'accent' : 'text'}>
              {t(option.key)}
            </Text>
            {selected ? <Text style={styles.sheetCheck}>{'✓'}</Text> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
    </>
  );
}

function NavRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text variant="rowTitle" color="text">
        {label}
      </Text>
      <View style={styles.navRight}>
        {value ? (
          <Text variant="body" color="textSecondary">
            {value}
          </Text>
        ) : null}
        <ChevronRight size={18} color={Colors.textTertiary} />
      </View>
    </Pressable>
  );
}

function ToggleRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text variant="rowTitle" color="text">
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color="textTertiary">
            {detail}
          </Text>
        ) : null}
      </View>
      <Toggle value={value} onChange={onChange} />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.huge,
  },
  headerBar: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    backgroundColor: Colors.background,
  },
  eyebrow: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  rowStack: {
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  rowLabel: {
    flex: 1,
    paddingRight: Spacing.md,
    gap: Spacing.xxs,
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  rowPressed: {
    opacity: 0.6,
  },
  mono: {
    marginTop: Spacing.xxs,
  },
  divider: {
    height: 1,
    backgroundColor: Overlay.hairline,
    marginVertical: Spacing.sm,
  },
  serverBody: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
  },
  langControl: {
    marginTop: Spacing.xs,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  sheetCheck: {
    color: Colors.accent,
    fontSize: 18,
  },
  dangerDetail: {
    marginBottom: Spacing.md,
  },
});
