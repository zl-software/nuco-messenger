// A short authentication string (emoji SAS) derived from both identity keys. It is a
// quick, human friendly alternative to reading out the 60 digit safety number: both
// devices derive the SAME six emoji and the two people confirm they match. Derivation is
// symmetric (independent of who computes it).
//
// The 64 emoji table follows the Matrix SAS set so the symbols are distinct and easy to
// name out loud.

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64ToBytes, utf8Encode } from './bytes';

export interface SasEmoji {
  emoji: string;
  name: string;
}

export const SAS_EMOJI: readonly SasEmoji[] = [
  { emoji: '🐶', name: 'dog' },
  { emoji: '🐱', name: 'cat' },
  { emoji: '🦁', name: 'lion' },
  { emoji: '🐎', name: 'horse' },
  { emoji: '🦄', name: 'unicorn' },
  { emoji: '🐷', name: 'pig' },
  { emoji: '🐘', name: 'elephant' },
  { emoji: '🐰', name: 'rabbit' },
  { emoji: '🐼', name: 'panda' },
  { emoji: '🐓', name: 'rooster' },
  { emoji: '🐧', name: 'penguin' },
  { emoji: '🐢', name: 'turtle' },
  { emoji: '🐟', name: 'fish' },
  { emoji: '🐙', name: 'octopus' },
  { emoji: '🦋', name: 'butterfly' },
  { emoji: '🌷', name: 'flower' },
  { emoji: '🌳', name: 'tree' },
  { emoji: '🌵', name: 'cactus' },
  { emoji: '🍄', name: 'mushroom' },
  { emoji: '🌍', name: 'globe' },
  { emoji: '🌙', name: 'moon' },
  { emoji: '☁️', name: 'cloud' },
  { emoji: '🔥', name: 'fire' },
  { emoji: '🍌', name: 'banana' },
  { emoji: '🍎', name: 'apple' },
  { emoji: '🍓', name: 'strawberry' },
  { emoji: '🌽', name: 'corn' },
  { emoji: '🍕', name: 'pizza' },
  { emoji: '🎂', name: 'cake' },
  { emoji: '❤️', name: 'heart' },
  { emoji: '🙂', name: 'smiley' },
  { emoji: '🤖', name: 'robot' },
  { emoji: '🎩', name: 'hat' },
  { emoji: '👓', name: 'glasses' },
  { emoji: '🔧', name: 'spanner' },
  { emoji: '🎅', name: 'santa' },
  { emoji: '👍', name: 'thumbs up' },
  { emoji: '☂️', name: 'umbrella' },
  { emoji: '⌛', name: 'hourglass' },
  { emoji: '⏰', name: 'clock' },
  { emoji: '🎁', name: 'gift' },
  { emoji: '💡', name: 'light bulb' },
  { emoji: '📕', name: 'book' },
  { emoji: '✏️', name: 'pencil' },
  { emoji: '📎', name: 'paperclip' },
  { emoji: '✂️', name: 'scissors' },
  { emoji: '🔒', name: 'lock' },
  { emoji: '🔑', name: 'key' },
  { emoji: '🔨', name: 'hammer' },
  { emoji: '☎️', name: 'telephone' },
  { emoji: '🚩', name: 'flag' },
  { emoji: '🚂', name: 'train' },
  { emoji: '🚲', name: 'bicycle' },
  { emoji: '✈️', name: 'aeroplane' },
  { emoji: '🚀', name: 'rocket' },
  { emoji: '🏆', name: 'trophy' },
  { emoji: '⚽', name: 'ball' },
  { emoji: '🎸', name: 'guitar' },
  { emoji: '🎺', name: 'trumpet' },
  { emoji: '🔔', name: 'bell' },
  { emoji: '⚓', name: 'anchor' },
  { emoji: '🎧', name: 'headphones' },
  { emoji: '📁', name: 'folder' },
  { emoji: '📌', name: 'pin' },
];

const SAS_LENGTH = 6;
const SAS_INFO = utf8Encode('NUCO-SAS-v1');

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

export function computeEmojiSas(identityKeyA_B64: string, identityKeyB_B64: string): SasEmoji[] {
  const a = base64ToBytes(identityKeyA_B64);
  const b = base64ToBytes(identityKeyB_B64);
  // Sort the two keys so both sides derive the same value.
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const ikm = new Uint8Array(first.length + second.length);
  ikm.set(first, 0);
  ikm.set(second, first.length);
  const out = hkdf(sha256, ikm, undefined, SAS_INFO, SAS_LENGTH);
  const result: SasEmoji[] = [];
  for (let i = 0; i < SAS_LENGTH; i++) {
    result.push(SAS_EMOJI[out[i]! % SAS_EMOJI.length]!);
  }
  return result;
}
