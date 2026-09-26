/* SI & PI — viz/adc-lab.js
 * Lab D: ADC interference, aliasing and reference noise.
 *
 * Aggressor controls on the left, converter controls on the right, and between
 * them the output spectrum and a folding map that stay in view while either side
 * changes. The physics is js/models/adc-model.js and stays there; this file wires
 * the controls, keeps runs from piling up while a slider moves, and draws.
 */
(function () {
  'use strict';
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  /* ---------- engineering units ---------- */
  const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  function eng(v, unit, digits) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0 ' + unit;
    const a = Math.abs(v);
    const pick = PREFIX.find(([s]) => a >= s * 0.999995) || PREFIX[PREFIX.length - 1];
    return +(v / pick[0]).toPrecision(digits || 4) + ' ' + pick[1] + unit;
  }
  const MULT = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  function parseEng(text, units) {
    let t = String(text).trim();
    units.forEach((u) => { t = t.replace(new RegExp('\\s*' + u + '$', 'i'), ''); });
    const m = t.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([pnuµmkKMG]?)$/);
    return m ? parseFloat(m[1]) * (m[2] ? MULT[m[2]] : 1) : NaN;
  }
  const hz = (v) => eng(v, 'Hz', 3);
  const sig = (v, n) => +v.toPrecision(n);
  const signed = (v, d) => {
    const t = Math.abs(v).toFixed(d);
    return (+t === 0 ? '' : v > 0 ? '+' : '−') + t;
  };
  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }

  /* ---------- settings ---------- */
  const BASE = {
    arch: 'sar', bits: 16, fs: 1e6, fmod: 256e3, osr: 128, vref: 2.5, noiseUv: 0,
    inFreq: 10e3, inDbfs: -1,
    aggAmp: 1.8, aggMode: 'free', aggFreq: 4.1273e6, aggMultiple: 4, aggPpm: 20, aggPhase: 90,
    edge: 1e-9, path: 'none', couplingDb: -80, couplingType: 'capacitive', pathBw: 20e6
  };
  const DS = { arch: 'ds', fmod: 256e3, osr: 128, inFreq: 50, inDbfs: -6 };
  const NOTCH = Object.assign({}, DS, { fmod: 2560, osr: 256, inFreq: 1.13 });

  const PRESETS = {
    'sar-clean': { set: {},
      note: 'A 16-bit SAR with nothing coupled. SNR is 97.1 dB: 6.02 × 16 + 1.76 dB, less the 1 dB the input sits below full scale. Quantization is the only noise.' },
    'sar-fold': { set: { path: 'input' },
      note: 'A 1.8 V clock at 4.1273 MHz on its own oscillator, 20 ppm off the converter’s crystal, coupled capacitively, 80 dB down at 1 MHz. Capacitive coupling grows with frequency, so its fundamental arrives about four times larger: 463 µV at the pin, −74.6 dBFS. It runs 127.4 kHz from the nearest multiple of 1 MS/s, so that is where its fundamental lands, and every odd harmonic folds somewhere too. SNR falls from 97.1 to 67.9 dB — interference counts as noise.' },
    'sar-gpio': { set: { path: 'input', aggFreq: 1e6, couplingDb: -60 },
      note: 'A GPIO toggling at 1 MHz beside a 1 MS/s SAR: a nominal match, but on its own oscillator, 20 ppm off. It beats at 20 Hz — slower than this 65.5 ms record resolves — so its fundamental lands in the DC bins and reads as offset, −0.22 mV here and wandering in practice, while harmonics 5, 7 and 9 land at 100, 140 and 180 Hz, larger than they would be flat because the coupling is capacitive. SNR 54.0 dB. Tick “Shares the converter’s clock” to see an exact match instead.' },
    'sar-locked': { set: { path: 'input', aggMode: 'clock', couplingType: 'flat', couplingDb: -60 },
      note: 'The aggressor now shares the converter’s clock, at exactly 4 × the sample rate, coupled flat through a shared ground or supply. Every sample catches it at the same phase, so all of it folds to DC: SNR is back to 97.1 dB and the output carries a +0.90 mV offset (11.8 LSB) instead. Move the phase to 0° and the offset flips to −0.90 mV. Only a shared clock holds a ratio this exact. Switch the mechanism to capacitive and the offset all but vanishes: a capacitor passes only the edges, and these samples fall between them.' },
    'sar-slow': { set: { path: 'input', couplingType: 'capacitive', couplingDb: -60, pathBw: 200e6, edge: 10e-9 },
      note: 'Capacitive coupling, −60 dB at 1 MHz, into a 200 MHz path, with 10 ns edges. Coupling through a capacitor grows with frequency, so each harmonic arrives larger than it otherwise would until the edge rolls the series off above 25 MHz. SNR 46.9 dB.' },
    'sar-fast': { set: { path: 'input', couplingType: 'capacitive', couplingDb: -60, pathBw: 200e6, edge: 1e-9 },
      note: 'The same, with 1 ns edges. The fundamental is unchanged, but the series now runs flat to the 200 MHz path pole instead of rolling off at 25 MHz, and every one of those harmonics folds into band. SNR 39.6 dB — 7.2 dB worse, from edge rate alone. Try flat coupling: the edges then barely matter.' },
    'sar-ref': { set: { path: 'reference', couplingType: 'flat', aggFreq: 131e3, couplingDb: -60 },
      note: 'A 131 kHz ripple on the reference, arriving through the supply it shares, so the coupling is flat. The code is the input divided by the reference, so the error is a product: sidebands at the input ± 131 kHz, not a tone at 131 kHz. Lower the input by 6 dB and the sidebands fall 6 dB with it — SNR stays at 69 dB, because the error scales with the signal.' },
    'ds-clean': { set: DS,
      note: 'A second-order, 1-bit Delta-Sigma: 256 kHz modulator clock, oversampling 128, so a 2 kHz output data rate. SNR 90.1 dB — 4.1 dB under the 94.2 dB the linear noise-shaping formula gives, which is typical of a 1-bit loop.' },
    'ds-notch': { set: Object.assign({}, NOTCH, { aggFreq: 50, path: 'input', couplingType: 'flat', couplingDb: -40 }),
      note: 'Output data rate 10 Hz (2.56 kHz clock, oversampling 256), and a 50 Hz square wave on its own oscillator, 20 ppm off, coupled flat, 40 dB down, as mains-rate interference arrives through shared ground and supply: −46.8 dBFS at the pin. The sinc³ filter nulls every multiple of the data rate, and the fundamental sits 1 mHz from one. Yet SNR falls from 104.7 to 101.8 dB: harmonic n sits n mHz from its null, and far enough up the series that is in the passband. Share the converter’s clock, or slow the rise and fall to 1 ms, and the loss goes.' },
    'ds-offnotch': { set: Object.assign({}, NOTCH, { aggFreq: 51, path: 'input', couplingType: 'flat', couplingDb: -40 }),
      note: 'One hertz off the notch. A 51 Hz sine would be rejected by 103 dB here — but this is a square wave, and its 251st harmonic, at 12,801.3 Hz, sits 1.26 Hz from 5 × the modulator clock. Sampling folds it to 1.26 Hz, where the filter passes it. SNR 88.3 dB. Slow the rise and fall to 2 ms and that harmonic, and the spur, disappear.' },
    'ds-clock': { set: Object.assign({}, DS, { aggFreq: 256e3, path: 'input', couplingDb: -60 }),
      note: 'An aggressor at a nominal 256 kHz, 20 ppm off the modulator clock. The modulator samples it 5.12 Hz from DC, inside the band, before any filter runs — and the decimation filter passes everything near DC. SNR falls from 90.1 to 57.4 dB. No digital filter can separate this from the signal.' },
    'ds-ref': { set: Object.assign({}, DS, { path: 'reference', couplingType: 'flat', aggFreq: 127993, couplingDb: -50 }),
      note: 'Reference ripple, through the shared supply, 4.4 Hz below half the modulator clock. That is far outside the 1 kHz band — but the feedback DAC multiplies the bitstream by the reference, and the bitstream holds its shaped quantization noise right there. The product shifts that noise down into the band. No spur: the floor rises, and SNR falls from 90.1 to 72.2 dB.' }
  };

  NS.viz.adcLab = function (root) {
    const A = (NS.models || {}).adcLab;
    /* The model is a separate script. Without it the panel would draw an empty
       frame and blame nothing; the loader turns a throw here into a message in
       the page that says the panel could not start. */
    if (!A) throw new Error('js/models/adc-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cv = {};
    root.querySelectorAll('canvas[data-cv]').forEach((c) => (cv[c.dataset.cv] = c));
    const p = Object.assign({}, BASE, PRESETS['sar-fold'].set);
    const cache = {}, sweepCache = {};
    let sweepPicked = false;                 // the reader chose a sweep range; stop following the aggressor
    let M = null, T = K.theme(root), bandSpec = null;

    const rate = () => (p.arch === 'ds' ? p.fmod / p.osr : p.fs);

    /* Rise and fall are held to a fifth of the aggressor's period — a clock whose
       edges take longer is no longer a clock — so the slider's range follows the
       frequency: 200 ns at 1 MHz, 2 ns at 100 MHz. The lower end is the driver's,
       not the frequency's: a slow GPIO can still switch in a nanosecond. What the
       reader set is kept in edgeSet, so a frequency that shortens the limit and
       then lengthens it again gives the edge back. */
    const MIN_EDGE = 10e-12, EDGE_SHARE = 0.2;
    const maxEdge = (f) => Math.max(MIN_EDGE, EDGE_SHARE / (f || A.aggressor(p).fa));
    p.edgeSet = p.edge;
    const limitEdge = () => { p.edge = Math.min(p.edgeSet, maxEdge()); };
    const shown = (c) => !!c && c.offsetParent !== null && c.clientWidth > 0;

    /* ---------- controls ---------- */
    const LOGS = {
      'adc-agg-f': { key: 'aggFreq', lo: () => 1, hi: () => 1e9, units: ['Hz'], fmt: (v) => eng(v, 'Hz', 7) },
      'adc-edge': { key: 'edge', lo: () => MIN_EDGE, hi: () => maxEdge(), units: ['s'], fmt: (v) => eng(v, 's', 4) },
      'adc-path-bw': { key: 'pathBw', lo: () => 1e3, hi: () => 1e9, units: ['Hz'], fmt: (v) => eng(v, 'Hz', 4) },
      'adc-fs': { key: 'fs', lo: () => 1e3, hi: () => 1e7, units: ['S/s', 'sps', 'Hz'], fmt: (v) => eng(v, 'S/s', 5) },
      'adc-fmod': { key: 'fmod', lo: () => 1e3, hi: () => 1e7, units: ['Hz'], fmt: (v) => eng(v, 'Hz', 5) },
      'adc-in-f': { key: 'inFreq', lo: () => rate() * (p.arch === 'ds' ? 2.5e-3 : 2e-4), hi: () => rate() * 0.45,
                    units: ['Hz'], fmt: (v) => eng(v, 'Hz', 5) }
    };
    /* Linear sliders, each with its own value box; the unit sits beside the box in
       the markup, so the box holds only the number. */
    const LINEAR = {
      'adc-agg-k': { key: 'aggMultiple', scale: 1, fmt: (v) => String(v) },
      'adc-agg-ppm': { key: 'aggPpm', scale: 1, fmt: (v) => String(v) },
      'adc-agg-phase': { key: 'aggPhase', scale: 1, fmt: (v) => String(v) },
      'adc-agg-amp': { key: 'aggAmp', scale: 0.1, fmt: (v) => v.toFixed(1) },
      'adc-coupling': { key: 'couplingDb', scale: 1, fmt: (v) => String(v) },
      'adc-bits': { key: 'bits', scale: 1, fmt: (v) => String(v) },
      'adc-noise': { key: 'noiseUv', scale: 1, fmt: (v) => String(v) },
      'adc-in-a': { key: 'inDbfs', scale: 0.1, fmt: (v) => v.toFixed(1) }
    };
    const SELECTS = {
      'adc-path': { key: 'path' },
      'adc-coupling-type': { key: 'couplingType' }, 'adc-arch': { key: 'arch' },
      'adc-osr': { key: 'osr', num: true }, 'adc-vref': { key: 'vref', num: true }
    };

    const toRaw = (spec, v) => Math.round(1000 * Math.log(v / spec.lo()) / Math.log(spec.hi() / spec.lo()));
    const fromRaw = (spec, raw) => spec.lo() * Math.pow(spec.hi() / spec.lo(), raw / 1000);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function syncControls() {
      limitEdge();
      Object.keys(LOGS).forEach((id) => {
        const spec = LOGS[id], range = $('#' + id), box = $('[data-entry="' + id + '"]');
        if (range) range.value = toRaw(spec, p[spec.key]);
        if (box && document.activeElement !== box) box.value = spec.fmt(p[spec.key]);
        if (box) box.title = spec.key === 'edge' ? 'at most ' + spec.fmt(spec.hi()) + ' at this frequency' : '';
      });
      Object.keys(LINEAR).forEach((id) => {
        const spec = LINEAR[id], range = $('#' + id), box = $('[data-num="' + id + '"]');
        if (range) range.value = Math.round(p[spec.key] / spec.scale);
        if (box && document.activeElement !== box) box.value = spec.fmt(p[spec.key]);
      });
      Object.keys(SELECTS).forEach((id) => { const el = $('#' + id); if (el) el.value = String(p[SELECTS[id].key]); });
      const sync = $('#adc-agg-sync'), base = $('#adc-agg-base');
      if (sync) sync.checked = p.aggMode !== 'free';
      if (base) base.value = p.aggMode === 'odr' ? 'odr' : 'clock';
      const sweepSel = $('#adc-sweep-range');
      if (sweepSel) {
        sweepSel.querySelectorAll('option').forEach((o) => { o.hidden = o.dataset.arch !== p.arch; });
        if (sweepSel.selectedOptions[0] && sweepSel.selectedOptions[0].hidden) {
          sweepSel.value = sweepSel.querySelector('option[data-arch="' + p.arch + '"]').value;
        }
        /* Until the reader picks a sweep, it follows the aggressor: one within three
           output-data-rate steps of a modulator-clock multiple is swept around that
           multiple, where the interesting part is, and any other across the notches. */
        if (p.arch === 'ds' && !sweepPicked) {
          const fa = A.aggressor(p).fa, k = Math.max(1, Math.round(fa / p.fmod));
          sweepSel.value = Math.abs(fa - k * p.fmod) <= 3 * p.fmod / p.osr ? 'ds-clock' : 'ds-odr';
        }
      }
      root.querySelectorAll('[data-when]').forEach((el) => {
        const ok = el.dataset.when.split(' ').every((c) =>
          c === 'sar' ? p.arch === 'sar' : c === 'ds' ? p.arch === 'ds'
            : c === 'free' ? p.aggMode === 'free' : c === 'locked' ? p.aggMode !== 'free' : true);
        el.hidden = !ok;
      });
    }

    /* The converter changed: keep the input tone inside the new band. */
    function keepTone() {
      const spec = LOGS['adc-in-f'];
      p.inFreq = clamp(p.inFreq, spec.lo(), spec.hi());
      if (p.arch === 'sar' && p.aggMode === 'odr') p.aggMode = 'clock';
    }

    function clearPreset() {
      root.querySelectorAll('.preset[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      const n = $('[data-out="note"]'); if (n) n.textContent = '';
    }
    function changed() { clearPreset(); syncControls(); request(); }

    Object.keys(LOGS).forEach((id) => {
      const spec = LOGS[id], range = $('#' + id), box = $('[data-entry="' + id + '"]');
      if (range) range.addEventListener('input', () => {
        p[spec.key] = sig(fromRaw(spec, +range.value), 3);
        if (spec.key === 'edge') p.edgeSet = p.edge;
        if (box) box.value = spec.fmt(p[spec.key]);
        if (spec.key === 'fs' || spec.key === 'fmod') keepTone();
        changed();
      });
      if (box) {
        const commit = () => {
          const v = parseEng(box.value, spec.units);
          if (!(v > 0)) { box.value = spec.fmt(p[spec.key]); return; }
          p[spec.key] = clamp(v, spec.lo(), spec.hi());
          if (spec.key === 'edge') p.edgeSet = p.edge;
          box.value = spec.fmt(p[spec.key]);
          if (spec.key === 'fs' || spec.key === 'fmod') keepTone();
          changed();
        };
        box.addEventListener('change', commit);
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      }
    });
    Object.keys(LINEAR).forEach((id) => {
      const spec = LINEAR[id], range = $('#' + id), box = $('[data-num="' + id + '"]');
      if (range) range.addEventListener('input', () => {
        p[spec.key] = sig(+range.value * spec.scale, 6);
        changed();
      });
      /* A typed value snaps to the slider's own step and range, so the box and the
         slider can never disagree. */
      if (box && range) {
        const commit = () => {
          const v = parseFloat(String(box.value).replace('\u2212', '-'));
          if (!isFinite(v)) { box.value = spec.fmt(p[spec.key]); return; }
          const raw = clamp(Math.round(v / spec.scale / (+range.step || 1)) * (+range.step || 1), +range.min, +range.max);
          p[spec.key] = sig(raw * spec.scale, 6);
          changed();
        };
        box.addEventListener('change', commit);
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      }
    });
    Object.keys(SELECTS).forEach((id) => {
      const spec = SELECTS[id], el = $('#' + id);
      if (el) el.addEventListener('change', () => {
        p[spec.key] = spec.num ? +el.value : el.value;
        if (spec.key === 'arch' || spec.key === 'osr') keepTone();
        changed();
      });
    });
    /* Sharing the converter's clock makes the ratio exact: the multiple nearest the
       current frequency is kept, and unticking it keeps the frequency it reached. */
    const syncBox = $('#adc-agg-sync'), baseSel = $('#adc-agg-base');
    const clockRate = () => (p.arch === 'ds' ? p.fmod : p.fs);
    const unit = () => (p.arch === 'ds' && baseSel && baseSel.value === 'odr' ? p.fmod / p.osr : clockRate());
    if (syncBox) syncBox.addEventListener('change', () => {
      if (syncBox.checked) {
        p.aggMode = p.arch === 'ds' && baseSel && baseSel.value === 'odr' ? 'odr' : 'clock';
        p.aggMultiple = clamp(Math.round(p.aggFreq / unit()), 1, 64);
      } else {
        p.aggFreq = A.aggressor(p).fa;
        p.aggMode = 'free';
      }
      changed();
    });
    if (baseSel) baseSel.addEventListener('change', () => {
      if (p.aggMode !== 'free') p.aggMode = baseSel.value;
      changed();
    });

    const axisSel = $('#adc-axis');
    if (axisSel) axisSel.addEventListener('change', draw);
    const sweepSel = $('#adc-sweep-range');
    if (sweepSel) sweepSel.addEventListener('change', () => { sweepPicked = true; draw(); });

    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(BASE).forEach((k) => { p[k] = BASE[k]; });
      Object.assign(p, q.set);
      p.edgeSet = p.edge;
      sweepPicked = false;
      clearPreset();
      b.setAttribute('aria-pressed', 'true');
      const n = $('[data-out="note"]'); if (n) n.textContent = q.note;
      syncControls();
      request();
    }));

    /* ---------- runs ----------
       A delta-sigma run at oversampling 256 takes tens of milliseconds, and a
       dragged slider fires faster than that. Every change marks the state dirty;
       one run follows, with whatever the controls say by then. */
    /* The queued run is held, so it can be cancelled. Without the handle a rebuild
       scheduled by the last slider move still fires after the panel is destroyed,
       and publishes a result onto a root that is no longer there. `disposed` is the
       second half of that: a timer that has already fired cannot be cleared, so
       every entry point checks it before doing any work. `generation` rises on every
       rebuild, so a sweep started under one set of physical settings can never paint
       under another. */
    let queued = 0, disposed = false, generation = 0;
    function request() {
      if (queued || disposed) return;
      queued = setTimeout(() => { queued = 0; if (!disposed) rebuild(); }, 0);
    }
    function rebuild() {
      if (disposed) return;
      generation++;
      limitEdge();
      M = K.publish(root, A.run(Object.assign({}, p), cache));
      bandSpec = null;
      draw();
    }

    /* ---------- drawing helpers ---------- */
    function message(s, text, colour) {
      const ctx = s.ctx, max = Math.min(s.w - 48, 560), lines = [];
      ctx.save();
      ctx.font = '12px ' + K.MONO;
      let line = '';
      text.split(' ').forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
      });
      if (line) lines.push(line);
      ctx.fillStyle = colour || T.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, s.w / 2, s.h / 2 + (i - (lines.length - 1) / 2) * 17));
      ctx.restore();
    }

    /* The longest wording that fits, so an annotation shortens on a narrow plot
       instead of running past its edge. */
    function fitting(ctx, variants, width) {
      ctx.save();
      ctx.font = '10px ' + K.MONO;
      const pick = variants.find((v) => ctx.measureText(v).width <= width) || variants[variants.length - 1];
      ctx.restore();
      return pick;
    }

    /* A spectrum drawn against its axis floor. Single bins of shaped noise reach far
       below any useful axis, and clipped at the plot's edge the line left the box and
       came back, which read as a cut. Stretches below the floor are drawn along it;
       the hover marker still reads the true level, from an invisible copy. */
    function floorTrace(P, pts, floor, colour, o) {
      const { L, R, TP, B } = P.box, ctx = P.ctx;
      ctx.save();
      ctx.beginPath(); ctx.rect(L, TP, R - L, B - TP); ctx.clip();
      ctx.strokeStyle = colour; ctx.lineWidth = o.width || 1.3; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const px = P.X(x), py = P.Y(Math.max(y, floor));
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
      P.trace(pts, colour, Object.assign({}, o, { alpha: 0 }));
    }

    function freqAxis(lo, hi, log, title) {
      return log ? { min: lo, max: hi, log: true, fmt: hz, title }
                 : { min: 0, max: hi, ticks: niceTicks(0, hi, 5), fmt: hz, title };
    }

    /* One level per pixel column: the mean power of the bins inside it, so white
       noise draws flat on a log axis — a peak detector makes it climb with
       frequency, because high columns hold more bins to take a maximum over. A
       bin standing 6 dB above its column's mean is drawn as a spike to its own
       level, so a one-bin spur survives however many bins share the column. */
    function columnLevels(s, P, amp, df, kLo, kHi) {
      const inv = s.cv.__plot.invX, pts = [];
      let last = -1;
      for (let x = P.box.L; x < P.box.R; x++) {
        let k0 = Math.max(kLo, Math.ceil(inv(x) / df)), k1 = Math.min(kHi, Math.floor(inv(x + 1) / df));
        if (k1 < k0) {
          const k = clamp(Math.round(inv(x + 0.5) / df), kLo, kHi);
          if (k !== last) { pts.push([k * df, amp[k]]); last = k; }
          continue;
        }
        let sum = 0, best = k0;
        for (let k = k0; k <= k1; k++) {
          sum += Math.pow(10, amp[k] / 10);
          if (amp[k] > amp[best]) best = k;
        }
        const mean = 10 * Math.log10(sum / (k1 - k0 + 1)), centre = (k0 + k1) / 2 * df;
        pts.push([centre, mean]);
        if (amp[best] > mean + 6) { pts.push([best * df, amp[best]], [best * df, mean]); }
        last = k1;
      }
      return pts;
    }

    function dbTicks(lo, hi, step) {
      const out = [];
      for (let v = lo; v <= hi; v += step) out.push(v);
      return out;
    }
    /* Where the dB axis ends: low enough to show what the axis shows. A SAR's noise is
       flat, but a second-order Delta-Sigma's rises 40 dB per decade, so on a log axis
       the low decades — most of the width — sit tens of dB below the band edge. Taken
       from bins alone the floor followed the band edge, where most bins are, and the
       low decades lay flat along it. So the level is taken per band spaced as the axis
       is, and the axis ends below the 5th percentile of those bands. */
    function spectrumFloor(an, log) {
      const half = an.M / 2, k0 = A.LOBE + 1, bands = 240, levels = [];
      for (let i = 0; i < bands; i++) {
        const edge = (u) => (log ? k0 * Math.pow((half - 1) / k0, u) : k0 + (half - 1 - k0) * u);
        const lo = Math.floor(edge(i / bands)), hi = Math.max(lo, Math.floor(edge((i + 1) / bands)) - 1);
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += Math.pow(10, an.amp[k] / 10);
        levels.push(10 * Math.log10(sum / (hi - lo + 1)));
      }
      levels.sort((u, v) => u - v);
      return clamp(Math.floor((levels[Math.floor(bands * 0.05)] - 6) / 20) * 20, -260, -100);
    }
    /* The coarsest tick step that still leaves 22 px between labels. */
    const dbStep = (height, bottom) => [20, 40, 60, 80].find((st) => height * st / (10 - bottom) >= 22) || 80;
    const harmonicName = (q) => (q.side ? 'in' + (q.side > 0 ? '+' : '−') + 'h' + q.n : 'h' + q.n);

    /* ---------- output spectrum ---------- */
    function drawSpectrum() {
      if (!shown(cv.spectrum)) return;
      const s = K.canvas(cv.spectrum, 260);
      if (M.status !== 'ok') { message(s, M.why, T.alarm); return; }
      const m = M.measurements, an = M.generated.analysis, df = an.df, half = an.M / 2;
      const log = !axisSel || axisSel.value === 'log';
      const bottom = spectrumFloor(an, log);
      const step = dbStep(s.h - 50, bottom);
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 20, b: 30 },
        x: freqAxis(df, an.fs / 2, log, 'frequency'),
        y: { min: bottom, max: 10, ticks: dbTicks(bottom, 0, step), fmt: (v) => v.toFixed(0), title: 'dBFS' }
      }).grid();
      floorTrace(P, columnLevels(s, P, an.amp, df, 1, half - 1), bottom, T.signal,
                 { width: 1.3, id: 'output-spectrum', label: 'output spectrum', unit: 'dBFS' });
      P.hline(m.floorDbfs, T.muted, [3, 4]);

      const ctx = s.ctx, { L, R, TP, B } = P.box;
      K.text(ctx, fitting(ctx, ['dashed: average noise per bin', 'dashed: noise per bin'], R - L - 40), R, TP - 9, T.muted, 10, 'right');
      /* The bins SNR leaves out as DC. An offset's window lobe lives here, and on a
         log axis it would otherwise read as low-frequency noise. */
      const dcEdge = clamp(P.X((A.LOBE + 0.5) * df), L, R);
      if (dcEdge > L + 1) {
        ctx.save();
        ctx.fillStyle = K.rgba(T.muted, 0.14);
        ctx.fillRect(L, TP, dcEdge - L, B - TP);
        ctx.restore();
        if (dcEdge - L > 18) K.text(ctx, 'DC', (L + dcEdge) / 2, B - 8, T.muted, 10, 'center');
      }
      const fx = P.X(m.inputFrequency);
      K.text(ctx, 'input ' + hz(m.inputFrequency), fx > R - 120 ? fx - 6 : fx + 6, P.Y(0) + 2, T.ink2, 10,
             fx > R - 120 ? 'right' : 'left');
      let lastX = -1e9, row = 0;
      M.generated.labels.slice().sort((u, v) => u.f - v.f).forEach((q) => {
        const x = P.X(q.f), y = P.Y(q.dbfs);
        if (x < L || x > R) return;
        row = x - lastX < 70 ? row + 1 : 0;
        lastX = x;
        K.dot(ctx, x, y, T.reflect, null, 3);
        K.text(ctx, harmonicName(q), clamp(x, L + 14, R - 14), y - 10 - row * 11, T.reflect, 10, 'center');
      });
      const lsb = p.arch === 'sar' ? Math.abs(m.offsetLsb) >= 0.5 : Math.abs(m.offset) > p.vref * Math.pow(10, m.noiseDbfs / 20);
      const x0 = Math.max(L + 6, dcEdge + 6), room = R - x0 - 4;
      if (m.slowBeat) {
        const beat = 'h' + m.slowBeatHarmonic + ' beats at ' + eng(m.slowBeat, 'Hz', 3);
        K.text(ctx, fitting(ctx, [beat + ': in the DC bins, read as offset', beat + ': read as offset', beat], room),
          x0, TP + 26, T.reflect, 10, 'left');
      } else if (lsb) {
        const off = 'offset ' + signed(m.offset * 1e3, 2) + ' mV';
        const lsbText = p.arch === 'sar' ? ' (' + signed(m.offsetLsb, 1) + ' LSB)' : '';
        K.text(ctx, fitting(ctx, [off + lsbText + ' — at DC, outside SNR', off + lsbText, off], room),
          x0, TP + 26, T.reflect, 10, 'left');
      }
      P.frame();
    }

    /* ---------- folding map ---------- */
    function drawFold() {
      if (!shown(cv.fold)) return;
      const s = K.canvas(cv.fold, 260);
      if (M.status !== 'ok') { message(s, 'No result for this configuration.'); return; }
      if (p.path === 'none') {
        message(s, 'Nothing is coupled. Choose a path — into the input or into the reference — to see where the aggressor’s harmonics land.');
        return;
      }
      const m = M.measurements, g = M.generated, an = g.analysis, df = an.df;
      const H = g.harmonics;
      if (!H.length) { message(s, 'The aggressor has no harmonics inside the modelled range.'); return; }
      const ctx = s.ctx, split = Math.round(s.h * 0.42);

      const pinMax = Math.max.apply(null, H.map((h) => h.pinDbfs));
      const topMax = Math.ceil((pinMax + 6) / 20) * 20, topMin = topMax - 80;
      const visible = H.filter((h) => h.pinDbfs > topMin);
      const fLo = H[0].f / 1.6, fHi = Math.max(visible.length ? visible[visible.length - 1].f : H[0].f, H[0].f * 10) * 1.6;
      const Pt = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 20, b: s.h - split },
        x: { min: fLo, max: fHi, log: true, fmt: hz },
        y: { min: topMin, max: topMax, ticks: [topMin, topMin + 40, topMax], fmt: (v) => v.toFixed(0), title: 'harmonics at the pin, dBFS' }
      }).grid();
      /* The comb faint, one stroke per pixel column at the strongest harmonic in it:
         on a log axis hundreds of harmonics share a column, and overlapping strokes
         stacked into a solid block. The few that land highest are drawn solid
         further down, once they are known. */
      const faint = K.rgba(T.reflect, 0.4), column = new Map();
      visible.forEach((h) => {
        if (h.f >= fHi) return;
        const x = Math.round(Pt.X(h.f));
        if (!column.has(x) || h.pinDbfs > column.get(x)) column.set(x, h.pinDbfs);
      });
      column.forEach((level, x) => K.line(ctx, x, Pt.Y(topMin), x, Pt.Y(level), faint, 1));
      const inTop = (f) => f > fLo && f < fHi;
      const clock = p.arch === 'ds' ? p.fmod : p.fs, agg = g.agg;
      const clockName = p.arch === 'ds' ? 'fmod' : 'fs', marks = [], short = [];
      if (inTop(clock)) {
        K.line(ctx, Pt.X(clock), Pt.box.TP, Pt.X(clock), Pt.box.B, T.ink2, 1, [4, 3]);
        marks.push('dashed ' + clockName); short.push(clockName);
      }
      if (inTop(agg.fbw)) {
        K.line(ctx, Pt.X(agg.fbw), Pt.box.TP, Pt.X(agg.fbw), Pt.box.B, T.ink2, 1, [1, 3]);
        marks.push('dotted RC pole'); short.push('RC pole');
      }
      if (marks.length) {
        K.text(ctx, fitting(ctx, [marks.join(' · '), short.join(' · ')], Pt.box.R - Pt.box.L - 150),
               Pt.box.R, Pt.box.TP - 9, T.ink2, 10, 'right');
      }
      Pt.frame();

      const log = !axisSel || axisSel.value === 'log';
      const bottom = spectrumFloor(an, log);
      const Pb = K.plot(s, T, {
        pad: { l: 50, r: 14, t: split + 32, b: 30 },
        x: freqAxis(df, an.fs / 2, log, 'where it lands in the output'),
        y: { min: bottom, max: 10, ticks: [bottom, Math.round(bottom / 40) * 20, 0], fmt: (v) => v.toFixed(0), title: 'in the output, dBFS' }
      }).grid();
      const xb = (f) => Pb.X(Math.max(f, log ? df : 0));
      /* The measured output behind the predicted landings: a stem that meets a spike
         is a harmonic accounted for, and reference coupling's raised floor, which
         has no stems at all, still shows. */
      floorTrace(Pb, columnLevels(s, Pb, an.amp, df, 1, an.M / 2 - 1), bottom, K.rgba(T.signal, 0.3),
                 { width: 1, id: 'fold-output', label: 'measured output', unit: 'dBFS' });
      const joins = [], landed = new Map();
      let dc = 0, beats = 0;

      if (p.path === 'input') {
        /* What the filter removed, for the six strongest only: drawn for every
           harmonic it became a hatching that hid the stems that did land. */
        const ghosts = new Set(H.filter((h) => p.arch === 'ds' && h.filter < 0.99 && h.pinDbfs > bottom
                                           && h.land >= (A.LOBE + 0.5) * df)
          .sort((u, v) => v.pinDbfs - u.pinDbfs).slice(0, 6).map((h) => h.n));
        H.forEach((h) => {
          if (h.land < (A.LOBE + 0.5) * df) {
            if (h.outDbfs > bottom) { if (h.land > 1e-9 * an.fs) beats++; else dc++; }
            return;
          }
          if (ghosts.has(h.n)) {
            K.line(ctx, xb(h.land), Pb.Y(bottom), xb(h.land), Pb.Y(Math.min(h.pinDbfs, 10)), K.rgba(T.muted, 0.6), 1, [2, 3]);
          }
          if (h.outDbfs > bottom) {
            const x = Math.round(xb(h.land));
            if (!landed.has(x) || h.outDbfs > landed.get(x)) landed.set(x, h.outDbfs);
            joins.push({ n: h.n, f: h.f, pin: h.pinDbfs, x: xb(h.land), y: Pb.Y(h.outDbfs), level: h.outDbfs });
          }
        });
        /* Landings as the top lane draws its comb: one faint stroke per column, and
           the strongest drawn solid with their joins. */
        landed.forEach((level, x) => K.line(ctx, x, Pb.Y(bottom), x, Pb.Y(level), K.rgba(T.reflect, 0.45), 1));
        joins.slice().sort((u, v) => v.level - u.level).slice(0, 5)
          .forEach((q) => K.line(ctx, q.x, Pb.Y(bottom), q.x, q.y, T.reflect, 1.6));
      } else {
        g.labels.forEach((q) => {
          const h = H.find((c) => c.n === q.n);
          K.line(ctx, xb(q.f), Pb.Y(bottom), xb(q.f), Pb.Y(q.dbfs), T.reflect, 1.4);
          if (h) joins.push({ n: q.n, side: q.side, f: h.f, pin: h.pinDbfs, x: xb(q.f), y: Pb.Y(q.dbfs), level: q.dbfs });
        });
      }
      const placed = [];
      joins.sort((u, v) => v.level - u.level).slice(0, 5).forEach((j, i) => {
        if (j.f >= fHi) return;
        const xt = Pt.X(j.f), yt = Pt.Y(Math.max(j.pin, topMin));
        K.line(ctx, xt, Pt.Y(topMin), xt, yt, T.reflect, 1.6);
        K.line(ctx, xt, yt, j.x, j.y, K.rgba(T.ink2, 0.55), 1, [4, 3]);
        if (i > 2 || placed.some((q) => q.side === j.side && q.n === j.n)) return;   // name the three strongest
        let ly = yt - 8;
        while (placed.some((q) => Math.abs(q.x - xt) < 24 && Math.abs(q.y - ly) < 11)) ly -= 11;
        placed.push({ x: xt, y: ly, n: j.n, side: j.side });
        K.text(ctx, 'h' + j.n, xt, Math.max(ly, Pt.box.TP + 4), T.reflect, 10, 'center');
      });
      const { L, TP } = Pb.box;
      let say = '';
      if (p.path === 'input' && dc) say = dc + ' on DC: offset ' + signed(m.offset * 1e3, 2) + ' mV';
      if (p.path === 'input' && beats) say = (say ? say + ' · ' : '') + beats + ' in the DC bins, beating';
      if (p.path === 'input' && p.arch === 'ds') say = (say ? say + ' · ' : '') + 'dotted: before sinc³';
      if (p.path === 'reference') say = g.labels.length ? 'sidebands of the input' : 'no spur: spread as noise';
      if (say) K.text(ctx, say, L + 6, TP + 8, T.muted, 10, 'left');
      Pb.frame();
    }

    /* ---------- disturbance in time ---------- */
    function drawTime() {
      if (!shown(cv.time)) return;
      const s = K.canvas(cv.time, 210);
      const agg = A.aggressor(p), isDs = p.arch === 'ds', clock = agg.clock;
      const W = isDs ? clamp(2 / agg.ratio, 24, 400) : clamp(2 / agg.ratio, 3, 60);   // clock periods
      let gmin = Infinity, gmax = -Infinity;
      const probe = (th) => { const v = agg.atPhase(th); if (v < gmin) gmin = v; if (v > gmax) gmax = v; };
      for (let i = 0; i < 2048; i++) probe(i / 2048);
      [agg.r, 0.5 + agg.r].forEach(probe);
      const lim = Math.max(Math.abs(gmin), Math.abs(gmax)) * 1.18 || 1e-9;
      const [us, uname] = lim >= 1 ? [1, 'V'] : lim >= 1e-3 ? [1e3, 'mV'] : lim >= 1e-6 ? [1e6, 'µV'] : [1e9, 'nV'];
      const yl = sig(lim * us, 2);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 14, t: 20, b: 30 },
        x: { min: 0, max: W / clock, ticks: niceTicks(0, W / clock, 5), fmt: (v) => eng(v, 's', 3), title: 'time' },
        y: { min: -yl, max: yl, ticks: [-yl, -yl / 2, 0, yl / 2, yl], fmt: (v) => String(sig(v, 2)), title: uname + ' at the pin' }
      }).grid();
      const ctx = s.ctx, { L, R, TP, B } = P.box;
      const colT = W / (R - L), top = [], bot = [];
      for (let c = 0; c <= R - L; c++) {
        const t0 = c * colT;
        let lo = Infinity, hi = -Infinity;
        if (colT * agg.ratio >= 1) { lo = gmin; hi = gmax; } else {
          const take = (t) => { const v = agg.at(t); if (v < lo) lo = v; if (v > hi) hi = v; };
          for (let j = 0; j <= 6; j++) take(t0 + colT * j / 6);
          const th0 = agg.ratio * t0 + agg.phase0, th1 = agg.ratio * (t0 + colT) + agg.phase0;
          for (let k = Math.ceil((th0 - agg.r) * 2); k / 2 + agg.r <= th1; k++) take((k / 2 + agg.r - agg.phase0) / agg.ratio);
        }
        top.push([t0 / clock, hi * us]); bot.push([t0 / clock, lo * us]);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(L, TP, R - L, B - TP); ctx.clip();
      ctx.beginPath();
      top.forEach(([t, v], i) => (i ? ctx.lineTo(P.X(t), P.Y(v)) : ctx.moveTo(P.X(t), P.Y(v))));
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(P.X(bot[i][0]), P.Y(bot[i][1]));
      ctx.closePath();
      ctx.fillStyle = K.rgba(T.signal, 0.28); ctx.fill();
      ctx.restore();
      P.trace(top, T.signal, { width: 1.3, id: 'disturbance-max', label: 'coupled disturbance, upper', unit: uname });
      P.trace(bot, T.signal, { width: 1.3, id: 'disturbance-min', label: 'coupled disturbance, lower', unit: uname });

      const samples = Math.floor(W);
      if (!isDs) {
        for (let n = 0; n <= samples; n++) {
          const x = P.X(n / clock);
          K.line(ctx, x, TP, x, B, K.rgba(T.alarm, 0.55), 1, [3, 3]);
          if (p.path === 'input') K.dot(ctx, x, P.Y(agg.at(n) * us), T.alarm, null, 3);
          if (samples <= 8) {
            for (let j = 0; j < p.bits; j++) {
              const tj = n + (j + 0.5) / (2 * p.bits), xj = P.X(tj / clock);
              K.line(ctx, xj, B - 7, xj, B, T.ink2, 1);
              if (p.path === 'reference') K.dot(ctx, xj, P.Y(agg.at(tj) * us), T.reflect, null, 2);
            }
          }
        }
        const room = R - L - 60;                         // clear of the y-axis title on the left
        const variants = samples <= 8
          ? ['dashed: sampling instants · ticks: ' + p.bits + ' bit trials' + (p.path === 'reference' ? ', each reading the reference' : ''),
             'dashed: sampling instants · ticks: ' + p.bits + ' bit trials', 'dashed: samples · ticks: bit trials', 'dashed: samples']
          : ['dashed: sampling instants', 'dashed: samples'];
        K.text(ctx, fitting(ctx, variants, room), R, TP - 9, T.muted, 10, 'right');
      } else {
        const every = samples > 120 ? Math.ceil(samples / 120) : 1;
        for (let n = 0; n <= samples; n += every) K.dot(ctx, P.X(n / clock), P.Y(agg.at(n) * us), T.alarm, null, 2);
        K.text(ctx, fitting(ctx, ['dots: modulator samples' + (every > 1 ? ' (every ' + every + 'th)' : ''), 'dots: samples'], R - L - 60),
          R, TP - 9, T.muted, 10, 'right');
      }
      if (p.path === 'none') K.text(ctx, 'not coupled — what this level would put on the pin', L + 6, B - 9, T.muted, 10, 'left');
      P.frame();
    }

    /* ---------- SNR against aggressor frequency ----------
       A progressive sweep on a shorter record, so each point is a few ms. It runs
       only while its view is open, and restarts when anything but the aggressor
       frequency changes. */
    const sweep = { key: '', xs: [], snr: [], off: [], i: 0, clean: NaN, timer: 0 };
    function sweepRange() {
      const odr = p.fmod / p.osr, mode = sweepSel ? sweepSel.value : 'sar';
      if (p.arch === 'sar') return { lo: 0, hi: 5 * p.fs, marks: [1, 2, 3, 4, 5].map((k) => k * p.fs), name: 'sample-clock multiples' };
      if (mode === 'ds-clock') {
        const centre = Math.max(1, Math.round(A.aggressor(p).fa / p.fmod)) * p.fmod;
        return { lo: centre - 3 * odr, hi: centre + 3 * odr, marks: [-3, -2, -1, 0, 1, 2, 3].map((k) => centre + k * odr), name: 'modulator-clock multiple and data-rate steps' };
      }
      return { lo: 0, hi: 6 * odr, marks: [1, 2, 3, 4, 5, 6].map((k) => k * odr), name: 'data-rate multiples' };
    }
    function sweepTick() {
      sweep.timer = 0;
      /* A tick that outlived its settings, or the panel, has nothing to say. One
         tick is a few whole runs, so it cannot be interrupted part way — the check
         is at the boundary, which is where a stale result would otherwise be
         written into the current sweep's arrays. */
      if (disposed || sweep.generation !== generation) return;
      const t0 = performance.now();
      while (sweep.i < sweep.xs.length && performance.now() - t0 < 24) {
        const f = sweep.xs[sweep.i];
        const q = Object.assign({}, p, { aggMode: 'free', aggFreq: f, edge: Math.min(p.edgeSet, maxEdge(f)), record: 12, outputs: 512 });
        const r = A.run(q, sweepCache);
        sweep.snr[sweep.i] = r.status === 'ok' ? r.measurements.snr : NaN;
        sweep.off[sweep.i] = r.status === 'ok' ? r.measurements.offset : NaN;
        if (r.status === 'ok') sweep.clean = r.measurements.snrClean;
        sweep.i++;
      }
      paintSweep();
      if (sweep.i < sweep.xs.length && !disposed) sweep.timer = setTimeout(sweepTick, 0);
    }
    function drawSweep() {
      if (!shown(cv.sweep)) return;
      const q = Object.assign({}, p);
      delete q.aggFreq; delete q.aggMode; delete q.aggMultiple;
      const key = JSON.stringify(q) + (sweepSel ? sweepSel.value : '');
      if (key !== sweep.key) {
        clearTimeout(sweep.timer);
        const rg = sweepRange(), n = 240, xs = [];
        for (let i = 0; i <= n; i++) { const f = rg.lo + (rg.hi - rg.lo) * i / n; if (f > 0) xs.push(f); }
        Object.assign(sweep, { key, xs, snr: xs.map(() => NaN), off: xs.map(() => NaN), i: 0, clean: NaN,
                               range: rg, generation });
        if (p.path !== 'none') sweep.timer = setTimeout(sweepTick, 0);
      } else if (!sweep.timer && sweep.i < sweep.xs.length && p.path !== 'none') {
        sweep.timer = setTimeout(sweepTick, 0);           // resumed after stop()
      }
      paintSweep();
    }
    function paintSweep() {
      if (!shown(cv.sweep)) return;
      const s = K.canvas(cv.sweep, 230);
      if (p.path === 'none') { message(s, 'Nothing is coupled, so SNR does not depend on the aggressor frequency. Choose a coupling path.'); return; }
      const rg = sweep.range, ctx = s.ctx;
      const done = sweep.snr.filter(isFinite);
      const hiV = Math.max(isFinite(sweep.clean) ? sweep.clean : 0, done.length ? Math.max.apply(null, done) : 100);
      const loV = done.length ? Math.min.apply(null, done) : 0;
      const yMax = Math.ceil((hiV + 4) / 10) * 10, yMin = Math.floor((loV - 4) / 10) * 10;
      const pad = { l: 50, r: 50, t: 20, b: 30 };
      const xAxis = { min: rg.lo, max: rg.hi, ticks: niceTicks(rg.lo, rg.hi, 5), fmt: hz,
                      title: 'aggressor frequency — dotted: ' + rg.name };
      const snrAxis = { min: yMin, max: yMax, ticks: niceTicks(yMin, yMax, 4), fmt: (v) => v.toFixed(0), title: 'SNR, dB' };

      /* Offset shares the plot on its own right-hand axis: an exact multiple
         returns SNR to its clean value and moves the error into offset, and the
         two only read as one event when they are drawn over each other. The SNR
         plot is drawn last so the probe reads SNR. */
      const Pg = K.plot(s, T, { pad, x: xAxis, y: snrAxis }).grid();
      rg.marks.forEach((f) => {
        if (f > rg.lo && f < rg.hi) K.line(ctx, Pg.X(f), Pg.box.TP, Pg.X(f), Pg.box.B, K.rgba(T.muted, 0.5), 1, [2, 3]);
      });
      const offs = sweep.off.map((v) => v * 1e6);
      const big = offs.filter(isFinite).reduce((a, v) => Math.max(a, Math.abs(v)), 0);
      const lim = sig(Math.max(big * 1.15, 1), 2);
      const Po = K.plot(s, T, { pad, x: xAxis, y: { min: -lim, max: lim } });
      Po.trace(sweep.xs.map((x, i) => [x, offs[i]]), T.reflect, { width: 1.3, id: 'offset-sweep', label: 'offset', unit: 'µV' });
      [-lim, 0, lim].forEach((v) => K.text(ctx, String(sig(v, 2)), Po.box.R + 6, Po.Y(v), T.reflect, 10, 'left'));
      K.text(ctx, 'offset, µV', Po.box.R + 44, Po.box.TP - 9, T.reflect, 10, 'right');

      const Ps = K.plot(s, T, { pad, x: xAxis, y: snrAxis });
      Ps.trace(sweep.xs.map((x, i) => [x, sweep.snr[i]]), T.signal, { width: 1.6, id: 'snr-sweep', label: 'SNR', unit: 'dB' });
      if (isFinite(sweep.clean)) Ps.hline(sweep.clean, T.muted, [4, 4], 'no aggressor');
      const fa = M && M.measurements ? M.measurements.aggressorFrequency : NaN;
      if (fa > rg.lo && fa < rg.hi) {
        const x = Ps.X(fa), right = x > Ps.box.R - 60;
        K.line(ctx, x, Ps.box.TP, x, Ps.box.B, T.alarm, 1, [5, 3]);
        K.text(ctx, 'now', right ? x - 4 : x + 4, Ps.box.B - 8, T.alarm, 10, right ? 'right' : 'left');
      }
      if (sweep.i < sweep.xs.length) K.text(ctx, 'computing ' + sweep.i + ' of ' + sweep.xs.length, Ps.box.L + 6, Ps.box.TP + 8, T.muted, 10, 'left');
      Ps.frame();
    }

    /* ---------- modulator full band ---------- */
    function drawBand() {
      if (!shown(cv.band)) return;
      const s = K.canvas(cv.band, 230);
      if (p.arch !== 'ds') { message(s, 'A SAR has no modulator. Its output spectrum above already covers its whole band, from DC to half the sample rate.'); return; }
      if (M.status !== 'ok') { message(s, M.why, T.alarm); return; }
      if (!bandSpec) bandSpec = A.bitSpectrum(M.generated.bits, p.vref);
      const df = p.fmod / bandSpec.M, odr = p.fmod / p.osr;
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 20, b: 30 },
        x: { min: df, max: p.fmod / 2, log: true, fmt: hz, title: 'frequency, modulator bitstream' },
        y: { min: -160, max: 10, ticks: dbTicks(-160, 0, 40), fmt: (v) => v.toFixed(0), title: 'dBFS · filter dB' }
      }).grid();
      const ctx = s.ctx;
      ctx.save();
      ctx.fillStyle = K.rgba(T.signal, 0.1);
      ctx.fillRect(P.box.L, P.box.TP, clamp(P.X(odr / 2), P.box.L, P.box.R) - P.box.L, P.box.B - P.box.TP);
      ctx.restore();
      floorTrace(P, columnLevels(s, P, bandSpec.amp, df, 1, bandSpec.M / 2 - 1), -160, T.signal,
                 { width: 1.1, id: 'bitstream', label: 'modulator bitstream', unit: 'dBFS' });
      const resp = [];
      for (let i = 0; i <= 900; i++) {
        const f = df * Math.pow((p.fmod / 2) / df, i / 900);
        resp.push([f, 20 * Math.log10(Math.max(A.sinc3(f, p.fmod, p.osr), 1e-8))]);
      }
      P.trace(resp, T.reflect, { width: 1.1, dash: [4, 3], id: 'sinc3', label: 'sinc³ response', unit: 'dB' });
      const xe = P.X(odr / 2);
      K.line(ctx, xe, P.box.TP, xe, P.box.B, T.ink2, 1, [3, 3]);
      K.text(ctx, 'band edge', xe - 4, P.box.B - 8, T.ink2, 10, 'right');
      K.text(ctx, 'shaded: the output band · dashed: sinc³ filter', P.box.R, P.box.TP - 9, T.muted, 10, 'right');
      P.frame();
    }

    /* ---------- readouts ---------- */
    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const agg = A.aggressor(p), q = A.commonPeriod(agg.ratio);
      const clockName = p.arch === 'ds' ? 'modulator clock' : 'sample clock';
      const lands = A.fold(agg.fa, rate());
      const derived = eng(agg.fa, 'Hz', 7) + ' = ' + sig(agg.ratio, 7) + ' × ' + clockName;
      const short = p.aggMode === 'free'
        ? (lands === 0 ? eng(agg.fa, 'Hz', 7) + ': an exact multiple, which needs a shared clock'
                       : eng(agg.fa, 'Hz', 7) + ' → lands at ' + eng(lands, 'Hz', 4))
        : 'exactly ' + eng(agg.fa, 'Hz', 7) + (p.aggMode === 'odr' ? ' · on the sinc³ nulls' : ' · lands on DC');
      const period = q === 1 ? 'every sample sees the aggressor at the same phase'
        : q && q <= 256 ? 'aggressor and clock repeat together every ' + q + ' samples, so only ' + q + ' aggressor phases are ever sampled'
        : 'no short common period: the samples sweep every aggressor phase';
      set('agg-derived', short);
      set('arch-name', p.arch === 'ds' ? 'Delta-Sigma' : 'SAR');
      set('rate-derived', p.arch === 'ds' ? 'output rate ' + eng(rate(), 'Hz', 4) + ' · band to ' + eng(rate() / 2, 'Hz', 4) : 'band to ' + eng(p.fs / 2, 'Hz', 4));

      /* The headline numbers: the value large, its unit or qualifier small beside it,
         and the SNR lost to the aggressor in the alarm colour once it is worth a look. */
      const metric = (k, value, unit, tone) => {
        const e = $('[data-out="' + k + '"]');
        if (!e) return;
        e.textContent = value;
        if (unit) { const u = document.createElement('small'); u.textContent = ' ' + unit; e.appendChild(u); }
        if (tone) e.dataset.tone = tone; else delete e.dataset.tone;
      };

      if (M.status !== 'ok') {
        ['snr', 'loss', 'sfdr', 'offset'].forEach((k) => metric(k, '—'));
        set('in-derived', '');
        K.summary(root, [{ label: 'result', value: 'refused', note: M.why, colour: 'alarm' }], { label: 'This converter' });
        return;
      }
      const m = M.measurements, d = M.diagnostics;
      set('in-derived', 'coherent tone ' + eng(m.inputFrequency, 'Hz', 5));
      metric('snr', m.snr.toFixed(1), 'dB');
      if (Math.abs(m.snrLoss) < 0.05) metric('loss', 'none');
      else metric('loss', signed(-m.snrLoss, 1), 'dB', m.snrLoss >= 1 ? 'alarm' : null);
      metric('sfdr', m.sfdr.toFixed(1), 'dBc');
      /* Millivolts from 1 mV up, so a large offset reads +9.00 mV rather than +9000 µV. */
      const big = Math.abs(m.offset) >= 1e-3;
      const offNum = big ? signed(m.offset * 1e3, 2) : signed(m.offset * 1e6, p.arch === 'sar' ? 0 : 1);
      const offUnit = big ? 'mV' : 'µV';
      if (m.slowBeat) metric('offset', offNum, offUnit + ', wandering at ' + eng(m.slowBeat, 'Hz', 3));
      else if (p.arch === 'sar') metric('offset', offNum, offUnit + ' · ' + signed(m.offsetLsb, 1) + ' LSB');
      else metric('offset', offNum, offUnit);
      const h1 = M.generated.harmonics[0];
      const notes = d.notes.slice();
      if (m.clippedSamples) notes.push(m.clippedSamples + ' samples beyond full scale — clipping adds its own harmonics');
      const rows = [
        { label: 'SNR', value: m.snr.toFixed(2) + ' dB', colour: 'signal',
          note: 'everything in band except the input, its harmonics 2–6 and DC; interference counts' },
        { label: 'SNR without the aggressor', value: m.snrClean.toFixed(2) + ' dB',
          note: 'same converter and input, nothing coupled — lost to the aggressor: ' + m.snrLoss.toFixed(2) + ' dB' },
        { label: p.arch === 'ds' ? 'linear-model limit' : 'ideal quantization SNR', value: m.idealSnr.toFixed(2) + ' dB',
          note: p.arch === 'ds' ? '6.02 + 1.76 − 10 log(π⁴/5) + 50 log(OSR), at this input level; a 1-bit loop measures a few dB under it'
                                : '6.02 × ' + p.bits + ' + 1.76, at this input level' },
        { label: 'SINAD · ENOB', value: m.sinad.toFixed(2) + ' dB · ' + m.enob.toFixed(2) + ' bits', note: 'ENOB referred to full scale' },
        { label: 'SFDR', value: m.sfdr.toFixed(1) + ' dBc', note: 'largest spur at ' + eng(m.spurAt, 'Hz', 5) + ', harmonics included' },
        { label: 'largest interference spur', value: m.interferenceDbfs.toFixed(1) + ' dBFS',
          note: 'at ' + eng(m.interferenceAt, 'Hz', 5) + (M.generated.labels[0] ? ' · strongest labelled: ' + harmonicName(M.generated.labels[0]) : ''),
          colour: 'reflect' },
        { label: 'offset', value: (Math.abs(m.offset) >= 1e-3 ? signed(m.offset * 1e3, 3) + ' mV' : signed(m.offset * 1e6, 1) + ' µV')
            + (p.arch === 'sar' ? ' · ' + signed(m.offsetLsb, 2) + ' LSB' : ''),
          note: m.slowBeat
            ? 'mean of this record — harmonic ' + m.slowBeatHarmonic + ' beats at ' + eng(m.slowBeat, 'Hz', 4)
              + ', slower than the record resolves, so it lands in the DC bins; a real system sees this offset wander at that rate'
            : 'mean of the output — where an aggressor that folds exactly to DC goes' },
        { label: 'aggressor', value: eng(m.aggressorFrequency, 'Hz', 7), note: derived + ' · ' + period },
        { label: 'rise and fall time', value: eng(p.edge, 's', 3) + ' (10–90%)',
          note: p.edgeSet > p.edge * 1.0001
            ? 'held to a fifth of the aggressor’s period; ' + eng(p.edgeSet, 's', 3) + ' is set and returns at a lower frequency'
            : 'at most a fifth of the period, ' + eng(maxEdge(), 's', 3) + ' at this frequency' },
        { label: 'coupled fundamental at the pin', value: p.path === 'none' ? 'not coupled' : h1.pinDbfs.toFixed(1) + ' dBFS',
          note: p.path === 'none' ? '' : eng(h1.amp, 'V', 3) + ' peak, ' + (p.couplingType === 'capacitive' ? 'capacitive' : 'flat') + ' coupling into the ' + p.path },
        { label: 'input tone', value: eng(m.inputFrequency, 'Hz', 5) + ' · ' + m.signalDbfs.toFixed(2) + ' dBFS',
          note: 'an odd number of cycles in the record, so it sits exactly on a bin' },
        { label: 'record', value: d.record.toLocaleString('en-GB') + ' samples',
          note: 'bin width ' + eng(m.outputRate / d.record, 'Hz', 4) + ' · 4-term Blackman-Harris'
            + (p.arch === 'ds' ? ' · peak integrator state ' + d.peakState.toFixed(1) + ' × Vref' : '') }
      ];
      if (notes.length) rows.push({ label: 'model notes', value: notes.length + '', note: notes.join(' · '), colour: 'alarm' });
      K.summary(root, rows, { label: 'This converter' });
    }

    function draw() {
      if (!M) return;
      T = K.theme(root);
      drawSpectrum(); drawFold(); drawTime(); drawSweep(); drawBand(); readouts();
      /* The loader gives a hover marker only to plots drawn when the lab mounts;
         the ones inside a view that opens later are given theirs when first drawn. */
      root.querySelectorAll('canvas[data-cv]').forEach((c) => { if (c.__plot && !c.__probed) K.probe(c); });
    }

    const offRepaint = K.onRepaint(root, draw);
    document.addEventListener('sipi:theme', draw);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 140); };
    window.addEventListener('resize', onResize);

    const first = root.querySelector('.preset[data-preset="sar-fold"]');
    if (first) { first.setAttribute('aria-pressed', 'true'); const n = $('[data-out="note"]'); if (n) n.textContent = PRESETS['sar-fold'].note; }
    syncControls();
    rebuild();

    return {
      start() { if (M) drawSweep(); },
      stop() { clearTimeout(sweep.timer); sweep.timer = 0; },
      destroy() {
        disposed = true;
        clearTimeout(queued);
        clearTimeout(sweep.timer);
        clearTimeout(rt);
        sweep.timer = queued = rt = 0;
        offRepaint();
        window.removeEventListener('resize', onResize);
        document.removeEventListener('sipi:theme', draw);
      }
    };
  };

  /* The scenario settings and notes, for check-adc.js to hold each note's numbers
     against a run of the model with that scenario's own settings. */
  NS.viz.adcLab.base = BASE;
  NS.viz.adcLab.presets = PRESETS;
})();
