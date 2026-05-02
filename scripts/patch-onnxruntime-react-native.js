#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PATCH_MARKER = 'KITTEN_TTS_RELOAD_SAFE_ONNXRUNTIME';
const ANDROID_GRADLE_MARKER = 'KITTEN_TTS_GRADLE_9_ONNXRUNTIME';

function findOrtPackageRoot() {
  // postinstall scripts can run from the package root, an example app, or a
  // package manager working directory. Try each likely base so this still
  // works when the dependency is hoisted or installed from a nested app.
  const searchPaths = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, '..'),
  ];

  for (const basePath of searchPaths) {
    try {
      return path.dirname(
        require.resolve('onnxruntime-react-native/package.json', {
          paths: [basePath],
        }),
      );
    } catch {
      // Try the next likely install location.
    }
  }

  return null;
}

function patchOnnxruntimeModule(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let source = fs.readFileSync(filePath, 'utf8');

  // The marker is injected into the native source below. If it is already
  // present, the patch has been applied before and should not be duplicated.
  if (source.includes(PATCH_MARKER)) {
    return true;
  }

  // Keep these needles exact and conservative. If the upstream native file
  // changes shape, it is safer to skip than to apply a partial Objective-C++
  // rewrite in the wrong place.
  const includeNeedle = '#include "JsiMain.h"\n';
  const envNeedle = 'static std::shared_ptr<onnxruntimejsi::Env> env;\n';
  const installNeedle = '    env = onnxruntimejsi::install(runtime, jsiInvoker);\n';
  const deallocNeedle = '- (void)dealloc {\n  env.reset();\n}\n';

  if (
    !source.includes(includeNeedle) ||
    !source.includes(envNeedle) ||
    !source.includes(installNeedle) ||
    !source.includes(deallocNeedle)
  ) {
    console.warn(
      '[@kittentts/react-native] Skipped ONNX Runtime iOS reload patch: unrecognized source layout.',
    );
    return false;
  }

  source = source.replace(
    includeNeedle,
    `${includeNeedle}#include <vector>\n`,
  );

  // In debug builds, React Native reload can tear down the JSI runtime before
  // this module is deallocated. onnxruntimejsi::Env owns WeakObject instances,
  // and destroying those after the runtime has gone away can crash. Keeping
  // old Env objects alive for the life of the process avoids that reload crash.
  source = source.replace(
    envNeedle,
    `${envNeedle}\n#if DEBUG\n// ${PATCH_MARKER}: React Native dev reload can deallocate this module after\n// the JSI runtime is gone. Keep old Env instances alive in debug builds so\n// their WeakObject members are not destroyed against a dead runtime.\nstatic std::vector<std::shared_ptr<onnxruntimejsi::Env>> kittenTTSLeakedReloadEnvs;\n#endif\n`,
  );

  // Preserve the previous Env before replacing it on a reinstall. This only
  // happens in DEBUG so release builds keep normal ownership and cleanup.
  source = source.replace(
    installNeedle,
    `    auto nextEnv = onnxruntimejsi::install(runtime, jsiInvoker);\n#if DEBUG\n    if (env) {\n      kittenTTSLeakedReloadEnvs.push_back(env);\n    }\n#endif\n    env = nextEnv;\n`,
  );

  // Release builds still reset env in dealloc. Debug builds intentionally skip
  // reset because the process-local leak is preferable to a reload-time crash.
  source = source.replace(
    deallocNeedle,
    `- (void)dealloc {\n#if !DEBUG\n  env.reset();\n#endif\n}\n`,
  );

  fs.writeFileSync(filePath, source);
  return true;
}

function patchOnnxruntimeAndroidBuildGradle(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(ANDROID_GRADLE_MARKER)) {
    return true;
  }

  const versionNumberNeedle =
    '  if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {\n';
  if (!source.includes(versionNumberNeedle)) {
    return false;
  }

  // Gradle 9 no longer exposes the old VersionNumber helper used by
  // onnxruntime-react-native 1.24.x. The file already computes the React Native
  // minor version, so use that value directly for the same compatibility check.
  source = source.replace(
    versionNumberNeedle,
    `  // ${ANDROID_GRADLE_MARKER}: Gradle 9 removed VersionNumber.\n  if (REACT_NATIVE_MINOR_VERSION < 71) {\n`,
  );

  fs.writeFileSync(filePath, source);
  return true;
}

const ortRoot = findOrtPackageRoot();
if (!ortRoot) {
  console.warn(
    '[@kittentts/react-native] Skipped ONNX Runtime iOS reload patch: onnxruntime-react-native not found.',
  );
  process.exit(0);
}

const modulePath = path.join(ortRoot, 'ios', 'OnnxruntimeModule.mm');
if (patchOnnxruntimeModule(modulePath)) {
  console.log('[@kittentts/react-native] Applied ONNX Runtime iOS dev reload patch.');
}

const androidGradlePath = path.join(ortRoot, 'android', 'build.gradle');
if (patchOnnxruntimeAndroidBuildGradle(androidGradlePath)) {
  console.log('[@kittentts/react-native] Applied ONNX Runtime Android Gradle 9 patch.');
}
