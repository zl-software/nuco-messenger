// Metro config for the Nuco app.
//
// The app consumes the shared @nuco/protocol package from the committed copy in
// vendor/protocol (synced from the sibling protocol repo by scripts/protocol-sync.ts, so
// EAS cloud builds, which upload only this repo, can resolve it). The copy lives inside the
// project root, so no extra watchFolders are needed.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Map the "buffer" specifier to the npm polyfill package rather than the Node builtin, which
// Metro does not bundle. Some Signal dependencies expect a global Buffer in Hermes.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: require.resolve('buffer/'),
};

module.exports = config;
