import assert from 'node:assert/strict';
import { bilinear } from '../src/dsp.js';
import { MM_ELECTRICAL_PRESETS, cartridgeBiquad, cartridgeResponse, electricalConstants } from '../src/cartridge-electrical.js';
import { Engine } from '../src/engine.js';

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const old = { Lc: 0.45, Rc: 600, Cl: 200e-12, Rl: 47000 };
const { h0, t1, t2 } = electricalConstants(old);
close(h0, 47000 / 47600);
close(cartridgeResponse(0, old).magnitude, h0);
close(cartridgeResponse(0, old, { normalizeDC: true }).magnitude, 1);

// Preserve the original demo network and its response, sample for sample.
const k = 1 + old.Rc / old.Rl;
const previous = bilinear([1, 0, 0], [1, (old.Lc / old.Rl + old.Rc * old.Cl) / k, old.Lc * old.Cl / k], 384000);
const current = cartridgeBiquad(384000, old);
previous.forEach((x, i) => close(x, current[i]));

// Validate against an independently calculated complex impedance divider.
const f = 17000, w = 2 * Math.PI * f, g = 1 / old.Rl;
const zLoadRe = g / (g * g + (w * old.Cl) ** 2);
const zLoadIm = -w * old.Cl / (g * g + (w * old.Cl) ** 2);
const zTotalRe = old.Rc + zLoadRe, zTotalIm = w * old.Lc + zLoadIm;
const den = zTotalRe ** 2 + zTotalIm ** 2;
const expectedRe = (zLoadRe * zTotalRe + zLoadIm * zTotalIm) / den;
const expectedIm = (zLoadIm * zTotalRe - zLoadRe * zTotalIm) / den;
const response = cartridgeResponse(f, old);
close(response.re, expectedRe); close(response.im, expectedIm);

// High inductance MM and low inductance MC behave differently electrically.
const mm = { ...MM_ELECTRICAL_PRESETS.ortofon2mred, Cl: 220e-12, Rl: 47000 };
const mc = { Lc: 25e-6, Rc: 12, Cl: 200e-12, Rl: 100 };
assert.ok(Math.abs(cartridgeResponse(16000, mm).magnitude - cartridgeResponse(16000, mc).magnitude) > 0.1);

// Prove the live engine receives presets and loads, without disturbing baseline.
const e = new Engine(48000);
previous.forEach((x, i) => close(x, e.lcr[i], 0.0001));
e.set({ cartridgeModel: 'ortofon2mred', capacitance: 220, loadResistanceKOhm: 47 });
close(e.p.Lc, .7); close(e.p.Rc, 1300); close(e.p.Cl, 220e-12); close(e.p.Rl, 47000);
assert.notDeepEqual(e.lcr, previous);
assert.throws(() => electricalConstants({ ...old, Rl: 0 }), RangeError);
console.log('cartridge electrical model: baseline, network divider, MM/MC contrast and engine controls pass');
