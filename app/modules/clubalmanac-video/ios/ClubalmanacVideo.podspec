# WP37: lokale Expo-module voor filmpjes (comprimeren, poster, datum en plaats).
# Autolinking vindt hem in app/modules; een nieuwe dev-build is nodig.
Pod::Spec.new do |s|
  s.name           = 'ClubalmanacVideo'
  s.version        = '1.0.0'
  s.summary        = 'Clubalmanac: filmpjes comprimeren, poster en metadata'
  s.description    = 'Comprimeert een filmpje naar mp4 (H.264, AAC, index vooraan, zonder metadata), maakt een poster en leest datum en plaats uit het origineel.'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'Clubalmanac'
  s.homepage       = 'https://clubalmanac.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
