// Pure, deterministic measurement helpers for the separate Vinyl Physics Lab.
// Units: SI internally, with explicit display/export conversions.
import { TAU } from './dsp.js';
import { grooveRadius, LAND_MIN } from './geometry.js';
import { cartridgeBiquad, cartridgeResponse, electricalConstants, MM_ELECTRICAL_PRESETS } from './cartridge-electrical.js';
import { accelerationKernels, reconstructedAccelerationAt } from './reconstructed-acceleration.js';

// This evaluates the exact digital network used by Engine (an oversampled bilinear
// biquad), not an approximate plot of the analogue prototype.
export function biquadResponse(coeffs, frequencyHz, sampleRate) {
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0 || frequencyHz >= sampleRate / 2) {
    throw new RangeError('Biquad response must be evaluated below Nyquist');
  }
  const [b0, b1, b2, a1, a2] = coeffs, theta = TAU * frequencyHz / sampleRate;
  const c1 = Math.cos(theta), s1 = Math.sin(theta), c2 = Math.cos(2 * theta), s2 = Math.sin(2 * theta);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -b1 * s1 - b2 * s2;
  const dr = 1 + a1 * c1 + a2 * c2, di = -a1 * s1 - a2 * s2;
  const den = dr * dr + di * di;
  const re = (nr * dr + ni * di) / den, im = (ni * dr - nr * di) / den;
  return { re, im, magnitude: Math.hypot(re, im), phaseRad: Math.atan2(im, re) };
}

export function electricalSweep({ model = 'demo', capacitancePf = 200, resistanceKOhm = 47,
  outputSampleRate = 48000, points = 201 } = {}) {
  if (!(model in MM_ELECTRICAL_PRESETS)) throw new RangeError('Unknown electrical cartridge model');
  if (!Number.isInteger(points) || points < 2 || points > 4096) throw new RangeError('Invalid sweep length');
  if (!Number.isFinite(outputSampleRate) || outputSampleRate < 40000) throw new RangeError('Invalid output rate');
  const OS = Math.max(2, Math.min(8, Math.ceil(340000 / outputSampleRate)));
  const internalFs = OS * outputSampleRate;
  const p = { ...MM_ELECTRICAL_PRESETS[model], Cl: capacitancePf * 1e-12, Rl: resistanceKOhm * 1000 };
  const dc = electricalConstants(p).h0;
  const coefficients = cartridgeBiquad(internalFs, p, { normalizeDC: true });
  const f0 = 20, f1 = Math.min(20000, outputSampleRate * 0.45);
  const rows = [];
  for (let i = 0; i < points; i++) {
    const frequencyHz = f0 * (f1 / f0) ** (i / (points - 1));
    const analogue = cartridgeResponse(frequencyHz, p, { normalizeDC: true });
    const digital = biquadResponse(coefficients, frequencyHz, internalFs);
    rows.push({
      frequencyHz,
      analogueDb: 20 * Math.log10(analogue.magnitude),
      digitalDb: 20 * Math.log10(digital.magnitude),
      analoguePhaseDeg: analogue.phaseRad * 180 / Math.PI,
      digitalPhaseDeg: digital.phaseRad * 180 / Math.PI,
    });
  }
  return { model, label: p.label, RcOhm: p.Rc, LcH: p.Lc, capacitancePf,
    resistanceKOhm, dcDb: 20 * Math.log10(dc), internalFs, outputSampleRate, rows };
}

// Synthetic, source-independent test signals. A smooth fade avoids counting
// file-boundary discontinuities as cutter transients.
export const CUT_SCENARIOS = Object.freeze({
  lateral: Object.freeze({ label: '1 kHz lateral (mono)', frequencyHz: 1000 }),
  vertical: Object.freeze({ label: '100 Hz vertical (L=-R)', frequencyHz: 100 }),
  mid: Object.freeze({ label: '6 kHz left only (harmonics measurable)', frequencyHz: 6000 }),
  left: Object.freeze({ label: '16 kHz left only', frequencyHz: 16000 }),
});
export function testSignal(scenario = 'lateral', fs = 48000, seconds = 5) {
  const spec = CUT_SCENARIOS[scenario];
  if (!spec || !Number.isInteger(fs) || fs < 32000 || fs > 192000 ||
      !Number.isFinite(seconds) || seconds < 2 || seconds > 15) throw new RangeError('Invalid test cut');
  const n = Math.round(fs * seconds), L = new Float32Array(n), R = new Float32Array(n);
  const fade = Math.max(1, Math.round(0.01 * fs));
  for (let i = 0; i < n; i++) {
    const envelope = Math.min(1, i / fade, (n - 1 - i) / fade);
    const v = 0.25 * Math.max(0, envelope) * Math.sin(TAU * spec.frequencyHz * i / fs);
    L[i] = v;
    R[i] = scenario === 'vertical' ? -v : scenario === 'lateral' ? v : 0;
  }
  return [{ title: spec.label, L, R }];
}

// Analyze the CLEAN CUT before the pressing step. Two consecutive revolutions
// at the same disc angle must not overlap. With r_outer > r_inner:
//
// land = [r_outer - W + sqrt(2)*innerWall_outerTurn]
//      - [r_inner + W - sqrt(2)*outerWall_innerTurn]
//
// This is a geometrical clearance estimate using exactly the 45/45 convention
// of src/engine.js; it is NOT a calibrated groove-wall/pressing safety certificate.
export function summarizeCleanCut(rec, { windowMs = 12 } = {}) {
  const { wallIn, wallOut, spr, fs, rTab } = rec;
  if (!wallIn || !wallOut || !rTab || !Number.isFinite(fs) || fs <= 0 || !Number.isFinite(spr) || spr <= 0) {
    throw new TypeError('Expected original clean cut geometry');
  }
  const track = rec.tracks?.[0];
  if (!track) throw new RangeError('The cut needs a programme track');
  const i0 = Math.max(2, Math.ceil(track.theta0 * spr / TAU));
  const i1 = Math.min(wallIn.length - 2, Math.floor(track.theta1 * spr / TAU));
  if (i1 - i0 < 16) throw new RangeError('Programme too short for metrics');
  const consecutive = Math.round(spr);
  if (Math.abs(consecutive - spr) > 1e-6) throw new RangeError('This bench requires integer samples per revolution');

  let peakLateral = 0, peakVertical = 0, peakVelocity = 0, peakAcceleration = 0;
  let minLand = Infinity, landSamples = 0;
  const landByRev = new Map();
  const root2 = Math.SQRT2;
  for (let i = i0; i < i1; i++) {
    // lateral x = (wallIn - wallOut)/sqrt(2), vertical z = (wallIn + wallOut)/sqrt(2)
    const a = wallIn[i], b = wallOut[i];
    peakLateral = Math.max(peakLateral, Math.abs((a - b) / root2));
    peakVertical = Math.max(peakVertical, Math.abs((a + b) / root2));
    const va = (wallIn[i + 1] - wallIn[i - 1]) * 0.5 * fs;
    const vb = (wallOut[i + 1] - wallOut[i - 1]) * 0.5 * fs;
    peakVelocity = Math.max(peakVelocity, Math.abs(va), Math.abs(vb));
    const aa = (wallIn[i + 1] - 2 * a + wallIn[i - 1]) * fs * fs;
    const ab = (wallOut[i + 1] - 2 * b + wallOut[i - 1]) * fs * fs;
    peakAcceleration = Math.max(peakAcceleration, Math.abs(aa), Math.abs(ab));
    if (i + consecutive < i1) {
      const theta = i * TAU / spr;
      const gap = grooveRadius(rTab, theta) - grooveRadius(rTab, theta + TAU)
        - 2 * rec.W + root2 * (wallIn[i] + wallOut[i + consecutive]);
      minLand = Math.min(minLand, gap);
      landSamples++;
      const rev = Math.floor(i / spr);
      landByRev.set(rev, Math.min(landByRev.get(rev) ?? Infinity, gap));
    }
  }

  const startRev = Math.floor(i0 / spr), endRev = Math.ceil(i1 / spr);
  const pitch = [];
  for (let k = startRev; k < endRev; k++) {
    const theta = k * TAU;
    if (theta + TAU >= rec.thetaEnd) break;
    pitch.push({ revolution: k, radiusMm: grooveRadius(rTab, theta) * 1000,
      pitchUm: (grooveRadius(rTab, theta) - grooveRadius(rTab, theta + TAU)) * 1e6,
      minLandUm: landByRev.has(k) ? landByRev.get(k) * 1e6 : null,
      landTargetUm: LAND_MIN * 1e6 });
  }
  const width = Math.max(16, Math.round(windowMs * 1e-3 * fs));
  const first = Math.min(i1 - width - 1, i0 + Math.round(fs));
  const stride = Math.max(1, Math.ceil(width / 550));
  const waveform = [];
  for (let j = 0; j < width; j += stride) {
    const i = first + j;
    waveform.push({ timeMs: j / fs * 1000,
      lateralUm: (wallIn[i] - wallOut[i]) / root2 * 1e6,
      verticalUm: (wallIn[i] + wallOut[i]) / root2 * 1e6 });
  }
  return {
    sampleRate: fs, programSeconds: (i1 - i0) / fs, deEssDb: rec.deEssDb,
    truncated: !!rec.truncated, clearanceEvaluated: landSamples > 0,
    minLandUm: landSamples ? minLand * 1e6 : null,
    minRequiredLandUm: LAND_MIN * 1e6,
    peakLateralUm: peakLateral * 1e6, peakVerticalUm: peakVertical * 1e6,
    peakWallVelocityCms: peakVelocity * 100, peakWallAccelerationMs2: peakAcceleration,
    acceleration: rec.acceleration ?? null, pitch, waveform,
  };
}

// Lock-in analysis on an integer number of steady-state cycles of the
// synthetic programme. Coherent complex amplitudes reveal magnitude/phase
// changes separately from added harmonics. There are NO resolvable harmonics
// for 16 kHz at 48 kHz: returning null is intentional, not a claimed 0% THD.
export function measureCutTone(rec, frequencyHz, { offsetSeconds = 1, durationSeconds = 2 } = {}) {
  const { fs, wallIn, wallOut } = rec;
  const mark = rec.tracks?.[0];
  if (!mark || !Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz >= fs / 2) {
    throw new RangeError('Expected a tone and its corresponding clean cut');
  }
  const start = Math.round(mark.theta0 * rec.spr / TAU + offsetSeconds * fs);
  const end = Math.min(wallIn.length, Math.round(start + durationSeconds * fs),
    Math.floor(mark.theta1 * rec.spr / TAU));
  const n = end - start;
  if (n < fs / 4 || Math.abs(frequencyHz * n / fs - Math.round(frequencyHz * n / fs)) > 1e-6) {
    throw new RangeError('Tone analysis requires an integer number of cycles');
  }
  const harmonic = (signal, multiple) => {
    const frequency = multiple * frequencyHz, omega = TAU * frequency / fs;
    let re = 0, im = 0, total = 0, sum = 0;
    for (let i = start; i < end; i++) {
      const y = signal[i];
      re += y * Math.cos(omega * (i - start));
      im -= y * Math.sin(omega * (i - start));
      total += y * y;
      sum += y;
    }
    const factor = 2 / n;
    return { re: re * factor, im: im * factor, amplitude: Math.hypot(re, im) * factor,
      acRms: Math.sqrt(Math.max(0, total / n - (sum / n) ** 2)) };
  };
  const analyze = (signal) => {
    const fundamental = harmonic(signal, 1);
    let power = 0, harmonics = 0;
    for (let h = 2; h * frequencyHz < fs * 0.45; h++) {
      const v = harmonic(signal, h).amplitude;
      power += v * v;
      harmonics++;
    }
    // THD can't be inferred if all harmonics are at/above the usable Nyquist.
    const thdDb = harmonics && fundamental.amplitude > 1e-20
      ? 10 * Math.log10(power / (fundamental.amplitude ** 2) + 1e-30)
      : null;
    // Residual includes all modulation/noise/distortion not explained by the
    // fundamental, not just harmonic products (relevant to the 16 kHz case).
    const unexplainedRms = Math.sqrt(Math.max(0,
      fundamental.acRms ** 2 - fundamental.amplitude ** 2 / 2));
    const residualDb = fundamental.amplitude > 1e-20
      ? 20 * Math.log10(Math.max(unexplainedRms, 1e-20) /
        (fundamental.amplitude / Math.SQRT2)) : null;
    return { ...fundamental, phaseDeg: Math.atan2(fundamental.im, fundamental.re) * 180 / Math.PI,
      thdDb, residualDb };
  };
  return { left: analyze(wallIn), right: analyze(wallOut), frequencyHz, cycles: frequencyHz * n / fs };
}

export function compareCleanCuts(legacy, bounded, frequencyHz) {
  if (legacy.fs !== bounded.fs || legacy.spr !== bounded.spr) {
    throw new RangeError('Cut comparison requires equal sample rate and rotational mapping');
  }
  const before = measureCutTone(legacy, frequencyHz);
  const after = measureCutTone(bounded, frequencyHz);
  const channels = {};
  for (const channel of ['left', 'right']) {
    const a = before[channel], b = after[channel];
    // Phase is undefined for a vanishing channel. Do not report an unstable
    // angle as a physical phase shift for an absent stereo component.
    const usable = a.amplitude > Math.max(before.left.amplitude, before.right.amplitude) * 1e-4;
    let phaseShiftDeg = usable
      ? Math.atan2(Math.sin((b.phaseDeg - a.phaseDeg) * Math.PI / 180),
        Math.cos((b.phaseDeg - a.phaseDeg) * Math.PI / 180)) * 180 / Math.PI
      : null;
    if (phaseShiftDeg != null && Math.abs(phaseShiftDeg) < 1e-12) phaseShiftDeg = 0;
    channels[channel] = {
      amplitudeBefore: a.amplitude, amplitudeAfter: b.amplitude,
      gainDeltaDb: usable && b.amplitude > 0 ? 20 * Math.log10(b.amplitude / a.amplitude) : null,
      phaseShiftDeg, thdBeforeDb: a.thdDb, thdAfterDb: b.thdDb,
      residualBeforeDb: a.residualDb, residualAfterDb: b.residualDb,
    };
  }
  return { channels, harmonicMeasurementAvailable: frequencyHz * 2 < legacy.fs * 0.45,
    frequencyHz, legacyAcceleration: legacy.acceleration, boundedAcceleration: bounded.acceleration };
}

export function accelerationOverlay(legacy, bounded, { windowMs = 6, points = 512 } = {}) {
  if (legacy.fs !== bounded.fs) throw new RangeError('Sample rates differ');
  const fs = legacy.fs;
  const track = legacy.tracks[0];
  const from = Math.round(track.theta0 * legacy.spr / TAU + fs);
  const count = Math.max(2, Math.round(windowMs * 0.001 * fs));
  const stride = Math.max(1, Math.ceil(count / points));
  const rows = [];
  const kernels = accelerationKernels();
  const accel = (rec, i) => {
    const { wallIn: a, wallOut: b } = rec;
    return Math.max(
      Math.abs((a[i + 1] - 2 * a[i] + a[i - 1]) * fs * fs),
      Math.abs((b[i + 1] - 2 * b[i] + b[i - 1]) * fs * fs));
  };
  const reconstructed = (rec, i) => {
    let peak = 0;
    for (let p = 0; p < kernels.phases; p++) {
      peak = Math.max(peak,
        Math.abs(reconstructedAccelerationAt(rec.wallIn, fs, i, p, kernels)),
        Math.abs(reconstructedAccelerationAt(rec.wallOut, fs, i, p, kernels)));
    }
    return peak;
  };
  for (let j = 0; j < count; j += stride) {
    const i = from + j;
    rows.push({ timeMs: j * 1000 / fs,
      legacyAcceleration: accel(legacy, i),
      boundedAcceleration: accel(bounded, i),
      legacyReconstructed: reconstructed(legacy, i),
      boundedReconstructed: reconstructed(bounded, i),
      targetAcceleration: bounded.acceleration?.target ?? null });
  }
  return rows;
}

export function exportCsv(rows, columns) {
  if (!Array.isArray(rows) || !Array.isArray(columns) || !columns.length) throw new TypeError('Invalid CSV input');
  const escapeCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return [columns.map(escapeCell).join(','), ...rows.map(row => columns.map(k => escapeCell(row[k])).join(','))].join('\r\n') + '\r\n';
}
