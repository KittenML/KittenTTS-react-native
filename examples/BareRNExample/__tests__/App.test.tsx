/**
 * @format
 */

import React from 'react';
import {act, create} from 'react-test-renderer';
import {it, jest} from '@jest/globals';

// The SDK and the player are native modules; the test checks the screen renders.
jest.mock('react-native-sound', () => ({}));
jest.mock('@kittentts/react-native', () => ({
  ALL_VOICES: ['Bella'],
  KittenModel: {Nano: 'nano', NanoInt8: 'nano-int8', Micro: 'micro', Mini: 'mini'},
  KittenTTS: {create: () => new Promise(() => {})},
  KittenTTS2: class {},
  KittenTTS2Tiny: class {},
  createRNSoundPlayer: () => ({}),
  approximateDownloadBytes: () => 28_000_000,
  modelDisplayName: (model: string) => model,
  voiceDisplayName: (voice: string) => voice,
}));

import App from '../App';

it('renders correctly', async () => {
  await act(async () => {
    create(<App />);
  });
});
