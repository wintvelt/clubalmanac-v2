// WP37: filmpjes klaarmaken op de iPhone, vóór het uploaden naar R2.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md (besluit 3, A-antwoord
// 1 t/m 4, besluiten B1, B2 en B11).
//
// - `readMetadata`: datum (com.apple.quicktime.creationdate, lokale tijd met
//   tijdzone) en plaats (ISO 6709) uit het origineel, vóór het comprimeren.
//   Vraagt geen extra toestemming (besluit B2). De app maakt er de headers van
//   (src/lib/videos.ts).
// - `compress`: AVAssetReader → AVAssetWriter. H.264 op de gevraagde bitrate,
//   AAC, langste zijde hooguit `maxSide`, hooguit `maxFps`, rechtop (de draai
//   van de opname zit in de pixels), HDR omgezet naar SDR (BT.709), mp4 met de
//   index vooraan (`shouldOptimizeForNetworkUse`, A-invariant 25) en zonder
//   metadata: geen datum, geen GPS, geen metadata-spoor (invariant 2).
// - `makePoster`: een JPEG van het beeld na ~1 s (korter: het eerste beeld),
//   van het gecomprimeerde bestand, zodat poster en filmpje gelijk staan.
// - Comprimeren kan alleen met de app open (besluit B11); de app houdt het
//   scherm aan. `cancel` stopt een lopende compressie.
// - WP39 besluit 10: `pickerOnScreen` zegt of er nog een fotokiezer over het
//   scherm staat. De app vraagt dat zolang ze op de kiezer wacht; de teller van
//   "Je keuze ophalen…" loopt vanaf het moment dat hij dicht is.
// - WP42 B18: `buildNumber`, het buildnummer van de geïnstalleerde build.
// - WP47: `testFlight`, of de build uit TestFlight komt (TestFlightBuild.swift),
//   en `testFlightDiagnose`, per stap wat die check zag (alleen DEV_TOOLS).
// - WP38b: het bewaarde origineel (OriginalFiles.swift) en de uploader voor
//   originelen (OriginalUploader.swift). `remove` wist nooit iets in de mappen
//   van de originelen (38b-2: de opruimregels van WP39 raken ze niet).

import ExpoModulesCore
import Foundation
import PhotosUI
import UIKit

struct CompressOptions: Record {
  @Field var id: String = ""
  @Field var maxSide: Int = 1920
  @Field var videoBitrate: Int = 3_600_000
  @Field var audioBitrate: Int = 128_000
  @Field var maxFps: Int = 30
}

/// WP38b: een deel met zijn link, voor de uploader (`aan_ios`).
struct OriginalPartRecord: Record {
  @Field var partNumber: Int = 0
  @Field var offset: Double = 0
  @Field var size: Double = 0
  @Field var url: String = ""
}

/// WP38b: de delen van één origineel voor de uploader.
struct OriginalSendRecord: Record {
  @Field var originalId: String = ""
  @Field var fileName: String = ""
  /// De generatie van de links (fix-cyclus 1, punt 5); een getal van de app, exact tot 2^53.
  @Field var generation: Double = 0
  @Field var totalBytes: Double = 0
  @Field var partSize: Double = 0
  @Field var expiresAt: Double = 0
  @Field var parts: [OriginalPartRecord] = []
}

/// De lopende compressies, om te kunnen stoppen.
final class CompressionJobs: @unchecked Sendable {
  private let lock = NSLock()
  private var jobs: [String: VideoCompressor] = [:]

  func set(_ id: String, _ job: VideoCompressor) {
    lock.lock(); defer { lock.unlock() }
    jobs[id] = job
  }

  func remove(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    jobs[id] = nil
  }

  func cancel(_ id: String) {
    lock.lock(); let job = jobs[id]; lock.unlock()
    job?.cancel()
  }
}

public class ClubalmanacVideoModule: Module {
  private let jobs = CompressionJobs()

  public func definition() -> ModuleDefinition {
    Name("ClubalmanacVideo")

    Events("onProgress", "onPartDone", "onPartFailed", "onAllPartsDone", "onFileBroken", "onNetwork")

    OnCreate {
      let uploader = OriginalUploader.shared
      uploader.emit = { [weak self] name, body in self?.sendEvent(name, body) }
      uploader.start(reason: "module geladen")
    }

    OnDestroy {
      OriginalUploader.shared.emit = nil
    }

    AsyncFunction("readMetadata") { (uri: String) async throws -> [String: Any?] in
      return try await VideoMetadata.read(try fileURL(uri))
    }

    AsyncFunction("compress") { (uri: String, options: CompressOptions) async throws -> [String: Any] in
      let input = try fileURL(uri)
      let target = VideoTarget(
        maxSide: options.maxSide, videoBitrate: options.videoBitrate,
        audioBitrate: options.audioBitrate, maxFps: options.maxFps)
      let compressor = VideoCompressor(input: input, output: temporaryFile("mp4"), options: target)
      let id = options.id
      self.jobs.set(id, compressor)
      defer { self.jobs.remove(id) }
      return try await compressor.run { progress in
        self.sendEvent("onProgress", ["id": id, "progress": progress])
      }
    }

    AsyncFunction("cancel") { (id: String) in
      self.jobs.cancel(id)
    }

    AsyncFunction("makePoster") { (uri: String) async throws -> [String: Any] in
      return try await VideoPoster.make(try fileURL(uri))
    }

    AsyncFunction("remove") { (uri: String) in
      // 38b-2: een bewaard origineel of deelbestand gaat hier nooit weg.
      if let url = try? fileURL(uri), !OriginalDirs.isProtected(url) { try? FileManager.default.removeItem(at: url) }
    }

    AsyncFunction("pickerOnScreen") { () async -> Bool in
      return await MainActor.run { pickerOnScreen() }
    }

    // WP42 B18: het buildnummer van de geïnstalleerde build (CFBundleVersion).
    Function("buildNumber") { () -> String? in
      return Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    }

    // WP47: komt de build uit TestFlight? Asynchroon; Info wacht er niet op.
    AsyncFunction("testFlight") { () async throws -> Bool in
      return try await TestFlightBuild.check()
    }

    // WP47 fix-cyclus 1: per stap wat de TestFlight-check zag (alleen getoond
    // in builds met DEV_TOOLS). Verandert `testFlight` niet.
    AsyncFunction("testFlightDiagnose") { () async -> String in
      return await TestFlightBuild.diagnose()
    }

    // MARK: WP38b, originelen

    AsyncFunction("keepOriginal") { (uri: String) throws -> [String: Any] in
      return try OriginalFiles.keep(uri)
    }

    AsyncFunction("originalInfo") { (fileName: String) throws -> [String: Any] in
      return try OriginalFiles.info(fileName)
    }

    AsyncFunction("removeOriginal") { (fileName: String) throws in
      try OriginalFiles.remove(fileName)
    }

    AsyncFunction("listOriginals") { () -> [String] in
      return OriginalFiles.list()
    }

    AsyncFunction("originalSha256") { (fileName: String) throws -> String in
      return try OriginalFiles.sha256(fileName)
    }

    AsyncFunction("freeBytes") { () -> Double? in
      return OriginalFiles.freeBytes()
    }

    AsyncFunction("partsBytes") { () -> Double in
      return OriginalFiles.partsBytes()
    }

    AsyncFunction("networkStatus") { () -> [String: Any] in
      let status = OriginalUploader.shared.net.status
      return ["type": status["type"] ?? "onbekend", "expensive": status["expensive"] ?? false]
    }

    AsyncFunction("readState") { (name: String) throws -> String? in
      return try OriginalFiles.readState(name)
    }

    AsyncFunction("writeState") { (name: String, text: String) throws in
      try OriginalFiles.writeState(name, text)
    }

    AsyncFunction("uploaderSend") { (job: OriginalSendRecord) throws in
      try OriginalUploader.shared.send(
        originalId: job.originalId, fileName: job.fileName, generation: Int64(job.generation),
        totalBytes: Int64(job.totalBytes),
        partSize: Int64(job.partSize), expiresAt: job.expiresAt,
        links: job.parts.map {
          NewPartLink(partNumber: $0.partNumber, offset: Int64($0.offset), size: Int64($0.size), url: $0.url)
        })
    }

    AsyncFunction("uploaderRetryPart") { (originalId: String, partNumber: Int) throws in
      try OriginalUploader.shared.retryPart(originalId, partNumber)
    }

    AsyncFunction("uploaderForget") { (originalId: String) throws in
      try OriginalUploader.shared.forget(originalId)
    }

    // 38b-18: niet gestart (de opslag was nog niet te lezen): een fout, geen lege lijst.
    AsyncFunction("uploaderJobs") { () throws -> String in
      return try OriginalUploader.shared.jobsJSON()
    }

    AsyncFunction("uploaderWifiOnly") { () throws -> Bool in
      return try OriginalUploader.shared.wifiOnly()
    }

    AsyncFunction("uploaderSetWifiOnly") { (on: Bool) throws in
      try OriginalUploader.shared.setWifiOnly(on)
    }

    AsyncFunction("uploaderNote") { (text: String) in
      OriginalUploader.shared.noteFromApp(text)
    }

    AsyncFunction("uploaderLog") { (limit: Int) -> [[String: Any]] in
      return OriginalUploader.shared.log.read(limit: limit)
    }

    AsyncFunction("uploaderClearLog") { () in
      OriginalUploader.shared.log.clear()
    }

    // Gate 6 (koud): alleen het proefscherm van een dev-build zet dit aan; alleen in het geheugen (38b-19).
    AsyncFunction("uploaderExitAfterBackgroundSend") { () -> Bool in
      return OriginalUploader.shared.exitAfterBackgroundSend()
    }

    AsyncFunction("uploaderSetExitAfterBackgroundSend") { (on: Bool) in
      OriginalUploader.shared.setExitAfterBackgroundSend(on)
    }

    AsyncFunction("backgroundWorkBegin") { () async -> Int in
      return await MainActor.run { BackgroundWork.begin() }
    }

    AsyncFunction("backgroundWorkEnd") { (id: Int) async in
      await MainActor.run { BackgroundWork.end(id) }
    }
  }
}

/// WP39 besluit 10: staat er een fotokiezer (PHPicker of UIImagePicker) over
/// het scherm die niet aan het sluiten is?
@MainActor
func pickerOnScreen() -> Bool {
  func isPicker(_ controller: UIViewController) -> Bool {
    controller is PHPickerViewController || controller is UIImagePickerController
  }
  for scene in UIApplication.shared.connectedScenes {
    guard let windowScene = scene as? UIWindowScene else { continue }
    for window in windowScene.windows {
      var controller = window.rootViewController
      while let current = controller {
        if (isPicker(current) || current.children.contains(where: isPicker)) && !current.isBeingDismissed {
          return true
        }
        controller = current.presentedViewController
      }
    }
  }
  return false
}
