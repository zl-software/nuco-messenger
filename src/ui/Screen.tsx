// Standard screen container: the dark gradient background plus safe area insets. Optional
// accent glow at the top for hero screens (onboarding, lock, success), rendered as a soft
// radial gradient that fades to transparent.

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

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
      {glow ? (
        <Svg style={styles.glow} pointerEvents="none">
          <Defs>
            <RadialGradient id="nucoGlow" cx="50%" cy="0%" r="75%">
              <Stop offset="0%" stopColor={Colors.accent} stopOpacity={0.16} />
              <Stop offset="55%" stopColor={Colors.accent} stopOpacity={0.05} />
              <Stop offset="100%" stopColor={Colors.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#nucoGlow)" />
        </Svg>
      ) : null}
      <SafeAreaView style={[styles.safe, contentStyle]} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420, width: '100%' },
});
