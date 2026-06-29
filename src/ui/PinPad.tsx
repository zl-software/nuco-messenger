// The PIN entry surface: six dots plus the numeric keypad, matching the design. The parent
// owns the PIN value; this component reports digit and delete presses.

import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Fonts, Overlay } from '@/constants/theme';
import { Text } from './Text';

export const PIN_LENGTH = 6;

const LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

export function PinDots({ filled, error }: { filled: number; error?: boolean }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => {
        const on = i < filled;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              on
                ? { backgroundColor: error ? Colors.danger : Colors.accent }
                : { backgroundColor: 'rgba(242,244,247,0.16)', borderWidth: 1, borderColor: 'rgba(242,244,247,0.22)' },
            ]}
          />
        );
      })}
    </View>
  );
}

export interface PinKeypadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
  showLetters?: boolean;
}

export function PinKeypad({ onDigit, onDelete, showLetters = true }: PinKeypadProps) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <View style={styles.grid}>
      {keys.map((key, i) => {
        if (key === '') return <View key={i} style={styles.key} />;
        if (key === 'del') {
          return (
            <Pressable key={i} style={styles.key} onPress={onDelete} hitSlop={8}>
              <Text style={styles.del}>{'⌫'}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={i} style={[styles.key, styles.keyFilled]} onPress={() => onDigit(key)}>
            <Text style={styles.digit}>{key}</Text>
            {showLetters && LETTERS[key] ? <Text style={styles.letters}>{LETTERS[key]}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const KEY = 76;

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 18, justifyContent: 'center' },
  dot: { width: 13, height: 13, borderRadius: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 22, maxWidth: 3 * KEY + 2 * 22, alignSelf: 'center' },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  keyFilled: { backgroundColor: Colors.surface2, borderWidth: 1, borderColor: Overlay.hairline },
  digit: { fontFamily: Fonts.medium, fontSize: 28, lineHeight: 36, color: Colors.text, textAlign: 'center', includeFontPadding: false },
  letters: { fontFamily: Fonts.monoMedium, fontSize: 8, lineHeight: 12, letterSpacing: 1.4, color: Colors.textSecondary, marginTop: 1 },
  del: { fontSize: 24, lineHeight: 30, color: Colors.textSecondary },
});
