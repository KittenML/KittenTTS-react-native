# Kitten TTS 2 Through The Kitten API

Kitten TTS 2 is KittenML's 1.7B-parameter speech model, with voice cloning,
expression tags and 170+ voices in 20 languages. It is too large to run inside
a phone app, so this SDK runs it on the hosted
[Kitten API](https://docs.kittenml.com/) instead. It loads through the same
`KittenTTS.create()` and answers the same calls as the on-device models, the
way `KittenTTS("KittenML/kitten-tts-2")` does in the Python package.

Nothing is downloaded to the device. The text you pass, and any reference
recording, is sent to the API, and each generation is billed to your KittenML
account.

## Quick Start

```tsx
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2',
  apiKey: KITTENML_API_KEY, // development only, see below
  player: createExpoAudioPlayer(ExpoAudio),
});

console.log(tts.availableVoices); // ['bella_en', 'maeve_en', ...]

await tts.speak('Hi! umm.. how are you, I guess?', 'bella_en');

const result = await tts.generate('Save this one.', { voice: 'bella_en', preset: 'stable' });
console.log(result.duration, result.wavBase64());
```

Create a key in the
[API key dashboard](https://platform.kittenml.com/developers/api-keys).

`KittenTTS.create()` returns a `KittenTTS2` here. It lists the voices once, so
it takes one request before it resolves, and it fails right away if the key is
wrong.

## Keep Your Key Off The Device

Anyone who downloads an app can extract a key compiled into it. Use `apiKey`
while you develop, then ship with `baseUrl` pointing at a small endpoint on your
own backend. It checks your user's session, adds
`Authorization: Bearer sk_kitten_live_...`, and forwards the request to
`https://api.kittenml.com/v1`. No `apiKey` is needed in that mode:

```tsx
const tts = await KittenTTS.create({
  model: 'kitten-tts-2',
  baseUrl: 'https://your-backend.example/kitten',
  headers: { 'X-Session': sessionToken },
  player: createExpoAudioPlayer(ExpoAudio),
});
```

The SDK calls `GET {baseUrl}/voices` and `POST {baseUrl}/audio/speech`, so
forward both, and stream the response body through rather than buffering it.

The SDK refuses to send a key over plain `http` (except to `localhost`), and
keeps the key and your headers out of `JSON.stringify(tts)` and
`console.log(tts)`.

## Voices

`tts.availableVoices` lists the voice IDs you can pass, and `tts.voices` the
details for a voice picker:

```tsx
const english = tts.voices.filter(voice => voice.language === 'en');
// { id: 'frank_en', name: 'Frank — Reserved Announcer', language: 'en', type: 'public', experimental: false }
```

The list holds every built-in voice and your organization's newest 100 saved
voices. A saved voice's `voice_...` ID works as `voice` whether or not it is in
the list.

Built-in voices are IDs such as `bella_en`, not the eight on-device `KittenVoice`
values. `bella_en`, `jasper_en`, `luna_en`, `bruno_en`, `rosie_en`, `hugo_en`,
`kiki_en` and `leo_en` are the same eight speakers.

If `voice` is left out, the API uses its default voice; pass `defaultVoice` to
`create()` to choose your own.

## Generate

`generate(text, voice?, speed?)` works as on the device. For anything more,
pass options, named as in the Python package:

```tsx
await tts.generate('[joyful] We shipped it! <laugh> It is (((really))) fast.', {
  voice: 'maeve_en',
  preset: 'expressive',
  temperature: 0.8,
});
```

| Option | Python | Description |
| --- | --- | --- |
| `voice` | `voice` | Voice ID, or a saved voice's `voice_...` ID |
| `reference` | `reference` | Recording to clone the voice from, for this call |
| `referenceText` | `reference_text` | What the recording says; transcribed when omitted |
| `preset` | `preset` | `'stable'` or `'expressive'` (the API's default) |
| `temperature`, `topK`, `topP`, `minP` | `temperature`, `top_k`, `top_p`, `min_p` | Override the preset's sampling values |
| `maxNewTokens` | `max_new_tokens` | Token limit per text segment, 500 to 12000 |
| `normalize` | `normalize` | `true`/`'basic'`, `'smart'`, or `false`/`'no'` |
| `speed` | — | 0.25 to 4.0 |
| `signal` | — | An `AbortSignal` that cancels the request |

The API checks the values and names the field if one is out of range.

`generate()` returns a `KittenTTSResult` once the whole text is spoken, from the
API's higher-quality path. `wordTimings` is empty: the API does not return
them.

That path returns at most 30 minutes of audio. For text that runs longer,
`generate()` throws a `KittenAPIError` with `apiCode` `audio_limit_reached`
instead of returning the audio cut short: use `generateStreaming()`, or split the
text.

Emotion tags, sound tags and emphasis are described in the
[API docs](https://docs.kittenml.com/tts/generate-speech#emotion-and-sound-tags).

## Clone A Voice

Pass 5 to 30 seconds of one speaker as `reference`, instead of `voice`:

```tsx
const result = await tts.generate('This sentence uses my voice.', {
  reference: recordingUri, // file://, content://, or a path
  referenceText: 'What I said in the recording.',
});
```

`reference` can be a file path or URI, `{ uri, name, type }`, a Blob or File,
a `Uint8Array` or an `ArrayBuffer`. Giving both `voice` and `reference`, or
`referenceText` without `reference`, throws `INVALID_ARGUMENT`.

Only clone a voice you own or have permission to use.

## Stream

`generateStreaming()` yields audio while the rest is still being generated, cut
at pauses so each chunk can play on its own:

```tsx
for await (const chunk of tts.generateStreaming(longText, 'bella_en')) {
  await tts.play(chunk);
}
```

It uses the API's low-latency path. Each chunk's `inputText` is the whole text,
because the API does not say which words a chunk holds.

React Native's built-in `fetch` hands over a response only once it is complete,
so there every chunk arrives at the end. Pass a `fetch` that streams, such as
the one from `expo/fetch`, to get the first chunk while the rest is generated:

```tsx
import { fetch } from 'expo/fetch';

const tts = await KittenTTS.create({ model: 'kitten-tts-2', apiKey, fetch });
```

Browsers stream with their own `fetch`.

## Errors

API failures throw `KittenAPIError`, a `KittenTTSError`, so existing
`isKittenTTSError()` checks still catch them:

```tsx
import { isKittenAPIError } from '@kittentts/react-native';

try {
  await tts.speak('Hello.', 'bella_en');
} catch (error) {
  if (isKittenAPIError(error) && error.status === 402) showTopUp();
}
```

| Property | Description |
| --- | --- |
| `code` | `API_ERROR`, `NETWORK_ERROR` (no response, or timed out) or `CANCELLED` |
| `status` | HTTP status, when the API answered |
| `apiCode` | The API's own code, such as `invalid_voice` or `insufficient_credit` |
| `param` | The request field the error is about |
| `requestId` | Quote it when asking KittenML support about a request |
| `retryAfter` | Seconds the API asked you to wait |

## Timeouts, Retries And Cancelling

- Rate limits (`429`) and temporary server errors (`5xx`) are retried twice,
  with backoff and the API's `Retry-After`. Set `maxRetries` to change that.
- A lost connection is not retried for speech: the request may already have
  reached the model, and a second generation is billed again.
- Each request times out after 5 minutes (`timeoutMs`). A stream is only timed
  until it starts.
- Pass `signal` to cancel one call. `dispose()` cancels every request in flight.

## Web

The same code runs in React Native Web with `createBrowserAudioPlayer()`, and
`reference` also accepts a `blob:` URL. In a browser the key would be visible to
every visitor, so always use `baseUrl` there.

## Compared With The Python Package

| Python (`kittenml`) | React Native |
| --- | --- |
| `KittenTTS("KittenML/kitten-tts-2")` | `await KittenTTS.create({ model: 'kitten-tts-2', apiKey })` |
| `m.generate(text, voice="Bella")` | `await tts.generate(text, 'bella_en')` |
| `m.generate(text, reference="me.wav")` | `await tts.generate(text, { reference: uri })` |
| `for chunk in m.generate_stream(text)` | `for await (const chunk of tts.generateStreaming(text))` |
| `m.available_voices` | `tts.availableVoices` |
| `m.sample_rate` | `tts.sampleRate` |
| returns a NumPy array | returns a `KittenTTSResult` (`samples`, `wavData()`, ...) |

The Python package runs the model on your own machine, so its voice names and
defaults come from the model repository; through the API they come from
`availableVoices`. Its `advanced=` options are not available through the API.
