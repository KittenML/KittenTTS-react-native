import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ExpoAudio from 'expo-audio';
import {
  KittenModel,
  KittenTTS,
  KittenTTSResult,
  KittenTTSErrorCode,
  KittenVoice,
  createExpoAudioPlayer,
  isKittenTTSError,
  modelDisplayName,
  voiceDisplayName,
} from '@kittentts/react-native';
import type { KittenWordTiming } from '@kittentts/react-native';

type Status =
  | { kind: 'idle'; message: string }
  | { kind: 'preparing' }
  | { kind: 'loading'; progress: number }
  | { kind: 'working'; message: string }
  | { kind: 'error'; message: string };

const MODEL = KittenModel.NanoInt8;
const VOICES = [
  KittenVoice.Bella,
  KittenVoice.Luna,
  KittenVoice.Jasper,
  KittenVoice.Leo,
];

export default function App() {
  const [text, setText] = useState(
    'KittenTTS runs fully on device and now returns word-level timestamps. Generate this paragraph to see when each word starts and ends in the audio.',
  );
  const [voice, setVoice] = useState(KittenVoice.Bella);
  const [status, setStatus] = useState<Status>({
    kind: 'idle',
    message: 'Ready to load the model.',
  });
  const [result, setResult] = useState<KittenTTSResult | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const ttsRef = useRef<KittenTTS | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);

  const busy = status.kind === 'preparing' || status.kind === 'loading' || status.kind === 'working';

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearInterval(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  async function getTTS(): Promise<KittenTTS> {
    if (ttsRef.current) return ttsRef.current;

    setStatus({ kind: 'preparing' });
    const cached = await KittenTTS.isModelDownloaded({ model: MODEL });
    const instance = await KittenTTS.create(
      { model: MODEL, defaultVoice: voice, player },
      (progress, info) => {
        if (info?.stage === 'downloading') {
          setStatus({ kind: 'loading', progress });
        }
      },
    );

    ttsRef.current = instance;
    setStatus({
      kind: 'idle',
      message: cached ? 'Loaded from cache.' : 'Downloaded and loaded.',
    });
    return instance;
  }

  async function speak() {
    if (!text.trim()) {
      setStatus({ kind: 'error', message: 'Enter text before speaking.' });
      return;
    }

    try {
      setResult(null);
      setActiveWordIndex(null);
      const tts = await getTTS();
      setStatus({ kind: 'working', message: 'Generating audio...' });
      const nextResult = await tts.generate(text, voice);
      setResult(nextResult);
      setStatus({ kind: 'working', message: 'Playing with word highlighting...' });
      await tts.play(nextResult, {
        onPlaybackStart: () => startWordHighlighting(nextResult),
      });
      stopWordHighlighting();
      setStatus({ kind: 'idle', message: 'Playback finished.' });
    } catch (error) {
      stopWordHighlighting();
      setStatus({ kind: 'error', message: friendlyError(error) });
    }
  }

  async function generateOnly() {
    if (!text.trim()) {
      setStatus({ kind: 'error', message: 'Enter text before generating.' });
      return;
    }

    try {
      setResult(null);
      setActiveWordIndex(null);
      const tts = await getTTS();
      setStatus({ kind: 'working', message: 'Generating audio...' });
      const nextResult = await tts.generate(text, voice);
      setResult(nextResult);
      setStatus({ kind: 'idle', message: 'Generated audio with word timings.' });
    } catch (error) {
      setStatus({ kind: 'error', message: friendlyError(error) });
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Word Timings</Text>
          <Text style={styles.subtitle}>
            Expo SDK 55 development-build demo. Expo Go will not work.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>Model</Text>
          <Text style={styles.value}>{modelDisplayName(MODEL)}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>Text</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!busy}
            multiline
            placeholder="Type a sentence"
            placeholderTextColor="#777"
            style={styles.input}
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>Voice</Text>
          <View style={styles.options}>
            {VOICES.map((item) => (
              <Pressable
                key={item}
                disabled={busy}
                onPress={() => setVoice(item)}
                style={[styles.option, voice === item && styles.optionSelected]}
              >
                <Text
                  style={[
                    styles.optionText,
                    voice === item && styles.optionTextSelected,
                  ]}
                >
                  {voiceDisplayName(item)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <StatusView status={status} />

        <View style={styles.actions}>
          <Pressable
            disabled={busy}
            onPress={generateOnly}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Generate</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={speak}
            style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>
              Speak
            </Text>
          </Pressable>
        </View>

        {result ? (
          <ResultCard result={result} activeWordIndex={activeWordIndex} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );

  function startWordHighlighting(nextResult: KittenTTSResult) {
    stopWordHighlighting();
    const wordTimings = nextResult.wordTimings;

    if (wordTimings.length === 0) return;

    const startedAt = Date.now();
    setActiveWordIndex(null);
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
}

function ResultCard({
  result,
  activeWordIndex,
}: {
  result: KittenTTSResult;
  activeWordIndex: number | null;
}) {
  const wordTimings: KittenWordTiming[] = result.wordTimings;
  const timings = wordTimings.slice(0, 24);
  const transcriptWords = wordTimings.slice(0, 80);

  return (
    <View style={styles.result}>
      <Text style={styles.resultTitle}>Generated Result</Text>
      <View style={styles.resultGrid}>
        <View>
          <Text style={styles.resultLabel}>Duration</Text>
          <Text style={styles.resultValue}>{result.duration.toFixed(2)}s</Text>
        </View>
        <View>
          <Text style={styles.resultLabel}>Words timed</Text>
          <Text style={styles.resultValue}>{wordTimings.length}</Text>
        </View>
      </View>

      <Text style={styles.timingsTitle}>Word timings</Text>
      {timings.length > 0 ? (
        <>
          <Text style={styles.transcript}>
            {transcriptWords.map((item, index) => (
              <Text
                key={`transcript-${item.wordIndex}-${item.word}`}
                style={[
                  styles.transcriptWord,
                  activeWordIndex === item.wordIndex && styles.transcriptWordActive,
                ]}
              >
                {item.word}
                {index < transcriptWords.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>

          <View style={styles.timingList}>
            {timings.map((item) => (
              <View
                key={`${item.wordIndex}-${item.word}`}
                style={[
                  styles.timingRow,
                  activeWordIndex === item.wordIndex && styles.timingRowActive,
                ]}
              >
                <Text
                  style={[
                    styles.timingWord,
                    activeWordIndex === item.wordIndex && styles.timingWordActive,
                  ]}
                >
                  {item.word}
                </Text>
                <Text
                  style={[
                    styles.timingTime,
                    activeWordIndex === item.wordIndex && styles.timingTimeActive,
                  ]}
                >
                  {item.startTime.toFixed(2)}s - {item.endTime.toFixed(2)}s
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={styles.emptyTimings}>
          No word timings returned for this text. Try a shorter sentence or
          confirm this model build includes duration output.
        </Text>
      )}
    </View>
  );
}

function StatusView({ status }: { status: Status }) {
  if (status.kind === 'preparing') {
    return (
      <View style={styles.status}>
        <ActivityIndicator />
        <Text style={styles.statusText}>Preparing assets...</Text>
      </View>
    );
  }

  if (status.kind === 'loading') {
    return (
      <View style={styles.status}>
        <ActivityIndicator />
        <Text style={styles.statusText}>
          Downloading assets... {Math.round(status.progress * 100)}%
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.status, status.kind === 'error' && styles.errorStatus]}>
      <Text
        style={[
          styles.statusText,
          status.kind === 'error' && styles.errorStatusText,
        ]}
      >
        {status.message}
      </Text>
    </View>
  );
}

function friendlyError(error: unknown): string {
  if (!isKittenTTSError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.code) {
    case KittenTTSErrorCode.DownloadFailed:
      return 'Download failed. Check your connection and try again.';
    case KittenTTSErrorCode.PlaybackFailed:
      return 'Playback failed. Make sure the dev build includes expo-audio.';
    case KittenTTSErrorCode.EmptyInput:
      return 'Enter text before generating speech.';
    default:
      return error.message;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  content: {
    gap: 16,
    padding: 20,
  },
  header: {
    gap: 6,
    paddingTop: 12,
  },
  title: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#5B6472',
    fontSize: 15,
    lineHeight: 21,
  },
  panel: {
    gap: 10,
  },
  label: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: '#111827',
    fontSize: 17,
  },
  input: {
    minHeight: 110,
    borderColor: '#D5DAE1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111827',
    fontSize: 16,
    lineHeight: 22,
    padding: 12,
    textAlignVertical: 'top',
    backgroundColor: '#FFFFFF',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    borderColor: '#CAD1DB',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: {
    borderColor: '#1F6FEB',
    backgroundColor: '#EAF2FF',
  },
  optionText: {
    color: '#1F2937',
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: '#174EA6',
  },
  status: {
    alignItems: 'center',
    borderColor: '#D5DAE1',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    padding: 12,
    backgroundColor: '#FFFFFF',
  },
  errorStatus: {
    borderColor: '#F2B8B5',
    backgroundColor: '#FFF1F1',
  },
  statusText: {
    color: '#344054',
    flex: 1,
    fontSize: 14,
  },
  errorStatusText: {
    color: '#B42318',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    alignItems: 'center',
    borderColor: '#1F2937',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  primaryButton: {
    borderColor: '#1F6FEB',
    backgroundColor: '#1F6FEB',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  result: {
    borderColor: '#D5DAE1',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 14,
    backgroundColor: '#FFFFFF',
  },
  resultTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  resultGrid: {
    flexDirection: 'row',
    gap: 28,
  },
  resultLabel: {
    color: '#5B6472',
    fontSize: 13,
  },
  resultValue: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  timingsTitle: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  transcript: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 30,
  },
  transcriptWord: {
    color: '#111827',
  },
  transcriptWordActive: {
    backgroundColor: '#1F6FEB',
    color: '#FFFFFF',
    fontWeight: '800',
  },
  timingList: {
    gap: 6,
  },
  timingRow: {
    alignItems: 'center',
    borderColor: '#E4E7EC',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  timingRowActive: {
    borderColor: '#1F6FEB',
    backgroundColor: '#EAF2FF',
  },
  timingWord: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  timingWordActive: {
    color: '#174EA6',
  },
  timingTime: {
    color: '#475467',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  timingTimeActive: {
    color: '#174EA6',
    fontWeight: '700',
  },
  emptyTimings: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
  },
});
