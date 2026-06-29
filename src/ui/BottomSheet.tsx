// A bottom sheet over a dimmed backdrop, matching the design (grabber, header with close,
// rounded top corners).

import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Overlay, Spacing } from '@/constants/theme';
import { Text } from './Text';

export interface BottomSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ visible, title, onClose, children }: BottomSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text variant="title">{title}</Text>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeIcon}>{'✕'}</Text>
          </Pressable>
        </View>
        {children}
      </View>
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
  closeIcon: { color: Colors.text, fontSize: 14 },
});
