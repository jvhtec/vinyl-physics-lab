# Post-cut wall acceleration guard — 13 November 2026, round 3

> Historical development record. Round 4 replaces the *default* sampled
> second-difference constraint with an 8-phase bandlimited reconstruction-grid
> constraint. The equations and 11,940 m/s² values below describe round 3.
> See [RECONSTRUCTION-AND-REFERENCES.md](RECONSTRUCTION-AND-REFERENCES.md)
> for the current implementation.

## Scope, invariants and the actual limit

The existing Vinyl GL `deEss()` in `src/cut.js` predicts high-frequency
acceleration **before** RIAA pre-emphasis, displacement integration, wall
polarity conversion and variable-depth cutting. On a 16 kHz left-only tone
it reduces the high band by ~14.25 dB yet produces **30,308.98 m/s²** peak
sampled wall acceleration with `aMax=12000`. Its detector was a heuristic,
not a guarantee on the resulting cut.

New `src/acceleration-guard.js` acts **after** the complete upstream cutting
and depth processing but **before** computing the pitch/radius table. Define
the output wall sample displacement `x[n]` in metres and

`a_d[n] = fs² (x[n+1] - 2x[n] + x[n-1])`.

For every interior sample of *both* walls, the final Float32 groove now
satisfies `max(|a_d[n]|) <= aMax`. The printed peak is computed from the
actual stored samples, not a gain-envelope prediction. Values within this
domain are measured in m/s², not degrees, dB, velocity or cutter force.

**Crucial limit:** this bound applies to sampled *second differences*.
At 48 kHz, a 16 kHz pure sine has a continuous acceleration roughly
`(2π·16000/48000)² / [4 sin²(π·16000/48000)] ≈ 1.462` times
its central-difference acceleration if reconstructed as an ideal sinusoid.
Thus **11,940 sampled m/s² does not certify a physical 12,000 m/s² ceiling**.
True intersample peaks, cutter-head impedance/temperature, feedback, lacquer
depth and cutting stylus loading remain uncalibrated. Never use these controls
to drive real cutting machinery.

## Solver

1. If the original geometry already measures at or below `0.995*aMax`, it is
   returned **bit-identically**. This preserves existing mono/stereo cuts.
2. Otherwise, compute a 3 kHz low-frequency estimate by applying a one-pole
   lowpass forwards then backwards with endpoint extension. Let `x=low+high`.
   Forward/backward filtering is noncausal/offline, with no steady-state
   phase rotation. This adds a frequency-selective transfer but no time-varying
   gain modulation.
3. Find a **single scalar** `g` shared by the two 45/45 walls that satisfies
   the linear system `|a_low[n]+g*a_high[n]|<=0.995*aMax` for every sample.
   Every constraint becomes an interval in `g`; their intersection with
   `0<=g<=1` is the admissible range. Choose the highest feasible gain,
   minimizing high-band attenuation within this one-parameter family.
4. Produce `low+g*high`, write Float32 and independently audit the result.
   If no feasible shared high-band gain exists, use the conservative fallback
   of constant gain on **both full-band walls**. A final audited uniform reserve
   handles tiny float-quantization overshoots. Failure to satisfy the bound
   raises an exception instead of returning an apparently compliant cut.
5. Pitch/land computation always uses the **corrected** wall geometry. Preset
   modes are `selective` (default), `uniform` (explicit conservative) and
   `legacy` (A/B reproduction of original behaviour).

The shared scalar avoids arbitrary L/R-dependent HF gains and azimuth or
stereo-image changes. Changing spectral gain can still change the stereo
image if the left and right **content** has different bandwidth. A stationary
zero-phase high-band filter does not itself add delay to the fundamental,
although finite-record boundary behaviour and source-cutter nonlinearities
still require measurement.

## Reproducible 48 kHz results

Default `cutPeak=0.14 m/s`, elliptical corner 150 Hz and `aMax=12000 m/s²`.
All measured values below come from the actual simulated output samples.

| Stimulus | Legacy peak | Bounded peak | Steady tone Δgain | Steady tone Δphase |
| --- | ---: | ---: | ---: | ---: |
| 1 kHz L=R | 881 m/s² | 881 m/s² | 0.000 dB | 0.000° |
| 100 Hz L=-R | 12 m/s² | 12 m/s² | 0.000 dB | 0.000° |
| 6 kHz left-only | 14,570 m/s² | 11,940 m/s² | −1.729 dB | under 0.001° |
| 16 kHz left-only | 30,309 m/s² | 11,940 m/s² | −8.091 dB | under 0.001° |

For the 6 kHz left-wall tone at this setting, discrete harmonics relative to
the fundamental (`THD`, within the 48 kHz sampled band) change from about
−149.22 to −153.27 dB. These extraordinarily small values are at the
numerical precision floor, **not evidence of perceptually superior fidelity**.
The 16 kHz second harmonic would lie beyond Nyquist, so its THD is explicitly
marked `N/A`, not falsely reported as zero.

The output-domain guard is **not** transparent at 16 kHz: its −8 dB reduction
is exactly the kind of meaningful tonal tradeoff a cutting engineer should
be able to hear and measure. The attenuation factor inside the high-band
branch is `g≈0.3624`; the actual 16 kHz tone attenuates by −8.09 dB because
the low-frequency branch still contributes some gain.

If the low band itself violates the limit, the solver uses the uniform stereo
fallback, which leaves spectral shape and phase alone but attenuates the
entire programme. This is an honest failure mode rather than an invented
full-band safety guarantee.

## Validation

- `node test/acceleration-guard.mjs` verifies full returned grooves at
  44.1, 48 and 96 kHz plus deterministic stereo broadband bursts.
- Bitwise identity comparisons confirm already-compliant 1 kHz lateral
  and 100 Hz vertical groove samples exactly match legacy processing.
- Synthetic low-frequency over-limit input verifies full-band uniform
  fallback and stereo polarity conservation.
- A coherent lock-in spectral analyser compares tone magnitude, phase,
  resolvable harmonic products and non-fundamental AC residual error.
- `node test/lab-measure.mjs` checks the 16 kHz legacy reproduction and
  corrected threshold, while refusing to invent THD above Nyquist.
- Browser workbench has a legacy-vs-guarded acceleration trace,
  documented spectral comparisons and CSV export. Vendor plugin A/B
  remains a separate, unperformed black-box experiment.

## Engineering next steps

1. Compare the measured central-difference constraint with oversampled,
   reconstruction-aware waveform acceleration and evaluate peak error.
2. Add frequency-aware dynamic preview and cutter-head servo/thermal models
   fitted to measured transfer functions and verified stylus mechanics.
3. Introduce a measurable headroom/quality criterion for programme-scale
   attenuation rather than accepting arbitrary tonal changes.
4. Compare controlled sweeps with SimuLathe REF and Abbey Road Vinyl
   as independent reference tools, not as guaranteed physical ground truth.
