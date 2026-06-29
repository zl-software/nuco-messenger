import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Avatar, Button, Card, Screen, Text, TextField, VerifiedShield } from '@/ui';
import { setDisplayNameDraft } from '@/services/onboarding';
import { Colors, Spacing } from '@/constants/theme';

export default function NameScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');

  const trimmed = name.trim();
  const canContinue = trimmed.length > 0;

  function onContinue() {
    if (!canContinue) return;
    setDisplayNameDraft(trimmed);
    router.push('/(onboarding)/keygen');
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.body}>
        <Text variant="title" style={styles.title}>
          {t('onboarding.nameTitle')}
        </Text>
        <Text variant="bodySecondary" color="textSecondary" style={styles.helper}>
          {t('onboarding.nameHelper')}
        </Text>

        <TextField
          value={name}
          onChangeText={setName}
          placeholder={t('onboarding.namePlaceholder')}
          maxLength={40}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={onContinue}
          style={styles.field}
        />

        <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
          {t('onboarding.nameSection')}
        </Text>
        <Card>
          <View style={styles.preview}>
            <Avatar name={trimmed || t('onboarding.namePlaceholder')} size={44} />
            <View style={styles.previewText}>
              <View style={styles.previewName}>
                <Text variant="rowTitle" numberOfLines={1}>
                  {trimmed || t('onboarding.namePlaceholder')}
                </Text>
                <VerifiedShield size={14} color={Colors.accent} />
              </View>
            </View>
          </View>
        </Card>
      </View>

      <Button label={t('common.continue')} onPress={onContinue} disabled={!canContinue} style={styles.cta} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, justifyContent: 'space-between' },
  body: { flex: 1, paddingTop: Spacing.xxl },
  title: { marginBottom: Spacing.sm },
  helper: { marginBottom: Spacing.xl },
  field: { fontSize: 17 },
  eyebrow: { marginTop: Spacing.xxl, marginBottom: Spacing.sm },
  preview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  previewText: { flex: 1 },
  previewName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cta: { marginBottom: Spacing.lg },
});
