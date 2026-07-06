// Boot redirect: onboarding if not set up, the lock screen if locked, the tutorial if it
// has never been seen, otherwise the chats tab. The root layout has already loaded fonts,
// i18n, and hydrated settings.

import { Redirect } from 'expo-router';

import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';

export default function Index() {
  const onboardingComplete = useSettings((s) => s.onboardingComplete);
  const tutorialSeen = useSettings((s) => s.tutorialSeen);
  const lockStatus = useSession((s) => s.lockStatus);

  if (!onboardingComplete) return <Redirect href="/(onboarding)/welcome" />;
  if (lockStatus !== 'unlocked') return <Redirect href="/lock" />;
  if (!tutorialSeen) return <Redirect href="/tutorial" />;
  return <Redirect href="/(tabs)/chats" />;
}
