// WP47: komt de geïnstalleerde build uit TestFlight? Voor het label bij Info.
// Spec: docs/work-packages/WP47-versielabel.md (antwoord 2, invariant 7–10).
//
// Alleen "ja" als alles klopt (invariant 8):
// - een echt toestel: in de simulator nooit;
// - een build zonder eigen provisioning-bestand: Apple haalt embedded.mobileprovision
//   weg bij een build uit TestFlight of de App Store; een dev-signed of
//   ad-hoc-build heeft hem nog (en draait ook in de sandbox);
// - een geverifieerde app-transactie in de omgeving sandbox (TestFlight); de
//   App Store geeft production, StoreKit Testing in Xcode geeft xcode.
// Geen `refresh()`: die toont een inlogvraag van de App Store (invariant 9).
// Geen receipt-route: deprecated sinds iOS 18 en synchroon.
// Een fout van StoreKit (geen netwerk, niet ingelogd) gaat als fout naar JS;
// daar is dat "weet niet" en komt er geen label.

import Foundation
import StoreKit

enum TestFlightBuild {
  static func check() async throws -> Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    if Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil {
      return false
    }
    let result = try await AppTransaction.shared
    guard case .verified(let transaction) = result else { return false }
    return transaction.environment == .sandbox
    #endif
  }
}

// WP47 fix-cyclus 1: diagnose voor builds met DEV_TOOLS. Een korte tekst met
// per stap wat er gebeurde, zodat we zien waarom "TestFlight" wegblijft. Niets
// gevoeligs: geen ids, geen bundelgegevens. Raakt `check()` niet. Een time-out
// van 10 s maakt een hangende AppTransaction.shared zichtbaar.
extension TestFlightBuild {
  static func diagnose() async -> String {
    var parts: [String] = []
    #if targetEnvironment(simulator)
    parts.append("simulator: ja")
    #else
    parts.append("simulator: nee")
    #endif
    let provisioning = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil
    parts.append("provisioning: " + (provisioning ? "ja" : "nee"))
    let started = Date()
    let outcome = await withTimeout(seconds: 10) { await appTransactionText() }
    let ms = Int(Date().timeIntervalSince(started) * 1000)
    parts.append("AppTransaction: \(outcome) (\(ms) ms)")
    return parts.joined(separator: " · ")
  }

  private static func appTransactionText() async -> String {
    do {
      let result = try await AppTransaction.shared
      switch result {
      case .verified(let transaction):
        return "verified, \(transaction.environment.rawValue)"
      case .unverified(let transaction, let error):
        return "unverified (\(error)), \(transaction.environment.rawValue)"
      }
    } catch {
      return "fout \(type(of: error)): \(error.localizedDescription)"
    }
  }

  /// Het eerste van de twee: het antwoord of de time-out. De taak die hangt,
  /// loopt door zonder dat iemand erop wacht.
  private static func withTimeout(
    seconds: UInt64, _ work: @escaping @Sendable () async -> String
  ) async -> String {
    await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
      let once = ResumeOnce(continuation)
      Task { once.resume(await work()) }
      Task {
        try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
        once.resume("time-out (\(seconds) s)")
      }
    }
  }
}

private final class ResumeOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<String, Never>?

  init(_ continuation: CheckedContinuation<String, Never>) {
    self.continuation = continuation
  }

  func resume(_ value: String) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(returning: value)
  }
}
