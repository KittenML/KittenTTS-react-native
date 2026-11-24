// React Native CLI links only the app's own dependencies on iOS, so onnxruntime-react-native
// is listed in package.json for its pod. On Android the SDK registers ONNX Runtime itself,
// so the CLI must not link it a second time.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: { android: null },
    },
  },
};
