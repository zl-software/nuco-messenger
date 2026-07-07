// Public surface of the crypto layer. UI and feature code import from here, never from the
// Signal library directly, so the unaudited dependency stays behind this boundary.

export { NucoSignal, type SealedMessage, type SessionBootstrap, type VerificationStrings } from './signal';
export {
  generateIdentity,
  generateSignedPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  type IdentityMaterial,
  type AuthKeyPair,
} from './identity';
export { NucoSignalStore, InMemoryKvBackend, type KvBackend } from './store';
export { computeSafetyNumber, formatSafetyNumber } from './safety-number';
export { computeEmojiSas, SAS_EMOJI, type SasEmoji } from './sas';
export { computeCardHash, isSessionInitiator, type CardCore } from './verification';
export { installCryptoProvider } from './provider';
export * as bytes from './bytes';
