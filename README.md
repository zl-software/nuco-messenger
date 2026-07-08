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
- `src/calls/` : 1:1 voice calls (WebRTC, relay only ICE, sealed call signaling).
- `src/ui/` , `src/app/` : the design system and the expo-router screens.
- `src/i18n/` : English (default) and German (shipped), with typed keys.
- `vendor/protocol` : the committed build of [@nuco/protocol](https://github.com/zl-software/nuco-protocol),
  the shared wire contract (MIT licensed, synced by `npm run protocol:sync`).

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
eas build -p ios --profile development
```

Point the app at a relay: set the Server in Settings, or for local dev start Metro with
`EXPO_PUBLIC_RELAY_URL=ws://<LAN_IP>:8787 npx expo start --dev-client -c`. Both build
flavors default to the reference relay at `wss://nuco-server.zlsoftware.at`.

Note on the reference relay: it only accepts NEW account registrations from attested
builds of the official App Store app (Apple App Attest, see the protocol spec's "App
attestation" section). A self built app works against your own relay: deploy
[nuco-server](https://github.com/zl-software/nuco-server) on your own Cloudflare account
and set it in Settings.

## Security model

- Private keys, the Signal store, and messages live inside the encrypted database, whose key
  is released from the hardware keystore only after biometric or PIN unlock. The lock gates
  decryption: on cold start nothing is decrypted until unlock, and on background return past
  the timeout the database is closed and the in memory key dropped.
- The relay sees only padded ciphertext plus routing metadata. Pushes are content free: a
  generic banner, never the text or the sender.
- Verification is strictly in person and mutual: both people scan each other's QR card
  (the card carries the whole X3DH bundle, so sessions establish offline at the scan) and
  both confirm the matching emoji code. A conversation only unlocks after that.

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

## License

GPL-3.0-only, see [LICENSE](LICENSE). The vendored wire contract in `vendor/protocol`
([@nuco/protocol](https://github.com/zl-software/nuco-protocol)) and the sibling relay
([nuco-server](https://github.com/zl-software/nuco-server)) are MIT licensed.
