// The image message bubble: renders a received or sent photo from a base64 data URI. The
// memory-only cache policy is load bearing: expo-image's default disk cache would write
// decoded plaintext image bytes outside SQLCipher (see the messaging golden rules).

import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

export interface ImageBubbleProps {
  uri: string;
  width: number;
  height: number;
  recyclingKey: string;
  outgoing: boolean;
}

// Fixed display width with the height following the image's aspect ratio, clamped so an
// extreme panorama or tower stays a tappable bubble; contentFit cover crops the clamped
// overflow, and the full frame is always one tap away in the viewer.
const DISPLAY_WIDTH = 240;
const MIN_AR = 0.62;
const MAX_AR = 1.8;

export function ImageBubble({ uri, width, height, recyclingKey, outgoing }: ImageBubbleProps) {
  const ar = width > 0 && height > 0 ? Math.min(MAX_AR, Math.max(MIN_AR, width / height)) : 1;
  return (
    <View style={[styles.frame, outgoing ? styles.frameOut : styles.frameIn]}>
      <Image
        source={{ uri }}
        style={{ width: DISPLAY_WIDTH, height: Math.round(DISPLAY_WIDTH / ar) }}
        contentFit="cover"
        cachePolicy="memory"
        recyclingKey={recyclingKey}
        transition={120}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: Radius.bubble, overflow: 'hidden', backgroundColor: Colors.surface2 },
  frameOut: { borderBottomRightRadius: Radius.bubbleTail },
  frameIn: { borderBottomLeftRadius: Radius.bubbleTail },
});
