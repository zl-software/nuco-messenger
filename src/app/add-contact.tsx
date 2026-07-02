import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { Button, Card, Close, QrCard, Screen, SegmentedControl, Text, VerifiedShield } from '@/ui';
import { useSession } from '@/state/session';
import { addContactFromCard, buildContactCard, parseScannedCode } from '@/services/contacts';
import { type ContactCard } from '@nuco/protocol';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Mode = 'show' | 'scan';
type ScanError = 'invalid' | 'notNuco' | 'offline' | 'mismatch' | 'self' | null;

const SCAN_ERROR_COPY = {
  invalid: { tone: 'danger', title: 'addContact.invalidTitle', body: 'addContact.invalidBody', cta: 'addContact.tryAgain' },
  notNuco: { tone: 'warning', title: 'addContact.notNucoTitle', body: 'addContact.notNucoBody', cta: 'addContact.scanNuco' },
  offline: { tone: 'warning', title: 'addContact.offlineTitle', body: 'addContact.offlineBody', cta: 'addContact.tryAgain' },
  mismatch: { tone: 'danger', title: 'addContact.mismatchTitle', body: 'addContact.mismatchBody', cta: 'addContact.tryAgain' },
  self: { tone: 'warning', title: 'addContact.selfTitle', body: 'addContact.selfBody', cta: 'addContact.tryAgain' },
} as const;

export default function AddContactScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const account = useSession((s) => s.account);
  const lockStatus = useSession((s) => s.lockStatus);
  const { mode: initialMode } = useLocalSearchParams<{ mode?: Mode }>();
  const [mode, setMode] = useState<Mode>(initialMode === 'scan' ? 'scan' : 'show');

  // This root level route is reachable by deep link and can stay mounted through an auto-lock.
  // It reads and writes the encrypted database (scanning adds a contact), so gate it on unlock
  // like the tab screens rather than letting it query a closed database.
  if (lockStatus !== 'unlocked') return <Redirect href="/lock" />;

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <Close size={20} color={Colors.text} />
        </Pressable>
        <Text variant="title">{t('addContact.title')}</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.segment}>
        <SegmentedControl
          options={[
            { key: 'show', label: t('addContact.show') },
            { key: 'scan', label: t('addContact.scan') },
          ]}
          value={mode}
          onChange={(k) => setMode(k as Mode)}
        />
      </View>

      {mode === 'show' ? (
        <ShowCode card={account ? buildContactCard(account) : null} />
      ) : (
        <ScanCode
          onAdded={(id) => router.replace({ pathname: '/verify/[id]', params: { id, from: 'scan' } })}
          onShowInstead={() => setMode('show')}
        />
      )}
    </Screen>
  );
}

function ShowCode({ card }: { card: ContactCard | null }) {
  const { t } = useTranslation();
  if (!card) return null;
  return (
    <View style={styles.showWrap}>
      <QrCard value={JSON.stringify(card)} />
      <View style={styles.identity}>
        <Text variant="subtitle">{card.displayName}</Text>
        <VerifiedShield size={16} color={Colors.accent} />
      </View>
      <Text variant="monoCaption" color="textSecondary" style={styles.identitySub}>
        {'@' + card.handle + ' · ' + t('addContact.publicIdentityKey')}
      </Text>
      <Card tone="accent" style={styles.hint}>
        <Text variant="bodySecondary" color="text" style={styles.hintText}>
          {t('addContact.showHint')}
        </Text>
      </Card>
    </View>
  );
}

function ScanCode({ onAdded, onShowInstead }: { onAdded: (id: string) => void; onShowInstead: () => void }) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<ScanError>(null);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<'on' | 'off'>('on');
  const handlingRef = useRef(false);

  async function onBarcode(data: string) {
    if (handlingRef.current) return;
    handlingRef.current = true;
    setAdding(true);
    try {
      const parsed = parseScannedCode(data);
      if (parsed === 'notNuco') {
        setError('notNuco');
        return;
      }
      if (parsed === 'invalid') {
        setError('invalid');
        return;
      }
      const outcome = await addContactFromCard(parsed);
      if (outcome.kind === 'added') {
        onAdded(outcome.contact.id);
        return;
      }
      setError(outcome.kind);
    } catch {
      // Never leave the scan hanging silently (e.g. the relay is unreachable): surface an error.
      setError('invalid');
    } finally {
      setAdding(false);
    }
  }

  function resetScan() {
    setError(null);
    handlingRef.current = false;
  }

  // expo-camera exposes no focus point API, so tap to refocus by briefly dropping and re-arming
  // autofocus. This makes the lens re-acquire on the QR, which dense codes need to decode.
  function refocus() {
    setFocus('off');
    setTimeout(() => setFocus('on'), 120);
  }

  if (!permission) return <View style={styles.scanWrap} />;

  if (!permission.granted) {
    const denied = !permission.canAskAgain;
    return (
      <View style={styles.softAsk}>
        <Text variant="section" style={styles.softTitle}>
          {denied ? t('addContact.cameraDeniedTitle') : t('addContact.cameraSoftAskTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.softBody}>
          {denied ? t('addContact.cameraDeniedBody') : t('addContact.cameraSoftAskBody')}
        </Text>
        {denied ? (
          <Button label={t('addContact.showCodeInstead')} variant="secondary" onPress={onShowInstead} />
        ) : (
          <Button label={t('addContact.cameraAllow')} onPress={() => void requestPermission()} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.scanWrap}>
      <Pressable style={StyleSheet.absoluteFill} onPress={refocus}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus={focus}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onBarcode(data)}
        />
      </Pressable>
      {!error ? (
        <View style={styles.scanOverlay} pointerEvents="none">
          <View style={styles.reticle} />
          <Card style={styles.scanHint}>
            <Text variant="rowTitle" style={styles.scanHintTitle}>
              {t('addContact.scanHint')}
            </Text>
            <Text variant="caption" color="textSecondary" style={styles.scanHintCaption}>
              {t('addContact.scanCaption')}
            </Text>
          </Card>
        </View>
      ) : null}

      {adding && !error ? (
        <View style={styles.scanBusy} pointerEvents="none">
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorOverlay}>
          <Card tone={SCAN_ERROR_COPY[error].tone} style={styles.errorCard}>
            <Text variant="rowTitle" style={styles.errorTitle}>
              {t(SCAN_ERROR_COPY[error].title)}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.errorBody}>
              {t(SCAN_ERROR_COPY[error].body)}
            </Text>
            <Button label={t(SCAN_ERROR_COPY[error].cta)} variant="secondary" onPress={resetScan} />
          </Card>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segment: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.xl },
  showWrap: { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xl },
  identitySub: { marginTop: Spacing.xs },
  hint: { marginTop: Spacing.xl, alignSelf: 'stretch' },
  hintText: { textAlign: 'center' },
  scanWrap: {
    flex: 1,
    marginHorizontal: Spacing.xl,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: '#0b0d0e',
  },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 236,
    height: 236,
    borderRadius: Radius.reticle,
    borderWidth: 3,
    borderColor: Colors.accent,
  },
  scanBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  scanHint: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.xl, alignItems: 'center' },
  scanHintTitle: { textAlign: 'center' },
  scanHintCaption: { textAlign: 'center', marginTop: Spacing.xs },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    padding: Spacing.lg,
    // Dim the camera and hint behind the card so the message is legible (the card tone is a
    // translucent tint and read poorly over the live preview).
    backgroundColor: 'rgba(8,9,12,0.92)',
  },
  errorCard: { gap: Spacing.md },
  errorTitle: {},
  errorBody: {},
  softAsk: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxxl, gap: Spacing.md },
  softTitle: { textAlign: 'center' },
  softBody: { textAlign: 'center', marginBottom: Spacing.sm },
});
