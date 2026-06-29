// Boot redirect: onboarding if not set up, the lock screen if locked, otherwise the chats
// tab. The root layout has already loaded fonts, i18n, and hydrated settings.

import { Redirect } from 'expo-router';

import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';

export default function Index() {
  const onboardingComplete = useSettings((s) => s.onboardingComplete);
  const lockStatus = useSession((s) => s.lockStatus);

  if (!onboardingComplete) return <Redirect href="/(onboarding)/welcome" />;
  if (lockStatus !== 'unlocked') return <Redirect href="/lock" />;
  return <Redirect href="/(tabs)/chats" />;
}
