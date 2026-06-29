# nuco-messenger

The Nuco app: a secure, end to end encrypted 1:1 messenger for iOS and Android (GrapheneOS
is covered by the Android build). Messages are sealed on the device with the Signal Protocol
(X3DH plus Double Ratchet), disappear on a timer, and live only on this device.

This app runs as an Expo dev build. It cannot run in Expo Go, because it bundles custom
native modules (encrypted SQLite via op-sqlite and SQLCipher, the camera, push, and a
foreground service).

## Architecture

- `src/crypto/` : all Signal specific code behind `signal.ts`, with an auditable pure
  JavaScript WebCrypto provider, the 60 digit safety number, and the emoji SAS. The
  underlying library is unaudited and isolated here for a later swap to native libsignal.
- `src/db/` : the encrypted SQLCipher database (messages, contacts, conversations, and the
  Signal store).
- `src/transport/` : the resilient relay WebSocket client and push.
- `src/lock/` : the app lock that gates decryption (not just the UI) with biometrics and a
  PIN.
- `src/services/` , `src/state/` : the wiring between the crypto and transport core and the
  UI.
- `src/ui/` , `src/app/` , `src/features/` : the design system and screens.
- `src/i18n/` : English (default) and German (shipped), with typed keys.

## Setup

```
# build the shared protocol once (it lives in a sibling folder)
npm --prefix ../protocol install && npm --prefix ../protocol run build

npm install
npm run typecheck
npm run crypto:selftest   # validates the crypto core on Node, both providers
```

## Build and run

```
# a development dev build is required (Expo Go will not work)
npx expo prebuild --clean
eas build --profile development            # or a local prebuild + run
```

Point the app at a relay: set the Server in Settings, or for local dev start with
`EXPO_PUBLIC_RELAY_URL=ws://localhost:8787`. The dev build defaults to
`wss://nuco-dev.zlsoftware.at` and the production build to `wss://relay.nuco-messenger.com`.

## Security model

- Private keys, the Signal store, and messages live inside the encrypted database, whose key
  is released from the hardware keystore only after biometric or PIN unlock. The lock gates
  decryption: on cold start nothing is decrypted until unlock, and on background return past
  the timeout the database is closed and the in memory key dropped.
- The relay sees only padded ciphertext plus routing metadata. Push wakes are content free.
- Verification is in person: one camera scan anchors the other device's identity key, and a
  matching safety number (or a reciprocal scan) marks the contact Verified.

## Pre production security checklist

This is a v1 with an UNAUDITED crypto library. Before any production use:

- Replace `@privacyresearch/libsignal-protocol-typescript` with audited native libsignal
  (`@signalapp/libsignal-client`) behind the same `src/crypto/signal.ts` boundary.
- Commission an independent security review of the crypto path, the safety number, and the
  SAS against known Signal test vectors.
- Add certificate pinning to the relay connection.
- Decide the key loss and backup posture (device only by default, no cloud restore: losing
  the device loses the account and history).
- Restate the metadata caveat: the relay can see who is in contact, when, and a padded size
  bucket, even though it cannot read messages.
- Verify on real devices for iOS, stock Android, and GrapheneOS, including the lock and
  biometric flow, encrypted database open, camera scan, and the push wake paths.

## No telemetry

Expo telemetry is disabled (`EXPO_NO_TELEMETRY=1`). There are no analytics or phone home
SDKs on either side.
