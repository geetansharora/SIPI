/* SIPI — viz/ddr5.js
 * Two slots, one bus. A DDR5 data net from the controller to one or two DIMMs,
 * seen four ways from one simulation:
 *   map     where one bit goes: the voltage on every section against time, so a
 *           reflection is a stripe running the other way and a stub's ringing is a
 *           zig-zag trapped in its strip; beside it, what the receiver sees, on the
 *           same time axis, with the DFE's reach marked
 *   eye     the PRBS eye at the DRAM (or at the controller, on a read), after the
 *           DRAM's own DFE when it is on, against the data sheet's stressed eye
 *   sweep   every pair of terminations at once, worst-case eye height
 *   shmoo   what training sees: pass or fail for each strobe delay and VrefDQ step
 * Maths: js/models/ddr5-model.js. Requires viz-kit.js and ddr5-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    base: { set: {},
      note: 'Two DIMMs on one data net at 4800 MT/s, writing to the near one. The far DIMM terminates with 40 Ω, so the part of each bit that runs past slot 1 is absorbed rather than returned. Watch the map: the bit splits at slot 1, and what goes into the far branch comes back faint.' },
    unterm: { set: { rttO: Infinity },
      note: 'The same bus with the far DIMM’s termination off. The far branch is now an open stub: the bit’s share that enters it rings back and forth in it, and the receiver sees each return a few bits later. That is intersymbol interference made of reflections, and the eye shuts.' },
    far: { set: { target: 'far' },
      note: 'Now the write goes to the far DIMM, and the near one, terminated, is the stub. The geometry is different, so the reflections land on different later bits. Every rank on a shared bus is a separate channel to sign off.' },
    emptyFar: { set: { pop: 'near' },
      note: 'Two slots, one DIMM, in the slot nearer the controller. The empty far slot is an open stub with nothing to terminate it, and it hurts. This is why a daisy-chained board asks for its far slot to be filled first.' },
    emptyNear: { set: { pop: 'far' },
      note: 'One DIMM again, now in the far slot. The only stub left is the empty near connector, a few tens of picoseconds of metal, and the eye barely notices it. Same parts, a different slot, a different eye.' },
    one: { set: { pop: 'one', rttT: 48 },
      note: 'A board with one slot per channel: no stub anywhere. The net is a single path, terminated at the DRAM, and the eye is limited by the small mismatches along it: the package, the connector, the die capacitance.' },
    fast: { set: { rate: 6400 },
      note: 'Two DIMMs at 6400 MT/s. The reflections have not changed, but each bit is shorter, so the same return now lands on a later bit: the third post-cursor instead of the second. With DFE on, the DRAM cancels what its four taps can reach, within the data sheet’s ranges.' },
    nodfe: { set: { rate: 6400, dfe: false },
      note: 'The same bus with the DRAM’s DFE off. Compare the worst-case readout with the previous scenario: the DFE recovers part of the eye, not all of it, because a reflection larger than a tap’s range, or later than its fourth post-cursor, is out of its reach.' },
    read: { set: { dir: 'read', rttT: 40 },
      note: 'A read from the near DIMM: the DRAM drives, the controller terminates, and the far DIMM still sits on the bus. The DRAM’s DFE does not help here, because it equalises the DRAM’s inputs; a read is equalised, if at all, by the controller’s receiver, which this panel leaves out.' }
  };

  function ticks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  const hexRgb = (h) => { h = (h || '#000000').replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

  NS.viz.ddr5 = function (root) {
    const M = (NS.models || {}).ddr5;
    if (!M) throw new Error('js/models/ddr5-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cvMap = $('[data-cv="map"]'), cvEye = $('[data-cv="eye"]'), cvMx = $('[data-cv="sweep"]'), cvSh = $('[data-cv="shmoo"]');
    const p = Object.assign({}, M.defaults);
    let R = null, SH = null, MX = null, mxKey = '', mxTimer = 0, mxCells = [];

    const visible = (cv) => !!(cv && cv.offsetParent !== null && cv.clientWidth > 0);
    const out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
    const mv = (v) => (v * 1000).toFixed(0) + ' mV';
    const rxName = () => (p.dir === 'read' ? 'controller' : 'DRAM');

    /* ---------- where one bit goes ---------- */
    function drawMap(T) {
      const s = K.canvas(cvMap, 320), ctx = s.ctx, r = R, net = r.net, ui = r.ui;
      const narrow = s.w < 480;
      const padT = 34, padB = 26, padL = narrow ? 36 : 46;
      const colW = narrow ? Math.max(84, s.w * 0.28) : Math.max(110, Math.min(170, s.w * 0.24));
      const mapR = s.w - colW - 18;
      const tEnd = Math.ceil(r.flight + 12 * ui);
      const Y = (t) => padT + (t / tEnd) * (s.h - padT - padB);
      /* strips: the path, then each branch, widths in proportion to their delay */
      const path = r.path, br = r.branches.filter((b) => b.chain.length);
      const pathPs = path.reduce((a, [li]) => a + net.lines[li].d, 0);
      const brPs = br.map((b) => b.chain.reduce((a, [li]) => a + net.lines[li].d, 0));
      const gap = 16, avail = mapR - padL - gap * br.length;
      const total = pathPs + brPs.reduce((a, b) => a + b, 0);
      let pxPerPs = avail / total;
      const minW = 66;
      brPs.forEach((ps) => { if (ps * pxPerPs < minW) pxPerPs = (avail - minW) / (total - ps); });
      const strips = [{ x0: padL, segs: path, ps: pathPs, w: pathPs * pxPerPs, name: 'driver → receiver' }];
      let x = padL + strips[0].w + gap;
      br.forEach((b, i) => {
        const w = Math.max(minW, brPs[i] * pxPerPs);
        strips.push({ x0: x, segs: b.chain, ps: brPs[i], w, from: b.from, branch: true });
        x += w + gap;
      });
      /* paint the field */
      const bg = hexRgb(T.surface), pos = hexRgb(T.signal), neg = hexRgb(T.reflect);
      const y0 = Math.round(Y(0)), y1 = Math.round(Y(tEnd));
      const vmax = Math.max(1e-6, r.main, 0.5 * r.swing);
      const img = ctx.createImageData(Math.max(1, Math.round(mapR - padL)), Math.max(1, y1 - y0));
      const W = img.width;
      const lineAt = (st, xs) => {           // ps along the strip -> [line, distance from end a]
        let acc = 0;
        for (const [li, dir] of st.segs) {
          const d = net.lines[li].d;
          if (xs <= acc + d) { const u = xs - acc; return [li, dir === 0 ? u : d - u]; }
          acc += d;
        }
        const [li, dir] = st.segs[st.segs.length - 1];
        return [li, dir === 0 ? net.lines[li].d : 0];
      };
      strips.forEach((st) => {
        const cols = Math.round(st.w);
        for (let cx = 0; cx < cols; cx++) {
          const [li, xd] = lineAt(st, (cx + 0.5) / cols * st.ps);
          const px = Math.round(st.x0 - padL) + cx;
          if (px < 0 || px >= W) continue;
          for (let ry = 0; ry < img.height; ry++) {
            const t = (ry + 0.5) / img.height * tEnd;
            const v = M.lineV(r.sol, net, li, xd, t) - M.lineV(r.sol, net, li, xd, t - ui);
            const a = Math.min(1, Math.pow(Math.abs(v) / vmax, 0.6)), c = v >= 0 ? pos : neg;
            const o = (ry * W + px) * 4;
            img.data[o] = bg[0] + (c[0] - bg[0]) * a;
            img.data[o + 1] = bg[1] + (c[1] - bg[1]) * a;
            img.data[o + 2] = bg[2] + (c[2] - bg[2]) * a;
            img.data[o + 3] = 255;
          }
        }
      });
      /* the field is computed at CSS-pixel resolution and drawn through the canvas
         transform, so it lands at the same place on any devicePixelRatio */
      const oc = document.createElement('canvas');
      oc.width = img.width; oc.height = img.height;
      oc.getContext('2d').putImageData(img, 0, 0);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(oc, padL, y0); ctx.restore();
      /* boundaries and names */
      const nodeName = (n) => net.nodes[n].name.replace('controller ball', 'ball').replace(' DRAM ball', ' ball');
      strips.forEach((st, si) => {
        ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.strokeRect(st.x0 + 0.5, y0 + 0.5, st.w, y1 - y0);
        let acc = 0;
        st.segs.forEach(([li, dir], k) => {
          acc += net.lines[li].d;
          const xb = st.x0 + acc * (st.w / st.ps);
          if (k < st.segs.length - 1) K.line(ctx, xb, y0, xb, y1, T.muted, 1, [2, 3]);
        });
        const L0 = net.lines[st.segs[0][0]], start = st.segs[0][1] === 0 ? L0.a : L0.b;
        const Ln = net.lines[st.segs[st.segs.length - 1][0]], end = st.segs[st.segs.length - 1][1] === 0 ? Ln.b : Ln.a;
        if (st.branch) {
          const short = nodeName(end).replace(' DRAM', '').replace(/^slot (\d), empty$/, 'empty slot $1');
          K.text(ctx, 'stub', st.x0, padT - 18, T.ink2, 10, 'left');
          if (!narrow) K.text(ctx, short, st.x0, padT - 6, T.muted, 10, 'left');
        } else if (narrow) {
          K.text(ctx, 'path', st.x0, padT - 18, T.ink2, 10, 'left');
        } else {
          K.text(ctx, nodeName(start), st.x0, padT - 18, T.ink2, 10, 'left');
          K.text(ctx, nodeName(end), st.x0 + st.w, padT - 6, T.ink2, 10, 'right');
        }
        if (si === 0 && !narrow) {
          const slot = r.path.findIndex(([li, dir]) => { const L = net.lines[li], n = dir === 0 ? L.b : L.a; return n === net.S1; });
          if (slot >= 0) {
            let a2 = 0; for (let k = 0; k <= slot; k++) a2 += net.lines[r.path[k][0]].d;
            const xs = st.x0 + a2 * (st.w / st.ps);
            K.text(ctx, 'slot 1', xs, padT - 18, T.ink2, 10, 'center');
            K.line(ctx, xs, padT - 12, xs, y0, T.muted, 1);
          }
        }
      });
      /* time axis */
      ticks(0, tEnd / 1000, 5).forEach((ns) => {
        const y = Y(ns * 1000); if (y > y1) return;
        K.line(ctx, padL - 4, y, padL, y, T.muted, 1);
        K.text(ctx, ns.toFixed(1), padL - 7, y, T.muted, 10, 'right');
      });
      K.text(ctx, 'ns', 6, padT - 18, T.muted, 10, 'left');
      K.text(ctx, 'time ↓', 6, s.h - 10, T.muted, 10, 'left');
      /* what the receiver sees, on the same time axis */
      const cx0 = mapR + 18, cx1 = s.w - 8;
      let vlo = 0, vhi = 0;
      for (let t = 0; t < tEnd; t += 2) {
        const v = pulseAt(t); vlo = Math.min(vlo, v); vhi = Math.max(vhi, v);
      }
      vhi = Math.max(vhi, 0.05);
      const VX = (v) => cx0 + (v - vlo) / (vhi - vlo || 1) * (cx1 - cx0);
      const tc = r.cursor * ui / M.SPS;
      if (r.useDfe) {
        const ya = Y(tc + 0.5 * ui), yb = Y(Math.min(tEnd, tc + 4.5 * ui));
        if (!K.series(ctx, T.signal, 'reach', 'DFE reach')) {
          ctx.fillStyle = K.rgba(T.signal, 0.08); ctx.fillRect(cx0, ya, cx1 - cx0, yb - ya);
        }
        if (!narrow) K.text(ctx, 'DFE reach', cx1, ya + 8, T.muted, 9, 'right');
      }
      K.line(ctx, VX(0), y0, VX(0), y1, T.border, 1);
      /* a label needs about 11 px; when the bits are closer than that, name every
         second or third one rather than stacking them on top of each other */
      const gapPx = Y(ui) - Y(0), every = gapPx >= 13 ? 1 : gapPx >= 7 ? 2 : 4;
      for (let k = -1; k <= 10; k++) {
        const t = tc + k * ui; if (t < 0 || t > tEnd) continue;
        const y = Y(t);
        K.line(ctx, cx0, y, cx1, y, k === 0 ? T.ink2 : T.grid, 1, k === 0 ? [] : [2, 3]);
        if (k >= 1 && k <= 6 && k % every === 0) K.text(ctx, 'h' + k, cx0 + 2, y + (every > 1 ? 0 : -6), k <= 4 && r.useDfe ? T.signal : T.muted, 9, 'left');
      }
      if (!narrow || every === 1) K.text(ctx, 'cursor', cx0 + 2, Y(tc) - (every > 1 ? 8 : 6), T.ink2, 9, 'left');
      ctx.save();
      ctx.beginPath(); ctx.rect(cx0, y0, cx1 - cx0, y1 - y0); ctx.clip();
      ctx.strokeStyle = T.ink2; ctx.lineWidth = 2; ctx.beginPath();
      for (let py = y0; py <= y1; py++) {
        const t = (py - y0) / (y1 - y0) * tEnd, xv = VX(pulseAt(t));
        py === y0 ? ctx.moveTo(xv, py) : ctx.lineTo(xv, py);
      }
      ctx.stroke(); ctx.restore();
      K.text(ctx, narrow ? rxName() : 'at the ' + rxName(), cx0, padT - 18, T.ink2, 10, 'left');
      K.text(ctx, 'one bit, V', cx0, padT - 6, T.muted, 10, 'left');
    }
    function pulseAt(t) {
      const s = R.step, ui = R.ui;
      const f = (u) => { if (u <= 0) return 0; const i = Math.floor(u); return i >= s.length - 1 ? s[s.length - 1] : s[i] + (s[i + 1] - s[i]) * (u - i); };
      return f(t) - f(t - ui);
    }

    /* ---------- the eye ---------- */
    function drawEye(T) {
      const s = K.canvas(cvEye, 320), r = R, W = r.eyeWave, sps = W.sps, ui = r.ui;
      const sample = (b, k) => { const i = b * sps + sps / 2 + k; return i >= 0 && i < W.y.length ? W.y[i] : undefined; };
      let lo = Infinity, hi = -Infinity;
      for (let b = W.lead; b < W.n; b++) for (let k = -sps; k <= sps; k++) { const v = sample(b, k); if (v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      lo = Math.floor((lo - 0.03) * 20) / 20; hi = Math.ceil((hi + 0.03) * 20) / 20;
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 18, b: 30 },
        x: { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1], fmt: (v) => (v * ui).toFixed(0), title: 'ps from the eye’s best sampling instant' },
        y: { min: lo, max: hi, ticks: ticks(lo, hi, 5), fmt: (v) => v.toFixed(2), title: 'V' }
      }).grid();
      const ctx = s.ctx;
      ctx.save(); ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
      ctx.strokeStyle = K.rgba(T.signal, 0.07); ctx.lineWidth = 1;
      for (let b = W.lead; b < W.n - 1; b++) {
        ctx.beginPath();
        for (let k = -sps; k <= sps; k++) {
          const v = sample(b, k); if (v === undefined) continue;
          const xx = P.X(k / sps), yy = P.Y(v);
          k === -sps ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
      const c = K.eyeContour(sample, W.bits, W.lead, W.n, -sps, sps);
      const vref = SH && SH.centre ? SH.centre.vref : (r.vLow + M.VDDQ) / 2;
      P.hline(vref, T.muted, [4, 4], 'Vref ' + (vref / M.VDDQ * 100).toFixed(1) + '%');
      if (c.pts) K.strokeEyeOpening(ctx, P.X, P.Y, c, sps, T.ink);
      const st = M.STRESSED[p.rate];
      if (st && p.dir === 'write' && c.pts) {
        const mid = c.pts.find((q) => q[0] === 0), vc = mid ? (mid[1] + mid[2]) / 2 : vref;
        const hh = st[0] / 2000, ww = st[1] / 2;
        if (!K.series(ctx, T.alarm, 'stressed', 'stressed-eye reference')) {
          ctx.save(); ctx.strokeStyle = T.alarm; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(P.X(-ww), P.Y(vc)); ctx.lineTo(P.X(0), P.Y(vc + hh)); ctx.lineTo(P.X(ww), P.Y(vc)); ctx.lineTo(P.X(0), P.Y(vc - hh)); ctx.closePath(); ctx.stroke(); ctx.restore();
        }
      }
      if (SH && SH.centre) {
        const x = P.X(SH.centre.s / sps), y = P.Y(SH.centre.vref);
        K.line(ctx, x - 7, y, x + 7, y, T.reflect, 2.5); K.line(ctx, x, y - 7, x, y + 7, T.reflect, 2.5);
        K.text(ctx, 'training', x + 9, y + 10, T.ink, 10, 'left');
      }
      P.frame();
      const where = p.dir === 'read' ? 'at the controller, no equalisation' : (r.useDfe ? 'at the DRAM’s slicer, after its DFE' : 'at the DRAM, no DFE');
      K.text(ctx, where, P.box.R - 4, P.box.TP + 8, T.muted, 10, 'right');
      return c;
    }

    /* ---------- every pair of terminations ---------- */
    function matrixKey() { return [p.rate, p.pop, p.target, p.dir, p.mb, p.slot, p.ron, p.dfe].join('|'); }
    function ensureMatrix(T) {
      const key = matrixKey();
      if (MX && mxKey === key) return true;
      clearTimeout(mxTimer);
      mxTimer = setTimeout(() => { MX = M.matrix(p); mxKey = key; if (visible(cvMx)) drawMatrix(K.theme(root)); }, 140);
      return false;
    }
    function drawMatrix(T) {
      const s = K.canvas(cvMx, 300), ctx = s.ctx;
      mxCells = [];
      if (!ensureMatrix(T)) { K.text(ctx, 'computing 64 buses…', s.w / 2, s.h / 2, T.muted, 11, 'center'); return; }
      const two = p.pop === 'two';
      const rows = M.RTT, cols = two ? M.RTT : [p.rttO];
      const padL = 74, padT = 44, padR = 12, padB = 28;
      const cw = (s.w - padL - padR) / cols.length, ch = (s.h - padT - padB) / rows.length;
      let best = null, maxH = 1;
      MX.forEach((row) => row.forEach((c) => { if (c.height > maxH) maxH = c.height; if (!best || c.height > best.height) best = c; }));
      const sig = hexRgb(T.signal), bg = hexRgb(T.surface);
      MX.forEach((row, i) => row.forEach((c, j) => {
        const x = padL + j * cw, y = padT + i * ch;
        const a = c.height > 0 ? 0.12 + 0.88 * c.height / maxH : 0;
        ctx.fillStyle = 'rgb(' + sig.map((v, k) => Math.round(bg[k] + (v - bg[k]) * a)).join(',') + ')';
        ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        const txt = c.height > 0 ? c.height.toFixed(0) : 'shut';
        K.text(ctx, txt, x + cw / 2, y + ch / 2, a > 0.55 ? T.surface : (c.height > 0 ? T.ink2 : T.alarm), 10, 'center');
        if (c.rttT === p.rttT && (!two || c.rttO === p.rttO)) { ctx.strokeStyle = T.ink; ctx.lineWidth = 2; ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3); }
        if (c === best) K.text(ctx, '★', x + cw - 7, y + 8, a > 0.55 ? T.surface : T.ink, 9, 'center');
        mxCells.push({ x, y, w: cw, h: ch, c });
      }));
      rows.forEach((rt, i) => K.text(ctx, M.rttLabel(rt), padL - 6, padT + (i + 0.5) * ch, T.muted, 10, 'right'));
      cols.forEach((rt, j) => K.text(ctx, M.rttLabel(rt), padL + (j + 0.5) * cw, padT - 10, T.muted, 10, 'center'));
      const tName = p.dir === 'read' ? 'controller termination' : 'RTT_WR, target DRAM';
      const oName = two ? (p.dir === 'read' ? 'RTT_NOM_RD, the other DIMM' : 'RTT_NOM_WR, the other DIMM') : 'no other DIMM on this bus';
      K.text(ctx, '↓ ' + tName, 4, padT - 26, T.ink2, 10, 'left');
      K.text(ctx, oName + ' →', s.w - padR, padT - 26, T.ink2, 10, 'right');
      K.text(ctx, 'worst-case eye height, mV · ★ the best · outlined: the current setting · select a cell to use it', 4, s.h - 10, T.muted, 10, 'left');
    }

    /* ---------- what training sees ---------- */
    function drawShmoo(T, contour) {
      const s = K.canvas(cvSh, 300), ctx = s.ctx, sh = SH, ui = R.ui, sps = M.SPS;
      const dxPs = ui / sps;
      const xMin = sh.phases[0] * dxPs, xMax = sh.phases[sh.phases.length - 1] * dxPs;
      const yMin = sh.rows[0] / M.VDDQ * 100, yMax = sh.rows[sh.rows.length - 1] / M.VDDQ * 100;
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 18, b: 30 },
        x: { min: xMin - dxPs / 2, max: xMax + dxPs / 2, ticks: ticks(xMin, xMax, 6), fmt: (v) => v.toFixed(0), title: 'strobe delay from the eye’s best instant, ps' },
        y: { min: yMin, max: yMax, ticks: ticks(yMin, yMax, 5), fmt: (v) => v.toFixed(0), title: 'VrefDQ, % of VDDQ' }
      });
      const cw = P.X(dxPs) - P.X(0), chh = Math.abs(P.Y(0) - P.Y(sh.step / M.VDDQ * 100));
      if (!K.series(ctx, T.signal, 'pass', 'pass')) {
        ctx.fillStyle = K.rgba(T.signal, 0.55);
        sh.pass.forEach((row, ri) => row.forEach((ok, ci) => {
          if (!ok) return;
          const x = P.X(sh.phases[ci] * dxPs) - cw / 2, y = P.Y(sh.rows[ri] / M.VDDQ * 100) - chh / 2;
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cw - 1), Math.max(1, chh - 0.5));
        }));
      }
      P.grid();
      if (contour && contour.pts) {
        const pts = [];
        pts.push([contour.left[0] * dxPs, contour.left[1]]);
        contour.pts.forEach(([k, top]) => pts.push([k * dxPs, top]));
        pts.push([contour.right[0] * dxPs, contour.right[1]]);
        for (let i = contour.pts.length - 1; i >= 0; i--) pts.push([contour.pts[i][0] * dxPs, contour.pts[i][2]]);
        pts.push(pts[0]);
        P.trace(pts.map(([xx, v]) => [xx, v / M.VDDQ * 100]), T.ink2, { width: 1.4, dash: [4, 3], label: 'the eye, without noise', unit: '%' });
      }
      if (sh.centre) {
        const x = P.X(sh.centre.s * dxPs), y = P.Y(sh.centre.vref / M.VDDQ * 100);
        K.line(ctx, x - 8, y, x + 8, y, T.reflect, 2.5); K.line(ctx, x, y - 8, x, y + 8, T.reflect, 2.5);
        K.text(ctx, 'trained', x + 10, y - 10, T.ink, 10, 'left');
      } else {
        K.text(ctx, 'no passing point: training fails', (P.box.L + P.box.R) / 2, (P.box.TP + P.box.B) / 2, T.alarm, 11, 'center');
      }
      P.frame();
    }

    function readouts(contour) {
      const r = R;
      out('swing', mv(r.swing));
      const mid = contour.pts ? contour.pts.find((q) => q[0] === 0) : null;
      out('eye', mid ? mv(mid[1] - mid[2]) + ' × ' + ((contour.right[0] - contour.left[0]) * r.ui / M.SPS).toFixed(0) + ' ps' : 'shut');
      out('wc', r.wc.height > 0 ? mv(r.wc.height) + ' × ' + r.wc.width.toFixed(0) + ' ps' : 'shut');
      out('taps', r.useDfe ? r.taps.map((t) => (t > 0 ? '+' : '') + t).join(' / ') + ' mV' : (p.dir === 'read' ? 'n/a on reads' : 'off'));
      out('beyond', r.beyondMv.toFixed(0) + ' mV');
      out('ui', r.ui.toFixed(1) + ' ps');
    }

    /* ---------- controls ---------- */
    const rttIdx = (v) => M.RTT.indexOf(v);
    function syncControls() {
      $('#dd-rate').value = M.RATES.indexOf(p.rate); $('#dd-rate-out').value = p.rate + ' MT/s';
      $('#dd-rate').setAttribute('aria-valuetext', p.rate + ' MT/s');
      $('#dd-mb').value = p.mb; $('#dd-mb-out').value = p.mb + ' mm';
      $('#dd-slot').value = p.slot; $('#dd-slot-out').value = p.slot + ' mm';
      $('#dd-rtt-t').value = rttIdx(p.rttT); $('#dd-rtt-t-out').value = M.rttLabel(p.rttT);
      $('#dd-rtt-o').value = rttIdx(p.rttO); $('#dd-rtt-o-out').value = M.rttLabel(p.rttO);
      $('#dd-dfe').checked = !!p.dfe; $('#dd-dfe').disabled = p.dir === 'read';
      [['pop', 'pop'], ['dir', 'dir'], ['target', 'target'], ['ron', 'ron']].forEach(([attr, key]) => {
        root.querySelectorAll('[data-' + attr + ']').forEach((b) => b.setAttribute('aria-pressed', String(String(p[key]) === b.dataset[attr])));
      });
      $('[data-ctl-wrap="target"]').hidden = p.pop !== 'two';
      $('[data-ctl-wrap="slot"]').hidden = p.pop === 'one';
      $('[data-ctl-wrap="rtt-o"]').hidden = p.pop !== 'two';
      $('#dd-rtt-t-label').textContent = p.dir === 'read' ? 'Controller termination' : 'Target DRAM, RTT_WR';
      $('#dd-rtt-o-label').textContent = p.dir === 'read' ? 'Other DIMM, RTT_NOM_RD' : 'Other DIMM, RTT_NOM_WR';
      $('#dd-ron-label').textContent = p.dir === 'read' ? 'DRAM driver' : 'Controller driver';
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) {
        R = M.run(p, { full: true });
        SH = M.shmoo(R);
        drawMap(T);
        const c = drawEye(T);
        if (visible(cvMx)) drawMatrix(T);
        if (visible(cvSh)) drawShmoo(T, c);
        readouts(c);
        out('train', SH.centre ? 'Vref ' + (SH.centre.vref / M.VDDQ * 100).toFixed(1) + '%, strobe ' + (SH.centre.s * R.ui / M.SPS >= 0 ? '+' : '') + (SH.centre.s * R.ui / M.SPS).toFixed(0) + ' ps' : 'fails');
        syncControls();
      }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const bindRange = (id, fn) => $('#' + id).addEventListener('input', (e) => { fn(+e.target.value); clearPreset(); m.render(); });
    bindRange('dd-rate', (v) => { p.rate = M.RATES[v]; });
    bindRange('dd-mb', (v) => { p.mb = v; });
    bindRange('dd-slot', (v) => { p.slot = v; });
    bindRange('dd-rtt-t', (v) => { p.rttT = M.RTT[v]; });
    bindRange('dd-rtt-o', (v) => { p.rttO = M.RTT[v]; });
    $('#dd-dfe').addEventListener('change', (e) => { p.dfe = e.target.checked; clearPreset(); m.render(); });
    [['pop', 'pop', String], ['dir', 'dir', String], ['target', 'target', String], ['ron', 'ron', Number]].forEach(([attr, key, cast]) => {
      root.querySelectorAll('[data-' + attr + ']').forEach((b) => b.addEventListener('click', () => {
        p[key] = cast(b.dataset[attr]);
        if (key === 'dir') p.rttT = p.dir === 'read' ? 40 : 240;
        clearPreset(); m.render();
      }));
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];
      if (!c) return;
      Object.assign(p, M.defaults, c.set);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    cvMx.addEventListener('click', (e) => {
      const rect = cvMx.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = mxCells.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      if (!hit) return;
      p.rttT = hit.c.rttT; if (p.pop === 'two') p.rttO = hit.c.rttO;
      clearPreset(); m.render();
    });
    $('[data-out="note"]').textContent = PRESETS.base.note;
    const off = K.onRepaint(root, () => m.render());
    m.render();
    return { start() {}, stop() {}, destroy() { off(); clearTimeout(mxTimer); m.teardown(); } };
  };
  NS.viz.ddr5.presets = PRESETS;
})();
