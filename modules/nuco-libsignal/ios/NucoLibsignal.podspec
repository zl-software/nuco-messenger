require 'json'

pin = JSON.parse(File.read(File.join(__dir__, '..', 'libsignal.json')))

Pod::Spec.new do |s|
  s.name           = 'NucoLibsignal'
  s.version        = pin['version']
  s.summary        = 'Official libsignal for Nuco via the Expo Modules API'
  s.description    = 'Record passing wrapper over LibSignalClient for the Nuco messenger.'
  s.license        = 'GPL-3.0-only'
  s.author         = 'ZL Software GmbH'
  s.homepage       = 'https://github.com/zl-software/nuco-messenger'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/zl-software/nuco-messenger.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'LibSignalClient'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
