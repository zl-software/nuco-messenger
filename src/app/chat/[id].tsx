// The conversation screen: a scrollable message thread with outgoing (accent gradient) and
// incoming (surface) bubbles, a pinned retention banner, and a composer. Polls for inbound
// messages and marks the conversation read on focus.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
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

import { Avatar, Card, ChevronLeft, Screen, SendArrow, Text, VerifiedShield } from '@/ui';
import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { getContact, type Contact } from '@/db/repos/contacts';
import { getConversationByContact, type Conversation } from '@/db/repos/conversations';
import { listMessages, markConversationRead, type Message } from '@/db/repos/messages';
import { sendText } from '@/services/messaging';

type RetentionKey = 'retention.optionOff' | 'retention.option24h' | 'retention.option7d' | 'retention.option30d';

function retentionKey(seconds: number): RetentionKey {
  if (seconds <= 0) return 'retention.optionOff';
  if (seconds <= 86400) return 'retention.option24h';
  if (seconds <= 604800) return 'retention.option7d';
  return 'retention.option30d';
}

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

  const loadMessages = useCallback(async () => {
    if (!id) return;
    const list = await listMessages(id);
    setMessages(list);
  }, [id]);

  const loadAll = useCallback(async () => {
    if (!id) return;
    const [c, convo] = await Promise.all([getContact(id), getConversationByContact(id)]);
    setContact(c);
    setConversation(convo);
    await loadMessages();
  }, [id, loadMessages]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
      if (id) void markConversationRead(id);
    }, [loadAll, id]),
  );

  // Poll for inbound messages while the screen is open.
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
          <ChevronLeft size={24} color={Colors.text} />
        </Pressable>
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
      </View>

      <Card tone="accent" style={styles.banner}>
        <Text variant="caption" color="accent" style={styles.bannerText}>
          {t('conversation.retentionBanner', { duration: t(retentionKey(retention)) })}
        </Text>
      </Card>

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
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  backBtn: { padding: Spacing.xs, marginLeft: -Spacing.xs },
  headerText: { flex: 1, gap: 2 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  banner: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  bannerText: { textAlign: 'center' },
  list: { paddingVertical: Spacing.md, gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOut: { justifyContent: 'flex-end' },
  bubbleRowIn: { justifyContent: 'flex-start' },
  bubbleWrapOut: { maxWidth: '80%', alignItems: 'flex-end', gap: Spacing.xxs },
  bubble: { maxWidth: '80%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.bubble },
  bubbleOut: { borderBottomRightRadius: Radius.bubbleTail },
  bubbleIn: { backgroundColor: Colors.surface2, borderBottomLeftRadius: Radius.bubbleTail },
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
