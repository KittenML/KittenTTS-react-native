import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ExpoAudio from 'expo-audio';
import {
  KittenModel,
  KittenTTS,
  KittenTTS2Tiny,
  KittenTTSErrorCode,
  KittenVoice,
  createBrowserAudioPlayer,
  createExpoAudioPlayer,
  isKittenTTSError,
  voiceDisplayName,
} from '@kittentts/react-native';
import type { KittenTTSResult, KittenWordTiming } from '@kittentts/react-native';
import { Button, Card, Field, Row, Screen, Select, Stats, Status, TextArea, useUI } from './components/ui';

type AnyTTS = KittenTTS | KittenTTS2Tiny;

// Every on-device model returns word timings: Kitten TTS 2 Nano, Pico and Mini and
// the 0.8 models. (The cloud models don't.)
const MODELS = [
  { value: 'kitten-tts-2-nano', label: 'TTS 2 Nano', description: 'Kitten TTS 2 Nano, 8 languages' },
  { value: 'kitten-tts-2-pico', label: 'TTS 2 Pico', description: 'Kitten TTS 2 Pico, the fastest' },
  { value: 'kitten-tts-2-mini', label: 'TTS 2 Mini', description: 'Kitten TTS 2 Mini, the best' },
  { value: KittenModel.NanoInt8 as string, label: '0.8 Nano', description: 'Kitten TTS 0.8 Nano int8, English, 28 MB' },
];
const VOICES_08 = [KittenVoice.Bella, KittenVoice.Luna, KittenVoice.Jasper, KittenVoice.Leo];

type Status =
  | { kind: 'ready' }
  | { kind: 'loading'; progress?: number }
  | { kind: 'generating' }
  | { kind: 'playing' }
  | { kind: 'error'; message: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <WordTimings />
    </SafeAreaProvider>
  );
}

function WordTimings() {
  const [text, setText] = useState(
    'KittenTTS runs fully on device and returns word-level timestamps. Speak this paragraph to see when each word starts and ends in the audio.',
  );
  const [model, setModel] = useState(MODELS[0].value);
  const [voices, setVoices] = useState<{ value: string; label: string }[]>([]);
  const [voice, setVoice] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [result, setResult] = useState<KittenTTSResult<string> | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const ttsRef = useRef<AnyTTS | null>(null);
  const loadIdRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const player = useMemo(
    () => (Platform.OS === 'web' ? createBrowserAudioPlayer() : createExpoAudioPlayer(ExpoAudio)),
    [],
  );

  const busy = status.kind !== 'ready' && status.kind !== 'error';

  const load = useCallback(async (nextModel: string) => {
    const loadId = ++loadIdRef.current;
    setResult(null);
    const previous = ttsRef.current;
    ttsRef.current = null;
    await previous?.dispose().catch(() => {});
    setStatus({ kind: 'loading' });
    try {
      const onProgress = (progress: number, info?: { stage?: string }) => {
        if (loadId === loadIdRef.current) {
          setStatus({ kind: 'loading', progress: info?.stage === 'downloading' ? progress : undefined });
        }
      };
      const instance: AnyTTS = nextModel.startsWith('kitten-tts-2')
        ? await KittenTTS.create({ model: nextModel as 'kitten-tts-2-nano', player }, onProgress)
        : await KittenTTS.create({ model: nextModel as KittenModel, player }, onProgress);
      if (loadId !== loadIdRef.current) {
        await instance.dispose();
        return;
      }
      // English voices, since the text is English.
      const list = instance instanceof KittenTTS2Tiny
        ? instance.voices('en').map(v => ({ value: v.name, label: v.name }))
        : VOICES_08.map(v => ({ value: v as string, label: voiceDisplayName(v) }));
      ttsRef.current = instance;
      setVoices(list);
      setVoice(list[0]?.value ?? '');
      setStatus({ kind: 'ready' });
    } catch (error) {
      if (loadId === loadIdRef.current) setStatus({ kind: 'error', message: friendlyError(error) });
    }
  }, [player]);

  useEffect(() => {
    load(MODELS[0].value);
    return () => {
      stopWordHighlighting();
      loadIdRef.current += 1;
      // Fast Refresh can tear down the JS runtime while ONNX native objects are
      // still active, so avoid releasing the session during dev reloads.
      if (!__DEV__) ttsRef.current?.dispose().catch(() => {});
      ttsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectModel(next: string) {
    setModel(next);
    load(next);
  }

  function generate(tts: AnyTTS): Promise<KittenTTSResult<string>> {
    return tts instanceof KittenTTS2Tiny
      ? tts.generate(text, { voice, language: 'en' })
      : tts.generate(text, voice as KittenVoice);
  }

  async function speak() {
    const tts = ttsRef.current;
    if (!tts || !text.trim()) return;
    try {
      setResult(null);
      setActiveWordIndex(null);
      setStatus({ kind: 'generating' });
      const nextResult = await generate(tts);
      setResult(nextResult);
      setStatus({ kind: 'playing' });
      await tts.play(nextResult, {
        onPlaybackStart: () => startWordHighlighting(nextResult),
      });
      stopWordHighlighting();
      setStatus({ kind: 'ready' });
    } catch (error) {
      stopWordHighlighting();
      setStatus({ kind: 'error', message: friendlyError(error) });
    }
  }

  async function generateOnly() {
    const tts = ttsRef.current;
    if (!tts || !text.trim()) return;
    try {
      setResult(null);
      setActiveWordIndex(null);
      setStatus({ kind: 'generating' });
      setResult(await generate(tts));
      setStatus({ kind: 'ready' });
    } catch (error) {
      setStatus({ kind: 'error', message: friendlyError(error) });
    }
  }

  function stop() {
    ttsRef.current?.stopSpeaking().catch(() => {});
  }

  function startWordHighlighting(nextResult: KittenTTSResult<string>) {
    stopWordHighlighting();
    const wordTimings = nextResult.wordTimings;
    if (wordTimings.length === 0) return;
    const startedAt = Date.now();
    highlightTimerRef.current = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const active = wordTimings.find(
        item => elapsedSeconds >= item.startTime && elapsedSeconds < item.endTime,
      );
      setActiveWordIndex(active?.wordIndex ?? null);
    }, 50);
  }

  function stopWordHighlighting() {
    if (highlightTimerRef.current) {
      clearInterval(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setActiveWordIndex(null);
  }

  const ready = status.kind === 'ready' && !!ttsRef.current && !!text.trim();

  return (
    <Screen
      title="Word timings"
      description="Hear the text and follow each word as it is spoken. Every on-device model returns word timings."
      badge="Expo"
    >
      <Card>
        <Row>
          <Field label="Model" style={{ flex: 1 }}>
            <Select title="Model" value={model} groups={[{ options: MODELS }]} onChange={selectModel} disabled={busy} />
          </Field>
          <Field label="Voice" style={{ flex: 1 }}>
            <Select title="Voice" value={voice} groups={[{ options: voices }]} onChange={setVoice} disabled={busy || voices.length === 0} />
          </Field>
        </Row>
        <StatusLine status={status} />
      </Card>

      <Card>
        <Field label="Text">
          <TextArea value={text} onChangeText={setText} editable={!busy} placeholder="Type a sentence" />
        </Field>
        <Row>
          {status.kind === 'playing'
            ? <Button title="Stop" icon="stop" onPress={stop} />
            : <Button title="Speak" icon="play" disabled={!ready} onPress={speak} />}
          <Button title="Generate" variant="outline" loading={status.kind === 'generating'} disabled={!ready} onPress={generateOnly} />
        </Row>
      </Card>

      {result ? <Transcript result={result} activeWordIndex={activeWordIndex} /> : null}
    </Screen>
  );
}

function StatusLine({ status }: { status: Status }) {
  switch (status.kind) {
    case 'loading':
      return status.progress !== undefined
        ? <Status kind="loading" text={`Downloading the model, ${Math.round(status.progress * 100)}%`} progress={status.progress} />
        : <Status kind="loading" text="Loading the model..." />;
    case 'generating':
      return <Status kind="loading" text="Generating..." />;
    case 'playing':
      return <Status kind="loading" text="Speaking..." />;
    case 'error':
      return <Status kind="error" text={status.message} />;
    default:
      return <Status kind="ready" text="Ready, on this device" />;
  }
}

function Transcript({ result, activeWordIndex }: { result: KittenTTSResult<string>; activeWordIndex: number | null }) {
  const { t, s } = useUI();
  const [showAll, setShowAll] = useState(false);
  const words: KittenWordTiming[] = result.wordTimings;
  const rows = showAll ? words : words.slice(0, 6);

  return (
    <Card title="Transcript" description="The word being spoken is highlighted.">
      <Stats
        items={[
          { label: 'Audio', value: `${result.duration.toFixed(2)} s` },
          { label: 'Words timed', value: String(words.length) },
        ]}
      />
      {words.length > 0 ? (
        <>
          <Text style={[s.description, local.transcript]}>
            {words.map((item, index) => {
              const active = activeWordIndex === item.wordIndex;
              return (
                <Text
                  key={`${item.wordIndex}-${item.word}`}
                  style={[{ color: t.foreground }, active && { backgroundColor: t.primary, color: t.primaryForeground }]}
                >
                  {item.word}
                  {index < words.length - 1 ? ' ' : ''}
                </Text>
              );
            })}
          </Text>
          <View style={[local.table, { borderColor: t.border }]}>
            {rows.map((item, index) => (
              <View
                key={`${item.wordIndex}-${item.word}-row`}
                style={[local.tableRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
                  activeWordIndex === item.wordIndex && { backgroundColor: t.muted }]}
              >
                <Text style={[local.word, { color: t.foreground }]} numberOfLines={1}>{item.word}</Text>
                <Text style={[local.time, { color: t.mutedForeground }]}>
                  {item.startTime.toFixed(2)} – {item.endTime.toFixed(2)} s
                </Text>
              </View>
            ))}
          </View>
          {words.length > 6 ? (
            <Button
              title={showAll ? 'Show fewer' : `Show all ${words.length} words`}
              variant="ghost"
              onPress={() => setShowAll(!showAll)}
              style={{ flex: 0 }}
            />
          ) : null}
        </>
      ) : (
        <Text style={s.hint}>No word timings came back for this text.</Text>
      )}
    </Card>
  );
}

const local = StyleSheet.create({
  transcript: { fontSize: 17, lineHeight: 28 },
  table: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9, gap: 12 },
  word: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
});

function friendlyError(error: unknown): string {
  if (!isKittenTTSError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case KittenTTSErrorCode.DownloadFailed:
      return 'Download failed. Check your connection and try again.';
    case KittenTTSErrorCode.PlaybackFailed:
      return 'Playback failed. Make sure the development build includes expo-audio.';
    case KittenTTSErrorCode.EmptyInput:
      return 'Enter text before generating speech.';
    default:
      return error.message;
  }
}
