// SVG icons ported from the design, preserving viewBox and stroke widths. Colors default to
// the secondary text color and can be overridden.

import Svg, { Path, Circle, Rect, G } from 'react-native-svg';

import { Colors } from '@/constants/theme';

export interface IconProps {
  size?: number;
  color?: string;
}

export function ChevronLeft({ size = 22, color = Colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronRight({ size = 20, color = Colors.textTertiary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Plus({ size = 22, color = Colors.accentInk }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function VerifiedShield({ size = 14, color = Colors.accent }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2l7 3v6c0 4.2-2.8 8-7 9-4.2-1-7-4.8-7-9V5l7-3z"
        fill="rgba(25,227,177,0.16)"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Path d="M8.5 12l2.2 2.2 4.2-4.4" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Clock({ size = 16, color = Colors.accent }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={13} r={8} stroke={color} strokeWidth={1.6} />
      <Path d="M12 9v4l3 2M9 3h6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function QrIcon({ size = 22, color = Colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <Path d="M14 14h3v3M21 14v7M17 21h4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function Search({ size = 18, color = Colors.textSecondary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={1.8} />
      <Path d="M20 20l-3.5-3.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function SendArrow({ size = 22, color = Colors.accentInk }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h13M12 5l7 7-7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Close({ size = 20, color = Colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function Check({ size = 18, color = Colors.accent }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5l4.2 4.2L19 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Backspace({ size = 24, color = Colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5h10a2 2 0 012 2v10a2 2 0 01-2 2H9l-6-7 6-7z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M12 10l4 4M16 10l-4 4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function FaceId({ size = 40, color = Colors.accent }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 62 62" fill="none">
      <G>
        <Path d="M4 16V8a4 4 0 014-4h8" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M58 16V8a4 4 0 00-4-4h-8" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M4 46v8a4 4 0 004 4h8" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M58 46v8a4 4 0 01-4 4h-8" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        <Circle cx={23} cy={26} r={2} fill={color} />
        <Circle cx={39} cy={26} r={2} fill={color} />
        <Path d="M23 38c2.5 2.5 13.5 2.5 16 0" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      </G>
    </Svg>
  );
}
