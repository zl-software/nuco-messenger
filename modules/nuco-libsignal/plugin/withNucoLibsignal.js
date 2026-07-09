// Config plugin wiring official libsignal into the prebuild output. iOS consumes the
// LibSignalClient pod straight from the signalapp/libsignal git tag; its podspec
// downloads a prebuilt Rust FFI archive at build time, verified against the sha256 in
// libsignal.json (the single pin point shared with the Android artifact version and the
// Node twin used by the crypto selftest). Android consumes the prebuilt AAR from
// Signal's own Maven repository (Maven Central stopped receiving releases at 0.86.5).

const { withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pin = require('../libsignal.json');

const SIGNAL_MAVEN = 'https://build-artifacts.signal.org/libraries/maven/';

function withLibsignalPodfile(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes('LIBSIGNAL_FFI_PREBUILD_CHECKSUM')) {
        contents =
          `ENV['LIBSIGNAL_FFI_PREBUILD_CHECKSUM'] ||= '${pin.iosPrebuildChecksum}'\n` + contents;
      }
      if (!contents.includes("pod 'LibSignalClient'")) {
        contents = contents.replace(
          /target ['"][^'"]+['"] do\n/,
          (match) =>
            match +
            `  pod 'LibSignalClient', git: 'https://github.com/signalapp/libsignal.git', tag: 'v${pin.version}'\n`,
        );
      }
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
}

function withSignalMaven(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(SIGNAL_MAVEN)) {
      config.modResults.contents = config.modResults.contents.replace(
        /allprojects\s*\{\s*\n(\s*)repositories\s*\{\s*\n/,
        (match, indent) => match + `${indent}${indent}maven { url '${SIGNAL_MAVEN}' }\n`,
      );
    }
    return config;
  });
}

// The libsignal-android AAR declares a core library desugaring requirement (its metadata
// fails the build without it), so the app module needs the desugared JDK libs.
function withDesugaring(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('coreLibraryDesugaringEnabled')) {
      config.modResults.contents +=
        `\n// org.signal:libsignal-android requires core library desugaring (injected by nuco-libsignal).\n` +
        `android {\n` +
        `    compileOptions {\n` +
        `        coreLibraryDesugaringEnabled true\n` +
        `    }\n` +
        `}\n` +
        `\n` +
        `dependencies {\n` +
        `    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'\n` +
        `}\n`;
    }
    return config;
  });
}

module.exports = (config) => withDesugaring(withSignalMaven(withLibsignalPodfile(config)));
