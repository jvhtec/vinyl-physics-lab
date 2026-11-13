// Bandlimited reconstruction of GROOVE DISPLACEMENT and its second time
// derivative. The estimator evaluates a windowed ideal sinc derivative at
// fractional sample positions. This is a reconstruction MODEL, not a measured
// cutter-head acceleration, and not a mathematically certified supremum
// between its evaluation points.
//
// x(t) = sum_n x[n] sinc(fs*t - n)
// d²x/dt² = fs² sum_n x[n] sinc''(fs*t - n)
//
// sinc''(u) = -pi*sin(pi*u)/u - 2*cos(pi*u)/u²
//              + 2*sin(pi*u)/(pi*u³), sinc''(0) = -pi²/3.
// A finite Blackman window suppresses truncation ringing. We correct its
// zeroth, first and second polynomial moments per phase. That guarantees
// zero acceleration for constant and linear displacement, and correct
// acceleration for quadratic displacement, which is essential to avoid
// huge relative errors at low frequencies.
const PI = Math.PI;

function sincSecond(u) {
  if (Math.abs(u) < 1e-4) {
    const u2 = u * u;
    return -(PI * PI) / 3 + (PI ** 4) * u2 / 10
      - (PI ** 6) * u2 * u2 / 168;
  }
  const p = PI * u;
  return (-PI * Math.sin(p) / u) - (2 * Math.cos(p) / (u * u))
    + (2 * Math.sin(p) / (PI * u * u * u));
}

export function accelerationKernels({ phases = 8, radius = 16 } = {}) {
  if (!Number.isInteger(phases) || phases < 1 || phases > 16 ||
      !Number.isInteger(radius) || radius < 6 || radius > 48) {
    throw new RangeError('Invalid reconstruction kernel geometry');
  }
  const span = radius * 2 + 1, kernels = [];
  for (let p = 0; p < phases; p++) {
    const offset = p / phases, k = new Float64Array(span);
    let m0 = 0, m1 = 0, m2 = 0;
    for (let j = -radius; j <= radius; j++) {
      const u = offset - j;
      const f = Math.abs(u) / (radius + 0.5);
      const blackman = f >= 1 ? 0
        : 0.42 + 0.5 * Math.cos(PI * f) + 0.08 * Math.cos(2 * PI * f);
      const v = sincSecond(u) * blackman;
      k[j + radius] = v;
      m0 += v;
      m1 += j * v;
      m2 += j * j * v;
    }
    const e0 = -m0, e1 = -m1, e2 = 2 - m2;
    // Local, three-tap polynomial moment correction. Distributing the
    // correction over distant taps instead would disturb audio-band accuracy
    // by turning a tiny truncated-sinc error into a long-range ripple.
    k[radius - 1] += (e2 - e1) / 2;
    k[radius] += e0 - e2;
    k[radius + 1] += (e2 + e1) / 2;
    kernels.push(k);
  }
  return { phases, radius, kernels };
}

export function forEachReconstructedAcceleration(left, right, fs, spec, onSample) {
  if (!Number.isFinite(fs) || fs <= 0 || left.length !== right.length ||
      !left.length || typeof onSample !== 'function') {
    throw new RangeError('Invalid reconstruction input');
  }
  const { radius, kernels, phases } = spec;
  const n = left.length, fs2 = fs * fs;
  for (let i = 0; i < n - 1; i++) {
    const lo = Math.max(-radius, -i), hi = Math.min(radius, n - 1 - i);
    for (let p = 0; p < phases; p++) {
      const k = kernels[p];
      let a = 0, b = 0;
      for (let j = lo; j <= hi; j++) {
        const w = k[j + radius];
        a += left[i + j] * w;
        b += right[i + j] * w;
      }
      // Constant endpoint continuation (not zero padding) avoids treating
      // an arbitrary DC groove offset as an infinite boundary transient.
      for (let j = -radius; j < lo; j++) {
        const w = k[j + radius];
        a += left[0] * w;
        b += right[0] * w;
      }
      for (let j = hi + 1; j <= radius; j++) {
        const w = k[j + radius];
        a += left[n - 1] * w;
        b += right[n - 1] * w;
      }
      if (onSample(i, p, a * fs2, b * fs2) === false) return;
    }
  }
}

export function peakReconstructedAcceleration(left, right, fs, spec = accelerationKernels()) {
  if (![left[0], right[0], left.at(-1), right.at(-1)].every(Number.isFinite)) {
    throw new RangeError('Non-finite groove input');
  }
  let peak = 0, index = -1, phase = 0, wall = '';
  forEachReconstructedAcceleration(left, right, fs, spec, (i, p, a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new RangeError('Non-finite reconstructed acceleration');
    }
    if (Math.abs(a) > peak) { peak = Math.abs(a); index = i; phase = p; wall = 'left'; }
    if (Math.abs(b) > peak) { peak = Math.abs(b); index = i; phase = p; wall = 'right'; }
  });
  return { peak, index, phase, wall, phases: spec.phases, radius: spec.radius };
}

// A local estimator for plotting a short excerpt. It uses the SAME kernels
// as the full-cut guard but does not sweep unrelated parts of a record.
export function reconstructedAccelerationAt(wave, fs, index, phase, spec = accelerationKernels()) {
  if (!Number.isInteger(index) || !Number.isInteger(phase) ||
      phase < 0 || phase >= spec.phases || !Number.isFinite(fs) || fs <= 0) {
    throw new RangeError('Invalid reconstructed position');
  }
  const k = spec.kernels[phase];
  let sum = 0;
  for (let j = -spec.radius; j <= spec.radius; j++) {
    const n = Math.max(0, Math.min(wave.length - 1, index + j));
    sum += wave[n] * k[j + spec.radius];
  }
  return sum * fs * fs;
}
