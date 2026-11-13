import assert from 'node:assert/strict';
import { cut } from '../src/cut.js';
import { testSignal } from '../src/lab-measure.js';
import { accelerationKernels, reconstructedAccelerationAt,
  peakReconstructedAcceleration } from '../src/reconstructed-acceleration.js';

const fs = 48000, n = 4096, center = n / 2, spec = accelerationKernels();
const at = (a, i = center, p = 3) => reconstructedAccelerationAt(a, fs, i, p, spec);

// Polynomial-moment invariants: exact constant/linear null and quadratic
// acceleration, including fractional phases. Low-frequency error is otherwise
// amplified by the fs² term and could trigger bogus cutter protection.
const constant = new Float64Array(n).fill(0.00003);
const linear = Float64Array.from({ length: n }, (_, i) => (i - center) * 1e-9);
const quadratic = Float64Array.from({ length: n }, (_, i) => (i - center) ** 2 * 1e-10);
for (let p = 0; p < spec.phases; p++) {
  assert.ok(Math.abs(at(constant, center, p)) < 1e-7, 'DC must have zero acceleration');
  assert.ok(Math.abs(at(linear, center, p)) < 1e-7, 'Linear displacement must have zero acceleration');
  assert.ok(Math.abs(at(quadratic, center, p) - 2e-10 * fs * fs) < 1e-5,
    'Quadratic displacement second derivative must be correct');
}

// Independent infinite-sine analytic derivative. Only analyze the interior
// of a long synthetic sine, not the artificial start/end of a finite buffer.
for (const f of [100, 1000, 6000, 16000, 20000]) {
  const wave = Float32Array.from({ length: n }, (_, i) =>
    1e-5 * Math.sin(2 * Math.PI * f * i / fs));
  let measured = 0;
  for (let i = center - 700; i < center + 700; i++) {
    for (let p = 0; p < spec.phases; p++) {
      measured = Math.max(measured, Math.abs(at(wave, i, p)));
    }
  }
  const expected = 1e-5 * (2 * Math.PI * f) ** 2;
  assert.ok(Math.abs(measured / expected - 1) < 0.01,
    `${f} Hz reconstructed acceleration error: ${measured / expected}`);
}

// Original 16 kHz failure: sampled finite differences underestimate the
// reconstructed sine acceleration by ~1.46×. New output guard uses the latter.
const legacy = cut(testSignal('left', fs, 2), fs, { accelMode: 'legacy' });
const guarded = cut(testSignal('left', fs, 2), fs);
assert.ok(legacy.acceleration.reconstructedAfter > legacy.acceleration.sampledAfter * 1.4);
assert.equal(guarded.acceleration.domain, 'reconstructed');
assert.ok(guarded.acceleration.reconstructedAfter <= 12000);
assert.ok(guarded.acceleration.sampledAfter <= guarded.acceleration.reconstructedAfter);
assert.equal(guarded.acceleration.reconstructionPhases, 8);

// Audit the corrected geometry with a finer, independent 16-phase,
// longer kernel. This checks interpolation-grid misses, not real cutter safety.
const finer = peakReconstructedAcceleration(guarded.wallIn, guarded.wallOut, fs,
  accelerationKernels({ phases: 16, radius: 24 }));
assert.ok(finer.peak < 12000, `Independent finer estimator exceeded the grid bound: ${finer.peak}`);
assert.throws(() => accelerationKernels({ phases: 0 }), RangeError);
console.log('reconstructed acceleration: polynomial moments, analytic sines, 16k guard and 16-phase audit pass');
