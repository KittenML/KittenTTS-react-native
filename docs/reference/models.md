# Models And Voices

Kitten TTS 2 is the current model family: Nano, Pico and Mini run on the device,
and Kitten TTS 2 Cloud runs on the Kitten API. Kitten TTS 0.8, the older English
models, is still supported. Pick the smallest model that sounds good enough for
your use case.

## Kitten TTS 2

| Model | `model` | Parameters | int8 / int4 download | Languages | Where it runs |
| --- | --- | --- | --- | --- | --- |
| [Kitten TTS 2 Nano](https://huggingface.co/KittenML/kitten-tts-2-nano) | `'kitten-tts-2-nano'` | 17M | 17 MB / 8.8 MB per language | 8 | on the device; on the API with `apiKey` |
| [Kitten TTS 2 Pico](https://huggingface.co/KittenML/kitten-tts-2-pico) | `'kitten-tts-2-pico'` | 7.2M | 8 MB / 4 MB per language | 8 | on the device; on the API with `apiKey` |
| [Kitten TTS 2 Mini](https://huggingface.co/KittenML/kitten-tts-2-mini) | `'kitten-tts-2-mini'` | 82M | 83 MB / 47 MB for every language | 16, Japanese included | on the device; on the API with `apiKey` |
| Kitten TTS 2 Cloud | `'kitten-tts-2-cloud'` (or `'kitten-tts-2'`) | 1.7B | nothing is downloaded | 20+, voice cloning | on the Kitten API only |

```tsx
const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  weights: 'int8',
  languages: ['en'],
});
```

On the device they download per language, in int8 or int4 weights, and need
React Native 0.75 or newer (Hermes). The
[guide](../guides/kitten-tts-2-tiny.md#speed) has speeds on real phones; the
[Kitten API guide](../guides/kitten-api.md) covers the cloud.

Languages:

- Nano and Pico: `en de es it pt ru hi fr`
- Mini: those and `da fi ja ko nl sv sw tr`

All but English and Japanese need the optional `@kittentts/espeak-ng` package;
see [Languages that need espeak-ng](../guides/kitten-tts-2-tiny.md#languages-that-need-espeak-ng).

### Kitten TTS 2 Voices

On the device, each language has its own voices. Nano's, for example:

| Language | Voices |
| --- | --- |
| `en` | Eleanor, Martha, Serena, Iris, Grace, Edith, Otis, Vincent, Max, Danny |
| `de` | Anna, Mia, Lukas, Paul |
| `fr` | Juliette, Gabriel, Nicolas |

Pico and Mini have their own lists. Read them from the loaded model:

```tsx
tts.availableVoices;   // { en: ['Eleanor', ...], de: ['Anna', ...], ... }
tts.voices('de');      // [{ key, name, description, language }, ...]

await tts.speak('Guten Morgen.', { voice: 'Anna' });   // the voice picks German
```

Names work in any case. Without a voice, the language's first one speaks.

Kitten TTS 2 Cloud, and Nano, Pico and Mini on the API, use the API's voice IDs,
such as `bella_en`: see `tts.availableVoices` and the
[Kitten API guide](../guides/kitten-api.md#voices).

## Kitten TTS 0.8

The older English models. Start with `NanoInt8` when app size and download size
matter. Use `Mini` when quality is more important. With no `model`,
`KittenTTS.create()` loads `KittenModel.Nano`.

| Model | Enum | Parameters | Approx download | Hugging Face |
| --- | --- | --- | --- | --- |
| Nano int8 | `KittenModel.NanoInt8` | 15M | 28 MB | [kitten-tts-nano-0.8-int8](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8) |
| Nano fp32 | `KittenModel.Nano` | 15M | 59 MB | [kitten-tts-nano-0.8](https://huggingface.co/KittenML/kitten-tts-nano-0.8) |
| Micro | `KittenModel.Micro` | 40M | 44 MB | [kitten-tts-micro-0.8](https://huggingface.co/KittenML/kitten-tts-micro-0.8) |
| Mini | `KittenModel.Mini` | 80M | 83 MB | [kitten-tts-mini-0.8](https://huggingface.co/KittenML/kitten-tts-mini-0.8) |

```tsx
const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
});
```

### Kitten TTS 0.8 Voices

The eight `KittenVoice` values belong to the 0.8 models:

| Voice | Enum | Character |
| --- | --- | --- |
| Bella | `KittenVoice.Bella` | Warm and expressive |
| Jasper | `KittenVoice.Jasper` | Clear and conversational |
| Luna | `KittenVoice.Luna` | Calm and smooth |
| Bruno | `KittenVoice.Bruno` | Deep and steady |
| Rosie | `KittenVoice.Rosie` | Bright and friendly |
| Hugo | `KittenVoice.Hugo` | Authoritative |
| Kiki | `KittenVoice.Kiki` | Lively and energetic |
| Leo | `KittenVoice.Leo` | Relaxed and natural |

```tsx
await tts.speak('Luna speaking.', KittenVoice.Luna);
await tts.speak('Slower Bella speaking.', KittenVoice.Bella, 0.8);
```
