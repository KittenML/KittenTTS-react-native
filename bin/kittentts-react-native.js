#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

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

  fs.mkdirSync(phonemizerDir, { recursive: true });

  const manifestModels = {};
  for (const model of models) {
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

  const manifest = {
    version: 2,
    defaultModel,
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

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Wrote bundled KittenTTS assets to ${path.relative(process.cwd(), outDir) || outDir}`);
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
  try {
    console.log('Select KittenTTS models to bundle:');
    MODEL_CHOICES.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.alias} - ${choice.label}`);
    });
    const answer = await rl.question('Models (comma-separated numbers or names, default: nano-int8): ');
    if (!answer.trim()) return [normalizeModel('nano-int8')];
    return unique(
      answer
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
          const index = Number(value);
          return Number.isInteger(index) && MODEL_CHOICES[index - 1]
            ? MODEL_CHOICES[index - 1].model
            : normalizeModel(value);
        }),
    );
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
  const normalized = MODEL_ALIASES[model] || model;
  if (!MODEL_FILE_NAMES[normalized]) {
    throw new Error(
      `Unknown model '${model}'. Use one of: nano, nano-int8, micro, mini.`,
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

Options:
  --model <name>            Model to bundle. Can be repeated.
  --models <list>           Comma-separated models: nano-int8,nano,micro,mini
  --all                     Bundle every supported model
  --default-model <name>    Default model in manifest. Defaults to first model.
  --out <dir>               Output directory. Defaults to assets/kittentts
  --force                   Redownload files even when they already exist
  --model-base-url <url>    Directory containing model files; single-model use
  --rules-url <url>         CEPhonemizer en_rules URL
  --list-url <url>          CEPhonemizer en_list URL

Output:
  assets/kittentts/manifest.json plus model and phonemizer files under
  assets/kittentts/. Use the @kittentts/react-native Expo config plugin to
  include that directory in native app assets.
`);
}
