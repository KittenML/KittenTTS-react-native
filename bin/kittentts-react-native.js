#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const zlib = require('zlib');
const { stdin: input, stdout: output } = require('process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MODEL_ALIASES = {
  nano: 'kitten-tts-nano-0.8',
  'nano-fp32': 'kitten-tts-nano-0.8',
  'nano-int8': 'kitten-tts-nano-0.8-int8',
  micro: 'kitten-tts-micro-0.8',
  mini: 'kitten-tts-mini-0.8',
};

const MODEL_CHOICES = [
  { alias: 'nano-int8', model: 'kitten-tts-nano-0.8-int8', label: 'Nano int8 (smallest)' },
  { alias: 'nano', model: 'kitten-tts-nano-0.8', label: 'Nano fp32' },
  { alias: 'micro', model: 'kitten-tts-micro-0.8', label: 'Micro' },
  { alias: 'mini', model: 'kitten-tts-mini-0.8', label: 'Mini' },
];

// Kitten TTS 2 Nano, Pico and Mini: which files they need comes from the SDK itself
// (lib/tiny/KittenTTS2Tiny.js), so the bundle holds exactly what create() reads.
const TINY_CHOICES = [
  { alias: 'kitten-tts-2-nano', model: 'kitten-tts-2-nano', label: 'Kitten TTS 2 Nano (per language)' },
  { alias: 'kitten-tts-2-pico', model: 'kitten-tts-2-pico', label: 'Kitten TTS 2 Pico (per language, smallest)' },
  { alias: 'kitten-tts-2-mini', model: 'kitten-tts-2-mini', label: 'Kitten TTS 2 Mini (one graph, 16 languages)' },
];
const TINY_MODELS = TINY_CHOICES.map(choice => choice.model);
const TINY_TEXT_DIR = 'kitten-tts-2-text';

const MODEL_FILE_NAMES = {
  'kitten-tts-nano-0.8': 'kitten_tts_nano_v0_8.onnx',
  'kitten-tts-nano-0.8-int8': 'kitten_tts_nano_v0_8.onnx',
  'kitten-tts-micro-0.8': 'kitten_tts_micro_v0_8.onnx',
  'kitten-tts-mini-0.8': 'kitten_tts_mini_v0_8.onnx',
};

const PHONEMIZER_RULES_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_rules';

const PHONEMIZER_LIST_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_list';

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { bundleAssets, parseArgs };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === 'help' || args.help) {
    printHelp();
    return;
  }

  if (command !== 'bundle-assets') {
    throw new Error(`Unknown command: ${command}`);
  }

  await bundleAssets(args);
}

async function bundleAssets(args) {
  const models = await resolveModels(args);
  const defaultModel = normalizeModel(args['default-model'] || models[0]);
  if (!models.includes(defaultModel)) {
    throw new Error('--default-model must be one of the bundled models.');
  }
  const onnxModels = models.filter(model => !TINY_MODELS.includes(model));
  const tinyModels = models.filter(model => TINY_MODELS.includes(model));
  if (tinyModels.length === 0 && (tinyLanguages(args) || args.weights !== undefined || args['text-data-url'])) {
    throw new Error(`--languages, --weights and --text-data-url are for Kitten TTS 2 models (${TINY_MODELS.join(', ')}).`);
  }

  const outDir = path.resolve(process.cwd(), args.out || 'assets/kittentts');
  const force = Boolean(args.force);
  const modelBaseURL = args['model-base-url']
    ? stripTrailingSlash(args['model-base-url'])
    : undefined;
  const rulesURL = args['rules-url'] || PHONEMIZER_RULES_URL;
  const listURL = args['list-url'] || PHONEMIZER_LIST_URL;
  const phonemizerDir = path.join(outDir, 'CEPhonemizer');
  const rulesFile = 'en_rules.txt';
  const listFile = 'en_list.txt';

  if (onnxModels.length > 0) fs.mkdirSync(phonemizerDir, { recursive: true });

  const manifestModels = {};
  for (const model of onnxModels) {
    const modelDir = path.join(outDir, model);
    const onnxFile = MODEL_FILE_NAMES[model];
    const voicesFile = 'voices.npz';
    const sourceBaseURL = modelBaseURL || `https://huggingface.co/KittenML/${model}/resolve/main`;

    fs.mkdirSync(modelDir, { recursive: true });
    await downloadIfNeeded(
      `${sourceBaseURL}/${onnxFile}`,
      path.join(modelDir, onnxFile),
      { force, label: `${model} model` },
    );
    await downloadIfNeeded(
      `${sourceBaseURL}/${voicesFile}`,
      path.join(modelDir, voicesFile),
      { force, label: `${model} voices` },
    );

    manifestModels[model] = {
      onnx: `${model}/${onnxFile}`,
      voices: `${model}/${voicesFile}`,
      sourceBaseURL,
    };
  }

  if (onnxModels.length > 0) {
    await downloadIfNeeded(
      rulesURL,
      path.join(phonemizerDir, rulesFile),
      { force, label: 'phonemizer rules' },
    );
    await downloadIfNeeded(
      listURL,
      path.join(phonemizerDir, listFile),
      { force, label: 'phonemizer list' },
    );
  }

  const onnxManifest = {
    defaultModel: onnxModels.includes(defaultModel) ? defaultModel : onnxModels[0],
    models: manifestModels,
    files: {
      phonemizerRules: `CEPhonemizer/${rulesFile}`,
      phonemizerList: `CEPhonemizer/${listFile}`,
    },
    sources: {
      phonemizerRulesURL: rulesURL,
      phonemizerListURL: listURL,
    },
  };

  let manifest;
  if (tinyModels.length === 0) {
    manifest = { version: 2, ...onnxManifest };
  } else {
    const kittenTTS2 = await bundleTinyModels(tinyModels, {
      outDir,
      force,
      modelBaseURL,
      defaultModel: tinyModels.includes(defaultModel) ? defaultModel : tinyModels[0],
      weights: tinyWeights(args),
      languages: tinyLanguages(args),
      textDataURL: args['text-data-url'] ? stripTrailingSlash(args['text-data-url']) : undefined,
    });
    // Version 3: version 2's fields for the 0.8 models (only `models`, empty, when there are
    // none, so older readers still list them) plus kittenTTS2.
    manifest = onnxModels.length > 0
      ? { version: 3, ...onnxManifest, kittenTTS2 }
      : { version: 3, models: {}, kittenTTS2 };
  }

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Wrote bundled KittenTTS assets to ${path.relative(process.cwd(), outDir) || outDir}`);
}

/**
 * Download what each Kitten TTS 2 model reads for its languages into
 * <out>/<model>/ (laid out like the Hugging Face repository) and the shared
 * <out>/kitten-tts-2-text/ (laid out like the text data, gzipped files kept gzipped),
 * and return the manifest's kittenTTS2 section.
 *
 * The SDK picks the files: KittenTTS2Tiny.predownload() runs with modelDirectory and
 * textDataDirectory set to those folders, and the folders' "local" store downloads each
 * file it is asked for instead of failing, so the bundle is what create() reads.
 */
async function bundleTinyModels(models, options) {
  const sdk = loadTinySDK();
  const textDataURL = options.textDataURL || sdk.DEFAULT_TEXT_DATA_URL;
  const textDir = path.join(options.outDir, TINY_TEXT_DIR);
  const ctx = { force: options.force, textDir, fetched: new Map(), recorded: null, textManifest: null };
  const predownload = (model, languages) => sdk.KittenTTS2Tiny.predownload({
    model,
    weights: options.weights,
    languages,
    modelBaseURL: options.modelBaseURL,
    textDataURL,
    modelDirectory: path.join(options.outDir, model),
    textDataDirectory: textDir,
    platform: bundlePlatform(ctx),
  });

  // config.json first (no language: config and vocab only), for the languages each speaks.
  const plans = [];
  for (const model of models) {
    await predownload(model, []);
    const config = JSON.parse(fs.readFileSync(path.join(options.outDir, model, 'config.json'), 'utf8'));
    const spoken = Object.keys(config.languages);
    const languages = options.languages
      ? options.languages.filter(lang => spoken.includes(lang))
      : [config.default_language ?? spoken[0]];
    plans.push({ model, config, spoken, languages });
  }
  if (options.languages) {
    const unknown = options.languages.filter(lang => !plans.some(plan => plan.spoken.includes(lang)));
    const spoken = plans.map(plan => `${plan.model}: ${plan.spoken.join(', ')}`).join('; ');
    if (unknown.length > 0) throw new Error(`No bundled Kitten TTS 2 model speaks ${unknown.join(', ')} (${spoken}).`);
    for (const plan of plans) {
      const skipped = options.languages.filter(lang => !plan.spoken.includes(lang));
      if (plan.languages.length === 0) {
        throw new Error(`${plan.model} speaks none of ${options.languages.join(', ')} (${spoken}).`);
      }
      if (skipped.length > 0) {
        console.log(`${plan.model} does not speak ${skipped.join(', ')}: bundling ${plan.languages.join(', ')} for it.`);
      }
    }
  }

  const section = {
    defaultModel: options.defaultModel,
    textDataDirectory: TINY_TEXT_DIR,
    textDataURL,
    models: {},
  };
  for (const plan of plans) {
    ctx.recorded = new Set();
    await predownload(plan.model, plan.languages);
    const files = {};
    for (const file of [...ctx.recorded].sort()) {
      files[bundlePath(options.outDir, file)] = await ctx.fetched.get(file);
    }
    ctx.recorded = null;
    const repo = sdk.tinyRepoId(plan.model);
    section.models[plan.model] = {
      repo,
      weights: options.weights ?? plan.config.default_weights ?? 'int8',
      languages: plan.languages,
      modelDirectory: plan.model,
      sourceBaseURL: options.modelBaseURL || sdk.huggingFaceResolveURL(repo),
      files,
    };
    const size = Object.values(files).reduce((sum, file) => sum + file.size, 0);
    console.log(
      `${plan.model} ${section.models[plan.model].weights} (${plan.languages.join(', ')}): `
        + `${Object.keys(files).length} files, ${megabytes(size)}`,
    );
  }
  warnAboutOtherFiles(options.outDir, section);
  return section;
}

/** The SDK's KittenTTS2Tiny, from the built package (lib/). */
function loadTinySDK() {
  const lib = path.join(__dirname, '..', 'lib', 'tiny');
  if (!fs.existsSync(path.join(lib, 'KittenTTS2Tiny.js'))) {
    throw new Error(`Bundling Kitten TTS 2 models needs the built SDK in ${lib} (npm run build).`);
  }
  const { KittenTTS2Tiny, DEFAULT_TEXT_DATA_URL } = require(path.join(lib, 'KittenTTS2Tiny.js'));
  const { tinyRepoId, huggingFaceResolveURL } = require(path.join(lib, 'TinyRepo.js'));
  return { KittenTTS2Tiny, DEFAULT_TEXT_DATA_URL, tinyRepoId, huggingFaceResolveURL };
}

/**
 * The platform KittenTTS2Tiny runs on while bundling: every file goes through the
 * folders' local() stores (no ONNX Runtime, nothing loaded).
 */
function bundlePlatform(ctx) {
  const outside = async () => {
    throw new Error('bundle-assets: the SDK asked for a file outside the bundle folders');
  };
  return {
    ort: {},
    store: {
      ensure: outside,
      text: outside,
      bytes: outside,
      filePath: outside,
      clear: outside,
      writeFile: outside,
      local: directory => bundleFolder(path.resolve(directory), ctx),
    },
  };
}

/** A folder of the bundle as the SDK's file source: ensure() downloads what is missing. */
function bundleFolder(dir, ctx) {
  const isText = dir === path.resolve(ctx.textDir);
  const read = (key) => {
    const plain = path.join(dir, key);
    if (fs.existsSync(plain)) return fs.readFileSync(plain);
    if (fs.existsSync(`${plain}.gz`)) return zlib.gunzipSync(fs.readFileSync(`${plain}.gz`));
    throw new Error(`Missing ${plain}`);
  };
  return {
    async ensure(files) {
      for (const file of files) {
        const target = path.join(dir, file.gzip ? `${file.key}.gz` : file.key);
        if (ctx.recorded) ctx.recorded.add(target);
        let job = ctx.fetched.get(target);
        if (!job) {
          job = fetchIntoBundle(file, target, isText ? textEntry(ctx, file.key) : undefined, ctx.force);
          ctx.fetched.set(target, job);
        }
        await job;
      }
    },
    text: async key => read(key).toString('utf8'),
    bytes: async key => new Uint8Array(read(key)),
    filePath: async () => undefined,
    async clear(key) {
      for (const file of [path.join(dir, key), path.join(dir, `${key}.gz`)]) {
        fs.rmSync(file, { force: true });
        ctx.fetched.delete(file);
        if (ctx.recorded) ctx.recorded.delete(file);
      }
      if (isText) ctx.textManifest = null;
    },
  };
}

/** A text data file's manifest entry ({ size, sha256, gzip? }); none for the manifest itself. */
function textEntry(ctx, key) {
  if (key === 'manifest.json') return undefined;
  if (!ctx.textManifest) {
    ctx.textManifest = JSON.parse(fs.readFileSync(path.join(ctx.textDir, 'manifest.json'), 'utf8'));
  }
  return ctx.textManifest.files[key];
}

/**
 * Download one file of the bundle (kept as served: a gzipped text data file stays
 * gzipped), checked against the text data's manifest when it has an entry. Returns its
 * manifest entry: { size, sha256 } of the stored bytes, plus unpackedSize for .gz files.
 */
async function fetchIntoBundle(request, target, entry, force) {
  const label = path.relative(process.cwd(), target);
  const want = entry ? (request.gzip ? entry.gzip : entry) : undefined;
  if (!force && fs.existsSync(target)) {
    const data = fs.readFileSync(target);
    if (!want || (data.length === want.size && sha256(data) === want.sha256)) {
      console.log(`Using existing ${label}`);
      return bundleEntry(request, data);
    }
    console.log(`Replacing ${label}: it does not match the text data's manifest`);
  }

  console.log(`Downloading ${label}...`);
  const data = await fetchBytes(request);
  if (want && (data.length !== want.size || sha256(data) !== want.sha256)) {
    throw new Error(`${request.url}: expected ${want.size} bytes (sha256 ${want.sha256}), got ${data.length} (sha256 ${sha256(data)})`);
  }
  if (!want && request.size !== undefined) {
    const size = request.gzip ? zlib.gunzipSync(data).length : data.length;
    if (size !== request.size) throw new Error(`${request.url}: expected ${request.size} bytes, got ${size}`);
  }
  const temp = `${target}.download`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, target);
  return bundleEntry(request, data);
}

function bundleEntry(request, data) {
  const entry = { size: data.length, sha256: sha256(data) };
  if (request.gzip) entry.unpackedSize = request.size ?? zlib.gunzipSync(data).length;
  return entry;
}

/** GET with up to 3 attempts (not for 4xx answers). */
async function fetchBytes(request) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(request.url, request.headers ? { headers: request.headers } : undefined);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} downloading ${request.url}`);
        error.status = response.status;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (error.status >= 400 && error.status < 500) break;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

/** Files left in the Kitten TTS 2 folders by an earlier run: the app would still ship them. */
function warnAboutOtherFiles(outDir, section) {
  const bundled = new Set(Object.values(section.models).flatMap(model => Object.keys(model.files)));
  const other = [];
  for (const dir of [...TINY_MODELS, TINY_TEXT_DIR]) {
    for (const file of listFiles(path.join(outDir, dir))) {
      const name = bundlePath(outDir, file);
      if (!bundled.has(name)) other.push(name);
    }
  }
  if (other.length === 0) return;
  const shown = other.slice(0, 8).map(name => `  ${name}`).join('\n');
  console.warn(
    `Note: ${other.length} file(s) under ${path.relative(process.cwd(), outDir) || outDir} are not in this bundle `
      + `but would still be copied into the app; delete them (or the folder, then run again) to leave them out:\n`
      + `${shown}${other.length > 8 ? `\n  ... and ${other.length - 8} more` : ''}`,
  );
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? listFiles(file) : [file];
  });
}

/** A path from the bundle root with forward slashes, as the app reads it. */
function bundlePath(outDir, file) {
  return path.relative(outDir, file).split(path.sep).join('/');
}

function tinyWeights(args) {
  if (args.weights === undefined) return undefined;
  if (typeof args.weights !== 'string') throw new Error('--weights takes one value: int8 or int4.');
  return args.weights.trim();
}

function tinyLanguages(args) {
  const values = [...arrayValue(args.language), ...arrayValue(args.languages)]
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean);
  return values.length > 0 ? unique(values) : undefined;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

async function resolveModels(args) {
  if (args.all) return MODEL_CHOICES.map(choice => choice.model);

  const values = [
    ...arrayValue(args.model),
    ...arrayValue(args.models),
  ].flatMap(value => String(value).split(','));

  const models = unique(values.map(value => value.trim()).filter(Boolean).map(normalizeModel));
  if (models.length > 0) return models;

  if (!input.isTTY) return [normalizeModel('nano-int8')];

  const rl = readline.createInterface({ input, output });
  const choices = [...MODEL_CHOICES, ...TINY_CHOICES];
  try {
    console.log('Select KittenTTS models to bundle:');
    choices.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.alias} - ${choice.label}`);
    });
    const answer = await rl.question('Models (comma-separated numbers or names, default: nano-int8): ');
    if (!answer.trim()) return [normalizeModel('nano-int8')];
    const models = unique(
      answer
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
          const index = Number(value);
          return Number.isInteger(index) && choices[index - 1]
            ? choices[index - 1].model
            : normalizeModel(value);
        }),
    );
    if (models.some(model => TINY_MODELS.includes(model)) && !tinyLanguages(args)) {
      const languages = await rl.question('Kitten TTS 2 languages (comma-separated codes, default: en): ');
      if (languages.trim()) args.languages = languages;
    }
    return models;
  } finally {
    rl.close();
  }
}

async function downloadIfNeeded(url, destination, options) {
  if (!options.force && fs.existsSync(destination)) {
    console.log(`Using existing ${options.label}: ${path.relative(process.cwd(), destination)}`);
    return;
  }

  const temp = `${destination}.download`;
  fs.rmSync(temp, { force: true });

  console.log(`Downloading ${options.label}...`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
  fs.renameSync(temp, destination);
}

function normalizeModel(model) {
  const tiny = String(model).replace(/^KittenML\//, '');
  if (TINY_MODELS.includes(tiny)) return tiny;
  const normalized = MODEL_ALIASES[model] || model;
  if (!MODEL_FILE_NAMES[normalized]) {
    throw new Error(
      `Unknown model '${model}'. Use one of: nano, nano-int8, micro, mini, ${TINY_MODELS.join(', ')}.`,
    );
  }
  return normalized;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      result._.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      addArg(result, arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      addArg(result, key, true);
    } else {
      addArg(result, key, next);
      i += 1;
    }
  }
  return result;
}

function addArg(result, key, value) {
  if (result[key] === undefined) {
    result[key] = value;
  } else if (Array.isArray(result[key])) {
    result[key].push(value);
  } else {
    result[key] = [result[key], value];
  }
}

function arrayValue(value) {
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return Array.from(new Set(values));
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function printHelp() {
  console.log(`Usage:
  npx @kittentts/react-native bundle-assets [options]

Interactive:
  npx @kittentts/react-native bundle-assets

Automation:
  npx @kittentts/react-native bundle-assets --models nano-int8,micro
  npx @kittentts/react-native bundle-assets --model nano-int8 --model mini
  npx @kittentts/react-native bundle-assets --models kitten-tts-2-nano --weights int8 --languages en,de
  npx @kittentts/react-native bundle-assets --models kitten-tts-2-mini --languages en,ja

Options:
  --model <name>            Model to bundle. Can be repeated.
  --models <list>           Comma-separated models: nano-int8,nano,micro,mini (0.8) and
                            kitten-tts-2-nano,kitten-tts-2-pico,kitten-tts-2-mini
  --all                     Bundle every 0.8 model
  --default-model <name>    Default model in manifest. Defaults to first model.
  --out <dir>               Output directory. Defaults to assets/kittentts
  --force                   Redownload files even when they already exist
  --model-base-url <url>    Directory containing model files; single-model use
  --rules-url <url>         CEPhonemizer en_rules URL
  --list-url <url>          CEPhonemizer en_list URL

Kitten TTS 2 Nano, Pico and Mini:
  --languages <list>        Languages to bundle, e.g. en,de (Mini also da fi ja ko nl
                            sv sw tr). Defaults to the model's default language (en).
                            A language one of several models lacks is left out for it.
                            Can be repeated as --language <code>.
  --weights <int8|int4>     ONNX weights. Defaults to int8; int4 is about half the size.
  --text-data-url <url>     Host of the text data (English lexicons, espeak-ng data,
                            Japanese dictionary). Defaults to the SDK's.

Output:
  assets/kittentts/manifest.json plus model and phonemizer files under
  assets/kittentts/. Use the @kittentts/react-native Expo config plugin to
  include that directory in native app assets. Kitten TTS 2 models go to
  assets/kittentts/<model>/ (laid out like the Hugging Face repository) and
  assets/kittentts/kitten-tts-2-text/ (gzipped files stay gzipped): exactly the
  files KittenTTS.create() reads for those languages and weights. Load them with
  createBundledTinyOptions(manifest).
`);
}
