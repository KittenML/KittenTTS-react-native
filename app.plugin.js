const fs = require('fs');
const path = require('path');
const PbxFile = require('xcode/lib/pbxFile');
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require('expo/config-plugins');

const DEFAULT_ASSETS_DIR = './assets/kittentts';
const DEFAULT_ASSET_ROOT = 'kittentts';

module.exports = function withKittenTTS(config, props = {}) {
  const assetsDir = props.assetsDir || DEFAULT_ASSETS_DIR;
  const assetRoot = props.assetRoot || DEFAULT_ASSET_ROOT;

  config = withDangerousMod(config, [
    'android',
    async (nextConfig) => {
      const source = path.resolve(nextConfig.modRequest.projectRoot, assetsDir);
      const destination = path.join(
        nextConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        assetRoot,
      );
      copyDirectory(source, destination);
      return nextConfig;
    },
  ]);

  config = withXcodeProject(config, async (nextConfig) => {
    const source = path.resolve(nextConfig.modRequest.projectRoot, assetsDir);
    const iosSourceRoot = IOSConfig.Paths.getSourceRoot(nextConfig.modRequest.projectRoot);
    const destination = path.join(iosSourceRoot, assetRoot);
    copyDirectory(source, destination);

    addFolderReferenceToResources(
      nextConfig.modResults,
      path.relative(nextConfig.modRequest.platformProjectRoot, destination),
    );

    return nextConfig;
  });

  return config;
};

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function addFolderReferenceToResources(project, folderPath) {
  IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');

  const resourcesGroup = project.pbxGroupByName('Resources');
  const basename = path.basename(folderPath);
  const existingChild = resourcesGroup?.children?.find((child) => child.comment === basename);
  if (existingChild) return;

  const target = project.getTarget('com.apple.product-type.application');
  const file = new PbxFile(folderPath, {
    lastKnownFileType: 'folder',
    defaultEncoding: undefined,
  });
  file.target = target?.uuid;
  file.uuid = project.generateUuid();
  file.fileRef = project.generateUuid();
  file.fileEncoding = undefined;

  project.addToPbxFileReferenceSection(file);
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
  resourcesGroup.children.push({
    value: file.fileRef,
    comment: file.basename,
  });
}
