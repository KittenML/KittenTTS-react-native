import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  Image,
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Sound from 'react-native-sound';
import {
  KittenTTS,
  KittenModel,
  KittenVoice,
  KittenTTSResult,
  modelDisplayName,
  voiceDisplayName,
  ALL_VOICES,
  createRNSoundPlayer,
} from '@kittentts/react-native';

const LOGO = require('./assets/kittenml_logo.png');

type AppState =
  | {kind: 'idle'}
  | {kind: 'preparing'}
  | {kind: 'downloading'; progress: number}
  | {kind: 'generating'}
  | {kind: 'playing'}
  | {kind: 'error'; message: string};

const MODELS: KittenModel[] = [
  KittenModel.Nano,
  KittenModel.NanoInt8,
  KittenModel.Micro,
  KittenModel.Mini,
];

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export default function App() {
  const [tts, setTts] = useState<KittenTTS | null>(null);
  const ttsRef = useRef<KittenTTS | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<AppState>({kind: 'idle'});
  const [inputText, setInputText] = useState(
    'Hello! Welcome to KittenTTS, a fast on-device text-to-speech engine.',
  );
  const [selectedModel, setSelectedModel] = useState(KittenModel.Nano);
  const [selectedVoice, setSelectedVoice] = useState(KittenVoice.Bella);
  const [selectedSpeed, setSelectedSpeed] = useState(1.0);
  const [result, setResult] = useState<KittenTTSResult | null>(null);

  const isWorking =
    state.kind === 'preparing' ||
    state.kind === 'downloading' ||
    state.kind === 'generating' ||
    state.kind === 'playing';

  const initTTS = useCallback(async (model: KittenModel) => {
    try {
      await ttsRef.current?.dispose();
      setState({kind: 'preparing'});
      setResult(null);

      const instance = await KittenTTS.create(
        {model, player: createRNSoundPlayer(Sound)},
        (progress, info) => {
          if (mountedRef.current && info?.stage === 'downloading') {
            setState({
              kind: 'downloading',
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
      setState({kind: 'idle'});
    } catch (error: unknown) {
      ttsRef.current = null;
      if (mountedRef.current) {
        setTts(null);
        setState({
          kind: 'error',
          message: getErrorMessage(error, 'Init failed'),
        });
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    initTTS(selectedModel);
    return () => {
      mountedRef.current = false;
      // Fast Refresh can tear down the JS runtime while ONNX native objects are
      // still active, so avoid releasing the session during dev reloads.
      if (!__DEV__) {
        ttsRef.current?.dispose().catch(() => {});
      }
      ttsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!tts || !inputText.trim()) {
      return;
    }
    try {
      setState({kind: 'generating'});
      const res = await tts.generate(inputText, selectedVoice, selectedSpeed);
      setResult(res);
      setState({kind: 'idle'});
    } catch (error: unknown) {
      setState({
        kind: 'error',
        message: getErrorMessage(error, 'Generation failed'),
      });
    }
  }, [tts, inputText, selectedVoice, selectedSpeed]);

  const handleSpeak = useCallback(async () => {
    if (!tts || !inputText.trim()) {
      return;
    }
    try {
      setState({kind: 'playing'});
      const res = await tts.speak(inputText, selectedVoice, selectedSpeed);
      setResult(res);
      setState({kind: 'idle'});
    } catch (error: unknown) {
      setState({
        kind: 'error',
        message: getErrorMessage(error, 'Playback failed'),
      });
    }
  }, [tts, inputText, selectedVoice, selectedSpeed]);

  const handleModelChange = useCallback(
    (model: KittenModel) => {
      setSelectedModel(model);
      initTTS(model);
    },
    [initTTS],
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Image source={LOGO} style={styles.logoImage} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>KittenTTS Example</Text>
            <Text style={styles.subtitle}>
              Bare React Native example of the React Native SDK for KittenTTS
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
                {modelDisplayName(selectedModel)}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Text</Text>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              multiline
              numberOfLines={5}
              editable={!isWorking}
              placeholder="Enter something to speak"
              placeholderTextColor="#8D8D93"
            />
          </View>

          <OptionGroup
            label="Model"
            values={MODELS}
            selected={selectedModel}
            disabled={isWorking}
            getLabel={modelDisplayName}
            onSelect={handleModelChange}
          />

          <OptionGroup
            label="Voice"
            values={ALL_VOICES}
            selected={selectedVoice}
            disabled={isWorking}
            getLabel={voiceDisplayName}
            onSelect={setSelectedVoice}
          />

          <OptionGroup
            label={`Speed: ${speedLabel(selectedSpeed)}`}
            values={SPEED_OPTIONS}
            selected={selectedSpeed}
            disabled={isWorking}
            getLabel={speedLabel}
            onSelect={setSelectedSpeed}
          />

          <View style={styles.actionGroup}>
            <Text style={styles.actionGroupLabel}>Playback</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[
                  styles.button,
                  (isWorking || !inputText.trim() || !tts) && styles.disabled,
                ]}
                onPress={handleGenerate}
                disabled={isWorking || !inputText.trim() || !tts}>
                <Text style={styles.buttonText}>Generate</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.buttonPrimary,
                  (isWorking || !inputText.trim() || !tts) && styles.disabled,
                ]}
                onPress={handleSpeak}
                disabled={isWorking || !inputText.trim() || !tts}>
                <Text style={[styles.buttonText, styles.buttonPrimaryText]}>
                  Speak
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <StatusBanner state={state} />

          <Text style={styles.disclaimer}>
            This system is for demonstration purposes only and is not intended
            to process sensitive or personal data.
          </Text>

          {result && <ResultCard result={result} />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {values.map(value => {
          const active = value === selected;
          return (
            <TouchableOpacity
              key={String(value)}
              disabled={disabled}
              style={[
                styles.chip,
                active && styles.chipSelected,
                disabled && styles.disabled,
              ]}
              onPress={() => onSelect(value)}>
              <Text
                style={[styles.chipText, active && styles.chipTextSelected]}>
                {getLabel(value)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function statusSummary(state: AppState): string {
  switch (state.kind) {
    case 'idle':
      return 'Ready';
    case 'preparing':
      return 'Preparing';
    case 'downloading':
      return `${Math.round(state.progress * 100)}%`;
    case 'generating':
      return 'Generating';
    case 'playing':
      return 'Playing';
    case 'error':
      return 'Error';
  }
}

function speedLabel(speed: number) {
  return `${speed.toFixed(2).replace(/0$/, '')}x`;
}

function StatusBanner({state}: {state: AppState}) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'preparing':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#18181B" />
          <Text style={styles.bannerText}>
            Preparing model and phonemizer...
          </Text>
        </View>
      );
    case 'downloading':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#18181B" />
          <Text style={styles.bannerText}>
            Downloading ({Math.round(state.progress * 100)}%)
          </Text>
        </View>
      );
    case 'generating':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#18181B" />
          <Text style={styles.bannerText}>Generating audio...</Text>
        </View>
      );
    case 'playing':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#18181B" />
          <Text style={styles.bannerText}>Playing audio...</Text>
        </View>
      );
    case 'error':
      return (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerErrorText}>{state.message}</Text>
        </View>
      );
  }
}

function ResultCard({result}: {result: KittenTTSResult}) {
  return (
    <View style={styles.resultCard}>
      <Text style={styles.resultTitle}>Generated Audio</Text>
      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>Voice</Text>
        <Text style={styles.resultValue}>{voiceDisplayName(result.voice)}</Text>
      </View>
      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>Duration</Text>
        <Text style={styles.resultValue}>{result.duration.toFixed(2)}s</Text>
      </View>
      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>Samples</Text>
        <Text style={styles.resultValue}>
          {result.samples.length.toLocaleString()}
        </Text>
      </View>
      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>Sample Rate</Text>
        <Text style={styles.resultValue}>
          {result.sampleRate.toLocaleString()} Hz
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    alignSelf: 'center',
    maxWidth: 430,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    fontSize: 30,
    fontWeight: '700',
    color: '#09090B',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 16,
    color: '#71717A',
    lineHeight: 22,
    marginTop: 6,
  },
  demoCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.04,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
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
  section: {
    marginBottom: 18,
  },
  label: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    color: '#09090B',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 122,
    padding: 12,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  chipSelected: {
    backgroundColor: '#D4D4D8',
  },
  chipText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonPrimary: {
    backgroundColor: '#18181B',
  },
  buttonText: {
    color: '#09090B',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonPrimaryText: {
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.48,
  },
  disclaimer: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 16,
  },
  banner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  bannerText: {
    color: '#854D0E',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  bannerError: {
    alignItems: 'flex-start',
  },
  bannerErrorText: {
    color: '#B42318',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  resultCard: {
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
    gap: 12,
    justifyContent: 'space-between',
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
