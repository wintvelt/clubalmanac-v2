// WP38b: de app-delegate-haak voor de achtergrond-sessies van de uploader
// (OriginalUploader.swift). Geregistreerd in expo-module.config.json.
//
// - Bij elke start (ook als iOS de app op de achtergrond wekt) de sessies weer
//   aanmaken en de lopende taken naast de opslag leggen.
// - `handleEventsForBackgroundURLSession`: voor een eigen sessie de terugroep
//   bewaren tot de sessie alle events heeft afgeleverd; voor een andere meteen
//   klaar (expo-file-system regelt de zijne zelf, WP37).

import ExpoModulesCore
import UIKit

public class ClubalmanacUploadAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    OriginalUploader.shared.start(reason: "app gestart")
    return true
  }

  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    let uploader = OriginalUploader.shared
    guard uploader.owns(identifier) else {
      completionHandler()
      return
    }
    uploader.setBackgroundCompletion(identifier, completionHandler)
    uploader.start(reason: "gewekt door iOS")
  }
}
