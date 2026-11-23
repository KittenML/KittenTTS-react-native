import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Sound from 'react-native-sound';
import {
  ALL_VOICES,
  KittenModel,
  KittenTTS,
  KittenTTS2,
  KittenTTS2Tiny,
  type KittenTTSResult,
  type KittenVoice,
  createRNSoundPlayer,
  modelDisplayName,
  voiceDisplayName,
} from '@kittentts/react-native';

// Three engines behind one KittenTTS.create(): the 0.8 models and Kitten TTS 2 Nano,
// Pico and Mini run on the device; Kitten TTS 2 (and Nano, Pico and Mini too, with
// a key) run on the Kitten API.
type Engine = 'onnx' | 'tiny' | 'cloud';
type AnyTTS = KittenTTS | KittenTTS2Tiny | KittenTTS2;

const ENGINES: { id: Engine; label: string }[] = [
  { id: 'onnx', label: '0.8' },
  { id: 'tiny', label: 'TTS 2 on device' },
  { id: 'cloud', label: 'TTS 2 cloud' },
];

const MODELS: Record<Engine, { id: string; label: string }[]> = {
  onnx: [KittenModel.Nano, KittenModel.NanoInt8, KittenModel.Micro, KittenModel.Mini]
    .map(id => ({ id, label: modelDisplayName(id) })),
  tiny: [
    { id: 'kitten-tts-2-nano', label: 'Nano' },
    { id: 'kitten-tts-2-pico', label: 'Pico' },
    { id: 'kitten-tts-2-mini', label: 'Mini' },
  ],
  cloud: [
    { id: 'kitten-tts-2', label: 'Kitten TTS 2' },
    { id: 'kitten-tts-2-mini', label: 'Mini' },
    { id: 'kitten-tts-2-nano', label: 'Nano' },
    { id: 'kitten-tts-2-pico', label: 'Pico' },
  ],
};

// For trying the cloud models, type a Kitten API key in the app. A key in an app can be
// extracted from it, so a shipped app sends requests to your own backend instead, which
// adds the key: set its URL here and no key is needed.
const ENV_API_KEY = '';
const ENV_BASE_URL = '';

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

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface Voice {
  id: string;
  label: string;
  language: string;
}

type WorkState =
  | { kind: 'idle'; message?: string }
  | { kind: 'ready' }
  | { kind: 'loading'; progress?: number }
  | { kind: 'generating' }
  | { kind: 'playing' }
  | { kind: 'error'; message: string };

interface LastResult {
  result: KittenTTSResult<string>;
  model: string;
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
  const [engine, setEngine] = useState<Engine>('onnx');
  const [model, setModel] = useState<string>(KittenModel.Nano);
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
  const player = useMemo(() => createRNSoundPlayer(Sound), []);

  const load = useCallback(async (nextEngine: Engine, nextModel: string, key: string) => {
    const loadId = ++loadIdRef.current;
    setLast(null);
    const previous = ttsRef.current;
    ttsRef.current = null;
    setTts(null);
    await previous?.dispose().catch(() => {});

    if (nextEngine === 'cloud' && !key && !ENV_BASE_URL) {
      setVoices([]);
      setState({ kind: 'idle', message: 'Enter a Kitten API key to use the cloud models.' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const onProgress = (progress: number, info?: { stage?: string }) => {
        if (mountedRef.current && loadId === loadIdRef.current) {
          setState({ kind: 'loading', progress: info?.stage === 'downloading' ? progress : undefined });
        }
      };
      const instance: AnyTTS = nextEngine === 'onnx'
        ? await KittenTTS.create({ model: nextModel as KittenModel, player }, onProgress)
        : nextEngine === 'tiny'
          ? await KittenTTS.create({ model: nextModel as 'kitten-tts-2-nano', player }, onProgress)
          : await KittenTTS.create({
            model: nextModel as 'kitten-tts-2',
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
    load(engine, model, apiKey);
    return () => {
      mountedRef.current = false;
      // Fast Refresh can tear down the JS runtime while ONNX native objects are
      // still active, so avoid releasing the session during dev reloads.
      if (!__DEV__) ttsRef.current?.dispose().catch(() => {});
      ttsRef.current = null;
    };
    // Load once on mount; the controls below load the next model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectEngine = (next: Engine) => {
    const nextModel = MODELS[next][0].id;
    setEngine(next);
    setModel(nextModel);
    load(next, nextModel, apiKey);
  };
  const selectModel = (next: string) => {
    setModel(next);
    load(engine, next, apiKey);
  };

  const languages = useMemo(() => Array.from(new Set(voices.map(v => v.language))), [voices]);
  const languageVoices = useMemo(() => voices.filter(v => v.language === language), [voices, language]);

  const selectLanguage = (next: string) => {
    // Swap the sample text too, unless it was edited.
    if (Object.values(SAMPLES).includes(text)) setText(SAMPLES[next] ?? text);
    setLanguage(next);
    setVoice(voices.find(v => v.language === next)?.id ?? '');
  };

  const run = useCallback(async (method: 'generate' | 'speak') => {
    if (!tts || !text.trim()) return;
    const chosen = voices.find(v => v.id === voice);
    setState({ kind: method === 'speak' ? 'playing' : 'generating' });
    const t0 = Date.now();
    try {
      const result = await say(tts, method, text, chosen, speed);
      setLast({ result, model, seconds: (Date.now() - t0) / 1000 });
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: friendlyError(error) });
    }
  }, [model, speed, text, tts, voice, voices]);

  const stop = useCallback(() => {
    tts?.stopSpeaking().catch(() => {});
  }, [tts]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>KittenTTS</Text>
          <Text style={styles.subtitle}>Text to speech on the device or in the cloud</Text>
        </View>

        <StatusPanel state={state} engine={engine} />

        <OptionGroup
          label="Engine"
          values={ENGINES.map(e => e.id)}
          selected={engine}
          disabled={busy}
          getLabel={id => ENGINES.find(e => e.id === id)!.label}
          onSelect={selectEngine}
        />

        <OptionGroup
          label="Model"
          values={MODELS[engine].map(m => m.id)}
          selected={model}
          disabled={busy}
          getLabel={id => MODELS[engine].find(m => m.id === id)!.label}
          onSelect={selectModel}
        />

        {engine === 'cloud' && !ENV_BASE_URL ? (
          <View style={styles.group}>
            <Text style={styles.label}>Kitten API key</Text>
            <View style={styles.keyRow}>
              <TextInput
                style={[styles.input, styles.keyInput]}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk_kitten_..."
                placeholderTextColor="#8D8D93"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!busy}
              />
              <ActionButton label="Connect" primary disabled={busy || !apiKey.trim()} onPress={() => load('cloud', model, apiKey.trim())} />
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.label}>Text</Text>
          <TextInput
            style={[styles.input, styles.textInput]}
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
            placeholder="Enter something to speak"
            placeholderTextColor="#8D8D93"
          />
        </View>

        {languages.length > 1 ? (
          <OptionGroup
            label="Language"
            values={languages}
            selected={language}
            disabled={busy}
            scroll={languages.length > 8}
            getLabel={code => code.toUpperCase()}
            onSelect={selectLanguage}
          />
        ) : null}

        {languageVoices.length > 0 ? (
          <OptionGroup
            label={`Voice (${languageVoices.length})`}
            values={languageVoices.map(v => v.id)}
            selected={voice}
            disabled={busy}
            scroll={languageVoices.length > 8}
            getLabel={id => voices.find(v => v.id === id)?.label ?? id}
            onSelect={setVoice}
          />
        ) : null}

        <OptionGroup
          label={`Speed: ${formatSpeed(speed)}`}
          values={SPEEDS}
          selected={speed}
          disabled={busy}
          getLabel={formatSpeed}
          onSelect={setSpeed}
        />

        <View style={styles.actions}>
          <ActionButton label="Generate" primary disabled={busy || !tts || !text.trim()} onPress={() => run('generate')} />
          {state.kind === 'playing'
            ? <ActionButton label="Stop" onPress={stop} />
            : <ActionButton label="Speak" disabled={busy || !tts || !text.trim()} onPress={() => run('speak')} />}
        </View>

        {last ? (
          <View style={styles.result}>
            <Text style={styles.resultTitle}>Last Result</Text>
            <ResultRow label="Model" value={last.model} />
            <ResultRow label="Voice" value={voices.find(v => v.id === last.result.voice)?.label ?? (last.result.voice || 'default')} />
            <ResultRow label="Duration" value={`${last.result.duration.toFixed(2)} s`} />
            <ResultRow label="Took" value={`${last.seconds.toFixed(2)} s`} />
            <ResultRow label="Real-time factor" value={(last.seconds / last.result.duration).toFixed(3)} />
            <ResultRow label="Sample rate" value={`${last.result.sampleRate.toLocaleString()} Hz`} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
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

/** generate() or speak() with the options each engine takes. */
function say(tts: AnyTTS, method: 'generate' | 'speak', text: string, voice: Voice | undefined, speed: number) {
  if (tts instanceof KittenTTS2Tiny) {
    return tts[method](text, { voice: voice?.id, language: voice?.language, speed });
  }
  if (tts instanceof KittenTTS2) {
    return tts[method](text, { voice: voice?.id, speed });
  }
  return tts[method](text, voice?.id as KittenVoice | undefined, speed);
}

function formatSpeed(value: number): string {
  return `${value}x`;
}

function StatusPanel({ state, engine }: { state: WorkState; engine: Engine }) {
  if (state.kind === 'ready') return null;
  if (state.kind === 'error' || state.kind === 'idle') {
    if (!state.message) return null;
    return (
      <View style={[styles.status, state.kind === 'error' && styles.statusError]}>
        <Text style={state.kind === 'error' ? styles.statusErrorText : styles.statusText}>{state.message}</Text>
      </View>
    );
  }
  const text = state.kind === 'loading'
    ? state.progress !== undefined
      ? `Downloading the model... ${Math.round(state.progress * 100)}%`
      : engine === 'cloud' ? 'Connecting...' : 'Loading the model...'
    : state.kind === 'generating'
      ? 'Generating audio...'
      : 'Speaking...';
  return (
    <View style={styles.status}>
      <ActivityIndicator color="#007AFF" />
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

function OptionGroup<T extends string | number>({
  label,
  values,
  selected,
  disabled,
  scroll = false,
  getLabel,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  selected: T;
  disabled: boolean;
  /** One row that scrolls sideways, for long lists such as the cloud's voices. */
  scroll?: boolean;
  getLabel: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  const options = values.map(value => {
    const active = value === selected;
    return (
      <Pressable
        key={String(value)}
        style={[styles.option, active && styles.optionActive, disabled && styles.disabled]}
        disabled={disabled}
        onPress={() => onSelect(value)}
      >
        <Text style={[styles.optionText, active && styles.optionTextActive]}>{getLabel(value)}</Text>
      </Pressable>
    );
  });
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsRow}>
          {options}
        </ScrollView>
      ) : (
        <View style={styles.options}>{options}</View>
      )}
    </View>
  );
}

function ActionButton({
  label,
  primary,
  disabled = false,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={primary ? styles.buttonPrimaryText : styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('onnxruntime') || lower.includes('react-native-fs') || lower.includes('nativemodule')) {
    return 'A native module is missing. Run npm install, then pod install in ios/, and rebuild the app.';
  }
  if (lower.includes('unable to resolve') || lower.includes('cannot find module')) {
    return 'The KittenTTS package could not be loaded. Run npm install and restart Metro with npm run start:reset.';
  }
  return message || 'Something went wrong.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F5F8' },
  content: { padding: 20, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 24 },
  title: { color: '#111111', fontSize: 34, fontWeight: '800' },
  subtitle: { color: '#6F7178', fontSize: 16, marginTop: 4, textAlign: 'center' },
  group: { marginBottom: 18 },
  label: {
    color: '#6D6F76',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    color: '#15171A',
    fontSize: 17,
    padding: 14,
  },
  textInput: { minHeight: 110, lineHeight: 24, textAlignVertical: 'top' },
  keyRow: { flexDirection: 'row', gap: 10 },
  keyInput: { flex: 2 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionsRow: { flexDirection: 'row', gap: 10 },
  option: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#DADCE2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  optionActive: { borderColor: '#007AFF', backgroundColor: '#007AFF' },
  optionText: { color: '#2B2D33', fontSize: 16, fontWeight: '600' },
  optionTextActive: { color: '#FFFFFF' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 18 },
  button: {
    flex: 1,
    minHeight: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: '#007AFF' },
  buttonSecondary: { backgroundColor: '#FFFFFF', borderColor: '#007AFF', borderWidth: 1 },
  buttonPrimaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  buttonSecondaryText: { color: '#007AFF', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  status: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: '#EAF2FF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 18,
  },
  statusText: { color: '#0B63CE', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  statusError: { backgroundColor: '#FFF0F0' },
  statusErrorText: { color: '#D93025', fontSize: 15, fontWeight: '600', lineHeight: 21, flexShrink: 1 },
  result: { borderRadius: 8, backgroundColor: '#FFFFFF', padding: 16 },
  resultTitle: { color: '#1F8F4D', fontSize: 17, fontWeight: '800', marginBottom: 10 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 5 },
  resultLabel: { color: '#6F7178', fontSize: 15 },
  resultValue: { color: '#15171A', flexShrink: 1, fontSize: 15, fontWeight: '700', textAlign: 'right' },
});
