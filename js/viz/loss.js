/* SI & PI — viz/loss.js
 * The three loss terms, and where they cross.
 *
 * Exact, from the formulas this section derives:
 *   dielectric   α_d [dB/in] = 2.3 · f[GHz] · Df · √Dk           (linear in f)
 *   skin depth   δ [µm]      = 2.06 / √f[GHz]                     (copper)
 *   conductor    α_c [dB/in] = k_c · √f[GHz] · K_rough            (√f)
 *   roughness    K_rough     = 1 + (2/π)·atan(1.4·(Rz/δ)²)        Hammerstad–Jensen
 *
 * k_c stands in for trace geometry and is exposed as a control rather than
 * derived, because deriving it needs a 2D field solve.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const F_LO = 0.1, F_HI = 40;                       // GHz

  function terms(p, f) {
    const delta = 2.06 / Math.sqrt(f);               // µm
    const kr = 1 + (2 / Math.PI) * Math.atan(1.4 * Math.pow(p.rz / delta, 2));
    const ac = p.kc * Math.sqrt(f);
    const ad = 2.3 * f * p.df * Math.sqrt(p.dk);
    return { ac, acr: ac * kr, ad, kr, delta, total: ac * kr + ad };
  }
  function crossover(p) {                            // where α_c·K = α_d
    let lo = F_LO, hi = F_HI;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2, t = terms(p, m);
      (t.acr > t.ad) ? (lo = m) : (hi = m);
    }
    return (lo + hi) / 2;
  }

  NS.viz.loss = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="loss"]');
    // k_c is calibrated so that k_c·√f·K_rough lands on a realistic measured
    // conductor loss (~0.5 dB/in at 10 GHz). Published figures already include
    // roughness, so calibrating against them and then applying Hammerstad on top
    // double-counts it — which shows up as a total ~60% above any real channel.
    const p = { df: 0.008, dk: 3.8, kc: 0.08, rz: 3.0, len: 10, fn: 8 };

    const PRESETS = {
      mid:    { df: 0.008, dk: 3.8, kc: 0.08, rz: 3.0, note: 'Mid-loss laminate, standard foil. The crossover sits low, so material choice dominates almost the whole band.' },
      low:    { df: 0.003, dk: 3.4, kc: 0.08, rz: 1.0, note: 'Low-loss build with HVLP foil. Dielectric loss more than halves and roughness nearly stops mattering.' },
      rough:  { df: 0.008, dk: 3.8, kc: 0.08, rz: 6.0, note: 'The same laminate with rough foil. Conductor loss climbs towards twice the smooth-copper prediction.' },
      wide:   { df: 0.008, dk: 3.8, kc: 0.05, rz: 3.0, note: 'A wider trace: less conductor loss, so the crossover drops — widening a trace is a real fix, but only below the crossover.' },
      fr4:    { df: 0.020, dk: 4.3, kc: 0.08, rz: 5.0, note: 'Standard FR-4. Df is 2.5× higher, so the crossover falls to about 3 GHz and the dielectric owns almost the whole band.' }
    };

    function draw(T) {
      const s = K.canvas(cv, 280);
      const P = K.plot(s, T, {
        pad: { l: 58, r: 92, t: 18, b: 32 },
        x: { min: F_LO, max: F_HI, log: true, fmt: (v) => v < 1 ? v.toFixed(1) : v.toFixed(0), title: 'GHz' },
        y: { min: 0, max: Math.max(1.2, terms(p, F_HI).total * 1.1), count: 6,
             fmt: (v) => v.toFixed(1), title: 'dB/in' }
      }).grid();

      const N = 260;
      const curve = (pick) => {
        const out = [];
        for (let i = 0; i <= N; i++) {
          const f = F_LO * Math.pow(F_HI / F_LO, i / N);
          out.push([f, pick(terms(p, f))]);
        }
        return out;
      };
      P.trace(curve((t) => t.ac), T.muted, { width: 1.2, dash: [3, 3] });
      P.trace(curve((t) => t.acr), T.reflect, { width: 1.8 });
      P.trace(curve((t) => t.ad), T.signal, { width: 1.8 });
      P.trace(curve((t) => t.total), T.ink, { width: 2.4, glow: true });

      const ctx = s.ctx, B = P.box;
      const at = (f) => terms(p, f);
      if (!P.narrow) K.text(ctx, 'total', B.R + 6, P.Y(at(F_HI).total), T.ink, 10, 'left');
      if (!P.narrow) K.text(ctx, 'conductor', B.R + 6, P.Y(at(F_HI).acr), T.reflect, 10, 'left');
      if (!P.narrow) K.text(ctx, '× roughness', B.R + 6, P.Y(at(F_HI).acr) + 12, T.muted, 9, 'left');
      if (!P.narrow) K.text(ctx, 'dielectric', B.R + 6, P.Y(at(F_HI).ad), T.signal, 10, 'left');

      const fx = crossover(p);
      if (fx > F_LO * 1.02 && fx < F_HI * 0.985) {
        P.vline(fx, T.muted, [3, 3]);
        K.text(ctx, 'crossover ' + fx.toFixed(1) + ' GHz', P.X(fx) + 5, B.TP + 10, T.muted, 10, 'left');
      }
      P.vline(p.fn, T.ink2, [2, 4]);
      K.text(ctx, 'Nyquist', P.X(p.fn) + 5, B.B - 10, T.ink2, 10, 'left');
      P.frame();

      const tn = at(p.fn);
      $('[data-out="perin"]').textContent = tn.total.toFixed(2) + ' dB/in';
      $('[data-out="total"]').textContent = (tn.total * p.len).toFixed(1) + ' dB';
      $('[data-out="cross"]').textContent =
        fx > F_HI * 0.98 ? 'above ' + F_HI + ' GHz' : fx.toFixed(1) + ' GHz';
      $('[data-out="krough"]').textContent = tn.kr.toFixed(2) + '×';
      $('[data-out="delta"]').textContent = tn.delta.toFixed(2) + ' µm';
      $('#ls-df').value = Math.round(p.df * 1000); $('#ls-df-out').value = p.df.toFixed(3);
      $('#ls-rz').value = Math.round(p.rz * 10); $('#ls-rz-out').value = p.rz.toFixed(1) + ' µm';
      $('#ls-kc').value = Math.round(p.kc * 100); $('#ls-kc-out').value = p.kc.toFixed(2);
      $('#ls-len').value = p.len; $('#ls-len-out').value = p.len + ' in';
      $('#ls-fn').value = p.fn; $('#ls-fn-out').value = p.fn + ' GHz';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    const bind = (id, key, sc) => $(id).addEventListener('input', (e) => {
      p[key] = +e.target.value * (sc || 1); clear(); m.render();
    });
    bind('#ls-df', 'df', 0.001); bind('#ls-rz', 'rz', 0.1);
    bind('#ls-kc', 'kc', 0.01); bind('#ls-len', 'len'); bind('#ls-fn', 'fn');
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
    root.querySelector('.preset[data-preset="mid"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.mid.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
