import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Card, ChevronLeft, QrCard, QrIcon, Screen, Text } from '@/ui';
import { getContact, type Contact } from '@/db/repos/contacts';
import { getSignal } from '@/services/account';
import { buildContactCard, markVerified } from '@/services/contacts';
import { useSession } from '@/state/session';
import { Colors, Overlay, Spacing } from '@/constants/theme';

interface Strings {
  safetyNumber: string;
  safetyNumberRows: string[];
  emoji: { emoji: string; name: string }[];
}

// Seconds the user must wait, after the codes appear, before they can confirm a match. Keeps
// people from tapping through without actually comparing.
const VERIFY_DELAY_SECONDS = 3;

export default function VerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const account = useSession((s) => s.account);
  const [contact, setContact] = useState<Contact | null>(null);
  const [strings, setStrings] = useState<Strings | null>(null);
  const [countdown, setCountdown] = useState(VERIFY_DELAY_SECONDS);
  const [showCode, setShowCode] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Memoized so the countdown rerenders do not regenerate the QR matrix every second.
  const qrValue = useMemo(() => (account ? JSON.stringify(buildContactCard(account)) : null), [account]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const c = await getContact(id);
      if (!active) return;
      setContact(c);
      if (c && account) {
        const s = await getSignal().verificationStrings(account.handle, c.handle, c.identityPubkey);
        if (active) setStrings(s);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, account]);

  // Start the confirm countdown once the codes are on screen.
  useEffect(() => {
    if (!strings) return;
    setCountdown(VERIFY_DELAY_SECONDS);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [strings]);

  async function onMarkVerified() {
    if (!contact || !strings) return;
    await markVerified(contact.id, strings.safetyNumber);
    // Reached from a scan: drop the scanner and this screen, land on the contact, so going back
    // returns to whatever preceded the scanner. Reached from the contact screen: just pop back.
    if (from === 'scan') {
      router.replace({ pathname: '/contact/[id]', params: { id: contact.id } });
    } else {
      router.back();
    }
  }

  const name = contact?.displayName ?? '';
  const canVerify = strings != null && countdown === 0;

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="title" numberOfLines={1} style={styles.headerTitle}>
          {t('verification.title', { name })}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text variant="bodySecondary" color="textSecondary" style={styles.intro}>
          {t('verification.compareBody', { name })}
        </Text>

        {strings ? (
          <Card style={styles.card}>
            <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
              {t('verification.safetyNumber')}
            </Text>
            {strings.safetyNumberRows.map((row, i) => (
              <Text key={i} variant="mono" color="textOnCard" style={styles.snRow}>
                {row}
              </Text>
            ))}

            <View style={styles.emojiRow}>
              {strings.emoji.map((e, i) => (
                <View key={i} style={styles.emojiItem}>
                  <Text style={styles.emojiGlyph}>{e.emoji}</Text>
                  <Text variant="caption" color="textSecondary">
                    {e.name}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        )}

        <Text variant="bodySecondary" color="textSecondary" style={styles.mutualHint}>
          {t('verification.mutualHint', { name })}
        </Text>

        <Button
          label={showCode ? t('verification.hideMyCode') : t('verification.showMyCode')}
          icon={<QrIcon size={18} color={Colors.accentInk} />}
          onPress={() => setShowCode((s) => !s)}
          style={styles.primary}
        />
        <Button
          label={
            strings && countdown > 0
              ? t('verification.markVerifiedCountdown', { seconds: countdown })
              : t('verification.markVerified')
          }
          variant="secondary"
          onPress={onMarkVerified}
          disabled={!canVerify}
        />

        {showCode && qrValue ? (
          // Below the buttons so both phones can be held together: one shows this code while
          // the other scans, with the safety number still on screen. onLayout fires when the
          // card mounts (after layout), so the scroll sees the final content height.
          <View style={styles.ownCode} onLayout={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            <QrCard value={qrValue} />
            <Text variant="monoCaption" color="textSecondary">
              {'@' + (account?.handle ?? '')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
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
  headerTitle: { flex: 1, textAlign: 'center' },
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.huge },
  intro: { textAlign: 'center', marginVertical: Spacing.lg },
  card: { alignItems: 'center', marginBottom: Spacing.xl },
  loading: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.huge, marginBottom: Spacing.xl },
  eyebrow: { marginBottom: Spacing.md },
  snRow: { fontSize: 19, letterSpacing: 2.3, lineHeight: 34, textAlign: 'center' },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Overlay.hairlineSoft,
  },
  emojiItem: { alignItems: 'center', gap: 2 },
  emojiGlyph: { fontSize: 28 },
  mutualHint: { textAlign: 'center', marginBottom: Spacing.md },
  primary: { marginTop: Spacing.xs, marginBottom: Spacing.md },
  ownCode: { alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
});
