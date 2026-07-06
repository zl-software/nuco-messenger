// First run tutorial: four swipeable slides covering connecting in person, verification,
// disappearing messages, and the lock. Shown once after onboarding (and once to existing
// installs on their next unlock), replayable anytime from Settings.

import { useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Clock, FaceId, QrIcon, Screen, Text, VerifiedShield } from '@/ui';
import { useSettings } from '@/state/settings';
import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

const SLIDES = [
  { Icon: QrIcon, title: 'tutorial.connectTitle', body: 'tutorial.connectBody' },
  { Icon: VerifiedShield, title: 'tutorial.verifyTitle', body: 'tutorial.verifyBody' },
  { Icon: Clock, title: 'tutorial.disappearTitle', body: 'tutorial.disappearBody' },
  { Icon: FaceId, title: 'tutorial.privacyTitle', body: 'tutorial.privacyBody' },
] as const;

export default function TutorialScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const update = useSettings((s) => s.update);
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const last = index === SLIDES.length - 1;

  function finish() {
    void update({ tutorialSeen: true });
    // Pushed from Settings there is history to pop; from onboarding or the boot funnel this
    // screen was replaced in, so head to the chats tab.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chats');
  }

  function onNext() {
    if (last) {
      finish();
      return;
    }
    const next = index + 1;
    // Set the index directly: programmatic scrolls do not reliably fire momentum end on
    // Android, and the dots must not lag the button.
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  }

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <Screen glow contentStyle={styles.content}>
      <View style={styles.header}>
        {last ? null : <Button label={t('tutorial.skip')} variant="ghost" onPress={finish} />}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.pager}
      >
        {SLIDES.map(({ Icon, title, body }) => (
          <View key={title} style={[styles.slide, { width }]}>
            <View style={styles.tile}>
              <Icon size={44} color={Colors.accent} />
            </View>
            <Text variant="title" style={styles.title}>
              {t(title)}
            </Text>
            <Text variant="bodySecondary" color="textSecondary" style={styles.body}>
              {t(body)}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map(({ title }, i) => (
            <View key={title} style={[styles.dot, i === index ? styles.dotActive : null]} />
          ))}
        </View>
        <Button label={last ? t('tutorial.done') : t('tutorial.next')} onPress={onNext} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding on the container: the pager slides must span the full width.
  content: { paddingHorizontal: 0 },
  header: {
    minHeight: 44,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pager: { flex: 1 },
  slide: { alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  tile: {
    width: 96,
    height: 96,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.accentBorder,
    marginBottom: Spacing.sm,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 320 },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.textTertiary, opacity: 0.4 },
  dotActive: { backgroundColor: Colors.accent, opacity: 1 },
});
