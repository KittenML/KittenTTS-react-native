import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoAudio from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  KittenModel,
  KittenTTS,
  KittenVoice,
  bundledAssetModels,
  createBundledAssetConfig,
  createExpoAudioPlayer,
  modelDisplayName,
  type KittenTTSBundledAssetsManifest,
} from '@kittentts/react-native';
import manifestJson from './assets/kittentts/manifest.json';

const manifest = manifestJson as KittenTTSBundledAssetsManifest;

type WorkState =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'speaking' }
  | { kind: 'error'; message: string };

export default function App() {
  const ttsRef = useRef<KittenTTS | null>(null);
  const mountedRef = useRef(true);
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);
  const models = useMemo(() => bundledAssetModels(manifest), []);
  const [model, setModel] = useState<KittenModel>(models[0] ?? KittenModel.NanoInt8);
  const [state, setState] = useState<WorkState>({ kind: 'preparing' });

  const prepare = useCallback(async (nextModel: KittenModel) => {
    setState({ kind: 'preparing' });
    try {
      await ttsRef.current?.dispose();
      const config = await createBundledAssetConfig(manifest, {
        model: nextModel,
        defaultVoice: KittenVoice.Bella,
      });
      const tts = await KittenTTS.create({ ...config, player });

      if (!mountedRef.current) {
        await tts.dispose();
        return;
      }

      ttsRef.current = tts;
      setState({ kind: 'ready' });
    } catch (error) {
      if (mountedRef.current) {
        ttsRef.current = null;
        setState({ kind: 'error', message: errorMessage(error) });
      }
    }
  }, [player]);

  useEffect(() => {
    mountedRef.current = true;
    prepare(model);
    return () => {
      mountedRef.current = false;
      ttsRef.current?.dispose().catch(() => {});
      ttsRef.current = null;
    };
  }, [model, prepare]);

  const speak = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts) return;

    setState({ kind: 'speaking' });
    try {
      await tts.speak('KittenTTS is running from bundled app assets.');
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, []);

  const busy = state.kind === 'preparing' || state.kind === 'speaking';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Bundled KittenTTS</Text>
        <Text style={styles.subtitle}>{statusText(state)}</Text>

        {busy ? <ActivityIndicator color="#2563EB" /> : null}

        <View style={styles.section}>
          <Text style={styles.label}>Bundled model</Text>
          <View style={styles.modelGrid}>
            {models.map((candidate) => (
              <TouchableOpacity
                key={candidate}
                style={[
                  styles.modelButton,
                  candidate === model && styles.modelButtonSelected,
                  busy && styles.disabled,
                ]}
                disabled={busy}
                onPress={() => setModel(candidate)}
              >
                <Text
                  style={[
                    styles.modelButtonText,
                    candidate === model && styles.modelButtonTextSelected,
                  ]}
                >
                  {modelDisplayName(candidate)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.speakButton, state.kind !== 'ready' && styles.disabled]}
          disabled={state.kind !== 'ready'}
          onPress={speak}
        >
          <Text style={styles.speakButtonText}>Speak</Text>
        </TouchableOpacity>
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
