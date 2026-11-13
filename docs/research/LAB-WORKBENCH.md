# Vinyl Physics Lab: measurement workbench, round 2

Date: 2026-11-13
Implementation: `src/lab-measure.js`, `src/lab-ui.js`, `src/lab-worker.js`,
`scripts/serve.mjs`; test coverage in `test/lab-measure.mjs`.

## Architecture

The attractive upstream WebGL deck is unchanged. **Lab** opens a separate
panel for measurements. Cartridge changes are synchronized both ways between
the record player and the workbench. The workbench's electrical sweep runs
on the main thread (201 scalar response points), while the cutting bench
creates a fresh 5-second, 48 kHz stereo test tone in an independent module
Worker. The worker calls the real `src/cut.js` before *any* pressing is applied,
and transfers only a compact summary, not the live record's large wall arrays.

`npm run dev` serves the sources without a package/bundler or LP media assets.
Open `http://127.0.0.1:3000/?lab` to load the short reference disc and the Lab
panel by default. Regular upstream mode is unchanged.

## Measurements and provenance

**Cartridge:** `src/cartridge-electrical.js` exposes the continuous network
`H(s)/H(0)`, while `cartridgeBiquad()` is the actual digital coefficient
generator used in the AudioWorklet. The plotted digital response evaluates
`H(e^jw)` directly from these coefficients. Example for a 48 kHz audio
device: the oversampled generator runs at 384 kHz. Digital/analogue differences
at 20 kHz reflect bilinear frequency warping and are *not* measured cartridge
errors. Both curves are normalized to DC. The absolute DC voltage divider
loss is shown separately and is not currently applied in the listening engine.

**Groove:** with cutter wall displacements `u = wallIn` and
`v = wallOut`, the 45/45 convention in the existing renderer gives
`x_lateral = (u - v)/sqrt(2)` and `z_vertical = (u + v)/sqrt(2)`.
Peak wall velocity and acceleration use centered first/second finite
differences on the output wall displacements in metres at 48 kHz. They are
sampled geometrical estimates, not real cutting-head force/temperature data.

**Adjacent-turn minimum land:** for an earlier, radially outer turn at
angle `θ` and its next (inner) turn `θ + 2π`:

`land(θ) = r(θ) - r(θ + 2π) - 2W + sqrt(2)[u(θ) + v(θ+2π)]`.

Here `W` is the existing unmodulated groove top half-width. We inspect
every sample for which *both* turns are within the synthetic programme,
and also report the minimum by turn and the radial centre pitch.
The line marked 15 µm is `LAND_MIN` from `src/geometry.js`, a
**model target**, not a documented universal lathe manufacturing threshold.
Landing on a positive margin in this simulation does not demonstrate
physical lacquer-cutting feasibility.

## Deterministic reference results

With all default cutter controls (wall reference velocity 0.14 m/s,
elliptical corner 150 Hz, acceleration target 12,000 m/s²):

| Synthetic programme | Peak lateral | Peak vertical | Min model land | Peak wall acceleration | HF attenuation |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 kHz lateral, L = R | ~31.67 µm | 0 µm | ~116.95 µm | ~881 m/s² | 0 dB |
| 100 Hz vertical, L = -R | 0 µm | ~68.29 µm | ~84.99 µm | ~12 m/s² | 0 dB |
| 16 kHz left only | ~3.15 µm | ~3.05 µm | ~85.10 µm | **~30,309 m/s²** | ~14.25 dB |

Values refer to the **simulated clean cut at 48 kHz** using the current
source model, not physical measurements. Numerical tolerances and
45/45 sign conventions have regression coverage.

### Important falsification: acceleration target is not a hard ceiling

The original `cut.js` applies `deEss()` to a band above approximately
3 kHz *before* integrating the RIAA-preemphasized signal into wall
displacement. For a 16 kHz left-channel stimulus, the resulting wall
acceleration by second finite difference is approximately **2.53 times**
the requested 12,000 m/s² target. De-essing is active, but the
output does not obey that ceiling. The panel explicitly warns whenever
the actual computed wall acceleration exceeds the requested setting.
We have **not** altered `deEss()` or called it a cutting safety limiter.

Next experiment: instrument the pre- and post-RIAA highband transfer,
find the envelope/normalization discrepancy, and enforce an explicit
post-cut geometrical acceleration constraint with repeatable energy
and distortion tests before considering physical cutting parameters.

## CSV data contract

- `cartridge-electrical-sweep.csv`: one frequency row with
  `frequencyHz,analogueDb,digitalDb,analoguePhaseDeg,digitalPhaseDeg`;
  initial comment lines state R/L/C and internal sample rate.
- `groove-test-cut.csv`: a single rectangular table, with `kind` of
  `waveform` or `pitch` and columns
  `timeMs,lateralUm,verticalUm,revolution,radiusMm,pitchUm,minLandUm,landTargetUm`;
  metadata comments record the exact scenario and cutting control values.

No source audio, manufactured cartridge presets, proprietary plugin data
or vendor binaries are committed.

## Next blocks

1. Convert the overshoot discovery into a verified *output-constrained*
   high-frequency cutter model, with waveform/phase error plots.
2. Add a real audio-file cutting analysis path without duplicating
   full LP side wall arrays on the UI thread.
3. Build a physical mechanical cartridge and cantilever resonance bench
   using calibrated measurements, retaining the electrical model as a layer.
4. Validate SimuLathe and Abbey Road Vinyl as black-box references inside
   REAPER, not as presumed physical ground truth.
