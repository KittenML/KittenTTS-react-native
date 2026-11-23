import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ExpoAudio from 'expo-audio';
import {
  ALL_VOICES,
  KittenModel,
  KittenTTS,
  KittenTTS2,
  KittenTTS2Tiny,
  type KittenTTSResult,
  type KittenVoice,
  approximateDownloadBytes,
  createBrowserAudioPlayer,
  createExpoAudioPlayer,
  modelDisplayName,
  voiceDisplayName,
} from '@kittentts/react-native';
import {
  Button,
  Card,
  Field,
  Input,
  Muted,
  Row,
  Screen,
  Segmented,
  Select,
  Stats,
  Status,
  TextArea,
  type SelectGroup,
} from './components/ui';

// One KittenTTS.create() for every model; the model decides where it runs:
// Kitten TTS 2 Nano, Pico and Mini and the 0.8 models on the device, Kitten TTS 2
// Cloud (and Nano, Pico and Mini, with a key) on the Kitten API.
type Engine = 'tiny' | 'onnx' | 'cloud';
type AnyTTS = KittenTTS | KittenTTS2Tiny | KittenTTS2;

interface Model {
  id: string;
  engine: Engine;
  label: string;
  description: string;
}

const mb = (model: KittenModel) => `${Math.round(approximateDownloadBytes(model) / 1e6)} MB`;

const MODELS: Model[] = [
  { id: 'kitten-tts-2-nano', engine: 'tiny', label: 'Kitten TTS 2 Nano', description: '8 languages' },
  { id: 'kitten-tts-2-pico', engine: 'tiny', label: 'Kitten TTS 2 Pico', description: '8 languages, the fastest' },
  { id: 'kitten-tts-2-mini', engine: 'tiny', label: 'Kitten TTS 2 Mini', description: '16 languages, the best on device' },
  ...[KittenModel.NanoInt8, KittenModel.Nano, KittenModel.Micro, KittenModel.Mini].map(id => ({
    id,
    engine: 'onnx' as const,
    label: `Kitten TTS 0.8 ${modelDisplayName(id)}`,
    description: `English, ${mb(id)}`,
  })),
  { id: 'kitten-tts-2-cloud', engine: 'cloud', label: 'Kitten TTS 2 Cloud', description: '20+ languages, voice cloning' },
  { id: 'kitten-tts-2-nano', engine: 'cloud', label: 'Kitten TTS 2 Nano', description: 'In the cloud' },
  { id: 'kitten-tts-2-pico', engine: 'cloud', label: 'Kitten TTS 2 Pico', description: 'In the cloud' },
  { id: 'kitten-tts-2-mini', engine: 'cloud', label: 'Kitten TTS 2 Mini', description: 'In the cloud' },
];
const keyOf = (m: Model) => `${m.engine}:${m.id}`;
const MODEL_GROUPS: SelectGroup<string>[] = [
  { title: 'On this device', engine: 'tiny' },
  { title: 'On this device: Kitten TTS 0.8 (English)', engine: 'onnx' },
  { title: 'Cloud: Kitten API (needs a key)', engine: 'cloud' },
].map(g => ({
  title: g.title,
  options: MODELS.filter(m => m.engine === g.engine).map(m => ({ value: keyOf(m), label: m.label, description: m.description })),
}));

// For the cloud models: put EXPO_PUBLIC_KITTENML_API_KEY in .env, or type the key in
// the app. A key in an app can be extracted from it, so a shipped app sends requests
// to your own backend instead (EXPO_PUBLIC_KITTENML_BASE_URL), which adds it.
const ENV_API_KEY = process.env.EXPO_PUBLIC_KITTENML_API_KEY ?? '';
const ENV_BASE_URL = process.env.EXPO_PUBLIC_KITTENML_BASE_URL ?? '';

const SAMPLES: Record<string, string> = {
  en: 'Hello from KittenTTS. This voice was made on demand.',
  de: 'Guten Morgen! Wie geht es dir heute?',
  fr: "Bonjour, je m'appelle Marie et j'habite à Paris.",
  es: 'Hola, ¿cómo estás? Hoy hace buen tiempo.',
  it: 'Buongiorno, come stai oggi?',
  pt: 'Olá, tudo bem? Hoje está um dia bonito.',
  ru: 'Привет, как дела? Сегодня хорошая погода.',
  hi: 'नमस्ते, आप कैसे हैं? आज मौसम अच्छा है।',
  ja: '今日はいい天気ですね。散歩に行きましょう。',
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', hi: 'Hindi', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ar: 'Arabic',
  he: 'Hebrew', fi: 'Finnish', da: 'Danish', sv: 'Swedish', nl: 'Dutch', tr: 'Turkish',
  pl: 'Polish', id: 'Indonesian', sw: 'Swahili',
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2].map(v => ({ value: v, label: `${v}×` }));

interface Voice {
  id: string;
  label: string;
  language: string;
}

type WorkState =
  | { kind: 'idle'; message?: string }
  | { kind: 'ready' }
  | { kind: 'loading'; progress?: number }
  | { kind: 'generating'; andPlay: boolean }
  | { kind: 'playing' }
  | { kind: 'error'; message: string };

interface LastResult {
  result: KittenTTSResult<string>;
  seconds: number;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Demo />
    </SafeAreaProvider>
  );
}

function Demo() {
  const [model, setModel] = useState<Model>(MODELS[0]);
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [tts, setTts] = useState<AnyTTS | null>(null);
  const ttsRef = useRef<AnyTTS | null>(null);
  const [state, setState] = useState<WorkState>({ kind: 'loading' });
  const [voices, setVoices] = useState<Voice[]>([]);
  const [language, setLanguage] = useState('en');
  const [voice, setVoice] = useState<string>('');
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState(SAMPLES.en);
  const [last, setLast] = useState<LastResult | null>(null);
  const mountedRef = useRef(true);
  const loadIdRef = useRef(0);

  const busy = state.kind === 'loading' || state.kind === 'generating' || state.kind === 'playing';
  // expo-audio on iOS and Android; an audio element in a browser.
  const player = useMemo(
    () => (Platform.OS === 'web' ? createBrowserAudioPlayer() : createExpoAudioPlayer(ExpoAudio)),
    [],
  );

  const load = useCallback(async (next: Model, key: string) => {
    const loadId = ++loadIdRef.current;
    setLast(null);
    const previous = ttsRef.current;
    ttsRef.current = null;
    setTts(null);
    await previous?.dispose().catch(() => {});

    if (next.engine === 'cloud' && !key && !ENV_BASE_URL) {
      setVoices([]);
      setState({ kind: 'idle', message: 'Add a Kitten API key to use the cloud models.' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const onProgress = (progress: number, info?: { stage?: string }) => {
        if (mountedRef.current && loadId === loadIdRef.current) {
          setState({ kind: 'loading', progress: info?.stage === 'downloading' ? progress : undefined });
        }
      };
      const instance: AnyTTS = next.engine === 'onnx'
        ? await KittenTTS.create({ model: next.id as KittenModel, player }, onProgress)
        : next.engine === 'tiny'
          ? await KittenTTS.create({ model: next.id as 'kitten-tts-2-nano', player }, onProgress)
          : await KittenTTS.create({
            model: next.id as 'kitten-tts-2-cloud',
            ...(ENV_BASE_URL ? { baseUrl: ENV_BASE_URL } : { apiKey: key }),
            player,
          });
      if (!mountedRef.current || loadId !== loadIdRef.current) {
        await instance.dispose();
        return;
      }
      const list = voicesOf(instance);
      ttsRef.current = instance;
      setTts(instance);
      setVoices(list);
      const first = list.find(v => v.language === language) ?? list[0];
      setLanguage(first?.language ?? 'en');
      setVoice(first?.id ?? '');
      setState({ kind: 'ready' });
    } catch (error) {
      if (mountedRef.current && loadId === loadIdRef.current) {
        setVoices([]);
        setState({ kind: 'error', message: friendlyError(error) });
      }
    }
  }, [language, player]);

  useEffect(() => {
    mountedRef.current = true;
    load(model, apiKey);
    return () => {
      mountedRef.current = false;
      // Fast Refresh can tear down the JS runtime while ONNX native objects are
      // still active, so avoid releasing the session during dev reloads.
      if (!__DEV__) ttsRef.current?.dispose().catch(() => {});
      ttsRef.current = null;
    };
    // Load once on mount; picking a model loads the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectModel = (key: string) => {
    const next = MODELS.find(m => keyOf(m) === key)!;
    setModel(next);
    load(next, apiKey);
  };

  const languages = useMemo(() => Array.from(new Set(voices.map(v => v.language))), [voices]);
  const languageVoices = useMemo(() => voices.filter(v => v.language === language), [voices, language]);

  const selectLanguage = (next: string) => {
    // Swap the sample text too, unless it was edited.
    if (Object.values(SAMPLES).includes(text)) setText(SAMPLES[next] ?? text);
    setLanguage(next);
    setVoice(voices.find(v => v.language === next)?.id ?? '');
  };

  // Generate, then play when speaking: the timing then counts only the generation.
  const run = useCallback(async (andPlay: boolean) => {
    if (!tts || !text.trim()) return;
    const chosen = voices.find(v => v.id === voice);
    setState({ kind: 'generating', andPlay });
    const t0 = Date.now();
    try {
      const result = await generate(tts, text, chosen, speed);
      setLast({ result, seconds: (Date.now() - t0) / 1000 });
      if (andPlay) {
        setState({ kind: 'playing' });
        await tts.play(result);
      }
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: friendlyError(error) });
    }
  }, [speed, text, tts, voice, voices]);

  const stop = useCallback(() => {
    tts?.stopSpeaking().catch(() => {});
  }, [tts]);

  const needsKey = model.engine === 'cloud' && !ENV_BASE_URL;
  const canRun = !busy && !!tts && !!text.trim();

  return (
    <Screen
      title="Text to speech"
      description="Pick a model, type something, and listen. On-device models work offline once downloaded."
      badge={Platform.OS === 'web' ? 'Web' : 'Expo'}
    >
      <Card>
        <Field label="Model">
          <Select title="Model" value={keyOf(model)} groups={MODEL_GROUPS} onChange={selectModel} disabled={busy} />
        </Field>
        {needsKey ? (
          <Field label="Kitten API key" hint="Each cloud generation is billed to your KittenML account.">
            <Row>
              <Input
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk_kitten_..."
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!busy}
                style={{ flex: 1 }}
              />
              <Button title="Connect" variant="outline" disabled={busy || !apiKey.trim()} onPress={() => load(model, apiKey.trim())} style={{ flex: 0 }} />
            </Row>
          </Field>
        ) : null}
        <ModelStatus state={state} engine={model.engine} />
      </Card>

      <Card>
        <Field label="Text">
          <TextArea value={text} onChangeText={setText} editable={!busy} placeholder="Type something to say" />
        </Field>
        {languageVoices.length > 0 ? (
          <Row>
            {languages.length > 1 ? (
              <Field label="Language" style={{ flex: 1 }}>
                <Select
                  title="Language"
                  value={language}
                  groups={[{ options: languages.map(code => ({ value: code, label: LANGUAGE_NAMES[code] ?? code.toUpperCase() })) }]}
                  onChange={selectLanguage}
                  disabled={busy}
                />
              </Field>
            ) : null}
            <Field label="Voice" style={{ flex: 1 }}>
              <Select
                title={`Voice (${languageVoices.length})`}
                value={voice}
                groups={[{ options: languageVoices.map(v => ({ value: v.id, label: v.label })) }]}
                onChange={setVoice}
                disabled={busy}
              />
            </Field>
          </Row>
        ) : null}
        <Field label="Speed">
          <Segmented value={speed} options={SPEEDS} onChange={setSpeed} disabled={busy} />
        </Field>
        <Row>
          {state.kind === 'playing'
            ? <Button title="Stop" icon="stop" onPress={stop} />
            : <Button title="Speak" icon="play" loading={state.kind === 'generating' && state.andPlay} disabled={!canRun} onPress={() => run(true)} />}
          <Button
            title="Generate"
            variant="outline"
            loading={state.kind === 'generating' && !state.andPlay}
            disabled={!canRun}
            onPress={() => run(false)}
          />
        </Row>
      </Card>

      {last ? (
        <Card title="Result">
          <Stats
            items={[
              { label: 'Audio', value: `${last.result.duration.toFixed(2)} s` },
              { label: 'Took', value: `${last.seconds.toFixed(2)} s` },
              { label: 'Than real time', value: pace(last.result.duration / last.seconds) },
            ]}
          />
          <Muted>
            {voices.find(v => v.id === last.result.voice)?.label ?? (last.result.voice || 'Default voice')}
            {' · '}
            {(last.result.sampleRate / 1000).toFixed(0)} kHz
          </Muted>
        </Card>
      ) : null}
    </Screen>
  );
}

function ModelStatus({ state, engine }: { state: WorkState; engine: Engine }) {
  switch (state.kind) {
    case 'loading':
      return state.progress !== undefined
        ? <Status kind="loading" text={`Downloading the model, ${Math.round(state.progress * 100)}%`} progress={state.progress} />
        : <Status kind="loading" text={engine === 'cloud' ? 'Connecting...' : 'Loading the model...'} />;
    case 'error':
      return <Status kind="error" text={state.message} />;
    case 'idle':
      return state.message ? <Status kind="note" text={state.message} /> : null;
    case 'generating':
      return <Status kind="loading" text="Generating..." />;
    case 'playing':
      return <Status kind="loading" text="Speaking..." />;
    default:
      return <Status kind="ready" text={engine === 'cloud' ? 'Connected' : 'Ready, on this device'} />;
  }
}

/** The voices an instance offers, in one shape for the picker. */
function voicesOf(tts: AnyTTS): Voice[] {
  if (tts instanceof KittenTTS2Tiny) {
    return tts.voices().map(v => ({ id: v.name, label: v.name, language: v.language }));
  }
  if (tts instanceof KittenTTS2) {
    // Built-in voices are named like "Frank — Reserved Announcer"; saved voices come first.
    return tts.voices.map(v => ({ id: v.id, label: v.name.split(' — ')[0], language: v.language }));
  }
  return ALL_VOICES.map(v => ({ id: v, label: voiceDisplayName(v), language: 'en' }));
}

/** generate() with the options each engine takes. */
function generate(tts: AnyTTS, text: string, voice: Voice | undefined, speed: number): Promise<KittenTTSResult<string>> {
  if (tts instanceof KittenTTS2Tiny) {
    return tts.generate(text, { voice: voice?.id, language: voice?.language, speed });
  }
  if (tts instanceof KittenTTS2) {
    return tts.generate(text, { voice: voice?.id, speed });
  }
  return tts.generate(text, voice?.id as KittenVoice | undefined, speed);
}

/** How much faster than playback the audio was made: "4.2× faster" or "1.3× slower". */
function pace(ratio: number): string {
  return ratio >= 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('onnxruntime') || lower.includes('react-native-fs') || lower.includes('nativemodule')) {
    return 'This example needs an Expo development build because it uses native inference and filesystem modules.';
  }
  if (lower.includes('unable to resolve') || lower.includes('cannot find module')) {
    return 'The KittenTTS package could not be loaded. Run npm install and restart Expo with a cleared cache.';
  }
  return message || 'Something went wrong.';
}
