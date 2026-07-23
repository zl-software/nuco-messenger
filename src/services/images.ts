// Image picking and preparation. This is the ONLY file that may import expo-image-picker
// or expo-image-manipulator (both lazy required so a dev client built before these
// modules existed degrades to a localized "unavailable" error instead of crashing at
// import time, the attest.ts pattern).
//
// Every picked image is UNCONDITIONALLY re-encoded (decode to a native bitmap, downscale
// if large, re-compress as jpeg). The re-encode is the metadata strip: EXIF, GPS, XMP,
// everything is dropped by construction because only pixels survive the round trip, and
// the protocol transports the encoded bytes verbatim. This behavior is load bearing; if
// expo-image-manipulator is ever replaced, the replacement must strip metadata the same
// way. There is deliberately no user toggle.
//
// The picker and the re-encoder both write a transient file into the app cache sandbox;
// both are deleted in the finally block below. That seconds long window is the single
// exception to "image bytes live only in SQLCipher" and stays on the send side only.

import {
  IMAGE_MAX_BYTES,
  IMAGE_MIME_JPEG,
} from '@nuco/protocol';

import { rawBytesOfB64, sha256B64OfB64 } from './image-codec';

// Longest edge of the re-encoded image. Downscale only: smaller images are re-encoded at
// their own size. 1600px at quality 0.7 lands a typical photo at 200 to 450 KB, well
// under the protocol's 3 MB ceiling.
const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.7;
const RETRY_QUALITY = 0.5;

export type ImagePrepareFailure = 'unavailable' | 'too-large' | 'failed';

export class ImagePrepareError extends Error {
  constructor(readonly reason: ImagePrepareFailure) {
    super(`image prepare failed: ${reason}`);
    this.name = 'ImagePrepareError';
  }
}

export interface PreparedImage {
  bodyB64: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

function deleteQuiet(fileSystem: typeof import('expo-file-system'), uri: string | null | undefined): void {
  if (!uri) return;
  try {
    new fileSystem.File(uri).delete();
  } catch {
    // Cache files the OS already reclaimed (or a non file uri) are fine to ignore.
  }
}

// Opens the system photo picker (no permission prompt on iOS 14+; PHPicker runs out of
// process) and returns the prepared image, or null when the user cancels.
export async function pickAndPrepareImage(): Promise<PreparedImage | null> {
  let picker: typeof import('expo-image-picker');
  let manipulator: typeof import('expo-image-manipulator');
  let fileSystem: typeof import('expo-file-system');
  try {
    picker = require('expo-image-picker');
    manipulator = require('expo-image-manipulator');
    fileSystem = require('expo-file-system');
  } catch {
    throw new ImagePrepareError('unavailable');
  }

  const result = await picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    base64: false,
    exif: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;

  try {
    let prepared = await renderJpeg(manipulator, fileSystem, asset, JPEG_QUALITY);
    if (prepared.bytes > IMAGE_MAX_BYTES) {
      prepared = await renderJpeg(manipulator, fileSystem, asset, RETRY_QUALITY);
    }
    if (prepared.bytes > IMAGE_MAX_BYTES) throw new ImagePrepareError('too-large');
    return prepared;
  } catch (e) {
    if (e instanceof ImagePrepareError) throw e;
    throw new ImagePrepareError('failed');
  } finally {
    deleteQuiet(fileSystem, asset.uri);
  }
}

async function renderJpeg(
  manipulator: typeof import('expo-image-manipulator'),
  fileSystem: typeof import('expo-file-system'),
  asset: { uri: string; width: number; height: number },
  quality: number,
): Promise<PreparedImage> {
  const context = manipulator.ImageManipulator.manipulate(asset.uri);
  const longEdge = Math.max(asset.width || 0, asset.height || 0);
  if (longEdge > TARGET_LONG_EDGE) {
    context.resize(asset.width >= asset.height ? { width: TARGET_LONG_EDGE } : { height: TARGET_LONG_EDGE });
  }
  const image = await context.renderAsync();
  let saved: { uri: string; width: number; height: number; base64?: string | null };
  try {
    saved = await image.saveAsync({ compress: quality, format: manipulator.SaveFormat.JPEG, base64: true });
  } finally {
    image.release();
  }
  deleteQuiet(fileSystem, saved.uri);
  const bodyB64 = saved.base64 ?? '';
  const bytes = rawBytesOfB64(bodyB64);
  if (bodyB64.length === 0 || bytes < 1) throw new ImagePrepareError('failed');
  return {
    bodyB64,
    mime: IMAGE_MIME_JPEG,
    width: saved.width,
    height: saved.height,
    bytes,
    sha256: await sha256B64OfB64(bodyB64),
  };
}
