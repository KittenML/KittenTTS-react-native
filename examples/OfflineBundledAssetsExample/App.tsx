import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoAudio from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  KittenModel,
  KittenTTS,
  KittenTTS2Tiny,
  KittenVoice,
  bundledAssetModels,
  bundledTinyModels,
  createBundledAssetConfig,
  createBundledTinyOptions,
  createExpoAudioPlayer,
  modelDisplayName,
  type KittenTTSBundledAssetsManifest,
} from '@kittentts/react-native';
import manifestJson from './assets/kittentts/manifest.json';

// Written by `npm run bundle:kittentts`: a 0.8 model and a Kitten TTS 2 model, which
// load from the app's own files with no download.
const manifest = manifestJson as KittenTTSBundledAssetsManifest;

type WorkState =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'speaking' }
  | { kind: 'error'; message: string };

interface Entry {
  id: string;
  label: string;
  kind: 'onnx' | 'tiny';
}

const TEXT = 'KittenTTS is running from bundled app assets.';

function bundledModels(): Entry[] {
  const onnx = bundledAssetModels(manifest).map(id => ({ id: id as string, label: modelDisplayName(id), kind: 'onnx' as const }));
  const tiny = bundledTinyModels(manifest).map(id => ({
    id: id as string,
    label: `Kitten TTS 2 ${id.replace('kitten-tts-2-', '').replace(/^./, c => c.toUpperCase())}`,
    kind: 'tiny' as const,
  }));
  // The manifest's default model first.
  const all = [...onnx, ...tiny];
  const first = 'defaultModel' in manifest ? all.findIndex(m => m.id === manifest.defaultModel) : -1;
  return first > 0 ? [all[first], ...all.filter((_, i) => i !== first)] : all;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Bundled />
    </SafeAreaProvider>
  );
}

function Bundled() {
  const ttsRef = useRef<KittenTTS | KittenTTS2Tiny | null>(null);
  const mountedRef = useRef(true);
  const loadIdRef = useRef(0);
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);
  const models = useMemo(bundledModels, []);
  const [model, setModel] = useState<string>(models[0]?.id ?? KittenModel.NanoInt8);
  const [state, setState] = useState<WorkState>({ kind: 'preparing' });

  const prepare = useCallback(async (next: Entry) => {
    const loadId = ++loadIdRef.current;
    setState({ kind: 'preparing' });
    try {
      const previous = ttsRef.current;
      ttsRef.current = null;
      await previous?.dispose();
      const tts = next.kind === 'tiny'
        ? await KittenTTS.create({
          ...(await createBundledTinyOptions(manifest, { model: next.id as 'kitten-tts-2-nano' })),
          player,
        })
        : await KittenTTS.create({
          ...(await createBundledAssetConfig(manifest, { model: next.id, defaultVoice: KittenVoice.Bella })),
          player,
        });
      if (!mountedRef.current || loadId !== loadIdRef.current) {
        await tts.dispose();
        return;
      }
      ttsRef.current = tts;
      setState({ kind: 'ready' });
    } catch (error) {
      if (mountedRef.current && loadId === loadIdRef.current) {
        setState({ kind: 'error', message: errorMessage(error) });
      }
    }
  }, [player]);

  useEffect(() => {
    mountedRef.current = true;
    if (models[0]) prepare(models[0]);
    else setState({ kind: 'error', message: 'No bundled models. Run npm run bundle:kittentts, then rebuild.' });
    return () => {
      mountedRef.current = false;
      ttsRef.current?.dispose().catch(() => {});
      ttsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tapping the selected model again reloads it, e.g. after an error.
  const select = (entry: Entry) => {
    setModel(entry.id);
    prepare(entry);
  };

  const speak = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts) return;
    setState({ kind: 'speaking' });
    try {
      await tts.speak(TEXT);
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, []);

  const stop = useCallback(() => {
    ttsRef.current?.stopSpeaking().catch(() => {});
  }, []);

  const busy = state.kind === 'preparing' || state.kind === 'speaking';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Bundled KittenTTS</Text>
        <Text style={styles.subtitle}>{statusText(state)}</Text>

        {state.kind === 'preparing' ? <ActivityIndicator color="#2563EB" /> : null}

        <View style={styles.section}>
          <Text style={styles.label}>Bundled model</Text>
          <View style={styles.modelGrid}>
            {models.map(candidate => (
              <TouchableOpacity
                key={candidate.id}
                style={[
                  styles.modelButton,
                  candidate.id === model && styles.modelButtonSelected,
                  busy && styles.disabled,
                ]}
                disabled={busy}
                onPress={() => select(candidate)}
              >
                <Text
                  style={[
                    styles.modelButtonText,
                    candidate.id === model && styles.modelButtonTextSelected,
                  ]}
                >
                  {candidate.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {state.kind === 'speaking' ? (
          <TouchableOpacity style={styles.speakButton} onPress={stop}>
            <Text style={styles.speakButtonText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.speakButton, state.kind !== 'ready' && styles.disabled]}
            disabled={state.kind !== 'ready'}
            onPress={speak}
          >
            <Text style={styles.speakButtonText}>Speak</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusText(state: WorkState): string {
  switch (state.kind) {
    case 'preparing':
      return 'Loading bundled assets...';
    case 'ready':
      return 'Ready';
    case 'speaking':
      return 'Speaking...';
    case 'error':
      return state.message;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F7F8',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 18,
    padding: 24,
  },
  title: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#4B5563',
    lineHeight: 20,
  },
  section: {
    gap: 10,
  },
  label: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  modelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modelButton: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modelButtonSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  modelButtonText: {
    color: '#374151',
    fontWeight: '700',
  },
  modelButtonTextSelected: {
    color: '#1D4ED8',
  },
  speakButton: {
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  speakButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
});
