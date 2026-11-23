// Kitten TTS 2 Nano, Pico and Mini shipped inside the app: the manifest section that
// `bundle-assets` writes (bin/kittentts-react-native.js) and the platform-neutral half of
// createBundledTinyOptions (KittenTTSBundledAssets.ts / .web.ts). No React Native or Node
// imports, so the tests run it in Node with a fake file system.

import { KittenTTSError, errorMessage } from '../KittenTTSError';
import type { KittenTinyModel, KittenTinyWeights } from './TinyRepo';
import { isTinyModel } from './TinyRepo';

/** One file in the bundle, as stored there. */
export interface KittenTTS2BundledFile {
  size: number;
  sha256: string;
  /**
   * For a gzipped text data file (`*.gz`): its size unpacked. Android's build unpacks
   * `.gz` assets and drops the extension, so the APK may hold the plain file instead.
   */
  unpackedSize?: number;
}

/** One Kitten TTS 2 model in the bundle. */
export interface KittenTTS2BundledModel {
  /** The Hugging Face repository, e.g. `KittenML/kitten-tts-2-nano`. */
  repo: string;
  weights: KittenTinyWeights;
  /** The languages bundled: what `create()` loads. */
  languages: string[];
  /** The folder laid out like the repository, relative to the bundle root. */
  modelDirectory: string;
  /** Where the model files were downloaded from. */
  sourceBaseURL: string;
  /**
   * Every file `create()` and `generate()` read for these languages (model files and
   * text data, the text data's manifest.json included), by path from the bundle root.
   */
  files: Record<string, KittenTTS2BundledFile>;
}

/** The `kittenTTS2` section of a version 3 manifest. */
export interface KittenTTS2BundledAssets {
  defaultModel: string;
  /** The text data folder shared by the models, relative to the bundle root. */
  textDataDirectory: string;
  /** Where the text data was downloaded from. */
  textDataURL: string;
  models: Record<string, KittenTTS2BundledModel>;
}

/** What createBundledTinyOptions returns: spread it into `KittenTTS.create()`. */
export interface BundledTinyOptions {
  model: KittenTinyModel;
  weights: KittenTinyWeights;
  languages: string[];
  modelDirectory: string;
  textDataDirectory: string;
}

export interface CreateBundledTinyOptions {
  /** A Kitten TTS 2 model in the bundle. Default: the bundle's default Kitten TTS 2 model. */
  model?: KittenTinyModel;
  /**
   * A real folder (on the web, a URL prefix) holding the bundle's files. Default: the
   * app's bundled assets (iOS: `<MainBundle>/<assetRoot>`; Android: copied from the APK
   * into `copyDirectory`; web: the `assetRoot` URL prefix).
   */
  basePath?: string;
  /** Native asset directory, as in the Expo config plugin. Defaults to `kittentts`. */
  assetRoot?: string;
  /**
   * Android only: where the bundled files are copied once, since APK assets are not
   * files. Default: `<DocumentDirectory>/KittenTTS/bundled`.
   */
  copyDirectory?: string;
}

interface ManifestWithTiny {
  version: number;
  kittenTTS2?: KittenTTS2BundledAssets;
}

/** The Kitten TTS 2 models in a bundle (none for a bundle made before they were supported). */
export function bundledTinyModels(manifest: ManifestWithTiny): KittenTinyModel[] {
  return Object.keys(manifest.kittenTTS2?.models ?? {}).filter(isTinyModel);
}

/** A bundled Kitten TTS 2 model's entry, or a clear error. */
export function bundledTinyModel(
  manifest: ManifestWithTiny,
  model?: KittenTinyModel,
): { section: KittenTTS2BundledAssets; name: KittenTinyModel; entry: KittenTTS2BundledModel } {
  const section = manifest.kittenTTS2;
  if (!section || Object.keys(section.models).length === 0) {
    throw KittenTTSError.invalidArgument(
      'The bundled assets have no Kitten TTS 2 model: run `bundle-assets --models kitten-tts-2-nano` (or pico, mini).',
    );
  }
  // "KittenML/kitten-tts-2-nano" names the same model as "kitten-tts-2-nano".
  const name = model === undefined ? section.defaultModel : String(model).replace(/^KittenML\//, '');
  const entry = section.models[name];
  if (!entry || !isTinyModel(name)) {
    throw KittenTTSError.invalidArgument(
      `${name} is not in the bundled assets; bundled: ${Object.keys(section.models).join(', ')}`,
    );
  }
  return { section, name, entry };
}

/** The create() options for a bundled model whose files are under `root`. */
export function bundledTinyOptionsAt(
  bundle: ReturnType<typeof bundledTinyModel>,
  root: string,
): BundledTinyOptions {
  return {
    model: bundle.name,
    weights: bundle.entry.weights,
    languages: [...bundle.entry.languages],
    modelDirectory: joinPath(root, bundle.entry.modelDirectory),
    textDataDirectory: joinPath(root, bundle.section.textDataDirectory),
  };
}

/** What copyBundledFiles needs from the platform (react-native-fs on Android). */
export interface BundledFileSystem {
  /** Whether the app's assets hold this path. */
  assetExists(path: string): Promise<boolean>;
  copyAsset(from: string, to: string): Promise<void>;
  /** A file's size, or null when it is not there. */
  size(path: string): Promise<number | null>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
}

/** Which bundled file versions a copy folder holds: path -> sha256. */
const STAMP = '.kittentts-bundle.json';

/**
 * Copy bundled files from the app's assets into `destination`, once: a file already there
 * with the right size is kept, unless an earlier copy recorded other contents for it (an
 * app update with new files of the same size). A `.gz` file the build unpacked (Android
 * drops the extension) is copied plain, and the other form is removed so readers never pick
 * a stale one.
 */
export async function copyBundledFiles(
  files: Record<string, KittenTTS2BundledFile>,
  assetRoot: string,
  destination: string,
  fs: BundledFileSystem,
): Promise<void> {
  const stampPath = joinPath(destination, STAMP);
  let stamp: Record<string, string> = {};
  try {
    stamp = JSON.parse(await fs.readText(stampPath)) ?? {};
  } catch {
    stamp = {};
  }
  const next = { ...stamp };
  for (const [file, info] of Object.entries(files)) {
    const plain = file.endsWith('.gz') && info.unpackedSize !== undefined ? file.slice(0, -3) : null;
    const known = stamp[file] === undefined || stamp[file] === info.sha256;
    next[file] = info.sha256;
    if (known && (await fs.size(joinPath(destination, file))) === info.size) continue;
    if (known && plain && (await fs.size(joinPath(destination, plain))) === info.unpackedSize) continue;

    let stored = file;
    if (!(await fs.assetExists(joinPath(assetRoot, file)))) {
      if (!plain || !(await fs.assetExists(joinPath(assetRoot, plain)))) {
        throw KittenTTSError.modelFileNotFound(`${joinPath(assetRoot, file)} in the app's assets`);
      }
      stored = plain;
    }
    const target = joinPath(destination, stored);
    const temp = `${target}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.copy`;
    const expected = stored === file ? info.size : info.unpackedSize;
    try {
      await fs.mkdir(target.slice(0, target.lastIndexOf('/')));
      await fs.copyAsset(joinPath(assetRoot, stored), temp);
      const size = await fs.size(temp);
      if (size !== expected) throw new Error(`expected ${expected} bytes, got ${size}`);
      await fs.move(temp, target);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw KittenTTSError.invalidModelData(`Could not copy the bundled ${stored}: ${errorMessage(error)}`, error);
    }
    if (plain) {
      const other = joinPath(destination, stored === file ? plain : file);
      if ((await fs.size(other)) !== null) await fs.unlink(other).catch(() => {});
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(stamp)) {
    await fs.mkdir(destination);
    await fs.writeText(stampPath, JSON.stringify(next));
  }
}

function joinPath(base: string, file: string): string {
  if (!base) return file;
  return `${base.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}
