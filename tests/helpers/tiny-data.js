// Local files for the Kitten TTS 2 Nano / Pico / Mini tests, without network:
//   KITTEN_TTS_2_TINY_DATA       the text data folder as built by tools/kitten-tts-2-tiny/build_text_pack.py
//                                (en/, espeak-ng-data/, ja/, manifest.json; big files gzipped as "<name>.gz")
//   KITTEN_TTS_2_TINY_MODEL_DIR  a folder holding kitten-tts-2-nano/, -pico/, -mini/ laid out like the
//                                Hugging Face repositories (default: the Hugging Face cache, revision main)
// A test skips, and says why, when a file it needs is missing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const textDir = process.env.KITTEN_TTS_2_TINY_DATA ? path.resolve(process.env.KITTEN_TTS_2_TINY_DATA) : null;

function modelDir(name) {
  if (process.env.KITTEN_TTS_2_TINY_MODEL_DIR) {
    const d = path.join(process.env.KITTEN_TTS_2_TINY_MODEL_DIR, name);
    return fs.existsSync(d) ? d : null;
  }
  const repo = path.join(os.homedir(), '.cache', 'huggingface', 'hub', `models--KittenML--${name}`);
  const ref = path.join(repo, 'refs', 'main');
  if (!fs.existsSync(ref)) return null;
  const d = path.join(repo, 'snapshots', fs.readFileSync(ref, 'utf8').trim());
  return fs.existsSync(d) ? d : null;
}

/** A file from a folder, plain or as "<name>.gz". */
function readBytes(dir, name) {
  const plain = path.join(dir, name);
  if (fs.existsSync(plain)) return new Uint8Array(fs.readFileSync(plain));
  return require('pako').inflate(new Uint8Array(fs.readFileSync(`${plain}.gz`)));
}

function has(dir, name) {
  return Boolean(dir) && (fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, `${name}.gz`)));
}

/** false when the text data holds every file named, else why the test skips. */
function textDataSkip(...names) {
  if (!textDir) return 'set KITTEN_TTS_2_TINY_DATA to the text data folder (docs/development.md)';
  const missing = names.find(name => !has(textDir, name));
  return missing ? `${missing} missing in KITTEN_TTS_2_TINY_DATA (${textDir})` : false;
}

/** loadEnglishG2P's reader: en/... from the text data, g2p/... from the nano repository. */
function englishReader() {
  const nano = modelDir('kitten-tts-2-nano');
  const dirOf = name => (name.startsWith('g2p/') ? nano : textDir);
  return {
    text: async name => Buffer.from(readBytes(dirOf(name), name)).toString('utf8'),
    bytes: async name => readBytes(dirOf(name), name),
  };
}

// One cache folder per test run, removed at exit. With local model and text data folders
// nothing is downloaded into it.
let storageDirectory = null;

/** The web/Node platform. */
async function nodePlatform() {
  if (!storageDirectory) {
    storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt2tiny-'));
    process.on('exit', () => fs.rmSync(storageDirectory, { recursive: true, force: true }));
  }
  const { defaultTinyPlatform } = require('../../lib/tiny/platform.web');
  return defaultTinyPlatform({ storageDirectory });
}

module.exports = { textDir, modelDir, readBytes, has, textDataSkip, englishReader, nodePlatform };
