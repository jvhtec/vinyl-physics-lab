# REAPER reference-plugin probe

Purpose: reproducible black-box experiments on legitimate local instances of
TDR SimuLathe REF and Waves Abbey Road Vinyl. No vendor DSP is patched or
extracted and no vendor resources are committed.

Requirements: Windows, Node 22+, REAPER and the installed VST3 plugins.
Scripts were tested with REAPER 7.83. Run from a distinct REAPER instance,
not from an existing unsaved user project.

All generated WAVs, measurement data and logs live in the ignored directory
D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/ on the development PC.
Optionally set environment variable VINYL_LAB_PROBE_DIR to select another
directory, using forward slashes for Lua scripts. Create a renders subfolder.

1. Run synthesize.mjs with Node to produce a deterministic original 4-second
   48 kHz stereo reference WAV (1k LR, 6k left-only, 16k left-only).
2. Run list-fx.lua in a separate REAPER instance to enumerate plugins.
3. Run automation.lua to enumerate the plugins' host parameters. Its temporary
   track is removed and no project is saved.
4. Run render-waves.lua in a new REAPER instance to capture bypass and
   Waves full-stereo MM/MC lacquer, TG-on and print modes.
5. Run render-simulathe.lua for lathe feedback and Hi-Fi pickup modes.
6. Run analyze.mjs with Node to measure coherent amplitude, phase,
   channel leakage and silent-section RMS. The JSON summary remains local.

The render scripts skip existing filenames rather than triggering the REAPER
overwrite confirmation. To recapture, use a *new empty* output folder instead
of deleting original evidence. Lua completion is signalled by __complete__
in the corresponding local log.

The Waves tests explicitly set Input Drive to normalized 0, which displays
0.0 in the host. Normalized 0.5 displays 50.0 and is not neutral.
TDR's available offline captures currently return only the flat -6 dB input
trim, so those particular renders do not establish simulated groove behaviour.

Measured plugin behaviour is not proof of real Neumann hardware equivalence
or cutter-head protection capabilities.
