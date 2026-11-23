// WP38b: originelen in delen naar R2, ook op de achtergrond.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b,
// invarianten 38b-13 tot 38b-16. Gebouwd op de spike (`wp38b-spike`).
//
// - Twee achtergrond-sessies met een vaste naam: "wifi" (geen mobiel internet,
//   geen dure netwerken zoals een persoonlijke hotspot) en "alles". Een vaste
//   naam koppelt iOS na een herstart of een wekbeurt weer aan de app. Omzetten
//   van de schakelaar verplaatst wachtende en lopende delen meteen; een deel
//   loopt nooit in beide.
// - Besluit 21: krijgt de uploader delen, dan snijdt hij ze allemaal, elk naar
//   een eigen bestand (iOS uploadt op de achtergrond alleen een heel bestand),
//   en geeft ze meteen aan iOS. Een deelbestand gaat weg zodra het deel klaar
//   is. Geen eigen headers: de link ondertekent `content-length;host`.
// - Een taak die op de achtergrond aan iOS gegeven is, stelt iOS uit (spike
//   3). Komt de app voor en is zo'n taak nog niet begonnen, dan stopt de
//   uploader hem en geeft hem opnieuw, nu met de app open.
// - 38b-14: elk deel één keer onderweg. Bij het openen legt de uploader zijn
//   opslag naast de taken van iOS (een deel zonder taak krijgt er precies één,
//   een taak zonder deel stopt), en er start niets voordat dat gebeurd is.
//   Elke taak draagt een token; de afloop van een taak met een token dat het
//   deel niet meer heeft (nieuwe links, omgezet, vergeten) telt niet.
// - 38b-15: per deel klaar of mislukt (status, foutcode van R2, pogingen met
//   de huidige link), en één event "alle delen klaar" per ronde links. Een
//   stop door iOS (fout -999, app weggeveegd) telt niet als poging en is geen
//   mislukking: het deel gaat weer in de rij. Over een mislukking beslist de
//   app (src/lib/originalQueue.ts), niet de uploader.
// - Het bewaarde bestand heeft niet meer de aangemelde grootte of is weg: geen
//   kort deel, maar het event "bestand kapot".
// - 38b-16: geen link, sleutel of pad in het log of een event; alleen
//   inzending-id, deelnummer, status en foutcode.

import ExpoModulesCore
import Foundation
import Network
import UIKit

// MARK: - opslag

struct UploadPart: Codable {
  var partNumber: Int
  var offset: Int64
  var size: Int64
  var url: String?
  /// "wacht" | "bezig" | "klaar" | "mislukt"
  var state: String
  var sent: Int64
  var httpStatus: Int?
  var code: String?
  /// Mislukte pogingen met de huidige link.
  var attempts: Int
  var session: String?
  var token: String?
  /// De taak is aan iOS gegeven terwijl de app op de achtergrond was.
  var startedInBackground: Bool
  var updatedAt: Double
}

struct UploadJob: Codable {
  var originalId: String
  var fileName: String
  var totalBytes: Int64
  var partSize: Int64
  var expiresAt: Double
  var createdAt: Double
  /// Het event "alle delen klaar" is gestuurd voor deze ronde links.
  var allDoneSent: Bool
  /// Het bewaarde bestand is weg of heeft een andere grootte.
  var broken: Bool
  var parts: [UploadPart]
}

struct UploaderStore: Codable {
  var wifiOnly: Bool = true
  var jobs: [UploadJob] = []
}

struct TaskTag: Codable {
  var originalId: String
  var partNumber: Int
  var token: String
}

struct NewPartLink {
  var partNumber: Int
  var offset: Int64
  var size: Int64
  var url: String
}

enum UploaderError: Error, LocalizedError {
  case badJob
  case noSource
  case short

  var errorDescription: String? {
    switch self {
    case .badJob: return "Ongeldige upload"
    case .noSource: return "Het origineel staat niet meer op het toestel"
    case .short: return "Het origineel is korter dan aangemeld"
    }
  }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

// MARK: - netwerk en log

final class NetworkWatch: @unchecked Sendable {
  private let monitor = NWPathMonitor()
  private let lock = NSLock()
  private var current: [String: Any] = ["type": "onbekend", "expensive": false, "constrained": false]
  var onChange: (([String: Any]) -> Void)?

  init() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      var type = "anders"
      if path.status != .satisfied {
        type = "geen"
      } else if path.usesInterfaceType(.wifi) {
        type = "wifi"
      } else if path.usesInterfaceType(.cellular) {
        type = "mobiel"
      } else if path.usesInterfaceType(.wiredEthernet) {
        type = "kabel"
      }
      let next: [String: Any] = ["type": type, "expensive": path.isExpensive, "constrained": path.isConstrained]
      self.lock.lock()
      let before = Self.label(self.current)
      self.current = next
      self.lock.unlock()
      if before != Self.label(next) { self.onChange?(next) }
    }
    monitor.start(queue: DispatchQueue(label: "clubalmanac.original.net"))
  }

  var status: [String: Any] {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  var label: String { Self.label(status) }

  static func label(_ s: [String: Any]) -> String {
    var text = (s["type"] as? String) ?? "onbekend"
    if s["expensive"] as? Bool == true { text += ", duur" }
    if s["constrained"] as? Bool == true { text += ", beperkt" }
    return text
  }
}

/// Het log van de uploader (voor het proefscherm), op schijf. Nooit een link, sleutel of pad.
final class OriginalLog: @unchecked Sendable {
  private let q = DispatchQueue(label: "clubalmanac.original.log")
  private var file: URL { OriginalDirs.state.appendingPathComponent("log.jsonl") }
  private let maxBytes = 1_000_000

  func add(_ text: String, net: String) {
    let line: [String: Any] = ["at": nowMs(), "net": net, "text": String(text.prefix(300))]
    q.async {
      guard var data = try? JSONSerialization.data(withJSONObject: line) else { return }
      data.append(0x0A)
      let url = self.file
      if let h = try? FileHandle(forWritingTo: url) {
        _ = try? h.seekToEnd()
        try? h.write(contentsOf: data)
        try? h.close()
      } else {
        try? data.write(to: url, options: .completeFileProtectionUntilFirstUserAuthentication)
      }
      if fileSize(url) > self.maxBytes, let all = try? Data(contentsOf: url) {
        // De oudste helft weg, vanaf een regelgrens.
        let tail = all.suffix(self.maxBytes / 2)
        if let nl = tail.firstIndex(of: 0x0A) { try? Data(tail[(nl + 1)...]).write(to: url, options: .atomic) }
      }
    }
  }

  func read(limit: Int) -> [[String: Any]] {
    q.sync {
      guard let data = try? Data(contentsOf: file) else { return [] }
      let lines = data.split(separator: 0x0A).suffix(max(0, limit))
      return lines.compactMap { try? JSONSerialization.jsonObject(with: Data($0)) as? [String: Any] }
    }
  }

  func clear() {
    q.sync { try? FileManager.default.removeItem(at: file) }
  }
}

// MARK: - de uploader

final class OriginalUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  static let shared = OriginalUploader()

  static let wifiName = "wifi"
  static let anyName = "alles"
  static var prefix: String { (Bundle.main.bundleIdentifier ?? "clubalmanac") + ".originals." }
  static var wifiIdentifier: String { prefix + wifiName }
  static var anyIdentifier: String { prefix + anyName }

  /// Alles wat de opslag raakt, loopt over deze queue (ook de terugroepen van de sessies).
  private let q = DispatchQueue(label: "clubalmanac.original.uploader")
  private var store = UploaderStore()
  private var wifiSession: URLSession!
  private var anySession: URLSession!
  private var started = false
  /// Pas na het naast elkaar leggen van opslag en taken start er iets (38b-14).
  private var reconciled = false
  /// Zolang er taken gestopt worden, start er niets nieuws.
  private var holds = 0
  private var foreground = false
  private var responseBodies: [String: Data] = [:]
  private var backgroundCompletions: [String: () -> Void] = [:]

  let net = NetworkWatch()
  let log = OriginalLog()
  private let emitLock = NSLock()
  private var emitter: ((String, [String: Any?]) -> Void)?
  /// De module stuurt events door naar JS, als die er is.
  var emit: ((String, [String: Any?]) -> Void)? {
    get { emitLock.lock(); defer { emitLock.unlock() }; return emitter }
    set { emitLock.lock(); emitter = newValue; emitLock.unlock() }
  }

  private var storeFile: URL { OriginalDirs.state.appendingPathComponent("uploader.json") }

  private override init() {
    super.init()
    if let data = try? Data(contentsOf: storeFile), let s = try? JSONDecoder().decode(UploaderStore.self, from: data) {
      store = s
    }
    let oq = OperationQueue()
    oq.maxConcurrentOperationCount = 1
    oq.underlyingQueue = q
    wifiSession = URLSession(configuration: Self.configuration(Self.wifiIdentifier, wifiOnly: true), delegate: self, delegateQueue: oq)
    anySession = URLSession(configuration: Self.configuration(Self.anyIdentifier, wifiOnly: false), delegate: self, delegateQueue: oq)
    net.onChange = { [weak self] status in
      guard let self else { return }
      self.log.add("netwerk: \(NetworkWatch.label(status))", net: NetworkWatch.label(status))
      self.emit?("onNetwork", ["type": status["type"], "expensive": status["expensive"]])
    }
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.q.async { self?.becameActive() }
    }
    center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.q.async {
        self?.foreground = false
        self?.note("app naar de achtergrond")
      }
    }
  }

  private static func configuration(_ identifier: String, wifiOnly: Bool) -> URLSessionConfiguration {
    let c = URLSessionConfiguration.background(withIdentifier: identifier)
    c.sessionSendsLaunchEvents = true
    c.isDiscretionary = false
    c.allowsCellularAccess = !wifiOnly
    c.allowsExpensiveNetworkAccess = !wifiOnly
    c.timeoutIntervalForResource = 7 * 24 * 60 * 60
    return c
  }

  func owns(_ identifier: String) -> Bool {
    identifier == Self.wifiIdentifier || identifier == Self.anyIdentifier
  }

  private func sessionName(_ session: URLSession) -> String {
    session.configuration.identifier == Self.wifiIdentifier ? Self.wifiName : Self.anyName
  }

  private func note(_ text: String) {
    log.add(text, net: net.label)
  }

  /// Een regel van de app (de runner) in hetzelfde log.
  func noteFromApp(_ text: String) {
    log.add("app: \(text)", net: net.label)
  }

  private func save() {
    guard let data = try? JSONEncoder().encode(store) else { return }
    try? data.write(to: storeFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  // MARK: start en herstel

  /// Bij het starten van de app (ook als iOS hem op de achtergrond wekt): de
  /// sessies zijn er (init); de lopende taken ophalen en naast de opslag leggen.
  func start(reason: String) {
    Task { @MainActor in
      let active = UIApplication.shared.applicationState != .background
      self.q.async {
        if self.started { return }
        self.started = true
        self.foreground = active
        self.note("uploader start (\(reason), \(active ? "voorgrond" : "achtergrond"))")
        self.reconcile()
      }
    }
  }

  private func allTasks(_ done: @escaping (_ wifi: [URLSessionTask], _ any: [URLSessionTask]) -> Void) {
    wifiSession.getAllTasks { wifi in
      self.anySession.getAllTasks { any in
        self.q.async { done(wifi, any) }
      }
    }
  }

  private func reconcile() {
    holds += 1
    allTasks { wifi, any in
      var live: [String: URLSessionTask] = [:]
      for t in wifi + any {
        if let tag = Self.tag(t) { live[tag.token] = t } else { t.cancel() }
      }
      var restarted = 0
      var kept = Set<String>()
      for j in self.store.jobs.indices {
        for p in self.store.jobs[j].parts.indices where self.store.jobs[j].parts[p].state == "bezig" {
          if let token = self.store.jobs[j].parts[p].token, live[token] != nil {
            kept.insert(token)
          } else {
            self.store.jobs[j].parts[p].state = "wacht"
            self.store.jobs[j].parts[p].token = nil
            restarted += 1
          }
        }
      }
      var orphans = 0
      for (token, task) in live where !kept.contains(token) {
        task.cancel()
        orphans += 1
      }
      self.removeOrphanPartFiles()
      self.save()
      self.note("teruggevonden: \(kept.count) taken lopen door, \(restarted) delen opnieuw in de rij, \(orphans) losse taken gestopt")
      self.reconciled = true
      self.holds -= 1
      self.pump()
    }
  }

  /// De app komt voor: taken die op de achtergrond aan iOS gegeven zijn en nog
  /// niet begonnen, opnieuw geven (iOS stelt ze anders uit; spike 3).
  private func becameActive() {
    foreground = true
    guard reconciled else { return }
    let deferred = store.jobs.contains { $0.parts.contains { $0.state == "bezig" && $0.startedInBackground } }
    if !deferred {
      pump()
      return
    }
    holds += 1
    allTasks { wifi, any in
      var again = 0
      for t in wifi + any {
        guard let tag = Self.tag(t), let loc = self.find(tag) else { continue }
        let (j, p) = loc
        guard self.store.jobs[j].parts[p].startedInBackground else { continue }
        if t.countOfBytesSent == 0 && t.state != .completed {
          self.store.jobs[j].parts[p].state = "wacht"
          self.store.jobs[j].parts[p].token = nil
          t.cancel()
          again += 1
        } else {
          self.store.jobs[j].parts[p].startedInBackground = false
        }
      }
      if again > 0 { self.note("app voor: \(again) uitgestelde delen opnieuw aan iOS") }
      self.save()
      self.holds -= 1
      self.pump()
    }
  }

  // MARK: vanuit JS

  /// Delen met links aan iOS (`aan_ios`). Nieuwe links vervangen de oude; een
  /// deel zonder link staat al in R2. Een deel dat met een oude link loopt,
  /// stopt eerst.
  func send(originalId: String, fileName: String, totalBytes: Int64, partSize: Int64, expiresAt: Double, links: [NewPartLink]) throws {
    guard !originalId.isEmpty, OriginalDirs.safeName(fileName) != nil, totalBytes > 0, partSize > 0 else {
      throw UploaderError.badJob
    }
    let count = Int((totalBytes + partSize - 1) / partSize)
    for l in links {
      guard l.partNumber >= 1, l.partNumber <= count, URL(string: l.url) != nil,
        l.offset == Int64(l.partNumber - 1) * partSize, l.size == min(partSize, totalBytes - l.offset)
      else { throw UploaderError.badJob }
    }
    q.sync {
      let byNumber = Dictionary(links.map { ($0.partNumber, $0) }, uniquingKeysWith: { a, _ in a })
      let now = nowMs()
      var stale = Set<String>()
      if let j = self.store.jobs.firstIndex(where: { $0.originalId == originalId }),
        self.store.jobs[j].totalBytes == totalBytes, self.store.jobs[j].partSize == partSize,
        self.store.jobs[j].fileName == fileName {
        for p in self.store.jobs[j].parts.indices {
          var part = self.store.jobs[j].parts[p]
          if part.state == "bezig", let t = part.token { stale.insert(t) }
          if let link = byNumber[part.partNumber] {
            part.url = link.url
            part.state = "wacht"
            part.attempts = 0
            part.sent = 0
            part.httpStatus = nil
            part.code = nil
            part.token = nil
          } else if part.state != "klaar" {
            part.state = "klaar"
            part.url = nil
            part.sent = part.size
            part.token = nil
            try? FileManager.default.removeItem(at: self.partFile(originalId, part.partNumber))
          }
          part.updatedAt = now
          self.store.jobs[j].parts[p] = part
        }
        self.store.jobs[j].expiresAt = expiresAt
        self.store.jobs[j].allDoneSent = false
        self.store.jobs[j].broken = false
        self.note("\(originalId): nieuwe links voor \(byNumber.count) van \(count) delen")
      } else {
        if let j = self.store.jobs.firstIndex(where: { $0.originalId == originalId }) {
          for part in self.store.jobs[j].parts { if let t = part.token { stale.insert(t) } }
          self.store.jobs.remove(at: j)
          self.removePartFiles(originalId)
        }
        var parts: [UploadPart] = []
        for n in 1...count {
          let offset = Int64(n - 1) * partSize
          let size = min(partSize, totalBytes - offset)
          let link = byNumber[n]
          parts.append(UploadPart(
            partNumber: n, offset: offset, size: size, url: link?.url,
            state: link == nil ? "klaar" : "wacht", sent: link == nil ? size : 0, httpStatus: nil, code: nil,
            attempts: 0, session: nil, token: nil, startedInBackground: false, updatedAt: now))
        }
        self.store.jobs.append(UploadJob(
          originalId: originalId, fileName: fileName, totalBytes: totalBytes, partSize: partSize,
          expiresAt: expiresAt, createdAt: now, allDoneSent: false, broken: false, parts: parts))
        self.note("\(originalId): \(byNumber.count) van \(count) delen aan iOS")
      }
      self.save()
      if stale.isEmpty {
        self.pump()
      } else {
        self.cancelTasks { stale.contains($0.token) }
      }
    }
  }

  /// Een mislukt deel opnieuw bij iOS, met dezelfde link (`ios_opnieuw`).
  func retryPart(_ originalId: String, _ partNumber: Int) {
    q.sync {
      guard let j = self.store.jobs.firstIndex(where: { $0.originalId == originalId }),
        let p = self.store.jobs[j].parts.firstIndex(where: { $0.partNumber == partNumber }),
        self.store.jobs[j].parts[p].state == "mislukt"
      else { return }
      self.store.jobs[j].parts[p].state = "wacht"
      self.store.jobs[j].parts[p].updatedAt = nowMs()
      self.save()
      self.pump()
    }
  }

  /// Alles van dit origineel weg: taken, deelbestanden en opslag (`ios_vergeten`).
  func forget(_ originalId: String) {
    q.sync {
      let known = self.store.jobs.contains { $0.originalId == originalId }
      self.store.jobs.removeAll { $0.originalId == originalId }
      self.removePartFiles(originalId)
      self.save()
      if known { self.note("\(originalId): vergeten, deelbestanden weg") }
      self.cancelTasks { $0.originalId == originalId }
    }
  }

  func wifiOnly() -> Bool {
    q.sync { self.store.wifiOnly }
  }

  /// Omzetten geldt meteen, ook voor wachtende en lopende delen.
  func setWifiOnly(_ on: Bool) {
    q.sync {
      if self.store.wifiOnly == on { return }
      self.store.wifiOnly = on
      let from = on ? Self.anyName : Self.wifiName
      var moved = 0
      for j in self.store.jobs.indices {
        for p in self.store.jobs[j].parts.indices
        where self.store.jobs[j].parts[p].state == "bezig" && self.store.jobs[j].parts[p].session == from {
          self.store.jobs[j].parts[p].state = "wacht"
          self.store.jobs[j].parts[p].token = nil
          moved += 1
        }
      }
      self.save()
      self.note("alleen via wifi: \(on ? "aan" : "uit"); \(moved) delen naar de sessie \(on ? Self.wifiName : Self.anyName)")
      self.cancelTasks(in: on ? [self.anySession] : [self.wifiSession]) { _ in true }
    }
  }

  /// De stand per origineel, zonder links.
  func jobsJSON() -> String {
    q.sync {
      let jobs: [[String: Any]] = self.store.jobs.map { job in
        [
          "originalId": job.originalId,
          "totalBytes": Double(job.totalBytes),
          "expiresAt": job.expiresAt,
          "broken": job.broken,
          "parts": job.parts.map { p -> [String: Any] in
            var out: [String: Any] = [
              "partNumber": p.partNumber, "state": p.state, "attempts": p.attempts,
              "size": Double(p.size), "sent": Double(p.sent), "updatedAt": p.updatedAt,
              "status": p.httpStatus.map { $0 as Any } ?? NSNull(),
              "code": p.code.map { $0 as Any } ?? NSNull(),
            ]
            if let s = p.session { out["session"] = s }
            return out
          },
        ]
      }
      let data = (try? JSONSerialization.data(withJSONObject: ["wifiOnly": self.store.wifiOnly, "jobs": jobs])) ?? Data("{}".utf8)
      return String(data: data, encoding: .utf8) ?? "{}"
    }
  }

  func setBackgroundCompletion(_ identifier: String, _ handler: @escaping () -> Void) {
    q.async {
      self.backgroundCompletions[identifier] = handler
      self.note("iOS wekt de app voor de sessie \(identifier == Self.wifiIdentifier ? Self.wifiName : Self.anyName)")
    }
  }

  // MARK: de rij

  private static func fileKey(_ originalId: String) -> String {
    String(originalId.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) && $0.isASCII ? Character($0) : "_" })
  }

  private func partFile(_ originalId: String, _ partNumber: Int) -> URL {
    OriginalDirs.parts.appendingPathComponent("\(Self.fileKey(originalId))-\(partNumber).part")
  }

  private func removePartFiles(_ originalId: String) {
    let prefix = Self.fileKey(originalId) + "-"
    let dir = OriginalDirs.parts
    for name in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasPrefix(prefix) {
      try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
    }
  }

  /// Deelbestanden zonder origineel in de opslag (bv. na een crash) weg.
  private func removeOrphanPartFiles() {
    let prefixes = store.jobs.map { Self.fileKey($0.originalId) + "-" }
    let dir = OriginalDirs.parts
    for name in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    where !prefixes.contains(where: { name.hasPrefix($0) }) {
      try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
    }
  }

  private func source(_ job: UploadJob) -> URL? {
    guard let name = OriginalDirs.safeName(job.fileName) else { return nil }
    return OriginalDirs.originals.appendingPathComponent(name)
  }

  private func slice(source src: URL, offset: Int64, length: Int64, to dest: URL) throws {
    if fileSize(dest) == Int(length) { return }
    try? FileManager.default.removeItem(at: dest)
    guard FileManager.default.fileExists(atPath: src.path) else { throw UploaderError.noSource }
    guard FileManager.default.createFile(
      atPath: dest.path, contents: nil,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    else { throw CocoaError(.fileWriteUnknown) }
    do {
      let input = try FileHandle(forReadingFrom: src)
      defer { try? input.close() }
      let output = try FileHandle(forWritingTo: dest)
      defer { try? output.close() }
      try input.seek(toOffset: UInt64(offset))
      var left = length
      while left > 0 {
        try autoreleasepool {
          let chunk = try input.read(upToCount: Int(min(left, 4 << 20))) ?? Data()
          if chunk.isEmpty { throw UploaderError.short }
          try output.write(contentsOf: chunk)
          left -= Int64(chunk.count)
        }
      }
    } catch {
      try? FileManager.default.removeItem(at: dest)
      throw error
    }
  }

  private func emitFailed(_ originalId: String, _ part: UploadPart) {
    emit?("onPartFailed", [
      "originalId": originalId, "partNumber": part.partNumber,
      "status": part.httpStatus, "code": part.code, "attempts": part.attempts,
    ])
  }

  private func markBroken(_ j: Int) {
    store.jobs[j].broken = true
    let id = store.jobs[j].originalId
    note("\(id): het bewaarde bestand is weg of heeft een andere grootte")
    emit?("onFileBroken", ["originalId": id])
  }

  /// Snijdt elk wachtend deel en geeft het meteen aan iOS (besluit 21). Alleen op `q`.
  private func pump() {
    guard reconciled, holds == 0 else { return }
    let session = store.wifiOnly ? wifiSession! : anySession!
    let name = store.wifiOnly ? Self.wifiName : Self.anyName
    var changed = false
    var startedNow = 0
    for j in store.jobs.indices where !store.jobs[j].broken {
      guard store.jobs[j].parts.contains(where: { $0.state == "wacht" }) else { continue }
      guard let src = source(store.jobs[j]),
        FileManager.default.fileExists(atPath: src.path),
        Int64(fileSize(src)) == store.jobs[j].totalBytes
      else {
        markBroken(j)
        changed = true
        continue
      }
      let originalId = store.jobs[j].originalId
      for p in store.jobs[j].parts.indices where store.jobs[j].parts[p].state == "wacht" {
        let part = store.jobs[j].parts[p]
        changed = true
        guard let link = part.url, let url = URL(string: link) else {
          store.jobs[j].parts[p].state = "mislukt"
          store.jobs[j].parts[p].attempts += 1
          store.jobs[j].parts[p].httpStatus = nil
          store.jobs[j].parts[p].code = nil
          emitFailed(originalId, store.jobs[j].parts[p])
          continue
        }
        let file = partFile(originalId, part.partNumber)
        do {
          try slice(source: src, offset: part.offset, length: part.size, to: file)
        } catch UploaderError.short, UploaderError.noSource {
          markBroken(j)
          break
        } catch {
          // Geen ruimte of een andere schrijffout: een mislukking zonder status.
          store.jobs[j].parts[p].state = "mislukt"
          store.jobs[j].parts[p].attempts += 1
          store.jobs[j].parts[p].httpStatus = nil
          store.jobs[j].parts[p].code = nil
          store.jobs[j].parts[p].updatedAt = nowMs()
          note("\(originalId) deel \(part.partNumber): snijden mislukt")
          emitFailed(originalId, store.jobs[j].parts[p])
          continue
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        let task = session.uploadTask(with: request, fromFile: file)
        let token = UUID().uuidString
        task.taskDescription = Self.encode(TaskTag(originalId: originalId, partNumber: part.partNumber, token: token))
        task.countOfBytesClientExpectsToSend = part.size
        task.countOfBytesClientExpectsToReceive = 1024
        store.jobs[j].parts[p].state = "bezig"
        store.jobs[j].parts[p].token = token
        store.jobs[j].parts[p].session = name
        store.jobs[j].parts[p].sent = 0
        store.jobs[j].parts[p].startedInBackground = !foreground
        store.jobs[j].parts[p].updatedAt = nowMs()
        task.resume()
        startedNow += 1
      }
    }
    if startedNow > 0 { note("\(startedNow) delen aan iOS (sessie \(name), \(foreground ? "voorgrond" : "achtergrond"))") }
    if changed { save() }
  }

  /// Stop taken (in de gegeven sessies) die passen; daarna pas weer nieuwe taken.
  private func cancelTasks(in sessions: [URLSession]? = nil, where match: @escaping (TaskTag) -> Bool) {
    holds += 1
    allTasks { wifi, any in
      let pick: [URLSessionTask]
      if let sessions {
        pick = (sessions.contains(where: { $0 === self.wifiSession }) ? wifi : [])
          + (sessions.contains(where: { $0 === self.anySession }) ? any : [])
      } else {
        pick = wifi + any
      }
      for t in pick {
        if let tag = Self.tag(t), match(tag) { t.cancel() }
      }
      self.holds -= 1
      self.pump()
    }
  }

  private static func encode(_ tag: TaskTag) -> String {
    String(data: (try? JSONEncoder().encode(tag)) ?? Data(), encoding: .utf8) ?? ""
  }

  private static func tag(_ task: URLSessionTask) -> TaskTag? {
    guard let text = task.taskDescription, let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(TaskTag.self, from: data)
  }

  private func find(_ tag: TaskTag) -> (Int, Int)? {
    guard let j = store.jobs.firstIndex(where: { $0.originalId == tag.originalId }),
      let p = store.jobs[j].parts.firstIndex(where: { $0.partNumber == tag.partNumber && $0.token == tag.token })
    else { return nil }
    return (j, p)
  }

  /// De foutcode van R2 (`<Code>…</Code>`), zonder de rest van het antwoord.
  private static func errorCode(_ body: Data?) -> String? {
    guard let body, let text = String(data: body, encoding: .utf8),
      let start = text.range(of: "<Code>"), let end = text.range(of: "</Code>", range: start.upperBound..<text.endIndex)
    else { return nil }
    let code = String(text[start.upperBound..<end.lowerBound])
    guard code.count <= 64, code.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { return nil }
    return code
  }

  // MARK: URLSession-terugroepen (op q)

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    guard let tag = Self.tag(task), let loc = find(tag) else { return }
    let (j, p) = loc
    store.jobs[j].parts[p].sent = totalBytesSent
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let tag = Self.tag(dataTask) else { return }
    var body = responseBodies[tag.token] ?? Data()
    if body.count < 4096 { body.append(data.prefix(4096 - body.count)) }
    responseBodies[tag.token] = body
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let tag = Self.tag(task) else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode
    let body = responseBodies.removeValue(forKey: tag.token)
    let via = sessionName(session)
    // Nieuwe links, omgezet, vergeten of opnieuw gegeven: telt niet.
    guard let loc = find(tag) else { return }
    let (j, p) = loc
    let originalId = tag.originalId
    let partNumber = tag.partNumber
    let nsError = error as NSError?

    if let nsError, nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
      // iOS stopte de taak (app weggeveegd): geen poging, geen mislukking; het deel gaat weer in de rij.
      store.jobs[j].parts[p].state = "wacht"
      store.jobs[j].parts[p].token = nil
      store.jobs[j].parts[p].updatedAt = nowMs()
      note("\(originalId) deel \(partNumber): gestopt door iOS, weer in de rij")
      save()
      pump()
      return
    }

    store.jobs[j].parts[p].httpStatus = status
    store.jobs[j].parts[p].token = nil
    store.jobs[j].parts[p].updatedAt = nowMs()

    if error == nil, let status, (200..<300).contains(status) {
      store.jobs[j].parts[p].state = "klaar"
      store.jobs[j].parts[p].code = nil
      store.jobs[j].parts[p].sent = store.jobs[j].parts[p].size
      store.jobs[j].parts[p].url = nil
      try? FileManager.default.removeItem(at: partFile(originalId, partNumber))
      let done = store.jobs[j].parts.filter { $0.state == "klaar" }.count
      let total = store.jobs[j].parts.count
      note("\(originalId) deel \(partNumber) klaar (HTTP \(status), sessie \(via)); \(done) van \(total)")
      emit?("onPartDone", ["originalId": originalId, "partNumber": partNumber, "done": done, "total": total])
      if done == total && !store.jobs[j].allDoneSent {
        store.jobs[j].allDoneSent = true
        note("\(originalId): alle delen klaar")
        emit?("onAllPartsDone", ["originalId": originalId])
      }
    } else {
      let code = Self.errorCode(body)
      store.jobs[j].parts[p].attempts += 1
      store.jobs[j].parts[p].state = "mislukt"
      store.jobs[j].parts[p].code = code
      let what = status.map { "HTTP \($0)" } ?? "geen antwoord (fout \(nsError?.code ?? 0))"
      note("\(originalId) deel \(partNumber) mislukt: \(what)\(code.map { " \($0)" } ?? ""), sessie \(via), poging \(store.jobs[j].parts[p].attempts)")
      emitFailed(originalId, store.jobs[j].parts[p])
    }
    save()
    pump()
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    guard let identifier = session.configuration.identifier else { return }
    note("iOS: alle events afgeleverd (sessie \(sessionName(session)))")
    let handler = backgroundCompletions.removeValue(forKey: identifier)
    Task { @MainActor in
      // Even wakker blijven, zodat de app de events kan verwerken (afronden op de achtergrond).
      let work = BackgroundWork.begin()
      // expo-file-system bewaart de terugroep van elke sessie die hij niet kent
      // tot zijn eigen sessie klaar is (FileSystemBackgroundSessionHandler).
      // De gebundelde terugroep van Expo wacht op allebei: zeg hem dat deze
      // sessie klaar is (spike).
      let selector = NSSelectorFromString("invokeCompletionHandlerForSessionIdentifier:")
      for sub in ExpoAppDelegateSubscriberRepository.subscribers where !(sub is ClubalmanacUploadAppDelegate) {
        if sub.responds(to: selector) { _ = sub.perform(selector, with: identifier) }
      }
      handler?()
      try? await Task.sleep(nanoseconds: 25_000_000_000)
      BackgroundWork.end(work)
    }
  }
}

/// Even wakker blijven op de achtergrond (UIApplication.beginBackgroundTask),
/// voor de events van iOS en voor een aanroep van JS (afronden op de achtergrond).
@MainActor
enum BackgroundWork {
  private static var tasks: [Int: UIBackgroundTaskIdentifier] = [:]
  private static var next = 1

  static func begin() -> Int {
    let id = next
    next += 1
    let task = UIApplication.shared.beginBackgroundTask(withName: "clubalmanac.originals") {
      Task { @MainActor in end(id) }
    }
    if task == .invalid { return 0 }
    tasks[id] = task
    return id
  }

  static func end(_ id: Int) {
    guard let task = tasks.removeValue(forKey: id) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }
}
