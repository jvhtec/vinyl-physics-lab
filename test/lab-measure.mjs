import assert from 'node:assert/strict';
import { cut } from '../src/cut.js';
import { LAND_MIN, TAB_PER_REV, GROOVE_W } from '../src/geometry.js';
import { cartridgeBiquad } from '../src/cartridge-electrical.js';
import {
  electricalSweep, biquadResponse, testSignal, summarizeCleanCut, exportCsv,
} from '../src/lab-measure.js';

const near = (got, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(got - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `expected ${expected}, got ${got}`);

// A) Check plotted digital filter against the exact network at DC and at one kHz,
// then verify that it differs from the analogue network near Nyquist.
const sweep = electricalSweep({ model: 'ortofon2mred', capacitancePf: 220, resistanceKOhm: 47 });
assert.equal(sweep.rows.length, 201);
assert.ok(sweep.rows.every(r => Number.isFinite(r.analogueDb) && Number.isFinite(r.digitalDb)
  && Number.isFinite(r.analoguePhaseDeg) && Number.isFinite(r.digitalPhaseDeg)));
near(biquadResponse(cartridgeBiquad(sweep.internalFs, {
  Lc: sweep.LcH, Rc: sweep.RcOhm, Cl: 220e-12, Rl: 47000,
}), 0, sweep.internalFs).magnitude, 1, 1e-8);
const idx1k = sweep.rows.reduce((best, r, i) =>
  Math.abs(r.frequencyHz - 1000) < Math.abs(sweep.rows[best].frequencyHz - 1000) ? i : best, 0);
assert.ok(Math.abs(sweep.rows[idx1k].analogueDb - sweep.rows[idx1k].digitalDb) < .01);
const at20k = sweep.rows.at(-1);
assert.ok(Math.abs(at20k.analogueDb - at20k.digitalDb) > .05);
assert.ok(Math.abs(at20k.analogueDb - at20k.digitalDb) < .4);
const cap50 = electricalSweep({ model: 'ortofon2mred', capacitancePf: 50 }).rows.at(-1).analogueDb;
const cap500 = electricalSweep({ model: 'ortofon2mred', capacitancePf: 500 }).rows.at(-1).analogueDb;
assert.ok(Math.abs(cap50 - cap500) > 3, 'Cable capacitance must alter MM response');
assert.throws(() => electricalSweep({ model: 'unknown' }), RangeError);
assert.throws(() => biquadResponse([1, 0, 0, 0, 0], 24000, 48000), RangeError);

// B) Verify independent 45/45 geometry on a manufactured pair of perfectly
// concentric, flat grooves, and signed land clearance under wall excursions.
const fs = 48000, spr = fs * 1.8;
const rTab = Float64Array.from({ length: 4 * TAB_PER_REV + 1 },
  (_, i) => .146 - .0001 * i / TAB_PER_REV);
const simple = {
  fs, spr, W: GROOVE_W, thetaEnd: 4 * Math.PI * 2, rTab,
  wallIn: new Float32Array(4 * spr), wallOut: new Float32Array(4 * spr),
  tracks: [{ theta0: 1 * Math.PI * 2, theta1: 3 * Math.PI * 2 }], deEssDb: 0,
};
let measured = summarizeCleanCut(simple);
near(measured.minLandUm, 100 - 2 * GROOVE_W * 1e6, 1e-4);
near(measured.minRequiredLandUm, LAND_MIN * 1e6);
near(measured.peakLateralUm, 0); near(measured.peakVerticalUm, 0);
assert.ok(measured.pitch.every(r => Math.abs(r.pitchUm - 100) < .01));
near(Math.min(...measured.pitch.filter(x => x.minLandUm != null).map(x => x.minLandUm)), measured.minLandUm);
assert.ok(measured.pitch.every(r => r.landTargetUm === measured.minRequiredLandUm));
simple.wallIn.fill(-4e-6); simple.wallOut.fill(-3e-6);
measured = summarizeCleanCut(simple);
near(measured.minLandUm, 40 - Math.SQRT2 * 7, .01);

// C) The cutter is not yet a safety-rated acceleration limiter. The 16 kHz
// diagnostic deliberately exposes (and retains) measured overshoot.
const lateral = summarizeCleanCut(cut(testSignal('lateral', fs), fs));
const vertical = summarizeCleanCut(cut(testSignal('vertical', fs), fs));
const high = summarizeCleanCut(cut(testSignal('left', fs), fs));
assert.ok(lateral.peakLateralUm > 15 && lateral.peakVerticalUm < 1e-4);
assert.ok(vertical.peakVerticalUm > 20 && vertical.peakLateralUm < 1e-4);
assert.ok(high.peakLateralUm > 0 && high.peakVerticalUm > 0);
assert.ok(lateral.pitch.length > 1 && lateral.clearanceEvaluated);
assert.ok(lateral.minLandUm >= LAND_MIN * 1e6, 'Nominal synthetic lateral cut preserves model land');
assert.ok(high.peakWallAccelerationMs2 > 12000, 'Expose the current de-esser target overshoot');
assert.ok(high.deEssDb > 0);

// D) Machine-readable export includes units in column names and standard CSV
// quoting/CRLF with no detached ArrayBuffers.
const csv = exportCsv([{ frequencyHz: 1000, label: 'test, "A"' }], ['frequencyHz', 'label']);
assert.equal(csv, 'frequencyHz,label\r\n1000,"test, ""A"""\r\n');
assert.throws(() => exportCsv([], []), TypeError);
console.log('lab measurements: biquad/analogue, 45/45 geometry, cutter risk and CSV pass');
