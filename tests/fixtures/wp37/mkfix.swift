import AVFoundation
import CoreVideo

// mkfix <out> <fileType mp4|mov> <codec avc1|hvc1> <seconds> <faststart 0|1> <audio 0|1> <meta none|mdta|udta|both>
let a = CommandLine.arguments
let out = URL(fileURLWithPath: a[1])
try? FileManager.default.removeItem(at: out)
let ft: AVFileType = a[2] == "mov" ? .mov : .mp4
let codec: AVVideoCodecType = a[3] == "hvc1" ? .hevc : .h264
let seconds = Double(a[4])!
let fast = a[5] == "1"
let audio = a[6] == "1"
let meta = a[7]
let w = 108, h = 192, fps = 10

let writer = try AVAssetWriter(outputURL: out, fileType: ft)
writer.shouldOptimizeForNetworkUse = fast
var items: [AVMetadataItem] = []
func item(_ id: AVMetadataIdentifier, _ v: String) -> AVMetadataItem {
  let m = AVMutableMetadataItem(); m.identifier = id; m.value = v as NSString; m.dataType = kCMMetadataBaseDataType_UTF8 as String; return m
}
if meta == "mdta" || meta == "both" {
  items.append(item(.quickTimeMetadataLocationISO6709, "+52.3676+004.9041+000.000/"))
  items.append(item(.quickTimeMetadataCreationDate, "2026-07-14T15:32:10+0200"))
  items.append(item(.quickTimeMetadataMake, "Apple"))
}
if meta == "udta" || meta == "both" {
  items.append(item(.quickTimeUserDataLocationISO6709, "+52.3676+004.9041/"))
}
if meta == "date" {
  items.append(item(.quickTimeMetadataCreationDate, "2026-07-14T15:32:10+0200"))
}
writer.metadata = items

let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: codec, AVVideoWidthKey: w, AVVideoHeightKey: h,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 50_000],
])
vIn.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
writer.add(vIn)
var aIn: AVAssetWriterInput? = nil
if audio {
  let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000])
  ai.expectsMediaDataInRealTime = false
  writer.add(ai); aIn = ai
}
writer.startWriting()
writer.startSession(atSourceTime: .zero)
let frames = Int(seconds * Double(fps))
for i in 0..<frames {
  while !vIn.isReadyForMoreMediaData { usleep(1000) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let base = CVPixelBufferGetBaseAddress(pb!)!.assumingMemoryBound(to: UInt8.self)
  let bpr = CVPixelBufferGetBytesPerRow(pb!)
  for y in 0..<h { for x in 0..<w { let p = base + y*bpr + x*4; p[0] = UInt8((x+i*3) & 255); p[1] = UInt8(y & 255); p[2] = 128; p[3] = 255 } }
  CVPixelBufferUnlockBaseAddress(pb!, [])
  adaptor.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: CMTimeScale(fps)))
}
vIn.markAsFinished()
if let ai = aIn {
  let rate = 44100.0
  let total = Int(seconds * rate)
  var pos = 0
  while pos < total {
    while !ai.isReadyForMoreMediaData { usleep(1000) }
    let n = min(1024, total - pos)
    var asbd = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
    var fmt: CMAudioFormatDescription?
    CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &fmt)
    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: n*2, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: n*2, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
    var samples = [Int16](repeating: 0, count: n)
    for k in 0..<n { samples[k] = Int16(sin(Double(pos+k) * 2 * .pi * 440 / rate) * 3000) }
    samples.withUnsafeBytes { _ = CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: n*2) }
    var sb: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!, formatDescription: fmt!, sampleCount: n, presentationTimeStamp: CMTime(value: CMTimeValue(pos), timescale: 44100), packetDescriptions: nil, sampleBufferOut: &sb)
    ai.append(sb!)
    pos += n
  }
  ai.markAsFinished()
}
writer.endSession(atSourceTime: CMTime(value: CMTimeValue(frames), timescale: CMTimeScale(fps)))
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
if writer.status != .completed { print("FOUT", writer.error ?? "?"); exit(1) }
print(out.lastPathComponent, (try! FileManager.default.attributesOfItem(atPath: out.path)[.size] as! Int))
