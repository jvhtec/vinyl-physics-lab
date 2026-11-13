// Independent analysis worker, separate from the deck's audio mastering worker.
// We never clone/transfer a whole LP side from the live playback engine.
import { cut } from './cut.js';
import { testSignal, summarizeCleanCut, CUT_SCENARIOS } from './lab-measure.js';

self.onmessage = ({ data: m }) => {
  if (m.t !== 'testCut') return;
  try {
    if (!(m.scenario in CUT_SCENARIOS)) throw new RangeError('Unknown test scenario');
    const fs = 48000;
    const opts = {
      cutPeak: Number(m.cutPeak),
      ellipticalHz: Number(m.ellipticalHz),
      aMax: Number(m.accelerationLimit),
    };
    if (!Number.isFinite(opts.cutPeak) || opts.cutPeak < 0.02 || opts.cutPeak > 0.3 ||
        !Number.isFinite(opts.ellipticalHz) || opts.ellipticalHz < 20 || opts.ellipticalHz > 800 ||
        !Number.isFinite(opts.aMax) || opts.aMax < 1000 || opts.aMax > 40000) {
      throw new RangeError('Invalid cutter control');
    }
    const cleanCut = cut(testSignal(m.scenario, fs), fs, opts);
    const stats = summarizeCleanCut(cleanCut, {
      // Show ~4–6 cycles, not hundreds of high-frequency periods in one plot.
      windowMs: m.scenario === 'vertical' ? 40 : m.scenario === 'left' ? 0.375 : 6,
    });
    self.postMessage({ t: 'testCutDone', id: m.id, scenario: m.scenario, opts, stats });
  } catch (error) {
    self.postMessage({ t: 'testCutError', id: m.id, error: String(error?.message || error) });
  }
};
