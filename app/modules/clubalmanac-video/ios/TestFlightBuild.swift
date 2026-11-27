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
