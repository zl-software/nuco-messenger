// The conversation screen: a scrollable message thread with outgoing (accent gradient) and
// incoming (surface) bubbles, a pinned retention banner, and a composer. Polls for inbound
// messages and marks the conversation read on focus.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, Button, Card, ChevronLeft, Screen, SendArrow, Text, VerifiedShield } from '@/ui';
import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { getContact, type Contact } from '@/db/repos/contacts';
import { getConversationByContact, type Conversation } from '@/db/repos/conversations';
import { listMessages, type Message } from '@/db/repos/messages';
import { isDbOpen } from '@/db/client';
import { subscribeConversationsChanged } from '@/services/data-events';
import { retentionKey, systemMessageKey } from '@/i18n/system-messages';
import { acceptRetention, cancelRetention, markRead, sendText } from '@/services/messaging';

type StatusKey =
  | 'conversation.statusSending'
  | 'conversation.statusSent'
  | 'conversation.statusDelivered'
  | 'conversation.statusFailed';

function statusKey(status: Message['status']): StatusKey {
  switch (status) {
    case 'sending':
      return 'conversation.statusSending';
    case 'sent':
      return 'conversation.statusSent';
    case 'delivered':
      return 'conversation.statusDelivered';
    case 'failed':
      return 'conversation.statusFailed';
  }
}

export default function ConversationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [contact, setContact] = useState<Contact | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const focusedRef = useRef(false);

  const loadMessages = useCallback(async () => {
    if (!id || !isDbOpen()) return;
    const list = await listMessages(id);
    setMessages(list);
  }, [id]);

  const loadAll = useCallback(async () => {
    if (!id || !isDbOpen()) return;
    const [c, convo] = await Promise.all([getContact(id), getConversationByContact(id)]);
    setContact(c);
    setConversation(convo);
    await loadMessages();
  }, [id, loadMessages]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadAll();
      if (id) void markRead(id);
      return () => {
        focusedRef.current = false;
      };
    }, [loadAll, id]),
  );

  // React to data changes for this conversation: refresh the messages AND the conversation
  // row (retention state, pending requests), and mark newly arrived messages read, but only
  // while actually visible: navigation focused (the screen stays mounted under a pushed
  // contact detail) AND the app in the foreground (backgrounding fires no blur, and a
  // message arriving then was not seen). markRead emits only when rows flipped, so the
  // listener chain terminates.
  const visible = useCallback(() => focusedRef.current && AppState.currentState === 'active', []);

  useEffect(() => {
    if (!id) return;
    return subscribeConversationsChanged((cid) => {
      if (cid !== undefined && cid !== id) return;
      void loadAll();
      if (visible()) void markRead(id);
    });
  }, [id, loadAll, visible]);

  // Returning to the foreground on this chat: whatever arrived meanwhile is on screen now,
  // so refresh and mark it read (no data event fires on resume).
  useEffect(() => {
    if (!id) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !focusedRef.current) return;
      void loadAll();
      void markRead(id);
    });
    return () => sub.remove();
  }, [id, loadAll]);

  // Poll for inbound messages while the screen is open. Kept as a safety net under the
  // change events (it also retires expired messages from view).
  useEffect(() => {
    const interval = setInterval(() => {
      void loadMessages();
    }, 1500);
    return () => clearInterval(interval);
  }, [loadMessages]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !contact || sending) return;
    setSending(true);
    setDraft('');
    await sendText({ id: contact.id, handle: contact.handle }, text, conversation?.retentionSeconds ?? 86400);
    await loadMessages();
    setSending(false);
  }, [draft, contact, conversation, sending, loadMessages]);

  // Synchronous in-flight guard: the banner only unmounts after the async reload, so a
  // double tap would otherwise run the handler twice and log the change twice.
  const respondingRef = useRef(false);
  const [responding, setResponding] = useState(false);
  const respond = useCallback(
    async (action: () => Promise<void>) => {
      if (respondingRef.current) return;
      respondingRef.current = true;
      setResponding(true);
      try {
        await action();
        await loadAll();
      } finally {
        respondingRef.current = false;
        setResponding(false);
      }
    },
    [loadAll],
  );

  const onAcceptRequest = useCallback(() => {
    if (!contact || conversation?.retentionPendingValue == null) return;
    const value = conversation.retentionPendingValue;
    void respond(() => acceptRetention({ id: contact.id, handle: contact.handle }, value));
  }, [contact, conversation, respond]);

  const onDeclineRequest = useCallback(() => {
    if (!contact) return;
    void respond(() => cancelRetention({ id: contact.id, handle: contact.handle }));
  }, [contact, respond]);

  if (!contact) {
    return <Screen contentStyle={styles.screen}>{null}</Screen>;
  }

  const verified = contact.status === 'verified';
  const subtitle = verified ? t('conversation.verified') : t('conversation.connecting');
  const retention = conversation?.retentionSeconds ?? 86400;

  return (
    <Screen contentStyle={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: '/contact/[id]', params: { id: contact.id } })}
          style={({ pressed }) => [styles.headerInfo, pressed ? styles.headerInfoPressed : null]}
          hitSlop={4}
        >
          <Avatar name={contact.displayName} size={40} unverified={!verified} />
          <View style={styles.headerText}>
            <View style={styles.nameWrap}>
              <Text variant="rowTitle" color="text" numberOfLines={1}>
                {contact.displayName}
              </Text>
              {verified ? <VerifiedShield size={14} color={Colors.accent} /> : null}
            </View>
            <Text variant="monoCaption" color="textSecondary">
              {subtitle}
            </Text>
          </View>
        </Pressable>
      </View>

      <Card tone="accent" style={styles.banner}>
        <Text variant="caption" color="accent" style={styles.bannerText}>
          {t('conversation.retentionBanner', { duration: t(retentionKey(retention)) })}
        </Text>
        {conversation?.retentionPending && !conversation.retentionPendingIncoming ? (
          <Text variant="caption" color="textTertiary" style={styles.bannerText}>
            {t('conversation.retentionBannerPending', {
              value: t(retentionKey(conversation.retentionPendingValue ?? 0)),
            })}
          </Text>
        ) : null}
      </Card>

      {conversation?.retentionPending && conversation.retentionPendingIncoming ? (
        <Card tone="accent" style={styles.requestCard}>
          <Text variant="caption" color="accent" style={styles.bannerText}>
            {conversation.retentionPendingValue != null && conversation.retentionPendingValue > 0
              ? t('retention.systemRequestIn', {
                  name: contact.displayName,
                  value: t(retentionKey(conversation.retentionPendingValue)),
                })
              : t('retention.systemRequestInOff', { name: contact.displayName })}
          </Text>
          <View style={styles.requestActions}>
            <Button label={t('retention.accept')} onPress={onAcceptRequest} disabled={responding} style={styles.requestBtn} />
            <Button
              label={t('retention.decline')}
              variant="secondary"
              onPress={onDeclineRequest}
              disabled={responding}
              style={styles.requestBtn}
            />
          </View>
        </Card>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyTile}>
              <VerifiedShield size={36} color={Colors.accent} />
            </View>
            <Text variant="title" color="text" style={styles.center}>
              {t('conversation.emptyVerifiedTitle', { name: contact.displayName })}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.center}>
              {t('conversation.emptyVerifiedBody')}
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.map((m) => {
              if (m.kind !== 'text') {
                return (
                  <View key={m.id} style={styles.systemRow}>
                    <Text variant="caption" color="textTertiary" style={styles.systemText}>
                      {t(systemMessageKey(m.kind, m.direction, m.body), {
                        name: contact.displayName,
                        value: m.body != null ? t(retentionKey(Number(m.body))) : '',
                      })}
                    </Text>
                  </View>
                );
              }
              const outgoing = m.direction === 'out';
              return (
                <View key={m.id} style={[styles.bubbleRow, outgoing ? styles.bubbleRowOut : styles.bubbleRowIn]}>
                  {outgoing ? (
                    <View style={styles.bubbleWrapOut}>
                      <LinearGradient
                        colors={[Colors.outgoingBubbleTop, Colors.outgoingBubbleBottom]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={[styles.bubble, styles.bubbleOut]}
                      >
                        <Text variant="body" style={styles.outText}>
                          {m.body}
                        </Text>
                      </LinearGradient>
                      <Text variant="caption" color={m.status === 'failed' ? 'danger' : 'textTertiary'} style={styles.statusText}>
                        {t(statusKey(m.status))}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.bubble, styles.bubbleIn]}>
                      <Text variant="body" color="text">
                        {m.body}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('conversation.composerPlaceholder')}
              placeholderTextColor={Colors.textSecondary}
              style={styles.input}
              multiline
            />
          </View>
          <Pressable
            onPress={onSend}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, !draft.trim() || sending ? styles.sendBtnDisabled : null]}
          >
            <SendArrow size={22} color={Colors.accentInk} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: Spacing.xl },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  // Same 40x40 box as the contact detail header, so the chevron does not jump when
  // navigating between the two screens.
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerInfoPressed: { opacity: 0.6 },
  headerText: { flex: 1, gap: 2 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  banner: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.xxs },
  bannerText: { textAlign: 'center' },
  requestCard: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  requestActions: { flexDirection: 'row', gap: Spacing.sm },
  requestBtn: { flex: 1 },
  systemRow: { alignItems: 'center', paddingVertical: Spacing.xs, paddingHorizontal: Spacing.lg },
  systemText: { textAlign: 'center' },
  list: { paddingVertical: Spacing.md, gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOut: { justifyContent: 'flex-end' },
  bubbleRowIn: { justifyContent: 'flex-start' },
  bubbleWrapOut: { maxWidth: '80%', alignItems: 'flex-end', gap: Spacing.xxs },
  // No maxWidth on the shared bubble: a percentage would resolve against the auto sized
  // outgoing wrap (whose width can collapse toward the short status caption) and squeeze
  // short messages into wrapping. The cap lives on the wrap (out) and on bubbleIn (in),
  // both of which have definite width parents.
  bubble: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.bubble },
  bubbleOut: { borderBottomRightRadius: Radius.bubbleTail },
  bubbleIn: { maxWidth: '80%', backgroundColor: Colors.surface2, borderBottomLeftRadius: Radius.bubbleTail },
  outText: { color: Colors.outgoingText },
  statusText: { marginRight: Spacing.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  emptyTile: {
    width: 88,
    height: 88,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.accentBorder,
    marginBottom: Spacing.sm,
  },
  center: { textAlign: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: Colors.surface1,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Overlay.hairline,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  input: { color: Colors.text, fontSize: 15, fontFamily: Fonts.regular, paddingVertical: 12, maxHeight: 120 },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
