import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import {StatusBar} from 'expo-status-bar';
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

const LOGO = require('./assets/kittenml_logo.png');

type WorkState =
  | {kind: 'booting'}
  | {kind: 'ready'}
  | {kind: 'preparing'}
  | {kind: 'loading'; progress: number}
  | {kind: 'generating'}
  | {kind: 'playing'}
  | {kind: 'error'; message: string};

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
  const [state, setState] = useState<WorkState>({kind: 'booting'});
  const [model, setModel] = useState(KittenModel.Nano);
  const [voice, setVoice] = useState(KittenVoice.Bella);
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState(
    'Hello from KittenTTS. This is running on device with Expo.',
  );
  const [result, setResult] = useState<KittenTTSResult | null>(null);
  const mountedRef = useRef(true);

  const busy =
    state.kind === 'booting' ||
    state.kind === 'preparing' ||
    state.kind === 'loading' ||
    state.kind === 'generating' ||
    state.kind === 'playing';
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);

  const loadModel = useCallback(
    async (nextModel: KittenModel) => {
      setState({kind: 'preparing'});
      setResult(null);

      try {
        await ttsRef.current?.dispose();
        const instance = await KittenTTS.create(
          {model: nextModel, player},
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
        setState({kind: 'ready'});
      } catch (error) {
        ttsRef.current = null;
        if (mountedRef.current) {
          setTts(null);
          setState({kind: 'error', message: friendlyError(error)});
        }
      }
    },
    [player],
  );

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

  const selectModel = useCallback(
    (nextModel: KittenModel) => {
      setModel(nextModel);
      loadModel(nextModel);
    },
    [loadModel],
  );

  const generate = useCallback(async () => {
    if (!tts || !text.trim()) return;
    setState({kind: 'generating'});
    try {
      const nextResult = await tts.generate(text, voice, speed);
      setResult(nextResult);
      setState({kind: 'ready'});
    } catch (error) {
      setState({kind: 'error', message: friendlyError(error)});
    }
  }, [speed, text, tts, voice]);

  const speak = useCallback(async () => {
    if (!tts || !text.trim()) return;
    setState({kind: 'playing'});
    try {
      const nextResult = await tts.speak(text, voice, speed);
      setResult(nextResult);
      setState({kind: 'ready'});
    } catch (error) {
      setState({kind: 'error', message: friendlyError(error)});
    }
  }, [speed, text, tts, voice]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Image source={LOGO} style={styles.logoImage} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>KittenTTS Example</Text>
            <Text style={styles.subtitle}>
              Expo example of the React Native SDK for KittenTTS
            </Text>
          </View>
        </View>

        <View style={styles.demoCard}>
          <View style={styles.modelRow}>
            <View style={styles.modelRowLeft}>
              <Text style={styles.modelRowLabel}>Model</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{statusSummary(state)}</Text>
              </View>
            </View>
            <View style={styles.softBadge}>
              <Text style={styles.softBadgeText}>
                {modelDisplayName(model)}
              </Text>
            </View>
          </View>

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
            label={`Speed: ${speedLabel(speed)}`}
            values={SPEEDS}
            selected={speed}
            disabled={busy}
            getLabel={speedLabel}
            onSelect={setSpeed}
          />

          <View style={styles.actionGroup}>
            <Text style={styles.actionGroupLabel}>Playback</Text>
            <View style={styles.actions}>
              <ActionButton
                label="Generate"
                disabled={busy || !tts || !text.trim()}
                onPress={generate}
              />
              <ActionButton
                label="Speak"
                primary
                disabled={busy || !tts || !text.trim()}
                onPress={speak}
              />
            </View>
          </View>

          <StatusPanel state={state} />

          <Text style={styles.disclaimer}>
            This system is for demonstration purposes only and is not intended
            to process sensitive or personal data.
          </Text>

          {result ? (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>Last Result</Text>
              <ResultRow label="Voice" value={voiceDisplayName(result.voice)} />
              <ResultRow
                label="Duration"
                value={`${result.duration.toFixed(2)}s`}
              />
              <ResultRow
                label="Samples"
                value={result.samples.length.toLocaleString()}
              />
              <ResultRow
                label="Sample rate"
                value={`${result.sampleRate.toLocaleString()} Hz`}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPanel({state}: {state: WorkState}) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'error') {
    return (
      <View style={[styles.status, styles.statusError]}>
        <Text style={styles.statusErrorText}>{state.message}</Text>
      </View>
    );
  }

  const text =
    state.kind === 'booting'
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
        {values.map(value => {
          const active = value === selected;
          return (
            <Pressable
              key={String(value)}
              style={[
                styles.option,
                active && styles.optionActive,
                disabled && styles.disabled,
              ]}
              disabled={disabled}
              onPress={() => onSelect(value)}>
              <Text
                style={[styles.optionText, active && styles.optionTextActive]}>
                {getLabel(value)}
              </Text>
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
      style={[
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}>
      <Text
        style={primary ? styles.buttonPrimaryText : styles.buttonSecondaryText}>
        {label}
      </Text>
    </Pressable>
  );
}

function ResultRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}

function statusSummary(state: WorkState): string {
  switch (state.kind) {
    case 'booting':
      return 'Booting';
    case 'ready':
      return 'Ready';
    case 'preparing':
      return 'Preparing';
    case 'loading':
      return `${Math.round(state.progress * 100)}%`;
    case 'generating':
      return 'Generating';
    case 'playing':
      return 'Playing';
    case 'error':
      return 'Error';
  }
}

function speedLabel(value: number): string {
  return `${value.toFixed(2).replace(/0$/, '')}x`;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('onnxruntime') ||
    lower.includes('react-native-fs') ||
    lower.includes('nativemodule')
  ) {
    return 'This example needs an Expo development build because it uses native inference and filesystem modules.';
  }
  if (
    lower.includes('download') ||
    lower.includes('network') ||
    lower.includes('http')
  ) {
    return 'Could not download the model assets. Check the network connection and try again.';
  }
  if (
    lower.includes('unable to resolve') ||
    lower.includes('cannot find module')
  ) {
    return 'The local KittenTTS package could not be loaded. Run npm install and restart Expo with a cleared cache.';
  }

  return message || 'Something went wrong.';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    alignSelf: 'center',
    maxWidth: 430,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 44 : 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginBottom: 20,
  },
  logoMark: {
    alignItems: 'center',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    width: 48,
  },
  logoImage: {
    height: 48,
    width: 48,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: '#09090B',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 32,
  },
  subtitle: {
    color: '#71717A',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 6,
  },
  demoCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  modelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  modelRowLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  modelRowLabel: {
    color: '#09090B',
    fontSize: 14,
    fontWeight: '600',
  },
  pill: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillText: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
  },
  softBadge: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  softBadgeText: {
    color: '#09090B',
    fontSize: 13,
    fontWeight: '700',
  },
  group: {
    marginBottom: 18,
  },
  label: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 8,
  },
  input: {
    minHeight: 122,
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    color: '#09090B',
    fontSize: 15,
    lineHeight: 22,
    padding: 12,
    textAlignVertical: 'top',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  optionActive: {
    backgroundColor: '#D4D4D8',
  },
  optionText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextActive: {
    color: '#09090B',
  },
  actionGroup: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    marginTop: 2,
    padding: 10,
  },
  actionGroupLabel: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#18181B',
  },
  buttonSecondary: {
    backgroundColor: '#FFFFFF',
  },
  buttonPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#09090B',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.48,
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  statusText: {
    color: '#854D0E',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  statusError: {
    alignItems: 'flex-start',
  },
  statusErrorText: {
    color: '#B42318',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  disclaimer: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 16,
  },
  result: {
    backgroundColor: '#FAFAFA',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 12,
  },
  resultTitle: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  resultLabel: {
    color: '#71717A',
    fontSize: 14,
  },
  resultValue: {
    color: '#09090B',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
});
