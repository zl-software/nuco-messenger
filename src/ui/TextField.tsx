// Single line text field with the focused accent ring from the design.

import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Colors, Fonts, Overlay, Radius } from '@/constants/theme';

export interface TextFieldProps extends TextInputProps {
  mono?: boolean;
}

export function TextField({ mono, style, ...props }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, focused ? styles.focused : styles.idle]}>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={Colors.textSecondary}
        style={[styles.input, { fontFamily: mono ? Fonts.monoMedium : Fonts.regular }, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.input,
    backgroundColor: Colors.surface1,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  idle: { borderWidth: 1, borderColor: Overlay.hairline },
  focused: { borderWidth: 1.5, borderColor: Overlay.accentBorder },
  input: { color: Colors.text, fontSize: 15, paddingVertical: 12 },
});
