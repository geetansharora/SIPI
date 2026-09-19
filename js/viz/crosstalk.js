/* SI & PI — viz/crosstalk.js
 * Near-end and far-end crosstalk from the two coupling ratios.
 *
 * Exact for weak coupling. With an aggressor V(t) and a coupled section of
 * one-way delay Td:
 *     Kb   = ¼ ( Lm/L0 + Cm/C0 )          backward, near end
 *     Kfe  = ½ ( Cm/C0 − Lm/L0 )          forward, far end
 *     NEXT(t) = Kb · [ V(t) − V(t − 2Td) ]
 *     FEXT(t) = −Kfe · Td · dV/dt(t − Td)
 *
 * The controls are the ratios themselves rather than trace spacing, because
 * spacing → ratio needs a 2D field solve. Everything drawn is then exact, and
 * the reader can watch FEXT go to zero the moment the two ratios are equal —
 * which is why a homogeneous dielectric (stripline) has essentially none.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const VSW = 1.0;              // V aggressor swing
  const TPD = 6.811;            // ps/mm, stripline
  const T0 = 120;               // ps before the edge starts

  function edge(t, tr) {        // raised cosine, 0 → 1 over tr
    if (t <= 0) return 0;
    if (t >= tr) return 1;
    return 0.5 - 0.5 * Math.cos(Math.PI * t / tr);
  }
  function dEdge(t, tr) {       // its derivative, per ps
    if (t <= 0 || t >= tr) return 0;
    return (0.5 * Math.PI / tr) * Math.sin(Math.PI * t / tr);
  }

  /* Pure functions exposed for the headless model gate (check-models.js).
     Testing physics through the DOM is slow and proves less; these have no
     rendering dependency, so the gate can call them directly. */
  const M = (NS.models = NS.models || {});
  M.edge = edge;
  M.dEdge = dEdge;

  NS.viz.crosstalk = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="xtalk"]');

    const PRESETS = {
      stripline: { lm: 0.14, cm: 0.14, len: 25, tr: 100,
        note: 'Buried stripline: one dielectric, so the two ratios are equal and the far-end term cancels exactly. NEXT only.' },
      microstrip: { lm: 0.14, cm: 0.105, len: 25, tr: 100,
        note: 'Microstrip: air above, laminate below. The capacitive ratio no longer matches the inductive one, and FEXT appears.' },
      tight: { lm: 0.26, cm: 0.195, len: 25, tr: 100,
        note: 'The same microstrip with the neighbour much closer. Both terms roughly double.' },
      long: { lm: 0.14, cm: 0.105, len: 100, tr: 100,
        note: 'Four times the coupled length. NEXT is unchanged — it saturated long ago. FEXT is four times bigger.' },
      fastedge: { lm: 0.14, cm: 0.105, len: 25, tr: 35,
        note: 'A faster edge. NEXT does not care; FEXT scales with dV/dt and gets much worse.' }
    };

    /* Derived from the preset shown as selected. Declaring the same values a
       second time by hand works until one copy is edited and the other is not. */
    const p = Object.assign({}, PRESETS.microstrip); delete p.note;

    function model() {
      const Td = p.len * TPD;
      const Kb = 0.25 * (p.lm + p.cm);
      const Kfe = 0.5 * (p.cm - p.lm);
      const tMax = Math.max(4 * Td, 3 * p.tr) + 2 * T0;
      const satLen = p.tr / (2 * TPD);            // mm — NEXT stops growing past this
      return { Td, Kb, Kfe, tMax, satLen };
    }

    function draw(T) {
      const M = model();
      const s = K.canvas(cv, 300);
      const agg = (t) => VSW * edge(t - T0, p.tr);
      const next = (t) => M.Kb * (edge(t - T0, p.tr) - edge(t - T0 - 2 * M.Td, p.tr)) * VSW;
      const fext = (t) => -M.Kfe * M.Td * dEdge(t - T0 - M.Td, p.tr) * VSW;

      const N = 700;
      const sample = (f) => {
        const out = [];
        for (let i = 0; i <= N; i++) { const t = (i / N) * M.tMax; out.push([t, f(t)]); }
        return out;
      };
      const nx = sample(next), fx = sample(fext);

      /* Peaks measured off the plotted waveforms, before anything is drawn. The
         NEXT readout used to report Kb.V unconditionally — the SATURATED
         amplitude, which the pulse only reaches once the coupled section is long
         enough that the returning wave has not begun to fall. For a short section
         or a slow edge it never gets there, and the number beside the plot
         disagreed with the plot by a factor of six. */
      let fpk = 0, fat = 0;
      for (const [t, v] of fx) if (Math.abs(v) > Math.abs(fpk)) { fpk = v; fat = t; }
      let npk = 0;
      for (const [, v] of nx) if (Math.abs(v) > Math.abs(npk)) npk = v;
      const nsat = M.Kb * VSW;
      const saturated = Math.abs(npk) >= 0.995 * Math.abs(nsat);
      let lo = 0, hi = VSW * 1.05;
      for (const arr of [nx, fx]) for (const [, v] of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
      lo = Math.min(lo * 1.25, -0.06); hi = Math.max(hi * 1.1, VSW * 1.05);

      const P = K.plot(s, T, {
        pad: { l: 56, r: 96, t: 18, b: 32 },
        x: { min: 0, max: M.tMax, count: 5, fmt: (v) => (v / 1000).toFixed(1), title: 'ns' },
        y: { min: lo, max: hi, count: 6, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();

      P.trace(sample(agg), T.muted, { width: 1.4, dash: [4, 3] });
      P.trace(nx, T.reflect, { width: 2 });
      P.trace(fx, T.signal, { width: 2, glow: true });

      const ctx = s.ctx, B = P.box;
      if (!P.narrow) K.text(ctx, 'aggressor', B.R + 6, P.Y(VSW), T.muted, 10, 'left');
      if (!P.narrow) K.text(ctx, 'NEXT', B.R + 6, P.Y(npk), T.reflect, 10, 'left');
      if (!P.narrow) K.text(ctx, 'near end', B.R + 6, P.Y(npk) + 12, T.muted, 9, 'left');
      if (!saturated) {
        K.line(ctx, B.L, P.Y(nsat), B.R, P.Y(nsat), T.reflect, 1, [2, 4]);
        K.text(ctx, 'saturated value it never reaches', B.L + 8, P.Y(nsat) - 8, T.muted, 9, 'left');
      }

      if (Math.abs(fpk) > 1e-4) {
        if (!P.narrow) K.text(ctx, 'FEXT', B.R + 6, P.Y(fpk), T.signal, 10, 'left');
        if (!P.narrow) K.text(ctx, 'far end', B.R + 6, P.Y(fpk) + 12, T.muted, 9, 'left');
        K.line(ctx, P.X(fat), P.Y(fpk), B.R, P.Y(fpk), T.signal, 1, [2, 3]);
      } else {
        if (!P.narrow) K.text(ctx, 'FEXT = 0', B.R + 6, P.Y(0) - 12, T.signal, 10, 'left');
        if (!P.narrow) K.text(ctx, 'ratios match', B.R + 6, P.Y(0), T.muted, 9, 'left');
      }

      // the NEXT plateau lasts exactly 2Td
      const yN = P.Y(npk);
      K.line(ctx, P.X(T0 + p.tr), yN - 14, P.X(T0 + 2 * M.Td), yN - 14, T.reflect, 1);
      K.text(ctx, '2T_d = ' + K.fmt.ps(2 * M.Td),
             (P.X(T0 + p.tr) + P.X(T0 + 2 * M.Td)) / 2, yN - 22, T.reflect, 9, 'center');
      P.frame();

      // readouts
      $('[data-out="kb"]').textContent = M.Kb.toFixed(3);
      $('[data-out="kfe"]').textContent = M.Kfe.toFixed(4);
      $('[data-out="next"]').textContent = (npk * 1000).toFixed(npk < 0.1 ? 1 : 0) + ' mV';
      const ns = $('[data-out="nsat"]');
      if (ns) {
        ns.textContent = saturated ? 'reached' : (nsat * 1000).toFixed(0) + ' mV, not reached';
        ns.style.color = saturated ? 'var(--ink)' : 'var(--muted)';
      }
      /* State the scope rather than run a test the controls cannot fail. The
         sliders stop at 0.30 precisely so the weak-coupling assumption holds
         throughout; past roughly that, the single-pair superposition here stops
         being adequate and a coupled-line model is needed. */
      const wk = $('[data-out="weak"]');
      if (wk) wk.textContent = 'weak coupling, ratios ≤ 0.30 (now ' +
        Math.max(p.lm, p.cm).toFixed(2) + ')';
      const fo = $('[data-out="fext"]');
      fo.textContent = Math.abs(fpk) < 1e-4 ? '0 mV' : (fpk * 1000).toFixed(0) + ' mV';
      fo.style.color = Math.abs(fpk) > 0.05 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="sat"]').textContent = M.satLen.toFixed(1) + ' mm';

      $('#xt-lm').value = Math.round(p.lm * 1000); $('#xt-lm-out').value = p.lm.toFixed(3);
      $('#xt-cm').value = Math.round(p.cm * 1000); $('#xt-cm-out').value = p.cm.toFixed(3);
      $('#xt-len').value = p.len; $('#xt-len-out').value = p.len + ' mm';
      $('#xt-tr').value = p.tr; $('#xt-tr-out').value = p.tr + ' ps';
    }

    const m = K.mount({ root, params: p, draw });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const bind = (id, key, scale) => $(id).addEventListener('input', (e) => {
      p[key] = +e.target.value * (scale || 1); clearPreset(); m.render();
    });
    bind('#xt-lm', 'lm', 0.001); bind('#xt-cm', 'cm', 0.001);
    bind('#xt-len', 'len'); bind('#xt-tr', 'tr');

    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = PRESETS[b.dataset.preset];
        if (!c) return;   // a .preset with no data-preset is not one
        Object.assign(p, { lm: c.lm, cm: c.cm, len: c.len, tr: c.tr });
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = c.note;
        m.render();
      });
    });

    root.querySelector('.preset[data-preset="microstrip"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.microstrip.note;
    m.render();

    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
