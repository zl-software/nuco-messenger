// A minimal WebSocket over URLSessionWebSocketTask. RN's own WebSocket rides SocketRocket
// over raw streams, OUTSIDE the URL Loading System, so App Transport Security and the
// NSPinnedDomains certificate pins never apply to it. Routing the relay socket through
// URLSession puts it back under ATS: the OS enforces the Info.plist pins during the TLS
// handshake and this module needs no pin logic at all. A pin failure surfaces as
// NSURLErrorServerCertificateUntrusted (-1202) through onError, then onClose, landing in
// the RelayClient's ordinary reconnect backoff. Text frames only (the relay protocol is
// JSON text); nothing here is Nuco specific beyond that.

import ExpoModulesCore
import Foundation

final class SocketHolder: NSObject, URLSessionWebSocketDelegate {
  let id: Int
  private var session: URLSession!
  private var task: URLSessionWebSocketTask!
  private var closed = false
  private weak var module: NucoPinnedWsModule?

  init(id: Int, url: URL, module: NucoPinnedWsModule) {
    self.id = id
    self.module = module
    super.init()
    // .default configuration: ATS, and therefore NSPinnedDomains, applies.
    session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    task = session.webSocketTask(with: url)
  }

  func start() {
    receiveLoop()
    task.resume()
  }

  private func receiveLoop() {
    task.receive { [weak self] result in
      guard let self, !self.closed else { return }
      switch result {
      case .success(.string(let text)):
        self.module?.emit(self.id, "onMessage", ["data": text])
        self.receiveLoop()
      case .success(.data(let data)):
        // The relay protocol is JSON text only; decode defensively.
        self.module?.emit(self.id, "onMessage", ["data": String(data: data, encoding: .utf8) ?? ""])
        self.receiveLoop()
      case .failure(let error):
        self.fail(error)
      @unknown default:
        self.receiveLoop()
      }
    }
  }

  func send(_ text: String) {
    task.send(.string(text)) { [weak self] error in
      if let error { self?.fail(error) }
    }
  }

  func close() {
    guard !closed else { return }
    task.cancel(with: .normalClosure, reason: nil)
    // didCloseWith or didCompleteWithError finishes teardown; finish() is idempotent.
  }

  private func fail(_ error: Error) {
    let nsError = error as NSError
    // Dev observability: a pin failure is NSURLErrorDomain code -1202. No URLs or
    // payloads in the event, just the error identity.
    module?.emit(id, "onError", ["message": nsError.localizedDescription, "domain": nsError.domain, "code": nsError.code])
    finish(code: nil, reason: nil)
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocolName: String?) {
    module?.emit(id, "onOpen", [:])
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    finish(code: closeCode.rawValue, reason: reason.flatMap { String(data: $0, encoding: .utf8) })
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error, !closed {
      fail(error)
      return
    }
    finish(code: nil, reason: nil)
  }

  private func finish(code: Int?, reason: String?) {
    guard !closed else { return }
    closed = true
    module?.emit(id, "onClose", ["code": code as Any, "reason": reason as Any])
    session.invalidateAndCancel()
    module?.remove(id)
  }
}

public class NucoPinnedWsModule: Module {
  private var sockets = [Int: SocketHolder]()
  private var nextId = 0
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("NucoPinnedWs")
    Events("onOpen", "onMessage", "onError", "onClose")

    Function("connect") { (urlString: String) -> Int in
      guard let url = URL(string: urlString) else {
        throw NSError(domain: "NucoPinnedWs", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid url"])
      }
      self.lock.lock()
      self.nextId += 1
      let id = self.nextId
      self.lock.unlock()
      let holder = SocketHolder(id: id, url: url, module: self)
      self.lock.lock()
      self.sockets[id] = holder
      self.lock.unlock()
      holder.start()
      return id
    }

    Function("send") { (id: Int, data: String) in
      self.socket(id)?.send(data)
    }

    Function("close") { (id: Int) in
      self.socket(id)?.close()
    }
  }

  func emit(_ id: Int, _ event: String, _ body: [String: Any]) {
    var payload = body
    payload["id"] = id
    sendEvent(event, payload)
  }

  private func socket(_ id: Int) -> SocketHolder? {
    lock.lock()
    defer { lock.unlock() }
    return sockets[id]
  }

  func remove(_ id: Int) {
    lock.lock()
    sockets[id] = nil
    lock.unlock()
  }
}
