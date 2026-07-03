// The call surface: a root level overlay mounted above the navigation stack (never a
// route, so it cannot be pushed away or popped by the back gesture) plus the mic soft ask
// sheet. Renders only while a call is in progress; the lock guard is belt and suspenders,
// the receive path already never rings while locked and the pre lock hook ends any call
// before the lock lands.

import { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMicrophonePermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';

import { Avatar, BottomSheet, Button, MicOff, Phone, PhoneDown, Speaker, Text } from '@/ui';
import { Colors, Overlay, Spacing, accentGlow } from '@/constants/theme';
import { formatCallDuration } from '@/i18n/system-messages';
import { getCallController } from '@/services/calls';
import { useCall } from '@/state/call';
import { useSession } from '@/state/session';
import { beginCall } from './use-start-call';
import type { CallUiEndReason } from './types';

type EndReasonKey =
  | 'call.statusEnded'
  | 'call.statusDeclined'
  | 'call.statusBusy'
  | 'call.statusNoAnswer'
  | 'call.statusCanceled'
  | 'call.statusConnectionLost'
  | 'call.errorNoTurn'
  | 'call.errorMic'
  | 'call.errorGeneric';

function endReasonKey(reason: CallUiEndReason): EndReasonKey {
  switch (reason) {
    case 'ended':
      return 'call.statusEnded';
    case 'declined':
      return 'call.statusDeclined';
    case 'busy':
      return 'call.statusBusy';
    case 'no-answer':
      return 'call.statusNoAnswer';
    case 'canceled':
      return 'call.statusCanceled';
    case 'connection-lost':
      return 'call.statusConnectionLost';
    case 'no-turn':
      return 'call.errorNoTurn';
    case 'mic-failed':
      return 'call.errorMic';
    case 'failed':
      return 'call.errorGeneric';
  }
}

export function CallHost() {
  const { t } = useTranslation();
  const call = useCall();
  const lockStatus = useSession((s) => s.lockStatus);
  const [, requestMicPermission] = useMicrophonePermissions();

  const inCall = call.status !== 'idle';

  // Consume Android back while the surface is up: leaving a call takes an explicit button.
  useEffect(() => {
    if (!inCall) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [inCall]);

  // A 1s tick drives the duration label while media is up.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (call.status !== 'active' && call.status !== 'reconnecting') return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [call.status]);

  if (lockStatus !== 'unlocked') return null;

  const micPrompt = call.micPrompt;
  const micSheet = (
    <BottomSheet
      visible={micPrompt !== null}
      title={t('call.micSoftAskTitle')}
      onClose={() => useCall.getState().setMicPrompt(null)}
    >
      <View style={styles.sheetBody}>
        <Text variant="bodySecondary" color="textSecondary">
          {t('call.micSoftAskBody')}
        </Text>
        <Button
          label={t('call.micAllow')}
          onPress={() => {
            const contact = micPrompt?.contact;
            if (!contact) return;
            void requestMicPermission().then((res) => {
              useCall.getState().setMicPrompt(null);
              if (res.granted) {
                void beginCall(contact, t);
              } else if (!res.canAskAgain) {
                // The OS will not prompt again (permanently denied): point at settings
                // instead of failing silently.
                Alert.alert(t('call.micDeniedTitle'), t('call.micDeniedBody'));
              }
            });
          }}
        />
      </View>
    </BottomSheet>
  );

  if (!inCall) return micSheet;

  const incoming = call.status === 'incoming-ringing';
  const ending = call.status === 'ending';
  const mediaUp = call.status === 'active' || call.status === 'reconnecting';
  const controller = getCallController();

  const statusLine = (() => {
    switch (call.status) {
      case 'starting':
        return t('call.statusStarting');
      case 'outgoing-ringing':
        return t('call.statusRinging');
      case 'incoming-ringing':
        return t('call.statusIncoming');
      case 'connecting':
        return t('call.statusConnecting');
      case 'reconnecting':
        return t('call.statusReconnecting');
      case 'active':
        return call.activeSince ? formatCallDuration((Date.now() - call.activeSince) / 1000) : t('call.statusConnecting');
      case 'ending':
        return call.endReason ? t(endReasonKey(call.endReason), { name: call.contactName }) : t('call.statusEnded');
      default:
        return '';
    }
  })();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <LinearGradient colors={[Colors.backgroundTop, Colors.background]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.hero}>
          <Avatar name={call.contactName} size={88} />
          <Text variant="section" color="text" style={styles.name}>
            {call.contactName}
          </Text>
          <Text variant="monoCaption" color={ending ? 'textSecondary' : 'accent'}>
            {statusLine}
          </Text>
          {mediaUp ? (
            <Text variant="caption" color="textTertiary">
              {t('call.statusEncrypted')}
            </Text>
          ) : null}
        </View>

        {ending ? null : incoming ? (
          <View style={styles.actionRow}>
            <View style={styles.actionCol}>
              <Pressable style={[styles.roundBtn, styles.declineBtn]} onPress={() => controller.decline()}>
                <PhoneDown size={26} color={Colors.dangerSoft} />
              </Pressable>
              <Text variant="caption" color="textSecondary">
                {t('call.decline')}
              </Text>
            </View>
            <View style={styles.actionCol}>
              <Pressable style={[styles.roundBtn, styles.answerBtn, accentGlow]} onPress={() => void controller.answer()}>
                <Phone size={26} color={Colors.accentInk} />
              </Pressable>
              <Text variant="caption" color="textSecondary">
                {t('call.answer')}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <View style={styles.actionCol}>
              <Pressable
                style={[styles.roundBtn, styles.toggleBtn, call.muted ? styles.toggleBtnOn : null]}
                onPress={() => controller.setMuted(!call.muted)}
                disabled={!mediaUp && call.status !== 'connecting'}
              >
                <MicOff size={24} color={call.muted ? Colors.accent : Colors.text} />
              </Pressable>
              <Text variant="caption" color="textSecondary">
                {t('call.mute')}
              </Text>
            </View>
            <View style={styles.actionCol}>
              <Pressable style={[styles.roundBtn, styles.hangUpBtn]} onPress={() => controller.hangUp()}>
                <PhoneDown size={28} color={Colors.text} />
              </Pressable>
              <Text variant="caption" color="textSecondary">
                {t('call.hangUp')}
              </Text>
            </View>
            <View style={styles.actionCol}>
              <Pressable
                style={[styles.roundBtn, styles.toggleBtn, call.speaker ? styles.toggleBtnOn : null]}
                onPress={() => controller.setSpeaker(!call.speaker)}
              >
                <Speaker size={24} color={call.speaker ? Colors.accent : Colors.text} />
              </Pressable>
              <Text variant="caption" color="textSecondary">
                {t('call.speaker')}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
      {micSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: Spacing.md, marginTop: '28%', paddingHorizontal: Spacing.xxl },
  name: { textAlign: 'center' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.huge,
    paddingBottom: Spacing.huge,
  },
  actionCol: { alignItems: 'center', gap: Spacing.sm },
  roundBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBtn: { backgroundColor: Colors.accent },
  declineBtn: { backgroundColor: Overlay.danger14, borderWidth: 1, borderColor: Overlay.dangerBorder },
  hangUpBtn: { backgroundColor: Colors.danger },
  toggleBtn: { backgroundColor: Colors.surface2, borderWidth: 1, borderColor: Overlay.hairline },
  toggleBtnOn: { borderColor: Colors.accent, backgroundColor: Overlay.accent16 },
  sheetBody: { gap: Spacing.lg },
});
