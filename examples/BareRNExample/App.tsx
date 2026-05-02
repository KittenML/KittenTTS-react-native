import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
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

  const initTTS = useCallback(
    async (model: KittenModel) => {
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
          setState({kind: 'error', message: getErrorMessage(error, 'Init failed')});
        }
      }
    },
    [],
  );

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
      setState({kind: 'error', message: getErrorMessage(error, 'Generation failed')});
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
      setState({kind: 'error', message: getErrorMessage(error, 'Playback failed')});
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
        <Text style={styles.title}>KittenTTS</Text>
        <Text style={styles.subtitle}>On-Device Text-to-Speech</Text>

        <StatusBanner state={state} />

        {/* Text Input */}
        <View style={styles.section}>
          <Text style={styles.label}>Text</Text>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            multiline
            numberOfLines={4}
            editable={!isWorking}
            placeholder="Enter text to synthesise..."
            placeholderTextColor="#999"
          />
        </View>

        {/* Model Picker */}
        <View style={styles.section}>
          <Text style={styles.label}>Model</Text>
          <View style={styles.chipRow}>
            {MODELS.map(model => (
              <TouchableOpacity
                key={model}
                style={[
                  styles.chip,
                  selectedModel === model && styles.chipSelected,
                ]}
                onPress={() => handleModelChange(model)}
                disabled={isWorking}>
                <Text
                  style={[
                    styles.chipText,
                    selectedModel === model && styles.chipTextSelected,
                  ]}>
                  {modelDisplayName(model)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Voice Picker */}
        <View style={styles.section}>
          <Text style={styles.label}>Voice</Text>
          <View style={styles.chipRow}>
            {ALL_VOICES.map(voice => (
              <TouchableOpacity
                key={voice}
                style={[
                  styles.chip,
                  selectedVoice === voice && styles.chipSelected,
                ]}
                onPress={() => setSelectedVoice(voice)}
                disabled={isWorking}>
                <Text
                  style={[
                    styles.chipText,
                    selectedVoice === voice && styles.chipTextSelected,
                  ]}>
                  {voiceDisplayName(voice)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Speed Picker */}
        <View style={styles.section}>
          <Text style={styles.label}>Speed: {selectedSpeed.toFixed(1)}x</Text>
          <View style={styles.chipRow}>
            {SPEED_OPTIONS.map(speed => (
              <TouchableOpacity
                key={speed}
                style={[
                  styles.chip,
                  selectedSpeed === speed && styles.chipSelected,
                ]}
                onPress={() => setSelectedSpeed(speed)}
                disabled={isWorking}>
                <Text
                  style={[
                    styles.chipText,
                    selectedSpeed === speed && styles.chipTextSelected,
                  ]}>
                  {speed.toFixed(1)}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.buttonPrimary,
              (isWorking || !inputText.trim() || !tts) && styles.buttonDisabled,
            ]}
            onPress={handleGenerate}
            disabled={isWorking || !inputText.trim() || !tts}>
            <Text style={styles.buttonPrimaryText}>Generate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.buttonSecondary,
              (isWorking || !inputText.trim() || !tts) && styles.buttonDisabled,
            ]}
            onPress={handleSpeak}
            disabled={isWorking || !inputText.trim() || !tts}>
            <Text style={styles.buttonSecondaryText}>Speak</Text>
          </TouchableOpacity>
        </View>

        {/* Result Card */}
        {result && <ResultCard result={result} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StatusBanner({state}: {state: AppState}) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'preparing':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.bannerText}>Preparing model...</Text>
        </View>
      );
    case 'downloading':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.bannerText}>
            Downloading model... {Math.round(state.progress * 100)}%
          </Text>
        </View>
      );
    case 'generating':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.bannerText}>Generating speech...</Text>
        </View>
      );
    case 'playing':
      return (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.bannerText}>Playing...</Text>
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
        <Text style={styles.resultValue}>
          {voiceDisplayName(result.voice)}
        </Text>
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
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#000',
    minHeight: 100,
    textAlignVertical: 'top',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  chipSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  chipTextSelected: {
    color: '#FFF',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#007AFF',
  },
  buttonSecondary: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPrimaryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F4FF',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 10,
  },
  bannerText: {
    fontSize: 14,
    color: '#007AFF',
  },
  bannerError: {
    backgroundColor: '#FFF0F0',
  },
  bannerErrorText: {
    fontSize: 14,
    color: '#FF3B30',
  },
  resultCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34C759',
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
  },
  resultValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
});
