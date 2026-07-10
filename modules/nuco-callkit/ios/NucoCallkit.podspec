Pod::Spec.new do |s|
  s.name           = 'NucoCallkit'
  s.version        = '1.0.0'
  s.summary        = 'CallKit and PushKit bridge for Nuco calls'
  s.description    = 'Native incoming call UI (lock screen included) and VoIP push wakes for the sealed call signaling.'
  s.license        = 'GPL-3.0-only'
  s.author         = 'ZL Software GmbH'
  s.homepage       = 'https://github.com/zl-software/nuco-messenger'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/zl-software/nuco-messenger.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'CallKit', 'PushKit', 'AVFAudio'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
