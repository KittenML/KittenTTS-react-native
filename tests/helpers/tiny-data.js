// Local data for the Kitten TTS 2 nano / pico / mini tests, without network:
//   KITTEN_TTS_2_TINY_DATA    the text data folder as hosted (build_text_pack.py: en/, espeak-ng-data/,
//                             manifest.json; big files gzipped as "<name>.gz")
//   KITTEN_TTS_2_TINY_MODELS  a folder holding kitten-tts-2-nano/, -pico/, -mini/ laid out like the
//                             Hugging Face repositories (default: the Hugging Face cache)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const textDir = process.env.KITTEN_TTS_2_TINY_DATA || null;

function modelDir(name) {
  if (process.env.KITTEN_TTS_2_TINY_MODELS) {
    const d = path.join(process.env.KITTEN_TTS_2_TINY_MODELS, name);
    return fs.existsSync(d) ? d : null;
  }
  const snaps = path.join(os.homedir(), '.cache', 'huggingface', 'hub', `models--KittenML--${name}`, 'snapshots');
  if (!fs.existsSync(snaps)) return null;
  const revs = fs.readdirSync(snaps);
  return revs.length ? path.join(snaps, revs[0]) : null;
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

/** loadEnglishG2P's reader: en/... from the text data, g2p/... from the nano repository. */
function englishReader() {
  const nano = modelDir('kitten-tts-2-nano');
  const dirOf = name => (name.startsWith('g2p/') ? nano : textDir);
  return {
    text: async name => Buffer.from(readBytes(dirOf(name), name)).toString('utf8'),
    bytes: async name => readBytes(dirOf(name), name),
  };
}

/** The web/Node platform with a throwaway cache folder (the local folders bypass it). */
async function nodePlatform() {
  const { defaultTinyPlatform } = require('../../lib/tiny/platform.web');
  return defaultTinyPlatform({ storageDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'kt2tiny-')) });
}

module.exports = { textDir, modelDir, readBytes, has, englishReader, nodePlatform };
