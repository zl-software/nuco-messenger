// Initials avatar with one of the design's gradient presets, chosen deterministically from
// the name so a contact always gets the same color.

import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Fonts } from '@/constants/theme';
import { Text } from './Text';

const PRESETS: { colors: [string, string]; text: string }[] = [
  { colors: ['#1f7a66', '#0f3d34'], text: '#CDEFE6' },
  { colors: ['#3a4150', '#1b1f29'], text: '#D7DBE3' },
  { colors: ['#5a4a6e', '#2a2336'], text: '#E3D7EF' },
  { colors: ['#7a5a2e', '#3d2e1b'], text: '#EFE0CD' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function presetFor(name: string): (typeof PRESETS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PRESETS[hash % PRESETS.length]!;
}

export interface AvatarProps {
  name: string;
  size?: number;
  unverified?: boolean;
}

export function Avatar({ name, size = 52, unverified = false }: AvatarProps) {
  const preset = unverified ? { colors: ['#2a2e38', '#16191f'] as [string, string], text: Colors.textSecondary } : presetFor(name);
  return (
    <LinearGradient
      colors={preset.colors}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.initials, { color: preset.text, fontSize: size * 0.36, lineHeight: size * 0.42 }]}>
        {initials(name)}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: Fonts.semibold, textAlign: 'center', includeFontPadding: false },
});
