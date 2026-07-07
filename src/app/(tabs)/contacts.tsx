import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, BottomSheet, ChevronRight, Pill, Plus, Screen, SearchField, SwipeableRow, Text, VerifiedShield } from '@/ui';
import { deleteContact, listContacts, type Contact } from '@/db/repos/contacts';
import { isDbOpen } from '@/db/client';
import { removeChatLockSecrets } from '@/lock/chat-locks';
import { emitConversationsChanged } from '@/services/data-events';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

export default function ContactsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!isDbOpen()) {
        setContacts([]);
        return;
      }
      listContacts()
        .then((rows) => {
          if (active) setContacts(rows);
        })
        .catch(() => {
          // The database can close under us (lock, dev reload). Render empty rather than throw.
          if (active) setContacts([]);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const verified = filtered.filter((c) => c.status === 'verified');
  const unverified = filtered.filter((c) => c.status !== 'verified');
  const isEmpty = contacts.length === 0;

  function openContact(id: string) {
    router.push({ pathname: '/contact/[id]', params: { id } });
  }

  // Row delete (swipe or long press), mirroring the contact detail flow: the chat lock
  // keystore items do not cascade with the db rows, the contact delete cascades the
  // conversation and its messages.
  const [actionTarget, setActionTarget] = useState<Contact | null>(null);

  function confirmDelete(c: Contact) {
    Alert.alert(
      t('contactDetail.deleteConfirmTitle'),
      t('contactDetail.deleteConfirmBody', { name: c.displayName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contactDetail.deleteContact'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removeChatLockSecrets(c.id).catch(() => undefined);
              await deleteContact(c.id);
              emitConversationsChanged();
              // This screen reloads on focus only; drop the row in place.
              setContacts((prev) => prev.filter((x) => x.id !== c.id));
            })();
          },
        },
      ],
      { cancelable: true },
    );
  }

  function onRowLongPress(c: Contact) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setActionTarget(c);
  }

  // Close the sheet before the alert and wait out its close animation: iOS anchors an
  // alert to the presented Modal, and a dismissing Modal takes its alert down with it.
  function onSheetDelete() {
    const c = actionTarget;
    if (!c) return;
    setActionTarget(null);
    setTimeout(() => confirmDelete(c), 300);
  }

  const renderContact = (c: Contact) => (
    <SwipeableRow
      key={c.id}
      actions={[{ key: 'delete', label: t('common.delete'), tone: 'danger', onPress: () => confirmDelete(c) }]}
    >
      <ContactRow
        contact={c}
        onPress={() => openContact(c.id)}
        onLongPress={() => onRowLongPress(c)}
        verifyLabel={t('contacts.verify')}
      />
    </SwipeableRow>
  );

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="display">{t('contacts.title')}</Text>
      </View>

      <SearchField value={query} onChangeText={setQuery} placeholder={t('contacts.search')} style={styles.search} />

      {isEmpty ? (
        <View style={styles.empty}>
          <Text variant="section" style={styles.emptyTitle}>
            {t('contacts.emptyTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary" style={styles.emptyBody}>
            {t('contacts.emptyBody')}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {verified.length > 0 ? (
            <View style={styles.section}>
              <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
                {t('contacts.verifiedSection')}
              </Text>
              {verified.map(renderContact)}
            </View>
          ) : null}

          {unverified.length > 0 ? (
            <View style={styles.section}>
              <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
                {t('contacts.unverifiedSection')}
              </Text>
              {unverified.map(renderContact)}
            </View>
          ) : null}
        </ScrollView>
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/add-contact')}>
        <Plus size={18} color={Colors.accentInk} />
        <Text style={styles.fabLabel}>{t('contacts.addContact')}</Text>
      </Pressable>

      <BottomSheet
        visible={actionTarget != null}
        title={actionTarget?.displayName ?? ''}
        onClose={() => setActionTarget(null)}
      >
        <View>
          <Pressable style={styles.optionRow} onPress={onSheetDelete}>
            <Text variant="label" color="danger">
              {t('contactDetail.deleteContact')}
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
    </Screen>
  );
}

function ContactRow({
  contact,
  onPress,
  onLongPress,
  verifyLabel,
}: {
  contact: Contact;
  onPress: () => void;
  onLongPress: () => void;
  verifyLabel: string;
}) {
  const isVerified = contact.status === 'verified';
  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={onLongPress}>
      <Avatar name={contact.displayName} size={48} unverified={!isVerified} />
      <View style={styles.rowText}>
        <Text variant="rowTitle" numberOfLines={1}>
          {contact.displayName}
        </Text>
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {'@' + contact.handle}
        </Text>
      </View>
      {isVerified ? (
        <View style={styles.rowEnd}>
          <VerifiedShield size={16} color={Colors.accent} />
          <ChevronRight size={18} color={Colors.textTertiary} />
        </View>
      ) : (
        <Pill label={verifyLabel} tone="accent" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  // minHeight matches the chats header block (8px padding + 40px action row) so the
  // search bars on both tabs start at the same height.
  header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, minHeight: 48 },
  search: { marginHorizontal: Spacing.xl, marginTop: Spacing.lg },
  list: { paddingTop: Spacing.lg, paddingBottom: 140 },
  section: { marginBottom: Spacing.lg },
  eyebrow: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 11,
  },
  rowText: { flex: 1, gap: 2 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxxl },
  emptyTitle: { textAlign: 'center', marginBottom: Spacing.sm },
  emptyBody: { textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    bottom: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderRadius: Radius.cardSmall,
    backgroundColor: Colors.accent,
  },
  fabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.accentInk },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Overlay.hairlineSoft,
  },
});
