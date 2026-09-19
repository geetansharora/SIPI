/* SI & PI — viz/eq.js
 * Equalisation, PAM4, and compliance masks — three panels on one channel model.
 *
 *   equalizer  — the same eye before and after CTLE + DFE
 *   pam4       — NRZ against PAM4 at the same bit rate, and the 9.5 dB penalty
 *   mask       — a statistical eye contour against a compliance polygon
 *
 * The channel is viz-kit's shared model. CTLE is a real single-zero/two-pole
 * response applied in the frequency domain; DFE cancels the post-cursor taps of
 * the actual pulse response, which is what a DFE physically does. Nothing here
 * is a drawn eye shape.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const SPS = 32, NFFT = 4096;

  function lfsr(n, seed) {
    let s = seed || 0x4a1;
    const b = new Int8Array(n);
    for (let i = 0; i < n; i++) { const x = ((s >> 14) ^ (s >> 13)) & 1; s = ((s << 1) | x) & 0x7fff; b[i] = s & 1; }
    return b;
  }
  function shape(levels, sps, tr) {                 // levels: array of symbol amplitudes
    const n = levels.length * sps, x = new Float64Array(n), trs = Math.max(1, tr * sps);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(i / sps);
      const prev = idx > 0 ? levels[idx - 1] : levels[0], cur = levels[idx];
      const u = (i - idx * sps) / trs;
      const a = (u >= 1 || prev === cur) ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
      x[i] = prev + (cur - prev) * a;
    }
    return x;
  }
  function conv(x, h) {
    const y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let s = 0; const kmax = Math.min(h.length, i + 1);
      for (let k = 0; k < kmax; k++) s += h[k] * x[i - k];
      y[i] = s;
    }
    return y;
  }
  /* CTLE and DFE live in viz-kit.js — impairments.js needs the same two blocks. */
  const ctle = (h, boostDb) => K.ctle(h, boostDb, SPS, NFFT);
  const applyDFE = K.applyDFE;

  function eyeStats(y, levels, cursor, sps, nlev) {
    // worst separation between adjacent decision levels at the sampling instant
    const buckets = Array.from({ length: nlev }, () => []);
    for (let b = 20; b < levels.length - 2; b++) {
      const v = y[b * sps + cursor];
      if (v === undefined) continue;
      const li = Math.round((levels[b] + 1) / 2 * (nlev - 1));
      buckets[li].push(v);
    }
    let worst = Infinity;
    for (let i = 0; i < nlev - 1; i++) {
      if (!buckets[i].length || !buckets[i + 1].length) return 0;
      const hi = Math.max(...buckets[i]), lo = Math.min(...buckets[i + 1]);
      worst = Math.min(worst, lo - hi);
    }
    return isFinite(worst) ? Math.max(0, worst) : 0;
  }

  function drawEye(s, T, y, cursor, sps, nBits, colour, opening, label) {
    const P = K.plot(s, T, {
      pad: { l: 46, r: 14, t: 16, b: 28 },
      x: { min: -0.5, max: 0.5, ticks: [-0.5, -0.25, 0, 0.25, 0.5], fmt: (v) => v === 0 ? '0' : v.toFixed(2), title: 'UI' },
      y: { min: -1.25, max: 1.25, ticks: [-1, -0.5, 0, 0.5, 1], fmt: (v) => v.toFixed(1), title: '' }
    }).grid();
    const ctx = s.ctx;
    ctx.save();
    ctx.strokeStyle = K.rgba(colour, 0.14); ctx.lineWidth = 1; ctx.lineJoin = 'round';
    for (let b = 20; b < nBits - 2; b++) {
      ctx.beginPath();
      for (let k = -sps / 2; k <= sps / 2; k++) {
        const v = y[b * sps + cursor + k];
        if (v === undefined) continue;
        const x = P.X(k / sps), yy = P.Y(v);
        k === -sps / 2 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (label) K.text(ctx, label, P.box.L + 6, P.box.TP + 8, T.muted, 10, 'left');
    P.frame();
    return P;
  }

  /* ═══════════ equalisation ═══════════ */
  NS.viz.equalizer = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvA = $('[data-cv="raw"]'), cvB = $('[data-cv="eq"]');
    const NB = 500;
    const PRESETS = {
      typical: { loss: 20, boost: 8, dfe: 5, note: 'Closed at the pad, open after the receiver — the design point, not a rescue. Note it does not beat DFE alone here: the CTLE costs amplitude, and with 5 taps the DFE was already cancelling the ISI exactly. In real silicon the CTLE earns its place through noise and CDR behaviour this noiseless model does not show.' },
      noeq:    { loss: 20, boost: 0, dfe: 0, note: 'The same channel with equalization disabled, showing the waveform presented to the receiver front end.' },
      ctle:    { loss: 20, boost: 12, dfe: 0, note: 'CTLE alone. It flattens the channel but amplifies noise and crosstalk with it, and cannot cancel exactly.' },
      dfeonly: { loss: 20, boost: 0, dfe: 5, note: 'DFE alone. It cancels post-cursor exactly and adds no noise — but cannot touch pre-cursor, and the eye stays low.' },
      hard:    { loss: 30, boost: 12, dfe: 5, note: 'A 30 dB channel with everything on. Past a point equalisation stops buying anything and the channel has to change.' }
    };
    // State is derived from the preset that is shown as selected, so the panel
    // cannot start up computing one thing while its controls display another.
    const ERR_AT = 60;                       // symbol the injected decision error lands on
    const p = Object.assign({ mode: 'ideal', injectErr: false }, PRESETS.typical);
    delete p.note;

    const bits = lfsr(NB);
    let M = null;
    function build() {
      const h0 = K.channelImpulse(p.loss, SPS, NFFT);
      const hEq = ctle(h0, p.boost);
      const lv = Array.from(bits, (b) => b ? 1 : -1);
      const x = shape(lv, SPS, 0.25);
      const yRaw = conv(x, h0), yEq0 = conv(x, hEq);
      const sb = K.pulseResponse(hEq, SPS, 0.25);   // same edge as shape(...,0.25)
      const cur = sb.cursor;
      const yEq = applyDFE(yEq0, lv, sb.sbr, cur, p.dfe, SPS,
        { mode: p.mode, errorAt: (p.mode === 'decision' && p.injectErr) ? ERR_AT : -1 });
      let errs = 0;
      if (yEq.decided) {
        for (let b = 1; b < lv.length - 2; b++) if (yEq.decided[b] !== lv[b]) errs++;
      }
      const curRaw = K.singleBit(h0, SPS).cursor;
      return { yRaw, yEq, cur, curRaw, lv, errs,
               openRaw: eyeStats(yRaw, lv, curRaw, SPS, 2),
               openEq: eyeStats(yEq, lv, cur, SPS, 2) };
    }
    function draw(T) {
      drawEye(K.canvas(cvA, 220), T, M.yRaw, M.curRaw, SPS, NB, T.reflect, M.openRaw, 'at the pad');
      drawEye(K.canvas(cvB, 220), T, M.yEq, M.cur, SPS, NB, T.signal, M.openEq, 'after CTLE + DFE');
      $('[data-out="raw"]').textContent = M.openRaw <= 0 ? 'closed' : (M.openRaw * 400).toFixed(0) + ' mV';
      const e = $('[data-out="eq"]');
      e.textContent = M.openEq <= 0 ? 'closed' : (M.openEq * 400).toFixed(0) + ' mV';
      e.style.color = M.openEq <= 0 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="gain"]').textContent = M.openRaw > 0 && M.openEq > 0
        ? (M.openEq / M.openRaw).toFixed(1) + '×' : (M.openEq > 0 ? 'from closed' : '—');
      $('#eq-loss').value = p.loss; $('#eq-loss-out').value = p.loss + ' dB';
      $('#eq-boost').value = p.boost; $('#eq-boost-out').value = p.boost + ' dB';
      $('#eq-dfe').value = p.dfe; $('#eq-dfe-out').value = p.dfe + ' taps';
      $('#eq-mode').checked = p.mode === 'decision';
      $('#eq-err').checked = p.injectErr;
      $('#eq-err').disabled = p.mode !== 'decision' || p.dfe === 0;
      const de = $('[data-out="errs"]');
      de.textContent = p.dfe === 0 ? 'no DFE'
        : p.mode === 'ideal' ? 'ideal — none possible' : M.errs + ' symbol' + (M.errs === 1 ? '' : 's');
      de.style.color = M.errs > 0 ? 'var(--alarm-text)' : 'var(--ink)';
    }
    M = build();
    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    for (const [id, key] of [['#eq-loss', 'loss'], ['#eq-boost', 'boost'], ['#eq-dfe', 'dfe']]) {
      $(id).addEventListener('input', (e) => { p[key] = +e.target.value; M = build(); clear(); m.render(); });
    }
    $('#eq-mode').addEventListener('change', (e) => {
      p.mode = e.target.checked ? 'decision' : 'ideal';
      if (p.mode === 'ideal') p.injectErr = false;
      M = build(); clear(); m.render();
    });
    $('#eq-err').addEventListener('change', (e) => {
      p.injectErr = e.target.checked; M = build(); clear(); m.render();
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q); M = build();
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="typical"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.typical.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ═══════════ NRZ vs PAM4 ═══════════ */
  NS.viz.pam4 = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvN = $('[data-cv="nrz"]'), cvP = $('[data-cv="pam"]');
    const NB = 500;
    const p = { rate: 64, lossPerGHz: 1.1 };
    const PRESETS = {
      gen6:  { rate: 64, lossPerGHz: 1.1, note: 'PCIe Gen 6. NRZ would need 32 GHz; PAM4 carries it at 16 GHz — but each eye is a third the height.' },
      slow:  { rate: 32, lossPerGHz: 1.1, note: 'At 32 GT/s, the 8.8 dB of channel loss saved by PAM4 does not cover its 9.5 dB amplitude penalty, so this comparison favors NRZ.' },
      lossy: { rate: 64, lossPerGHz: 1.9, note: 'A lossier channel. NRZ collapses entirely while PAM4 survives — this is the case PAM4 exists for.' },
      clean: { rate: 64, lossPerGHz: 0.4, note: 'A short channel. NRZ wins easily, because the frequency relief buys less than the amplitude costs.' }
    };
    const EQ_BOOST = 10, EQ_DFE = 4;   // the same receiver on both sides —
                              // comparing unequalised links at these rates just
                              // compares two closed eyes and tells you nothing
    function build() {
      const bits = lfsr(NB * 2, 0x37b);
      const fnNRZ = p.rate / 2, fnPAM = p.rate / 4;
      const lossNRZ = p.lossPerGHz * fnNRZ, lossPAM = p.lossPerGHz * fnPAM;
      const hN = ctle(K.channelImpulse(lossNRZ, SPS, NFFT), EQ_BOOST);
      const hP = ctle(K.channelImpulse(lossPAM, SPS, NFFT), EQ_BOOST);
      const lvN = Array.from({ length: NB }, (_, i) => bits[i] ? 1 : -1);
      const lvP = Array.from({ length: NB }, (_, i) => [-1, -1 / 3, 1 / 3, 1][(bits[2 * i] << 1 | bits[2 * i + 1])]);
      const sbN = K.pulseResponse(hN, SPS, 0.25), sbP = K.pulseResponse(hP, SPS, 0.25);
      const cN = sbN.cursor, cP = sbP.cursor;
      const yN = applyDFE(conv(shape(lvN, SPS, 0.25), hN), lvN, sbN.sbr, cN, EQ_DFE, SPS);
      const yP = applyDFE(conv(shape(lvP, SPS, 0.25), hP), lvP, sbP.sbr, cP, EQ_DFE, SPS);
      return { yN, yP, cN, cP, lvN, lvP, lossNRZ, lossPAM,
               openN: eyeStats(yN, lvN, cN, SPS, 2),
               openP: eyeStats(yP, lvP, cP, SPS, 4) };
    }
    let M = build();
    function draw(T) {
      drawEye(K.canvas(cvN, 220), T, M.yN, M.cN, SPS, NB, T.reflect, M.openN,
              'NRZ · Nyquist ' + (p.rate / 2) + ' GHz · ' + M.lossNRZ.toFixed(0) + ' dB · same CTLE + DFE');
      drawEye(K.canvas(cvP, 220), T, M.yP, M.cP, SPS, NB, T.signal, M.openP,
              'PAM4 · Nyquist ' + (p.rate / 4) + ' GHz · ' + M.lossPAM.toFixed(0) + ' dB · same CTLE + DFE');
      $('[data-out="nrz"]').textContent = M.openN <= 0 ? 'closed' : (M.openN * 400).toFixed(0) + ' mV';
      $('[data-out="pam"]').textContent = M.openP <= 0 ? 'closed' : (M.openP * 400).toFixed(0) + ' mV';
      $('[data-out="penalty"]').textContent = '9.5 dB';
      $('[data-out="verdict"]').textContent =
        (M.openP <= 0 && M.openN <= 0) ? 'both closed'
          : M.openP > M.openN ? 'PAM4 wins here' : 'NRZ wins here';
      $('[data-out="verdict"]').style.color = M.openP > M.openN ? 'var(--signal)' : 'var(--reflect)';
      $('#p4-rate').value = p.rate; $('#p4-rate-out').value = p.rate + ' GT/s';
      $('#p4-loss').value = Math.round(p.lossPerGHz * 10); $('#p4-loss-out').value = p.lossPerGHz.toFixed(1) + ' dB/GHz';
    }
    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#p4-rate').addEventListener('input', (e) => { p.rate = +e.target.value; M = build(); clear(); m.render(); });
    $('#p4-loss').addEventListener('input', (e) => { p.lossPerGHz = +e.target.value / 10; M = build(); clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q); M = build();
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="gen6"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.gen6.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
