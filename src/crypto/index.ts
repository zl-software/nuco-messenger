// Public surface of the crypto layer. UI and feature code import from here, never from the
// Signal library directly, so the unaudited dependency stays behind this boundary.

export { NucoSignal, type SealedMessage, type VerificationStrings } from './signal';
export {
  generateIdentity,
  generatePreKeys,
  installIdentity,
  toUploadBundle,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  type IdentityMaterial,
  type PreKeyMaterial,
  type AuthKeyPair,
} from './identity';
export { NucoSignalStore, InMemoryKvBackend, type KvBackend } from './store';
export { computeSafetyNumber, formatSafetyNumber } from './safety-number';
export { computeEmojiSas, SAS_EMOJI, type SasEmoji } from './sas';
export { installCryptoProvider } from './provider';
export * as bytes from './bytes';
