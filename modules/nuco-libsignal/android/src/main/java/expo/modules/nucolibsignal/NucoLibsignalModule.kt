// Record passing bridge over official libsignal (org.signal:libsignal-android), the
// Kotlin mirror of ios/NucoLibsignalModule.swift. Every function is a pure operation:
// seed fresh in memory stores from the records passed in, run the libsignal call,
// return the result together with the updated session record. Nothing persists here;
// custody and trust policy stay in TypeScript. Compiles with the Android build; runtime
// verification is deferred until Android becomes a shipping target.

package expo.modules.nucolibsignal

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPrivateKey
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.fingerprint.NumericFingerprintGenerator
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyBundle
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

class LocalParty : Record {
  @Field var identityPublic: String = ""
  @Field var identityPrivate: String = ""
  @Field var registrationId: Int = 0
  @Field var handle: String = ""
  @Field var deviceId: Int = 1
}

class RemoteBundle : Record {
  @Field var registrationId: Int = 0
  @Field var identityKey: String = ""
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKey: String = ""
  @Field var signedPreKeySignature: String = ""
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKey: String = ""
  @Field var kyberPreKeySignature: String = ""
}

private fun fromB64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

private fun b64(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)

private fun makeStore(local: LocalParty): InMemorySignalProtocolStore {
  val pair = IdentityKeyPair(
    IdentityKey(ECPublicKey(fromB64(local.identityPublic))),
    ECPrivateKey(fromB64(local.identityPrivate)),
  )
  return InMemorySignalProtocolStore(pair, local.registrationId)
}

private fun serializedSession(
  store: InMemorySignalProtocolStore,
  remote: SignalProtocolAddress,
): String = b64(store.loadSession(remote).serialize())

class NucoLibsignalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NucoLibsignal")

    AsyncFunction("generateIdentityKeyPair") {
      val pair = IdentityKeyPair.generate()
      mapOf(
        "publicKey" to b64(pair.publicKey.serialize()),
        "privateKey" to b64(pair.privateKey.serialize()),
      )
    }

    AsyncFunction("generateSignedPreKey") { identityPrivate: String, keyId: Int ->
      val identityKey = ECPrivateKey(fromB64(identityPrivate))
      val prekey = org.signal.libsignal.protocol.ecc.ECKeyPair.generate()
      val signature = identityKey.calculateSignature(prekey.publicKey.serialize())
      val record = SignedPreKeyRecord(keyId, System.currentTimeMillis(), prekey, signature)
      mapOf(
        "record" to b64(record.serialize()),
        "publicKey" to b64(prekey.publicKey.serialize()),
        "signature" to b64(signature),
      )
    }

    AsyncFunction("generateKyberPreKey") { identityPrivate: String, keyId: Int ->
      val identityKey = ECPrivateKey(fromB64(identityPrivate))
      val kemPair = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
      val signature = identityKey.calculateSignature(kemPair.publicKey.serialize())
      val record = KyberPreKeyRecord(keyId, System.currentTimeMillis(), kemPair, signature)
      mapOf(
        "record" to b64(record.serialize()),
        "publicKey" to b64(kemPair.publicKey.serialize()),
        "signature" to b64(signature),
      )
    }

    AsyncFunction("processPreKeyBundle") {
      local: LocalParty,
      remoteHandle: String,
      remoteDeviceId: Int,
      bundle: RemoteBundle,
      existingSessionRecord: String?,
      ->
      val store = makeStore(local)
      val remoteAddress = SignalProtocolAddress(remoteHandle, remoteDeviceId)
      val localAddress = SignalProtocolAddress(local.handle, local.deviceId)
      if (existingSessionRecord != null) {
        store.storeSession(remoteAddress, SessionRecord(fromB64(existingSessionRecord)))
      }
      val preKeyBundle = PreKeyBundle(
        bundle.registrationId,
        remoteDeviceId,
        PreKeyBundle.NULL_PRE_KEY_ID,
        null,
        bundle.signedPreKeyId,
        ECPublicKey(fromB64(bundle.signedPreKey)),
        fromB64(bundle.signedPreKeySignature),
        IdentityKey(fromB64(bundle.identityKey)),
        bundle.kyberPreKeyId,
        KEMPublicKey(fromB64(bundle.kyberPreKey)),
        fromB64(bundle.kyberPreKeySignature),
      )
      SessionBuilder(store, remoteAddress, localAddress).process(preKeyBundle)
      mapOf("sessionRecord" to serializedSession(store, remoteAddress))
    }

    AsyncFunction("encrypt") {
      local: LocalParty,
      remoteHandle: String,
      remoteDeviceId: Int,
      sessionRecord: String,
      plaintext: String,
      ->
      val store = makeStore(local)
      val remoteAddress = SignalProtocolAddress(remoteHandle, remoteDeviceId)
      val localAddress = SignalProtocolAddress(local.handle, local.deviceId)
      store.storeSession(remoteAddress, SessionRecord(fromB64(sessionRecord)))
      val message = SessionCipher(store, localAddress, remoteAddress).encrypt(fromB64(plaintext))
      val messageType = when (message.type) {
        CiphertextMessage.PREKEY_TYPE -> "prekey"
        CiphertextMessage.WHISPER_TYPE -> "whisper"
        else -> throw IllegalStateException("unexpected ciphertext type ${message.type}")
      }
      mapOf(
        "ciphertext" to b64(message.serialize()),
        "messageType" to messageType,
        "sessionRecord" to serializedSession(store, remoteAddress),
      )
    }

    AsyncFunction("decryptWhisper") {
      local: LocalParty,
      remoteHandle: String,
      remoteDeviceId: Int,
      sessionRecord: String,
      ciphertext: String,
      ->
      val store = makeStore(local)
      val remoteAddress = SignalProtocolAddress(remoteHandle, remoteDeviceId)
      val localAddress = SignalProtocolAddress(local.handle, local.deviceId)
      store.storeSession(remoteAddress, SessionRecord(fromB64(sessionRecord)))
      val plaintext = SessionCipher(store, localAddress, remoteAddress)
        .decrypt(SignalMessage(fromB64(ciphertext)))
      mapOf(
        "plaintext" to b64(plaintext),
        "sessionRecord" to serializedSession(store, remoteAddress),
      )
    }

    AsyncFunction("decryptPreKey") {
      local: LocalParty,
      remoteHandle: String,
      remoteDeviceId: Int,
      existingSessionRecord: String?,
      signedPreKeyRecords: Map<String, String>,
      kyberPreKeyRecords: Map<String, String>,
      ciphertext: String,
      ->
      val store = makeStore(local)
      val remoteAddress = SignalProtocolAddress(remoteHandle, remoteDeviceId)
      val localAddress = SignalProtocolAddress(local.handle, local.deviceId)
      if (existingSessionRecord != null) {
        store.storeSession(remoteAddress, SessionRecord(fromB64(existingSessionRecord)))
      }
      for ((id, recordB64) in signedPreKeyRecords) {
        store.storeSignedPreKey(id.toInt(), SignedPreKeyRecord(fromB64(recordB64)))
      }
      for ((id, recordB64) in kyberPreKeyRecords) {
        store.storeKyberPreKey(id.toInt(), KyberPreKeyRecord(fromB64(recordB64)))
      }
      val message = PreKeySignalMessage(fromB64(ciphertext))
      val remoteIdentityKey = message.identityKey.serialize()
      val plaintext = SessionCipher(store, localAddress, remoteAddress).decrypt(message)
      mapOf(
        "plaintext" to b64(plaintext),
        "sessionRecord" to serializedSession(store, remoteAddress),
        "remoteIdentityKey" to b64(remoteIdentityKey),
      )
    }

    AsyncFunction("fingerprint") {
      iterations: Int,
      version: Int,
      localIdentifier: String,
      localIdentityKey: String,
      remoteIdentifier: String,
      remoteIdentityKey: String,
      ->
      NumericFingerprintGenerator(iterations).createFor(
        version,
        localIdentifier.toByteArray(Charsets.UTF_8),
        IdentityKey(fromB64(localIdentityKey)),
        remoteIdentifier.toByteArray(Charsets.UTF_8),
        IdentityKey(fromB64(remoteIdentityKey)),
      ).displayableFingerprint.displayText
    }
  }
}
