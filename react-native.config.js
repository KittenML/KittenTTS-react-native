module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageName: 'com.kittentts.reactnative',
        packageImportPath: 'import com.kittentts.reactnative.KittenTTSNativePackage;',
        packageInstance: 'new KittenTTSNativePackage()',
      },
    },
  },
};
