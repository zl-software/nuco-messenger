// Record passing bridge over official libsignal (LibSignalClient). Every function is a
// pure operation: it seeds fresh in memory stores from the records passed in, runs the
// libsignal call, and returns the result together with the updated session record.
// Nothing is persisted here and no key ever touches disk or logs on the native side;
// custody stays with the TypeScript store (SQLCipher). Trust policy also stays in
// TypeScript: the in memory identity store trusts everything (TOFU on an empty map),
// and the caller compares the returned remote identity key against its pinned one
// before persisting anything.

import ExpoModulesCore
import Foundation
import LibSignalClient

struct LocalParty: Record {
  @Field var identityPublic: String = ""
  @Field var identityPrivate: String = ""
  @Field var registrationId: Int = 0
  @Field var handle: String = ""
  @Field var deviceId: Int = 1
}

struct RemoteBundle: Record {
  @Field var registrationId: Int = 0
  @Field var identityKey: String = ""
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKey: String = ""
  @Field var signedPreKeySignature: String = ""
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKey: String = ""
  @Field var kyberPreKeySignature: String = ""
}

private func libsignalError(_ message: String) -> NSError {
  return NSError(domain: "NucoLibsignal", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func fromB64(_ value: String, _ what: String) throws -> Data {
  guard let data = Data(base64Encoded: value) else {
    throw libsignalError("invalid base64 for \(what)")
  }
  return data
}

private func b64(_ data: Data) -> String {
  return data.base64EncodedString()
}

private func nowMs() -> UInt64 {
  return UInt64(Date().timeIntervalSince1970 * 1000)
}

private func makeStore(_ local: LocalParty) throws -> InMemorySignalProtocolStore {
  let privateKey = try PrivateKey(fromB64(local.identityPrivate, "identity private key"))
  let publicKey = try PublicKey(fromB64(local.identityPublic, "identity public key"))
  let pair = IdentityKeyPair(publicKey: publicKey, privateKey: privateKey)
  return InMemorySignalProtocolStore(identity: pair, registrationId: UInt32(local.registrationId))
}

private func address(_ name: String, _ deviceId: Int) throws -> ProtocolAddress {
  return try ProtocolAddress(name: name, deviceId: UInt32(deviceId))
}

private func serializedSession(
  _ store: InMemorySignalProtocolStore,
  _ remote: ProtocolAddress
) throws -> String {
  guard let session = try store.loadSession(for: remote, context: NullContext()) else {
    throw libsignalError("libsignal left no session record")
  }
  return b64(session.serialize())
}

public class NucoLibsignalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NucoLibsignal")

    AsyncFunction("generateIdentityKeyPair") { () -> [String: String] in
      let pair = IdentityKeyPair.generate()
      return [
        "publicKey": b64(pair.publicKey.serialize()),
        "privateKey": b64(pair.privateKey.serialize()),
      ]
    }

    AsyncFunction("generateSignedPreKey") { (identityPrivate: String, keyId: Int) -> [String: String] in
      let identityKey = try PrivateKey(fromB64(identityPrivate, "identity private key"))
      let prekey = PrivateKey.generate()
      let publicKey = prekey.publicKey
      let signature = identityKey.generateSignature(message: publicKey.serialize())
      let record = try SignedPreKeyRecord(
        id: UInt32(keyId),
        timestamp: nowMs(),
        privateKey: prekey,
        signature: signature
      )
      return [
        "record": b64(record.serialize()),
        "publicKey": b64(publicKey.serialize()),
        "signature": b64(signature),
      ]
    }

    AsyncFunction("generateKyberPreKey") { (identityPrivate: String, keyId: Int) -> [String: String] in
      let identityKey = try PrivateKey(fromB64(identityPrivate, "identity private key"))
      let kemPair = KEMKeyPair.generate()
      let publicKey = kemPair.publicKey
      let signature = identityKey.generateSignature(message: publicKey.serialize())
      let record = try KyberPreKeyRecord(
        id: UInt32(keyId),
        timestamp: nowMs(),
        keyPair: kemPair,
        signature: signature
      )
      return [
        "record": b64(record.serialize()),
        "publicKey": b64(publicKey.serialize()),
        "signature": b64(signature),
      ]
    }

    AsyncFunction("processPreKeyBundle") {
      (
        local: LocalParty,
        remoteHandle: String,
        remoteDeviceId: Int,
        bundle: RemoteBundle,
        existingSessionRecord: String?
      ) -> [String: String] in
      let store = try makeStore(local)
      let context = NullContext()
      let remoteAddress = try address(remoteHandle, remoteDeviceId)
      let localAddress = try address(local.handle, local.deviceId)
      if let existing = existingSessionRecord {
        let record = try SessionRecord(bytes: fromB64(existing, "session record"))
        try store.storeSession(record, for: remoteAddress, context: context)
      }
      let preKeyBundle = try PreKeyBundle(
        registrationId: UInt32(bundle.registrationId),
        deviceId: UInt32(remoteDeviceId),
        signedPrekeyId: UInt32(bundle.signedPreKeyId),
        signedPrekey: PublicKey(fromB64(bundle.signedPreKey, "signed prekey")),
        signedPrekeySignature: fromB64(bundle.signedPreKeySignature, "signed prekey signature"),
        identity: IdentityKey(bytes: fromB64(bundle.identityKey, "identity key")),
        kyberPrekeyId: UInt32(bundle.kyberPreKeyId),
        kyberPrekey: KEMPublicKey(fromB64(bundle.kyberPreKey, "kyber prekey")),
        kyberPrekeySignature: fromB64(bundle.kyberPreKeySignature, "kyber prekey signature")
      )
      try LibSignalClient.processPreKeyBundle(
        preKeyBundle,
        for: remoteAddress,
        ourAddress: localAddress,
        sessionStore: store,
        identityStore: store,
        context: context
      )
      return ["sessionRecord": try serializedSession(store, remoteAddress)]
    }

    AsyncFunction("encrypt") {
      (
        local: LocalParty,
        remoteHandle: String,
        remoteDeviceId: Int,
        sessionRecord: String,
        plaintext: String
      ) -> [String: String] in
      let store = try makeStore(local)
      let context = NullContext()
      let remoteAddress = try address(remoteHandle, remoteDeviceId)
      let localAddress = try address(local.handle, local.deviceId)
      let record = try SessionRecord(bytes: fromB64(sessionRecord, "session record"))
      try store.storeSession(record, for: remoteAddress, context: context)
      let message = try signalEncrypt(
        message: fromB64(plaintext, "plaintext"),
        for: remoteAddress,
        localAddress: localAddress,
        sessionStore: store,
        identityStore: store,
        context: context
      )
      let messageType: String
      switch message.messageType {
      case .preKey: messageType = "prekey"
      case .whisper: messageType = "whisper"
      default: throw libsignalError("unexpected ciphertext type \(message.messageType.rawValue)")
      }
      return [
        "ciphertext": b64(message.serialize()),
        "messageType": messageType,
        "sessionRecord": try serializedSession(store, remoteAddress),
      ]
    }

    AsyncFunction("decryptWhisper") {
      (
        local: LocalParty,
        remoteHandle: String,
        remoteDeviceId: Int,
        sessionRecord: String,
        ciphertext: String
      ) -> [String: String] in
      let store = try makeStore(local)
      let context = NullContext()
      let remoteAddress = try address(remoteHandle, remoteDeviceId)
      let localAddress = try address(local.handle, local.deviceId)
      let record = try SessionRecord(bytes: fromB64(sessionRecord, "session record"))
      try store.storeSession(record, for: remoteAddress, context: context)
      let message = try SignalMessage(bytes: fromB64(ciphertext, "ciphertext"))
      let plaintext = try signalDecrypt(
        message: message,
        from: remoteAddress,
        to: localAddress,
        sessionStore: store,
        identityStore: store,
        context: context
      )
      return [
        "plaintext": b64(plaintext),
        "sessionRecord": try serializedSession(store, remoteAddress),
      ]
    }

    AsyncFunction("decryptPreKey") {
      (
        local: LocalParty,
        remoteHandle: String,
        remoteDeviceId: Int,
        existingSessionRecord: String?,
        signedPreKeyRecords: [String: String],
        kyberPreKeyRecords: [String: String],
        ciphertext: String
      ) -> [String: String] in
      let store = try makeStore(local)
      let context = NullContext()
      let remoteAddress = try address(remoteHandle, remoteDeviceId)
      let localAddress = try address(local.handle, local.deviceId)
      if let existing = existingSessionRecord {
        let record = try SessionRecord(bytes: fromB64(existing, "session record"))
        try store.storeSession(record, for: remoteAddress, context: context)
      }
      for (id, recordB64) in signedPreKeyRecords {
        guard let keyId = UInt32(id) else { throw libsignalError("bad signed prekey id \(id)") }
        let record = try SignedPreKeyRecord(bytes: fromB64(recordB64, "signed prekey record"))
        try store.storeSignedPreKey(record, id: keyId, context: context)
      }
      for (id, recordB64) in kyberPreKeyRecords {
        guard let keyId = UInt32(id) else { throw libsignalError("bad kyber prekey id \(id)") }
        let record = try KyberPreKeyRecord(bytes: fromB64(recordB64, "kyber prekey record"))
        try store.storeKyberPreKey(record, id: keyId, context: context)
      }
      let message = try PreKeySignalMessage(bytes: fromB64(ciphertext, "ciphertext"))
      let remoteIdentityKey = message.identityKey.serialize()
      let plaintext = try signalDecryptPreKey(
        message: message,
        from: remoteAddress,
        localAddress: localAddress,
        sessionStore: store,
        identityStore: store,
        preKeyStore: store,
        signedPreKeyStore: store,
        kyberPreKeyStore: store,
        context: context
      )
      return [
        "plaintext": b64(plaintext),
        "sessionRecord": try serializedSession(store, remoteAddress),
        "remoteIdentityKey": b64(remoteIdentityKey),
      ]
    }

    AsyncFunction("fingerprint") {
      (
        iterations: Int,
        version: Int,
        localIdentifier: String,
        localIdentityKey: String,
        remoteIdentifier: String,
        remoteIdentityKey: String
      ) -> String in
      let fingerprint = try NumericFingerprintGenerator(iterations: iterations).create(
        version: version,
        localIdentifier: Data(localIdentifier.utf8),
        localKey: PublicKey(fromB64(localIdentityKey, "local identity key")),
        remoteIdentifier: Data(remoteIdentifier.utf8),
        remoteKey: PublicKey(fromB64(remoteIdentityKey, "remote identity key"))
      )
      return fingerprint.displayable.formatted
    }
  }
}
