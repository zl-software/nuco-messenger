// A bottom sheet over a dimmed backdrop, matching the design (grabber, header with close,
// rounded top corners). The backdrop dims the whole screen in place (opacity only) while just
// the sheet slides up, so the dim never appears to travel up with the sheet.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Overlay, Spacing } from '@/constants/theme';
import { Text } from './Text';
import { Close } from './icons';

// Start the sheet fully below the screen before it slides up. Larger than any realistic sheet.
const HIDDEN_OFFSET = 560;

export interface BottomSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ visible, title, onClose, children }: BottomSheetProps) {
  const [mounted, setMounted] = useState(visible);
  const backdrop = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdrop.setValue(0);
      translateY.setValue(HIDDEN_OFFSET);
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, {
        toValue: HIDDEN_OFFSET,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    // Only re-run when visibility flips; the animated values and mounted flag are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text variant="title">{title}</Text>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
            <Close size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Overlay.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(242,244,247,0.22)', alignSelf: 'center', marginBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: Overlay.fill, alignItems: 'center', justifyContent: 'center' },
});
