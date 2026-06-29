import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, Button, Card, ChevronLeft, Pill, Screen, Text, Toggle, VerifiedShield } from '@/ui';
import {
  deleteContact,
  getContact,
  setBlocked,
  setMuted,
  type Contact,
} from '@/db/repos/contacts';
import { getConversation } from '@/db/repos/conversations';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

function retentionKey(seconds: number | null | undefined) {
  switch (seconds) {
    case 604800:
      return 'retention.option7d';
    case 2592000:
      return 'retention.option30d';
    case 0:
    case null:
    case undefined:
      return 'retention.optionOff';
    default:
      return 'retention.option24h';
  }
}

export default function ContactDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [retentionSeconds, setRetentionSeconds] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const c = await getContact(id);
        const conv = await getConversation(id);
        if (!active) return;
        setContact(c);
        setRetentionSeconds(conv?.retentionSeconds ?? null);
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  async function onToggleMute(value: boolean) {
    if (!contact) return;
    await setMuted(contact.id, value);
    setContact({ ...contact, muted: value });
  }

  async function onToggleBlock(value: boolean) {
    if (!contact) return;
    await setBlocked(contact.id, value);
    setContact({ ...contact, blocked: value });
  }

  async function onDelete() {
    if (!contact) return;
    await deleteContact(contact.id);
    router.back();
  }

  const isVerified = contact?.status === 'verified';
  const verifiedDate =
    contact?.verifiedAt != null ? new Date(contact.verifiedAt).toLocaleDateString() : '';

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="title">{t('contactDetail.title')}</Text>
        <View style={styles.headerBtn} />
      </View>

      {contact ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Avatar name={contact.displayName} size={88} unverified={!isVerified} />
            <View style={styles.nameRow}>
              <Text variant="section">{contact.displayName}</Text>
              {isVerified ? <VerifiedShield size={18} color={Colors.accent} /> : null}
            </View>
            <Text variant="monoCaption" color="textSecondary">
              {'@' + contact.handle}
            </Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.action}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: contact.id } })}
            >
              <Text variant="label">{t('contactDetail.message')}</Text>
            </Pressable>
            <View style={styles.action}>
              <Text variant="label" style={styles.actionLabel}>
                {t('contactDetail.mute')}
              </Text>
              <Toggle value={contact.muted} onChange={onToggleMute} />
            </View>
            <View style={styles.action}>
              <Pill label={t(retentionKey(retentionSeconds))} tone="accent" />
            </View>
          </View>

          {isVerified ? (
            <Card tone="accent" style={styles.verifiedCard}>
              <View style={styles.verifiedHead}>
                <VerifiedShield size={16} color={Colors.accent} />
                <Text variant="label" color="accent">
                  {t('contactDetail.verifiedInPerson', { date: verifiedDate })}
                </Text>
              </View>
              {contact.safetyNumber ? (
                <Text variant="mono" color="textOnCard" style={styles.safety}>
                  {contact.safetyNumber}
                </Text>
              ) : null}
              <Button
                label={t('verification.reVerify')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/verify/[id]', params: { id: contact.id } })}
                style={styles.reverify}
              />
            </Card>
          ) : (
            <Button
              label={t('contacts.verify')}
              onPress={() => router.push({ pathname: '/verify/[id]', params: { id: contact.id } })}
              style={styles.verifyCta}
            />
          )}

          <Card tone="danger" style={styles.dangerCard}>
            <View style={styles.dangerRow}>
              <Text variant="label" color="dangerSoft">
                {t('contactDetail.blockContact')}
              </Text>
              <Toggle value={contact.blocked} onChange={onToggleBlock} />
            </View>
            <View style={styles.divider} />
            <Pressable onPress={onDelete} style={styles.deleteRow}>
              <Text variant="label" color="danger">
                {t('contactDetail.deleteContact')}
              </Text>
            </Pressable>
          </Card>
        </ScrollView>
      ) : null}
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
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.huge },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionRow: { flexDirection: 'row', gap: Spacing.md },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.cardSmall,
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.hairlineSoft,
  },
  actionLabel: {},
  verifiedCard: { marginTop: Spacing.xl, gap: Spacing.md },
  verifiedHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  safety: { lineHeight: 22, letterSpacing: 1 },
  reverify: { marginTop: Spacing.xs },
  verifyCta: { marginTop: Spacing.xl },
  dangerCard: { marginTop: Spacing.xl, padding: 0 },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  divider: { height: 1, backgroundColor: Overlay.dangerBorder, marginHorizontal: Spacing.lg },
  deleteRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
});
