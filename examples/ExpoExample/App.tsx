import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ExpoAudio from 'expo-audio';
import {
  ALL_VOICES,
  KittenModel,
  KittenTTS,
  KittenTTSResult,
  KittenVoice,
  createExpoAudioPlayer,
  modelDisplayName,
  voiceDisplayName,
} from '@kittentts/react-native';

type WorkState =
  | { kind: 'booting' }
  | { kind: 'ready' }
  | { kind: 'preparing' }
  | { kind: 'loading'; progress: number }
  | { kind: 'generating' }
  | { kind: 'playing' }
  | { kind: 'error'; message: string };

const MODELS = [
  KittenModel.Nano,
  KittenModel.NanoInt8,
  KittenModel.Micro,
  KittenModel.Mini,
];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function App() {
  const [tts, setTts] = useState<KittenTTS | null>(null);
  const ttsRef = useRef<KittenTTS | null>(null);
  const [state, setState] = useState<WorkState>({ kind: 'booting' });
  const [model, setModel] = useState(KittenModel.Nano);
  const [voice, setVoice] = useState(KittenVoice.Bella);
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState('Hello from KittenTTS. This is running on device with Expo.');
  const [result, setResult] = useState<KittenTTSResult | null>(null);
  const mountedRef = useRef(true);

  const busy = state.kind === 'booting' || state.kind === 'preparing' || state.kind === 'loading' || state.kind === 'generating' || state.kind === 'playing';
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);

  const loadModel = useCallback(async (nextModel: KittenModel) => {
    setState({ kind: 'preparing' });
    setResult(null);

    try {
      await ttsRef.current?.dispose();
      const instance = await KittenTTS.create(
        { model: nextModel, player },
        (progress, info) => {
          if (mountedRef.current && info?.stage === 'downloading') {
            setState({
              kind: 'loading',
              progress,
            });
          }
        },
      );
      if (!mountedRef.current) {
        if (!__DEV__) await instance.dispose();
        return;
      }
      ttsRef.current = instance;
      setTts(instance);
      setState({ kind: 'ready' });
    } catch (error) {
      ttsRef.current = null;
      if (mountedRef.current) {
        setTts(null);
        setState({ kind: 'error', message: friendlyError(error) });
      }
    }
  }, [player]);

  useEffect(() => {
    mountedRef.current = true;
    loadModel(model);
    return () => {
      mountedRef.current = false;
      // Fast Refresh can tear down the JS runtime while ONNX native objects are
      // still active, so avoid releasing the session during dev reloads.
      if (!__DEV__) {
        ttsRef.current?.dispose().catch(() => {});
      }
      ttsRef.current = null;
    };
    // Load once on mount. Model changes are handled by the model control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectModel = useCallback((nextModel: KittenModel) => {
    setModel(nextModel);
    loadModel(nextModel);
  }, [loadModel]);

  const generate = useCallback(async () => {
    if (!tts || !text.trim()) return;
    setState({ kind: 'generating' });
    try {
      const nextResult = await tts.generate(text, voice, speed);
      setResult(nextResult);
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: friendlyError(error) });
    }
  }, [speed, text, tts, voice]);

  const speak = useCallback(async () => {
    if (!tts || !text.trim()) return;
    setState({ kind: 'playing' });
    try {
      const nextResult = await tts.speak(text, voice, speed);
      setResult(nextResult);
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: friendlyError(error) });
    }
  }, [speed, text, tts, voice]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>KittenTTS</Text>
          <Text style={styles.subtitle}>Expo on-device text to speech</Text>
        </View>

        <StatusPanel state={state} />

        <View style={styles.group}>
          <Text style={styles.label}>Text</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
            placeholder="Enter something to speak"
            placeholderTextColor="#8D8D93"
          />
        </View>

        <OptionGroup
          label="Model"
          values={MODELS}
          selected={model}
          disabled={busy}
          getLabel={modelDisplayName}
          onSelect={selectModel}
        />

        <OptionGroup
          label="Voice"
          values={ALL_VOICES}
          selected={voice}
          disabled={busy}
          getLabel={voiceDisplayName}
          onSelect={setVoice}
        />

        <OptionGroup
          label={`Speed: ${speed.toFixed(2).replace(/0$/, '')}x`}
          values={SPEEDS}
          selected={speed}
          disabled={busy}
          getLabel={(value) => `${value.toFixed(2).replace(/0$/, '')}x`}
          onSelect={setSpeed}
        />

        <View style={styles.actions}>
          <ActionButton label="Generate" primary disabled={busy || !tts || !text.trim()} onPress={generate} />
          <ActionButton label="Speak" disabled={busy || !tts || !text.trim()} onPress={speak} />
        </View>

        {result ? (
          <View style={styles.result}>
            <Text style={styles.resultTitle}>Last Result</Text>
            <ResultRow label="Voice" value={voiceDisplayName(result.voice)} />
            <ResultRow label="Duration" value={`${result.duration.toFixed(2)}s`} />
            <ResultRow label="Samples" value={result.samples.length.toLocaleString()} />
            <ResultRow label="Sample rate" value={`${result.sampleRate.toLocaleString()} Hz`} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPanel({ state }: { state: WorkState }) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'error') {
    return (
      <View style={[styles.status, styles.statusError]}>
        <Text style={styles.statusErrorText}>{state.message}</Text>
      </View>
    );
  }

  const text = state.kind === 'booting'
    ? 'Preparing...'
    : state.kind === 'preparing'
      ? 'Preparing assets...'
    : state.kind === 'loading'
      ? `Downloading assets... ${Math.round(state.progress * 100)}%`
      : state.kind === 'generating'
        ? 'Generating audio...'
        : 'Playing audio...';

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
  getLabel,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  selected: T;
  disabled: boolean;
  getLabel: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>
        {values.map((value) => {
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
        })}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  primary,
  disabled,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled: boolean;
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
    return 'This example needs an Expo development build because it uses native inference and filesystem modules.';
  }
  if (lower.includes('download') || lower.includes('network') || lower.includes('http')) {
    return 'Could not download the model assets. Check the network connection and try again.';
  }
  if (lower.includes('unable to resolve') || lower.includes('cannot find module')) {
    return 'The local KittenTTS package could not be loaded. Run npm install and restart Expo with a cleared cache.';
  }

  return message || 'Something went wrong.';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F5F8',
  },
  content: {
    padding: 20,
    paddingTop: Platform.OS === 'android' ? 44 : 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#111111',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#6F7178',
    fontSize: 17,
    marginTop: 4,
  },
  group: {
    marginBottom: 18,
  },
  label: {
    color: '#6D6F76',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 120,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    color: '#15171A',
    fontSize: 18,
    lineHeight: 25,
    padding: 16,
    textAlignVertical: 'top',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#DADCE2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  optionActive: {
    borderColor: '#007AFF',
    backgroundColor: '#007AFF',
  },
  optionText: {
    color: '#2B2D33',
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextActive: {
    color: '#FFFFFF',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 18,
  },
  button: {
    flex: 1,
    minHeight: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#007AFF',
  },
  buttonSecondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#007AFF',
    borderWidth: 1,
  },
  buttonPrimaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#007AFF',
    fontSize: 17,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  status: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: '#EAF2FF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  statusText: {
    color: '#0B63CE',
    fontSize: 15,
    fontWeight: '600',
  },
  statusError: {
    backgroundColor: '#FFF0F0',
  },
  statusErrorText: {
    color: '#D93025',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  result: {
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  resultTitle: {
    color: '#1F8F4D',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 5,
  },
  resultLabel: {
    color: '#6F7178',
    fontSize: 15,
  },
  resultValue: {
    color: '#15171A',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
});
