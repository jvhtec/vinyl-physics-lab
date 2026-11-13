# Round 4: reconstructed acceleration and RE reference baselines

Date: 13 November 2026
Baseline: `50cc58a` (sampled second-difference limiter).
Code: `src/reconstructed-acceleration.js`, `src/acceleration-guard.js`,
`src/lab-measure.js`; `test/reconstructed-acceleration.mjs`.

## What the limiter now measures

The round-3 guard evaluated second differences of the **stored** groove wall
positions at 48 kHz. This is not the same as acceleration of the continuous
trajectory implied by sampling the wall displacement. For an ideal sinusoid
at frequency `f`, amplitude `A`, sample rate `fs`:

- Physical continuous-time sinusoidal acceleration peak:
  `(2*pi*f)^2 * A`
- Central-difference peak at samples:
  `4*fs^2*sin(pi*f/fs)^2 * A`

At 16 kHz / 48 kHz, the continuous/sampled **curvature** ratio is
approximately 1.462. Even correcting that ratio does not solve the
sample-phase issue: the largest physical peak may lie **between** samples.

We now use finite, Blackman-windowed reconstruction of wall **displacement**:

`x(t) = sum_n x[n] sinc(fs*t-n)`, evaluated at 8 phases per original sample.

The analytic second derivative is applied to the reconstruction kernel,
not numerically approximated with another low-resolution difference:

`sinc''(u) = -pi*sin(pi*u)/u -2*cos(pi*u)/u^2 + 2*sin(pi*u)/(pi*u^3)`,
with `sinc''(0) = -pi^2/3`.

The default finite kernel extends ±16 samples. The window truncation
creates nonzero low-order moments, which initially produced **false**
low-frequency acceleration readings. We correct each phase's central
three coefficients to satisfy:

- `sum(k) = 0` (constant displacement produces zero acceleration).
- `sum(j*k) = 0` (linear motion produces zero acceleration).
- `sum(j*j*k) = 2` (quadratic displacement has the correct second derivative).

This local correction avoids the unwanted frequency-response ripple caused
by distributing polynomial correction across long taps. Tests check these
identities and compare reconstructed pure sine acceleration against
analytic 100 Hz, 1 kHz, 6 kHz, 16 kHz and 20 kHz examples.

**Scope of the claim:** it is a bandlimited, finite-window **8-phase grid
estimate**, not a formal maximum over real-valued time and not measured
cutter-head mechanics. The guard solves constraints using a shared high-band
gain over both 45/45 walls, retaining a 2.5% margin below the configured
target. It recomputes the actual stored Float32 result, and if selective
filtering cannot meet the estimated limit it uses uniform stereo attenuation.
An independent 16-phase, ±24-sample reconstruction checks the final
48 kHz/16 kHz tone. This makes the estimate more useful and falsifiable,
not a genuine safety rating.

### Reference example

With 48 kHz source, 16 kHz left-only synthetic tone, 0.14 m/s wall
reference and 12,000 m/s² configured target:

| Model | Original | Reconstruction-guarded |
| --- | ---: | ---: |
| Central-difference peak | ~30,309 m/s² | ~7,726 m/s² |
| 8-phase sinc-derivative peak | ~45,899 m/s² | ~11,700 m/s² |

These measurements are output **groove estimates**. They are not current,
force, coil temperature, groove wall fracture strength or an actual
Neumann/DMM cutter-head protection limit. The strong attenuation of very
high-frequency cutting levels is an intentional and audible compromise.

The guard remains an offline worker operation. It incurs several passes over
both groove wall arrays and should be profiled on actual LP-length material
before claiming production-scale realtime operation. Do not feed its
thresholds to physical cutting hardware.

## Software reverse-engineering targets

These are legitimate interoperability and modelling references. Treat
their **observable input/output behavior** and vendor manuals as evidence,
and use local resources/binaries for analysis. A model name or user
interface does not by itself prove the DSP method used internally.

### TDR SimuLathe REF 1.1.1 (installed)

- Installed: `C:\Program Files\Common Files\VST3\TDR SimuLathe REF.vst3`
- SHA-256:
  `C933CE404E3804F95C6366DBA29177F8D30731223035B90ADC42734DCAF2622F`
- Vendor: Tokyo Dawn Labs, 1.1.1 demo.
- Vendor documentation says REF implements a **configurable idealized yet
  physically plausible** cutting system, rather than claiming 1:1 emulation
  of a particular Neumann model.
- A separated preview/modulation path is described, with typical **half
  revolution** preview at 33⅓ rpm (around 900 ms). Cutter temperature and
  current estimates, pitch and groove land inspection, pickup feedback,
  cutting power and monitoring are relevant validation targets.
- REF documentation explicitly warns that breaker/current/temperature models
  are **coarse** and cannot replace physical protection.
- CUT edition adds real-system calibration parameters and different lathe
  pitch-mode choices, without proving a single fixed real-hardware match.

Sources:
- https://docs.tokyodawn.ru/simulathe-ref-manual/
- https://docs.tokyodawn.ru/simulathe-cut-manual/
- https://www.tokyodawn.net/tdr-simulathe-ref/

### Waves Abbey Road Vinyl V15.5.79.262 (installed)

- Installed bundle:
  `C:\Program Files (x86)\Waves\Plug-Ins V15\Abbey Road Vinyl.bundle`
- Bundle `Contents/Info.xml` and `manifest.yaml` explicitly identify
  version `15.5.79.262`, module GUID
  `811b0faa-6979-4500-a187-791e07c79138`, and the
  `Data_Vinyl_IID` data dependency.
- Local `Contents/Resources/ProcessXML/1001.xml` shows four processor
  mappings: `VNLS` stereo and `VNLM` mono use `ARVinylProc`;
  `VNOS` stereo and `VNOM` mono use `ARVinylLightProc`.
  The declared maximum native sample rate is **96 kHz**.
- Local REAPER Waveshell cache lists full/light mono/stereo versions for
  Waveshell V15.0 and V15.5, but **plugin activation and actual rendering
  have not been tested**.
- Local `Resources/ParamXML/1000.xml` contains 653 parameter definitions,
  including common Waves infrastructure and experimental/internal entries.
  Examples relevant for investigation, **not proof of active processing**:

| XML parameter | Declared range | Controlled experimental question |
| --- | --- | --- |
| `PARAM_VINYL_TYPE_NO_IP` | 0..1 | Lacquer versus pressed print transfer |
| `PARAM_TURNTABLE_NO_IP` | 0..1 | Reference deck versus DJ deck |
| `PARAM_CARTRIDGE_NO_IP` | 0..2 | Three cartridge tonal and nonlinear models |
| `PARAM_USER_TONEARM_POSITION_NO_IP` | 0..100 | Frequency/phase/degradation vs inner/outer radius |
| `PARAM_TG_ON_OFF` | 0..1 | TG12410 desk transfer/harmonics |
| `PARAM_PHASE_DISTORTION_EN` | 0..1 | Separate phase-only processing path |
| `PARAM_SCRATCH_RT_SINC_INTERP_EN` | 0..1 | Sinc interpolation in rate/scratch feature |
| `PARAM_POLY_AND_AM_INSIDE_RIAA_EN` | 0..1 | Order of nonlinear/AM processing and RIAA stage |
| `PARAM_LEAK_SIDES2MID` / `PARAM_LEAK_MID2SIDES` | -140..0 dB | Stereo mode leakage and geometry |

The proprietary Waves bundle contains `Win64/Abbey Road Vinyl.dll`,
`AVXProcessor.dll`, `GenericMultiCoreProcessor.dll` and resource data,
including a substantial parameter/preset XML graph. No vendor code,
binary, resource archive or sample data has been copied into this Git repo.

Waves' own manual describes the hardware chain as **TG12410 mastering desk →
Neumann SAL-74 electronics → Neumann VMS-80 cutting lathe**, plus lacquer
or vinyl pressing and MM/MC/DJ pickup simulations. It specifically says
the SAL-74 path is designed to be flat/minimally distorting and has no
dedicated GUI control. Thus a Waves Abbey Road Vinyl measurement should
**not** be misrepresented as validation of real cutter-head thermal or
acceleration protection.

Sources:
- https://assets.wavescdn.com/pdf/plugins/abbey-road-vinyl.pdf
- https://www.waves.com/plugins/abbey-road-vinyl

## REAPER black-box measurements completed

The static inventory has now been extended to actual hosted VST3 instances
and WAV analysis. The original test source and reusable scripts are in
the repository's scripts/reference-probe directory. All render WAVs and
vendor software remain only on the development PC, inside the ignored
.local-tools directory.

REAPER v7.83 enumerated five reference variants. Host instantiation exposed
52 automation parameters for SimuLathe REF, 163 for full Waves Abbey Road
Vinyl Stereo and 148 for Waves Light Stereo. A 4-second, 48 kHz original
test programme was rendered to 24-bit WAVs with a matching bypass. The
analysis uses coherent 0.5-second tone windows.

In Waves, TG Desk was OFF unless labelled otherwise, added noise/crackle
were reduced to -Inf, clicks OFF, wow/flutter depth zero, phase distortion
OFF, turntable Abbey Road, and Input Drive displayed 0.0. Critically,
Input Drive 0.0 maps to normalized **0**, not 0.5 (which displays 50.0).

| Waves configuration | 1 kHz L gain | 6 kHz L gain | 16 kHz L gain |
| --- | ---: | ---: | ---: |
| MM, lacquer, TG off | +0.39 dB | +0.34 dB | -16.11 dB |
| MC, lacquer, TG off | +0.36 dB | -0.09 dB | -9.50 dB |
| MM, lacquer, TG on | +0.55 dB | +0.62 dB | -15.29 dB |
| MM, pressed print, TG off | -0.04 dB | -0.42 dB | -11.25 dB |

These values are **measured plugin output** relative to bypass, not inferred
from static metadata. At 16 kHz, MM lacquer also exhibits approximately
-2.86 dB right/left signal ratio for the left-only input versus -21.42 dB
at 6 kHz, a suspiciously large transfer requiring independent stereo and
latency checks. MC lacquer right/left ratio is -12.21 dB at 16 kHz. MM
lacquer relative phase was -15.54 degrees at 1 kHz, -66.65 degrees at
6 kHz, and -155.75 degrees at 16 kHz, modulo phase wrapping. No measured
latency subtraction has yet been applied, so these are not validated
hardware phase curves.

The nominally silent segment showed about -66.2 dBFS RMS in Waves MM lacquer
versus -87.7 dBFS with MC. This could reflect model noise, host/plugin
state, or time variance and does **not** establish any real cartridge's
self-noise.

SimuLathe REF's host interface showed variable-pitch default, 12-inch
33⅓-rpm disc, -6 dB input trim, several pickup modes, and a preview
latency reporting toggle. Test captures with Lathe: Feedbk and Pickup:
Hifi rendered essentially flat -6 dB at all three test tones, with
0-degree relative phase. The expected lathe/groove processing was
apparently inactive in this offline configuration. **These renders
are inconclusive and not a physical calibration reference.**

No proprietary binary, vendor sample, image archive, preset archive or
DSP implementation was copied into Git. Only original testing code,
generated synthetic signal definitions and this measurement report appear
in the repository.

## Controlled A/B experiments to perform next

Run the same synthetic stimuli (1 kHz L=R, 100 Hz L=-R, 6/16 kHz L-only,
log sweep, multitone, stepped HF bursts and absolute silence) at **48 kHz**
to avoid implicit sample-rate conversion. Render plugin output and
subtract a reference bypass render with identical latency/gain:

1. **Waves**: noise/wow/flutter/clicks/modulation off, TG on/off, lacquer/
   print, each cartridge, outer/mid/inner arm position, phase distortion
   off/on and full versus light processors. Measure FR/phase, distortion,
   stereo crosstalk, time variance, noise PSD and latency.
2. **SimuLathe**: fixed versus variable pitch, 0.5-revolution preview,
   groove-width/depth settings, output metering and stereo/vertical
   conditioning. Compare microscope/disc statistics with our geometric
   predictions using *equivalent test velocity and reference level*.
3. **Plugin RE**: once instances can be hosted and presets/state inspected,
   correlate parameter changes to their observable transfer functions.
   Only then promote suspected filter, polynomial, interpolation or
   oscillation structures from static metadata to model hypotheses.
4. **Hardware closure**: fit these software observations against actual
   cutter-head response, feedback, current and coil temperature curves
   before labelling any system a physical 1:1 hardware replica.

Waves offline captures and hosted parameter enumeration are completed,
but a latency-aligned full complex transfer function, reproducible
stochastic controls, active TDR groove simulation, and independently
measured hardware responses remain unresolved. These are the next
falsification targets, not established product specifications.
