// The three tab navigation: Chats, Contacts, Settings, with an accent active state matching
// the design.

import { Redirect, Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { Colors, Overlay } from '@/constants/theme';
import { useSession } from '@/state/session';

function ChatsIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 4V6z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}
function ContactsIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.8} />
      <Path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
function SettingsIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.8} />
      <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const lockStatus = useSession((s) => s.lockStatus);

  // The tabs read the encrypted database. If the key has been released (auto-lock, or a dev
  // reload that reset in memory state), send the user back to unlock instead of letting the
  // screens query a closed database.
  if (lockStatus !== 'unlocked') return <Redirect href="/lock" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{ title: t('chats.title'), tabBarIcon: ({ color }) => <Icon color={color as string} render={ChatsIcon} /> }}
      />
      <Tabs.Screen
        name="contacts"
        options={{ title: t('contacts.title'), tabBarIcon: ({ color }) => <Icon color={color as string} render={ContactsIcon} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('settings.title'), tabBarIcon: ({ color }) => <Icon color={color as string} render={SettingsIcon} /> }}
      />
    </Tabs>
  );
}

function Icon({ color, render: Render }: { color: string; render: (p: { color: string }) => React.ReactElement }) {
  return <View>{Render({ color })}</View>;
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.backgroundTop,
    borderTopColor: Overlay.hairline,
    borderTopWidth: 1,
    height: 88,
    paddingTop: 10,
  },
  label: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});
