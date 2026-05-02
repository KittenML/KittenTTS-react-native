/**
 * The eight voices bundled with KittenTTS models.
 *
 * Each voice has a unique character and gender. The raw value corresponds
 * to the voice key used in the model's `voices.npz` embeddings file.
 */
export enum KittenVoice {
  /** Bella -- female, warm and expressive. */
  Bella = 'expr-voice-2-f',
  /** Jasper -- male, clear and conversational. */
  Jasper = 'expr-voice-2-m',
  /** Luna -- female, calm and smooth. */
  Luna = 'expr-voice-3-f',
  /** Bruno -- male, deep and steady. */
  Bruno = 'expr-voice-3-m',
  /** Rosie -- female, bright and friendly. */
  Rosie = 'expr-voice-4-f',
  /** Hugo -- male, authoritative. */
  Hugo = 'expr-voice-4-m',
  /** Kiki -- female, lively and energetic. */
  Kiki = 'expr-voice-5-f',
  /** Leo -- male, relaxed and natural. */
  Leo = 'expr-voice-5-m',
}

/** All available voices. */
export const ALL_VOICES: KittenVoice[] = [
  KittenVoice.Bella,
  KittenVoice.Jasper,
  KittenVoice.Luna,
  KittenVoice.Bruno,
  KittenVoice.Rosie,
  KittenVoice.Hugo,
  KittenVoice.Kiki,
  KittenVoice.Leo,
];

/** Human-readable display name for a voice. */
export function voiceDisplayName(voice: KittenVoice): string {
  switch (voice) {
    case KittenVoice.Bella:
      return 'Bella';
    case KittenVoice.Jasper:
      return 'Jasper';
    case KittenVoice.Luna:
      return 'Luna';
    case KittenVoice.Bruno:
      return 'Bruno';
    case KittenVoice.Rosie:
      return 'Rosie';
    case KittenVoice.Hugo:
      return 'Hugo';
    case KittenVoice.Kiki:
      return 'Kiki';
    case KittenVoice.Leo:
      return 'Leo';
  }
}

/** Whether the voice is female. */
export function isFemaleVoice(voice: KittenVoice): boolean {
  return voice.endsWith('-f');
}
