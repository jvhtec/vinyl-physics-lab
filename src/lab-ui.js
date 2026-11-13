// Separate, dependency-free engineering workbench. No audio processing or
// long-running analysis happens on the main/UI thread.
import { CUT_SCENARIOS, electricalSweep, exportCsv } from './lab-measure.js';

const $ = (id) => document.getElementById(id);
const palette = { a: '#ffbb6f', b: '#80cfd4', grid: 'rgba(255,255,255,.13)',
  text: 'rgba(255,255,255,.65)', bg: '#121417' };
const display = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '—';

function chart(canvas, { rows, xKey, xLabel, yLabel, series, logX = false, xTicks = [], yTicks = null }) {
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  c.fillStyle = palette.bg; c.fillRect(0, 0, w, h);
  const left = 64, right = 22, top = 26, bottom = 38;
  const width = w - left - right, height = h - top - bottom;
  if (!rows?.length) return;
  const xvals = rows.map(row => row[xKey]);
  const xx = (v) => logX ? Math.log10(v) : v;
  const x0 = Math.min(...xvals.map(xx)), x1 = Math.max(...xvals.map(xx));
  const yvals = rows.flatMap(row => series.map(s => row[s.key])).filter(Number.isFinite);
  const y0raw = Math.min(0, ...yvals), y1raw = Math.max(0, ...yvals);
  const step = y1raw - y0raw < 5 ? 1 : y1raw - y0raw < 40 ? 5 : y1raw - y0raw < 200 ? 20 : 100;
  const y0 = Math.floor((y0raw - step / 2) / step) * step;
  const y1 = Math.ceil((y1raw + step / 2) / step) * step;
  const px = v => left + (xx(v) - x0) * width / (x1 - x0 || 1);
  const py = v => top + (y1 - v) * height / (y1 - y0 || 1);
  c.lineWidth = 1; c.strokeStyle = palette.grid; c.fillStyle = palette.text;
  c.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
  c.textAlign = 'right'; c.textBaseline = 'middle';
  const ticks = yTicks || Array.from({ length: 5 }, (_, i) => y0 + (y1 - y0) * i / 4);
  for (const value of ticks) {
    if (value < y0 || value > y1) continue;
    const y = py(value); c.beginPath(); c.moveTo(left, y); c.lineTo(w - right, y); c.stroke();
    c.fillText(Math.abs(value) < 1e-5 ? '0' : display(value, 1), left - 10, y);
  }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (const tick of xTicks) {
    if (tick.value < Math.min(...xvals) || tick.value > Math.max(...xvals)) continue;
    const x = px(tick.value); c.beginPath(); c.moveTo(x, top); c.lineTo(x, h - bottom); c.stroke();
    c.fillText(tick.label, x, h - bottom + 8);
  }
  c.textAlign = 'left'; c.fillStyle = palette.text;
  c.fillText(yLabel, 12, 6);
  c.textAlign = 'right'; c.fillText(xLabel, w - right, h - 18);
  c.save(); c.beginPath(); c.rect(left, top, width, height); c.clip();
  for (const s of series) {
    c.strokeStyle = s.color; c.lineWidth = 2;
    c.setLineDash(s.dashed ? [6, 4] : []);
    c.beginPath();
    let hasPoint = false;
    for (const row of rows) {
      const x = row[xKey], y = row[s.key];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { hasPoint = false; continue; }
      if (hasPoint) c.lineTo(px(x), py(y)); else c.moveTo(px(x), py(y));
      hasPoint = true;
    }
    c.stroke();
  }
  c.restore(); c.setLineDash([]);
}

const frequencyTicks = [20, 100, 1000, 10000, 20000].map(value =>
  ({ value, label: value >= 1000 ? value / 1000 + 'k' : String(value) }));

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function setupLab({ readPlayback, updatePlayback }) {
  let currentSweep = null, cutResult = null, worker = null, running = false, requestId = 0;
  const inputs = ['lab-model', 'lab-cap', 'lab-rl'];
  const cutterInputs = ['lab-scenario', 'lab-velocity', 'lab-elliptical', 'lab-accel'];
  function setFromPlayback() {
    const p = readPlayback();
    $('lab-model').value = p.model;
    $('lab-cap').value = p.capacitancePf;
    $('lab-rl').value = p.resistanceKOhm;
    refreshElectrical();
  }
  function refreshElectrical() {
    try {
      currentSweep = electricalSweep({
        model: $('lab-model').value, capacitancePf: +$('lab-cap').value,
        resistanceKOhm: +$('lab-rl').value,
        outputSampleRate: readPlayback().sampleRate,
      });
      $('lab-cap-value').textContent = $('lab-cap').value + ' pF';
      $('lab-rl-value').textContent = $('lab-rl').value + ' kΩ';
      $('lab-electrical-meta').textContent =
        `${currentSweep.label} · Rc ${display(currentSweep.RcOhm, 0)} Ω · Lc ${display(currentSweep.LcH * 1000, 0)} mH · generator loss at DC ${display(currentSweep.dcDb)} dB · simulated internal rate ${display(currentSweep.internalFs, 0)} Hz`;
      const s = currentSweep.rows;
      chart($('lab-magnitude'), {
        rows: s, xKey: 'frequencyHz', xLabel: 'Hz (log)', yLabel: 'Gain / DC (dB)', logX: true,
        xTicks: frequencyTicks,
        series: [{ key: 'analogueDb', color: palette.a }, { key: 'digitalDb', color: palette.b, dashed: true }],
      });
      chart($('lab-phase'), {
        rows: s, xKey: 'frequencyHz', xLabel: 'Hz (log)', yLabel: 'Phase (°)', logX: true,
        xTicks: frequencyTicks,
        series: [{ key: 'analoguePhaseDeg', color: palette.a }, { key: 'digitalPhaseDeg', color: palette.b, dashed: true }],
      });
    } catch (err) {
      $('lab-electrical-meta').textContent = 'Electrical analysis failed: ' + String(err.message || err);
    }
  }
  for (const id of inputs) {
    $(id).addEventListener('input', () => {
      updatePlayback({ model: $('lab-model').value, capacitancePf: +$('lab-cap').value,
        resistanceKOhm: +$('lab-rl').value });
      refreshElectrical();
    });
  }
  const refreshCutterLabels = () => {
    $('lab-velocity-value').textContent = display(+$('lab-velocity').value, 2) + ' m/s';
    $('lab-elliptical-value').textContent = $('lab-elliptical').value + ' Hz';
    $('lab-accel-value').textContent = $('lab-accel').value + ' m/s²';
  };
  cutterInputs.forEach(id => $(id).addEventListener('input', refreshCutterLabels));
  refreshCutterLabels();
  // Keep the explanation explicitly tied to the exact experiment that produced
  // the data. Changing a parameter does not relabel an older plot as new data.
  function showCut(result) {
    cutResult = result;
    const { stats, opts, scenario, legacyStats, comparison } = result;
    const land = stats.clearanceEvaluated ? display(stats.minLandUm, 2) + ' µm' : 'not evaluated';
    $('lab-cut-meta').textContent =
      `${CUT_SCENARIOS[scenario].label} · ${display(stats.programSeconds)} s · ${stats.sampleRate} Hz · Vref ${opts.cutPeak} m/s · elliptic ${opts.ellipticalHz} Hz · sampled accel target ${opts.aMax} m/s²`;
    $('lab-cut-stats').textContent =
      `Min adjacent-groove land: ${land} (model target ${display(stats.minRequiredLandUm, 0)} µm)   |   Max lateral: ${display(stats.peakLateralUm)} µm   |   Max vertical: ${display(stats.peakVerticalUm)} µm\n` +
      `Peak wall velocity: ${display(stats.peakWallVelocityCms)} cm/s   |   Peak wall acceleration: ${display(stats.peakWallAccelerationMs2, 0)} m/s²   |   HF attenuation: ${display(stats.deEssDb)} dB`;
    const guard = comparison.boundedAcceleration;
    const ch = (c) => {
      const r = comparison.channels[c];
      const v = n => n == null ? 'N/A' : display(n, 3);
      return `${c.padEnd(5)}  Δgain ${v(r.gainDeltaDb)} dB   Δphase ${v(r.phaseShiftDeg)}°   ` +
        `THD legacy/bounded: ${v(r.thdBeforeDb)} / ${v(r.thdAfterDb)} dB   ` +
        `AC residual legacy/bounded: ${v(r.residualBeforeDb)} / ${v(r.residualAfterDb)} dB`;
    };
    $('lab-cut-comparison').textContent =
      `LEGACY → GUARDED  ${display(legacyStats.peakWallAccelerationMs2, 1)} → ${display(stats.peakWallAccelerationMs2, 1)} m/s²   ` +
      `(${guard.mode}; high-band gain ${display(guard.highGain, 4)}, global gain ${display(guard.uniformGain, 4)})\n` +
      ch('left') + '\n' + ch('right') +
      (comparison.harmonicMeasurementAvailable ? '' :
        '\nTHD unavailable: the second harmonic lies above the measurable Nyquist band.');
    const ticks = (s) => {
      if (!s.length) return [];
      return [s[0], s[Math.floor(s.length / 2)], s.at(-1)].map(v => ({ value: v.revolution, label: String(v.revolution) }));
    };
    chart($('lab-waveform'), {
      rows: stats.waveform, xKey: 'timeMs', xLabel: 'Time (ms)', yLabel: 'Groove displacement (µm)',
      xTicks: [stats.waveform[0], stats.waveform[Math.floor(stats.waveform.length / 2)], stats.waveform.at(-1)]
        .map(v => ({ value: v.timeMs, label: display(v.timeMs, 1) })),
      series: [{ key: 'lateralUm', color: palette.a }, { key: 'verticalUm', color: palette.b }],
    });
    chart($('lab-pitch'), {
      rows: stats.pitch, xKey: 'revolution', xLabel: 'Unwrapped revolution', yLabel: 'Pitch / land (µm)',
      xTicks: ticks(stats.pitch),
      series: [{ key: 'pitchUm', color: palette.a }, { key: 'minLandUm', color: palette.b },
        { key: 'landTargetUm', color: 'rgba(255,255,255,.45)', dashed: true }],
    });
    chart($('lab-acceleration'), {
      rows: comparison.accelerationWaveform, xKey: 'timeMs', xLabel: 'Time (ms)',
      yLabel: 'Sampled |wall acceleration| (m/s²)',
      xTicks: [comparison.accelerationWaveform[0],
        comparison.accelerationWaveform[Math.floor(comparison.accelerationWaveform.length / 2)],
        comparison.accelerationWaveform.at(-1)].map(x => ({ value: x.timeMs, label: display(x.timeMs, 2) })),
      series: [{ key: 'legacyAcceleration', color: palette.a },
        { key: 'boundedAcceleration', color: palette.b },
        { key: 'targetAcceleration', color: 'rgba(255,255,255,.5)', dashed: true }],
    });
    $('lab-export-cut').disabled = false;
  }
  $('lab-run').addEventListener('click', () => {
    if (running) return;
    running = true; $('lab-run').disabled = true;
    $('lab-cut-status').textContent = 'Cutting and measuring on a worker…';
    try {
      worker ||= new Worker(new URL('./lab-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data: m }) => {
        if (m.id !== requestId) return;
        running = false; $('lab-run').disabled = false;
        if (m.t === 'testCutDone') {
          showCut(m);
          const exceeded = m.stats.peakWallAccelerationMs2 > m.opts.aMax;
          const originalExceeded = m.legacyStats.peakWallAccelerationMs2 > m.opts.aMax;
          const collision = m.stats.clearanceEvaluated &&
            m.stats.minLandUm < m.stats.minRequiredLandUm;
          $('lab-cut-status').textContent =
            (exceeded ? '⚠ Bounded acceleration still EXCEEDS target. ' :
              originalExceeded ? 'Original limiter overshoot corrected in the sampled domain. ' : '') +
            (collision ? '⚠ Model land clearance below target. ' : '') +
            'Clean-cut diagnostics only, not a safe cutting prescription.';
        } else $('lab-cut-status').textContent = 'Test cut failed: ' + m.error;
      };
      worker.onerror = (e) => {
        running = false; $('lab-run').disabled = false;
        $('lab-cut-status').textContent = 'Worker failed: ' + e.message;
      };
      requestId++;
      worker.postMessage({ t: 'testCut', id: requestId, scenario: $('lab-scenario').value,
        cutPeak: +$('lab-velocity').value, ellipticalHz: +$('lab-elliptical').value,
        accelerationLimit: +$('lab-accel').value });
    } catch (e) {
      running = false; $('lab-run').disabled = false;
      $('lab-cut-status').textContent = 'Worker unavailable: ' + (e.message || e);
    }
  });
  $('lab-export-cartridge').addEventListener('click', () => {
    if (!currentSweep) return;
    downloadCsv('cartridge-electrical-sweep.csv',
      '# Vinyl Physics Lab, analogue continuous-time vs digital worklet biquad (normalized to DC)\r\n' +
      `# model=${currentSweep.model},Rc_Ohm=${currentSweep.RcOhm},Lc_H=${currentSweep.LcH},Cl_pF=${currentSweep.capacitancePf},Rl_kOhm=${currentSweep.resistanceKOhm},fs_internal=${currentSweep.internalFs}\r\n` +
      exportCsv(currentSweep.rows,
        ['frequencyHz', 'analogueDb', 'digitalDb', 'analoguePhaseDeg', 'digitalPhaseDeg']));
  });
  $('lab-export-cut').addEventListener('click', () => {
    if (!cutResult) return;
    const { stats, scenario, opts, legacyStats, comparison } = cutResult;
    const rows = [
      ...stats.waveform.map(v => ({ kind: 'waveform', ...v })),
      ...stats.pitch.map(v => ({ kind: 'pitch', ...v })),
      ...comparison.accelerationWaveform.map(v => ({ kind: 'acceleration', ...v })),
    ];
    downloadCsv('groove-test-cut.csv',
      '# Vinyl Physics Lab, CLEAN simulated cut, not calibrated for cutting hardware\r\n' +
      `# scenario=${scenario},cutPeak_mps=${opts.cutPeak},elliptical_Hz=${opts.ellipticalHz},accelLimit_mps2=${opts.aMax}\r\n` +
      `# minLand_um=${stats.minLandUm ?? 'N/A'},peakLateral_um=${stats.peakLateralUm},peakVertical_um=${stats.peakVerticalUm},legacyAccel_mps2=${legacyStats.peakWallAccelerationMs2},boundedAccel_mps2=${stats.peakWallAccelerationMs2},guardMode=${comparison.boundedAcceleration.mode}\r\n` +
      exportCsv(rows, ['kind', 'timeMs', 'lateralUm', 'verticalUm', 'revolution', 'radiusMm', 'pitchUm', 'minLandUm', 'landTargetUm', 'legacyAcceleration', 'boundedAcceleration', 'targetAcceleration']));
  });
  return { open: () => {
    setFromPlayback();
    if (!cutResult && !running) $('lab-run').click();
  }, onPlaybackChange: () => {
    if (!$('lab').hidden) setFromPlayback();
  } };
}
