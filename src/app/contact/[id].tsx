import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, BottomSheet, Button, Card, ChevronLeft, ChevronRight, Screen, Text, Toggle, VerifiedShield } from '@/ui';
import {
  deleteContact,
  getContact,
  setBlocked,
  setMuted,
  type Contact,
} from '@/db/repos/contacts';
import { getConversation, type Conversation } from '@/db/repos/conversations';
import { acceptRetention, cancelRetention, requestRetention } from '@/services/messaging';
import { Colors, Overlay, Spacing } from '@/constants/theme';

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

const RETENTION_OPTIONS = [
  { seconds: 86400, key: 'retention.option24h' },
  { seconds: 604800, key: 'retention.option7d' },
  { seconds: 2592000, key: 'retention.option30d' },
  { seconds: 0, key: 'retention.optionOff' },
] as const;

export default function ContactDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    const [c, conv] = await Promise.all([getContact(id), getConversation(id)]);
    setContact(c);
    setConversation(conv);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isVerified = contact?.status === 'verified';
  const verifiedDate =
    contact?.verifiedAt != null ? new Date(contact.verifiedAt).toLocaleDateString() : '';
  const retentionSeconds = conversation?.retentionSeconds ?? null;
  const pendingValue = conversation?.retentionPendingValue ?? null;
  const outgoingPending = !!conversation?.retentionPending && !conversation.retentionPendingIncoming;
  const incomingPending = !!conversation?.retentionPending && conversation.retentionPendingIncoming;

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

  async function onPickRetention(seconds: number) {
    setSheetOpen(false);
    if (!contact || seconds === retentionSeconds) return;
    await requestRetention({ id: contact.id, handle: contact.handle }, seconds);
    await load();
  }

  async function onCancelRetention() {
    setSheetOpen(false);
    if (!contact) return;
    await cancelRetention({ id: contact.id, handle: contact.handle });
    await load();
  }

  async function onAcceptIncoming() {
    if (!contact || pendingValue == null) return;
    await acceptRetention({ id: contact.id, handle: contact.handle }, pendingValue);
    await load();
  }

  async function onDeclineIncoming() {
    if (!contact) return;
    await cancelRetention({ id: contact.id, handle: contact.handle });
    await load();
  }

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

          <Button
            label={t('contactDetail.message')}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: contact.id } })}
            style={styles.messageCta}
          />

          <Card style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <Text variant="label">{t('contactDetail.muteNotifications')}</Text>
              <Toggle value={contact.muted} onChange={onToggleMute} />
            </View>
            <View style={styles.divider} />
            <Pressable style={styles.settingRow} onPress={() => setSheetOpen(true)}>
              <Text variant="label">{t('contactDetail.disappearingMessages')}</Text>
              <View style={styles.settingValue}>
                <Text variant="label" color={outgoingPending ? 'accent' : 'textSecondary'}>
                  {outgoingPending ? t(retentionKey(pendingValue)) : t(retentionKey(retentionSeconds))}
                </Text>
                {outgoingPending ? (
                  <Text variant="caption" color="textTertiary">
                    {t('retention.pending')}
                  </Text>
                ) : null}
                <ChevronRight size={18} color={Colors.textTertiary} />
              </View>
            </Pressable>
          </Card>

          {incomingPending ? (
            <Card tone="accent" style={styles.incomingCard}>
              <Text variant="label" color="accent">
                {t('retention.incomingTitle', { name: contact.displayName })}
              </Text>
              <Text variant="bodySecondary" color="textOnCard" style={styles.incomingBody}>
                {t('retention.incomingBody', { name: contact.displayName, value: t(retentionKey(pendingValue)) })}
              </Text>
              <View style={styles.incomingActions}>
                <Button label={t('retention.accept')} onPress={onAcceptIncoming} style={styles.incomingBtn} />
                <Button
                  label={t('retention.decline')}
                  variant="secondary"
                  onPress={onDeclineIncoming}
                  style={styles.incomingBtn}
                />
              </View>
            </Card>
          ) : null}

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
            <View style={styles.dangerDivider} />
            <Pressable onPress={onDelete} style={styles.deleteRow}>
              <Text variant="label" color="danger">
                {t('contactDetail.deleteContact')}
              </Text>
            </Pressable>
          </Card>
        </ScrollView>
      ) : null}

      <BottomSheet visible={sheetOpen} title={t('retention.title')} onClose={() => setSheetOpen(false)}>
        {outgoingPending ? (
          <View style={styles.sheetPending}>
            <Text variant="bodySecondary" color="textSecondary" style={styles.sheetWaiting}>
              {t('retention.waiting', {
                name: contact?.displayName ?? '',
                value: t(retentionKey(pendingValue)),
              })}
            </Text>
            <Button label={t('retention.cancelRequest')} variant="secondary" onPress={onCancelRetention} />
          </View>
        ) : (
          <View>
            {RETENTION_OPTIONS.map((opt) => {
              const selected = retentionSeconds === opt.seconds;
              return (
                <Pressable key={opt.seconds} style={styles.optionRow} onPress={() => onPickRetention(opt.seconds)}>
                  <Text variant="label" color={selected ? 'accent' : 'text'}>
                    {t(opt.key)}
                  </Text>
                  {selected ? <View style={styles.selectedDot} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </BottomSheet>
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
  messageCta: { marginBottom: Spacing.lg },
  settingsCard: { padding: 0 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  settingValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  divider: { height: 1, backgroundColor: Overlay.hairlineSoft, marginHorizontal: Spacing.lg },
  incomingCard: { marginTop: Spacing.lg, gap: Spacing.sm },
  incomingBody: {},
  incomingActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  incomingBtn: { flex: 1 },
  verifiedCard: { marginTop: Spacing.lg, gap: Spacing.md },
  verifiedHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  safety: { lineHeight: 22, letterSpacing: 1 },
  reverify: { marginTop: Spacing.xs },
  verifyCta: { marginTop: Spacing.lg },
  dangerCard: { marginTop: Spacing.lg, padding: 0 },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  dangerDivider: { height: 1, backgroundColor: Overlay.dangerBorder, marginHorizontal: Spacing.lg },
  deleteRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
  sheetPending: { gap: Spacing.lg },
  sheetWaiting: {},
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Overlay.hairlineSoft,
  },
  selectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
});
