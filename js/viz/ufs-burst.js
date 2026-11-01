/* SI & PI — viz/ufs-burst.js
 * A short link with a power problem. A run of UFS transfers with an idle gap
 * between them; the lane waits in STALL or sleeps in HIBERN8 after a threshold.
 * The panel draws one cycle's states, the energy each transfer costs against
 * the idle gap under both policies with the break-even marked, and the rail at
 * the moment a burst starts.
 *
 * All the arithmetic is in js/models/ufs-burst-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/ufs-burst-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const SIZES = [4, 16, 64, 256, 1024];            // KB
  const THETAS = [Infinity, 10, 100, 1000, 10000];  // µs
  const PRESETS = {
    stream: { gear: 5, si: 4, lg: 1, ti: 3, wake: 500, weak: 0,
      note: 'Streaming reads: 1 MB bursts 10 µs apart. The lane never idles long enough to sleep, and the PHY sits near burst power.' },
    small: { gear: 5, si: 0, lg: 3.3, ti: 2, wake: 500, weak: 0,
      note: 'Small writes 2 ms apart. HIBERN8 after 100 µs cuts each transfer’s energy to about a third, at the price of a 500 µs wake before every one.' },
    eager: { gear: 5, si: 0, lg: 2.5, ti: 1, wake: 1000, weak: 0,
      note: 'HIBERN8 after 10 µs, with a 1 ms wake, on gaps of 300 µs: shorter than break-even. It costs three times the energy and adds a millisecond.' },
    weak: { gear: 5, si: 4, lg: 1, ti: 3, wake: 500, weak: 1,
      note: 'The streaming case on a rail with a quarter of the decoupling and four times the package inductance. The same step now droops several times as far.' }
  };

  const us = (t) => (t >= 1000 ? (t / 1000).toFixed(t >= 10000 ? 0 : 1) + ' ms' : t >= 10 ? Math.round(t) + ' µs' : t.toFixed(t >= 1 ? 1 : 2) + ' µs');
  const uj = (nj) => (nj >= 1000 ? (nj / 1000).toFixed(nj >= 10000 ? 0 : 1) + ' µJ' : Math.round(nj) + ' nJ');

  /* Ticks on a round step: 1, 2, 2.5 or 5 times a power of ten, at most five. */
  function ticks(lo, hi) {
    const span = hi - lo, e = Math.pow(10, Math.floor(Math.log10(span / 5)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * e).find((q) => span / q <= 5);
    const out = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  const decade = (v) => ({ '-2': '0.01', '-1': '0.1', 0: '1', 1: '10', 2: '100', 3: '1k', 4: '10k', 5: '100k' })[v] || '1e' + v;

  NS.viz.ufsBurst = function (root) {
    const U = NS.models.ufsBurst;
    const $ = (s) => root.querySelector(s);
    const axes = K.axisMemo(root);
    const p = Object.assign({}, PRESETS.small);
    delete p.note;
    const cfgOf = () => ({ gear: p.gear, kb: SIZES[p.si], gap: Math.pow(10, p.lg), theta: THETAS[p.ti], wake: p.wake, weak: !!p.weak });

    function draw(T) {
      const cfg = cfgOf(), A = U.analyse(cfg), C = A.C;
      const colour = { burst: T.signal, stall: T.reflect, hibern8: T.muted, wake: T.alarm };

      /* One cycle, to scale: each state's power as a block, with the times named. */
      {
        const s = K.canvas($('[data-cv="line"]'), 96), ctx = s.ctx;
        ctx.clearRect(0, 0, s.w, s.h);
        const L = 8, R = s.w - 8, top = 22, H = s.h - top - 8;
        // a sliver of width for a state too short to see, so the burst is never lost
        const w = C.segs.map((g) => Math.max(3, (g.t / C.T) * (R - L - 3 * C.segs.length)));
        const scale = (R - L) / w.reduce((a, b) => a + b, 0);
        let x = L;
        C.segs.forEach((g, i) => {
          const ww = w[i] * scale, hh = Math.max(2, H * g.p / U.P.burst);
          ctx.fillStyle = K.rgba(colour[g.state], g.state === 'hibern8' ? 0.6 : 0.85);
          ctx.fillRect(x, top + H - hh, ww, hh);
          x += ww;
        });
        const txt = C.segs.map((g) => ({ burst: 'burst', stall: 'STALL', hibern8: 'HIBERN8', wake: 'wake' })[g.state] + ' ' + us(g.t)).join(' · ');
        K.text(ctx, txt, L, 10, T.ink, 11, 'left');
      }

      /* Energy per transfer against the idle gap, both policies. */
      {
        const s = K.canvas($('[data-cv="energy"]'), 132);
        const N = 120, lg = (k) => 5 * k / (N - 1);
        const at = (theta, k) => U.cycle(Object.assign({}, cfg, { gap: Math.pow(10, lg(k)), theta })).E / 1000;
        const th = isFinite(cfg.theta) ? cfg.theta : 0;
        const hi = Math.max(at(Infinity, N - 1), at(th, N - 1));
        const low = Math.min(at(Infinity, 0), at(th, 0));
        const yr = K.stickyAxis(axes, 'e', Math.log10(low), Math.log10(hi), { zero: false, minSpan: 1 });
        const lo = Math.floor(yr.min), top = Math.ceil(yr.max), yt = [];
        // every decade while they fit, every other once there are more than four
        const every = top - lo > 4 ? 2 : 1;
        for (let v = lo; v <= top; v++) if ((v - lo) % every === 0) yt.push(v);
        const P = K.plot(s, T, {
          pad: { l: 46, r: 12, t: 14, b: 30 },
          x: { min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], fmt: (v) => ['1µ', '10µ', '100µ', '1m', '10m', '100m'][v], title: 'idle gap, s' },
          y: { min: lo, max: top, ticks: yt, fmt: decade, title: 'µJ' }
        }).grid();
        P.trace((k) => [lg(k), Math.log10(at(Infinity, k))], T.reflect, { n: N, width: 2, id: 'ufs-stall', label: 'STALL only', unit: 'log10 µJ' });
        P.trace((k) => [lg(k), Math.log10(at(th, k))], T.signal, { n: N, width: 2, id: 'ufs-h8', label: 'HIBERN8 after ' + (isFinite(cfg.theta) ? us(cfg.theta) : 'the gap starts'), unit: 'log10 µJ' });
        P.vline(Math.log10(A.be), T.muted, [3, 4]);
        K.text(P.ctx, 'break-even', P.X(Math.log10(A.be)) + 4, P.box.TP + 8, T.muted, 10, 'left');
        K.dot(P.ctx, P.X(p.lg), P.Y(Math.log10(C.E / 1000)), C.sleeps ? T.signal : T.reflect, T.surface, 3.5);
        P.frame();
      }

      /* The rail when a burst starts. */
      {
        const s = K.canvas($('[data-cv="rail"]'), 132), R = A.R;
        const shown = Math.round(8e-6 / R.dt), v8 = R.v.subarray(0, shown);   // the first 8 µs of the record
        const m = Math.max(...Array.from(v8, Math.abs)) * 1000;
        const yr = K.stickyAxis(axes, 'v', -m, m, { head: 0.12 });
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: 0, max: 8, ticks: [0, 2, 4, 6, 8], fmt: (v) => String(v), title: 'µs' },
          y: { min: yr.min, max: yr.max, ticks: ticks(yr.min, yr.max), fmt: (v) => String(+v.toPrecision(4)), title: 'mV' }
        }).grid();
        const n = shown, step = 4;
        P.trace((k) => [k * step * R.dt * 1e6, R.v[k * step] * 1000], T.signal, { n: n / step, width: 1.8, id: 'ufs-rail', label: 'rail', unit: 'mV' });
        P.frame();
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('burst', us(C.tb));
      set('energy', uj(C.E));
      set('avg', C.avg.toFixed(C.avg < 10 ? 1 : 0) + ' mW');
      set('be', us(A.be));
      set('lat', C.latency ? us(C.latency) : 'none');
      set('droop', (Math.abs(A.droop) * 1000).toFixed(1) + ' mV');

      $('#ufs-gear').value = String(p.gear);
      $('#ufs-size').value = p.si; $('#ufs-size-out').value = SIZES[p.si] >= 1024 ? SIZES[p.si] / 1024 + ' MB' : SIZES[p.si] + ' KB';
      $('#ufs-gap').value = p.lg; $('#ufs-gap-out').value = us(cfg.gap);
      $('#ufs-theta').value = String(p.ti);
      $('#ufs-wake').value = p.wake; $('#ufs-wake-out').value = p.wake + ' µs';
      $('#ufs-rail').value = String(p.weak);
    }

    const mnt = K.mount({ root, params: p, draw });
    const note = $('[data-out="note"]');
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = 'Custom';
    };
    [['#ufs-gear', 'gear'], ['#ufs-size', 'si'], ['#ufs-gap', 'lg'], ['#ufs-theta', 'ti'], ['#ufs-wake', 'wake'], ['#ufs-rail', 'weak']].forEach(([id, k]) => {
      const el = $(id);
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (ev) => { p[k] = +ev.target.value; clear(); mnt.render(); });
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="small"]').setAttribute('aria-pressed', 'true');
    note.textContent = PRESETS.small.note;
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.ufsBurst.PRESETS = PRESETS;
  NS.viz.ufsBurst.GRID = { SIZES, THETAS };
})();
