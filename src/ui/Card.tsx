// Surface card with the design's hairline border. No drop shadow: elevation reads from the
// border, as in the design.

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Overlay, Radius, Spacing } from '@/constants/theme';

export interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  tone?: 'surface' | 'accent' | 'warning' | 'danger';
}

export function Card({ children, style, tone = 'surface' }: CardProps) {
  return <View style={[styles.base, TONES[tone], style]}>{children}</View>;
}

const TONES: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
  surface: { backgroundColor: Colors.surface1, borderColor: Overlay.hairlineSoft },
  accent: { backgroundColor: Overlay.accent08, borderColor: 'rgba(25,227,177,0.2)' },
  warning: { backgroundColor: Overlay.warning10, borderColor: 'rgba(228,178,72,0.25)' },
  danger: { backgroundColor: Overlay.danger10, borderColor: Overlay.dangerBorder },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.card,
    borderWidth: 1,
    padding: Spacing.lg,
  },
});
