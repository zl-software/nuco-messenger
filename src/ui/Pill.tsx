// Small rounded pills: retention pills, status pills, badges.

import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { Text } from './Text';

export type PillTone = 'accent' | 'neutral' | 'danger' | 'warning';

const TONES: Record<PillTone, { bg: string; fg: string }> = {
  accent: { bg: 'rgba(25,227,177,0.10)', fg: Colors.accent },
  neutral: { bg: 'rgba(138,143,154,0.12)', fg: Colors.textSecondary },
  danger: { bg: 'rgba(229,72,77,0.12)', fg: Colors.dangerSoft },
  warning: { bg: 'rgba(228,178,72,0.14)', fg: Colors.warning },
};

export interface PillProps {
  label: string;
  tone?: PillTone;
  dot?: boolean;
  style?: ViewStyle;
}

export function Pill({ label, tone = 'neutral', dot = false, style }: PillProps) {
  const palette = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: palette.fg }]} /> : null}
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  label: { fontFamily: Fonts.monoMedium, fontSize: 11 },
});
