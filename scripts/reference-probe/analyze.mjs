// Analyze 48 kHz REAPER black-box rendered synthetic stimuli.
// Reads PCM WAV without dependencies; output is measured behaviour of the
// plugin instance, not evidence of a specific hardware circuit topology.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.VINYL_LAB_PROBE_DIR ||
  'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/';
const dir = join(root, 'renders/');

function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF WAVE');
  }
  let fmt, block;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('ascii', at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(at + 8),
      channels: b.readUInt16LE(at + 10), sampleRate: b.readUInt32LE(at + 12),
      bytesPerFrame: b.readUInt16LE(at + 20), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') block = { at: at + 8, size };
    at += 8 + size + (size % 2);
  }
  if (!fmt || !block) throw new Error('Incomplete WAV');
  const frames = Math.floor(block.size / fmt.bytesPerFrame);
  const channels = Array.from({ length: fmt.channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) {
    const offset = block.at + i * fmt.bytesPerFrame + c * fmt.bits / 8;
    const y = fmt.format === 3 && fmt.bits === 32 ? b.readFloatLE(offset)
      : fmt.format === 1 && fmt.bits === 24 ? b.readIntLE(offset, 3) / (2 ** 23)
      : fmt.format === 1 && fmt.bits === 16 ? b.readInt16LE(offset) / (2 ** 15)
      : NaN;
    channels[c][i] = y;
  }
  if (channels[0].some(x => !Number.isFinite(x))) throw new Error('Unsupported WAVE audio format');
  return { ...fmt, frames, channels };
}

function tone(wav, f, start, duration) {
  const at = Math.round(start * wav.sampleRate), n = Math.round(duration * wav.sampleRate);
  return wav.channels.map(channel => {
    let re = 0, im = 0, energy = 0;
    for (let i = 0; i < n; i++) {
      const sample = channel[at + i], theta = 2 * Math.PI * f * i / wav.sampleRate;
      re += sample * Math.cos(theta); im -= sample * Math.sin(theta);
      energy += sample * sample;
    }
    const amplitude = 2 * Math.hypot(re, im) / n;
    return { amplitude, phaseDeg: Math.atan2(im, re) * 180 / Math.PI,
      rms: Math.sqrt(energy / n) };
  });
}
const db = x => x > 0 ? 20 * Math.log10(x) : -Infinity;
const specs = [
  { label: '1000Hz LR', f: 1000, start: .4, length: .5 },
  { label: '6000Hz L', f: 6000, start: 1.6, length: .5 },
  { label: '16000Hz L', f: 16000, start: 2.8, length: .5 },
];
const desired = [
  'baseline-bypass-v2.wav',
  'waves-mm-lacquer-drive0.wav',
  'waves-mc-lacquer-drive0.wav',
  'waves-mm-tgdesk-on.wav',
  'waves-mm-print-drive0.wav',
  'tdr-feedback-v1.wav',
  'tdr-hifi-v1.wav',
];
const data = {};
for (const name of desired) {
  if (!readdirSync(dir).includes(name)) throw new Error('Missing reference render: ' + name);
  const wav = readWav(join(dir, name));
  if (wav.sampleRate !== 48000 || wav.channels.length !== 2 || wav.frames !== 192000) {
    throw new Error('Unexpected render format: ' + name + ' ' + JSON.stringify({
      sr: wav.sampleRate, frames: wav.frames, channels: wav.channels.length,
    }));
  }
  data[name] = { format: wav.format, bits: wav.bits, sampleRate: wav.sampleRate,
    frames: wav.frames, tones: Object.fromEntries(specs.map(s => [s.label, tone(wav, s.f, s.start, s.length)])) };
  const quiet0 = wav.channels[0].slice(0, 4000);
  data[name].quietRmsDbfs = db(Math.hypot(...quiet0) / Math.sqrt(quiet0.length));
}
const base = data['baseline-bypass-v2.wav'];
const wrap = delta => Math.atan2(Math.sin(delta * Math.PI / 180),
  Math.cos(delta * Math.PI / 180)) * 180 / Math.PI;
for (const [name, item] of Object.entries(data)) {
  console.log('\n' + name + ' (' + item.bits + 'bit)');
  for (const { label } of specs) {
    const l = item.tones[label], bl = base.tones[label];
    const change = l[0].amplitude / bl[0].amplitude;
    const cross = l[1].amplitude / l[0].amplitude;
    console.log(label,
      'L=' + db(l[0].amplitude).toFixed(2) + 'dBFS',
      'delta=' + db(change).toFixed(2) + 'dB',
      'phase=' + wrap(l[0].phaseDeg - bl[0].phaseDeg).toFixed(3) + '°',
      'R/L=' + db(cross).toFixed(2) + 'dB');
  }
  console.log('quiet RMS', item.quietRmsDbfs.toFixed(1), 'dBFS');
}
writeFileSync(join(root, 'measurement-summary.json'),
  JSON.stringify(data, null, 2));
