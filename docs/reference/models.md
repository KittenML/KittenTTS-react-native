# Models And Voices

KittenTTS ships several model sizes. Pick the smallest model that sounds good
enough for your use case.

## Models

Start with `NanoInt8` when app size and download size matter. Use `Mini` when
quality is more important.

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

### Kitten TTS 2

| Model | `model` | Where it runs | Languages | Docs |
| --- | --- | --- | --- | --- |
| Kitten TTS 2 Nano | `'kitten-tts-2-nano'` | on the device; on the API with `apiKey` | 8 | [guide](../guides/kitten-tts-2-tiny.md) |
| Kitten TTS 2 Pico | `'kitten-tts-2-pico'` | on the device; on the API with `apiKey` | 8 | [guide](../guides/kitten-tts-2-tiny.md) |
| Kitten TTS 2 Mini | `'kitten-tts-2-mini'` | on the device; on the API with `apiKey` | 16 (Japanese included) | [guide](../guides/kitten-tts-2-tiny.md) |
| Kitten TTS 2 Cloud | `'kitten-tts-2-cloud'` (or `'kitten-tts-2'`) | on the Kitten API only (1.7B parameters) | 20+, voice cloning | [guide](../guides/kitten-api.md) |

On the device they download per language, int8 or int4 weights; the
[guide](../guides/kitten-tts-2-tiny.md#speed) has sizes and speeds on real
phones. Their voices are per language (`tts.voices('de')`), not the eight
`KittenVoice` values below.

## Voices

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
