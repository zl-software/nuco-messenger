// Two or more segment control with an accent selected chip.

import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Fonts, Overlay } from '@/constants/theme';
import { Text } from './Text';

export interface SegmentedControlProps {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.chip, selected ? styles.chipSelected : null]}
          >
            <Text style={[styles.label, { color: selected ? Colors.accentInk : Colors.textSecondary }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.surface1,
    borderWidth: 1,
    borderColor: Overlay.hairline,
    padding: 4,
    gap: 4,
  },
  chip: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipSelected: { backgroundColor: Colors.accent },
  label: { fontFamily: Fonts.semibold, fontSize: 14 },
});
