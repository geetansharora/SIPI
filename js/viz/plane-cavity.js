/* SI & PI — viz/plane-cavity.js
 * Where does the return current go when a signal via changes reference? The
 * plane pair drawn as a lit membrane whose height is the voltage between the
 * planes, solved live by a 2D FDTD, with the victim via's waveform and the
 * transfer impedance from one via to the other.
 *
 * All the physics is NS.models.planeCavity (js/models/plane-cavity-model.js);
 * this steps it and draws what it holds.
 *
 * Click the board to add a stitching via (or, between GND and PWR, a stitching
 * capacitor); click one to remove it; drag any via, the signal via and victim
 * included, to move it.
 *
 * Requires js/viz-kit.js and js/models/plane-cavity-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const RISE = [30, 45, 60, 100, 150, 200, 300];          // ps
  const VZ = 4;                                            // mV: the membrane's height scale, fixed for every scene
  const FMAX = 6;                                          // GHz
  const TILT = 0.4;                                        // depth foreshortening: the board seen from about 24 degrees up
  const MESH = 2;                                          // solver cells per drawn facet
  const STILL_NS = 0.6;                                    // reduced motion: the moment shown

  const SRC = [30.25, 26.25], VIC = [78.25, 40.25];
  const ring = (d) => [[SRC[0] + d, SRC[1]], [SRC[0] - d, SRC[1]], [SRC[0], SRC[1] + d], [SRC[0], SRC[1] - d]];
  const PRESETS = {
    none: { planes: 'gnd', stitches: [], note: 'No stitching via: the return crosses as a wave, then the whole board rings on its mounting holes.' },
    near: { planes: 'gnd', stitches: [[SRC[0] + 1, SRC[1]]], note: 'A via 1 mm away carries most of the return; the victim sees less than half the noise.' },
    far: { planes: 'gnd', stitches: [[SRC[0] + 10, SRC[1]]], note: 'The same via 10 mm away: the return excites the planes on its way there, almost as if there were no via.' },
    ring: { planes: 'gnd', stitches: ring(1), note: 'Four vias 1 mm around it cage the return, and the sheet barely moves.' },
    pwr: { planes: 'pwr', stitches: [], note: 'GND to PWR, no capacitor: only the plane capacitance and four PDN capacitors carry the return across.' },
    pwrcap: { planes: 'pwr', stitches: [[SRC[0] + 1, SRC[1]]], note: 'A 100 nF capacitor 1 mm away: its 0.7 nH is a few ohms at 1 GHz, so it barely helps.' }
  };

  const hex = (h) => {
    const s = (h || '#000000').replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  };
  const snap = (v, dx) => (Math.floor(v / dx) + 0.5) * dx;

  /* Simulated nanoseconds per second of wall clock: slow motion while the wavefront
     crosses the board, then faster, so the ringing plays out in a few seconds. */
  const pace = (tNs) => (tNs < 1.2 ? 0.3 : Math.min(12, 0.3 * Math.exp((tNs - 1.2) / 1.5)));

  NS.viz.planeCavity = function (root) {
    const M = NS.models.planeCavity;
    const axes = K.axisMemo(root);
    const $ = (s) => root.querySelector(s);
    const cvB = $('[data-cv="board"]'), cvT = $('[data-cv="probe"]'), cvF = $('[data-cv="z21"]');
    const p = { planes: 'gnd', src: SRC.slice(), victim: VIC.slice(), stitches: [], ties: M.TIES.map((q) => q.slice()), ri: 2 };

    let sim = null, ghost = null, spec = null, chunk = 0, frames = 0, owed = 0, still = null;
    let geo = null;                                       // board-to-pixel mapping, set on draw

    function params() {
      return { planes: p.planes, src: p.src, victim: p.victim, stitches: p.stitches, ties: p.ties, trPs: RISE[p.ri] };
    }

    /* A new scene: keep what the last one did at the victim as a ghost to compare. */
    function restart(fresh) {
      if (fresh) ghost = null;
      else if (sim && sim.n > 50) ghost = { v: sim.vic.slice(0, sim.n + 1), dt: sim.dtPs };
      sim = M.create(params());
      spec = null; frames = 0; owed = 0; still = null;
      clearTimeout(chunk);
      m.pause();
      if (m.reduce) {
        /* No animation: solve in slices so the page stays responsive, keep the sheet
           as it was at STILL_NS, when the ripple is clearest, and show it beside the
           plots of the whole run. */
        const go = () => {
          if (!still && sim.tNs >= STILL_NS) still = { E: sim.Ez.slice(), t: sim.tNs };
          if (sim.step(still ? 400 : 20)) chunk = setTimeout(go, 0); else { spec = M.transfer(sim, FMAX); m.render(); }
        };
        m.render(); chunk = setTimeout(go, 0);
      } else {
        m.render(); m.play();
      }
    }

    function tick(dtMs) {
      if (!sim || sim.done) return false;
      owed += pace(sim.tNs) * dtMs * 1e-3 * 1e3 / sim.dtPs;     // steps due this frame
      const want = Math.floor(owed);
      owed -= want;
      const t0 = performance.now();
      for (let left = want; left > 0 && performance.now() - t0 < 14; left -= 20) sim.step(Math.min(20, left));
      frames++;
      // A spectrum needs a record long enough to resolve the first modes; until then, none.
      if (sim.done || (sim.tNs > 4 && frames % 40 === 0)) spec = M.transfer(sim, FMAX);
      return !sim.done;
    }

    /* ---------- the board, as a membrane ----------
       Seen from the front and about 30 degrees up: x across, depth y foreshortened by
       TILT, and the voltage between the planes lifting the sheet. Heights pass through
       tanh so the volts at the signal via do not dwarf the millivolts at the victim. */
    /* On a laptop the whole instrument has to fit one screen, so the board takes
       whatever height the screen leaves after everything else in the panel (measured,
       not guessed); on a phone it takes its natural height. */
    const wide = () => window.innerWidth >= 992;
    function boardHeight() {
      const w = cvB.clientWidth || 600, sx = (w - 28) / M.BOARD.a;
      const natural = Math.round(sx * M.BOARD.b * TILT + zFor(sx) + 40);
      if (!wide()) return natural;
      const rest = root.getBoundingClientRect().height - (cvB.getBoundingClientRect().height || 0);
      return Math.max(180, Math.min(natural, Math.floor((window.innerHeight || 800) - rest - 4)));
    }
    const zFor = (sx) => Math.max(22, Math.min(48, 6 * sx));       // px of lift at full scale

    function drawBoard(T) {
      const s2 = K.canvas(cvB, boardHeight()), ctx = s2.ctx, W = s2.w, H = s2.h;
      const A = M.BOARD.a, B = M.BOARD.b;
      let sx = (W - 28) / A, zMax = zFor(sx);
      if (B * TILT * sx + zMax + 40 > H) { sx = (H - 40) / (B * TILT + 6); zMax = zFor(sx); }
      const top = zMax + 14, ox = (W - A * sx) / 2;
      const oy = top + Math.max(0, (H - 26 - top - B * TILT * sx) / 2);
      geo = { ox, oy, sx, sy: sx * TILT };
      const PX = (x) => ox + x * sx, PY = (y, z) => oy + y * geo.sy - (z || 0);
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, W, H);
      if (!sim) return;

      const field = still ? still.E : sim.Ez;
      const nx = sim.nx, ny = sim.ny, mx = nx / MESH, my = ny / MESH, dx = M.BOARD.dx * MESH;
      // Vertex heights in px: the cell at each vertex, clamped to the grid.
      const zs = new Float32Array((mx + 1) * (my + 1)), vs = new Float32Array((mx + 1) * (my + 1));
      for (let j = 0; j <= my; j++) for (let i = 0; i <= mx; i++) {
        const k = Math.min(ny - 1, j * MESH) * nx + Math.min(nx - 1, i * MESH);
        const v = field[k] * sim.toMv, z = zMax * Math.tanh(v / VZ);
        zs[j * (mx + 1) + i] = z; vs[j * (mx + 1) + i] = v;
      }

      // The second plane, flat, underneath: the membrane is measured from it.
      ctx.fillStyle = K.rgba(T.border, 0.35);
      ctx.fillRect(PX(0), PY(0) + 10, A * sx, B * geo.sy);

      const base = hex(T.surface2), pos = hex(T.signal), neg = hex(T.reflect);
      const light = (0.3 * base[0] + 0.6 * base[1] + 0.1 * base[2]) > 128;   // shadows deepen less on a light sheet
      const col = [0, 0, 0];
      for (let j = 0; j < my; j++) {                       // back to front, so nearer facets paint over farther
        for (let i = 0; i < mx; i++) {
          const a = j * (mx + 1) + i, b = a + 1, c = a + mx + 1, d = c + 1;
          const z0 = zs[a], z1 = zs[b], z2 = zs[c], z3 = zs[d];
          const v = (vs[a] + vs[b] + vs[c] + vs[d]) / 4;
          // Lambert-ish: slope across x and toward the viewer, light from the upper left.
          const gx = (z1 + z3 - z0 - z2) / (2 * dx * sx), gy = (z2 + z3 - z0 - z1) / (2 * dx * geo.sy);
          const lum = Math.max(-1, Math.min(1, (-0.7 * gx + 0.9 * gy) * 1.6));
          const w = Math.pow(Math.min(1, Math.abs(v) / (2 * VZ)), 0.7), tint = v >= 0 ? pos : neg;
          for (let q = 0; q < 3; q++) col[q] = base[q] + w * (tint[q] - base[q]);
          for (let q = 0; q < 3; q++) {
            col[q] = lum > 0 ? col[q] + lum * 0.45 * (255 - col[q]) : col[q] * (1 + lum * (light ? 0.35 : 0.5));
          }
          const f = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
          ctx.fillStyle = f; ctx.strokeStyle = f; ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(PX(i * dx), PY(j * dx, z0)); ctx.lineTo(PX((i + 1) * dx), PY(j * dx, z1));
          ctx.lineTo(PX((i + 1) * dx), PY((j + 1) * dx, z3)); ctx.lineTo(PX(i * dx), PY((j + 1) * dx, z2));
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      // A light mesh every 5 mm, so the sheet reads as a surface even where it is flat.
      ctx.save(); ctx.strokeStyle = K.rgba(T.ink2, 0.12); ctx.lineWidth = 1;
      const every = Math.round(5 / dx);
      for (let j = 0; j <= my; j += every) {
        ctx.beginPath();
        for (let i = 0; i <= mx; i++) { const x = PX(i * dx), y = PY(j * dx, zs[j * (mx + 1) + i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      for (let i = 0; i <= mx; i += every) {
        ctx.beginPath();
        for (let j = 0; j <= my; j++) { const x = PX(i * dx), y = PY(j * dx, zs[j * (mx + 1) + i]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
      // The board edge at rest.
      ctx.strokeStyle = T.border; ctx.lineWidth = 1;
      ctx.strokeRect(PX(0) - 0.5, PY(0) - 0.5, A * sx + 1, B * geo.sy + 1);

      const label = (txt, x, y, c, align) => {
        ctx.save(); ctx.font = '10px ' + K.MONO; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = T.surface; ctx.strokeText(txt, x, y);
        ctx.fillStyle = c; ctx.fillText(txt, x, y); ctx.restore();
      };
      // The wavefront at c / sqrt(Dk), on the resting board, until it has left it.
      const r = ((still ? still.t : sim.tNs) - 0.03) * M.C0 / Math.sqrt(M.BOARD.er);
      if (r > 0.6 && r < 1.2 * A) {
        ctx.save(); ctx.beginPath(); ctx.rect(PX(0), PY(0) - zMax, A * sx, B * geo.sy + zMax); ctx.clip();
        ctx.setLineDash([3, 5]); ctx.strokeStyle = T.ink2; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.ellipse(PX(p.src[0]), PY(p.src[1]), r * sx, r * geo.sy, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
      }
      // Vias stand as pins through the sheet; capacitors as small blocks on it.
      const asCap = p.planes === 'pwr';
      const pin = (q, colour, h, rad) => {
        const x = PX(q[0]), y = PY(q[1]);
        K.line(ctx, x, y + 10, x, y - h, colour, 2);
        K.dot(ctx, x, y - h, colour, T.surface, rad);
      };
      const part = (q, big) => {
        if (!asCap) { pin(q, T.ink2, big ? 14 : 12, big ? 3.5 : 3); return; }
        const x = PX(q[0]), y = PY(q[1]), w = big ? 10 : 8, hh = big ? 6 : 5;
        ctx.fillStyle = T.ink2; ctx.fillRect(x - w / 2, y - hh - 2, w, hh);
        ctx.fillStyle = T.surface; ctx.fillRect(x - 1, y - hh - 2, 2, hh);
      };
      /* What the signal via is doing right now: the return current it forces across
         the gap, how fast that current is changing, and the voltage it kicks up there. */
      const nNow = still ? Math.round(still.t * 1000 / sim.dtPs) : sim.n;
      const at = { I: sim.src[nNow] || 0, V: sim.vsrc[nNow] || 0,
        dI: nNow > 0 ? (sim.src[nNow] - sim.src[nNow - 1]) / sim.dtPs * 1000 : 0 };   // mA, mV, mA/ns
      // Painted back to front, like the sheet.
      const marks = p.ties.map((q) => [q, 'tie']).concat(p.stitches.map((q) => [q, 'st']),
        [[p.victim, 'vic'], [p.src, 'src']]).sort((u, w) => u[0][1] - w[0][1]);
      marks.forEach(([q, kind]) => {
        if (kind === 'tie') part(q, true);
        else if (kind === 'st') part(q, false);
        else if (kind === 'src') {
          const x = PX(q[0]), y = PY(q[1]), glow = Math.min(1, Math.abs(at.dI) / rateMax());
          if (glow > 0.02) {                               // a glow on the board that grows with dI/dt
            ctx.save(); ctx.globalAlpha = 0.5 * glow; ctx.fillStyle = T.signal;
            ctx.beginPath(); ctx.ellipse(x, y, 10 + 10 * glow, (10 + 10 * glow) * TILT, 0, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
          }
          pin(q, T.signal, 26, 5);
        }
        else {
          const x = PX(q[0]), y = PY(q[1]);
          K.line(ctx, x, y + 10, x, y - 22, T.ink, 1.5);
          ctx.save(); ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 22, 5, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
          label('victim', x + 9, y - 22, T.ink);
        }
      });
      // The signal via's card, top left, tied to the pin head by a leader.
      const lines = ['SIGNAL VIA',
        'return current ' + at.I.toFixed(1) + ' mA',
        Math.abs(at.dI) > 0.5 ? 'rising ' + Math.round(at.dI) + ' mA/ns' : 'steady',
        'V between planes ' + (Math.abs(at.V) < 0.05 ? '0' : at.V.toFixed(1)) + ' mV'];
      ctx.save(); ctx.font = '10px ' + K.MONO;
      const cw = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 14, chh = lines.length * 13 + 8, cx = 8, cy = 22;
      K.line(ctx, cx + cw, cy + chh / 2, PX(p.src[0]), PY(p.src[1]) - 26, T.signal, 1, [2, 3]);
      ctx.fillStyle = T.surface; ctx.globalAlpha = 0.92; ctx.fillRect(cx, cy, cw, chh); ctx.globalAlpha = 1;
      ctx.strokeStyle = T.signal; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chh - 1);
      ctx.textBaseline = 'middle';
      lines.forEach((t, i) => { ctx.fillStyle = i ? T.ink : T.signal; ctx.fillText(t, cx + 7, cy + 10 + i * 13); });
      ctx.restore();
      const near = nearest();
      if (near && near[1] < 15) label(near[1].toFixed(1) + ' mm', PX(p.src[0]), PY(p.src[1]) + 22, T.ink2, 'center');
      // Clock and scale bar.
      label('t = ' + (still ? still.t : sim.tNs).toFixed(2) + ' ns', 10, 12, T.ink);
      const sb = 10 * sx, bx = PX(A) - sb, by = H - 9;
      K.line(ctx, bx, by, bx + sb, by, T.ink2, 2);
      label('10 mm', bx - 6, by, T.ink2, 'right');
    }

    /* Peak dI/dt of the edge, mA/ns: a Gaussian edge of 10-90% time tr has sigma = tr / 2.563,
       and its steepest slope is I0 / (sigma sqrt(2 pi)). */
    const rateMax = () => M.DEFAULTS.iMa * 2.5631 / (Math.sqrt(2 * Math.PI) * RISE[p.ri] / 1000);

    function nearest() {
      let best = null;
      p.stitches.concat(p.ties).forEach((q) => {
        const dmm = Math.hypot(q[0] - p.src[0], q[1] - p.src[1]);
        if (!best || dmm < best[1]) best = [q, dmm];
      });
      return best;
    }

    const plotH = () => (wide() ? ((window.innerHeight || 800) < 700 ? 110 : 150) : 200);

    /* ---------- the victim, in time ---------- */
    function drawProbe(T) {
      const s = K.canvas(cvT, plotH());
      if (!sim) return;
      const n = sim.n, dt = sim.dtPs / 1000, v = sim.vic;
      let lo = 0, hi = 0;
      for (let k = 0; k <= n; k++) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }
      if (ghost) for (let k = 0; k < ghost.v.length; k++) { if (ghost.v[k] < lo) lo = ghost.v[k]; if (ghost.v[k] > hi) hi = ghost.v[k]; }
      const big = Math.max(-lo, hi, 0.05);
      const yr = K.stickyAxis(axes, 'v', -big, big, { head: 0.08 });
      const P = K.plot(s, T, {
        pad: { l: 44, r: 12, t: 18, b: 30 },
        x: { min: 0, max: sim.params.recordNs, count: 4, fmt: (x) => x.toFixed(0), title: 'ns' },
        y: { min: yr.min, max: yr.max, count: 4, fmt: (y) => (Math.abs(y) < 1e-9 ? '0' : +y.toPrecision(2)) + '', title: 'mV at the victim' }
      }).grid();
      const every = Math.max(1, Math.floor(n / 1600));
      if (ghost) {
        const gn = ghost.v.length, ge = Math.max(1, Math.floor(gn / 1600)), gdt = ghost.dt / 1000;
        P.trace((i) => [i * ge * gdt, ghost.v[i * ge]], T.muted, { n: Math.floor((gn - 1) / ge) + 1, width: 1.2, dash: [4, 3], id: 'before', label: 'before your last change', unit: 'mV' });
      }
      P.trace((i) => [i * every * dt, v[i * every]], T.signal, { n: Math.floor(n / every) + 1, width: 1.8, id: 'victim', label: 'at the victim', unit: 'mV' });
      P.frame();
    }

    /* ---------- the victim, in frequency ---------- */
    function drawZ21(T) {
      const s = K.canvas(cvF, plotH());
      const ok = spec ? spec.filter((q) => q.edge > 0.02 && q.f > 0.1) : [];
      const yr = K.stickyAxis(axes, 'z', ok.length ? Math.min(...ok.map((q) => q.z)) : 0.01,
        ok.length ? Math.max(...ok.map((q) => q.z)) : 1, { log: true, decades: 3 });
      const P = K.plot(s, T, {
        pad: { l: 44, r: 12, t: 18, b: 30 },
        x: { min: 0, max: FMAX, count: 6, fmt: (f) => f.toFixed(0), title: 'GHz' },
        y: { min: yr.min, max: yr.max, log: true, fmt: (z) => (z >= 1 ? z + ' Ω' : Math.round(z * 1000) + ' mΩ'), title: 'V victim / I return' }
      }).grid();
      const { ctx, box } = P;
      const modes = M.bareModes(M.BOARD.a, M.BOARD.b, (f) => M.medium(f).dk, FMAX).slice(0, 6);
      let lastX = -1e9;                                    // label a mode only where its name fits
      modes.forEach((q) => {
        const room = P.X(q.f) - lastX > 30;
        if (room) lastX = P.X(q.f);
        P.vline(q.f, T.muted, [1, 3], room ? q.m + ',' + q.n : null);
      });
      if (spec) {
        /* Above the frequency where the edge carries 2% of its peak content, the
           ratio V/I is round-off: shade it rather than draw it. */
        const cut = spec.find((q) => q.edge < 0.02);
        if (cut && cut.f < FMAX) {
          ctx.save(); ctx.fillStyle = K.rgba(T.muted, 0.12); ctx.fillRect(P.X(cut.f), box.TP, box.R - P.X(cut.f), box.B - box.TP); ctx.restore();
          K.text(ctx, 'edge too slow', box.R - 4, box.B - 10, T.muted, 10, 'right');
        }
        P.trace(spec.filter((q) => q.edge >= 0.02).map((q) => [q.f, q.z]), T.signal, { width: 1.8, id: 'z21', label: 'transfer impedance', unit: 'Ω' });
      }
      else K.text(ctx, 'waiting for 4 ns of record', (box.L + box.R) / 2, (box.TP + box.B) / 2, T.muted, 10, 'center');
      P.frame();
    }

    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      if (!sim) return;
      let pk = 0, late = 0, nl = 0;
      const from = Math.floor(5000 / sim.dtPs);
      for (let k = 0; k <= sim.n; k++) {
        const a = Math.abs(sim.vic[k]); if (a > pk) pk = a;
        if (k >= from) { late += sim.vic[k] * sim.vic[k]; nl++; }
      }
      let via = 0;
      for (let k = 0; k <= sim.n; k++) via = Math.max(via, Math.abs(sim.vsrc[k]));
      set('edge', M.DEFAULTS.iMa + ' mA in ' + RISE[p.ri] + ' ps');
      set('rate', Math.round(rateMax()) + ' mA/ns');
      set('via', via.toFixed(1) + ' mV');
      set('pk', pk.toFixed(2) + ' mV');
      set('late', nl ? Math.sqrt(late / nl).toFixed(2) + ' mV' : '—');
      const near = nearest();
      set('near', near ? near[1].toFixed(1) + ' mm' : 'none');
      $('#pc-rise').value = p.ri; $('#pc-rise-out').value = RISE[p.ri] + ' ps';
      $('#pc-planes').value = p.planes;
    }

    const m = K.mount({
      root, params: p,
      // Plots first: the board's height is what the screen leaves after them.
      draw(T) { drawProbe(T); drawZ21(T); drawBoard(T); readouts(); },
      tick
    });

    /* ---------- pointer: add, remove, drag ----------
       Every via is a pin standing up from the board, so a pin is picked anywhere along
       its length, head included. Press on a pin and move to drag it; press and release
       without moving to remove a stitching via; press on bare board to add one. */
    const PIN = { src: 26, victim: 22, st: 12, tie: 14 };          // px above the board, as drawn
    const local = (e) => { const r = cvB.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const toMm = (x, y) => [(x - geo.ox) / geo.sx, (y - geo.oy) / geo.sy];
    function pick(x, y) {
      const cands = [['src', -1, p.src], ['victim', -1, p.victim]]
        .concat(p.stitches.map((q, i) => ['st', i, q]), p.ties.map((q, i) => ['tie', i, q]));
      let best = null;
      cands.forEach(([kind, i, q]) => {
        const px = geo.ox + q[0] * geo.sx, py = geo.oy + q[1] * geo.sy, h = PIN[kind];
        const dx = Math.abs(x - px), dy = y < py - h ? py - h - y : y > py + 8 ? y - py - 8 : 0;
        const d = Math.hypot(dx, dy);
        if (d <= 8 && (!best || d < best.d)) best = { kind, i, d };
      });
      return best;
    }
    const place = (t, mm) => {
      const dx = M.BOARD.dx;
      const q = [snap(Math.max(1, Math.min(M.BOARD.a - 1, mm[0])), dx), snap(Math.max(1, Math.min(M.BOARD.b - 1, mm[1])), dx)];
      if (t.kind === 'src' || t.kind === 'victim') p[t.kind] = q;
      else (t.kind === 'st' ? p.stitches : p.ties)[t.i] = q;
    };
    cvB.style.cursor = 'crosshair';
    let press = null;                                     // { x, y, target, dragging }
    cvB.addEventListener('pointerdown', (e) => {
      if (!geo) return;
      const [x, y] = local(e), target = pick(x, y);
      const mm = toMm(x, y);
      if (!target && (mm[0] < 0 || mm[1] < 0 || mm[0] > M.BOARD.a || mm[1] > M.BOARD.b)) return;
      press = { x, y, target, dragging: false };
      if (target) cvB.setPointerCapture(e.pointerId);
    });
    cvB.addEventListener('pointermove', (e) => {
      if (!geo) return;
      const [x, y] = local(e);
      if (!press) { cvB.style.cursor = pick(x, y) ? 'grab' : 'crosshair'; return; }
      if (!press.target) return;
      if (!press.dragging && Math.hypot(x - press.x, y - press.y) > 4) {
        press.dragging = true; m.pause(); clearTimeout(chunk); cvB.style.cursor = 'grabbing';
      }
      if (press.dragging) { place(press.target, toMm(x, y)); m.render(); }
    });
    /* A via is added or removed on release, and only if the pointer stayed put: a
       finger scrolling the page across the board must not drop vias on the way. */
    cvB.addEventListener('pointerup', (e) => {
      if (!press) return;
      const [x, y] = local(e), t = press.target, moved = Math.hypot(x - press.x, y - press.y);
      const was = press; press = null;
      cvB.style.cursor = pick(x, y) ? 'grab' : 'crosshair';
      if (was.dragging) { custom(); restart(); return; }
      if (moved > 6) return;
      if (t) {
        if (t.kind === 'st') p.stitches.splice(t.i, 1);
        else if (t.kind === 'tie') p.ties.splice(t.i, 1);
        else return;                                      // a tap on the signal via or victim does nothing
      } else {
        const mm = toMm(x, y), dx = M.BOARD.dx;
        p.stitches.push([snap(mm[0], dx), snap(mm[1], dx)]);
      }
      custom(); restart();
    });
    cvB.addEventListener('pointercancel', () => {
      if (press && press.dragging) { custom(); restart(); }
      press = null;
    });

    function custom() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    $('#pc-rise').addEventListener('input', (e) => { p.ri = +e.target.value; custom(); restart(); });
    $('#pc-planes').addEventListener('change', (e) => { p.planes = e.target.value; custom(); restart(); });
    root.querySelectorAll('[data-act="replay"]').forEach((b) => b.addEventListener('click', () => restart(true)));
    function preset(name) {
      const q = PRESETS[name];
      Object.assign(p, { planes: q.planes, stitches: q.stitches.map((s) => s.slice()), src: SRC.slice(), victim: VIC.slice(), ties: M.TIES.map((s) => s.slice()) });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.preset === name)));
      $('[data-out="note"]').textContent = q.note;
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      if (!PRESETS[b.dataset.preset]) return;
      preset(b.dataset.preset); restart();
    }));

    preset('none');
    sim = M.create(params());                              // t = 0: the board, its vias and empty plots
    m.render();
    setTimeout(() => m.render(), 0);                        // again once the loader has added its rows, so the height is right
    let started = false;
    return {
      start() { if (!started) { started = true; restart(); } else if (!m.reduce && sim && !sim.done) m.play(); },
      stop() { m.pause(); },
      destroy() { clearTimeout(chunk); m.teardown(); }
    };
  };
  NS.viz.planeCavity.presets = PRESETS;
})();
