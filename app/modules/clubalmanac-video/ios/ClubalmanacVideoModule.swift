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

import ExpoModulesCore
import Foundation

struct CompressOptions: Record {
  @Field var id: String = ""
  @Field var maxSide: Int = 1920
  @Field var videoBitrate: Int = 3_600_000
  @Field var audioBitrate: Int = 128_000
  @Field var maxFps: Int = 30
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

    Events("onProgress")

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
      if let url = try? fileURL(uri) { try? FileManager.default.removeItem(at: url) }
    }
  }
}
