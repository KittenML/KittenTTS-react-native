import {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import * as ExpoAudio from 'expo-audio';
import {
  ALL_VOICES,
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
import type {KittenWordTiming} from '@kittentts/react-native';

const LOGO = require('./assets/kittenml_logo.png');

type Status =
  | {kind: 'idle'; message: string}
  | {kind: 'preparing'}
  | {kind: 'loading'; progress: number}
  | {kind: 'working'; message: string}
  | {kind: 'error'; message: string};

const MODEL = KittenModel.NanoInt8;

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

  const busy =
    status.kind === 'preparing' ||
    status.kind === 'loading' ||
    status.kind === 'working';

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

    setStatus({kind: 'preparing'});
    const cached = await KittenTTS.isModelDownloaded({model: MODEL});
    const instance = await KittenTTS.create(
      {model: MODEL, defaultVoice: voice, player},
      (progress, info) => {
        if (info?.stage === 'downloading') {
          setStatus({kind: 'loading', progress});
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
      setStatus({kind: 'error', message: 'Enter text before speaking.'});
      return;
    }

    try {
      setResult(null);
      setActiveWordIndex(null);
      const tts = await getTTS();
      setStatus({kind: 'working', message: 'Generating audio...'});
      const nextResult = await tts.generate(text, voice);
      setResult(nextResult);
      setStatus({
        kind: 'working',
        message: 'Playing with word highlighting...',
      });
      await tts.play(nextResult, {
        onPlaybackStart: () => startWordHighlighting(nextResult),
      });
      stopWordHighlighting();
      setStatus({kind: 'idle', message: 'Playback finished.'});
    } catch (error) {
      stopWordHighlighting();
      setStatus({kind: 'error', message: friendlyError(error)});
    }
  }

  async function generateOnly() {
    if (!text.trim()) {
      setStatus({kind: 'error', message: 'Enter text before generating.'});
      return;
    }

    try {
      setResult(null);
      setActiveWordIndex(null);
      const tts = await getTTS();
      setStatus({kind: 'working', message: 'Generating audio...'});
      const nextResult = await tts.generate(text, voice);
      setResult(nextResult);
      setStatus({kind: 'idle', message: 'Generated audio with word timings.'});
    } catch (error) {
      setStatus({kind: 'error', message: friendlyError(error)});
    }
  }

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
              Word timings example of the React Native SDK for KittenTTS
            </Text>
          </View>
        </View>

        <View style={styles.demoCard}>
          <View style={styles.modelRow}>
            <View style={styles.modelRowLeft}>
              <Text style={styles.modelRowLabel}>Model</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{statusSummary(status)}</Text>
              </View>
            </View>
            <View style={styles.softBadge}>
              <Text style={styles.softBadgeText}>
                {modelDisplayName(MODEL)}
              </Text>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.label}>Text</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              editable={!busy}
              multiline
              placeholder="Type a sentence"
              placeholderTextColor="#8D8D93"
              style={styles.input}
            />
          </View>

          <View style={styles.panel}>
            <Text style={styles.label}>Voice</Text>
            <View style={styles.options}>
              {ALL_VOICES.map(item => (
                <Pressable
                  key={item}
                  disabled={busy}
                  onPress={() => setVoice(item)}
                  style={[
                    styles.option,
                    voice === item && styles.optionSelected,
                    busy && styles.disabled,
                  ]}>
                  <Text
                    style={[
                      styles.optionText,
                      voice === item && styles.optionTextSelected,
                    ]}>
                    {voiceDisplayName(item)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.actionGroup}>
            <Text style={styles.actionGroupLabel}>Playback</Text>
            <View style={styles.actions}>
              <Pressable
                disabled={busy}
                onPress={generateOnly}
                style={[styles.button, busy && styles.disabled]}>
                <Text style={styles.buttonText}>Generate</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={speak}
                style={[
                  styles.button,
                  styles.primaryButton,
                  busy && styles.disabled,
                ]}>
                <Text style={[styles.buttonText, styles.primaryButtonText]}>
                  Speak
                </Text>
              </Pressable>
            </View>
          </View>

          <StatusView status={status} />

          {result ? (
            <ResultCard result={result} activeWordIndex={activeWordIndex} />
          ) : null}

          <Text style={styles.disclaimer}>
            This system is for demonstration purposes only and is not intended
            to process sensitive or personal data.
          </Text>
        </View>
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
        item =>
          elapsedSeconds >= item.startTime && elapsedSeconds < item.endTime,
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
                  activeWordIndex === item.wordIndex &&
                    styles.transcriptWordActive,
                ]}>
                {item.word}
                {index < transcriptWords.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>

          <View style={styles.timingList}>
            {timings.map(item => (
              <View
                key={`${item.wordIndex}-${item.word}`}
                style={[
                  styles.timingRow,
                  activeWordIndex === item.wordIndex && styles.timingRowActive,
                ]}>
                <Text
                  style={[
                    styles.timingWord,
                    activeWordIndex === item.wordIndex &&
                      styles.timingWordActive,
                  ]}>
                  {item.word}
                </Text>
                <Text
                  style={[
                    styles.timingTime,
                    activeWordIndex === item.wordIndex &&
                      styles.timingTimeActive,
                  ]}>
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

function statusSummary(status: Status): string {
  switch (status.kind) {
    case 'idle':
      return status.message.includes('Ready') ? 'Ready' : 'Loaded';
    case 'preparing':
      return 'Preparing';
    case 'loading':
      return `${Math.round(status.progress * 100)}%`;
    case 'working':
      return 'Working';
    case 'error':
      return 'Error';
  }
}

function StatusView({status}: {status: Status}) {
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
    <View
      style={[styles.status, status.kind === 'error' && styles.errorStatus]}>
      <Text
        style={[
          styles.statusText,
          status.kind === 'error' && styles.errorStatusText,
        ]}>
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
  panel: {
    marginBottom: 18,
  },
  label: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    minHeight: 122,
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    color: '#09090B',
    fontSize: 15,
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
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  optionSelected: {
    backgroundColor: '#D4D4D8',
  },
  optionText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextSelected: {
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
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  errorStatus: {
    alignItems: 'flex-start',
  },
  statusText: {
    color: '#854D0E',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButton: {
    backgroundColor: '#18181B',
  },
  buttonText: {
    color: '#09090B',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButtonText: {
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
  result: {
    backgroundColor: '#FAFAFA',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    marginTop: 18,
    padding: 12,
  },
  resultTitle: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '700',
  },
  resultGrid: {
    flexDirection: 'row',
    gap: 28,
  },
  resultLabel: {
    color: '#71717A',
    fontSize: 13,
  },
  resultValue: {
    color: '#09090B',
    fontSize: 17,
    fontWeight: '700',
  },
  timingsTitle: {
    color: '#52525B',
    fontSize: 12,
    fontWeight: '700',
  },
  transcript: {
    color: '#09090B',
    fontSize: 16,
    lineHeight: 30,
  },
  transcriptWord: {
    color: '#09090B',
  },
  transcriptWordActive: {
    backgroundColor: '#18181B',
    color: '#FFFFFF',
    fontWeight: '800',
  },
  timingList: {
    gap: 6,
  },
  timingRow: {
    alignItems: 'center',
    borderColor: '#E4E4E7',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  timingRowActive: {
    borderColor: '#D4D4D8',
    backgroundColor: '#F4F4F5',
  },
  timingWord: {
    color: '#09090B',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  timingWordActive: {
    color: '#09090B',
  },
  timingTime: {
    color: '#52525B',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  timingTimeActive: {
    color: '#09090B',
    fontWeight: '700',
  },
  emptyTimings: {
    color: '#71717A',
    fontSize: 14,
    lineHeight: 20,
  },
});
