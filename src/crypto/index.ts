// Public surface of the crypto layer. UI and feature code import from here, never from
// libsignal (native module or Node binding) directly, so the cipher stays behind this
// boundary and the backend seam remains swappable.

export {
  NucoSignal,
  IdentityChangedError,
  DuplicateMessageError,
  type SealedMessage,
  type SessionBootstrap,
  type VerificationStrings,
} from './signal';
export {
  generateIdentity,
  generateSignedPreKey,
  generateKyberPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  toKyberPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  signChallenge,
  SIGNED_PREKEY_ID,
  KYBER_PREKEY_ID,
  type IdentityMaterial,
  type AuthKeyPair,
  type GeneratedPreKeyWithId,
} from './identity';
export { NucoSignalStore, InMemoryKvBackend, STORE_FORMAT_NATIVE, type KvBackend } from './store';
export type { LibsignalBackend } from './backend';
export { formatSafetyNumber } from './safety-number';
export { computeEmojiSas, SAS_EMOJI, type SasEmoji } from './sas';
export { computeCardHash, isSessionInitiator, type CardCore } from './verification';
export * as bytes from './bytes';
