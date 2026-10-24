/* SI & PI — viz/ir-plane.js
 * Swiss cheese: a power plane under a BGA, and what its antipads do to it.
 *
 * The plane is solved for DC by models/ir-plane-model.js. Grow the clearance
 * holes round the ground and signal vias and the copper between them thins to
 * necks; the current that has to reach the power vias in the core crowds through
 * them, the drop climbs, and when neighbouring holes touch the core is cut off.
 * The map shows the current density and the equipotentials; one plot sweeps the
 * drop against hole size, the other shows how unevenly the power vias share the
 * load. Tap a via site to change what it is.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.viz = NS.viz || {};
  const K = NS.kit;

  const SWEEP = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99, 1.0, 1.02, 1.05];
  const OZ = [0.5, 1, 2];

  function channelMap(M) {                                // the default map with a lane cleared to the core
    return M.defaultMap().map((row, j) => (j === 4 || j === 5 ? '..' + row.slice(2) : row));
  }
  const PRESETS = {
    generous: { d: 0.5, I: 20, oz: 1, budget: 15, map: 'default',
      note: 'Antipads 0.5 mm across at 1 mm pitch: necks of 0.5 mm between the holes. The current still crowds toward the nearest power vias.' },
    typical: { d: 0.7, I: 20, oz: 1, budget: 15, map: 'default',
      note: 'Antipads 0.7 mm: 0.3 mm necks. Within budget, but look where the current density is highest.' },
    swiss: { d: 0.9, I: 20, oz: 1, budget: 15, map: 'default',
      note: 'Antipads 0.9 mm: 0.1 mm necks. Every amp for the core squeezes through them, and the drop is over budget.' },
    cutoff: { d: 1.0, I: 20, oz: 1, budget: 15, map: 'default',
      note: 'Antipads as wide as the pitch: the holes touch and wall off the core. No copper reaches the power vias at all.' },
    channel: { d: 0.9, I: 20, oz: 1, budget: 15, map: 'channel',
      note: 'The Swiss-cheese holes, with the first two vias of two rows moved elsewhere to clear a lane. Now push the antipads to 1 mm: the lane keeps the core alive.' }
  };

  NS.viz.irPlane = function (root) {
    const M = NS.models.irPlane;
    const axes = K.axisMemo(root);
    const $ = (s) => root.querySelector(s);
    const cvM = $('[data-cv="map"]'), cvD = $('[data-cv="drop"]'), cvV = $('[data-cv="vias"]');
    const p = { d: 0.5, I: 20, oz: 1, budget: 15, map: M.defaultMap() };
    let cur = null, model = null, sweep = [], solid = null, job = 0, geo = null, sweepKey = '';
    let old = null, complete = false;                       // the last complete sweep, shown faded while a new one solves

    /* Everything is solved at 1 A and scaled: a DC network is linear in its current. */
    const unit = (d) => {
      const m = M.create({ d, I: 1, oz: p.oz, map: p.map });
      return m.error ? { m, r: null } : { m, r: m.solve() };
    };
    function resolve() {
      const u = unit(p.d);
      model = u.m; cur = u.r;
      const key = p.oz + '|' + p.map.join('/');
      if (key === sweepKey) return;                       // same plane: a sweep in progress carries on
      clearTimeout(job);
      sweepKey = key;
      if (complete) old = { sweep, solid };
      complete = false;
      sweep = SWEEP.map(() => undefined);
      solid = null;
      const queue = SWEEP.map((d, k) => k).concat(['solid']);
      const run = () => {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 30) {
          const k = queue.shift();
          if (k === 'solid') { const s = unit(0); solid = s.r ? s.r.drop : null; }
          else { const s = SWEEP[k] === p.d ? { r: cur } : unit(SWEEP[k]); sweep[k] = s.r ? s.r.drop : null; }
        }
        m.render();
        if (queue.length) job = setTimeout(run, 0); else { complete = true; m.render(); }
      };
      job = setTimeout(run, 0);
    }

    /* ---------- sizing: one laptop screen ---------- */
    const wide = () => window.innerWidth >= 992;
    function over(cv) {
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
    function avail() {
      const bar = $('.instrument__bar').getBoundingClientRect().height || 60;
      return (window.innerHeight || 800) - bar - over(cvM) - over(cvD) - 10;
    }
    function plotH() { return wide() ? Math.max(120, Math.min(190, Math.round(avail() * 0.36))) : 190; }
    function mapHeight() {
      const w = cvM.clientWidth || 600, natural = Math.round((w - 16) * M.BOARD.b / M.BOARD.a + 16);
      return wide() ? Math.max(220, Math.min(natural, avail() - plotH())) : natural;
    }

    /* ---------- the map ---------- */
    const hex = (c) => { const h = (c || '#000000').replace('#', ''); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)); };
    const mix = (a, b, f) => a.map((v, k) => Math.round(v + (b[k] - v) * f));
    function drawMap(T) {
      const s = K.canvas(cvM, mapHeight()), ctx = s.ctx, W = s.w, H = s.h;
      const A = M.BOARD.a, B = M.BOARD.b, sc = Math.min((W - 16) / A, (H - 16) / B);
      const ox = (W - A * sc) / 2, oy = (H - B * sc) / 2;
      const PX = (x) => ox + x * sc, PY = (y) => oy + (B - y) * sc;
      geo = { PX, PY, sc, ox, oy };
      const label = (txt, x, y, c, align) => {
        ctx.save(); ctx.font = '10px ' + K.MONO; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = T.surface; ctx.strokeText(txt, x, y);
        ctx.fillStyle = c; ctx.fillText(txt, x, y); ctx.restore();
      };
      const mm = model, nx = mm.nx, ny = mm.ny, h = mm.h;

      // Current density, as a ratio to the open plane upstream of the array.
      const img = document.createElement('canvas'); img.width = nx; img.height = ny;
      const ic = img.getContext('2d'), id = ic.createImageData(nx, ny);
      const bg = hex(T.surface), cs = hex(T.signal), cr = hex(T.reflect), ca = hex(T.alarm), cm = hex(T.muted);
      const q = new Float64Array(nx * ny);
      if (cur) {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const k = i + j * nx;
          if (!mm.live[k]) continue;
          const xl = i > 0 ? cur.Ix[i - 1 + j * (nx - 1)] : null, xr = i + 1 < nx ? cur.Ix[i + j * (nx - 1)] : null;
          const yd = j > 0 ? cur.Iy[i + (j - 1) * nx] : null, yu = j + 1 < ny ? cur.Iy[i + j * nx] : null;
          const kx = xl === null ? xr : xr === null ? xl : (xl + xr) / 2, ky = yd === null ? yu : yu === null ? yd : (yd + yu) / 2;
          q[k] = Math.hypot(kx, ky) / (h * 1e-3 * mm.t) * 1e-6 / mm.Jopen;
        }
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx, o = 4 * (i + (ny - 1 - j) * nx);
        let c = bg;
        if (!mm.live[k]) c = mix(bg, cm, 0.28);                       // copper the regulator cannot reach
        else if (!cur) c = mix(bg, cs, 0.12);
        else {
          const v = q[k];
          // continuous: pale to blue up to the open-plane density, then amber, then red by 12x
          const base = mix(bg, cs, 0.06 + 0.3 * Math.min(1, v));
          if (v <= 1) c = base;
          else {
            const f = Math.min(1, Math.log(v) / Math.log(12)), amber = mix(bg, cr, 0.7);
            c = f < 0.5 ? mix(base, amber, f * 2) : mix(amber, mix(bg, ca, 0.85), (f - 0.5) * 2);
          }
        }
        id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255;
      }
      ic.putImageData(id, 0, 0);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(img, PX(0), PY(B), A * sc, B * sc); ctx.restore();

      // Equipotentials: where the voltage is lost, the lines bunch.
      if (cur && cur.drop > 0) {
        const span = cur.drop * p.I * 1e3, raw = span / 12, e = Math.pow(10, Math.floor(Math.log10(raw))), mstep = raw / e;
        const step = (mstep < 1.5 ? 1 : mstep < 3 ? 2 : mstep < 7 ? 5 : 10) * e;
        const V = (i, j) => cur.V[i + j * nx] * p.I * 1e3;
        ctx.save(); ctx.strokeStyle = K.rgba(T.ink2, 0.4); ctx.lineWidth = 1; ctx.beginPath();
        const cx = (i) => PX((i + 0.5) * h), cy = (j) => PY((j + 0.5) * h);
        for (let lv = step; lv < span; lv += step) {
          for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
            const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
            if (!(a === a && b === b && c === c && d === d)) continue;
            const pts = [];
            const edge = (v0, v1, x0, y0, x1, y1) => { if ((v0 < lv) !== (v1 < lv)) { const f = (lv - v0) / (v1 - v0); pts.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]); } };
            edge(a, b, cx(i), cy(j), cx(i + 1), cy(j)); edge(b, c, cx(i + 1), cy(j), cx(i + 1), cy(j + 1));
            edge(c, d, cx(i + 1), cy(j + 1), cx(i), cy(j + 1)); edge(d, a, cx(i), cy(j + 1), cx(i), cy(j));
            for (let n = 0; n + 1 < pts.length; n += 2) { ctx.moveTo(pts[n][0], pts[n][1]); ctx.lineTo(pts[n + 1][0], pts[n + 1][1]); }
          }
        }
        ctx.stroke(); ctx.restore();
      }

      // The holes, then the power vias, shaded by the current each carries.
      ctx.save();
      ctx.fillStyle = T.surface;
      mm.holes.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(PX(x), PY(y), r * sc, 0, 2 * Math.PI); ctx.fill(); });
      ctx.strokeStyle = K.rgba(T.ink2, 0.55); ctx.lineWidth = 1;
      mm.holes.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(PX(x), PY(y), r * sc, 0, 2 * Math.PI); ctx.stroke(); });
      // the via in each hole, and the empty sites
      for (let j = 0; j < M.NBALL; j++) for (let i = 0; i < M.NBALL; i++) {
        const c = p.map[j][i], [x, y] = M.site(i, j);
        if (c === 'g' || c === 's') { ctx.fillStyle = c === 'g' ? K.rgba(T.ink2, 0.5) : K.rgba(T.reflect, 0.6); ctx.beginPath(); ctx.arc(PX(x), PY(y), Math.max(1.5, 0.125 * sc), 0, 2 * Math.PI); ctx.fill(); }
        else if (c === '.') { ctx.strokeStyle = K.rgba(T.ink2, 0.35); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(PX(x), PY(y), 0.2 * sc, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
      }
      const vI = cur ? cur.viaI.map((v) => v * p.I) : mm.vias.map(() => 0);
      const vmax = Math.max(1e-12, ...vI), busiest = vI.indexOf(vmax);
      mm.vias.forEach((v, k) => {
        const f = vI[k] / vmax;
        ctx.beginPath(); ctx.arc(PX(v.x), PY(v.y), Math.max(3, M.PAD * sc), 0, 2 * Math.PI);
        ctx.fillStyle = cur ? K.rgba(T.signal, 0.2 + 0.75 * f) : K.rgba(T.muted, 0.4); ctx.fill();
        ctx.strokeStyle = cur && k === busiest ? T.alarm : T.signal; ctx.lineWidth = cur && k === busiest ? 2 : 1; ctx.stroke();
      });
      ctx.restore();

      // The feed, the worst neck, and the words.
      ctx.fillStyle = T.signal; ctx.fillRect(PX(0) - 4, PY(B), 4, B * sc);
      label('from the regulator', PX(0) + 6, PY(B) + 10, T.signal);
      if (cur) {
        const w = worstWeb();
        if (w) {
          ctx.strokeStyle = T.alarm; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(PX(w.x), PY(w.y), Math.max(5, 0.3 * sc), 0, 2 * Math.PI); ctx.stroke();
          label('neck ' + w.w.toFixed(2) + ' mm', PX(w.x) - 0.45 * sc, PY(w.y) - 0.42 * sc, T.alarm, 'right');
        }
        const v = mm.vias[busiest];
        label(vmax.toFixed(1) + ' A', PX(v.x) + 0.32 * sc, PY(v.y) + 0.42 * sc, T.alarm);
      } else {
        label('the core is cut off:', PX(M.X0 / 2), PY(B / 2) - 8, T.alarm, 'center');
        label('no copper reaches it', PX(M.X0 / 2), PY(B / 2) + 8, T.alarm, 'center');
      }
      label('power vias (blue)', PX(M.X0 + 4.5), PY(0) - 8, T.ink2, 'center');
    }
    function worstWeb() {
      if (!cur) return null;
      let best = null;
      cur.webs.forEach((w) => { if (w.w > 0 && (!best || w.J > best.J)) best = w; });
      return best;
    }

    /* ---------- the plots ---------- */
    function niceTicks(lo, hi) {
      const raw = (hi - lo) / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), m2 = raw / e;
      const step = (m2 < 1.5 ? 1 : m2 < 3 ? 2 : m2 < 7 ? 5 : 10) * e, out = [];
      for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
      return { ticks: out, fmt: (v) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) };
    }
    function drawDrop(T) {
      const s = K.canvas(cvD, plotH());
      const src = complete || !old ? { sweep, solid } : old;
      const pts = SWEEP.map((d, k) => (src.sweep[k] ? [d, src.sweep[k] * p.I * 1e3] : null)).filter(Boolean);
      const cutAt = SWEEP.find((d, k) => src.sweep[k] === null);
      const solidV = src.solid;
      const vals = pts.map((q) => q[1]).concat([p.budget], cur ? [cur.drop * p.I * 1e3] : []);
      const yr = K.stickyAxis(axes, 'drop', 0, Math.max(...vals) * 1.08, { head: 0.1 });
      const P = K.plot(s, T, {
        pad: { l: 40, r: 12, t: 18, b: 30 },
        x: { min: 0.3, max: 1.05, ticks: [0.3, 0.5, 0.7, 0.9, 1.0], fmt: (v) => v.toFixed(1), title: 'antipad diameter, mm' },
        y: Object.assign({ min: yr.min, max: yr.max, title: 'drop, mV' }, niceTicks(yr.min, yr.max))
      }).grid();
      if (cutAt !== undefined) { K.shadeX(P, cutAt, 1.05, K.rgba(T.alarm, 0.1)); K.text(P.ctx, 'cut off', P.X(1.05) - 3, P.box.TP + 8, T.alarm, 10, 'right'); }
      P.hline(p.budget, T.alarm, [5, 4], null);
      K.text(P.ctx, 'budget', P.X(0.3) + 4, P.Y(p.budget) - 8, T.alarm, 10, 'left');
      if (solidV) { P.hline(solidV * p.I * 1e3, T.muted, [2, 3], null); K.text(P.ctx, 'solid plane', P.X(0.3) + 4, P.Y(solidV * p.I * 1e3) + 9, T.muted, 10, 'left'); }
      if (pts.length) P.trace(pts, src === old ? K.rgba(T.signal, 0.3) : T.signal, { width: 1.8, id: 'drop', label: 'plane drop', unit: 'mV' });
      P.vline(p.d, T.ink2, [2, 3], null);
      if (cur) K.dot(P.ctx, P.X(p.d), P.Y(cur.drop * p.I * 1e3), cur.drop * p.I * 1e3 > p.budget ? T.alarm : T.signal, T.surface, 5);
      P.frame();
    }
    function drawVias(T) {
      const s = K.canvas(cvV, plotH());
      const vI = cur ? cur.viaI.map((v) => v * p.I).sort((a, b) => b - a) : [];
      const n = Math.max(1, model.vias.length), avg = p.I / n;
      const yr = K.stickyAxis(axes, 'via', 0, Math.max(avg * 2, ...vI) * 1.05, { head: 0.1 });
      const P = K.plot(s, T, {
        pad: { l: 40, r: 12, t: 18, b: 30 },
        x: { min: 0.5, max: n + 0.5, ticks: [1, Math.round(n / 2), n], fmt: (v) => String(v), title: 'power vias, busiest first' },
        y: Object.assign({ min: yr.min, max: yr.max, title: 'A per via' }, niceTicks(yr.min, yr.max))
      }).grid();
      const ctx = P.ctx, bw = Math.max(1, (P.X(1.5) - P.X(0.5)) * 0.7);
      vI.forEach((v, k) => {
        ctx.fillStyle = v > 1.5 * avg ? T.reflect : T.signal;
        const x = P.X(k + 1) - bw / 2, y = P.Y(v);
        ctx.fillRect(x, y, bw, P.Y(0) - y);
      });
      P.hline(avg, T.ink2, [4, 3], null);
      K.text(ctx, 'even share', P.X(n + 0.5) - 3, P.Y(avg) - 8, T.ink2, 10, 'right');
      if (!cur) K.text(ctx, 'no current reaches them', (P.box.L + P.box.R) / 2, (P.box.TP + P.box.B) / 2, T.alarm, 10, 'center');
      P.frame();
    }

    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      if (cur) {
        const drop = cur.drop * p.I * 1e3, w = worstWeb(), vI = cur.viaI.map((v) => v * p.I), avg = p.I / vI.length;
        set('drop', drop.toFixed(1) + ' mV');
        set('budget', drop > p.budget ? 'over by ' + (drop - p.budget).toFixed(1) + ' mV' : Math.round(100 * drop / p.budget) + '% used');
        set('neck', w ? Math.round(w.J * p.I) + ' A/mm², ' + (w.J / model.Jopen).toFixed(0) + '× open' : cur.webs.length ? 'holes touch' : 'no necks');
        set('via', (Math.max(...vI) / avg).toFixed(1) + '× even');
      } else { set('drop', 'open circuit'); set('budget', 'no path'); set('neck', '—'); set('via', '—'); }
      const put = (id, v, txt) => { const e = $('#' + id); if (e) { e.value = v; const o = $('#' + id + '-out'); if (o) o.value = txt; } };
      put('ir-d', p.d, p.d.toFixed(2) + ' mm');
      put('ir-i', p.I, p.I + ' A');
      put('ir-budget', p.budget, p.budget + ' mV');
      $('#ir-oz').value = String(p.oz);
    }

    const m = K.mount({
      root, params: p,
      draw(T) { if (!model) return; drawMap(T); drawDrop(T); drawVias(T); readouts(); }
    });

    /* ---------- controls ---------- */
    function custom() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const bind = (id, fn, solve) => $('#' + id).addEventListener('input', (e) => { fn(e.target.value); custom(); if (solve) resolve(); m.render(); });
    bind('ir-d', (v) => { p.d = +v; }, true);
    bind('ir-i', (v) => { p.I = +v; }, false);                // linear: nothing to re-solve
    bind('ir-budget', (v) => { p.budget = +v; }, false);
    $('#ir-oz').addEventListener('change', (e) => { p.oz = +e.target.value; custom(); resolve(); m.render(); });
    function preset(name) {
      const q = PRESETS[name];
      Object.assign(p, { d: q.d, I: q.I, oz: q.oz, budget: q.budget, map: q.map === 'channel' ? channelMap(M) : M.defaultMap() });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.preset === name)));
      $('[data-out="note"]').textContent = q.note;
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      if (!PRESETS[b.dataset.preset]) return;
      preset(b.dataset.preset); resolve(); m.render();
    }));

    /* ---------- pointer: tap a via site to change what it is ---------- */
    const NEXT = { g: '.', s: '.', '.': 'p', p: 'g' };
    function siteAt(e) {
      if (!geo) return null;
      const r = cvM.getBoundingClientRect(), x = (e.clientX - r.left - geo.ox) / geo.sc, y = M.BOARD.b - (e.clientY - r.top - geo.oy) / geo.sc;
      const i = Math.round((x - M.X0) / M.PITCH), j = Math.round((y - M.Y0) / M.PITCH);
      if (i < 0 || j < 0 || i >= M.NBALL || j >= M.NBALL) return null;
      const [sx, sy] = M.site(i, j);
      return Math.hypot(x - sx, y - sy) <= 0.45 ? [i, j] : null;
    }
    cvM.addEventListener('pointermove', (e) => { cvM.style.cursor = siteAt(e) ? 'pointer' : 'default'; });
    cvM.addEventListener('click', (e) => {
      const at = siteAt(e);
      if (!at) return;
      const [i, j] = at, row = p.map[j];
      p.map = p.map.slice(); p.map[j] = row.slice(0, i) + NEXT[row[i]] + row.slice(i + 1);
      custom(); resolve(); m.render();
    });

    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText($('[data-out="note"]'), notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A layout change (the phone's swipe track, a tab) asks for pixels, not a nudged slider,
    // which this panel would take for the reader and drop its preset.
    const offRepaint = K.onRepaint(root, () => m.render());
    preset('typical');
    resolve();
    m.render();
    setTimeout(() => m.render(), 0);
    return {
      start() { m.render(); },
      stop() {},
      destroy() { clearTimeout(job); window.removeEventListener('resize', reserve); offRepaint(); m.teardown(); }
    };
  };
  NS.viz.irPlane.presets = PRESETS;
})();
