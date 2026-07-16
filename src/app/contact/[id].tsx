import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RETENTION_MAX_SECONDS } from '@nuco/protocol';

import { Avatar, BottomSheet, Button, Card, ChevronLeft, ChevronRight, Phone, ReportSheet, Screen, SegmentedControl, Text, TextField, Toggle, VerifiedShield } from '@/ui';
import { useStartCall } from '@/calls/use-start-call';
import { useCall } from '@/state/call';
import {
  getContact,
  isMutuallyVerified,
  setBlocked,
  setMuted,
  type Contact,
} from '@/db/repos/contacts';
import { removeContact } from '@/services/contacts';
import { getConversation, type Conversation } from '@/db/repos/conversations';
import { biometricsAvailable } from '@/lock/biometrics';
import {
  changeChatCode,
  disableChatLock,
  enableChatLock,
  isChatUnlocked,
  removeLockAndDeleteMessages,
  setChatBio,
  unlockChatWithBiometrics,
  unlockChatWithCode,
} from '@/lock/chat-locks';
import {
  acceptRetention,
  acceptScreenshotProtection,
  cancelRetention,
  cancelScreenshotProtection,
  requestRetention,
  requestScreenshotProtection,
} from '@/services/messaging';
import { emitConversationsChanged, subscribeConversationsChanged } from '@/services/data-events';
import { retentionLabel } from '@/i18n/system-messages';
import { useScreenshotGuard } from '@/ui/use-screenshot-guard';
import { Colors, Overlay, Spacing } from '@/constants/theme';

const RETENTION_OPTIONS = [
  { seconds: 86400, key: 'retention.option24h' },
  { seconds: 604800, key: 'retention.option7d' },
  { seconds: 2592000, key: 'retention.option30d' },
  { seconds: 0, key: 'retention.optionOff' },
] as const;

// Units for the custom duration picker, ascending. The protocol caps a retention value at
// RETENTION_MAX_SECONDS (365 days), which bounds the input regardless of unit.
const CUSTOM_UNITS = [
  { key: 'minutes', seconds: 60, labelKey: 'retention.unitMinutes' },
  { key: 'hours', seconds: 3600, labelKey: 'retention.unitHours' },
  { key: 'days', seconds: 86400, labelKey: 'retention.unitDays' },
  { key: 'weeks', seconds: 604800, labelKey: 'retention.unitWeeks' },
] as const;

type CustomUnit = (typeof CUSTOM_UNITS)[number]['key'];

export default function ContactDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [screenshotSheetOpen, setScreenshotSheetOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('hours');
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [lockSheetOpen, setLockSheetOpen] = useState(false);
  const [lockCode, setLockCode] = useState('');
  const [lockCode2, setLockCode2] = useState('');
  const [lockBioAvailable, setLockBioAvailable] = useState(false);
  const [lockBioWanted, setLockBioWanted] = useState(false);
  const [lockBusy, setLockBusy] = useState<null | 'enable' | 'disable' | 'unlock' | 'change'>(null);
  const [lockManageUnlocked, setLockManageUnlocked] = useState(false);
  const [lockChangeMode, setLockChangeMode] = useState(false);
  const [lockWrongCode, setLockWrongCode] = useState(false);
  const startCall = useStartCall();
  const callStatus = useCall((s) => s.status);

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

  // Keep the conversation state live while the screen is open: a peer's accept or request
  // must update the screenshot enforcement and the pending cards without a refocus.
  useEffect(() => {
    return subscribeConversationsChanged((cid) => {
      if (cid !== undefined && cid !== id) return;
      void load();
    });
  }, [id, load]);

  const isVerified = contact != null && isMutuallyVerified(contact);
  const waitingForPeer = contact?.localConfirmedAt != null && contact.peerConfirmedAt == null;
  const verifiedDate =
    contact?.verifiedAt != null ? new Date(contact.verifiedAt).toLocaleDateString() : '';
  const retentionSeconds = conversation?.retentionSeconds ?? null;
  const pendingValue = conversation?.retentionPendingValue ?? null;
  const outgoingPending = !!conversation?.retentionPending && !conversation.retentionPendingIncoming;
  const incomingPending = !!conversation?.retentionPending && conversation.retentionPendingIncoming;

  const screenshotOn = conversation?.screenshotProtection === true;
  const screenshotPendingValue = conversation?.screenshotPendingValue ?? null;
  const screenshotOutgoingPending = !!conversation?.screenshotPending && !conversation.screenshotPendingIncoming;
  const screenshotIncomingPending = !!conversation?.screenshotPending && conversation.screenshotPendingIncoming;

  // This screen shows the protected conversation's content (name, verification state), so it
  // is covered by the same agreement as the chat screen itself.
  useScreenshotGuard(screenshotOn, 'nuco-contact');

  const isCustomCurrent =
    retentionSeconds != null &&
    retentionSeconds > 0 &&
    !RETENTION_OPTIONS.some((opt) => opt.seconds === retentionSeconds);

  const customParsed = parseInt(customValue, 10);
  const customUnitSeconds = CUSTOM_UNITS.find((u) => u.key === customUnit)?.seconds ?? 3600;
  const customSeconds = Number.isInteger(customParsed) ? customParsed * customUnitSeconds : 0;
  const customValid =
    Number.isInteger(customParsed) && customParsed >= 1 && customSeconds <= RETENTION_MAX_SECONDS;

  function openSheet() {
    setCustomMode(false);
    setSheetOpen(true);
  }

  function openCustom() {
    // Pre-fill from the current value when it is already a custom one, decomposed by the
    // largest unit that divides it exactly (matching how retentionLabel renders it).
    const current = retentionSeconds;
    const unit =
      isCustomCurrent && current != null
        ? [...CUSTOM_UNITS].reverse().find((u) => current % u.seconds === 0)
        : undefined;
    if (unit && current != null) {
      setCustomUnit(unit.key);
      setCustomValue(String(current / unit.seconds));
    } else {
      setCustomUnit('hours');
      setCustomValue('');
    }
    setCustomMode(true);
  }

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

  function onDelete() {
    if (!contact) return;
    Alert.alert(
      t('contactDetail.deleteConfirmTitle'),
      t('contactDetail.deleteConfirmBody', { name: contact.displayName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contactDetail.deleteContact'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              // removeContact also wipes the peer's Signal session and confirm state, so
              // a later re-add runs the clean first-scan verification flow.
              await removeContact(contact);
              emitConversationsChanged();
              // Not router.back(): this screen is often reached through a replace chain
              // (scan, verify), where back() is a no-op and would leave a detail page for
              // a row that no longer exists.
              router.replace('/(tabs)/contacts');
            })();
          },
        },
      ],
      { cancelable: true },
    );
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

  async function onRequestScreenshot() {
    setScreenshotSheetOpen(false);
    if (!contact) return;
    await requestScreenshotProtection({ id: contact.id, handle: contact.handle }, !screenshotOn);
    await load();
  }

  async function onCancelScreenshot() {
    setScreenshotSheetOpen(false);
    if (!contact) return;
    await cancelScreenshotProtection({ id: contact.id, handle: contact.handle });
    await load();
  }

  async function onAcceptScreenshotIncoming() {
    if (!contact || screenshotPendingValue == null) return;
    await acceptScreenshotProtection({ id: contact.id, handle: contact.handle }, screenshotPendingValue);
    await load();
  }

  async function onDeclineScreenshotIncoming() {
    if (!contact) return;
    await cancelScreenshotProtection({ id: contact.id, handle: contact.handle });
    await load();
  }

  // ---- per chat lock (local only, never negotiated with the peer) ----

  const lockOn = conversation?.lockEnabled === true;
  const lockCodeValid = /^\d{6}$/.test(lockCode) && lockCode === lockCode2;
  const lockLockedOut = (conversation?.lockLockoutUntil ?? 0) > Date.now();

  function openLockSheet() {
    setLockCode('');
    setLockCode2('');
    setLockWrongCode(false);
    setLockChangeMode(false);
    setLockBioWanted(false);
    setLockManageUnlocked(contact ? isChatUnlocked(contact.id) : false);
    void biometricsAvailable().then(setLockBioAvailable);
    setLockSheetOpen(true);
  }

  async function onEnableLock() {
    if (!contact || !lockCodeValid) return;
    setLockBusy('enable');
    try {
      await enableChatLock(contact.id, lockCode, lockBioWanted && lockBioAvailable);
      await load();
      emitConversationsChanged(contact.id);
      setLockSheetOpen(false);
    } catch {
      setLockWrongCode(true);
    }
    setLockBusy(null);
  }

  async function onUnlockManage(useBio: boolean) {
    if (!contact) return;
    setLockBusy('unlock');
    const ok = useBio
      ? await unlockChatWithBiometrics(contact.id, t('chatLock.biometricPrompt'))
      : await unlockChatWithCode(contact.id, lockCode);
    setLockBusy(null);
    setLockCode('');
    if (ok) {
      setLockManageUnlocked(true);
      setLockWrongCode(false);
    } else {
      setLockWrongCode(!useBio);
    }
    await load();
  }

  async function onChangeCode() {
    if (!contact || !lockCodeValid) return;
    setLockBusy('change');
    try {
      await changeChatCode(contact.id, lockCode);
      setLockChangeMode(false);
      setLockCode('');
      setLockCode2('');
    } catch {
      // Chat got relocked underneath (app lock): fall back to the unlock step.
      setLockManageUnlocked(false);
    }
    setLockBusy(null);
  }

  async function onToggleLockBio(value: boolean) {
    if (!contact) return;
    try {
      await setChatBio(contact.id, value);
      await load();
    } catch {
      setLockManageUnlocked(false);
    }
  }

  function onRemoveLock() {
    if (!contact) return;
    Alert.alert(t('chatLock.removeLock'), t('chatLock.removeLockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chatLock.removeLock'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLockBusy('disable');
            try {
              await disableChatLock(contact.id);
              await load();
              emitConversationsChanged(contact.id);
              setLockSheetOpen(false);
            } catch {
              setLockManageUnlocked(false);
            }
            setLockBusy(null);
          })();
        },
      },
    ]);
  }

  function onForgotCode() {
    if (!contact) return;
    Alert.alert(t('chatLock.forgotCode'), t('chatLock.forgotCodeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chatLock.forgotCodeCta'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeLockAndDeleteMessages(contact.id);
            await load();
            emitConversationsChanged(contact.id);
            setLockSheetOpen(false);
          })();
        },
      },
    ]);
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

          <View style={styles.ctaRow}>
            <Button
              label={t('contactDetail.message')}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: contact.id } })}
              style={styles.ctaBtn}
              glow={false}
            />
            {contact.blocked ? null : (
              <Button
                label={t('call.action')}
                variant="secondary"
                icon={<Phone size={18} color={Colors.text} />}
                onPress={() =>
                  void startCall({
                    id: contact.id,
                    handle: contact.handle,
                    displayName: contact.displayName,
                    blocked: contact.blocked,
                  })
                }
                disabled={callStatus !== 'idle'}
                style={styles.ctaBtn}
              />
            )}
          </View>

          <Card style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <Text variant="label">{t('contactDetail.muteNotifications')}</Text>
              <Toggle value={contact.muted} onChange={onToggleMute} />
            </View>
            <View style={styles.divider} />
            <Pressable style={styles.settingRow} onPress={openSheet}>
              <Text variant="label">{t('contactDetail.disappearingMessages')}</Text>
              <View style={styles.settingValue}>
                <Text variant="label" color={outgoingPending ? 'accent' : 'textSecondary'}>
                  {retentionLabel(outgoingPending ? pendingValue ?? 0 : retentionSeconds ?? 0, t)}
                </Text>
                {outgoingPending ? (
                  <Text variant="caption" color="textTertiary">
                    {t('retention.pending')}
                  </Text>
                ) : null}
                <ChevronRight size={18} color={Colors.textTertiary} />
              </View>
            </Pressable>
            <View style={styles.divider} />
            <Pressable style={styles.settingRow} onPress={() => setScreenshotSheetOpen(true)}>
              <Text variant="label">{t('contactDetail.screenshotProtection')}</Text>
              <View style={styles.settingValue}>
                <Text variant="label" color={screenshotOutgoingPending ? 'accent' : 'textSecondary'}>
                  {t(
                    (screenshotOutgoingPending ? screenshotPendingValue === true : screenshotOn)
                      ? 'screenshot.stateOn'
                      : 'screenshot.stateOff',
                  )}
                </Text>
                {screenshotOutgoingPending ? (
                  <Text variant="caption" color="textTertiary">
                    {t('screenshot.pending')}
                  </Text>
                ) : null}
                <ChevronRight size={18} color={Colors.textTertiary} />
              </View>
            </Pressable>
            <View style={styles.divider} />
            <Pressable style={styles.settingRow} onPress={openLockSheet}>
              <Text variant="label">{t('chatLock.title')}</Text>
              <View style={styles.settingValue}>
                <Text variant="label" color="textSecondary">
                  {t(lockOn ? 'chatLock.stateOn' : 'chatLock.stateOff')}
                </Text>
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
                {t('retention.incomingBody', { name: contact.displayName, value: retentionLabel(pendingValue ?? 0, t) })}
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

          {screenshotIncomingPending ? (
            <Card tone="accent" style={styles.incomingCard}>
              <Text variant="label" color="accent">
                {t(screenshotPendingValue === true ? 'screenshot.incomingTitleOn' : 'screenshot.incomingTitleOff', {
                  name: contact.displayName,
                })}
              </Text>
              <Text variant="bodySecondary" color="textOnCard" style={styles.incomingBody}>
                {t(screenshotPendingValue === true ? 'screenshot.incomingBodyOn' : 'screenshot.incomingBodyOff')}
              </Text>
              <View style={styles.incomingActions}>
                <Button label={t('screenshot.accept')} onPress={onAcceptScreenshotIncoming} style={styles.incomingBtn} />
                <Button
                  label={t('screenshot.decline')}
                  variant="secondary"
                  onPress={onDeclineScreenshotIncoming}
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
            <>
              {waitingForPeer ? (
                <Text variant="bodySecondary" color="textSecondary" style={styles.waitingHint}>
                  {t('contactDetail.waitingForPeer', { name: contact.displayName })}
                </Text>
              ) : null}
              <Button
                label={t('contacts.verify')}
                onPress={() => router.push({ pathname: '/verify/[id]', params: { id: contact.id } })}
                style={styles.verifyCta}
              />
            </>
          )}

          <Card tone="danger" style={styles.dangerCard}>
            <View style={styles.dangerRow}>
              <Text variant="label" color="dangerSoft">
                {t('contactDetail.blockContact')}
              </Text>
              <Toggle value={contact.blocked} onChange={onToggleBlock} />
            </View>
            <View style={styles.dangerDivider} />
            <Pressable onPress={() => setReportSheetOpen(true)} style={styles.deleteRow}>
              <Text variant="label" color="dangerSoft">
                {t('report.reportContact')}
              </Text>
            </Pressable>
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
                value: retentionLabel(pendingValue ?? 0, t),
              })}
            </Text>
            <Button label={t('retention.cancelRequest')} variant="secondary" onPress={onCancelRetention} />
          </View>
        ) : customMode ? (
          <View style={styles.customPanel}>
            <TextField
              value={customValue}
              onChangeText={(v) => setCustomValue(v.replace(/\D+/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder={t('retention.customValuePlaceholder')}
            />
            <SegmentedControl
              options={CUSTOM_UNITS.map((u) => ({ key: u.key, label: t(u.labelKey) }))}
              value={customUnit}
              onChange={(key) => setCustomUnit(key as CustomUnit)}
            />
            <Text variant="caption" color="textTertiary">
              {t('retention.customRange')}
            </Text>
            <Button
              label={t('retention.set')}
              disabled={!customValid}
              onPress={() => void onPickRetention(customSeconds)}
            />
            <Button label={t('common.back')} variant="ghost" onPress={() => setCustomMode(false)} />
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
            <Pressable style={styles.optionRow} onPress={openCustom}>
              <Text variant="label" color={isCustomCurrent ? 'accent' : 'text'}>
                {t('retention.customOption')}
              </Text>
              <View style={styles.customCurrent}>
                {isCustomCurrent && retentionSeconds != null ? (
                  <Text variant="label" color="textSecondary">
                    {retentionLabel(retentionSeconds, t)}
                  </Text>
                ) : null}
                {isCustomCurrent ? (
                  <View style={styles.selectedDot} />
                ) : (
                  <ChevronRight size={18} color={Colors.textTertiary} />
                )}
              </View>
            </Pressable>
          </View>
        )}
      </BottomSheet>

      <BottomSheet
        visible={screenshotSheetOpen}
        title={t('screenshot.title')}
        onClose={() => setScreenshotSheetOpen(false)}
      >
        {screenshotOutgoingPending ? (
          <View style={styles.sheetPending}>
            <Text variant="bodySecondary" color="textSecondary" style={styles.sheetWaiting}>
              {t(screenshotPendingValue === true ? 'screenshot.waitingOn' : 'screenshot.waitingOff', {
                name: contact?.displayName ?? '',
              })}
            </Text>
            <Button label={t('screenshot.cancelRequest')} variant="secondary" onPress={onCancelScreenshot} />
          </View>
        ) : (
          <View style={styles.screenshotPanel}>
            <Text variant="bodySecondary" color="textSecondary">
              {t('screenshot.body', { name: contact?.displayName ?? '' })}
            </Text>
            <Text variant="caption" color="textTertiary">
              {t('screenshot.photoCaveat')}
            </Text>
            <Button
              label={t(screenshotOn ? 'screenshot.requestOff' : 'screenshot.requestOn')}
              onPress={() => void onRequestScreenshot()}
            />
          </View>
        )}
      </BottomSheet>

      <ReportSheet
        visible={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        contact={contact}
        context="contact"
        onBlocked={() => {
          if (contact) setContact({ ...contact, blocked: true });
        }}
      />

      <BottomSheet visible={lockSheetOpen} title={t('chatLock.title')} onClose={() => setLockSheetOpen(false)}>
        {!lockOn ? (
          // Enable: pick a mandatory six digit code, optionally add Face ID on top.
          <View style={styles.lockPanel}>
            <Text variant="bodySecondary" color="textSecondary">
              {t('chatLock.sheetBody')}
            </Text>
            <Text variant="caption" color="textTertiary">
              {t('chatLock.localOnlyNote', { name: contact?.displayName ?? '' })}
            </Text>
            <TextField
              value={lockCode}
              onChangeText={(v) => setLockCode(v.replace(/\D+/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              placeholder={t('chatLock.codePlaceholder')}
            />
            <TextField
              value={lockCode2}
              onChangeText={(v) => setLockCode2(v.replace(/\D+/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              placeholder={t('chatLock.codeConfirmPlaceholder')}
            />
            {lockCode2.length >= lockCode.length && lockCode2.length > 0 && lockCode !== lockCode2 ? (
              <Text variant="caption" color="danger">
                {t('chatLock.codeMismatch')}
              </Text>
            ) : null}
            {lockBioAvailable ? (
              <View style={styles.lockToggleRow}>
                <Text variant="label">{t('chatLock.useFaceId')}</Text>
                <Toggle value={lockBioWanted} onChange={setLockBioWanted} />
              </View>
            ) : null}
            <Text variant="caption" color="textTertiary">
              {t('chatLock.forgotWarning')}
            </Text>
            <Button
              label={t('chatLock.enableCta')}
              disabled={!lockCodeValid}
              loading={lockBusy === 'enable'}
              onPress={() => void onEnableLock()}
            />
          </View>
        ) : !lockManageUnlocked ? (
          // Manage while locked: release the key first (code or Face ID), or take the
          // destructive forgot-code exit.
          <View style={styles.lockPanel}>
            <Text variant="bodySecondary" color="textSecondary">
              {t('chatLock.manageLockedBody')}
            </Text>
            {lockLockedOut ? (
              <Text variant="caption" color="danger">
                {t('chatLock.lockedOutBody')}
              </Text>
            ) : (
              <>
                <TextField
                  value={lockCode}
                  onChangeText={(v) => setLockCode(v.replace(/\D+/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  secureTextEntry
                  placeholder={t('chatLock.codePlaceholder')}
                />
                {lockWrongCode ? (
                  <Text variant="caption" color="danger">
                    {t('chatLock.wrongCode')}
                  </Text>
                ) : null}
                <Button
                  label={t('chatLock.unlockCta')}
                  disabled={lockCode.length !== 6}
                  loading={lockBusy === 'unlock'}
                  onPress={() => void onUnlockManage(false)}
                />
                {conversation?.lockBioEnabled && lockBioAvailable ? (
                  <Button
                    label={t('chatLock.useBiometrics')}
                    variant="ghost"
                    onPress={() => void onUnlockManage(true)}
                  />
                ) : null}
              </>
            )}
            <Button label={t('chatLock.forgotCode')} variant="ghost" onPress={onForgotCode} />
          </View>
        ) : lockChangeMode ? (
          <View style={styles.lockPanel}>
            <TextField
              value={lockCode}
              onChangeText={(v) => setLockCode(v.replace(/\D+/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              placeholder={t('chatLock.codePlaceholder')}
            />
            <TextField
              value={lockCode2}
              onChangeText={(v) => setLockCode2(v.replace(/\D+/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              placeholder={t('chatLock.codeConfirmPlaceholder')}
            />
            {lockCode2.length >= lockCode.length && lockCode2.length > 0 && lockCode !== lockCode2 ? (
              <Text variant="caption" color="danger">
                {t('chatLock.codeMismatch')}
              </Text>
            ) : null}
            <Button
              label={t('chatLock.changeCode')}
              disabled={!lockCodeValid}
              loading={lockBusy === 'change'}
              onPress={() => void onChangeCode()}
            />
            <Button label={t('common.back')} variant="ghost" onPress={() => setLockChangeMode(false)} />
          </View>
        ) : (
          <View style={styles.lockPanel}>
            {lockBioAvailable ? (
              <View style={styles.lockToggleRow}>
                <Text variant="label">{t('chatLock.useFaceId')}</Text>
                <Toggle value={conversation?.lockBioEnabled === true} onChange={(v) => void onToggleLockBio(v)} />
              </View>
            ) : null}
            <Button
              label={t('chatLock.changeCode')}
              variant="secondary"
              onPress={() => {
                setLockCode('');
                setLockCode2('');
                setLockChangeMode(true);
              }}
            />
            <Button
              label={t('chatLock.removeLock')}
              variant="destructive"
              loading={lockBusy === 'disable'}
              onPress={onRemoveLock}
            />
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
  ctaRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  ctaBtn: { flex: 1 },
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
  waitingHint: { textAlign: 'center', marginTop: Spacing.lg },
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
  screenshotPanel: { gap: Spacing.lg },
  lockPanel: { gap: Spacing.md },
  lockToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  customPanel: { gap: Spacing.lg },
  customCurrent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
