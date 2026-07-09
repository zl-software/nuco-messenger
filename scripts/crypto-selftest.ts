// Crypto self test, runnable on Node with tsx. Exercises the full crypto core through
// the SAME facade the app uses (NucoSignal over a LibsignalBackend), backed by
// @signalapp/libsignal-client, the official Node binding of the exact Rust core the
// device builds wrap. Covers: identity plus both signed prekeys, card based offline
// PQXDH with the deterministic initiator rule, Double Ratchet round trips, padding,
// forged card rejection (elliptic curve AND Kyber signatures), symmetric safety number
// and emoji SAS, the card hash proof (v2, commits to the Kyber prekey), the Ed25519
// transport auth signature, the delete plus re-add poison paths, and the identity
// change detection contract (throws, persists nothing, recovers after deleteSession).
//
// Run: npx tsx scripts/crypto-selftest.ts

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { NodeLibsignalBackend } from '../src/crypto/backend-node';
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
  generateKyberPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  toKyberPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  SIGNED_PREKEY_ID,
  KYBER_PREKEY_ID,
  type IdentityMaterial,
  type GeneratedPreKeyWithId,
} from '../src/crypto/identity';
import { NucoSignal, IdentityChangedError, type SessionBootstrap } from '../src/crypto/signal';
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
  signedPreKey: GeneratedPreKeyWithId;
  kyberPreKey: GeneratedPreKeyWithId;
  store: NucoSignalStore;
  signal: NucoSignal;
  identityKeyB64: string;
}

const backend = new NodeLibsignalBackend();

async function makeParty(handle: string): Promise<Party> {
  const store = new NucoSignalStore(new InMemoryKvBackend());
  const id = await generateIdentity(backend);
  const signedPreKey = await generateSignedPreKey(backend, id.identityKeyPair.privateKey, SIGNED_PREKEY_ID);
  const kyberPreKey = await generateKyberPreKey(backend, id.identityKeyPair.privateKey, KYBER_PREKEY_ID);
  await installIdentity(store, id, signedPreKey, kyberPreKey, handle);
  return {
    handle,
    id,
    signedPreKey,
    kyberPreKey,
    store,
    signal: new NucoSignal(store, backend),
    identityKeyB64: identityPublicKeyBase64(id),
  };
}

// What the QR contact card carries about a party, as the scanner consumes it.
function cardFor(party: Party): SessionBootstrap & { handle: string } {
  return {
    handle: party.handle,
    identityKey: party.identityKeyB64,
    registrationId: party.id.registrationId,
    signedPreKey: toSignedPreKeyPublic(party.signedPreKey),
    kyberPreKey: toKyberPreKeyPublic(party.kyberPreKey),
  };
}

async function runFlow(): Promise<void> {
  console.log('\n  libsignal core (official Node binding)');

  // The Node binding and the native module must wrap the same libsignal version, or the
  // selftest would prove a different core than the one shipping on devices.
  const here = dirname(fileURLToPath(import.meta.url));
  const pin = JSON.parse(readFileSync(join(here, '..', 'modules', 'nuco-libsignal', 'libsignal.json'), 'utf8')) as {
    version: string;
  };
  const nodePackage = JSON.parse(
    readFileSync(join(here, '..', 'node_modules', '@signalapp', 'libsignal-client', 'package.json'), 'utf8'),
  ) as { version: string };
  check(nodePackage.version === pin.version, `node binding ${nodePackage.version} matches the native pin ${pin.version}`);

  const alice = await makeParty('alice');
  const bob = await makeParty('bob');

  // Generated key material has the exact shapes the card codec commits to.
  check(base64ToBytes(alice.identityKeyB64).length === 33, 'identity public key serializes to 33 bytes');
  check(base64ToBytes(alice.signedPreKey.publicKey).length === 33, 'signed prekey public is 33 bytes');
  check(base64ToBytes(alice.signedPreKey.signature).length === 64, 'signed prekey signature is 64 bytes');
  check(base64ToBytes(alice.kyberPreKey.publicKey).length === 1569, 'kyber prekey public is 1569 bytes');
  check(base64ToBytes(alice.kyberPreKey.signature).length === 64, 'kyber prekey signature is 64 bytes');
  check(alice.id.registrationId >= 1 && alice.id.registrationId <= 0x3fff, 'registration id is a 14 bit value');

  // Exactly one side initiates (byte smaller identity key), the rule is antisymmetric.
  const aliceInitiates = isSessionInitiator(alice.identityKeyB64, bob.identityKeyB64);
  check(aliceInitiates !== isSessionInitiator(bob.identityKeyB64, alice.identityKeyB64), 'initiator rule is antisymmetric');
  const initiator = aliceInitiates ? alice : bob;
  const responder = aliceInitiates ? bob : alice;

  // The initiator establishes the session offline, straight from the scanned card (PQXDH).
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

  // A forged card must be rejected: a signed prekey signature from a different identity,
  // and equally a Kyber prekey signature from a different identity.
  const mallory = await makeParty('mallory');
  const forgedEc = { ...cardFor(responder), signedPreKey: toSignedPreKeyPublic(mallory.signedPreKey) };
  let forgedEcRejected = false;
  try {
    await mallory.signal.startSession(responder.handle, forgedEc);
  } catch {
    forgedEcRejected = true;
  }
  check(forgedEcRejected, 'card with a mismatched signed prekey signature is rejected');
  const forgedKyber = { ...cardFor(responder), kyberPreKey: toKyberPreKeyPublic(mallory.kyberPreKey) };
  let forgedKyberRejected = false;
  try {
    await mallory.signal.startSession(responder.handle, forgedKyber);
  } catch {
    forgedKyberRejected = true;
  }
  check(forgedKyberRejected, 'card with a mismatched kyber prekey signature is rejected');

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

  // The card hash proof (v2): 44 chars, deterministic, sensitive to every committed
  // field including the kyber prekey, and both sides derive the same value.
  const aliceCard = cardFor(alice);
  const hash = computeCardHash(aliceCard);
  check(hash.length === 44, 'card hash is 44 base64 chars');
  check(hash === computeCardHash(aliceCard), 'card hash is deterministic');
  check(hash !== computeCardHash({ ...aliceCard, handle: 'alicia' }), 'card hash commits to the handle');
  check(hash !== computeCardHash({ ...aliceCard, identityKey: bob.identityKeyB64 }), 'card hash commits to the identity key');
  check(
    hash !== computeCardHash({ ...aliceCard, signedPreKey: { ...aliceCard.signedPreKey, publicKey: bob.signedPreKey.publicKey } }),
    'card hash commits to the signed prekey',
  );
  check(
    hash !== computeCardHash({ ...aliceCard, kyberPreKey: { ...aliceCard.kyberPreKey, publicKey: bob.kyberPreKey.publicKey } }),
    'card hash commits to the kyber prekey',
  );

  // Transport auth: signing a relay challenge verifies against the registered auth key.
  const nonce = bytesToBase64(randomBytes(32));
  const sig = signChallenge(alice.id.authKeyPair, nonce);
  const ok = ed25519.verify(base64ToBytes(sig), base64ToBytes(nonce), base64ToBytes(authPublicKeyBase64(alice.id.authKeyPair)));
  check(ok, 'transport auth signature verifies');

  // Contact deletion and re-add. deleteSession must forget the peer's ratchet on BOTH
  // sides so a re-add runs the first-scan flow again: the initiator's next message is a
  // prekey message (held unacked by the relay for an unknown receiver, so it survives
  // the deletion window) and the responder has no session until it arrives (the confirm
  // deferral condition).
  const carol = await makeParty('carol');
  const dave = await makeParty('dave');
  const init2 = isSessionInitiator(carol.identityKeyB64, dave.identityKeyB64) ? carol : dave;
  const resp2 = init2 === carol ? dave : carol;
  await init2.signal.startSession(resp2.handle, cardFor(resp2));
  await resp2.signal.decrypt(init2.handle, await init2.signal.encrypt(resp2.handle, utf8Encode('pair up')));
  await init2.signal.decrypt(resp2.handle, await resp2.signal.encrypt(init2.handle, utf8Encode('paired')));

  // The poison the wipe prevents: only the initiator forgets and re-runs PQXDH; the
  // responder's stale ratchet then seals messages the initiator can no longer read.
  await init2.signal.deleteSession(resp2.handle);
  await init2.signal.startSession(resp2.handle, cardFor(resp2));
  const stale = await resp2.signal.encrypt(init2.handle, utf8Encode('sealed with the old ratchet'));
  let staleFailed = false;
  try {
    await init2.signal.decrypt(resp2.handle, stale);
  } catch (err) {
    staleFailed = !(err instanceof IdentityChangedError);
  }
  check(staleFailed, 'a stale peer ratchet poisons the re-added pair (why delete wipes sessions)');

  // The designed clean path: both sides forget, then re-add works like a first scan.
  await init2.signal.deleteSession(resp2.handle);
  await resp2.signal.deleteSession(init2.handle);
  check(!(await resp2.signal.hasSession(init2.handle)), 'responder has no session after deletion (confirm defers)');
  await init2.signal.startSession(resp2.handle, cardFor(resp2));
  const readd = await init2.signal.encrypt(resp2.handle, utf8Encode('hello again'));
  check(readd.messageType === 'prekey', 're-add first message is a prekey message again');
  check(utf8Decode(await resp2.signal.decrypt(init2.handle, readd)) === 'hello again', 'responder decrypts the re-add prekey message');
  const answer = await resp2.signal.encrypt(init2.handle, utf8Encode('welcome back'));
  check(utf8Decode(await init2.signal.decrypt(resp2.handle, answer)) === 'welcome back', 'initiator decrypts the re-add answer');
}

// Identity change detection: a peer that re-onboarded sends from a NEW identity under
// the same handle. The receiver's decrypt must throw IdentityChangedError, persist
// NOTHING (pin and ratchet untouched), and recover cleanly after deleteSession (the
// reset handleIdentityChange performs), where trust on first use pins the new identity.
async function runIdentityChange(): Promise<void> {
  console.log('\n  identity change detection');

  const erin = await makeParty('erin');
  const frank = await makeParty('frank');
  const init = isSessionInitiator(erin.identityKeyB64, frank.identityKeyB64) ? erin : frank;
  const resp = init === erin ? frank : erin;
  await init.signal.startSession(resp.handle, cardFor(resp));
  await resp.signal.decrypt(init.handle, await init.signal.encrypt(resp.handle, utf8Encode('established')));
  await init.signal.decrypt(resp.handle, await resp.signal.encrypt(init.handle, utf8Encode('yes')));

  // resp re-onboards: same handle, brand new identity and store. It scans init's card
  // and sends its first message, a prekey message under the NEW identity.
  const respReborn = await makeParty(resp.handle);
  await respReborn.signal.startSession(init.handle, cardFor(init));
  const fromNewIdentity = await respReborn.signal.encrypt(init.handle, utf8Encode('it is me, honest'));
  check(fromNewIdentity.messageType === 'prekey', 'the re-onboarded peer opens with a prekey message');

  const pinBefore = await init.store.getPinnedIdentity(resp.handle);
  const sessionBefore = await init.store.loadSession(resp.handle);
  let threw: unknown = null;
  try {
    await init.signal.decrypt(resp.handle, fromNewIdentity);
  } catch (err) {
    threw = err;
  }
  check(threw instanceof IdentityChangedError, 'decrypt throws IdentityChangedError for the new identity');
  check(
    threw instanceof IdentityChangedError && threw.newIdentityKeyB64 === respReborn.identityKeyB64,
    'the error carries the new identity key',
  );
  check((await init.store.getPinnedIdentity(resp.handle)) === pinBefore, 'the pinned identity is untouched');
  check((await init.store.loadSession(resp.handle)) === sessionBefore, 'the session record is untouched');

  // After the reset (deleteSession, as handleIdentityChange does), the SAME envelope
  // decrypts via trust on first use and the new identity is pinned.
  await init.signal.deleteSession(resp.handle);
  const recovered = await init.signal.decrypt(resp.handle, fromNewIdentity);
  check(utf8Decode(recovered) === 'it is me, honest', 'the same envelope decrypts after the reset');
  check(
    (await init.store.getPinnedIdentity(resp.handle)) === respReborn.identityKeyB64,
    'the new identity is pinned on trust of first use',
  );

  // And the conversation works both ways on the new pairing.
  const back = await init.signal.encrypt(resp.handle, utf8Encode('rebuilt'));
  check(utf8Decode(await respReborn.signal.decrypt(init.handle, back)) === 'rebuilt', 'the rebuilt pair round trips');
}

// The chat lock at-rest crypto is pure noble and independent of libsignal.
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
  await runFlow();
  await runIdentityChange();
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
