// Original synthetic stimuli only. 48k stereo IEEE-float WAV.
// Segments: 0.2-1.2s 1k mono, 1.4-2.4s 6k left, 2.6-3.6s 16k left.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const fs = 48000, duration = 4, frames = fs * duration, ch = 2;
const dataSize = frames * ch * 4, wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(3, 20); wav.writeUInt16LE(ch, 22);
wav.writeUInt32LE(fs, 24); wav.writeUInt32LE(fs * ch * 4, 28);
wav.writeUInt16LE(ch * 4, 32); wav.writeUInt16LE(32, 34);
wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
const tones = [{ f: 1000, at: .2, until: 1.2, stereo: true },
  { f: 6000, at: 1.4, until: 2.4, stereo: false },
  { f: 16000, at: 2.6, until: 3.6, stereo: false }];
for (let i = 0; i < frames; i++) {
  const t = i / fs, tone = tones.find(x => t >= x.at && t < x.until);
  let left = 0, right = 0;
  if (tone) {
    const fade = Math.min(1, (t - tone.at) / .05, (tone.until - t) / .05);
    left = .2 * Math.max(0, fade) * Math.sin(2 * Math.PI * tone.f * (t - tone.at));
    right = tone.stereo ? left : 0;
  }
  wav.writeFloatLE(left, 44 + i * 8);
  wav.writeFloatLE(right, 48 + i * 8);
}
const out = join(process.env.VINYL_LAB_PROBE_DIR ||
  'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/', 'reference-4s-48k.wav');
writeFileSync(out, wav);
console.log(out, wav.length);
