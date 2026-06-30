// Standard screen container: the dark gradient background plus safe area insets. Optional
// accent glow at the top for hero screens (onboarding, lock, success), rendered as a soft
// radial gradient that fades to transparent.

import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// The accent glow is a wide, shallow ellipse anchored to the top center. It is painted into a
// full screen layer so no element edge reads as a line across the hero, and the gradient itself
// fades to nothing well above where centered hero content (the logo) sits.
const SCREEN_WIDTH = Dimensions.get('window').width;
const GLOW_RADIUS = 220;
const GLOW_SCALE_X = (SCREEN_WIDTH * 0.75) / GLOW_RADIUS;

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
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient
              id="nucoGlow"
              cx={0}
              cy={0}
              r={GLOW_RADIUS}
              gradientUnits="userSpaceOnUse"
              gradientTransform={`translate(${SCREEN_WIDTH / 2}, 0) scale(${GLOW_SCALE_X}, 1)`}
            >
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
});
