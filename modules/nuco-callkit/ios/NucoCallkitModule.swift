// CallKit plus PushKit for Nuco calls. The design constraint driving everything here:
// call signaling is SEALED content on the Signal channel and the app lock gates
// decryption, so at VoIP push time nothing about the call (not even the caller) is
// knowable. iOS demands that every VoIP push is reported as an incoming call
// synchronously, so the push handler reports a generic "Nuco" call natively, before and
// independent of JS, and the JS side later claims it, names the caller after decrypting
// the offer (post unlock), or ends it as unanswered when no offer materializes. The
// PushKit registry is created at app launch (an AppDelegate subscriber): a killed app
// relaunched by a VoIP push must have the registry in place before the push is handed
// over. No call metadata is ever logged.

import AVFAudio
import CallKit
import ExpoModulesCore
import Foundation
import PushKit
import WebRTC

// Process wide call state, alive from didFinishLaunching on, independent of the JS
// runtime and the Expo module lifecycle.
final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallCenter()

  private var registry: PKPushRegistry?
  private(set) var provider: CXProvider?
  private let callController = CXCallController()

  private(set) var voipToken: String?
  // The AVAudioSession CallKit activated, kept so a WebRTC audio unit created LATER
  // (locked phone: the offer decrypts only after unlock) can still be attached to it.
  private var activeAudioSession: AVAudioSession?
  // Calls reported from a VoIP push that JS has not claimed yet, newest last. Values are
  // epoch ms of the report, so JS can expire stale ones.
  private(set) var pendingCalls: [(uuid: UUID, reportedAt: Int64)] = []
  // Answer taps that arrived before JS claimed the call (locked phone, cold start).
  private(set) var unclaimedAnswers: Set<UUID> = []

  weak var module: NucoCallkitModule?

  func start() {
    guard registry == nil else { return }

    // CallKit decides when the audio session activates; WebRTC must not start its audio
    // unit on its own or the session fights CallKit and the call stays silent. Manual
    // audio: the unit runs only between didActivate and didDeactivate below.
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.useManualAudio = true
    rtcSession.isAudioEnabled = false

    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    let provider = CXProvider(configuration: configuration)
    provider.setDelegate(self, queue: nil)
    self.provider = provider

    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
    if let token = registry.pushToken(for: .voIP) {
      voipToken = hex(token)
    }
  }

  private func hex(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }

  private func emit(_ event: String, _ body: [String: Any]) {
    module?.emitEvent(event, body)
  }

  // --- PKPushRegistryDelegate ---

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    voipToken = hex(pushCredentials.token)
    emit("onVoipToken", ["token": voipToken ?? ""])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    voipToken = nil
    emit("onVoipToken", ["token": ""])
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP, let provider else {
      completion()
      return
    }
    // Mandatory synchronous report. The payload is empty by protocol; everything about
    // the call arrives sealed over the socket once the app can decrypt.
    let uuid = UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "Nuco")
    update.localizedCallerName = "Nuco"
    update.hasVideo = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsHolding = false
    update.supportsDTMF = false
    pendingCalls.append((uuid: uuid, reportedAt: Int64(Date().timeIntervalSince1970 * 1000)))
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if error != nil {
        // Reporting can fail (for example Do Not Disturb for unknown callers); drop the
        // pending entry so JS never waits on a call that was never shown.
        self?.pendingCalls.removeAll { $0.uuid == uuid }
      }
      self?.emit("onVoipPush", ["uuid": uuid.uuidString])
      completion()
    }
  }

  // --- CXProviderDelegate ---

  func providerDidReset(_ provider: CXProvider) {
    pendingCalls.removeAll()
    unclaimedAnswers.removeAll()
    emit("onReset", [:])
  }

  // The session category WebRTC voice expects, set inside the action handlers (Apple's
  // contract: configure here, the activation itself arrives in didActivate).
  private func configureRtcAudio() {
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.lockForConfiguration()
    try? rtcSession.setConfiguration(RTCAudioSessionConfiguration.webRTC())
    rtcSession.unlockForConfiguration()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    if pendingCalls.contains(where: { $0.uuid == action.callUUID }) {
      // Answered before JS claimed it (locked phone): remember, JS auto accepts on claim.
      unclaimedAnswers.insert(action.callUUID)
    }
    configureRtcAudio()
    emit("onAnswer", ["uuid": action.callUUID.uuidString])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    pendingCalls.removeAll { $0.uuid == action.callUUID }
    unclaimedAnswers.remove(action.callUUID)
    emit("onEnd", ["uuid": action.callUUID.uuidString])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    emit("onMuted", ["uuid": action.callUUID.uuidString, "muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    configureRtcAudio()
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
    emit("onStartCall", ["uuid": action.callUUID.uuidString])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    activeAudioSession = audioSession
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.audioSessionDidActivate(audioSession)
    rtcSession.isAudioEnabled = true
    emit("onAudioActivated", [:])
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    activeAudioSession = nil
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.audioSessionDidDeactivate(audioSession)
    rtcSession.isAudioEnabled = false
    emit("onAudioDeactivated", [:])
  }

  // The WebRTC audio unit was created AFTER CallKit activated the session (a lock screen
  // answer: the sealed offer decrypts only post unlock, minutes after didActivate). The
  // unit never saw the activation, so re-hand the session over and cycle the enable flag
  // to start it. Called by JS when the call reaches active; harmless when the unit was
  // already live (an inaudible re-attach at connect time).
  func refreshAudio() {
    guard let session = activeAudioSession else { return }
    let rtcSession = RTCAudioSession.sharedInstance()
    rtcSession.audioSessionDidActivate(session)
    rtcSession.isAudioEnabled = false
    rtcSession.isAudioEnabled = true
  }

  // --- JS facing operations (called through the module) ---

  func claimPendingCalls() -> [[String: Any]] {
    let calls = pendingCalls.map { entry -> [String: Any] in
      [
        "uuid": entry.uuid.uuidString,
        "reportedAt": entry.reportedAt,
        "answered": unclaimedAnswers.contains(entry.uuid),
      ]
    }
    return calls
  }

  func consumePending(_ uuid: UUID) {
    pendingCalls.removeAll { $0.uuid == uuid }
    unclaimedAnswers.remove(uuid)
  }

  func reportIncoming(callerName: String, completion: @escaping (UUID?) -> Void) {
    guard let provider else {
      completion(nil)
      return
    }
    let uuid = UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerName)
    update.localizedCallerName = callerName
    update.hasVideo = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsHolding = false
    update.supportsDTMF = false
    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      completion(error == nil ? uuid : nil)
    }
  }

  func updateCaller(uuid: UUID, callerName: String) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerName)
    update.localizedCallerName = callerName
    provider?.reportCall(with: uuid, updated: update)
  }

  func startOutgoing(calleeName: String, completion: @escaping (UUID?) -> Void) {
    let uuid = UUID()
    let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: calleeName))
    callController.request(CXTransaction(action: action)) { error in
      completion(error == nil ? uuid : nil)
    }
  }

  func reportOutgoingConnected(uuid: UUID) {
    provider?.reportOutgoingCall(with: uuid, connectedAt: nil)
  }

  func endLocal(uuid: UUID, completion: @escaping () -> Void) {
    let action = CXEndCallAction(call: uuid)
    callController.request(CXTransaction(action: action)) { _ in completion() }
  }

  // The app UI accepted a ringing call: route it through CallKit so the system call UI
  // follows (dismisses the incoming banner, shows the active call). The provider
  // delegate's performAnswerCallAction fires as usual; the JS side keeps that idempotent.
  func answerLocal(uuid: UUID, completion: @escaping () -> Void) {
    let action = CXAnswerCallAction(call: uuid)
    callController.request(CXTransaction(action: action)) { _ in completion() }
  }

  func reportEnded(uuid: UUID, reason: String) {
    consumePending(uuid)
    let mapped: CXCallEndedReason
    switch reason {
    case "unanswered": mapped = .unanswered
    case "failed": mapped = .failed
    case "answeredElsewhere": mapped = .answeredElsewhere
    case "declinedElsewhere": mapped = .declinedElsewhere
    default: mapped = .remoteEnded
    }
    provider?.reportCall(with: uuid, endedAt: nil, reason: mapped)
  }
}

// Creates the PushKit registry and the CallKit provider at launch, before any JS runs:
// a VoIP push that relaunched a killed app is delivered as soon as the registry exists.
public class NucoCallkitAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallCenter.shared.start()
    return true
  }
}

public class NucoCallkitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NucoCallkit")
    Events("onVoipToken", "onVoipPush", "onAnswer", "onEnd", "onMuted", "onStartCall", "onAudioActivated", "onAudioDeactivated", "onReset")

    OnCreate {
      CallCenter.shared.module = self
    }

    OnDestroy {
      if CallCenter.shared.module === self {
        CallCenter.shared.module = nil
      }
    }

    Function("getVoipToken") { () -> String? in
      CallCenter.shared.voipToken
    }

    Function("getPendingCalls") { () -> [[String: Any]] in
      CallCenter.shared.claimPendingCalls()
    }

    Function("consumePendingCall") { (uuid: String) in
      if let parsed = UUID(uuidString: uuid) {
        CallCenter.shared.consumePending(parsed)
      }
    }

    AsyncFunction("reportIncomingCall") { (callerName: String, promise: Promise) in
      CallCenter.shared.reportIncoming(callerName: callerName) { uuid in
        if let uuid {
          promise.resolve(uuid.uuidString)
        } else {
          promise.reject("ERR_CALLKIT", "reporting the incoming call failed")
        }
      }
    }

    Function("updateCaller") { (uuid: String, callerName: String) in
      if let parsed = UUID(uuidString: uuid) {
        CallCenter.shared.updateCaller(uuid: parsed, callerName: callerName)
      }
    }

    AsyncFunction("startOutgoingCall") { (calleeName: String, promise: Promise) in
      CallCenter.shared.startOutgoing(calleeName: calleeName) { uuid in
        if let uuid {
          promise.resolve(uuid.uuidString)
        } else {
          promise.reject("ERR_CALLKIT", "starting the outgoing call failed")
        }
      }
    }

    Function("reportOutgoingConnected") { (uuid: String) in
      if let parsed = UUID(uuidString: uuid) {
        CallCenter.shared.reportOutgoingConnected(uuid: parsed)
      }
    }

    AsyncFunction("endCallLocal") { (uuid: String, promise: Promise) in
      guard let parsed = UUID(uuidString: uuid) else {
        promise.resolve(nil)
        return
      }
      CallCenter.shared.endLocal(uuid: parsed) {
        promise.resolve(nil)
      }
    }

    AsyncFunction("answerCallLocal") { (uuid: String, promise: Promise) in
      guard let parsed = UUID(uuidString: uuid) else {
        promise.resolve(nil)
        return
      }
      CallCenter.shared.answerLocal(uuid: parsed) {
        promise.resolve(nil)
      }
    }

    Function("reportCallEnded") { (uuid: String, reason: String) in
      if let parsed = UUID(uuidString: uuid) {
        CallCenter.shared.reportEnded(uuid: parsed, reason: reason)
      }
    }

    Function("refreshAudioSession") {
      CallCenter.shared.refreshAudio()
    }
  }

  func emitEvent(_ event: String, _ body: [String: Any]) {
    sendEvent(event, body)
  }
}
