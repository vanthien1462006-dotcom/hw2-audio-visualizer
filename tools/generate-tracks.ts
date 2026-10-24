// Generates four deterministic sample tracks as 16-bit mono PCM WAV files.
// Run with: node tools/generate-tracks.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const DURATION_SECONDS = 8;
const AMPLITUDE = 0.5;
const FADE_IN_SECONDS = 0.05;
const FADE_OUT_SECONDS = 0.2;
const PCM_FORMAT = 1;
const WAV_HEADER_BYTES = 44;
const TRACK_FREQUENCIES_HZ = [220, 330, 440, 523];
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'public', 'assets', 'tracks');

function renderWav(frequencyHz: number): Buffer {
  const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataBytes = sampleCount * blockAlign;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(PCM_FORMAT, 20);
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(BITS_PER_SAMPLE, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < sampleCount; i++) {
    const t = i / SAMPLE_RATE;
    const fadeIn = Math.min(1, t / FADE_IN_SECONDS);
    const fadeOut = Math.min(1, (DURATION_SECONDS - t) / FADE_OUT_SECONDS);
    const envelope = Math.min(fadeIn, fadeOut);
    const value = AMPLITUDE * envelope * Math.sin(2 * Math.PI * frequencyHz * t);
    wav.writeInt16LE(Math.round(value * 32767), WAV_HEADER_BYTES + i * blockAlign);
  }

  return wav;
}

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [index, frequencyHz] of TRACK_FREQUENCIES_HZ.entries()) {
  const filePath = path.join(OUTPUT_DIR, `track-${index + 1}.wav`);
  writeFileSync(filePath, renderWav(frequencyHz));
}
