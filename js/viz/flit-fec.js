/* SI & PI — viz/flit-fec.js
 * Raw errors in, replays out. One PCIe 6.0 flit drawn byte by byte and coloured
 * by which of the three interleaved FEC codes owns each byte, with one draw's bad
 * bytes marked; then the chance a flit has to be replayed against the raw error
 * rate, for scattered errors and for errors that come in bursts.
 *
 * All the arithmetic is in js/models/flit-fec-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/flit-fec-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const WIDTHS = [1, 4, 16];
  const PRESETS = {
    design: { lf: -6, q: 0, wi: 2, map: 0,
      note: 'The design point: a first-bit error rate of 1e-6, every error alone. Two of them must land in one code before a flit replays.' },
    bursty: { lf: -6, q: 0.5, wi: 2, map: 0,
      note: 'The same rate, but each error drags the next byte down half the time, as DFE error propagation does. Replays rise several hundredfold.' },
    burst3: { lf: -6, q: 0.5, wi: 2, map: 3,
      note: 'A 3-byte burst lands one byte in each code, wherever it starts. Each code fixes its one byte and nothing is resent.' },
    burst4: { lf: -6, q: 0.5, wi: 2, map: 4,
      note: 'Four bytes in a row put two in one code, wherever they start. That code cannot fix them, the CRC sees it and the flit is replayed.' },
    bad: { lf: -4, q: 0.3, wi: 2, map: 0,
      note: 'A channel a hundred times worse than the target, with some bursts. About one flit in sixty is resent: replay is now routine, not rare.' }
  };

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  // a share that is not quite all of them must not round up to 100%: keep adding
  // decimals until it shows the shortfall
  const pctBelowOne = (x) => {
    if (x >= 1) return '100%';
    for (let d = 1; d <= 4; d++) { const s = (x * 100).toFixed(d); if (+s < 100) return s + '%'; }
    return '> 99.9999%';
  };
  const sci = (x) => {
    if (!(x > 0)) return '0';
    if (x >= 0.01) return (x * 100).toFixed(x >= 0.1 ? 0 : 1) + '%';
    const e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    return m.toFixed(1) + '×10' + String(e).split('').map((c) => SUP[c]).join('');
  };
  const dur = (ns) => {
    if (!isFinite(ns)) return 'never';
    const u = [[1, 'ns'], [1e3, 'µs'], [1e6, 'ms'], [1e9, 's'], [60e9, 'min'], [3600e9, 'h'], [86400e9, 'days'], [31557600e9, 'years']];
    let k = 0; while (k < u.length - 1 && ns >= u[k + 1][0]) k++;
    const v = ns / u[k][0];
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + u[k][1];
  };

  NS.viz.flitFec = function (root) {
    const F = NS.models.flitFec;
    const $ = (s) => root.querySelector(s);
    const p = Object.assign({}, PRESETS.design);
    delete p.note;
    let seed = 1;
    const cfgOf = () => ({ fber: Math.pow(10, p.lf), q: p.q, width: WIDTHS[p.wi] });

    function draw(T) {
      const cfg = cfgOf(), A = F.analyse(cfg);
      const D = F.drawFlit(cfg.fber, cfg.q, p.map, seed * 7919 + p.map * 131 + Math.round(p.q * 100));

      /* The flit: 256 bytes, 32 to a row, each tinted by the code that owns it. */
      {
        const s = K.canvas($('[data-cv="flit"]'), 132), ctx = s.ctx;
        ctx.clearRect(0, 0, s.w, s.h);
        const cols = 32, rows = F.FLIT / cols, padL = 8, padT = 22, gap = 2;
        const cw = (s.w - 2 * padL - (cols - 1) * gap) / cols, ch = Math.min(cw, (s.h - padT - 8 - (rows - 1) * gap) / rows);
        const tone = [K.rgba(T.signal, 0.32), K.rgba(T.reflect, 0.32), K.rgba(T.muted, 0.28)];
        for (let i = 0; i < F.FLIT; i++) {
          const x = padL + (i % cols) * (cw + gap), y = padT + Math.floor(i / cols) * (ch + gap);
          ctx.fillStyle = tone[F.group(i)];
          ctx.fillRect(x, y, cw, ch);
          if (D.bad.has(i)) {
            const lost = D.perGroup[F.group(i)] > 1;
            ctx.fillStyle = lost ? T.alarm : T.ink;
            ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
          }
        }
        // the long headline, or on a narrow canvas the short one, so it never runs off the edge
        const bad = D.bad.size + ' bad byte' + (D.bad.size === 1 ? '' : 's') + ' · ';
        const worst = D.perGroup.findIndex((n) => n > 1), most = Math.max(...D.perGroup);
        const long = bad + (D.ok ? 'corrected in place: no code has more than one bad byte'
          : 'replayed: code ' + worst + ' has ' + most + ' bad bytes');
        const short = bad + (D.ok ? 'corrected: ≤ 1 a code' : 'replayed: code ' + worst + ' has ' + most);
        ctx.save(); ctx.font = '11px ' + K.MONO;
        const head = ctx.measureText(long).width <= s.w - 2 * padL ? long : short;
        ctx.restore();
        K.text(ctx, head, padL, 10, D.ok ? T.ink : T.alarm, 11, 'left');
      }

      /* Replay probability against the raw error rate. */
      {
        const s = K.canvas($('[data-cv="curve"]'), 150);
        const P = K.plot(s, T, {
          pad: { l: 50, r: 14, t: 14, b: 30 },
          x: { min: -8, max: -3, ticks: [-8, -7, -6, -5, -4, -3], fmt: (v) => '1e' + v, title: 'first-bit error rate' },
          y: { min: -14, max: 0, ticks: [-14, -12, -10, -8, -6, -4, -2, 0], fmt: (v) => (v === 0 ? '1' : '1e' + v), title: 'per flit' }
        }).grid();
        const N = 101, lx = (k) => -8 + 5 * k / (N - 1), L = (x) => Math.max(-14, Math.log10(Math.max(x, 1e-300)));
        P.trace((k) => [lx(k), L(F.hitRate(Math.pow(10, lx(k))))], T.muted, { n: N, width: 1.2, dash: [4, 3], id: 'ff-hit', label: 'flits with any bad byte', unit: 'log10' });
        P.trace((k) => [lx(k), L(F.replayIndependent(Math.pow(10, lx(k))))], T.signal, { n: N, width: 2, id: 'ff-ind', label: 'replayed, errors alone', unit: 'log10' });
        if (cfg.q > 0) P.trace((k) => [lx(k), L(F.replayBursty(Math.pow(10, lx(k)), cfg.q))], T.reflect, { n: N, width: 2, id: 'ff-burst', label: 'replayed, in bursts', unit: 'log10' });
        P.vline(p.lf, T.muted, [2, 3]);
        K.dot(P.ctx, P.X(p.lf), P.Y(L(A.pRep)), cfg.q > 0 ? T.reflect : T.signal, T.surface, 3.5);
        P.frame();
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('hit', sci(A.pHit));
      set('fixed', pctBelowOne(A.corrected));
      set('rep', sci(A.pRep));
      set('every', dur(A.every));
      set('flit', D.bad.size + ' bad, ' + (D.ok ? 'fixed' : 'resent'));

      $('#ff-fber').value = p.lf; $('#ff-fber-out').value = sci(cfg.fber);
      $('#ff-q').value = p.q; $('#ff-q-out').value = Math.round(p.q * 100) + '%';
      $('#ff-width').value = String(p.wi);
      $('#ff-map').value = String(p.map);
    }

    const mnt = K.mount({ root, params: p, draw });
    const note = $('[data-out="note"]');
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = 'Custom';
    };
    [['#ff-fber', 'lf'], ['#ff-q', 'q'], ['#ff-width', 'wi'], ['#ff-map', 'map']].forEach(([id, k]) => {
      const el = $(id);
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (e) => { p[k] = +e.target.value; clear(); mnt.render(); });
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      mnt.render();
    }));
    // Another flit from the same statistics; the settings and the preset stand.
    $('[data-act="redraw"]').addEventListener('click', () => { seed++; mnt.render(); });
    root.querySelector('.preset[data-preset="design"]').setAttribute('aria-pressed', 'true');
    note.textContent = PRESETS.design.note;
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.flitFec.PRESETS = PRESETS;
})();
