// Standard screen container: the dark gradient background plus safe area insets. Optional
// accent glow at a focal point for hero screens (onboarding, lock, success).

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

export interface ScreenProps {
  children: ReactNode;
  edges?: readonly Edge[];
  contentStyle?: ViewStyle;
  glow?: boolean;
}

export function Screen({ children, edges = ['top', 'bottom'], contentStyle, glow = false }: ScreenProps) {
  return (
    <View style={styles.root}>
      <LinearGradient colors={[Colors.backgroundTop, Colors.background]} style={StyleSheet.absoluteFill} />
      {glow ? <View style={styles.glow} pointerEvents="none" /> : null}
      <SafeAreaView style={[styles.safe, contentStyle]} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 520,
    height: 360,
    borderRadius: 360,
    backgroundColor: 'rgba(25,227,177,0.08)',
  },
});
