import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as ExpoAudio from 'expo-audio';
import {StatusBar} from 'expo-status-bar';
import {
  ActivityIndicator,
  Image,
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

const LOGO = require('./assets/kittenml_logo.png');

const manifest = manifestJson as KittenTTSBundledAssetsManifest;

type WorkState =
  | {kind: 'preparing'}
  | {kind: 'ready'}
  | {kind: 'speaking'}
  | {kind: 'error'; message: string};

export default function App() {
  const ttsRef = useRef<KittenTTS | null>(null);
  const mountedRef = useRef(true);
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);
  const models = useMemo(() => bundledAssetModels(manifest), []);
  const [model, setModel] = useState<KittenModel>(
    models[0] ?? KittenModel.NanoInt8,
  );
  const [state, setState] = useState<WorkState>({kind: 'preparing'});

  const prepare = useCallback(
    async (nextModel: KittenModel) => {
      setState({kind: 'preparing'});
      try {
        await ttsRef.current?.dispose();
        const config = await createBundledAssetConfig(manifest, {
          model: nextModel,
          defaultVoice: KittenVoice.Bella,
        });
        const tts = await KittenTTS.create({...config, player});

        if (!mountedRef.current) {
          await tts.dispose();
          return;
        }

        ttsRef.current = tts;
        setState({kind: 'ready'});
      } catch (error) {
        if (mountedRef.current) {
          ttsRef.current = null;
          setState({kind: 'error', message: errorMessage(error)});
        }
      }
    },
    [player],
  );

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

    setState({kind: 'speaking'});
    try {
      await tts.speak('KittenTTS is running from bundled app assets.');
      setState({kind: 'ready'});
    } catch (error) {
      setState({kind: 'error', message: errorMessage(error)});
    }
  }, []);

  const busy = state.kind === 'preparing' || state.kind === 'speaking';

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
              Offline bundled-assets example of the React Native SDK
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

          <View style={styles.section}>
            <Text style={styles.label}>Bundled model</Text>
            <View style={styles.modelGrid}>
              {models.map(candidate => (
                <TouchableOpacity
                  key={candidate}
                  style={[
                    styles.modelButton,
                    candidate === model && styles.modelButtonSelected,
                    busy && styles.disabled,
                  ]}
                  disabled={busy}
                  onPress={() => setModel(candidate)}>
                  <Text
                    style={[
                      styles.modelButtonText,
                      candidate === model && styles.modelButtonTextSelected,
                    ]}>
                    {modelDisplayName(candidate)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.actionGroup}>
            <Text style={styles.actionGroupLabel}>Playback</Text>
            <TouchableOpacity
              style={[
                styles.speakButton,
                state.kind !== 'ready' && styles.disabled,
              ]}
              disabled={state.kind !== 'ready'}
              onPress={speak}>
              <Text style={styles.speakButtonText}>Speak</Text>
            </TouchableOpacity>
          </View>

          <StatusView state={state} />

          <Text style={styles.disclaimer}>
            This system is for demonstration purposes only and is not intended
            to process sensitive or personal data.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusView({state}: {state: WorkState}) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'error') {
    return (
      <View style={[styles.status, styles.errorStatus]}>
        <Text style={[styles.statusText, styles.errorStatusText]}>
          {state.message}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.status}>
      <ActivityIndicator color="#18181B" />
      <Text style={styles.statusText}>{statusText(state)}</Text>
    </View>
  );
}

function statusSummary(state: WorkState): string {
  switch (state.kind) {
    case 'preparing':
      return 'Preparing';
    case 'ready':
      return 'Ready';
    case 'speaking':
      return 'Speaking';
    case 'error':
      return 'Error';
  }
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
  section: {
    marginBottom: 18,
  },
  label: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  modelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modelButton: {
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  modelButtonSelected: {
    backgroundColor: '#D4D4D8',
  },
  modelButtonText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '600',
  },
  modelButtonTextSelected: {
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
  speakButton: {
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  speakButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
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
  errorStatus: {
    alignItems: 'flex-start',
  },
  errorStatusText: {
    color: '#B42318',
  },
  disclaimer: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 16,
  },
  disabled: {
    opacity: 0.48,
  },
});
