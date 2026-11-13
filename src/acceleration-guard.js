// Geometrical *sampled* wall-acceleration bound applied after the cutting
// transfer and the depth servo. This is not a model of cutter-head force,
// temperature, stylus compliance or continuous-time intersample acceleration.
//
// Default algorithm:
// 1. Preserve already-compliant cuts exactly.
// 2. Split each wall into a low band and high-band residual with a symmetric
//    forward/backward one-pole LPF, so the correction adds no steady-state
//    phase rotation.
// 3. Solve the exact linear inequalities |D2(low + g*high)| <= target for a
//    single shared gain g in [0,1] across both walls and all samples.
// 4. If no common gain exists, attenuate the *entire* stereo cut uniformly.
// 5. Audit the final Float32 result and, if needed, apply an additional tiny
//    uniform safety correction for quantization.
//
// Unlike a time-varying clipped acceleration envelope, constant gain on each
// sub-band does not itself introduce modulation products into a steady tone.

import { onePole } from './dsp.js';

export function maxWallAcceleration(left, right, fs) {
  if (!Number.isFinite(fs) || fs <= 0 || left.length !== right.length) {
    throw new RangeError('Invalid wall buffers or sample rate');
  }
  const fs2 = fs * fs;
  if (![left[0], right[0], left.at(-1), right.at(-1)].every(Number.isFinite)) {
    throw new RangeError('Non-finite groove sample, cannot certify acceleration');
  }
  let peak = 0, index = -1, wall = '';
  for (let i = 1; i < left.length - 1; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) {
      throw new RangeError('Non-finite groove sample, cannot certify acceleration');
    }
    const a = Math.abs((left[i + 1] - 2 * left[i] + left[i - 1]) * fs2);
    const b = Math.abs((right[i + 1] - 2 * right[i] + right[i - 1]) * fs2);
    if (a > peak) { peak = a; index = i; wall = 'left'; }
    if (b > peak) { peak = b; index = i; wall = 'right'; }
  }
  return { peak, index, wall };
}

function zeroPhaseLowpass(source, fs, hz) {
  const k = onePole(hz, fs);
  const low = new Float32Array(source.length);
  if (!source.length) return low;
  // Boundary values are constant-extended, avoiding artificial transients at
  // the start or end of a cut.
  let z = source[0];
  for (let i = 0; i < source.length; i++) {
    z += k * (source[i] - z);
    low[i] = z;
  }
  z = low.at(-1);
  for (let i = low.length - 1; i >= 0; i--) {
    z += k * (low[i] - z);
    low[i] = z;
  }
  return low;
}

function intersectGainRange(source, low, fs2, bound, interval) {
  for (let i = 1; i < source.length - 1; i++) {
    const base = (low[i + 1] - 2 * low[i] + low[i - 1]) * fs2;
    const raw = (source[i + 1] - 2 * source[i] + source[i - 1]) * fs2;
    const high = raw - base;
    if (Math.abs(high) < 1e-10) {
      if (Math.abs(base) > bound) { interval.feasible = false; return; }
      continue;
    }
    const v0 = (-bound - base) / high;
    const v1 = (bound - base) / high;
    interval.min = Math.max(interval.min, Math.min(v0, v1));
    interval.max = Math.min(interval.max, Math.max(v0, v1));
    if (interval.max < interval.min) { interval.feasible = false; return; }
  }
}

function uniformReduce(left, right, fs, target, ratio = 0.999) {
  let gain = 1, peak = maxWallAcceleration(left, right, fs).peak;
  // Float32 arithmetic can move a limiting sample by a few ULPs, hence
  // repeated audited checks with a small reserve rather than assuming exact
  // mathematical scaling survives rounding.
  for (let pass = 0; pass < 4 && peak > target; pass++) {
    const g = (target / peak) * ratio;
    for (const x of [left, right]) for (let i = 0; i < x.length; i++) x[i] *= g;
    gain *= g;
    peak = maxWallAcceleration(left, right, fs).peak;
  }
  if (peak > target) throw new RangeError('Failed to bound output wall acceleration');
  return { gain, peak };
}

export function boundWallAcceleration(left, right, fs, aMax, { cornerHz = 3000, mode = 'selective' } = {}) {
  if (![fs, aMax, cornerHz].every(Number.isFinite) || fs <= 0 || aMax <= 0 ||
      cornerHz <= 0 || cornerHz >= fs / 2 || left.length !== right.length ||
      !['selective', 'uniform'].includes(mode)) {
    throw new RangeError('Invalid acceleration guard settings');
  }
  const before = maxWallAcceleration(left, right, fs).peak;
  const info = {
    mode: 'identity', peakBefore: before, peakAfter: before, target: aMax,
    highGain: 1, uniformGain: 1, attenuationDb: 0, cornerHz,
  };
  if (before <= aMax * 0.995) return info;
  const bound = aMax * 0.995, fs2 = fs * fs;
  let filtered = false, highGain = 1;
  if (mode === 'selective') {
    const interval = { min: 0, max: 1, feasible: true };
    for (const channel of [left, right]) {
      const low = zeroPhaseLowpass(channel, fs, cornerHz);
      intersectGainRange(channel, low, fs2, bound, interval);
      if (!interval.feasible) break;
    }
    if (interval.feasible && interval.max >= 0) {
      highGain = Math.min(1, interval.max);
      if (highGain < 1) {
        for (const channel of [left, right]) {
          const low = zeroPhaseLowpass(channel, fs, cornerHz);
          for (let i = 0; i < channel.length; i++) {
            channel[i] = highGain * channel[i] + (1 - highGain) * low[i];
          }
        }
        filtered = true;
      }
    }
  }
  const result = uniformReduce(left, right, fs, aMax);
  info.mode = filtered ? (result.gain < 1 ? 'selective+reserve' : 'selective') : 'uniform';
  info.highGain = filtered ? highGain : 1;
  info.uniformGain = result.gain;
  info.peakAfter = result.peak;
  info.attenuationDb = -20 * Math.log10(info.highGain * info.uniformGain);
  return info;
}
