// White QR card from the design: a light surface so scanners get contrast on the dark
// theme. Shared by the add-contact Show Code tab and the verify screen's inline reveal.

import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Overlay, Radius } from '@/constants/theme';

const QR_BACKGROUND = '#F2F4F7';
const QR_INK = '#0A0B0E';

export interface QrCardProps {
  value: string;
  size?: number;
}

export function QrCard({ value, size = 220 }: QrCardProps) {
  return (
    <View style={styles.card}>
      <QRCode value={value} size={size} backgroundColor={QR_BACKGROUND} color={QR_INK} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: QR_BACKGROUND,
    borderRadius: Radius.sheet,
    padding: 22,
    borderWidth: 1,
    borderColor: Overlay.accentBorder,
  },
});
