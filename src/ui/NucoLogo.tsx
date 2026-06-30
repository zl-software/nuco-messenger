// The Nuco logo mark: an open accent ring (dash gap, rotated) with a solid center dot, and
// an optional wordmark lockup.

import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';
import { Text } from './Text';

export function NucoMark({ size = 38, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Circle
        cx={14}
        cy={14}
        r={10}
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeDasharray="46 16"
        transform="rotate(-52 14 14)"
      />
      <Circle cx={14} cy={14} r={3.4} fill={color} />
    </Svg>
  );
}

export function NucoLockup({ size = 38 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <NucoMark size={size} />
      <View>
        <Text style={styles.word}>Nuco</Text>
        <Text style={styles.tag}>MESSENGER</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  // Explicit lineHeight (and no font padding) or iOS/Hermes clips the top of the wordmark glyphs.
  word: { fontFamily: Fonts.extrabold, fontSize: 30, lineHeight: 38, letterSpacing: -0.9, color: Colors.text, includeFontPadding: false },
  tag: { fontFamily: Fonts.monoMedium, fontSize: 11, lineHeight: 14, letterSpacing: 3.3, color: Colors.textSecondary, marginTop: 2, includeFontPadding: false },
});
