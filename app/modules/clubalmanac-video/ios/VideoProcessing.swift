// WP37: het AVFoundation-deel van de module (zonder Expo), zodat het ook
// los op macOS te draaien is. Zie ClubalmanacVideoModule.swift.

import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Het doel van de compressie (besluit 3; de app geeft VIDEO_TARGET mee).
struct VideoTarget: Sendable {
  var maxSide: Int = 1920
  var videoBitrate: Int = 3_600_000
  var audioBitrate: Int = 128_000
  var maxFps: Int = 30
}

enum ClubalmanacVideoError: Error, LocalizedError {
  case badUri
  case noVideoTrack
  case cancelled
  case readerFailed(String)
  case writerFailed(String)
  case posterFailed

  var errorDescription: String? {
    switch self {
    case .badUri: return "Geen bestand"
    case .noVideoTrack: return "Geen beeld in dit filmpje"
    case .cancelled: return "Gestopt"
    case .readerFailed(let detail): return "Lezen mislukt: \(detail)"
    case .writerFailed(let detail): return "Schrijven mislukt: \(detail)"
    case .posterFailed: return "Poster maken mislukt"
    }
  }
}

func fileURL(_ uri: String) throws -> URL {
  if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  throw ClubalmanacVideoError.badUri
}

func temporaryFile(_ ext: String) -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("clubalmanac-\(UUID().uuidString).\(ext)")
}

func fileSize(_ url: URL) -> Int {
  ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
}

// MARK: - datum en plaats

enum VideoMetadata {
  static func read(_ url: URL) async throws -> [String: Any?] {
    let asset = AVURLAsset(url: url)
    let items = try await asset.load(.metadata)
    var creationDate: String?
    var fallbackDate: String?
    var location: String?
    for item in items {
      let id = item.identifier
      if id == .quickTimeMetadataCreationDate, creationDate == nil {
        creationDate = try? await item.load(.stringValue)
      } else if item.commonKey == .commonKeyCreationDate, fallbackDate == nil {
        fallbackDate = try? await item.load(.stringValue)
      }
      if location == nil,
        id == .quickTimeMetadataLocationISO6709 || id == .quickTimeUserDataLocationISO6709
          || item.commonKey == .commonKeyLocation
      {
        location = try? await item.load(.stringValue)
      }
    }
    let duration = try await asset.load(.duration)
    return [
      "creationDate": creationDate ?? fallbackDate,
      "location": location,
      "durationMs": duration.isNumeric ? Int((duration.seconds * 1000).rounded()) : nil,
    ]
  }
}

// MARK: - poster

enum VideoPoster {
  static func make(_ url: URL) async throws -> [String: Any] {
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 1920, height: 1920)
    let tolerance = CMTime(value: 1, timescale: 10)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    // A-antwoord 4: het eerste beeld is vaak zwart of bewogen.
    let time = duration.isNumeric && duration.seconds > 1 ? CMTime(seconds: 1, preferredTimescale: 600) : .zero
    let (image, _) = try await generator.image(at: time)
    // Een JPEG zonder metadata (ImageIO schrijft alleen wat je meegeeft; de
    // backend haalt metadata ook nog weg).
    let out = temporaryFile("jpg")
    guard
      let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw ClubalmanacVideoError.posterFailed }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw ClubalmanacVideoError.posterFailed }
    return ["uri": out.absoluteString, "width": image.width, "height": image.height]
  }
}

// MARK: - comprimeren

/// Een afronding die hooguit één keer loopt (vanuit de schrijver of bij stoppen).
final class Once: @unchecked Sendable {
  private let lock = NSLock()
  private var ran = false
  private let body: () -> Void

  init(_ body: @escaping () -> Void) { self.body = body }

  var done: Bool {
    lock.lock(); defer { lock.unlock() }
    return ran
  }

  func run() {
    lock.lock()
    if ran {
      lock.unlock()
      return
    }
    ran = true
    lock.unlock()
    body()
  }
}

final class VideoCompressor: @unchecked Sendable {
  let input: URL
  let output: URL
  let options: VideoTarget

  private let lock = NSLock()
  private var cancelled = false
  private var reader: AVAssetReader?
  private var writer: AVAssetWriter?

  init(input: URL, output: URL, options: VideoTarget) {
    self.input = input
    self.output = output
    self.options = options
  }

  /// Legt lezer en schrijver vast (voor `cancel`); false als er al gestopt is.
  private func activate(reader: AVAssetReader, writer: AVAssetWriter) -> Bool {
    lock.lock(); defer { lock.unlock() }
    self.reader = reader
    self.writer = writer
    return !cancelled
  }

  var isCancelled: Bool {
    lock.lock(); defer { lock.unlock() }
    return cancelled
  }

  func cancel() {
    lock.lock()
    cancelled = true
    let r = reader
    let w = writer
    let handlers = cancelHandlers
    cancelHandlers = []
    lock.unlock()
    r?.cancelReading()
    w?.cancelWriting()
    for h in handlers { h.run() }
  }

  /// Even maten (H.264), langste zijde hooguit `maxSide`, nooit groter dan het origineel.
  static func fit(_ size: CGSize, maxSide: Int) -> CGSize {
    let longest = max(size.width, size.height)
    let scale = longest > CGFloat(maxSide) ? CGFloat(maxSide) / longest : 1
    let even = { (v: CGFloat) -> CGFloat in max(2, (v * scale / 2).rounded() * 2) }
    return CGSize(width: even(size.width), height: even(size.height))
  }

  func run(progress: @escaping (Double) -> Void) async throws -> [String: Any] {
    try? FileManager.default.removeItem(at: output)
    let asset = AVURLAsset(url: input, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let duration = try await asset.load(.duration)
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw ClubalmanacVideoError.noVideoTrack
    }
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
    let naturalSize = try await videoTrack.load(.naturalSize)
    let transform = try await videoTrack.load(.preferredTransform)
    let nominalFps = try await videoTrack.load(.nominalFrameRate)

    // De maat zoals het filmpje getoond wordt (na de draai van de opname).
    let shown = CGRect(origin: .zero, size: naturalSize).applying(transform)
    let display = CGSize(width: abs(shown.width), height: abs(shown.height))
    let target = Self.fit(display, maxSide: options.maxSide)
    let scaleX = target.width / max(display.width, 1)
    let scaleY = target.height / max(display.height, 1)
    let fps = min(Double(options.maxFps), nominalFps > 0 ? Double(nominalFps) : Double(options.maxFps))

    // De draai en de schaal in de pixels; HDR naar SDR (BT.709).
    let composition = AVMutableVideoComposition()
    composition.renderSize = target
    composition.frameDuration = CMTime(value: CMTimeValue((600 / fps).rounded()), timescale: 600)
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
    let placed = transform
      .concatenating(CGAffineTransform(translationX: -shown.origin.x, y: -shown.origin.y))
      .concatenating(CGAffineTransform(scaleX: scaleX, y: scaleY))
    layer.setTransform(placed, at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]

    let reader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    )
    videoOutput.videoComposition = composition
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else { throw ClubalmanacVideoError.readerFailed("beeld") }
    reader.add(videoOutput)

    var audioOutput: AVAssetReaderAudioMixOutput?
    if let audioTrack {
      let out = AVAssetReaderAudioMixOutput(
        audioTracks: [audioTrack],
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: 2,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
        ]
      )
      out.alwaysCopiesSampleData = false
      if reader.canAdd(out) {
        reader.add(out)
        audioOutput = out
      }
    }

    // mp4, de index vooraan, geen metadata.
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    writer.metadata = []
    let color: [String: Any] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ]
    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(target.width),
        AVVideoHeightKey: Int(target.height),
        AVVideoColorPropertiesKey: color,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: options.videoBitrate,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoMaxKeyFrameIntervalKey: max(1, Int((fps * 2).rounded())),
          AVVideoExpectedSourceFrameRateKey: max(1, Int(fps.rounded())),
        ] as [String: Any],
      ]
    )
    videoInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoInput) else { throw ClubalmanacVideoError.writerFailed("beeld") }
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
      var layout = AudioChannelLayout()
      layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
      let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: 2,
          AVEncoderBitRateKey: options.audioBitrate,
          AVChannelLayoutKey: layoutData,
        ]
      )
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioInput = input
      }
    }

    if !activate(reader: reader, writer: writer) { throw ClubalmanacVideoError.cancelled }

    guard reader.startReading() else {
      throw ClubalmanacVideoError.readerFailed(reader.error?.localizedDescription ?? "start")
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      throw ClubalmanacVideoError.writerFailed(writer.error?.localizedDescription ?? "start")
    }
    writer.startSession(atSourceTime: .zero)

    let total = duration.isNumeric && duration.seconds > 0 ? duration.seconds : 1
    var lastReported = -1.0
    let report: (CMTime) -> Void = { time in
      let p = min(1, max(0, time.seconds / total))
      if p - lastReported >= 0.02 {
        lastReported = p
        progress(p)
      }
    }

    async let videoDone: Void = pump(
      input: videoInput, output: videoOutput,
      queue: DispatchQueue(label: "clubalmanac.video.beeld"), onTime: report)
    if let audioInput, let audioOutput {
      async let audioDone: Void = pump(
        input: audioInput, output: audioOutput,
        queue: DispatchQueue(label: "clubalmanac.video.geluid"), onTime: nil)
      _ = await (videoDone, audioDone)
    } else {
      await videoDone
    }

    if isCancelled {
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: output)
      throw ClubalmanacVideoError.cancelled
    }
    if reader.status == .failed {
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: output)
      throw ClubalmanacVideoError.readerFailed(reader.error?.localizedDescription ?? "lezen")
    }
    await writer.finishWriting()
    guard writer.status == .completed else {
      try? FileManager.default.removeItem(at: output)
      throw ClubalmanacVideoError.writerFailed(writer.error?.localizedDescription ?? "afronden")
    }
    progress(1)

    let written = AVURLAsset(url: output)
    let outDuration = try await written.load(.duration)
    return [
      "uri": output.absoluteString,
      "bytes": fileSize(output),
      "durationMs": Int((outDuration.seconds * 1000).rounded()),
      "width": Int(target.width),
      "height": Int(target.height),
    ]
  }

  /// Monsters van de lezer naar de schrijver, tot het einde, een fout of stoppen.
  private func pump(
    input: AVAssetWriterInput,
    output: AVAssetReaderOutput,
    queue: DispatchQueue,
    onTime: ((CMTime) -> Void)?
  ) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let once = Once { continuation.resume() }
      // Stoppen terwijl de schrijver wacht: dan komt het blok misschien niet
      // meer terug, dus `cancel` rondt deze stap ook af.
      self.onCancel(once)
      input.requestMediaDataWhenReady(on: queue) { [self] in
        if once.done { return }
        var ended = false
        while input.isReadyForMoreMediaData {
          if self.isCancelled {
            ended = true
            break
          }
          guard let sample = output.copyNextSampleBuffer() else {
            ended = true
            break
          }
          onTime?(CMSampleBufferGetPresentationTimeStamp(sample))
          if !input.append(sample) {
            ended = true
            break
          }
        }
        // Nog niet klaar: de schrijver roept het blok weer aan als hij meer wil.
        if !ended { return }
        input.markAsFinished()
        once.run()
      }
    }
  }

  private var cancelHandlers: [Once] = []

  private func onCancel(_ once: Once) {
    lock.lock()
    let stopped = cancelled
    if !stopped { cancelHandlers.append(once) }
    lock.unlock()
    if stopped { once.run() }
  }
}
