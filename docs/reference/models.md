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
