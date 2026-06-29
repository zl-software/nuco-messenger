import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';

import { Button, Card, Screen, SegmentedControl, Text, VerifiedShield } from '@/ui';
import { useSession } from '@/state/session';
import { addContactFromCard, parseScannedCode } from '@/services/contacts';
import { formatFingerprint } from '@/services/onboarding';
import { CONTACT_CARD_VERSION, type ContactCard } from '@nuco/protocol';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

type Mode = 'show' | 'scan';
type ScanError = 'invalid' | 'notNuco' | null;

export default function AddContactScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const account = useSession((s) => s.account);
  const [mode, setMode] = useState<Mode>('show');

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.close}>{'✕'}</Text>
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
        <ShowCode card={account ? buildCard(account) : null} />
      ) : (
        <ScanCode
          onAdded={(id) => router.push({ pathname: '/verify/[id]', params: { id } })}
          onShowInstead={() => setMode('show')}
        />
      )}
    </Screen>
  );
}

function buildCard(account: NonNullable<ReturnType<typeof useSession.getState>['account']>): ContactCard {
  return {
    v: CONTACT_CARD_VERSION,
    handle: account.handle,
    identityKey: account.identityKeyB64,
    fingerprint: formatFingerprint(account.identityKeyB64),
    displayName: account.displayName,
  };
}

function ShowCode({ card }: { card: ContactCard | null }) {
  const { t } = useTranslation();
  if (!card) return null;
  return (
    <View style={styles.showWrap}>
      <View style={styles.qrCard}>
        <QRCode value={JSON.stringify(card)} size={220} backgroundColor="#F2F4F7" color="#0A0B0E" />
      </View>
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
  const handlingRef = useRef(false);

  async function onBarcode(data: string) {
    if (handlingRef.current) return;
    handlingRef.current = true;
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
    setError(outcome.kind === 'notNuco' ? 'notNuco' : 'invalid');
  }

  function resetScan() {
    setError(null);
    handlingRef.current = false;
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
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onBarcode(data)}
      />
      <View style={styles.scanOverlay} pointerEvents="box-none">
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

      {error ? (
        <View style={styles.errorOverlay}>
          <Card tone={error === 'notNuco' ? 'warning' : 'danger'} style={styles.errorCard}>
            <Text variant="rowTitle" style={styles.errorTitle}>
              {error === 'notNuco' ? t('addContact.notNucoTitle') : t('addContact.invalidTitle')}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.errorBody}>
              {error === 'notNuco' ? t('addContact.notNucoBody') : t('addContact.invalidBody')}
            </Text>
            <Button
              label={error === 'notNuco' ? t('addContact.scanNuco') : t('addContact.tryAgain')}
              variant="secondary"
              onPress={resetScan}
            />
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
  close: { fontSize: 20, color: Colors.text },
  segment: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.xl },
  showWrap: { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
  qrCard: {
    backgroundColor: '#F2F4F7',
    borderRadius: Radius.sheet,
    padding: 22,
    borderWidth: 1,
    borderColor: Overlay.accentBorder,
  },
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
  scanHint: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.xl, alignItems: 'center' },
  scanHintTitle: { textAlign: 'center' },
  scanHintCaption: { textAlign: 'center', marginTop: Spacing.xs },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    padding: Spacing.lg,
  },
  errorCard: { gap: Spacing.md },
  errorTitle: {},
  errorBody: {},
  softAsk: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxxl, gap: Spacing.md },
  softTitle: { textAlign: 'center' },
  softBody: { textAlign: 'center', marginBottom: Spacing.sm },
});
