/* SI & PI — viz/ucie-3d.js
 * How hot a hybrid-bonded UCIe-3D interface runs. Two dies bonded face to face, with
 * a zoomed window on the bond layer: a finer pitch packs more, smaller bonds into the
 * same overlap, and the layer is shaded by its power density against a heat budget.
 * Beside it, power density against bond pitch at the chosen activity.
 *
 * The dies do not move closer as the pitch shrinks: in hybrid bonding they already
 * touch. What changes is how many bonds share the overlap.
 *
 * All the arithmetic is NS.models.ucie3d (js/models/ucie-model.js); this draws it.
 * Heat colours are the site's validated series tokens: signal (within budget),
 * reflect (near it), alarm (over it).
 *
 * Requires js/viz-kit.js and js/models/ucie-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const PITCH = [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9];                 // um, the span the targets cover
  const ACT = [1, 2, 3, 5, 10, 20, 30, 50, 75, 100];               // % of wires busy
  const AREA = [1, 2, 5, 10, 20, 50, 100];                         // mm2 bonded
  const BUDGET = [0.25, 0.5, 0.75, 700 / 814, 1, 1.5, 2, 3, 5];    // W/mm2; index 3 is the H100 average
  const WINDOW = 20;                                               // um of bond layer shown in the zoom

  const PRESETS = {
    p9: { pi: 9, ai: 9, ri: 3, bi: 3, note: '9 µm, every wire busy: 1.6 W/mm², about twice the H100 average.' },
    p1: { pi: 0, ai: 9, ri: 3, bi: 3, note: '1 µm, every wire busy: 24 W/mm², 28 times that average. 10 mm² would carry 3,000 TB/s and burn 240 W.' },
    p1cap: { pi: 0, ai: 2, ri: 3, bi: 3, note: '1 µm with 3% of wires busy: near the budget. Here heat, not the number of wires, sets the usable bandwidth.' },
    p4: { pi: 4, ai: 6, ri: 4, bi: 3, note: '4 µm, 30% busy, 20 mm²: still over the budget. Lower the share busy to find where it fits.' }
  };

  NS.viz.ucie3d = function (root) {
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const M = NS.models.ucie3d;
    const p = { pi: 0, ai: 9, ri: 3, bi: 3 };

    function heat(T, r) { return r < 0.5 ? T.signal : r < 1 ? T.reflect : T.alarm; }
    function status(r) {
      return r < 0.5 ? 'well within the budget' : r < 1 ? 'near the budget' : (r < 10 ? r.toFixed(1) : Math.round(r)) + '× the budget';
    }

    function drawPicture(T, R) {
      const narrow = ($('[data-cv="bond"]').clientWidth || 600) < 560;
      const m = R.measurements, s = K.canvas($('[data-cv="bond"]'), narrow ? 250 : 186), c = s.ctx, W = s.w;
      const hot = heat(T, m.ratioToBudget);
      const split = Math.max(150, Math.round(W * 0.48));
      // The two dies, face to face; the bond layer between them shaded by its heat.
      const x0 = 14, x1 = split - 18, yT = 12, hD = 46, yBond = yT + hD;
      c.fillStyle = T.surface2; c.strokeStyle = T.border;
      c.fillRect(x0, yT, x1 - x0, hD); c.strokeRect(x0 + 0.5, yT + 0.5, x1 - x0 - 1, hD - 1);
      c.fillRect(x0, yBond + 4, x1 - x0, hD); c.strokeRect(x0 + 0.5, yBond + 4.5, x1 - x0 - 1, hD - 1);
      c.save(); c.shadowColor = hot; c.shadowBlur = 6 + 10 * Math.min(1, m.ratioToBudget / 4);
      c.fillStyle = hot; c.fillRect(x0, yBond, x1 - x0, 4); c.restore();
      K.text(c, 'top die', x0 + 8, yT + 16, T.muted, 11, 'left');
      K.text(c, 'bottom die', x0 + 8, yBond + 4 + hD - 10, T.muted, 11, 'left');
      K.text(c, 'bond layer', x1 - 6, yBond - 8, hot, 11, 'right');
      // The zoom: a fixed 20 um of the bond layer, with the bonds at the chosen pitch.
      const zx0 = split + 8, zx1 = W - 14, zy0 = 6, zy1 = 112, zW = zx1 - zx0, zMid = (zy0 + zy1) / 2;
      const cx = x0 + (x1 - x0) * 0.4;
      c.strokeStyle = T.muted; c.setLineDash([3, 3]); c.beginPath();
      c.moveTo(cx - 10, yBond - 6); c.lineTo(zx0, zy0); c.moveTo(cx - 10, yBond + 10); c.lineTo(zx0, zy1); c.stroke(); c.setLineDash([]);
      c.strokeRect(cx - 10.5, yBond - 6.5, 20, 16);
      c.fillStyle = T.surface2; c.fillRect(zx0, zy0, zW, zMid - zy0 - 2); c.fillRect(zx0, zMid + 2, zW, zy1 - zMid - 2);
      c.strokeStyle = T.border; c.strokeRect(zx0 + 0.5, zy0 + 0.5, zW - 1, zy1 - zy0 - 1);
      const pitch = PITCH[p.pi], scale = zW / WINDOW, n = Math.floor(WINDOW / pitch + 1e-9);
      const padW = Math.max(1.5, 0.5 * pitch * scale), padH = Math.min(34, 0.9 * pitch * scale + 10);
      const off = (zW - (n - 1) * pitch * scale) / 2;
      c.fillStyle = hot;
      for (let i = 0; i < n; i++) {
        const x = zx0 + off + i * pitch * scale;
        c.fillRect(x - padW / 2, zMid - padH / 2, padW, padH);
      }
      K.text(c, narrow ? n + ' bonds in ' + WINDOW + ' µm' : WINDOW + ' µm of bond layer: ' + n + ' bonds across at ' + pitch + ' µm', zx0 + zW / 2, zy1 + 14, T.muted, 10, 'center');
      // The answer, large, and a gauge of how far over or under the budget it is: a log
      // scale from 0.1x to 30x, so twice the budget and thirty times it look different
      // even though both are red.
      K.text(c, (m.powerDensity < 10 ? m.powerDensity.toFixed(2) : m.powerDensity.toFixed(1)) + ' W/mm²', x0, 156, hot, 22, 'left');
      K.text(c, status(m.ratioToBudget), x0, 175, T.ink2 || T.ink, 11, 'left');
      const gx0 = narrow ? x0 : Math.min(x0 + 190, W * 0.45), gx1 = W - 14, gy = narrow ? 214 : 150, gh = 10;
      const gX = (r) => gx0 + (gx1 - gx0) * (Math.log10(Math.min(30, Math.max(0.1, r))) + 1) / (Math.log10(30) + 1);
      [[0.1, 0.5, T.signal], [0.5, 1, T.reflect], [1, 30, T.alarm]].forEach(([a, b, col]) => {
        c.fillStyle = K.rgba(col, 0.35); c.fillRect(gX(a), gy, gX(b) - gX(a), gh);
      });
      [0.1, 0.5, 1, 3, 10, 30].forEach((r) => K.text(c, r + '×', gX(r), gy + gh + 12, T.muted, 9, 'center'));
      const mx = gX(m.ratioToBudget);
      c.fillStyle = hot; c.beginPath(); c.moveTo(mx, gy - 2); c.lineTo(mx - 6, gy - 11); c.lineTo(mx + 6, gy - 11); c.closePath(); c.fill();
      c.fillRect(mx - 1.5, gy - 2, 3, gh + 4);
      if (narrow) K.text(c, 'power against the heat budget', gx0, gy - 14, T.muted, 10, 'left');
    }

    function drawChart(T, R) {
      const m = R.measurements, g = R.generated;
      const vals = g.fullCurve.map((q) => q[1]).concat(g.curve.map((q) => q[1]), [BUDGET[p.bi]]);
      const yr = K.stickyAxis(axes, 'pd', Math.min(...vals), Math.max(...vals), { log: true, head: 0.3, fine: true });
      const s = K.canvas($('[data-cv="pd"]'), 146);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 18, t: 18, b: 32 },
        x: { min: 0.9, max: 10, log: true, ticks: [1, 2, 3, 5, 9], fmt: (v) => String(v), title: 'bond pitch, µm' },
        y: { min: yr.min, max: yr.max, log: true, fmt: (v) => String(+v.toPrecision(2)), title: 'W per mm² of bonded area' }
      }).grid();
      P.trace(g.fullCurve, T.muted, { width: 1.2, dash: [4, 3], id: 'pd-full', label: 'every wire busy', unit: 'W/mm²' });
      P.trace(g.curve, T.signal, { width: 2.2, glow: true, id: 'pd', label: 'at the chosen activity', unit: 'W/mm²' });
      P.hline(BUDGET[p.bi], T.alarm, [5, 4], 'budget ' + BUDGET[p.bi].toFixed(2) + ' W/mm²');
      g.points.forEach(([x, y]) => K.dot(P.ctx, P.X(x), P.Y(y), T.muted, T.surface, 3.5));   // the published targets
      K.text(P.ctx, 'dots: the published targets; between them, interpolated', P.X(9.6), P.Y(yr.max) + 12, T.muted, 10, 'right');
      K.dot(P.ctx, P.X(PITCH[p.pi]), P.Y(m.powerDensity), heat(T, m.ratioToBudget), T.ink, 5);
      P.frame();
    }

    /* Option A, an exploded view: the two bonding faces pulled apart on screen so the
       bonds show as lines. A fixed 16 bond sites, so a finer pitch squeezes the same
       16 into a narrower patch: about the same bandwidth, cheaper bits, far less area,
       and so more heat per square millimetre. Faint pads fill the space that a finer
       pitch frees. The scale is fixed: 16 sites at 9 um span the full width. */
    function drawExploded(T, R) {
      const cv = $('[data-cv="bonds"]');
      if (!cv) return;
      const narrow = (cv.clientWidth || 600) < 560;
      const m = R.measurements, s = K.canvas(cv, narrow ? 250 : 228), c = s.ctx, W = s.w;
      const hot = heat(T, m.ratioToBudget), pitch = PITCH[p.pi], N = 16;
      const L = 14, avail = W - 28, scale = avail / (N * 9);
      const patchW = N * pitch * scale, px0 = L + (avail - patchW) / 2;
      const yT0 = 22, yT1 = 52, yP = 6, yB0 = 118, yB1 = 148;
      K.text(c, 'exploded view: in the real part these faces touch', L, 13, T.muted, 10, 'left');
      c.fillStyle = T.surface2; c.strokeStyle = T.border;
      c.fillRect(L, yT0, avail, yT1 - yT0); c.strokeRect(L + 0.5, yT0 + 0.5, avail - 1, yT1 - yT0 - 1);
      c.fillRect(L, yB0 + yP, avail, yB1 - yB0); c.strokeRect(L + 0.5, yB0 + yP + 0.5, avail - 1, yB1 - yB0 - 1);
      K.text(c, 'top die', L + 6, yT0 + 13, T.muted, 10, 'left');
      K.text(c, 'bottom die', L + 6, yB1 + yP - 6, T.muted, 10, 'left');
      const padW = Math.max(1.5, 0.5 * pitch * scale);
      // Ghost pads: where more bonds would fit at this pitch, outside the 16.
      c.fillStyle = K.rgba(T.muted, 0.25);
      for (let x = L + (pitch * scale) / 2; x < L + avail; x += pitch * scale) {
        if (x > px0 && x < px0 + patchW) continue;
        c.fillRect(x - padW / 2, yT1, padW, yP); c.fillRect(x - padW / 2, yB0, padW, yP);
      }
      // The 16-site patch, tinted by its heat, and its bonds: lit ones carry traffic.
      c.fillStyle = K.rgba(hot, 0.14); c.fillRect(px0, yT1 + yP, patchW, yB0 - yT1 - yP);
      const lit = Math.max(1, Math.round(N * ACT[p.ai] / 100));
      for (let i = 0; i < N; i++) {
        const x = px0 + (i + 0.5) * pitch * scale, on = ((i * lit) % N) < lit;
        c.fillStyle = hot; c.fillRect(x - padW / 2, yT1, padW, yP); c.fillRect(x - padW / 2, yB0, padW, yP);
        c.save();
        if (on) { c.shadowColor = hot; c.shadowBlur = 3 + 9 * Math.min(1, m.ratioToBudget / 4); }
        c.strokeStyle = on ? hot : K.rgba(T.muted, 0.6); c.lineWidth = on ? 2 : 1;
        c.beginPath(); c.moveTo(x, yT1 + yP); c.lineTo(x, yB0); c.stroke(); c.restore();
      }
      // What changed against the 16 sites at 9 um.
      const R9 = M({ pitch: 9, activity: ACT[p.ai] / 100, area: AREA[p.ri], budget: BUDGET[p.bi] }).measurements;
      const gbps = m.density * pitch * pitch * 1e-6 * 8;
      const line1 = N + ' bond sites, ' + Math.round(N * pitch) + ' µm wide · ' + gbps.toFixed(1) + ' Gb/s each · '
        + m.energy.toFixed(3) + ' pJ/b · ' + lit + ' of ' + N + ' busy';
      const fx = (v) => (v < 10 ? v.toFixed(1) : Math.round(v));
      const line2 = pitch === 9 ? 'The reference: 16 sites at 9 µm.'
        : 'Against 9 µm: ' + fx(R9.energy / m.energy) + '× cheaper bits, ' + fx(m.density / R9.density) + '× less area for the same bandwidth, so '
          + fx(m.powerDensity / R9.powerDensity) + '× the power per mm²';
      const yTxt = yB1 + yP + 18;
      if (narrow) {
        K.text(c, N + ' sites, ' + Math.round(N * pitch) + ' µm · ' + gbps.toFixed(1) + ' Gb/s each · ' + lit + '/' + N + ' busy', L, yTxt, T.muted, 10, 'left');
        if (pitch === 9) K.text(c, line2, L, yTxt + 20, hot, 12, 'left');
        else {
          K.text(c, fx(R9.energy / m.energy) + '× cheaper bits, ' + fx(m.density / R9.density) + '× less area:', L, yTxt + 20, hot, 12, 'left');
          K.text(c, fx(m.powerDensity / R9.powerDensity) + '× the power per mm² of 9 µm', L, yTxt + 38, hot, 12, 'left');
        }
      } else {
        K.text(c, line1, L, yTxt, T.muted, 10, 'left');
        if (pitch === 9) K.text(c, line2, L, yTxt + 22, hot, 13, 'left');
        else {
          K.text(c, 'Against 9 µm, for the same bandwidth: ' + fx(R9.energy / m.energy) + '× cheaper bits in ' + fx(m.density / R9.density) + '× less area,', L, yTxt + 22, hot, 13, 'left');
          K.text(c, 'so ' + fx(m.powerDensity / R9.powerDensity) + '× the power per mm²', L, yTxt + 40, hot, 13, 'left');
        }
      }
    }

    function draw(T) {
      const R = M({ pitch: PITCH[p.pi], activity: ACT[p.ai] / 100, area: AREA[p.ri], budget: BUDGET[p.bi] });
      const m = R.measurements;
      drawPicture(T, R); drawExploded(T, R); drawChart(T, R);
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const tb = (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-GB'));
      set('pd', (m.powerDensity < 10 ? m.powerDensity.toFixed(2) : m.powerDensity.toFixed(1)) + ' W/mm²');
      set('vs', status(m.ratioToBudget));
      set('dens', tb(m.density / 1000) + ' TB/s/mm²');
      set('epb', m.energy.toFixed(3) + ' pJ/b');
      set('total', tb(m.bandwidth) + ' TB/s, ' + (m.power < 10 ? m.power.toFixed(1) : Math.round(m.power)) + ' W');
      set('cap', (100 * m.maxActivity < 10 ? (100 * m.maxActivity).toFixed(1) : Math.round(100 * m.maxActivity)) + '% of wires');
      set('detail', (m.published ? 'This pitch is one of the consortium’s two published targets.' : 'Between the published 1 and 9 µm targets, density and energy per bit are interpolated on a straight line in log scale.')
        + ' The budget is a reference, not a limit: the interface’s heat adds to what the logic in both dies already burns.');
      const e = $('[data-out="pd"]'); if (e) e.style.color = m.ratioToBudget >= 1 ? 'var(--alarm-text)' : '';
      $('#u3-pitch').value = p.pi; $('#u3-pitch-out').value = PITCH[p.pi] + ' µm';
      $('#u3-act').value = p.ai; $('#u3-act-out').value = ACT[p.ai] + '%';
      $('#u3-area').value = p.ri; $('#u3-area-out').value = AREA[p.ri] + ' mm²';
      $('#u3-budget').value = p.bi; $('#u3-budget-out').value = BUDGET[p.bi].toFixed(2) + ' W/mm²' + (p.bi === 3 ? ' (H100)' : '');
    }

    const mnt = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    [['#u3-pitch', 'pi'], ['#u3-act', 'ai'], ['#u3-area', 'ri'], ['#u3-budget', 'bi']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { p[k] = +e.target.value; clear(); mnt.render(); }));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.assign(p, { pi: q.pi, ai: q.ai, ri: q.ri, bi: q.bi });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="p1"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.p1.note;
    mnt.render();
    return { start() {}, stop() {}, destroy() { mnt.teardown(); } };
  };
})();
