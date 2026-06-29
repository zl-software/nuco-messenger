// Typed text component mapping the design type scale to Inter and JetBrains Mono.

import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { Colors, Fonts, type ColorName } from '@/constants/theme';

export type TextVariant =
  | 'display'
  | 'titleXl'
  | 'title'
  | 'section'
  | 'subtitle'
  | 'rowTitle'
  | 'body'
  | 'bodySecondary'
  | 'label'
  | 'caption'
  | 'mono'
  | 'monoCaption'
  | 'eyebrow';

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontFamily: Fonts.extrabold, fontSize: 28, letterSpacing: -0.84, color: Colors.text },
  titleXl: { fontFamily: Fonts.bold, fontSize: 26, letterSpacing: -0.52, color: Colors.text, lineHeight: 31 },
  title: { fontFamily: Fonts.bold, fontSize: 20, letterSpacing: -0.2, color: Colors.text },
  section: { fontFamily: Fonts.bold, fontSize: 19, letterSpacing: -0.19, color: Colors.text },
  subtitle: { fontFamily: Fonts.semibold, fontSize: 17, color: Colors.text },
  rowTitle: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },
  body: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 21, color: Colors.text },
  bodySecondary: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, color: Colors.textSecondary },
  label: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.text },
  caption: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.textSecondary },
  mono: { fontFamily: Fonts.monoMedium, fontSize: 12, letterSpacing: 0.48, color: Colors.text },
  monoCaption: { fontFamily: Fonts.monoMedium, fontSize: 11, letterSpacing: 0.44, color: Colors.textSecondary },
  eyebrow: {
    fontFamily: Fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 1.54,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
  },
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: ColorName;
}

export function Text({ variant = 'body', color, style, ...props }: AppTextProps) {
  return <RNText {...props} style={[VARIANTS[variant], color ? { color: Colors[color] } : null, style]} />;
}
