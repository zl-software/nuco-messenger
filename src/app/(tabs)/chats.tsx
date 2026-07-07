// The chats list: a searchable list of conversation previews joined with their contact, with
// verification, retention, and unread affordances. Reloads on focus.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  Avatar,
  BottomSheet,
  Button,
  Lock,
  Pill,
  QrIcon,
  Plus,
  Screen,
  SearchField,
  SwipeableRow,
  Text,
  VerifiedShield,
} from '@/ui';
import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { conversationPreviews, deleteConversationMessages, type MessageKind } from '@/db/repos/messages';
import { getContact, type Contact } from '@/db/repos/contacts';
import { deleteConversation, getConversation } from '@/db/repos/conversations';
import { isDbOpen } from '@/db/client';
import { removeChatLockSecrets } from '@/lock/chat-locks';
import { emitConversationsChanged, subscribeConversationsChanged } from '@/services/data-events';
import { callDurationParam, retentionLabel, systemMessageKey } from '@/i18n/system-messages';
import { useSettings } from '@/state/settings';

interface ChatRow {
  contact: Contact;
  body: string | null;
  sentAt: number;
  direction: 'in' | 'out';
  kind: MessageKind;
  unread: number;
  retentionSeconds: number;
  locked: boolean;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const showPreview = useSettings((s) => s.showPreview);
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
          kind: preview.kind,
          unread: preview.unread,
          retentionSeconds: convo?.retentionSeconds ?? 86400,
          locked: convo?.lockEnabled ?? false,
        });
      }
      setRows(built);
    } catch {
      // The database can close under us (lock, dev reload). Render empty rather than throw.
      setRows([]);
    }
  }, []);

  // Coalesce event bursts (e.g. the relay flushing a backlog after reconnect) and keep
  // loads serialized so an older result can never overwrite a newer one: one load in
  // flight, at most one queued rerun.
  const loading = useRef(false);
  const dirty = useRef(false);
  const scheduleLoad = useCallback(async () => {
    if (loading.current) {
      dirty.current = true;
      return;
    }
    loading.current = true;
    do {
      dirty.current = false;
      await load();
    } while (dirty.current);
    loading.current = false;
  }, [load]);

  // The tab stays mounted behind pushed screens, so a mount lifetime subscription keeps
  // the list current without waiting for a refocus.
  useEffect(() => subscribeConversationsChanged(() => void scheduleLoad()), [scheduleLoad]);

  useFocusEffect(
    useCallback(() => {
      void scheduleLoad();
    }, [scheduleLoad]),
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

  // Row actions (swipe or long press). Clear drops the messages but keeps the conversation
  // row (retention, screenshot, and chat lock settings survive); Delete drops the
  // conversation row too (messages cascade) plus the chat lock secrets, which live in
  // SecureStore and never cascade with the db. Both keep the contact: deleting a chat is
  // not deleting the person. Either way the row leaves the list because previews derive
  // from message rows.
  const [actionTarget, setActionTarget] = useState<ChatRow | null>(null);

  const confirmClear = useCallback(
    (row: ChatRow) => {
      Alert.alert(
        t('chats.clearConfirmTitle'),
        t('chats.clearConfirmBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('chats.clearAction'),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await deleteConversationMessages(row.contact.id);
                emitConversationsChanged(row.contact.id);
              })();
            },
          },
        ],
        { cancelable: true },
      );
    },
    [t],
  );

  const confirmDelete = useCallback(
    (row: ChatRow) => {
      Alert.alert(
        t('chats.deleteConfirmTitle'),
        t('chats.deleteConfirmBody', { name: row.contact.displayName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await removeChatLockSecrets(row.contact.id).catch(() => undefined);
                await deleteConversation(row.contact.id);
                emitConversationsChanged(row.contact.id);
              })();
            },
          },
        ],
        { cancelable: true },
      );
    },
    [t],
  );

  const onRowLongPress = useCallback((row: ChatRow) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setActionTarget(row);
  }, []);

  // Close the sheet before the alert and wait out its close animation: iOS anchors an
  // alert to the presented Modal, and a dismissing Modal takes its alert down with it.
  const onSheetClear = useCallback(() => {
    const row = actionTarget;
    if (!row) return;
    setActionTarget(null);
    setTimeout(() => confirmClear(row), 300);
  }, [actionTarget, confirmClear]);

  const onSheetDelete = useCallback(() => {
    const row = actionTarget;
    if (!row) return;
    setActionTarget(null);
    setTimeout(() => confirmDelete(row), 300);
  }, [actionTarget, confirmDelete]);

  const header = (
    <View style={styles.header}>
      <Text variant="display" color="text">
        {t('chats.title')}
      </Text>
      <Pressable style={[styles.iconBtn, styles.composeBtn]} onPress={() => router.push('/add-contact')} hitSlop={8}>
        <Plus size={20} color={Colors.accentInk} />
      </Pressable>
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
          // System rows carry a seconds value in the body; render the localized sentence,
          // never the raw stored value. Text previews honor the "show preview" privacy setting:
          // when off, the list shows a neutral placeholder instead of the message body.
          // A locked chat masks EVERY kind (even "missed call"), and its text bodies are
          // sealed in the db anyway, so the placeholder is the only honest preview.
          const preview = item.locked
            ? t('chatLock.lockedPreview')
            : item.kind !== 'text'
              ? t(systemMessageKey(item.kind, item.direction, item.body), {
                  name: item.contact.displayName,
                  value: item.body != null ? retentionLabel(Number(item.body), t) : '',
                  duration: callDurationParam(item.kind, item.body),
                })
              : !showPreview
                ? t('chats.hiddenPreview')
                : item.direction === 'out' && item.body
                  ? t('chats.you', { text: item.body })
                  : item.body ?? '';
          const unreadStyle = item.unread > 0;
          return (
            <SwipeableRow
              actions={[
                { key: 'clear', label: t('chats.clearAction'), tone: 'neutral', onPress: () => confirmClear(item) },
                { key: 'delete', label: t('common.delete'), tone: 'danger', onPress: () => confirmDelete(item) },
              ]}
            >
              <Pressable
                style={styles.row}
                onPress={() => openChat(item.contact.id)}
                onLongPress={() => onRowLongPress(item)}
              >
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
                    {item.locked ? <Lock size={13} color={Colors.textTertiary} /> : null}
                    <Text
                      variant="bodySecondary"
                      color={unreadStyle ? 'text' : 'textSecondary'}
                      numberOfLines={1}
                      style={styles.preview}
                    >
                      {preview}
                    </Text>
                    <View style={styles.rowMeta}>
                      <Pill
                        label={retentionLabel(item.retentionSeconds, t)}
                        tone={item.retentionSeconds <= 0 ? 'neutral' : 'accent'}
                      />
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
            </SwipeableRow>
          );
        }}
      />

      <BottomSheet
        visible={actionTarget != null}
        title={actionTarget?.contact.displayName ?? ''}
        onClose={() => setActionTarget(null)}
      >
        <View>
          <Pressable style={styles.optionRow} onPress={onSheetClear}>
            <Text variant="label" color="text">
              {t('chats.clearChat')}
            </Text>
          </Pressable>
          <Pressable style={styles.optionRow} onPress={onSheetDelete}>
            <Text variant="label" color="danger">
              {t('chats.deleteChat')}
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
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
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Overlay.hairlineSoft,
  },
});
