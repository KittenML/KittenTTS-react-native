import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoAudio from 'expo-audio';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { Button, Card, Field, Row, Screen, Segmented, Status, TextArea } from './components/ui';
import manifestJson from './assets/kittentts/manifest.json';

// Written by `npm run bundle:kittentts`: a Kitten TTS 2 model and a 0.8 model, which
// load from the app's own files, with no network.
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

function bundledModels(): Entry[] {
  const tiny = bundledTinyModels(manifest).map(id => ({
    id: id as string,
    label: `TTS 2 ${id.replace('kitten-tts-2-', '').replace(/^./, c => c.toUpperCase())}`,
    kind: 'tiny' as const,
  }));
  const onnx = bundledAssetModels(manifest).map(id => ({ id: id as string, label: `0.8 ${modelDisplayName(id)}`, kind: 'onnx' as const }));
  return [...tiny, ...onnx];
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
  const [text, setText] = useState('KittenTTS is running from files bundled inside this app.');

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

  const select = (id: string) => {
    setModel(id);
    prepare(models.find(m => m.id === id)!);
  };

  const speak = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts || !text.trim()) return;
    setState({ kind: 'speaking' });
    try {
      await tts.speak(text);
      setState({ kind: 'ready' });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, [text]);

  const stop = useCallback(() => {
    ttsRef.current?.stopSpeaking().catch(() => {});
  }, []);

  const busy = state.kind === 'preparing' || state.kind === 'speaking';
  const current = models.find(m => m.id === model);

  return (
    <Screen
      title="Offline"
      description="These models ship inside the app, so they start with no download and work with no network."
      badge="Offline"
    >
      <Card>
        <Field label="Bundled model" hint={state.kind === 'error' ? 'Tap the model again to retry.' : undefined}>
          <Segmented
            value={model}
            options={models.map(m => ({ value: m.id, label: m.label }))}
            onChange={select}
            disabled={busy}
          />
        </Field>
        {state.kind === 'preparing'
          ? <Status kind="loading" text="Loading from the app bundle..." />
          : state.kind === 'error'
            ? <Status kind="error" text={state.message} />
            : <Status kind={state.kind === 'speaking' ? 'loading' : 'ready'} text={state.kind === 'speaking' ? 'Speaking...' : `${current?.kind === 'tiny' ? 'Kitten TTS 2' : 'Kitten TTS 0.8'} is ready, offline`} />}
      </Card>

      <Card>
        <Field label="Text">
          <TextArea value={text} onChangeText={setText} editable={!busy} placeholder="Type something to say" />
        </Field>
        <Row>
          {state.kind === 'speaking'
            ? <Button title="Stop" icon="stop" onPress={stop} />
            : <Button title="Speak" icon="play" disabled={state.kind !== 'ready' || !text.trim()} onPress={speak} />}
        </Row>
      </Card>
    </Screen>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
