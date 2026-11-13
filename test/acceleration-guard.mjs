import assert from 'node:assert/strict';
import { cut } from '../src/cut.js';
import { maxWallAcceleration, boundWallAcceleration } from '../src/acceleration-guard.js';
import { testSignal, compareCleanCuts } from '../src/lab-measure.js';

// A: strictly bound sampled output acceleration at 44.1, 48, and 96 kHz.
for (const fs of [44100, 48000, 96000]) {
  const rec = cut(testSignal('left', fs, 2), fs, { aMax: 12000 });
  assert.ok(rec.acceleration.peakAfter <= 12000, `${fs}: guard must bound acceleration`);
  assert.ok(maxWallAcceleration(rec.wallIn, rec.wallOut, fs).peak <= 12000,
    `${fs}: entire returned programme, lead-out, locked groove must satisfy the sampled limit`);
}

// Boundedness is not just a sine-wave trick. Exercise a deterministic stereo
// mixture containing low-frequency excursions, wideband bursts and impulses.
for (const fs of [44100, 48000, 96000]) {
  const n = fs * 2, left = new Float32Array(n), right = new Float32Array(n);
  let seed = 12345;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const env = Math.min(1, i / (fs * .02), (n - 1 - i) / (fs * .02));
    const burst = (i % Math.round(fs / 5) < fs / 150 ? 1 : 0);
    left[i] = env * (0.22 * Math.sin(2 * Math.PI * 120 * t) +
      0.18 * Math.sin(2 * Math.PI * 7100 * t) + 0.035 * noise() * burst);
    right[i] = env * (-0.19 * Math.sin(2 * Math.PI * 92 * t) +
      0.16 * Math.sin(2 * Math.PI * 12200 * t) + 0.03 * noise() * burst);
  }
  const rec = cut([{ L: left, R: right, title: 'adversarial deterministic stereo' }], fs, { aMax: 6000 });
  assert.ok(rec.acceleration.peakAfter <= 6000, `Wideband stress at ${fs}`);
  assert.ok(maxWallAcceleration(rec.wallIn, rec.wallOut, fs).peak <= 6000,
    `Full cut including run-out at ${fs}`);
}

// B: untouched, already-compliant audio is bitwise identical to legacy mode.
for (const scenario of ['lateral', 'vertical']) {
  const old = cut(testSignal(scenario, 48000, 2), 48000, { accelMode: 'legacy' });
  const current = cut(testSignal(scenario, 48000, 2), 48000);
  assert.equal(current.acceleration.mode, 'identity');
  assert.deepEqual(current.wallIn, old.wallIn);
  assert.deepEqual(current.wallOut, old.wallOut);
}

// C: spectrally selective filtering preserves steady-state phase and does
// not create new measurable 6/12/18k harmonics. The actual THD may *decrease*
// as the original lathe itself introduces distortion.
const legacy6 = cut(testSignal('mid'), 48000, { accelMode: 'legacy', aMax: 4000 });
const bounded6 = cut(testSignal('mid'), 48000, { aMax: 4000 });
const compare6 = compareCleanCuts(legacy6, bounded6, 6000);
assert.equal(compare6.harmonicMeasurementAvailable, true);
assert.ok(legacy6.acceleration.peakBefore > 4000);
assert.ok(bounded6.acceleration.peakAfter <= 4000);
assert.equal(bounded6.acceleration.mode, 'selective');
assert.ok(Math.abs(compare6.channels.left.phaseShiftDeg) < 0.01);
assert.ok(compare6.channels.left.gainDeltaDb < -2);
assert.ok(compare6.channels.left.thdAfterDb <= compare6.channels.left.thdBeforeDb + 0.2);

// D: if a low-frequency signal exceeds the target, a high-band gain alone
// cannot correct it. The algorithm must fall back to uniform stereo gain,
// never claim success without actually measuring the resulting waveform.
const fs = 48000, n = fs, L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) {
  L[i] = 0.01 * Math.sin(2 * Math.PI * 100 * i / fs);
  R[i] = -L[i];
}
const baseline = new Float32Array(L);
const state = boundWallAcceleration(L, R, fs, 200, { cornerHz: 3000 });
assert.equal(state.mode, 'uniform');
assert.ok(state.uniformGain > 0 && state.uniformGain < 1);
assert.ok(state.peakAfter <= 200);
assert.ok(Math.abs(L[1234] / baseline[1234] - state.uniformGain) < 1e-5);
assert.ok(Math.abs(L[1234] + R[1234]) < 1e-12);
assert.throws(() => boundWallAcceleration(L, R, fs, -1), RangeError);
const invalid = new Float32Array([0, NaN, 0]);
assert.throws(() => maxWallAcceleration(invalid, new Float32Array(3), fs), RangeError);
assert.throws(() => boundWallAcceleration(invalid, new Float32Array(3), fs, 500), RangeError);
assert.throws(() => cut(testSignal('lateral', 48000, 2), 48000, { accelMode: 'mystery' }), RangeError);
console.log('acceleration guard: 3 sample rates, identity, 6k fidelity, shared-stereo fallback pass');
