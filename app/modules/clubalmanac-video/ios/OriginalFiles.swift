// WP38b: het bewaarde origineel en de mappen van de uploader.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b,
// invarianten 38b-2 en 38b-10.
//
// - `keep`: de kopie van de kiezer wordt verplaatst (hernoemen op dezelfde
//   schijf: direct, zonder extra ruimte), niet gekopieerd, naar een eigen map
//   in Application Support. Buiten de iCloud-backup van het toestel en na de
//   eerste ontgrendeling leesbaar (ook op de achtergrond met het scherm op
//   slot). Het bestand zelf blijft precies zoals het is.
// - JS kent alleen de bestandsnaam (een UUID), nooit een pad in een log.
// - De opruimregels van WP39 (`remove`) wissen niets in deze mappen.
// - `readState`/`writeState`: kleine bestanden van de wachtrij in JS (de
//   wachtrij en de schakelaar "Alleen via wifi"), ook na de eerste
//   ontgrendeling leesbaar, dus ook als iOS de app op de achtergrond start.

import CryptoKit
import Foundation

enum OriginalDirs {
  static var support: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
  }

  static func ensure(_ name: String) -> URL {
    var dir = support.appendingPathComponent(name, isDirectory: true)
    if !FileManager.default.fileExists(atPath: dir.path) {
      try? FileManager.default.createDirectory(
        at: dir, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }

  /// De bewaarde originelen (A-invariant 20): buiten de cache die WP39 opruimt.
  static var originals: URL { ensure("clubalmanac-originals") }
  /// De deelbestanden van de uploader.
  static var parts: URL { ensure("clubalmanac-original-parts") }
  /// De opslag van de uploader, de wachtrij van JS en het log.
  static var state: URL { ensure("clubalmanac-original-state") }

  /// Alleen een gewone naam, geen pad.
  static func safeName(_ name: String) -> String? {
    guard !name.isEmpty, name.count < 200,
      name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil,
      !name.hasPrefix(".")
    else { return nil }
    return name
  }

  /// Ligt `url` in een van de mappen van de originelen?
  static func isProtected(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.resolvingSymlinksInPath().path
    return [originals, parts, state].contains { dir in
      let base = dir.standardizedFileURL.resolvingSymlinksInPath().path
      return path == base || path.hasPrefix(base + "/")
    }
  }

  static func protect(_ url: URL) {
    try? FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    var u = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? u.setResourceValues(values)
  }
}

enum OriginalFileError: Error, LocalizedError {
  case badName
  case notMoved

  var errorDescription: String? {
    switch self {
    case .badName: return "Ongeldige bestandsnaam"
    case .notMoved: return "Het origineel kon niet bewaard worden"
    }
  }
}

enum OriginalFiles {
  /// 38b-2: verplaatsen, niet kopiëren. Lukt verplaatsen niet, dan gaat het origineel niet mee.
  static func keep(_ uri: String) throws -> [String: Any] {
    let src = try fileURL(uri)
    if OriginalDirs.isProtected(src) { throw OriginalFileError.notMoved }
    let ext = src.pathExtension.isEmpty ? "mov" : src.pathExtension.lowercased()
    let safeExt = OriginalDirs.safeName(ext) ?? "mov"
    let name = "\(UUID().uuidString).\(safeExt)"
    let dest = OriginalDirs.originals.appendingPathComponent(name)
    do {
      try FileManager.default.moveItem(at: src, to: dest)
    } catch {
      throw OriginalFileError.notMoved
    }
    OriginalDirs.protect(dest)
    return ["fileName": name, "uri": dest.absoluteString, "bytes": Double(fileSize(dest))]
  }

  static func url(_ fileName: String) throws -> URL {
    guard let name = OriginalDirs.safeName(fileName) else { throw OriginalFileError.badName }
    return OriginalDirs.originals.appendingPathComponent(name)
  }

  static func info(_ fileName: String) throws -> [String: Any] {
    let u = try url(fileName)
    let exists = FileManager.default.fileExists(atPath: u.path)
    return ["uri": u.absoluteString, "exists": exists, "bytes": Double(exists ? fileSize(u) : 0)]
  }

  static func remove(_ fileName: String) throws {
    let u = try url(fileName)
    if FileManager.default.fileExists(atPath: u.path) { try FileManager.default.removeItem(at: u) }
  }

  static func list() -> [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: OriginalDirs.originals.path)) ?? []
    return names.filter { OriginalDirs.safeName($0) != nil }.sorted()
  }

  /// Totaal op schijf in de map met deelbestanden.
  static func partsBytes() -> Double {
    let dir = OriginalDirs.parts
    let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    return names.reduce(0) { $0 + Double(fileSize(dir.appendingPathComponent($1))) }
  }

  /// Streamend, 4 MiB per keer: niet het hele bestand in het geheugen.
  static func sha256(_ fileName: String) throws -> String {
    let handle = try FileHandle(forReadingFrom: try url(fileName))
    defer { try? handle.close() }
    var hasher = SHA256()
    var more = true
    while more {
      try autoreleasepool {
        let chunk = try handle.read(upToCount: 4 << 20) ?? Data()
        if chunk.isEmpty { more = false } else { hasher.update(data: chunk) }
      }
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  /// Vrije ruimte voor belangrijk gebruik; `nil` als iOS het niet zegt.
  static func freeBytes() -> Double? {
    let home = URL(fileURLWithPath: NSHomeDirectory())
    guard let v = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
      let n = v.volumeAvailableCapacityForImportantUsage
    else { return nil }
    return Double(n)
  }

  private static func stateFile(_ name: String) throws -> URL {
    guard let safe = OriginalDirs.safeName(name) else { throw OriginalFileError.badName }
    return OriginalDirs.state.appendingPathComponent(safe)
  }

  /// `nil` als het bestand er niet is; een andere fout (bv. nog op slot) gaat naar JS.
  static func readState(_ name: String) throws -> String? {
    let u = try stateFile(name)
    if !FileManager.default.fileExists(atPath: u.path) { return nil }
    let data = try Data(contentsOf: u)
    return String(data: data, encoding: .utf8)
  }

  static func writeState(_ name: String, _ text: String) throws {
    let u = try stateFile(name)
    try Data(text.utf8).write(to: u, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
}
