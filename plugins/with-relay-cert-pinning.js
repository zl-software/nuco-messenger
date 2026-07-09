// Certificate pinning for the reference relay, domain scoped so self hosted relays and
// LAN dev relays are untouched. Pin data lives in relay-pins.json (SPKI SHA-256 of the
// CA roots Cloudflare issues edge certificates from, provenance in docs/relay-pinning.md).
//
// iOS: NSPinnedDomains in Info.plist. It covers everything in the URL Loading System,
// which is the pinned WebSocket module (modules/nuco-pinned-ws, URLSession based) AND
// the /health fetches. NSAllowsLocalNetworking stays untouched so LAN ws:// dev works.
//
// Android (scaffold, verified once an Android build exists): a network security config
// with a domain scoped pin-set. Written twice: the main source set forbids cleartext
// (today's release behavior), the debug source set allows it so the LAN ws:// dev relay
// keeps working (once a network security config exists, Android ignores
// usesCleartextTraffic, so the debug override is load bearing). The pin-set carries an
// expiration date: an install that has not been updated for years fails open instead of
// being bricked by a CA rotation.

const { withInfoPlist, withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { host, pins, androidExpiration } = require('./relay-pins.json');

function withIosPins(config) {
  return withInfoPlist(config, (config) => {
    const ats = config.modResults.NSAppTransportSecurity ?? {};
    config.modResults.NSAppTransportSecurity = {
      ...ats,
      NSPinnedDomains: {
        [host]: {
          NSIncludesSubdomains: false,
          NSPinnedCAIdentities: pins.map((pin) => ({ 'SPKI-SHA256-BASE64': pin.spki })),
        },
      },
    };
    return config;
  });
}

const networkSecurityConfigXml = (cleartextPermitted) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="${cleartextPermitted}" />
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">${host}</domain>
    <pin-set expiration="${androidExpiration}">
${pins.map((pin) => `      <pin digest="SHA-256">${pin.spki}</pin>`).join('\n')}
    </pin-set>
  </domain-config>
</network-security-config>
`;

function withAndroidPins(config) {
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const mainRes = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      const debugRes = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'res', 'xml');
      fs.mkdirSync(mainRes, { recursive: true });
      fs.mkdirSync(debugRes, { recursive: true });
      fs.writeFileSync(path.join(mainRes, 'network_security_config.xml'), networkSecurityConfigXml('false'));
      fs.writeFileSync(path.join(debugRes, 'network_security_config.xml'), networkSecurityConfigXml('true'));
      return config;
    },
  ]);
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });
}

module.exports = (config) => withAndroidPins(withIosPins(config));
