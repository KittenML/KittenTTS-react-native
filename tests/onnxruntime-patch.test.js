const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  patchOnnxruntimeBridgeRuntime,
  patchOnnxruntimeModule,
} = require('../scripts/patch-onnxruntime-react-native');

// The parts of onnxruntime-react-native 1.24.3's ios/OnnxruntimeModule.mm the patches touch.
const ORT_1_24_MODULE = `#import "OnnxruntimeModule.h"
#include "JsiMain.h"

#import <Foundation/Foundation.h>
#import <React/RCTBridge+Private.h>

@implementation OnnxruntimeModule

@synthesize bridge = _bridge;

static std::shared_ptr<onnxruntimejsi::Env> env;

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  @try {
    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;
    if (cxxBridge == nil) {
      return @false;
    }

    auto jsiRuntime = (facebook::jsi::Runtime*)cxxBridge.runtime;
    if (jsiRuntime == nil) {
      return @false;
    }
    auto& runtime = *jsiRuntime;
    auto jsiInvoker = _bridge.jsCallInvoker;

    env = onnxruntimejsi::install(runtime, jsiInvoker);

    return @true;
  } @catch (...) {
    return @false;
  }
}

- (void)dealloc {
  env.reset();
}

@end
`;

function moduleFile(source) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ort-patch-')), 'OnnxruntimeModule.mm');
  fs.writeFileSync(file, source);
  return file;
}

test('the React Native 0.88 patch reaches the runtime without RCTCxxBridge', () => {
  const file = moduleFile(ORT_1_24_MODULE);
  assert.equal(patchOnnxruntimeBridgeRuntime(file), true);

  const patched = fs.readFileSync(file, 'utf8');
  assert.ok(!patched.includes('RCTCxxBridge*'), 'no cast to the removed class');
  assert.match(patched, /@protocol KittenTTSJSIRuntimeProvider\n- \(void \*\)runtime;\n@end\n\n@implementation OnnxruntimeModule/);
  assert.match(patched, /auto jsiRuntime = \(facebook::jsi::Runtime\*\)\[runtimeProvider runtime\];/);
  assert.match(patched, /auto jsiInvoker = _bridge\.jsCallInvoker;/);

  assert.equal(patchOnnxruntimeBridgeRuntime(file), true, 'a second run is a no-op');
  assert.equal(fs.readFileSync(file, 'utf8'), patched);
});

test('both iOS patches apply, in either order', () => {
  for (const order of [
    [patchOnnxruntimeModule, patchOnnxruntimeBridgeRuntime],
    [patchOnnxruntimeBridgeRuntime, patchOnnxruntimeModule],
  ]) {
    const file = moduleFile(ORT_1_24_MODULE);
    for (const patch of order) assert.equal(patch(file), true);

    const patched = fs.readFileSync(file, 'utf8');
    assert.ok(patched.includes('KITTEN_TTS_RELOAD_SAFE_ONNXRUNTIME'));
    assert.ok(patched.includes('KITTEN_TTS_RN_088_ONNXRUNTIME'));
    assert.ok(!patched.includes('RCTCxxBridge*'));
  }
});

test('an unfamiliar source layout is left alone', () => {
  const source = ORT_1_24_MODULE.replace('auto jsiRuntime =', 'jsi::Runtime* jsiRuntime =');
  const file = moduleFile(source);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(patchOnnxruntimeBridgeRuntime(file), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});
