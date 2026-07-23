// Pure helpers for the protocol 3.3 image chunk geometry: splitting a base64 body into
// wire chunks, reassembling received chunks, and hashing. Node pure by design (no
// react-native, expo, or db imports): the crypto selftest and the e2e harness import this
// file, like crypto/verification.ts.
//
// The geometry makes everything string work: IMAGE_CHUNK_RAW_BYTES is divisible by 3, so
// every chunk except the last is exactly IMAGE_CHUNK_DATA_B64_MAX base64 characters with
// no '=' padding. A body is sliced directly, reassembly is concatenation, and every slice
// decodes on its own, which lets the sha256 run incrementally with yields instead of one
// monolithic multi MB pass that would stall the JS thread.

import { sha256 } from '@noble/hashes/sha2.js';
import {
  IMAGE_CHUNK_DATA_B64_MAX,
  IMAGE_CHUNK_RAW_BYTES,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_JPEG,
  type MessageContent,
} from '@nuco/protocol';

import { base64ToBytes, bytesToBase64 } from '../crypto/bytes';

// Unsealed layout metadata stored per image row (messages.media_meta).
export interface ImageMediaMeta {
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export function parseMediaMeta(json: string | null | undefined): ImageMediaMeta | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<ImageMediaMeta>;
    if (typeof o.width !== 'number' || typeof o.height !== 'number' || o.width <= 0 || o.height <= 0) return null;
    return { mime: typeof o.mime === 'string' ? o.mime : IMAGE_MIME_JPEG, width: o.width, height: o.height, bytes: typeof o.bytes === 'number' ? o.bytes : 0 };
  } catch {
    return null;
  }
}

// Deterministic envelope id for chunk seq of the image announced under ref. Determinism
// makes a resend after an app kill dedupe at the relay queue and at the receiver.
export function chunkEnvelopeId(ref: string, seq: number): string {
  return `${ref}#${seq}`;
}

export function chunkCountFor(bytes: number): number {
  return Math.ceil(bytes / IMAGE_CHUNK_RAW_BYTES);
}

// Raw byte count encoded by a base64 string (which must be well formed).
export function rawBytesOfB64(b64: string): number {
  if (b64.length % 4 !== 0) return -1;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - padding;
}

export function splitB64(bodyB64: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < bodyB64.length; i += IMAGE_CHUNK_DATA_B64_MAX) {
    out.push(bodyB64.slice(i, i + IMAGE_CHUNK_DATA_B64_MAX));
  }
  return out;
}

export function buildImageMeta(meta: ImageMediaMeta & { sha256: string }): MessageContent {
  return {
    t: 'image',
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    bytes: meta.bytes,
    sha256: meta.sha256,
    chunks: chunkCountFor(meta.bytes),
  };
}

const YIELD_EVERY_SLICES = 4; // ~192 KB of raw bytes between yields

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// base64 sha256 of the raw bytes encoded by bodyB64, computed slice by slice with yields
// so a multi MB body never blocks the JS thread in one pass.
export async function sha256B64OfB64(bodyB64: string): Promise<string> {
  const hasher = sha256.create();
  const slices = splitB64(bodyB64);
  for (let i = 0; i < slices.length; i++) {
    hasher.update(base64ToBytes(slices[i]!));
    if ((i + 1) % YIELD_EVERY_SLICES === 0) await yieldToLoop();
  }
  return bytesToBase64(hasher.digest());
}

// Reassemble received chunk data (in seq order) and verify the announced size and digest.
// Returns the body base64 on success; throws on any mismatch, which the receive path
// treats as a corrupt transfer to discard.
export async function assembleAndVerify(chunks: string[], expectedBytes: number, expectedSha256B64: string): Promise<string> {
  const bodyB64 = chunks.join('');
  if (rawBytesOfB64(bodyB64) !== expectedBytes || expectedBytes < 1 || expectedBytes > IMAGE_MAX_BYTES) {
    throw new Error('image size mismatch');
  }
  if ((await sha256B64OfB64(bodyB64)) !== expectedSha256B64) {
    throw new Error('image digest mismatch');
  }
  return bodyB64;
}
