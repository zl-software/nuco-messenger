// Metro config for the Nuco app.
//
// The app consumes the shared @nuco/protocol package from the sibling protocol repo via
// a local file dependency. We add that folder to watchFolders so changes to the contract
// hot reload, and we let Metro resolve modules from both node_modules trees.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const protocolRoot = path.resolve(projectRoot, '..', 'protocol');

const config = getDefaultConfig(projectRoot);

// Watch the sibling protocol repo so edits to the shared contract are picked up.
config.watchFolders = [protocolRoot];

// Resolve from the app first, then the protocol package's own node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(protocolRoot, 'node_modules'),
];

module.exports = config;
