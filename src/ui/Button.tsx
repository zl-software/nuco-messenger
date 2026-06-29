// Buttons in the four design variants: primary (accent), secondary, ghost, destructive.

import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Fonts, Overlay, Radius, Spacing, accentGlow } from '@/constants/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, icon, style, testID }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        VARIANT_STYLES[variant],
        variant === 'primary' ? accentGlow : null,
        isDisabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? Colors.accentInk : Colors.text} />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, LABEL_COLORS[variant]]}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const VARIANT_STYLES: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: Colors.accent },
  secondary: { backgroundColor: Overlay.fill },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: Overlay.danger10, borderWidth: 1, borderColor: Overlay.dangerBorder },
};

const LABEL_COLORS: Record<ButtonVariant, { color: string }> = {
  primary: { color: Colors.accentInk },
  secondary: { color: Colors.text },
  ghost: { color: Colors.accent },
  destructive: { color: Colors.danger },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { fontFamily: Fonts.semibold, fontSize: 16 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
