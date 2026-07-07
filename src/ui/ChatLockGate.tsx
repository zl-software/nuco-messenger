// The in place unlock surface for a chat with the per chat lock on. Rendered by the chat
// screen instead of the thread and composer; a successful unlock releases the chat's
// private key into the chat-locks registry and hands control back via onUnlocked. Mirrors
// the app lock screen UX: auto biometric attempt once (when enabled for this chat), six
// digit code fallback, attempts counter, and a persisted timed lockout.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors, Spacing } from '@/constants/theme';
import { getConversation } from '@/db/repos/conversations';
import { biometricsAvailable } from '@/lock/biometrics';
import {
  CHAT_LOCK_MAX_ATTEMPTS,
  unlockChatWithBiometrics,
  unlockChatWithCode,
} from '@/lock/chat-locks';
import { Button } from './Button';
import { Text } from './Text';
import { PinDots, PinKeypad, PIN_LENGTH } from './PinPad';
import { FaceId, Lock } from './icons';

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ChatLockGate({
  conversationId,
  bioEnabled,
  onUnlocked,
}: {
  conversationId: string;
  bioEnabled: boolean;
  onUnlocked: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [canUseBio, setCanUseBio] = useState(false);
  const triedBio = useRef(false);

  const refreshLockState = useCallback(async () => {
    const convo = await getConversation(conversationId);
    if (convo) {
      setFailedAttempts(convo.lockFailedAttempts);
      setLockoutUntil(convo.lockLockoutUntil);
    }
  }, [conversationId]);

  const tryBiometrics = useCallback(async () => {
    setBusy(true);
    const ok = await unlockChatWithBiometrics(conversationId, t('chatLock.biometricPrompt'));
    if (ok) {
      onUnlocked();
      return;
    }
    setBusy(false);
  }, [conversationId, onUnlocked, t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await refreshLockState();
      const available = bioEnabled && (await biometricsAvailable());
      if (!active) return;
      setCanUseBio(available);
      if (available && !triedBio.current) {
        triedBio.current = true;
        await tryBiometrics();
      }
    })();
    return () => {
      active = false;
    };
  }, [bioEnabled, refreshLockState, tryBiometrics]);

  const lockoutMs = Math.max(0, lockoutUntil - now);

  // Tick the lockout countdown while it is active.
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockoutMs]);

  const submitCode = useCallback(
    (value: string) => {
      setBusy(true);
      // Two frames so the sixth dot and the spinner paint before scrypt blocks the JS
      // thread (same pattern as the app lock screen).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void (async () => {
            const ok = await unlockChatWithCode(conversationId, value);
            if (ok) {
              onUnlocked();
              return;
            }
            await refreshLockState();
            setBusy(false);
            setError(true);
            setCode('');
            setNow(Date.now());
          })();
        });
      });
    },
    [conversationId, onUnlocked, refreshLockState],
  );

  const onDigit = useCallback(
    (digit: string) => {
      if (busy || lockoutMs > 0) return;
      setError(false);
      setCode((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
    },
    [busy, lockoutMs],
  );

  useEffect(() => {
    if (code.length === PIN_LENGTH && !busy) submitCode(code);
  }, [code, busy, submitCode]);

  const onDelete = useCallback(() => {
    setError(false);
    setCode((prev) => prev.slice(0, -1));
  }, []);

  if (lockoutMs > 0) {
    return (
      <View style={styles.center}>
        <Lock size={40} color={Colors.accent} />
        <Text variant="title" color="text" style={styles.centerText}>
          {t('chatLock.lockedOutTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.centerText}>
          {t('chatLock.lockedOutBody')}
        </Text>
        <Text variant="display" color="text">
          {formatRemaining(lockoutMs)}
        </Text>
      </View>
    );
  }

  const attemptsLeft = Math.max(0, CHAT_LOCK_MAX_ATTEMPTS - failedAttempts);

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Lock size={40} color={Colors.accent} />
        <View style={styles.head}>
          <Text variant="title" color="text" style={styles.centerText}>
            {t('chatLock.unlockTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary" style={styles.centerText}>
            {t('chatLock.unlockBody')}
          </Text>
        </View>
        <PinDots filled={code.length} error={error} />
        <View style={styles.status}>
          {busy ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : error ? (
            <Text variant="caption" color="danger">
              {t('chatLock.attemptsLeft', { count: attemptsLeft })}
            </Text>
          ) : (
            <Text variant="caption" color="textTertiary">
              {' '}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.bottom}>
        <PinKeypad onDigit={onDigit} onDelete={onDelete} showLetters={false} />
        {canUseBio ? (
          <Button
            label={t('chatLock.useBiometrics')}
            variant="ghost"
            onPress={() => void tryBiometrics()}
            disabled={busy}
            icon={<FaceId size={20} color={Colors.accent} />}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'space-between', paddingVertical: Spacing.xxl },
  top: { alignItems: 'center', gap: Spacing.xl, marginTop: Spacing.xxl },
  head: { alignItems: 'center', gap: Spacing.sm },
  status: { minHeight: 22, alignItems: 'center', justifyContent: 'center' },
  bottom: { alignItems: 'center', gap: Spacing.lg, paddingBottom: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xxl },
  centerText: { textAlign: 'center' },
});
