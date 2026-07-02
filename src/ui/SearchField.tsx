// Search input from the chats screen design: magnifier icon plus a borderless input on
// surface1 with a hairline ring. Shared by the chats and contacts tabs so both bars look
// identical.

import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts, Overlay, Radius, Spacing } from '@/constants/theme';
import { Search } from './icons';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

export function SearchField({ value, onChangeText, placeholder, style }: SearchFieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Search size={18} color={Colors.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface1,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Overlay.hairline,
    paddingHorizontal: 14,
  },
  input: { flex: 1, color: Colors.text, fontSize: 15, fontFamily: Fonts.regular, paddingVertical: 12 },
});
