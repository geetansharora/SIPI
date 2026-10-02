/* SIPI — viz/ddr5-flyby.js
 * The fly-by: one clock edge leaves the RCD and reaches five DRAMs at five
 * different times, because it travels past them in turn and each one's input
 * capacitance slows the line. The data strobes arrive almost together, from the
 * edge connector straight below each DRAM. Write leveling is the controller
 * delaying each byte lane's strobe until it lands with its own DRAM's clock.
 *   dimm    the module from above, with the edge travelling along the fly-by
 *   ladder  the clock at each DRAM against time, and where each strobe lands
 * Maths: js/models/ddr5-model.js (D.flyby). Requires viz-kit.js and ddr5-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    r6400: { set: {},
      note: 'DDR5-6400, a 1 pF input on each DRAM every 12 mm. The edge takes about 100 ps to cross each gap, so the last DRAM in the subchannel hears it some 420 ps after the first: more than one 312 ps clock period. Turn write leveling off to see what the strobes would do without it.' },
    r4800: { set: { rate: 4800 },
      note: 'The same module at 4800 MT/s. Nothing on the module has changed and the skew in picoseconds is identical; only the clock period is longer, so the same skew is a smaller fraction of it.' },
    r8800: { set: { rate: 8800 },
      note: 'At 8800 MT/s the clock period is 227 ps and the same skew spans almost two of them. The strobe delay the controller needs for the far DRAM is now nearly two whole cycles, which is why DDR5 levels both the phase and the cycle.' },
    bare: { set: { cLoad: 0 },
      note: 'Take the DRAMs’ input capacitance away: the line is bare 50 Ω and each gap costs 80 ps, the unloaded flight time. Put it back and every gap is slower and the line’s impedance lower. The loading is part of the line.' },
    open: { set: { odt: Infinity },
      note: 'The last DRAM’s CA termination off. The edge reflects from the open end and travels back along the bus, and the DRAMs near the end see a step and a bounce instead of a clean edge. DDR5 puts the termination inside the DRAM, strapped strong on the last one in the chain.' }
  };

  function ticks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  NS.viz.ddr5Flyby = function (root) {
    const M = (NS.models || {}).ddr5;
    if (!M) throw new Error('js/models/ddr5-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cvD = $('[data-cv="dimm"]'), cvL = $('[data-cv="ladder"]');
    const p = Object.assign({}, M.flybyDefaults);
    let R = null, key = '', tNow = Infinity;
    const out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
    const ODT = [Infinity, 80, 40];

    function result() {
      const k = [p.rate, p.cLoad, p.pitch, p.odt].join('|');
      if (k !== key) { R = M.flyby(p); key = k; }
      return R;
    }
    const tMax = () => R.arr[R.arr.length - 1].t + 260;
    const dqsAt = (i) => (p.level ? R.arr[i].t : R.arr[0].t);

    /* ---------- the module, from above ---------- */
    function drawDimm(T) {
      /* Asks for a little less than the drawing needs: the lab scales every plot by one
         factor to fill the screen, and the module is width-limited, so a full request
         left it floating in blank space while the timing chart below was squeezed. */
      const need = ((cvD.clientWidth || 600) - 16) / 4.27 + 36;
      const s = K.canvas(cvD, Math.round(Math.max(130, Math.min(240, need * 0.78)))), ctx = s.ctx;
      const LEN = 133.35, HGT = 31.25;
      const sc = Math.min((s.w - 16) / LEN, (s.h - 34) / HGT), ox = (s.w - LEN * sc) / 2;
      const oy = Math.max(22, (s.h - HGT * sc) / 2 + 6);           // centred when the layout gives it more height
      const X = (mm) => ox + mm * sc, Y = (mm) => oy + mm * sc;
      ctx.fillStyle = K.rgba(T.signal, 0.05); ctx.strokeStyle = T.border; ctx.lineWidth = 1;
      ctx.fillRect(X(0), Y(0), LEN * sc, HGT * sc); ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, LEN * sc, HGT * sc);
      for (let f = 2; f < LEN - 2; f += 1.6) {             // edge fingers, with the key notch
        if (Math.abs(f - 62) < 1.2) continue;
        ctx.fillStyle = K.rgba(T.reflect, 0.35); ctx.fillRect(X(f), Y(HGT - 3.2), Math.max(1, 0.9 * sc), 3.2 * sc);
      }
      const mid = LEN / 2, t = Math.min(tNow, tMax()), n = R.arr.length;
      const drX = (i, side) => mid + side * (14 + i * p.pitch);
      const busY = 23.5;
      /* the fly-by, lit behind the travelling edge */
      const front = (side) => {
        if (t <= 0) return mid;
        const pts = [[0, mid + side * 6]].concat(R.arr.map((a, i) => [a.t, drX(i, side)]));
        for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
          const u = (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
          return pts[i - 1][1] + u * (pts[i][1] - pts[i - 1][1]);
        }
        return drX(n - 1, side);
      };
      [-1, 1].forEach((side) => {
        K.line(ctx, X(mid + side * 6), Y(busY), X(drX(n - 1, side)), Y(busY), T.border, 2);
        K.line(ctx, X(mid + side * 6), Y(busY), X(front(side)), Y(busY), T.signal, 3);
        if (t > 0 && t < tMax() - 200) K.dot(ctx, X(front(side)), Y(busY), T.signal, T.surface, 4);
        const endX = X(drX(n - 1, side) + side * 5);
        K.line(ctx, X(drX(n - 1, side)), Y(busY), endX, Y(busY), T.muted, 1, [2, 2]);
        K.text(ctx, isFinite(p.odt) ? p.odt + ' Ω' : 'open', endX + side * 2, Y(busY) - 7, T.muted, 9, side < 0 ? 'left' : 'right');
      });
      /* RCD, DRAMs and their strobes */
      ctx.fillStyle = T.surface2 || T.surface; ctx.strokeStyle = T.ink2; ctx.lineWidth = 1.2;
      ctx.fillRect(X(mid - 6), Y(10), 12 * sc, 10 * sc); ctx.strokeRect(X(mid - 6), Y(10), 12 * sc, 10 * sc);
      K.text(ctx, 'RCD', X(mid), Y(15), T.ink, 10, 'center');
      [-1, 1].forEach((side) => {
        for (let i = 0; i < n; i++) {
          const cx = drX(i, side), hit = t >= R.arr[i].t, dq = t >= dqsAt(i);
          ctx.fillStyle = hit ? K.rgba(T.signal, 0.28) : (T.surface2 || T.surface);
          ctx.strokeStyle = hit ? T.signal : T.ink2;
          ctx.fillRect(X(cx - 4.5), Y(5), 9 * sc, 13 * sc); ctx.strokeRect(X(cx - 4.5) + 0.5, Y(5) + 0.5, 9 * sc, 13 * sc);
          K.line(ctx, X(cx), Y(18), X(cx), Y(busY), T.muted, 1);
          K.line(ctx, X(cx + 2.5), Y(18), X(cx + 2.5), Y(HGT - 3.2), dq ? T.reflect : T.border, dq ? 2 : 1);
          if (side < 0) K.text(ctx, String(i), X(cx), Y(11.5), T.ink2, 9, 'center');
        }
      });
      K.text(ctx, 'subchannel A', X(drX(2, -1)), oy - 10, T.muted, 10, 'center');
      K.text(ctx, 'subchannel B', X(drX(2, 1)), oy - 10, T.muted, 10, 'center');
      K.text(ctx, isFinite(tNow) && tNow < tMax() ? 't = ' + Math.round(t) + ' ps' : '', X(LEN), oy - 10, T.ink2, 10, 'right');
    }

    /* ---------- the clock at each DRAM ---------- */
    function drawLadder(T) {
      const s = K.canvas(cvL, 300), ctx = s.ctx, n = R.arr.length, tm = tMax();
      const P = K.plot(s, T, {
        pad: { l: 64, r: 14, t: 22, b: 30 },
        x: { min: 0, max: tm, ticks: ticks(0, tm, 6), fmt: (v) => v.toFixed(0), title: 'ps after the RCD drives the edge' },
        y: { min: 0, max: n, ticks: [], fmt: () => '' }
      });
      const rowH = (P.box.B - P.box.TP) / n;
      /* clock periods measured from the first DRAM's edge */
      for (let k = 0; R.arr[0].t + k * R.tck <= tm; k++) {
        const x = P.X(R.arr[0].t + k * R.tck);
        K.line(ctx, x, P.box.TP, x, P.box.B, k ? T.grid : T.border, 1, k ? [3, 3] : []);
        if (k) K.text(ctx, k + ' tCK', x + 3, P.box.TP - 9, T.muted, 9, 'left');
      }
      P.grid();
      R.arr.forEach((a, i) => {
        const yb = P.box.TP + (i + 0.78) * rowH, amp = rowH * 0.55;
        K.text(ctx, 'DRAM ' + i, P.box.L - 8, yb - amp / 2, T.ink2, 10, 'right');
        const pts = [];
        for (let tt = 0; tt < Math.min(tm, a.wave.length); tt += 2) pts.push([tt, a.wave[tt] / R.final]);
        ctx.save(); ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
        ctx.strokeStyle = T.signal; ctx.lineWidth = 2; ctx.beginPath();
        pts.forEach(([tt, v], j) => { const x = P.X(tt), y = yb - Math.max(-0.2, Math.min(1.4, v)) * amp; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.restore();
        const xa = P.X(a.t);
        K.dot(ctx, xa, yb - amp / 2, T.signal, T.surface, 3.5);
        const xd = P.X(dqsAt(i));
        K.line(ctx, xd, yb - amp - 4, xd, yb + 2, T.reflect, 2);
        if (i > 0) {
          if (p.level) {
            K.line(ctx, P.X(R.arr[0].t), yb + 4, xd, yb + 4, T.reflect, 1, [2, 2]);
            K.text(ctx, '+' + Math.round(a.t - R.arr[0].t) + ' ps', xd + 5, yb + 4, T.ink2, 9, 'left');
          } else {
            K.text(ctx, 'strobe ' + Math.round(a.t - R.arr[0].t) + ' ps early', xd + 5, yb + 4, T.alarm, 9, 'left');
          }
        }
      });
      if (isFinite(tNow) && tNow < tm) P.vline(tNow, T.ink2, [1, 0]);
      P.frame();
    }

    function readouts() {
      const L = R.loaded;
      out('zl', L.z.toFixed(1) + ' Ω');
      out('per', ((R.arr[R.arr.length - 1].t - R.arr[0].t) / (R.arr.length - 1)).toFixed(0) + ' ps');
      out('skew', R.skew.toFixed(0) + ' ps');
      out('tck', (R.skew / R.tck).toFixed(2) + ' tCK');
    }
    function syncControls() {
      $('#fb-rate').value = M.RATES.indexOf(p.rate); $('#fb-rate-out').value = p.rate + ' MT/s';
      $('#fb-load').value = Math.round(p.cLoad * 10); $('#fb-load-out').value = p.cLoad.toFixed(1) + ' pF';
      $('#fb-pitch').value = Math.round(p.pitch * 2); $('#fb-pitch-out').value = p.pitch.toFixed(1) + ' mm';
      $('#fb-level').checked = !!p.level;
      root.querySelectorAll('[data-odt]').forEach((b) => b.setAttribute('aria-pressed', String(ODT[+b.dataset.odt] === p.odt)));
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) { result(); drawDimm(T); drawLadder(T); readouts(); syncControls(); },
      tick(dt) {
        tNow += dt * 0.32;                       // about 3 s for the edge to cross the module
        if (tNow >= tMax()) { tNow = Infinity; return false; }
        return true;
      }
    });
    /* Draw the new state at once, then animate from it: a scenario that only took
       effect on the next animation frame left the readouts stale in a background tab. */
    const replay = () => { m.pause(); tNow = m.reduce ? Infinity : 0; m.render(); if (!m.reduce) m.play(); };

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="fbnote"]').textContent = 'Custom';
    }
    const bind = (id, fn) => $('#' + id).addEventListener('input', (e) => { fn(+e.target.value); clearPreset(); tNow = Infinity; m.render(); });
    bind('fb-rate', (v) => { p.rate = M.RATES[v]; });
    bind('fb-load', (v) => { p.cLoad = v / 10; });
    bind('fb-pitch', (v) => { p.pitch = v / 2; });
    $('#fb-level').addEventListener('change', (e) => { p.level = e.target.checked; clearPreset(); replay(); });
    root.querySelectorAll('[data-odt]').forEach((b) => b.addEventListener('click', () => { p.odt = ODT[+b.dataset.odt]; clearPreset(); tNow = Infinity; m.render(); }));
    root.querySelectorAll('[data-act="replay"]').forEach((b) => b.addEventListener('click', replay));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];
      if (!c) return;
      Object.assign(p, M.flybyDefaults, c.set);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="fbnote"]').textContent = c.note;
      replay();
    }));
    $('[data-out="fbnote"]').textContent = PRESETS.r6400.note;
    const off = K.onRepaint(root, () => m.render());
    let played = false;
    m.render();
    return {
      start() { if (!played) { played = true; replay(); } },
      stop() { m.pause(); if (isFinite(tNow)) { tNow = Infinity; m.render(); } },
      destroy() { off(); m.teardown(); }
    };
  };
  NS.viz.ddr5Flyby.presets = PRESETS;
})();
