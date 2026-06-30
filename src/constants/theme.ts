// Nuco design tokens, taken from the Claude Design "Style sheet" frame. The product is dark
// only for v1, so this is a single dark palette. Values are the exact hex and px numbers
// from the design.

import { Platform } from 'react-native';

export const Colors = {
  // Surfaces
  background: '#0A0B0E',
  backgroundTop: '#0C0E12', // top stop of the standard screen gradient
  surface1: '#15171C',
  surface2: '#1C1F26',
  surface3: '#101216',

  // Accent (mint)
  accent: '#19E3B1',
  accentMuted: '#14463B',
  accentInk: '#08110E', // text and icons placed on the accent
  outgoingBubbleTop: '#14463B',
  outgoingBubbleBottom: '#0F3429',
  outgoingText: '#EAFBF5',

  // Text
  text: '#F2F4F7',
  textSecondary: '#8A8F9A',
  textTertiary: '#737B88',
  textOnCard: '#C7CCD4',

  // Status
  warning: '#E4B248',
  danger: '#E5484D',
  dangerSoft: '#E5848A',

  // Outer device bezel ring (used in mock frames; real app uses safe areas)
  bezel: '#050608',
} as const;

export type ColorName = keyof typeof Colors;

// Common rgba overlays from the design.
export const Overlay = {
  hairline: 'rgba(255,255,255,0.06)',
  hairlineStrong: 'rgba(255,255,255,0.07)',
  hairlineSoft: 'rgba(255,255,255,0.05)',
  fill: 'rgba(255,255,255,0.05)',
  accent16: 'rgba(25,227,177,0.16)',
  accent12: 'rgba(25,227,177,0.12)',
  accent10: 'rgba(25,227,177,0.10)',
  accent08: 'rgba(25,227,177,0.08)',
  accentBorder: 'rgba(25,227,177,0.4)',
  warning14: 'rgba(228,178,72,0.14)',
  warning10: 'rgba(228,178,72,0.10)',
  danger14: 'rgba(229,72,77,0.14)',
  danger10: 'rgba(229,72,77,0.10)',
  dangerBorder: 'rgba(229,72,77,0.3)',
  scrim: 'rgba(5,6,8,0.55)',
} as const;

// Spacing scale (base unit 2px).
export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 46,
} as const;

// Border radii by element type.
export const Radius = {
  card: 20,
  cardSmall: 18,
  button: 16,
  buttonSmall: 14,
  input: 14,
  field: 13,
  sheet: 28,
  pill: 999,
  bubble: 20,
  bubbleTail: 6,
  reticle: 18,
} as const;

// Font families. Inter for UI, JetBrains Mono for keys, safety numbers, and captions.
// Loaded via expo-font in the app shell (see ui/fonts.ts).
export const Fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

// Accent glow shadow used on primary buttons and the send button (iOS colored shadow;
// Android approximates with a faux glow layer where needed).
export const accentGlow = Platform.select({
  ios: {
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
  },
  default: {
    elevation: 8,
  },
}) as object;

export const cardHairline = {
  borderWidth: 1,
  borderColor: Overlay.hairlineSoft,
} as const;

export const MaxContentWidth = 480;

// Motion timing. Single source for screen transition durations so navigation feels snappy.
export const Motion = {
  screen: 160,
} as const;
