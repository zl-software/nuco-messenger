// The conversation screen: a scrollable message thread with outgoing (accent gradient) and
// incoming (surface) bubbles, a pinned retention banner, and a composer. Polls for inbound
// messages and marks the conversation read on focus.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { MESSAGE_BODY_MAX_LEN } from '@nuco/protocol';

import { Avatar, Button, Card, ChatLockGate, ChevronLeft, Phone, Screen, SendArrow, Text, VerifiedShield } from '@/ui';
import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { getContact, isMutuallyVerified, type Contact } from '@/db/repos/contacts';
import { getConversationByContact, type Conversation } from '@/db/repos/conversations';
import { listMessages, type Message } from '@/db/repos/messages';
import { isDbOpen } from '@/db/client';
import { decryptBodyCached, isChatUnlocked, relockChat } from '@/lock/chat-locks';
import { subscribeConversationsChanged } from '@/services/data-events';
import { callDurationParam, retentionLabel, systemMessageKey } from '@/i18n/system-messages';
import {
  acceptRetention,
  acceptScreenshotProtection,
  cancelRetention,
  cancelScreenshotProtection,
  markRead,
  resendSealedPending,
  sendText,
} from '@/services/messaging';
import { useScreenshotGuard } from '@/ui/use-screenshot-guard';
import { useStartCall } from '@/calls/use-start-call';
import { useCall } from '@/state/call';

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
  const [chatUnlocked, setChatUnlocked] = useState(() => (id ? isChatUnlocked(id) : false));
  const scrollRef = useRef<ScrollView>(null);
  // Whether the view is pinned to the newest message. Only then do content growth (a new
  // message) and layout shrink (the keyboard opening) auto scroll to the end; a user who
  // scrolled up to read history keeps their position through both.
  const atBottomRef = useRef(true);
  const focusedRef = useRef(false);
  const startCall = useStartCall();
  const callStatus = useCall((s) => s.status);
  const insets = useSafeAreaInsets();

  // Enforce the negotiated screenshot protection while this conversation is on screen. The
  // conversation state stays live via subscribeConversationsChanged below, so an accept
  // arriving mid conversation starts blocking without a refocus.
  useScreenshotGuard(conversation?.screenshotProtection === true, 'nuco-chat');

  // The composer needs the bottom safe area inset only while the keyboard is closed: open,
  // the keyboard itself is the bottom edge and the inset would float the composer above it.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

  // Leaving the chat relocks it: the released chat key and the decrypted body cache are
  // dropped, so re-entry prompts again (auto FaceID makes that one tap).
  useEffect(() => {
    return () => {
      if (id) relockChat(id);
    };
  }, [id]);

  // Never mark messages read behind the chat lock gate: the owner has not seen them yet.
  const markReadIfViewable = useCallback(async () => {
    if (!id || !isDbOpen()) return;
    const convo = await getConversationByContact(id).catch(() => null);
    if (convo?.lockEnabled && !isChatUnlocked(id)) return;
    void markRead(id);
  }, [id]);

  const onChatUnlocked = useCallback(() => {
    if (!id) return;
    setChatUnlocked(true);
    void (async () => {
      // An interrupted send in a locked chat can only be resent now, with the key released.
      const convo = await getConversationByContact(id).catch(() => null);
      if (convo?.lockPubkey) void resendSealedPending(id, convo.lockPubkey);
      await loadAll();
      void markReadIfViewable();
    })();
  }, [id, loadAll, markReadIfViewable]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadAll();
      void markReadIfViewable();
      return () => {
        focusedRef.current = false;
      };
    }, [loadAll, markReadIfViewable]),
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
      if (visible()) void markReadIfViewable();
    });
  }, [id, loadAll, visible, markReadIfViewable]);

  // Returning to the foreground on this chat: whatever arrived meanwhile is on screen now,
  // so refresh and mark it read (no data event fires on resume).
  useEffect(() => {
    if (!id) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !focusedRef.current) return;
      void loadAll();
      void markReadIfViewable();
    });
    return () => sub.remove();
  }, [id, loadAll, markReadIfViewable]);

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
    // Sending while scrolled up still reveals the sent message.
    atBottomRef.current = true;
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

  const onAcceptScreenshotRequest = useCallback(() => {
    if (!contact || conversation?.screenshotPendingValue == null) return;
    const on = conversation.screenshotPendingValue;
    void respond(() => acceptScreenshotProtection({ id: contact.id, handle: contact.handle }, on));
  }, [contact, conversation, respond]);

  const onDeclineScreenshotRequest = useCallback(() => {
    if (!contact) return;
    void respond(() => cancelScreenshotProtection({ id: contact.id, handle: contact.handle }));
  }, [contact, respond]);

  if (!contact) {
    return <Screen>{null}</Screen>;
  }

  const verified = isMutuallyVerified(contact);
  const subtitle = verified ? t('conversation.verified') : t('conversation.pendingVerification');
  const retention = conversation?.retentionSeconds ?? 86400;

  // Sealed rows decrypt through the released chat key; anything that fails renders a
  // placeholder rather than ciphertext or a crash.
  const displayBody = (m: Message): string | null => {
    if (m.meta == null) return m.body;
    if (!conversation?.lockPubkey) return t('chatLock.undecryptable');
    try {
      return decryptBodyCached(conversation.id, conversation.lockPubkey, m);
    } catch {
      return t('chatLock.undecryptable');
    }
  };

  // The chat lock gate replaces the thread and composer until this chat's key is
  // released. The header stays so the user knows where they are.
  if (conversation?.lockEnabled && !chatUnlocked) {
    return (
      <Screen edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <ChevronLeft size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.headerInfo}>
            <Avatar name={contact.displayName} size={40} unverified={!verified} />
            <View style={styles.headerText}>
              <View style={styles.nameWrap}>
                <Text variant="rowTitle" color="text" numberOfLines={1}>
                  {contact.displayName}
                </Text>
                {verified ? <VerifiedShield size={14} color={Colors.accent} /> : null}
              </View>
              <Text variant="monoCaption" color="textSecondary">
                {t('chatLock.lockedPreview')}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.lockGateWrap}>
          <ChatLockGate conversationId={contact.id} bioEnabled={conversation.lockBioEnabled} onUnlocked={onChatUnlocked} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
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
        <Pressable
          onPress={() =>
            void startCall({ id: contact.id, handle: contact.handle, displayName: contact.displayName, blocked: contact.blocked })
          }
          disabled={!verified || contact.blocked || callStatus !== 'idle'}
          style={[styles.callBtn, !verified || contact.blocked || callStatus !== 'idle' ? styles.callBtnDisabled : null]}
          hitSlop={8}
        >
          <Phone size={20} color={Colors.text} />
        </Pressable>
      </View>

      <Card tone="accent" style={styles.banner}>
        <Text variant="caption" color="accent" style={styles.bannerText}>
          {t('conversation.retentionBanner', { duration: retentionLabel(retention, t) })}
        </Text>
        {conversation?.retentionPending && !conversation.retentionPendingIncoming ? (
          <Text variant="caption" color="textTertiary" style={styles.bannerText}>
            {t('conversation.retentionBannerPending', {
              value: retentionLabel(conversation.retentionPendingValue ?? 0, t),
            })}
          </Text>
        ) : null}
        {conversation?.screenshotProtection ? (
          <Text variant="caption" color="accent" style={styles.bannerText}>
            {t('screenshot.bannerActive')}
          </Text>
        ) : null}
        {conversation?.screenshotPending && !conversation.screenshotPendingIncoming ? (
          <Text variant="caption" color="textTertiary" style={styles.bannerText}>
            {t('screenshot.bannerPending')}
          </Text>
        ) : null}
      </Card>

      {conversation?.retentionPending && conversation.retentionPendingIncoming ? (
        <Card tone="accent" style={styles.requestCard}>
          <Text variant="caption" color="accent" style={styles.bannerText}>
            {conversation.retentionPendingValue != null && conversation.retentionPendingValue > 0
              ? t('retention.systemRequestIn', {
                  name: contact.displayName,
                  value: retentionLabel(conversation.retentionPendingValue, t),
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

      {conversation?.screenshotPending && conversation.screenshotPendingIncoming ? (
        <Card tone="accent" style={styles.requestCard}>
          <Text variant="caption" color="accent" style={styles.bannerText}>
            {t(
              conversation.screenshotPendingValue === true
                ? 'screenshot.incomingTitleOn'
                : 'screenshot.incomingTitleOff',
              { name: contact.displayName },
            )}
          </Text>
          <View style={styles.requestActions}>
            <Button
              label={t('screenshot.accept')}
              onPress={onAcceptScreenshotRequest}
              disabled={responding}
              style={styles.requestBtn}
            />
            <Button
              label={t('screenshot.decline')}
              variant="secondary"
              onPress={onDeclineScreenshotRequest}
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
          <Pressable style={styles.empty} onPress={() => Keyboard.dismiss()}>
            <View style={styles.emptyTile}>
              <VerifiedShield size={36} color={Colors.accent} />
            </View>
            <Text variant="title" color="text" style={styles.center}>
              {t('conversation.emptyVerifiedTitle', { name: contact.displayName })}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.center}>
              {t('conversation.emptyVerifiedBody')}
            </Text>
          </Pressable>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.listGrow}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            scrollEventThrottle={32}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 50;
            }}
            onContentSizeChange={() => {
              if (atBottomRef.current) scrollRef.current?.scrollToEnd({ animated: false });
            }}
            // The keyboard changes the layout height, not the content size, so it needs its
            // own hook: pinned to the bottom, the thread rides up with the composer.
            onLayout={() => {
              if (atBottomRef.current) scrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {/* Bubbles carry no touch handlers, so a tap anywhere on the thread (including
                below the last message, via flexGrow) lands here and closes the keyboard.
                Scroll gestures still win over the press via responder negotiation. */}
            <Pressable style={styles.list} onPress={() => Keyboard.dismiss()}>
              {messages.map((m) => {
                if (m.kind !== 'text') {
                  return (
                    <View key={m.id} style={styles.systemRow}>
                      <Text variant="caption" color="textTertiary" style={styles.systemText}>
                        {t(systemMessageKey(m.kind, m.direction, m.body), {
                          name: contact.displayName,
                          value: m.body != null ? retentionLabel(Number(m.body), t) : '',
                          duration: callDurationParam(m.kind, m.body),
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
                            {displayBody(m)}
                          </Text>
                        </LinearGradient>
                        <Text variant="caption" color={m.status === 'failed' ? 'danger' : 'textTertiary'} style={styles.statusText}>
                          {t(statusKey(m.status))}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.bubble, styles.bubbleIn]}>
                        <Text variant="body" color="text">
                          {displayBody(m)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </Pressable>
          </ScrollView>
        )}

        {verified ? (
          <View
            style={[
              styles.composer,
              { paddingBottom: keyboardVisible ? Spacing.md : Math.max(insets.bottom, Spacing.md) },
            ]}
          >
            <View style={styles.inputWrap}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t('conversation.composerPlaceholder')}
                placeholderTextColor={Colors.textSecondary}
                style={styles.input}
                maxLength={MESSAGE_BODY_MAX_LEN}
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
        ) : (
          // The gate: no composer until mutual verification. The send path enforces it too;
          // this panel is the honest UI for it.
          <Card style={{ ...styles.pendingPanel, marginBottom: Math.max(insets.bottom, Spacing.md) }}>
            <Text variant="rowTitle" color="text">
              {t('conversation.pendingTitle')}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.pendingBody}>
              {t('conversation.pendingBody', { name: contact.displayName })}
            </Text>
            <Button
              label={t('conversation.verifyCta')}
              onPress={() => router.push({ pathname: '/verify/[id]', params: { id: contact.id } })}
            />
          </Card>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The screen is full bleed so the thread's scroll indicator hugs the display edge instead
  // of overlapping the right aligned outgoing bubbles; the 20px gutter lives on the fixed
  // chrome (header, banners, composer) and on the list content instead.
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  // Same 40x40 box as the contact detail header, so the chevron does not jump when
  // navigating between the two screens.
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  callBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  callBtnDisabled: { opacity: 0.4 },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerInfoPressed: { opacity: 0.6 },
  headerText: { flex: 1, gap: 2 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  banner: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    marginHorizontal: Spacing.xl,
    gap: Spacing.xxs,
  },
  bannerText: { textAlign: 'center' },
  requestCard: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    marginHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  requestActions: { flexDirection: 'row', gap: Spacing.sm },
  requestBtn: { flex: 1 },
  pendingPanel: { gap: Spacing.sm, marginTop: Spacing.sm, marginHorizontal: Spacing.xl },
  pendingBody: { marginBottom: Spacing.xs },
  systemRow: { alignItems: 'center', paddingVertical: Spacing.xs, paddingHorizontal: Spacing.lg },
  systemText: { textAlign: 'center' },
  listGrow: { flexGrow: 1 },
  list: { flexGrow: 1, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, gap: Spacing.sm },
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
  // The bottom padding is applied inline: the safe area inset when the keyboard is closed,
  // Spacing.md against the keyboard when open.
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  lockGateWrap: { flex: 1, paddingHorizontal: Spacing.xl },
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
