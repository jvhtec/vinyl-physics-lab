// Linear cartridge generator loading. SI units throughout.
//
// An ideal velocity source is followed by coil impedance Rc + s*Lc. The load is
// Rl in parallel with cable/preamp capacitance Cl. This describes the ELECTRICAL
// part of the generator only, not its mechanical frequency response, output
// sensitivity, channel separation, hum, or phono-stage noise.
import { TAU, bilinear } from './dsp.js';

export const MM_ELECTRICAL_PRESETS = Object.freeze({
  demo: Object.freeze({ label: 'Vinyl GL demo MM', Lc: 0.45, Rc: 600 }),
  ortofon2mred: Object.freeze({ label: 'Ortofon 2M Red (electrical)', Lc: 0.700, Rc: 1300 }),
  atvm95e: Object.freeze({ label: 'Audio-Technica VM95E (electrical)', Lc: 0.550, Rc: 485 }),
});

export function electricalConstants({ Lc, Rc, Cl, Rl }) {
  if (![Lc, Rc, Cl, Rl].every(Number.isFinite) || Lc <= 0 || Rc < 0 || Cl < 0 || Rl <= 0) {
    throw new RangeError('Cartridge electrical values must be finite with Lc>0, Rc>=0, Cl>=0, Rl>0');
  }
  // H(s) = H0 / (1 + t1*s + t2*s^2)
  // H0 = Rl / (Rl + Rc), t1 = (Lc/Rl + Rc*Cl)/(1+Rc/Rl), t2 = Lc*Cl/(1+Rc/Rl).
  const k = 1 + Rc / Rl;
  return { h0: 1 / k, t1: (Lc / Rl + Rc * Cl) / k, t2: Lc * Cl / k };
}

export function cartridgeBiquad(fs, electrical, { normalizeDC = true } = {}) {
  if (!Number.isFinite(fs) || fs <= 0) throw new RangeError('Sample rate must be positive');
  const { h0, t1, t2 } = electricalConstants(electrical);
  // Original Vinyl GL normalizes the network's DC gain to unity. Keep that
  // default for backward-compatible listening until absolute calibration exists.
  return bilinear([normalizeDC ? 1 : h0, 0, 0], [1, t1, t2], fs);
}

// The continuous-time response, useful for independent sweeps and model fitting.
export function cartridgeResponse(fHz, electrical, { normalizeDC = false } = {}) {
  if (!Number.isFinite(fHz) || fHz < 0) throw new RangeError('Frequency must be nonnegative');
  const { h0, t1, t2 } = electricalConstants(electrical);
  const w = TAU * fHz, reDen = 1 - w * w * t2, imDen = w * t1;
  const d = reDen * reDen + imDen * imDen, num = normalizeDC ? 1 : h0;
  const re = num * reDen / d, im = -num * imDen / d;
  return { re, im, magnitude: Math.hypot(re, im), phaseRad: Math.atan2(im, re) };
}
