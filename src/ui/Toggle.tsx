// On / off toggle matching the design (46x27 track, 21 knob, accent glow when on).

import { Pressable, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

export interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onChange, disabled }: ToggleProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.track, { backgroundColor: value ? Colors.accent : '#2a2e38', opacity: disabled ? 0.5 : 1 }]}
    >
      <View
        style={[
          styles.knob,
          { backgroundColor: value ? Colors.accentInk : Colors.textSecondary, alignSelf: value ? 'flex-end' : 'flex-start' },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 46, height: 27, borderRadius: 14, padding: 3, justifyContent: 'center' },
  knob: { width: 21, height: 21, borderRadius: 11 },
});
