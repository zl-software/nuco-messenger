// The report sheet: flag a contact (or one of their messages) to the relay operator.
// Reports are metadata only (see services/report.ts); the sheet says so plainly. The
// "also block" toggle applies locally and immediately on submit, so blocking is never
// hostage to the network; the report itself fails visibly and the user can retry.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LIMITS, REPORT_CATEGORIES, type ReportCategory, type ReportContext } from '@nuco/protocol';

import { setBlocked } from '@/db/repos/contacts';
import { REPORT_ERROR_CODES, submitReport } from '@/services/report';
import { Colors, Overlay, Spacing } from '@/constants/theme';

import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';
import { Toggle } from './Toggle';

const CATEGORY_KEYS = {
  spam: 'report.categorySpam',
  harassment: 'report.categoryHarassment',
  illegal: 'report.categoryIllegal',
  other: 'report.categoryOther',
} as const satisfies Record<ReportCategory, string>;

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  contact: { id: string; handle: string; displayName: string; blocked: boolean } | null;
  context: ReportContext;
  // Fired after the "also block" toggle applied, so the parent can refresh its contact row.
  onBlocked?: () => void;
}

export function ReportSheet({ visible, onClose, contact, context, onBlocked }: ReportSheetProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [comment, setComment] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh state per opening; "also block" defaults on for a not yet blocked contact.
  useEffect(() => {
    if (!visible) return;
    setCategory(null);
    setComment('');
    setAlsoBlock(true);
    setBusy(false);
    setSent(false);
    setError(null);
  }, [visible]);

  async function onSubmit() {
    if (!contact || category == null) return;
    setBusy(true);
    setError(null);
    if (alsoBlock && !contact.blocked) {
      await setBlocked(contact.id, true);
      onBlocked?.();
    }
    try {
      await submitReport({ handle: contact.handle, category, comment, context });
      setSent(true);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      // find (not includes) so the matched code keeps its literal type for the typed keys.
      const known = REPORT_ERROR_CODES.find((k) => k === code);
      setError(known ? t(`errors.${known}`) : t('report.sendFailed'));
    }
    setBusy(false);
  }

  return (
    <BottomSheet visible={visible} title={t('report.title')} onClose={onClose}>
      {sent ? (
        <View style={styles.panel}>
          <Text variant="label" color="accent">
            {t('report.sentTitle')}
          </Text>
          <Text variant="bodySecondary" color="textSecondary">
            {t('report.sentBody')}
          </Text>
          <Button label={t('common.done')} onPress={onClose} />
        </View>
      ) : (
        <View style={styles.panel}>
          <Text variant="bodySecondary" color="textSecondary">
            {t('report.body', { name: contact?.displayName ?? '' })}
          </Text>
          <View>
            {REPORT_CATEGORIES.map((c) => (
              <Pressable key={c} style={styles.optionRow} onPress={() => setCategory(c)}>
                <Text variant="label" color={category === c ? 'accent' : 'text'}>
                  {t(CATEGORY_KEYS[c])}
                </Text>
                {category === c ? <View style={styles.selectedDot} /> : null}
              </Pressable>
            ))}
          </View>
          <TextField
            value={comment}
            onChangeText={setComment}
            placeholder={t('report.commentPlaceholder')}
            maxLength={LIMITS.reportCommentMaxLen}
            multiline
          />
          {contact && !contact.blocked ? (
            <View style={styles.toggleRow}>
              <Text variant="label">{t('report.alsoBlock', { name: contact.displayName })}</Text>
              <Toggle value={alsoBlock} onChange={setAlsoBlock} />
            </View>
          ) : null}
          {error ? (
            <Text variant="caption" color="danger">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('report.submit')}
            disabled={category == null}
            loading={busy}
            onPress={() => void onSubmit()}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.lg },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Overlay.hairlineSoft,
  },
  selectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
