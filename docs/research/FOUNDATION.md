# Vinyl Physics Lab: research baseline

Date: 2026-11-13
Code baseline: upstream [rauchg/vinyl](https://github.com/rauchg/vinyl), MIT for code.
Research method: published documentation, manufacturer specifications and **black-box** reference
listening/measurements. No proprietary SimuLathe/Waves binary/code in the repository.

## Starting inventory and fidelity limits

| Stage | Existing implementation | Important gap |
| --- | --- | --- |
| Cutting | `src/cut.js`: 45/45 displacement grooves, RIAA pre-emphasis/integration, 7 Hz HPF, bass elliptical EQ, ~3 kHz acceleration-aware de-essing, preview depth, per-turn variable pitch | No measured cutter-head/feedback or amplifier transfer, thermal model, real preview-head delay, lacquer rheology, stylus geometry calibration or validated safety margin |
| Pressing | `src/press.js`: seeded wall roughness, dust, scratches, warp, eccentricity and pre-echo geometry | No calibrated electroforming/pressing material process, mould shrinkage or time-varying wear |
| Stylus/playback | `src/groove.js`: finite-radius wall convolution; `engine-core.js`: 2-DOF tip, simplified Hertz contact, friction, tonearm/cantilever dynamics | Approximate scan footprint, simplified 3D contact and cantilever modes, uncertain compliance and damping, no manufacturer-measured transfer functions |
| Generator/preamp | Velocity pickup on two 45-degree axes; MM-like series L/R source into shunt cable C and resistive load; RIAA playback | No calibrated sensitivity, MC-specific generator, SUT/head amp, channel imbalance/crosstalk or nonideal phono stage. Baseline **normalizes DC electrical gain** |
| UI | WebGL2, AudioWorklet, user audio-to-groove worker; this fork adds MM coil profile and loading controls | Need engineering mode: microscope with calibrated axes, cutting-meter plots, a signal-chain A/B view, measurement/correction fitting |

Important implementation details:

- `src/dsp.js` uses the standard 3180/318/75 microsecond RIAA constants.
- `src/geometry.js` models a 12-inch disc, nominal 33 1/3 rpm, 90-degree V groove, 30 µm unmodulated top half-width, 15 µm minimum land. Parameters are design assumptions, **not universal mastering limits**.
- `src/cut.js` defaults: 0.14 m/s peak wall velocity (normalizing each input side), 12,000 m/s² acceleration ceiling, 150 Hz elliptical filter and roughly one revolution of pitch preview. Depth control operates on a 120 ms neighbourhood. All require validation against a real-world cutting workflow.
- `src/engine.js` picks roughly 340 kHz or higher internal oversampling via integer oversampling; `engine-core.js` then decimates into the AudioWorklet output.
- Some upstream tests are *instrumentation/printed response* rather than strict numerical pass/fail assertions. Extend with analytical and fixture-based checks.

## Electrical cartridge model: first concrete implementation

A linear open-circuit generator voltage `Eg` sees series coil `Zs = Rc + s Lc`; phono
load is `Zl = Rl / (1 + s Rl Cl)`. The delivered terminal voltage is

`Vout / Eg = Zl / (Zs + Zl) = H0 / (1 + t1*s + t2*s²)`,

with

- `H0 = Rl / (Rl + Rc)`
- `t1 = (Lc/Rl + Rc*Cl) / (1 + Rc/Rl)`
- `t2 = Lc*Cl / (1 + Rc/Rl)`

`src/cartridge-electrical.js` implements this as a continuous complex response and a
bilinear digital biquad. Unit tests independently check the complex voltage divider.
The current audio engine deliberately uses `H(s)/H(0)` to retain the original
listening level, so **it is not yet an absolute-voltage cartridge simulation**.
Loading with an MC cartridge also needs a fundamentally different generator
sensitivity and phono-gain path.

Manufacturer-derived, **electrical-only** reference datasets:

| Reference | Generator | Rc | Lc | Suggested Rl | Suggested total Cl |
| --- | --- | ---: | ---: | ---: | ---: |
| Vinyl GL baseline (illustrative, not a real product) | MM-like | 600 Ω | 450 mH | 47 kΩ | 200 pF default |
| Ortofon 2M Red | MM | 1,300 Ω | 700 mH | 47 kΩ | 150–300 pF |
| Audio-Technica AT-VM95E | VM / MM-like | 485 Ω | 550 mH | 47 kΩ | 100–200 pF |
| Audio-Technica AT-OC9XEN | low-output MC | 12 Ω | 25 µH | ≥100 Ω | no mandatory figure in consulted manual |

The latter MC is **research data only**. It is not exposed as a playable preset; treating
it like an MM generator would give a misleading output and sound.

Primary manufacturer sources:
- [Ortofon 2M Red](https://ortofon.com/products/2m-red)
- [Audio-Technica VM95 series electrical specifications](https://docs.audio-technica.com/us/Vol7.Capsulas_2024-Maio.pdf)
- [Audio-Technica AT-OC9XEN manual](https://docs.audio-technica.com/us/at_oc9xen_um.pdf)
- [Ortofon tonearm and compliance guidance](https://ortofon.com/pages/find-the-right-cartridge/)

Arm/cartridge resonance estimates require the **total effective mass** and the correct
low-frequency dynamic compliance. Do not substitute a 100 Hz compliance figure into a
10 Hz resonance calculation without measurement or a justified conversion.

## Comparator roles

**TDR SimuLathe REF 1.1.1 demo.** Reference for user-facing control ranges, groove
microscope, preview behaviour, gain and pitch monitoring, excursions and disc statistics.
Its no-time-limit demo disables parameter automation/state recall. We can examine its
published operating documentation and independently test representative stimuli, but do
not disassemble or copy the product. The licensed version is not required to begin.

- [Product and demo](https://www.tokyodawn.net/tdr-simulathe-ref/)
- [Operator manual](https://docs.tokyodawn.ru/simulathe-ref-manual/)

**Waves Abbey Road Vinyl (installed V15).** Listening and aesthetic reference for a
different goal: historical deck, recording/playback colour, mechanics and noise. It is
not a ground-truth physical groove measurement or substitute for cutter-head data.
Official reference: https://www.waves.com/plugins/abbey-road-vinyl

## Engineering programme

1. **Deterministic baselines.** Archive current 1 kHz output, 20 Hz–20 kHz response at
   outer/inner radii for the three styli, CPU cost, and known pressing seeds. Turn printed
   test output into numeric tolerance assertions.
2. **MM electrical bench.** Sweep 10 Hz–100 kHz with Rc, Lc, Rl, Cl and compare the
   analytic result, digital biquad and independently measured passive circuit response.
   Validate 1 kHz normalisation and step changes without pops.
3. **Mechanical cartridge bench.** Measure compliance at ~10 Hz and at audio frequencies,
   stylus+cantilever resonances, moving mass, damping, azimuth and VTF. Introduce
   calibrated cartridges only when these data are acquired.
4. **Cutter bench.** Derive lateral/vertical groove velocity and acceleration plus
   minimum land and wall/depth margins from the *actual cut*; drive plots with units
   µm, cm/s and m/s². Build a preview scheduler and calibrated servo/thermal model.
5. **Reference matrix.** For identical synthetic programme material, compare groove
   distance/time, RIAA gain, stereo elliptic filter, inner-groove HF loss, surface noise
   and physical load changes against sources whose equations or calibration are known.
6. **Audio/UI architecture.** Keep every virtual signal-stage measurable and bypassable:
   source -> preprocessor -> cutter-head model -> geometrical groove -> stylus/contact
   -> generator -> load -> phono stage -> speakers. Build a lathe/workbench mode rather
   than overloading the attractive record-player scene.

## First unresolved decisions

- Select a cutting-system target for calibration (e.g. cutter-head+drive amp with documented
  transfer/feedback and safe acceleration/temperature data) before promising actual
  cutter safety.
- Decide how to obtain traceable cartridge tests (manufacturer reference recordings,
  test LP, calibrated generator and electrical load jig) with known test velocities.
- Add MC velocity sensitivity and phono input gain/noise independently, never just swap
  MM coil numbers into a common engine.
- Acknowledge that lacquer mastering and pressed vinyl playback are separate material
  processes. Simulated groove geometry is not a universal predictor of pressing yield.
