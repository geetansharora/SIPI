/* SI & PI — viz/sparams.js
 * SDD21 for a real channel, and what a via stub does to it.
 *
 * Exact. The smooth channel is the same loss law as the Loss page. The stub is
 * an ideal open-circuit shunt stub on a matched line, for which
 *     Y_stub = j·Y₀·tan(θ),   θ = 2π f L / v,   v = c/√Dk
 *     |S21| = 2 / |2 + Z₀·Y_stub| = 2 / √(4 + tan²θ)
 * which goes to zero at θ = π/2 — the quarter-wave resonance. Nothing here is
 * fitted; the notch frequency falls out of the stub length and Dk alone.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const F_LO = 0.1, F_HI = 40;                      // GHz
  const C_IN_NS = 11.803;                           // inches per ns, vacuum

  function chanDb(p, f) {                           // dB, positive = loss
    const delta = 2.06 / Math.sqrt(f);
    const kr = 1 + (2 / Math.PI) * Math.atan(1.4 * Math.pow(3.0 / delta, 2));
    return (0.16 * Math.sqrt(f) * kr + 2.3 * f * p.df * Math.sqrt(p.dk)) * p.len;
  }
  function stubDb(p, f) {                           // dB, positive = loss
    if (p.stub <= 0) return 0;
    const v = C_IN_NS / Math.sqrt(p.dk);            // in/ns
    const L = p.stub / 1000;                        // mil → inch
    const theta = 2 * Math.PI * f * L / v;          // f in GHz, L/v in ns
    const t = Math.tan(theta);
    if (!isFinite(t)) return 80;
    return Math.min(80, -20 * Math.log10(2 / Math.sqrt(4 + t * t)));
  }
  function notchGHz(p) {
    if (p.stub <= 0) return null;
    return 2950 / (p.stub * Math.sqrt(p.dk));       // the λ/4 rule, in GHz
  }

  NS.viz.sparams = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="s21"]');

    const PRESETS = {
      clean:  { len: 10, df: 0.008, dk: 4.0, stub: 0, fn: 8,
        note: 'A smooth channel: loss rises steadily and an equaliser can undo most of it.' },
      thin:   { len: 10, df: 0.008, dk: 4.0, stub: 60, fn: 8,
        note: 'A thin board leaves a 60 mil stub. It resonates near 25 GHz — above the band, so it costs nothing here.' },
      backpl: { len: 20, df: 0.008, dk: 4.0, stub: 200, fn: 8,
        note: 'A thick backplane, 200 mil of stub. The notch lands at 7.4 GHz, right inside a 16 GT/s link. No equaliser recovers this.' },
      drilled:{ len: 20, df: 0.008, dk: 4.0, stub: 10, fn: 8,
        note: 'The same backplane, backdrilled to a 10 mil residue. The resonance jumps to 148 GHz and the channel is smooth again.' },
      lowloss:{ len: 20, df: 0.003, dk: 3.4, stub: 10, fn: 16,
        note: 'Low-loss laminate at Gen 5 Nyquist. This is what a 32 GT/s channel has to look like.' }
    };

    /* Derived from the preset shown as selected. Declaring the same values a
       second time by hand works until one copy is edited and the other is not. */
    const p = Object.assign({}, PRESETS.backpl); delete p.note;

    function draw(T) {
      const s = K.canvas(cv, 290);
      const N = 700;
      const pts = [], smooth = [];
      let worst = 0;
      for (let i = 0; i <= N; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / N);
        const c = chanDb(p, f), tot = c + stubDb(p, f);
        pts.push([f, -tot]); smooth.push([f, -c]);
        if (tot > worst) worst = tot;
      }
      const floor = Math.min(-60, -Math.min(worst, 70) * 1.05);
      const P = K.plot(s, T, {
        pad: { l: 58, r: 76, t: 18, b: 32 },
        x: { min: F_LO, max: F_HI, log: true, fmt: (v) => v < 1 ? v.toFixed(1) : v.toFixed(0), title: 'GHz' },
        y: { min: floor, max: 2, count: 6, fmt: (v) => v.toFixed(0), title: 'dB' }
      }).grid();

      P.trace(smooth, T.muted, { width: 1.2, dash: [4, 3] });
      P.trace(pts, T.signal, { width: 2.2, glow: true });

      const ctx = s.ctx, B = P.box;
      if (!P.narrow) K.text(ctx, 'SDD21', B.R + 6, P.Y(-chanDb(p, F_HI)), T.signal, 10, 'left');
      if (!P.narrow) K.text(ctx, 'no stub', B.R + 6, P.Y(-chanDb(p, F_HI)) + 12, T.muted, 9, 'left');

      const nf = notchGHz(p);
      if (nf && nf > F_LO && nf < F_HI) {
        P.vline(nf, T.alarm, [3, 3]);
        K.text(ctx, 'λ/4 notch ' + nf.toFixed(1) + ' GHz', P.X(nf) + 5, B.TP + 10, T.alarm, 10, 'left');
      }
      P.vline(p.fn, T.ink2, [2, 4]);
      K.text(ctx, 'Nyquist', P.X(p.fn) + 5, B.B - 10, T.ink2, 10, 'left');
      P.frame();

      const il = chanDb(p, p.fn) + stubDb(p, p.fn);
      $('[data-out="il"]').textContent = '−' + il.toFixed(1) + ' dB';
      $('[data-out="ilsm"]').textContent = '−' + chanDb(p, p.fn).toFixed(1) + ' dB';
      $('[data-out="notch"]').textContent = nf ? nf.toFixed(1) + ' GHz' : 'none';
      const e = $('[data-out="il"]');
      e.style.color = il > 30 ? 'var(--alarm-text)' : 'var(--ink)';
      $('#sp2-len').value = p.len; $('#sp2-len-out').value = p.len + ' in';
      $('#sp2-df').value = Math.round(p.df * 1000); $('#sp2-df-out').value = p.df.toFixed(3);
      $('#sp2-stub').value = p.stub; $('#sp2-stub-out').value = p.stub + ' mil';
      $('#sp2-fn').value = p.fn; $('#sp2-fn-out').value = p.fn + ' GHz';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    const bind = (id, key, sc) => $(id).addEventListener('input', (e) => {
      p[key] = +e.target.value * (sc || 1); clear(); m.render();
    });
    bind('#sp2-len', 'len'); bind('#sp2-df', 'df', 0.001);
    bind('#sp2-stub', 'stub'); bind('#sp2-fn', 'fn');
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="backpl"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.backpl.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
