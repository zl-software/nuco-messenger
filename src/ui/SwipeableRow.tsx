// A list row wrapper that reveals action buttons on a left swipe (chats and contacts
// rows). Actions close the panel before firing, so a confirm Alert never sits over a
// half open row. The app root already provides GestureHandlerRootView.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { Text } from './Text';

export interface SwipeAction {
  key: string;
  label: string;
  tone: 'danger' | 'neutral';
  onPress: () => void;
}

export interface SwipeableRowProps {
  actions: SwipeAction[];
  children: ReactNode;
}

export function SwipeableRow({ actions, children }: SwipeableRowProps) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              style={[styles.action, a.tone === 'danger' ? styles.actionDanger : styles.actionNeutral]}
              onPress={() => {
                methods.close();
                a.onPress();
              }}
            >
              <Text variant="label" color={a.tone === 'danger' ? 'text' : 'textSecondary'}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingLeft: Spacing.sm },
  action: {
    width: 84,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.buttonSmall,
    marginVertical: Spacing.xs,
  },
  actionDanger: { backgroundColor: Colors.danger },
  actionNeutral: { backgroundColor: Colors.surface2 },
});
