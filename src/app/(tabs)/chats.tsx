// The chats list: a searchable list of conversation previews joined with their contact, with
// verification, retention, and unread affordances. Reloads on focus.

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  Avatar,
  Button,
  Pill,
  QrIcon,
  Plus,
  Screen,
  SearchField,
  Text,
  VerifiedShield,
} from '@/ui';
import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { conversationPreviews } from '@/db/repos/messages';
import { getContact, type Contact } from '@/db/repos/contacts';
import { getConversation } from '@/db/repos/conversations';
import { isDbOpen } from '@/db/client';

interface ChatRow {
  contact: Contact;
  body: string | null;
  sentAt: number;
  direction: 'in' | 'out';
  unread: number;
  retentionSeconds: number;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

type RetentionKey = 'retention.optionOff' | 'retention.option24h' | 'retention.option7d' | 'retention.option30d';

function retentionPill(seconds: number): { key: RetentionKey; tone: 'accent' | 'neutral' } {
  if (seconds <= 0) return { key: 'retention.optionOff', tone: 'neutral' };
  if (seconds <= 86400) return { key: 'retention.option24h', tone: 'accent' };
  if (seconds <= 604800) return { key: 'retention.option7d', tone: 'accent' };
  return { key: 'retention.option30d', tone: 'accent' };
}

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!isDbOpen()) {
      setRows([]);
      return;
    }
    try {
      const previews = await conversationPreviews();
      const built: ChatRow[] = [];
      for (const preview of previews) {
        const contact = await getContact(preview.conversationId);
        if (!contact) continue;
        const convo = await getConversation(preview.conversationId);
        built.push({
          contact,
          body: preview.body,
          sentAt: preview.sentAt,
          direction: preview.direction,
          unread: preview.unread,
          retentionSeconds: convo?.retentionSeconds ?? 86400,
        });
      }
      setRows(built);
    } catch {
      // The database can close under us (lock, dev reload). Render empty rather than throw.
      setRows([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.contact.displayName.toLowerCase().includes(q) || r.contact.handle.toLowerCase().includes(q));
  }, [rows, query]);

  const openChat = useCallback(
    (id: string) => {
      router.push({ pathname: '/chat/[id]', params: { id } });
    },
    [router],
  );

  const header = (
    <View style={styles.header}>
      <Text variant="display" color="text">
        {t('chats.title')}
      </Text>
      <View style={styles.headerActions}>
        <Pressable style={styles.iconBtn} onPress={() => router.push('/add-contact')} hitSlop={8}>
          <QrIcon size={20} color={Colors.text} />
        </Pressable>
        <Pressable style={[styles.iconBtn, styles.composeBtn]} onPress={() => router.push('/add-contact')} hitSlop={8}>
          <Plus size={20} color={Colors.accentInk} />
        </Pressable>
      </View>
    </View>
  );

  if (rows.length === 0) {
    return (
      <Screen contentStyle={styles.screen} edges={['top']}>
        {header}
        <View style={styles.empty}>
          <View style={styles.emptyTile}>
            <QrIcon size={40} color={Colors.accent} />
          </View>
          <Text variant="title" color="text" style={styles.center}>
            {t('chats.emptyTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary" style={styles.center}>
            {t('chats.emptyBody')}
          </Text>
          <Button label={t('chats.emptyCta')} onPress={() => router.push('/add-contact')} style={styles.emptyCta} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screen} edges={['top']}>
      {header}
      <SearchField value={query} onChangeText={setQuery} placeholder={t('chats.search')} style={styles.search} />
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.contact.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const pill = retentionPill(item.retentionSeconds);
          const preview = item.direction === 'out' && item.body ? t('chats.you', { text: item.body }) : item.body ?? '';
          const unreadStyle = item.unread > 0;
          return (
            <Pressable style={styles.row} onPress={() => openChat(item.contact.id)}>
              <Avatar name={item.contact.displayName} size={52} unverified={item.contact.status !== 'verified'} />
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <View style={styles.nameWrap}>
                    <Text variant="rowTitle" color="text" numberOfLines={1}>
                      {item.contact.displayName}
                    </Text>
                    {item.contact.status === 'verified' ? <VerifiedShield size={14} color={Colors.accent} /> : null}
                  </View>
                  <Text variant="caption" color={unreadStyle ? 'accent' : 'textTertiary'}>
                    {formatTime(item.sentAt)}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text
                    variant="bodySecondary"
                    color={unreadStyle ? 'text' : 'textSecondary'}
                    numberOfLines={1}
                    style={styles.preview}
                  >
                    {preview}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Pill label={t(pill.key)} tone={pill.tone} />
                    {item.unread > 0 ? (
                      <View style={styles.badge}>
                        <Text variant="caption" color="accentInk" style={styles.badgeText}>
                          {item.unread}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: Spacing.xl },
  header: {
    flexDirection: 'row',
    // Top aligned so the display title sits at the same height as on the contacts and
    // settings tabs (centering it in the 40px icon button row pushed it 2px lower).
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.sm },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.buttonSmall,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  composeBtn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  search: { marginBottom: Spacing.lg },
  list: { paddingBottom: Spacing.xxl, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBody: { flex: 1, gap: Spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  preview: { flex: 1 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: Fonts.semibold },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  emptyTile: {
    width: 96,
    height: 96,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.accentBorder,
    marginBottom: Spacing.md,
  },
  center: { textAlign: 'center' },
  emptyCta: { marginTop: Spacing.md, alignSelf: 'stretch' },
});
