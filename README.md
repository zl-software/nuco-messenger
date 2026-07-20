# nuco-messenger

The Nuco app: a secure, end to end encrypted 1:1 messenger. Messages are sealed on the
device with the Signal Protocol via official native libsignal (PQXDH plus Double Ratchet,
post quantum), disappear on a timer, and live only on this device.

Nuco is on the [App Store](https://apps.apple.com/app/nuco-messenger/id6788573353). iOS
ships first; the Android build is part of the codebase (GrapheneOS included) but has not
shipped yet.

This app runs as an Expo dev build. It cannot run in Expo Go, because it bundles custom
native modules (encrypted SQLite via op-sqlite and SQLCipher, the camera, push, and a
foreground service).

## Architecture

- `src/crypto/` : all Signal specific code behind `signal.ts`, which runs OFFICIAL
  libsignal (the same Rust core Signal itself ships) through a record passing backend
  seam: the local native module on device, `@signalapp/libsignal-client` on Node for the
  test harnesses. The 60 digit safety number and the emoji SAS live here too.
- `modules/` : local Expo native modules: `nuco-libsignal` (prebuilt official libsignal,
  version pinned in its `libsignal.json`), `nuco-pinned-ws` (the certificate pinned relay
  socket on iOS), `nuco-callkit` (CallKit plus PushKit, so calls ring on the lock screen).
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
npm run crypto:selftest   # validates the crypto core on Node via official libsignal
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
  (the card carries the whole PQXDH bundle, identity key plus signed prekey plus signed
  Kyber prekey, so sessions establish fully offline at the scan) and both confirm the
  matching emoji code. A conversation only unlocks after that.
- On iOS the connection to the reference relay is certificate pinned (pins and runbook in
  `docs/relay-pinning.md`); custom and self hosted relays use the system trust store.

## Security status, honestly

- The cipher is official libsignal, the audited engine Signal runs on, as a prebuilt
  native library on device. Nothing cryptographic is hand rolled.
- Nuco itself (the app around libsignal) has not yet had an independent security audit.
  If an audit is non negotiable for you right now, use Signal, and we mean that.
- Metadata caveat: the relay can never read messages, but like any server it sees which
  handles are in contact, when, and padded size buckets.
- Key loss is final by design: there is no cloud backup and no recovery. Losing the
  device loses the account and the history.

## No telemetry

Expo telemetry is disabled (`EXPO_NO_TELEMETRY=1`). There are no analytics or phone home
SDKs on either side.

## License

GPL-3.0-only, see [LICENSE](LICENSE). The vendored wire contract in `vendor/protocol`
([@nuco/protocol](https://github.com/zl-software/nuco-protocol)) and the sibling relay
([nuco-server](https://github.com/zl-software/nuco-server)) are MIT licensed.
