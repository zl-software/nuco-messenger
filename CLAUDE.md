# nuco-messenger

The Nuco app. Expo SDK 56, RN 0.85, React 19, New Architecture, Reanimated 4, expo-router
(routes in `src/app/`, alias `@/*` to `src/*`). Dark theme only. See `../CLAUDE.md` for the
whole project. Read the versioned Expo v56 docs before touching native config.

Runs as a dev build, NOT Expo Go (custom native modules: op-sqlite SQLCipher, libsignal
polyfills, camera, push, foreground service). Build with `eas build --profile development`.

## Rules

- All Signal specific code stays behind `src/crypto/signal.ts` (the v1 library is UNAUDITED).
- All WebRTC specific code stays behind `src/calls/engine.ts`, the audio session behind
  `src/calls/audio.ts`. The call state machine (`src/calls/controller.ts`) is Node pure and
  must stay importable without native modules (the e2e harness and `calls:check` depend on
  it). Calls are relay only ICE; call signaling is sealed `call/*` message content.
- The lock gates DECRYPTION, not just the UI. The SQLCipher key lives only in memory.
- No hardcoded user facing strings: use i18n (`useTranslation`, keys in
  `src/i18n/locales/en.json` and `de.json`, parity checked). English default, German shipped.
- No em dashes or en dashes anywhere. Commits look human authored (no AI attribution).
- Never write plaintext or key material to logs, AsyncStorage, or the network.

## Verify

```
npm run typecheck
npm run crypto:selftest   # full crypto core on Node, native AND noble providers
npm run i18n:check        # en/de key parity
npm run calls:check       # call state machine on Node with fake engines
```

## On-device gotchas (do not regress)

- Metro does not bundle the Node `buffer` builtin; it is aliased to the npm `buffer` package
  in `metro.config.js`.
- Hermes `TextDecoder` is utf-8 only, but the bundled curve module builds a utf-16le decoder
  at load. `src/crypto/text-polyfill.ts` must be imported before the Signal library (it is the
  first import in `src/crypto/polyfills.ts`).
- Relative imports must be extensionless (Metro), but `@noble` subpaths need `.js`.
- Large `Text` needs an explicit `lineHeight` or iOS clips the top of glyphs.
- Heavy sync crypto (scrypt, curve) freezes the UI: use `scryptAsync`, yield during prekey
  generation.
- Do not await `relay.ensureReady()` during onboarding (hangs if the relay is down); connect
  in the background.
- SQLCipher cannot reopen an existing file with a new key: call `deleteDatabaseFile()` before
  provisioning a fresh account.
- `EXPO_PUBLIC_*` env vars are inlined at bundle time; restart Metro with `-c` to change them.

## Structure

`crypto/` (Signal, providers, identity, safety number, SAS, store, secure storage, byte and
text polyfills), `calls/` (controller state machine, webrtc engine, audio session, CallHost
overlay, fake engine for Node), `db/` (op-sqlite SQLCipher, repos), `transport/` (relay
client, push), `lock/` (controller, biometrics, pin), `services/` (account, boot, calls,
contacts, messaging, onboarding, prefs, relay, server, dev), `state/` (zustand, UI only
never keys), `ui/` (design system), `constants/theme.ts` (dark tokens), `i18n/`, `app/`
(routes).

## Dev reset

Shake the phone, tap "Clear Nuco keys & restart" (`src/services/dev.ts`, registered in
`src/app/_layout.tsx`). Wipes keys, deletes the database, resets prefs, returns to onboarding.

## Relay for testing

Point at a relay with `EXPO_PUBLIC_RELAY_URL=ws://<LAN_IP>:8787 npx expo start --dev-client -c`
(iOS dev builds allow `ws://` to a LAN IP), or set a custom server in Settings. Defaults: dev
`wss://nuco-dev.zlsoftware.at`, prod `wss://relay.nuco-messenger.com`.
