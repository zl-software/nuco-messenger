// Crypto self test, runnable on Node with tsx. Validates the full crypto core end to end
// with BOTH the native WebCrypto provider and the pure JavaScript noble provider (the
// exact path Hermes uses), so the app crypto is verified without a device:
//   identity + signed prekey, card based offline X3DH with the deterministic initiator
//   rule, Double Ratchet round trips, padding, symmetric safety number and emoji SAS,
//   the card hash proof, and the Ed25519 transport auth signature.
//
// Run: npx tsx scripts/crypto-selftest.ts

import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { SignedPreKeyPairType } from '@privacyresearch/libsignal-protocol-typescript';

import { installNobleProvider, installNativeProvider } from '../src/crypto/provider';
import {
  generateChatLockKeys,
  sealBody,
  openBody,
  isSealed,
  wrapChatKeyWithCode,
  unwrapChatKeyWithCode,
} from '../src/crypto/chat-lock';
import { InMemoryKvBackend, NucoSignalStore } from '../src/crypto/store';
import {
  generateIdentity,
  generateSignedPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  type IdentityMaterial,
} from '../src/crypto/identity';
import { NucoSignal, type SessionBootstrap } from '../src/crypto/signal';
import { computeCardHash, isSessionInitiator } from '../src/crypto/verification';
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
  signedPreKey: SignedPreKeyPairType;
  signal: NucoSignal;
  identityKeyB64: string;
}

async function makeParty(handle: string): Promise<Party> {
  const store = new NucoSignalStore(new InMemoryKvBackend());
  const id = await generateIdentity();
  const signedPreKey = await generateSignedPreKey(id.identityKeyPair, 1);
  await installIdentity(store, id, signedPreKey);
  return { handle, id, signedPreKey, signal: new NucoSignal(store), identityKeyB64: identityPublicKeyBase64(id) };
}

// What the QR contact card carries about a party, as the scanner consumes it.
function cardFor(party: Party): SessionBootstrap & { handle: string } {
  return {
    handle: party.handle,
    identityKey: party.identityKeyB64,
    registrationId: party.id.registrationId,
    signedPreKey: toSignedPreKeyPublic(party.signedPreKey),
  };
}

async function runFlow(label: string, install: () => void): Promise<void> {
  console.log(`\n  provider: ${label}`);
  install();

  const alice = await makeParty('alice');
  const bob = await makeParty('bob');

  // Exactly one side initiates (byte smaller identity key), the rule is antisymmetric.
  const aliceInitiates = isSessionInitiator(alice.identityKeyB64, bob.identityKeyB64);
  check(aliceInitiates !== isSessionInitiator(bob.identityKeyB64, alice.identityKeyB64), 'initiator rule is antisymmetric');
  const initiator = aliceInitiates ? alice : bob;
  const responder = aliceInitiates ? bob : alice;

  // The initiator establishes the session offline, straight from the scanned card.
  await initiator.signal.startSession(responder.handle, cardFor(responder));
  const m1 = await initiator.signal.encrypt(responder.handle, utf8Encode('hello, first sealed message'));
  check(m1.messageType === 'prekey', 'first message is a prekey message');
  const d1 = await responder.signal.decrypt(initiator.handle, m1);
  check(utf8Decode(d1) === 'hello, first sealed message', 'responder decrypted the first message');

  // The responder replies (whisper message), exercising the ratchet in both directions.
  const m2 = await responder.signal.encrypt(initiator.handle, utf8Encode('got it'));
  check(m2.messageType === 'whisper', 'reply is a whisper message');
  const d2 = await initiator.signal.decrypt(responder.handle, m2);
  check(utf8Decode(d2) === 'got it', 'initiator decrypted the reply');

  // A few more back and forth messages.
  for (let i = 0; i < 3; i++) {
    const out = await initiator.signal.encrypt(responder.handle, utf8Encode(`msg ${i}`));
    const back = await responder.signal.decrypt(initiator.handle, out);
    check(utf8Decode(back) === `msg ${i}`, `ratchet round trip ${i}`);
  }

  // A forged card (signed prekey signature from a different identity) must be rejected.
  const mallory = await makeParty('mallory');
  const forged = { ...cardFor(responder), signedPreKey: toSignedPreKeyPublic(mallory.signedPreKey) };
  let forgedRejected = false;
  try {
    await mallory.signal.startSession(responder.handle, forged);
  } catch {
    forgedRejected = true;
  }
  check(forgedRejected, 'card with a mismatched signed prekey signature is rejected');

  // A large message exercises padding to a higher bucket.
  const big = utf8Encode('x'.repeat(5000));
  const mBig = await initiator.signal.encrypt(responder.handle, big);
  const dBig = await responder.signal.decrypt(initiator.handle, mBig);
  check(dBig.length === 5000, 'large padded message round trips at exact length');

  // Safety number and emoji SAS are symmetric across both parties.
  const av = await alice.signal.verificationStrings('alice', 'bob', bob.identityKeyB64);
  const bv = await bob.signal.verificationStrings('bob', 'alice', alice.identityKeyB64);
  check(av.safetyNumber.length === 60, 'safety number is 60 digits');
  check(av.safetyNumber === bv.safetyNumber, 'safety number matches on both sides');
  check(av.emoji.map((e) => e.emoji).join('') === bv.emoji.map((e) => e.emoji).join(''), 'emoji SAS matches on both sides');
  check(av.safetyNumberRows.length === 6 && av.safetyNumberRows[0]!.includes(' '), 'safety number formats into rows');

  // The card hash proof: 44 chars, deterministic, sensitive to every committed field, and
  // both sides derive the same value for the same card.
  const aliceCard = cardFor(alice);
  const hash = computeCardHash(aliceCard);
  check(hash.length === 44, 'card hash is 44 base64 chars');
  check(hash === computeCardHash(aliceCard), 'card hash is deterministic');
  check(hash !== computeCardHash({ ...aliceCard, handle: 'alicia' }), 'card hash commits to the handle');
  check(hash !== computeCardHash({ ...aliceCard, identityKey: bob.identityKeyB64 }), 'card hash commits to the identity key');
  check(
    hash !== computeCardHash({ ...aliceCard, signedPreKey: { publicKey: toSignedPreKeyPublic(bob.signedPreKey).publicKey } }),
    'card hash commits to the signed prekey',
  );

  // Transport auth: signing a relay challenge verifies against the registered auth key.
  const nonce = bytesToBase64(randomBytes(32));
  const sig = signChallenge(alice.id.authKeyPair, nonce);
  const ok = ed25519.verify(base64ToBytes(sig), base64ToBytes(nonce), base64ToBytes(authPublicKeyBase64(alice.id.authKeyPair)));
  check(ok, 'transport auth signature verifies');
}

// The chat lock at-rest crypto is pure noble and does not go through the injected
// provider, so one pass covers the app path.
async function runChatLock(): Promise<void> {
  console.log('\n  chat lock (per chat at-rest sealing)');

  const keys = generateChatLockKeys();
  const sealed = sealBody('meet at seven', keys.pubKeyB64, 'convo-1', 'msg-1');
  check(isSealed(sealed.meta), 'sealed meta is recognized');
  check(!isSealed(null) && !isSealed('{"v":9}'), 'plaintext and unknown meta are not sealed');
  check(sealed.bodyB64 !== 'meet at seven', 'stored body is not the plaintext');

  const opened = openBody(sealed.bodyB64, sealed.meta, keys.privKey, keys.pubKeyB64, 'convo-1', 'msg-1');
  check(opened === 'meet at seven', 'seal and open round trip');

  const other = generateChatLockKeys();
  check(
    throws(() => openBody(sealed.bodyB64, sealed.meta, other.privKey, keys.pubKeyB64, 'convo-1', 'msg-1')),
    'wrong private key fails to open',
  );

  const tampered = base64ToBytes(sealed.bodyB64);
  tampered[0] = tampered[0]! ^ 0xff;
  check(
    throws(() => openBody(bytesToBase64(tampered), sealed.meta, keys.privKey, keys.pubKeyB64, 'convo-1', 'msg-1')),
    'tampered ciphertext fails to open',
  );

  check(
    throws(() => openBody(sealed.bodyB64, sealed.meta, keys.privKey, keys.pubKeyB64, 'convo-1', 'msg-2')),
    'row identity is bound (AAD mismatch fails)',
  );
  check(
    throws(() => openBody(sealed.bodyB64, sealed.meta, keys.privKey, keys.pubKeyB64, 'convo-2', 'msg-1')),
    'conversation identity is bound (AAD mismatch fails)',
  );

  const wrapped = await wrapChatKeyWithCode(keys.privKey, '4711');
  const unwrapped = await unwrapChatKeyWithCode(wrapped, '4711');
  check(bytesToBase64(unwrapped) === bytesToBase64(keys.privKey), 'code wrap and unwrap round trip');
  let wrongCodeThrew = false;
  try {
    await unwrapChatKeyWithCode(wrapped, '0000');
  } catch {
    wrongCodeThrew = true;
  }
  check(wrongCodeThrew, 'wrong code fails the authenticated unwrap');
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  console.log('crypto self test');
  await runFlow('native WebCrypto', installNativeProvider);
  await runFlow('noble pure JS (Hermes path)', installNobleProvider);
  await runChatLock();

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
