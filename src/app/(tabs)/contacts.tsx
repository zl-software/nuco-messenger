import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, ChevronRight, Pill, Plus, Screen, Text, TextField, VerifiedShield } from '@/ui';
import { listContacts, type Contact } from '@/db/repos/contacts';
import { Colors, Radius, Spacing, accentGlow } from '@/constants/theme';

export default function ContactsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void listContacts().then((rows) => {
        if (active) setContacts(rows);
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

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="display">{t('contacts.title')}</Text>
      </View>

      <View style={styles.searchRow}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('contacts.search')}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

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
              {verified.map((c) => (
                <ContactRow key={c.id} contact={c} onPress={() => openContact(c.id)} verifyLabel={t('contacts.verify')} />
              ))}
            </View>
          ) : null}

          {unverified.length > 0 ? (
            <View style={styles.section}>
              <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
                {t('contacts.unverifiedSection')}
              </Text>
              {unverified.map((c) => (
                <ContactRow key={c.id} contact={c} onPress={() => openContact(c.id)} verifyLabel={t('contacts.verify')} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/add-contact')}>
        <Plus size={18} color={Colors.accentInk} />
        <Text style={styles.fabLabel}>{t('contacts.addContact')}</Text>
      </Pressable>
    </Screen>
  );
}

function ContactRow({
  contact,
  onPress,
  verifyLabel,
}: {
  contact: Contact;
  onPress: () => void;
  verifyLabel: string;
}) {
  const isVerified = contact.status === 'verified';
  return (
    <Pressable style={styles.row} onPress={onPress}>
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
  header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
  searchRow: { marginHorizontal: Spacing.xl, marginTop: Spacing.lg },
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
    ...accentGlow,
  },
  fabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.accentInk },
});
