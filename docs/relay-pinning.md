# Relay certificate pinning

The iOS app pins the TLS connections to the reference relay (`nuco-server.zlsoftware.at`)
to the certificate authorities Cloudflare issues its edge certificates from. Pinning is
domain scoped: self hosted relays (Settings custom server) and LAN `ws://` dev relays
are never pinned.

## What it does and does not authenticate

TLS to `nuco-server.zlsoftware.at` terminates at the Cloudflare edge, so the pins
authenticate the Cloudflare edge, not the Worker. Message privacy never depended on
either: envelopes are sealed end to end and the relay is untrusted by design. The pins
harden the metadata and availability surface: a certificate mis-issued by any authority
outside the pin set cannot silently sit between the app and the relay.

Known limits, stated plainly:
- Apple does NOT apply `NSPinnedDomains` to chains anchored by a user installed, user
  trusted root certificate. Pinning defends against public CA mis-issuance, not against
  someone who can make the user install and fully trust a proxy root.
- Self hosted relays trust the device's system certificate store, unpinned.

## Mechanism

- iOS: `NSPinnedDomains` in Info.plist (written by `plugins/with-relay-cert-pinning.js`
  from `plugins/relay-pins.json`). It applies to the URL Loading System only, which is
  why the relay WebSocket runs through `modules/nuco-pinned-ws` (URLSessionWebSocketTask)
  instead of RN's global WebSocket (SocketRocket over raw streams, invisible to ATS).
  The `/health` test connection fetches ride NSURLSession and are covered automatically.
  The implementation picker is `pickWebSocketImpl` in `src/services/relay.ts`, gated by
  `isPinnedRelayUrl` in `src/services/server.ts`. A pin failure surfaces as
  NSURLErrorDomain -1202 through the module's error event and lands in the ordinary
  reconnect backoff (offline UI); there is no dedicated failure UX by design.
- Android (scaffold, UNVERIFIED until an Android build exists): a network security
  config `<pin-set>` scoped to the host, written by the same plugin. The debug source
  set copy permits cleartext so LAN `ws://` dev keeps working (once a network security
  config exists Android ignores `usesCleartextTraffic`). The pin-set expires 2028-07-01:
  an install that old fails open instead of being bricked by a CA change; iOS has no
  equivalent, so iOS updates are mandatory when Cloudflare rotates CAs.

## Pin provenance

SPKI SHA-256, base64. Sources: the CA list is Cloudflare's
https://developers.cloudflare.com/ssl/reference/certificate-authorities/ (fetched
2026-07-09: Universal SSL issues from Let's Encrypt, Google Trust Services, and SSL.com;
backup certificates may additionally use Sectigo). Root certificates were taken from the
Mozilla root store bundle (https://curl.se/ca/cacert.pem, fetched 2026-07-09), except
GTS Root R2 from Google directly (https://i.pki.goog/r2.pem). Hash command per root:

```
openssl x509 -in root.pem -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary | base64
```

Live chain verification (2026-07-09): `openssl s_client -connect
nuco-server.zlsoftware.at:443 -servername nuco-server.zlsoftware.at -showcerts` serves
leaf <- WE1 <- GTS Root R4 (ECDSA) and, with `-sigalgs rsa_pss_rsae_sha256`, leaf <- WR1
<- GTS Root R1 (RSA); both roots' computed SPKI values match the pin set. Cross signed
chains (GTS roots under GlobalSign, USERTrust under AAA Certificate Services) still
contain the pinned certificate as a chain element, and both iOS and Android match a pin
anywhere in the validated chain.

The current pins live in `plugins/relay-pins.json` (12 entries: ISRG Root X1/X2, GTS
Root R1 to R4, SSL.com RSA/ECC classic and 2022 roots, USERTrust RSA/ECC).

## Maintenance runbook

- Watch https://developers.cloudflare.com/ssl/reference/certificate-authorities/ and the
  Cloudflare changelog. If Cloudflare adds or switches a CA, old iOS builds hard fail
  against the reference relay until an app update ships new pins. That is the accepted
  cost of pinning managed certificates without Advanced Certificate Manager; Cloudflare
  itself recommends against leaf pinning, which is why the pins target CA roots.
- To update: refresh `plugins/relay-pins.json` (same commands as above), bump the
  Android `androidExpiration`, rebuild, release.
- Never remove the Sectigo (USERTrust) pins while on Universal SSL: Cloudflare's backup
  certificate can activate without notice and may chain to Sectigo.

## Negative test recipe (dev build)

Do NOT test with a mitmproxy user CA (Apple exempts user trusted roots from
NSPinnedDomains: the connection succeeding proves the documented bypass, not a broken
pin) and do NOT test by pointing at a different host (pins are domain scoped; a foreign
host is simply not pinned). The honest test: temporarily replace every `spki` value in
`plugins/relay-pins.json` with a wrong but well formed hash (for example rot the first
character), rebuild the dev client, and verify the default relay fails to connect with
NSURLErrorDomain -1202 in the console while the UI shows the ordinary reconnecting
state, and that Settings "Test connection" fails too. Restore the real pins and rebuild.
