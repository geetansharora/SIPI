/* SI & PI — viz/cross-section.js
 * A 2D field solver you can watch. The cross-section of a trace with its field
 * lines and equipotentials, the finite-element mesh the solver used, and the two
 * checks every solver result owes its reader: does the answer stop moving as the
 * mesh is refined, and does it move when the walls of the solve are moved?
 *
 * All the physics is NS.models.crossSection (js/models/cross-section-model.js);
 * the closed forms it is compared with are NS.calc.microstrip and NS.calc.stripline
 * (js/models/calc-models.js).
 *
 * Drag a trace's outer edge to change its width, drag a trace up or down to change
 * its height, and drag the right-hand trace of a pair sideways to change the gap.
 *
 * Requires js/viz-kit.js, js/models/calc-models.js and js/models/cross-section-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const BOXES = [1, 1.5, 2, 3, 5, 8, 12, 20, 40];          // box walls, in heights h from the copper; 40 is the default
  const SWEEP_N = 8;                                      // mesh of the box sweep
  const LINES = 22;                                       // field lines on the half

  const PRESETS = {
    ms50: { type: 'ms', pair: false, w: 6, h: 3.5, t: 1.4, s: 6, er: 4.2, li: 4, box: 40,
      note: 'A 50 Ω microstrip: 6 mil on 3.5 mil of Dk 4.2, 1 oz copper. Refine the mesh and watch it settle.' },
    pair100: { type: 'ms', pair: true, mode: 'odd', w: 5.5, h: 4, t: 1.4, s: 7, er: 4.2, li: 4, box: 40,
      note: 'A 100 Ω microstrip pair, odd mode. The field lines that cross to the other trace are the coupling.' },
    exact: { type: 'sl', pair: false, w: 5, h: 5, t: 0, s: 6, er: 4, li: 4, box: 40,
      note: 'A zero-thickness stripline: the one geometry with an exact answer (Cohn). Check the solver against it.' },
    coarse: { type: 'ms', pair: false, w: 6, h: 3.5, t: 1.4, s: 6, er: 4.2, li: 0, box: 40,
      note: 'The same microstrip on the coarsest mesh: about 3% low, and only the ladder says so.' },
    walls: { type: 'ms', pair: false, w: 6, h: 3.5, t: 1.4, s: 6, er: 4.2, li: 4, box: 1.5,
      note: 'Walls 1.5 h away. The field ends on them, C rises and Z0 falls: a converged answer to the wrong question.' }
  };

  NS.viz.crossSection = function (root) {
    const M = NS.models.crossSection, CALC = NS.calc;
    const axes = K.axisMemo(root);
    const $ = (s) => root.querySelector(s);
    const cvX = $('[data-cv="section"]'), cvC = $('[data-cv="ladder"]'), cvB = $('[data-cv="walls"]');
    const p = Object.assign({}, PRESETS.ms50, { mode: 'odd' });
    let cur = null, rungs = [], walls = [], lines = null, job = 0, geo = null;
    /* The last COMPLETE ladder and wall sweep, as plotted values. While a new set is
       being solved the old one stays on screen, faded, so the plots never empty and
       refit mid-solve: a change moves the curve once, when its replacement is ready. */
    const shown = { ladder: null, walls: null, lim: null, fresh: false, wfresh: false };

    const params = () => ({ type: p.type, pair: p.pair, mode: p.mode, w: p.w, h: p.h, t: p.t, s: p.s, er: p.er, box: p.box });
    const level = () => M.LEVELS[p.li];

    /* Solve the picture now; the ladder and the wall sweep fill in behind it. */
    function resolve() {
      clearTimeout(job);
      cur = M.line(params(), level());
      lines = M.fieldLines(cur.field, LINES);
      rungs = M.LEVELS.map(() => null); rungs[p.li] = cur;
      walls = BOXES.map(() => null);
      const queue = M.LEVELS.map((n, k) => ['rung', k]).filter((q) => q[1] !== p.li).concat(BOXES.map((b, k) => ['wall', k]));
      const run = () => {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 30) {
          const [kind, k] = queue.shift();
          if (kind === 'rung') rungs[k] = M.line(params(), M.LEVELS[k]);
          else walls[k] = M.line(Object.assign(params(), { box: BOXES[k] }), Math.min(SWEEP_N, level()));
        }
        m.render();
        if (queue.length) job = setTimeout(run, 0);
      };
      job = setTimeout(run, 0);
    }

    function settle() {
      if (rungs.length && rungs.every(Boolean)) {
        if (!shown.fresh) {
          shown.ladder = rungs.map((r, k) => [r.nodes, zOf(r), k]);
          const l = M.limitOf(rungs.map((r, k) => Object.assign({ n: M.LEVELS[k] }, r)));
          shown.lim = l ? zOf({ z: l }) : null;
          shown.fresh = true;
        }
      } else shown.fresh = false;
      if (walls.length && walls.every(Boolean)) {
        if (!shown.wfresh) { shown.walls = walls.map((r, k) => [BOXES[k], zOf(r)]); shown.wfresh = true; }
      } else shown.wfresh = false;
    }

    /* The closed form for this geometry, if the site has one: Cohn's exact stripline
       for zero thickness, Hammerstad and Jensen for a single microstrip. */
    function reference() {
      if (p.pair) return null;
      if (p.type === 'sl') return p.t === 0 ? { z: CALC.stripline(p.w, 2 * p.h, p.er).z0, name: 'exact (Cohn)' } : null;
      return { z: CALC.microstrip(p.w, p.h, p.t, p.er).z0, name: 'formula (H\u2013J)' };
    }
    const zOf = (r) => (r ? (p.pair ? (p.mode === 'odd' ? 2 * r.z : r.z / 2) : r.z) : null);   // Zdiff, Zcomm or Z0
    const zName = () => (p.pair ? (p.mode === 'odd' ? 'Zdiff' : 'Zcomm') : 'Z0');

    /* ---------- the cross-section ---------- */
    const wide = () => window.innerWidth >= 992;
    function over(cv) {                                   // a panel's height apart from its canvas
      const panel = cv.closest('.panel'), st = getComputedStyle(panel);
      const flow = (box) => [...box.children].filter((k) => k !== cv && getComputedStyle(k).position !== 'absolute');
      const kids = [...panel.children];
      let h = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom) + (kids.length - 1) * (parseFloat(st.rowGap) || 0);
      kids.forEach((k) => {
        if (k === cv) return;
        if (k.contains(cv)) flow(k).forEach((c) => { h += c.getBoundingClientRect().height; });
        else h += k.getBoundingClientRect().height;
      });
      return h || 40;
    }
    /* On a laptop the instrument fills one screen: the cross-section takes what the two
       plots under it leave, the plots about a third of it. */
    function avail() {
      const bar = $('.instrument__bar').getBoundingClientRect().height || 60;
      return (window.innerHeight || 800) - bar - over(cvX) - over(cvC) - 10;
    }
    // On a phone the width sets the scale, so a flat structure (a stripline, a pair) would sit
    // in a band of empty canvas; there the canvas takes the drawing's own height. The view is
    // sticky, so this changes only when the view does, not on every drag.
    function sectionHeight(view) {
      const w = cvX.clientWidth || 600;
      if (!wide()) {
        const top = Math.max(240, Math.round(w * 0.7));
        return view ? Math.max(150, Math.min(top, Math.round(52 + view.y * (w - 30) / (2 * view.w)))) : top;
      }
      return Math.max(200, Math.min(Math.round(w * 0.62), avail() - plotH()));
    }
    function drawSection(T) {
      // The window: the copper and a margin around it, the same on both sides of the mirror.
      // It is held still while the copper fits (the scale does not follow every drag), and
      // grows or shrinks to a round size only when the copper would leave it or shrink to a speck.
      let viewW = 1, viewY = 1;
      if (cur) {
        const g = cur.field.g;
        const needW = g.x2 + Math.max(3 * p.h, 0.6 * g.x2 + 2 * p.h);
        const needY = g.top !== null ? g.top : g.yt + 3.2 * p.h;
        viewW = K.stickyAxis(axes, 'viewW', 0, needW, { min: 0, head: 0.05, shrink: 0.45 }).max;
        viewY = K.stickyAxis(axes, 'viewY', 0, needY, { min: 0, head: 0.05, shrink: 0.45 }).max;
      }
      const s2 = K.canvas(cvX, sectionHeight(cur ? { w: viewW, y: viewY } : null)), ctx = s2.ctx, W = s2.w, H = s2.h;
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, W, H);
      if (!cur) return;
      const f = cur.field, g = f.g;
      const halfW = Math.min(g.X, viewW);
      const topY = g.top !== null ? g.top : Math.min(g.Y, viewY);
      const padT = 22, padB = 30, sc = Math.min((W - 30) / (2 * viewW), (H - padT - padB) / viewY);
      const cx = W / 2, base = padT + viewY * sc + (H - padT - padB - viewY * sc) / 2;   // the plane stays put
      geo = { cx, base, sc };
      const PX = (x) => cx + x * sc, PY = (y) => base - y * sc;
      const sgn = p.pair && p.mode === 'odd' ? -1 : 1;     // the mirror image of the odd mode is negative

      // Dielectric and air.
      const dTop = g.top !== null ? g.top : g.yb;
      ctx.fillStyle = K.rgba(T.reflect, 0.08); ctx.fillRect(PX(-halfW), PY(dTop), 2 * halfW * sc, dTop * sc);
      // Potential wash: one rectangle per element, in the signal colour (or the second colour where negative).
      const { xs, ys, nx, ny, phi } = f;
      ctx.save(); ctx.beginPath(); ctx.rect(PX(-halfW), PY(topY), 2 * halfW * sc, topY * sc); ctx.clip();
      for (let j = 0; j + 1 < ny; j++) {
        if (ys[j] > topY) break;
        for (let i = 0; i + 1 < nx; i++) {
          if (xs[i] > halfW) break;
          const k = i + j * nx, v = (phi[k] + phi[k + 1] + phi[k + nx] + phi[k + nx + 1]) / 4;
          if (Math.abs(v) < 0.01) continue;
          const a = 0.32 * Math.min(1, Math.abs(v));
          for (const side of [1, -1]) {
            const vv = side === 1 ? v : sgn * v;
            ctx.fillStyle = K.rgba(vv >= 0 ? T.signal : T.reflect, a);
            const x0 = side === 1 ? PX(xs[i]) : PX(-xs[i + 1]);
            ctx.fillRect(x0, PY(ys[j + 1]), (xs[i + 1] - xs[i]) * sc + 0.6, (ys[j + 1] - ys[j]) * sc + 0.6);
          }
        }
      }
      // The mesh the solver used.
      ctx.strokeStyle = K.rgba(T.ink2, 0.16); ctx.lineWidth = 1; ctx.beginPath();
      xs.forEach((x) => { if (x <= halfW) { ctx.moveTo(PX(x), PY(0)); ctx.lineTo(PX(x), PY(Math.min(topY, g.Y))); ctx.moveTo(PX(-x), PY(0)); ctx.lineTo(PX(-x), PY(Math.min(topY, g.Y))); } });
      ys.forEach((y) => { if (y <= topY) { ctx.moveTo(PX(-Math.min(halfW, g.X)), PY(y)); ctx.lineTo(PX(Math.min(halfW, g.X)), PY(y)); } });
      ctx.stroke();
      // Equipotentials, every 10% of the trace voltage, by marching squares on each element.
      ctx.strokeStyle = K.rgba(T.signal, 0.85); ctx.lineWidth = 1; ctx.beginPath();
      for (let lv = 1; lv <= 9; lv++) {
        const c = lv / 10;
        for (let j = 0; j + 1 < ny; j++) {
          if (ys[j] > topY) break;
          for (let i = 0; i + 1 < nx; i++) {
            if (xs[i] > halfW) break;
            const k = i + j * nx, q = [phi[k], phi[k + 1], phi[k + nx + 1], phi[k + nx]];
            const P = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
            const cut = [];
            for (let e = 0; e < 4; e++) {
              const a = q[e], b = q[(e + 1) % 4];
              if ((a - c) * (b - c) < 0) { const u = (c - a) / (b - a); cut.push([P[e][0] + u * (P[(e + 1) % 4][0] - P[e][0]), P[e][1] + u * (P[(e + 1) % 4][1] - P[e][1])]); }
            }
            for (let e = 0; e + 1 < cut.length; e += 2) {
              ctx.moveTo(PX(cut[e][0]), PY(cut[e][1])); ctx.lineTo(PX(cut[e + 1][0]), PY(cut[e + 1][1]));
              ctx.moveTo(PX(-cut[e][0]), PY(cut[e][1])); ctx.lineTo(PX(-cut[e + 1][0]), PY(cut[e + 1][1]));
            }
          }
        }
      }
      ctx.stroke();
      // Field lines of D, from the trace, as dense as the charge on it.
      ctx.strokeStyle = K.rgba(T.ink, 0.7); ctx.lineWidth = 1.1; ctx.beginPath();
      (lines || []).forEach((pl) => {
        for (const side of [1, -1]) {
          pl.forEach((q, k) => (k ? ctx.lineTo(PX(side * q[0]), PY(q[1])) : ctx.moveTo(PX(side * q[0]), PY(q[1]))));
        }
      });
      ctx.stroke();
      ctx.restore();

      // Copper: the planes, and the trace (or both traces of a pair).
      ctx.fillStyle = T.ink2;
      ctx.fillRect(PX(-halfW), PY(0), 2 * halfW * sc, 5);
      if (g.top !== null) ctx.fillRect(PX(-halfW), PY(g.top) - 5, 2 * halfW * sc, 5);
      const traceRect = (x1, x2) => {
        ctx.fillStyle = T.reflect;
        if (g.t > 0) ctx.fillRect(PX(x1), PY(g.yt), (x2 - x1) * sc, Math.max(2, g.t * sc));
        else ctx.fillRect(PX(x1), PY(g.yb) - 1.5, (x2 - x1) * sc, 3);
      };
      traceRect(g.x1, g.x2); traceRect(-g.x2, -g.x1);
      if (!p.pair) traceRect(-g.x2, g.x2);
      // The walls of the solve, when they are inside the window.
      if (g.X < halfW + 1e-9 || (g.top === null && g.Y <= topY + 1e-9)) {
        ctx.save(); ctx.strokeStyle = T.alarm; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
        if (g.X <= halfW + 1e-9) { ctx.moveTo(PX(g.X), PY(0)); ctx.lineTo(PX(g.X), PY(Math.min(g.Y, topY))); ctx.moveTo(PX(-g.X), PY(0)); ctx.lineTo(PX(-g.X), PY(Math.min(g.Y, topY))); }
        if (g.top === null && g.Y <= topY + 1e-9) { ctx.moveTo(PX(-g.X), PY(g.Y)); ctx.lineTo(PX(g.X), PY(g.Y)); }
        ctx.stroke(); ctx.restore();
      }
      const label = (txt, x, y, c, align) => {
        ctx.save(); ctx.font = '10px ' + K.MONO; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = T.surface; ctx.strokeText(txt, x, y);
        ctx.fillStyle = c; ctx.fillText(txt, x, y); ctx.restore();
      };
      label('Dk ' + p.er, PX(-halfW) + 6, PY(Math.min(dTop, g.yb) / 2), T.ink2);
      if (p.type === 'ms') label('air', PX(-halfW) + 6, Math.max(PY(topY) + 16, PY(Math.min(topY, g.yt + 1.6 * p.h))), T.ink2);
      label('w ' + p.w + ' mil', PX(g.x2) + 6, PY(g.yt) - 9, T.ink);
      label('h ' + p.h + ' mil', PX(g.x2) + 6, PY(g.yb / 2), T.ink2);
      if (p.pair) label('s ' + p.s, PX(0), PY(g.yt) - 9, T.ink, 'center');
      label(f.nodes.toLocaleString('en') + ' mesh nodes on the half solved · mirrored', PX(-halfW), 10, T.muted);
      if (g.X < halfW + 1e-9) label('box wall', PX(g.X) - 4, PY(Math.min(g.Y, topY)) + 10, T.alarm, 'right');
    }

    /* ---------- the plots ---------- */
    function plotH() {
      if (!wide()) return 190;
      return Math.max(110, Math.min(190, Math.round(avail() * 0.36)));
    }
    function niceTicks(lo, hi) {                          // round ticks, about four of them
      const raw = (hi - lo) / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
      const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * e, out = [];
      for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
      return { ticks: out, fmt: (v) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) };
    }
    function drawLadder(T) {
      const s = K.canvas(cvC, plotH());
      settle();
      const got = shown.ladder || [], lim = shown.lim, ref = reference(), now = cur ? zOf(cur) : null;
      const vals = got.map((q) => q[1]).concat(ref ? [zOf(ref)] : [], lim ? [lim] : [], now ? [now] : []);
      // a span of at least 1% of the value, so one point alone never frames a 0.0002 ohm axis
      const yr = K.stickyAxis(axes, 'z', Math.min(...vals), Math.max(...vals), { zero: false, head: 0.15, minSpan: 0.01 * Math.max(...vals) });
      const P = K.plot(s, T, {
        pad: { l: 46, r: 12, t: 18, b: 30 },
        x: { min: 30, max: 30000, log: true, ticks: [100, 1000, 10000], fmt: (v) => (v >= 1000 ? v / 1000 + 'k' : v + ''), title: 'mesh nodes' },
        y: Object.assign({ min: yr.min, max: yr.max, title: zName() + ', Ω' }, niceTicks(yr.min, yr.max))
      }).grid();
      // Two dashed lines that often sit a pixel apart: the higher one is labelled above, the lower below,
      // each at whichever end of the plot keeps it off the curve (on a narrow plot the coarse meshes
      // climb through the left end, on a wide one the fine meshes run along the right).
      const lines = [];
      if (ref) lines.push([zOf(ref), T.reflect, [5, 4], ref.name]);
      if (lim) lines.push([lim, shown.fresh ? T.muted : K.rgba(T.muted, 0.45), [2, 3], 'extrapolated']);
      // Clearance: how near the curve (its points and the segments between them) comes to a
      // label's row anywhere across the label's width.
      const pts = got.map((q) => [P.X(q[0]), P.Y(q[1])]);
      const dots = pts.concat(cur ? [[P.X(cur.nodes), P.Y(now)]] : []);
      const clear = (x0, x1, y) => {
        let d = Infinity;
        dots.forEach((u) => { if (u[0] >= x0 - 4 && u[0] <= x1 + 4) d = Math.min(d, Math.abs(u[1] - y)); });
        pts.forEach((u, k) => {
          const v = pts[k + 1];
          if (!v) return;
          for (let t = 0; t <= 1; t += 0.05) {
            const x = u[0] + t * (v[0] - u[0]);
            if (x >= x0 && x <= x1) d = Math.min(d, Math.abs(u[1] + t * (v[1] - u[1]) - y));
          }
        });
        return d;
      };
      const width = (str) => { P.ctx.save(); P.ctx.font = '10px ' + K.MONO; const w = P.ctx.measureText(str).width; P.ctx.restore(); return w; };
      lines.sort((u, v) => v[0] - u[0]).forEach((q, k) => {
        P.hline(q[0], q[1], q[2], null);
        const y = P.Y(q[0]) + (k === 0 ? -9 : 9), w = width(q[3]);
        const left = P.X(30) + 4, right = P.X(30000) - 2;
        const cl = clear(left, left + w, y), cr = clear(right - w, right, y);
        const atLeft = cl >= 9 || cl >= cr;
        if (atLeft) K.text(P.ctx, q[3], left, y, q[1], 10, 'left');
        else K.text(P.ctx, q[3], right, y, q[1], 10, 'right');
      });
      const col = shown.fresh ? T.signal : K.rgba(T.signal, 0.3);
      if (got.length) P.trace(got.map((q) => [q[0], q[1]]), col, { width: 1.6, id: 'ladder', label: zName(), unit: 'Ω' });
      const { ctx } = P;
      got.forEach((q) => K.dot(ctx, P.X(q[0]), P.Y(q[1]), col, T.surface, 2.5));
      if (cur) K.dot(ctx, P.X(cur.nodes), P.Y(now), T.signal, T.surface, 5);   // this mesh, always current
      P.frame();
    }
    function drawWalls(T) {
      const s = K.canvas(cvB, plotH());
      const got = shown.walls || [];
      const vals = got.map((q) => q[1]).concat(cur ? [zOf(cur)] : []);
      const yr = K.stickyAxis(axes, 'b', Math.min(...vals), Math.max(...vals), { zero: false, head: 0.15, minSpan: 0.02 * Math.max(...vals) });
      const P = K.plot(s, T, {
        pad: { l: 46, r: 12, t: 18, b: 30 },
        x: { min: 1, max: 40, log: true, ticks: [1, 2, 5, 10, 20, 40], fmt: (v) => v + 'h', title: 'walls of the solve' },
        y: Object.assign({ min: yr.min, max: yr.max, title: zName() + ', Ω' }, niceTicks(yr.min, yr.max))
      }).grid();
      if (got.length) P.trace(got, shown.wfresh ? T.signal : K.rgba(T.signal, 0.3), { width: 1.6, id: 'walls', label: zName() + ' at ' + Math.min(SWEEP_N, level()) + ' cells', unit: 'Ω' });
      P.vline(p.box, T.ink2, [2, 3], null);
      P.frame();
    }

    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      if (!cur) return;
      const ref = reference(), z = zOf(cur);
      $('[data-out="zname"]').textContent = zName();
      set('z', z.toFixed(2) + ' Ω');
      set('lim', shown.lim ? shown.lim.toFixed(2) + ' Ω' : '—');
      const le = $('[data-out="lim"]'); if (le) le.style.opacity = shown.fresh ? '' : '0.45';
      set('eeff', cur.eeff.toFixed(3));
      set('lc', (cur.L * 0.0254 * 1e9).toFixed(2) + ' nH · ' + (cur.C * 0.0254 * 1e12).toFixed(2) + ' pF');
      const dz = ref ? (z / zOf(ref) - 1) * 100 : 0;
      set('ref', ref ? (dz >= 0 ? '+' : '−') + Math.abs(dz).toFixed(2) + '% vs ' + (ref.name === 'exact (Cohn)' ? 'exact' : 'formula') : 'no formula for a pair');
      const show = (id, on) => {
        const e = $('#' + id); if (!e) return;
        const c = e.closest('.ctl');
        c.classList.toggle('is-off', !on);
        c.querySelectorAll('input, select').forEach((x) => { x.disabled = !on; });
      };
      show('xs-s', p.pair); show('xs-mode', p.pair);
      const put = (id, v, txt) => { const e = $('#' + id); if (e) { e.value = v; const o = $('#' + id + '-out'); if (o) o.value = txt; } };
      $('#xs-type').value = p.type + (p.pair ? '2' : '1');
      $('#xs-mode').value = p.mode;
      put('xs-w', p.w, p.w + ' mil'); put('xs-h', p.h, p.h + ' mil'); put('xs-t', p.t, p.t + ' mil');
      put('xs-s', p.s, p.s + ' mil'); put('xs-er', p.er, String(p.er));
      put('xs-mesh', p.li, level() + ' cells'); put('xs-box', Math.max(0, BOXES.indexOf(p.box)), p.box + ' h');
    }

    const m = K.mount({
      root, params: p,
      draw(T) { drawLadder(T); drawWalls(T); drawSection(T); readouts(); }
    });

    /* ---------- controls ---------- */
    function custom() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const bind = (id, fn) => $('#' + id).addEventListener('input', (e) => { fn(e.target.value); custom(); resolve(); m.render(); });
    bind('xs-w', (v) => { p.w = +v; });
    bind('xs-h', (v) => { p.h = +v; });
    bind('xs-t', (v) => { p.t = +v; });
    bind('xs-s', (v) => { p.s = +v; });
    bind('xs-er', (v) => { p.er = +v; });
    bind('xs-mesh', (v) => { p.li = +v; });
    bind('xs-box', (v) => { p.box = BOXES[+v]; });
    $('#xs-type').addEventListener('change', (e) => { p.type = e.target.value.slice(0, 2); p.pair = e.target.value.endsWith('2'); custom(); resolve(); m.render(); });
    $('#xs-mode').addEventListener('change', (e) => { p.mode = e.target.value; custom(); resolve(); m.render(); });
    function preset(name) {
      const q = PRESETS[name];
      Object.assign(p, q);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.preset === name)));
      $('[data-out="note"]').textContent = q.note;
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      if (!PRESETS[b.dataset.preset]) return;
      preset(b.dataset.preset); resolve(); m.render();
    }));

    /* ---------- pointer: drag the copper ---------- */
    const local = (e) => { const r = cvX.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const toMil = (x, y) => [(x - geo.cx) / geo.sc, (geo.base - y) / geo.sc];
    function pick(x, y) {
      if (!geo || !cur) return null;
      const g = cur.field.g, [mx, my] = toMil(x, y), tolX = 6 / geo.sc, tolY = 6 / geo.sc + g.t / 2;
      const ym = (g.yb + g.yt) / 2;
      if (Math.abs(my - ym) > tolY + g.t / 2) return null;
      const ax = Math.abs(mx);
      if (Math.abs(ax - g.x2) <= tolX) return 'w';
      if (p.pair && ax >= g.x1 - tolX && ax <= g.x2) return mx > 0 ? 'sx' : 'h';
      if (ax <= g.x2) return 'h';
      return null;
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const round = (v) => Math.round(v * 2) / 2;
    let drag = null;
    cvX.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e), what = pick(x, y);
      if (!what) return;
      drag = { what, x, y, w: p.w, h: p.h, s: p.s, moved: false };
      cvX.setPointerCapture(e.pointerId);
    });
    cvX.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      if (!drag) { const w = pick(x, y); cvX.style.cursor = w === 'w' || w === 'sx' ? 'ew-resize' : w === 'h' ? 'ns-resize' : 'default'; return; }
      const dx = (x - drag.x) / geo.sc, dy = -(y - drag.y) / geo.sc;
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
      drag.moved = true;
      if (drag.what === 'w') p.w = clamp(round(drag.w + (p.pair ? 1 : 2) * dx * Math.sign((x - geo.cx) || 1)), 1, 30);
      else if (drag.what === 'h') p.h = clamp(round(drag.h + dy), 1, 20);
      else p.s = clamp(round(drag.s + 2 * dx), 2, 30);
      custom(); resolve(); m.render();
    });
    const end = () => { drag = null; };
    cvX.addEventListener('pointerup', end);
    cvX.addEventListener('pointercancel', end);

    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText($('[data-out="note"]'), notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A layout change (the phone's swipe track, a tab) asks for pixels, not a nudged slider,
    // which this panel would take for the reader and drop its preset.
    const offRepaint = K.onRepaint(root, () => m.render());
    preset('ms50');
    resolve();
    m.render();
    setTimeout(() => m.render(), 0);
    return {
      start() { m.render(); },
      stop() {},
      destroy() { clearTimeout(job); window.removeEventListener('resize', reserve); offRepaint(); m.teardown(); }
    };
  };
  NS.viz.crossSection.presets = PRESETS;
})();
