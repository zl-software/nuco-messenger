// Root layout. Imports the crypto polyfills first, loads fonts, initializes i18n, hydrates
// settings, and wires the lock controller (AppState gate plus status mirror) before showing
// the navigation stack.

import '@/crypto/polyfills';

import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { Colors } from '@/constants/theme';
import { fontMap } from '@/ui/fonts';
import { initI18n } from '@/i18n';
import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';
import { attachAppStateGate, subscribeLock } from '@/lock/lock-controller';
import { configureNotifications } from '@/transport/push';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontMap);
  const [ready, setReady] = useState(false);
  const hydrate = useSettings((s) => s.hydrate);
  const setLockStatus = useSession((s) => s.setLockStatus);

  useEffect(() => {
    let mounted = true;
    initI18n();
    void configureNotifications();
    void hydrate().then(() => {
      if (mounted) setReady(true);
    });
    const unsub = subscribeLock(setLockStatus);
    attachAppStateGate();
    return () => {
      mounted = false;
      unsub();
    };
  }, [hydrate, setLockStatus]);

  useEffect(() => {
    if (fontsLoaded && ready) void SplashScreen.hideAsync();
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.background },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
