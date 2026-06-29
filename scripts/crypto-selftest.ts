// Crypto self test, runnable on Node with tsx. Validates the full crypto core end to end
// with BOTH the native WebCrypto provider and the pure JavaScript noble provider (the
// exact path Hermes uses), so the app crypto is verified without a device:
//   identity + prekeys, X3DH session establish, Double Ratchet round trips, padding,
//   symmetric safety number and emoji SAS, and the Ed25519 transport auth signature.
//
// Run: npx tsx scripts/crypto-selftest.ts

import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { PreKeyBundle } from '@nuco/protocol';

import { installNobleProvider, installNativeProvider } from '../src/crypto/provider';
import { InMemoryKvBackend, NucoSignalStore } from '../src/crypto/store';
import {
  generateIdentity,
  generatePreKeys,
  installIdentity,
  toUploadBundle,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  type IdentityMaterial,
  type PreKeyMaterial,
} from '../src/crypto/identity';
import { NucoSignal } from '../src/crypto/signal';
import { utf8Encode, utf8Decode, bytesToBase64, base64ToBytes } from '../src/crypto/bytes';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`    ok  ${label}`);
  else {
    console.error(`    FAIL ${label}`);
    failures += 1;
  }
}

interface Party {
  handle: string;
  id: IdentityMaterial;
  pre: PreKeyMaterial;
  signal: NucoSignal;
  identityKeyB64: string;
}

async function makeParty(handle: string): Promise<Party> {
  const store = new NucoSignalStore(new InMemoryKvBackend());
  const id = await generateIdentity();
  const pre = await generatePreKeys(id.identityKeyPair, 1, 1, 5);
  await installIdentity(store, id, pre);
  return { handle, id, pre, signal: new NucoSignal(store), identityKeyB64: identityPublicKeyBase64(id) };
}

// Build the prekey bundle a relay would serve for a party (popping the first one time key).
function bundleFor(party: Party): PreKeyBundle {
  const upload = toUploadBundle(party.pre);
  const otp = upload.oneTimePreKeys[0]!;
  return {
    handle: party.handle,
    deviceId: 1,
    registrationId: party.id.registrationId,
    identityKey: party.identityKeyB64,
    signedPreKey: upload.signedPreKey,
    oneTimePreKey: otp,
  };
}

async function runFlow(label: string, install: () => void): Promise<void> {
  console.log(`\n  provider: ${label}`);
  install();

  const alice = await makeParty('alice');
  const bob = await makeParty('bob');

  // Bob starts a session toward Alice from her bundle and sends the first (prekey) message.
  await bob.signal.startSession('alice', bundleFor(alice));
  const m1 = await bob.signal.encrypt('alice', utf8Encode('hello alice, this is bob'));
  check(m1.messageType === 'prekey', 'first message is a prekey message');
  const d1 = await alice.signal.decrypt('bob', m1);
  check(utf8Decode(d1) === 'hello alice, this is bob', 'alice decrypted bob first message');

  // Alice replies (whisper message), exercising the ratchet in both directions.
  const m2 = await alice.signal.encrypt('bob', utf8Encode('hi bob, got it'));
  check(m2.messageType === 'whisper', 'reply is a whisper message');
  const d2 = await bob.signal.decrypt('alice', m2);
  check(utf8Decode(d2) === 'hi bob, got it', 'bob decrypted alice reply');

  // A few more back and forth messages.
  for (let i = 0; i < 3; i++) {
    const out = await bob.signal.encrypt('alice', utf8Encode(`msg ${i}`));
    const back = await alice.signal.decrypt('bob', out);
    check(utf8Decode(back) === `msg ${i}`, `ratchet round trip ${i}`);
  }

  // A large message exercises padding to a higher bucket.
  const big = utf8Encode('x'.repeat(5000));
  const mBig = await bob.signal.encrypt('alice', big);
  const dBig = await alice.signal.decrypt('bob', mBig);
  check(dBig.length === 5000, 'large padded message round trips at exact length');

  // Safety number and emoji SAS are symmetric across both parties.
  const av = await alice.signal.verificationStrings('alice', 'bob', bob.identityKeyB64);
  const bv = await bob.signal.verificationStrings('bob', 'alice', alice.identityKeyB64);
  check(av.safetyNumber.length === 60, 'safety number is 60 digits');
  check(av.safetyNumber === bv.safetyNumber, 'safety number matches on both sides');
  check(av.emoji.map((e) => e.emoji).join('') === bv.emoji.map((e) => e.emoji).join(''), 'emoji SAS matches on both sides');
  check(av.safetyNumberRows.length === 6 && av.safetyNumberRows[0]!.includes(' '), 'safety number formats into rows');

  // Transport auth: signing a relay challenge verifies against the registered auth key.
  const nonce = bytesToBase64(randomBytes(32));
  const sig = signChallenge(alice.id.authKeyPair, nonce);
  const ok = ed25519.verify(base64ToBytes(sig), base64ToBytes(nonce), base64ToBytes(authPublicKeyBase64(alice.id.authKeyPair)));
  check(ok, 'transport auth signature verifies');
}

async function main(): Promise<void> {
  console.log('crypto self test');
  await runFlow('native WebCrypto', installNativeProvider);
  await runFlow('noble pure JS (Hermes path)', installNobleProvider);

  if (failures > 0) {
    console.error(`\ncrypto self test FAILED with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\ncrypto self test OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
