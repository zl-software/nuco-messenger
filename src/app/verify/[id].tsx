import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Card, ChevronLeft, QrIcon, Screen, Text } from '@/ui';
import { getContact, type Contact } from '@/db/repos/contacts';
import { getSignal } from '@/services/account';
import { markVerified } from '@/services/contacts';
import { useSession } from '@/state/session';
import { Colors, Overlay, Spacing } from '@/constants/theme';

interface Strings {
  safetyNumber: string;
  safetyNumberRows: string[];
  emoji: { emoji: string; name: string }[];
}

export default function VerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useSession((s) => s.account);
  const [contact, setContact] = useState<Contact | null>(null);
  const [strings, setStrings] = useState<Strings | null>(null);

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

  async function onMarkVerified() {
    if (!contact || !strings) return;
    await markVerified(contact.id, strings.safetyNumber);
    router.back();
  }

  const name = contact?.displayName ?? '';

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

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
        ) : null}

        <Button
          label={t('verification.scanToCompare')}
          icon={<QrIcon size={18} color={Colors.accentInk} />}
          onPress={() => router.push('/add-contact')}
          style={styles.primary}
        />
        <Button
          label={t('verification.markVerified')}
          variant="secondary"
          onPress={onMarkVerified}
          disabled={!strings}
        />
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
  primary: { marginTop: Spacing.lg, marginBottom: Spacing.md },
});
