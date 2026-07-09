Pod::Spec.new do |s|
  s.name           = 'NucoPinnedWs'
  s.version        = '1.0.0'
  s.summary        = 'URLSession WebSocket for the certificate pinned relay connection'
  s.description    = 'Runs the relay WebSocket through the URL Loading System so the NSPinnedDomains certificate pins apply to it.'
  s.license        = 'GPL-3.0-only'
  s.author         = 'ZL Software GmbH'
  s.homepage       = 'https://github.com/zl-software/nuco-messenger'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/zl-software/nuco-messenger.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
