/* SI & PI — models/return-path-model.js
 * Where the return current flows in a plane, from DC to 100 MHz.
 *
 * A quasi-static partial-element (PEEC) solver for one copper plane under one
 * trace. The plane is a grid of square cells; the current between neighbouring
 * cell centres runs in short copper bars, each with its resistance and with a
 * partial inductance to every other bar and to the trace above. Nothing is
 * assumed about where the current goes: at each frequency the solver finds the
 * distribution that satisfies Kirchhoff's voltage law around every loop in the
 * plane, which is the one of least impedance.
 *
 *   bar voltage   V = Zs I + jw (L I) + jw M_trace I_trace
 *   every mesh    sum of V around it = 0
 *
 * The unknowns are mesh currents (a stream function psi on the cell corners),
 * so current is conserved by construction: a bar's current is the difference
 * of psi at its two ends. A particular current that carries the return from the
 * load via to the driver via along any path in the copper is added to it.
 * A slot is cells removed: psi is tied across every bar that no longer exists.
 * A stitching capacitor across a slot is one more loop, through the capacitor
 * and back through the plane.
 *
 * The plane-to-plane partial inductances depend only on the offset between two
 * bars, so the mesh inductance is one convolution on the corner grid, done by
 * FFT, and is exact for the finite board (bars outside it carry no current).
 * The system is complex symmetric and is solved by conjugate-orthogonal
 * conjugate gradients, preconditioned by the sine-transform (DST) inverse of
 * the same operator on a board without slots.
 *
 * A step of trace current is solved in time by backward Euler on the same
 * operator, from the inductive limit at t = 0+ to the resistive one at the end.
 *
 * Partial inductances are exact for thin rectangular tapes (the four-fold
 * integral of 1/r over two rectangles in closed form). Lengths in mm at the
 * interface, SI inside. Pure: no DOM.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  NS.models = NS.models || {};

  const MU0 = 4e-7 * Math.PI;
  const BOARD = { a: 60, b: 40, d: 1 };                    // mm: plane and cell
  const COPPER = { t: 35e-6, rho: 1.72e-8 };              // 1 oz plane, annealed copper at 20 C
  const RS = COPPER.rho / COPPER.t;                        // ohm per square: 0.491 mohm
  const TRACE = { w: 0.2 };                                // mm
  const VIA = { r: 0.15 };                                 // mm, a 0.3 mm drill
  const CAP = { C: 100e-9, L: 1.0e-9, R: 0.01 };          // 100 nF, ESL with its mounting, ESR
  const HEIGHTS = [0.2, 1.5];                              // mm: a four-layer and a two-layer board

  /* ---------- partial inductance of thin tapes ----------
     F has d4F/du2dv2 = 1/R, R = sqrt(u^2 + v^2 + z^2), so the four-fold integral of
     1/R over two rectangles is a signed sum of F over their 16 corner offsets. */
  function lnp(a, b, z) {                                  // ln(a + R), stable when a < 0
    const R = Math.sqrt(a * a + b * b + z * z);
    const s = a >= 0 ? a + R : (b * b + z * z) / (R - a);
    return s > 0 ? Math.log(s) : 0;
  }
  function F(u, v, z) {
    const R = Math.sqrt(u * u + v * v + z * z);
    let f = (u * u - z * z) / 2 * v * lnp(v, u, z) + (v * v - z * z) / 2 * u * lnp(u, v, z)
      - R * (u * u + v * v - 2 * z * z) / 6;
    if (z > 0 && u !== 0 && v !== 0) f -= u * v * z * Math.atan(u * v / (z * R));
    return f;
  }
  /* Mutual partial inductance, H, of two parallel tapes carrying current along their
     first axis: a = [s0, s1, c0, c1] along and across, mm; z the gap between them. */
  function tapeM(a, b, z) {
    const us = [a[1] - b[0], a[0] - b[0], a[1] - b[1], a[0] - b[1]], vs = [a[3] - b[2], a[2] - b[2], a[3] - b[3], a[2] - b[3]];
    const sg = [1, -1, -1, 1];
    let s = 0;
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) s += sg[i] * sg[k] * F(us[i], vs[k], z);
    return 1e-10 * s / ((a[3] - a[2]) * (b[3] - b[2]));   // mu0/4pi * mm -> m
  }
  // A round wire of length l and radius r, and two parallel ones D apart (mm -> H).
  const wireSelf = (l, r) => 2e-10 * (l * Math.asinh(l / r) - Math.hypot(l, r) + r);
  const wireMutual = (l, D) => 2e-10 * (l * Math.asinh(l / D) - Math.hypot(l, D) + D);

  /* Surface impedance of a plane of thickness t carrying current on one face, per
     square: rho k coth(k t), k = (1 + j)/delta. Rs at DC, rising as root f once the
     skin depth is thinner than the copper. */
  function zSurface(f) {
    if (!(f > 0)) return [RS, 0];
    const delta = Math.sqrt(COPPER.rho / (Math.PI * f * MU0));
    const x = COPPER.t / delta;                            // k t = (1 + j) x
    // coth((1+j)x) = (sinh 2x - j sin 2x) / (cosh 2x - cos 2x)
    const den = x < 1e-4 ? 0 : Math.cosh(2 * x) - Math.cos(2 * x);
    let cr, ci;
    if (den === 0 || x < 1e-3) {                           // series: 1/(kt) + kt/3
      const kr = x, ki = x, m2 = kr * kr + ki * ki;
      cr = kr / m2 + kr / 3; ci = -ki / m2 + ki / 3;
    } else if (x > 20) { cr = 1; ci = 0; }
    else { cr = Math.sinh(2 * x) / den; ci = -Math.sin(2 * x) / den; }
    const kr = 1 / delta, ki = 1 / delta;                  // rho k coth
    return [COPPER.rho * (kr * cr - ki * ci), COPPER.rho * (kr * ci + ki * cr)];
  }

  /* ---------- FFT, radix 2, in place ---------- */
  const plans = new Map();
  function plan(n) {
    if (plans.has(n)) return plans.get(n);
    const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0, bits = Math.log2(n); i < n; i++) {
      let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    const p = { n, rev, cos, sin };
    plans.set(n, p);
    return p;
  }
  function fft1(re, im, inv) {
    const n = re.length, p = plan(n);
    for (let i = 0; i < n; i++) {
      const j = p.rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = p.cos[k * step], wi = inv ? p.sin[k * step] : -p.sin[k * step];
          const a = s + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // 2D on a P1 x P2 array, index i + j * P1.
  function fft2(re, im, P1, P2, inv) {
    const r1 = new Float64Array(P1), i1 = new Float64Array(P1);
    for (let j = 0; j < P2; j++) {
      const o = j * P1;
      for (let i = 0; i < P1; i++) { r1[i] = re[o + i]; i1[i] = im[o + i]; }
      fft1(r1, i1, inv);
      for (let i = 0; i < P1; i++) { re[o + i] = r1[i]; im[o + i] = i1[i]; }
    }
    const r2 = new Float64Array(P2), i2 = new Float64Array(P2);
    for (let i = 0; i < P1; i++) {
      for (let j = 0; j < P2; j++) { r2[j] = re[i + j * P1]; i2[j] = im[i + j * P1]; }
      fft1(r2, i2, inv);
      for (let j = 0; j < P2; j++) { re[i + j * P1] = r2[j]; im[i + j * P1] = i2[j]; }
    }
  }
  const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

  /* A real, even kernel k(p, q) on |p| < n1, |q| < n2, convolved with an n1 x n2 grid by FFT. */
  function convolver(n1, n2, kern) {
    const P1 = pow2(2 * n1 - 1), P2 = pow2(2 * n2 - 1);
    const kr = new Float64Array(P1 * P2), ki = new Float64Array(P1 * P2);
    for (let q = -(n2 - 1); q <= n2 - 1; q++) for (let p = -(n1 - 1); p <= n1 - 1; p++) {
      kr[((p + P1) % P1) + ((q + P2) % P2) * P1] = kern(p, q);
    }
    fft2(kr, ki, P1, P2, false);
    const wr = new Float64Array(P1 * P2), wi = new Float64Array(P1 * P2);
    return function (xr, xi, yr, yi, scale) {              // y += scale * (k * x), scale complex [a, b]
      wr.fill(0); wi.fill(0);
      for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) { wr[i + j * P1] = xr[i + j * n1]; wi[i + j * P1] = xi[i + j * n1]; }
      fft2(wr, wi, P1, P2, false);
      for (let k = 0; k < P1 * P2; k++) { wr[k] *= kr[k]; wi[k] *= kr[k]; }   // the kernel's transform is real
      fft2(wr, wi, P1, P2, true);
      const a = scale[0], b = scale[1];
      for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) {
        const r = wr[i + j * P1], m = wi[i + j * P1];
        yr[i + j * n1] += a * r - b * m; yi[i + j * n1] += a * m + b * r;
      }
    };
  }

  // Orthonormal DST-I matrix of order n - 1 (symmetric and its own inverse).
  function dstMatrix(n) {
    const m = n - 1, S = new Float64Array(m * m), c = Math.sqrt(2 / n);
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) S[a * m + b] = c * Math.sin(Math.PI * (a + 1) * (b + 1) / n);
    return S;
  }

  /* ---------- the board ---------- */
  function cellOf(q, d, nx, ny) {
    return [Math.max(0, Math.min(nx - 1, Math.floor(q[0] / d))), Math.max(0, Math.min(ny - 1, Math.floor(q[1] / d)))];
  }

  /* Cells along a segment, mm: what a drawn slot removes. */
  function slotCells(p0, p1, d) {
    const nx = Math.round(BOARD.a / d), ny = Math.round(BOARD.b / d), out = new Set();
    const n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / (d / 3)));
    for (let k = 0; k <= n; k++) {
      const c = cellOf([p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n], d, nx, ny);
      out.add(c[0] + c[1] * nx);
    }
    return [...out];
  }

  /* create({ S, L, route, h, voids, caps, d }):
       S, L   driver and load vias, mm; route a Manhattan polyline from S to L, mm
       h      trace height over the plane, mm
       voids  removed cell indices (i + j * nx); caps [{ a: [x, y], b: [x, y] }], mm */
  function create(o) {
    const d = o.d || BOARD.d, nx = Math.round(BOARD.a / d), ny = Math.round(BOARD.b / d);
    const h = o.h || HEIGHTS[0], w = TRACE.w;
    const cu = new Uint8Array(nx * ny).fill(1);
    (o.voids || []).forEach((k) => { cu[k] = 0; });
    const cS = cellOf(o.S, d, nx, ny), cL = cellOf(o.L, d, nx, ny);
    cu[cS[0] + cS[1] * nx] = 1; cu[cL[0] + cL[1] * nx] = 1;   // a via always lands on copper
    const caps = (o.caps || []).map((c) => ({ a: cellOf(c.a, d, nx, ny), b: cellOf(c.b, d, nx, ny), at: c }));
    caps.forEach((c) => { cu[c.a[0] + c.a[1] * nx] = 1; cu[c.b[0] + c.b[1] * nx] = 1; });
    const isCu = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && cu[i + j * nx] === 1;

    const NXB = (nx - 1) * ny, NYB = nx * (ny - 1);          // x-bars and y-bars
    const xb = (i, j) => i + j * (nx - 1), yb = (i, j) => i + j * nx;

    /* A path through the copper from cell u to cell v, as signed bar currents. */
    function path(u, v) {
      const prev = new Int32Array(nx * ny).fill(-1), seen = new Uint8Array(nx * ny);
      const q = [u[0] + u[1] * nx]; seen[q[0]] = 1;
      const goal = v[0] + v[1] * nx;
      for (let h2 = 0; h2 < q.length && !seen[goal]; h2++) {
        const k = q[h2], i = k % nx, j = (k - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!isCu(i + di, j + dj)) continue;
          const kk = i + di + (j + dj) * nx;
          if (!seen[kk]) { seen[kk] = 1; prev[kk] = k; q.push(kk); }
        }
      }
      if (!seen[goal]) return null;
      const px = new Float64Array(NXB), py = new Float64Array(NYB);
      for (let k = goal; k !== q[0]; k = prev[k]) {
        const a = prev[k], ai = a % nx, aj = (a - ai) / nx, bi = k % nx, bj = (k - bi) / nx;
        if (bi === ai + 1) px[xb(ai, aj)] += 1; else if (bi === ai - 1) px[xb(bi, bj)] -= 1;
        else if (bj === aj + 1) py[yb(ai, aj)] += 1; else py[yb(bi, bj)] -= 1;
      }
      return { x: px, y: py };
    }
    const Ip = path(cL, cS);                                // the return, load to driver
    if (!Ip) return { error: 'split', nx, ny, d };
    const capPaths = caps.map((c) => path(c.b, c.a));      // each capacitor's loop closes through the plane
    if (capPaths.some((p) => !p)) return { error: 'cap', nx, ny, d };

    /* ---------- the unknowns: psi on interior corners, tied across missing bars ---------- */
    const mx = nx - 1, my = ny - 1, NC = mx * my;          // interior corner (I, J) -> (I-1) + (J-1) * mx
    const parent = new Int32Array(NC + 1);                  // index NC is the board edge, psi = 0
    for (let k = 0; k <= NC; k++) parent[k] = k;
    const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const cid = (I, J) => (I <= 0 || J <= 0 || I >= nx || J >= ny ? NC : (I - 1) + (J - 1) * mx);
    const unite = (a, b) => { a = find(a); b = find(b); if (a === b) return; if (a === NC) parent[b] = a; else parent[a] = b; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) {
      if (!(isCu(i, j) && isCu(i + 1, j))) unite(cid(i + 1, j), cid(i + 1, j + 1));
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
      if (!(isCu(i, j) && isCu(i, j + 1))) unite(cid(i, j + 1), cid(i + 1, j + 1));
    }
    const grp = new Int32Array(NC), size = [];             // corner -> unknown, -1 on the edge
    const idx = new Map();
    for (let k = 0; k < NC; k++) {
      const r = find(k);
      if (r === find(NC)) { grp[k] = -1; continue; }
      if (!idx.has(r)) { idx.set(r, size.length); size.push(0); }
      grp[k] = idx.get(r); size[grp[k]]++;
    }
    const NP = size.length, NK = caps.length, N = NP + NK;

    /* ---------- partial inductances ---------- */
    const lxxMemo = new Map();
    function Lxx(p, q) {                                    // x-bar to x-bar, offset (p, q) cells
      p = Math.abs(p); q = Math.abs(q);
      const key = p * 100003 + q;
      let v = lxxMemo.get(key);
      if (v === undefined) { v = tapeM([0, d, 0, d], [p * d, (p + 1) * d, q * d, (q + 1) * d], 0); lxxMemo.set(key, v); }
      return v;
    }
    const Lyy = (p, q) => Lxx(q, p);
    // Mesh inductance on the corner grid: C^T L C, a second difference of the bar kernels.
    const KW = 2 * mx - 1, KT = new Float64Array(KW * (2 * my - 1));
    for (let q = -(my - 1); q <= my - 1; q++) for (let p = -(mx - 1); p <= mx - 1; p++) {
      KT[(p + mx - 1) + (q + my - 1) * KW] = 2 * Lxx(p, q) - Lxx(p, q + 1) - Lxx(p, q - 1) + 2 * Lyy(p, q) - Lyy(p + 1, q) - Lyy(p - 1, q);
    }
    const Kpsi = (p, q) => KT[(p + mx - 1) + (q + my - 1) * KW];
    const convPsi = convolver(mx, my, Kpsi);
    const convX = convolver(nx - 1, ny, Lxx), convY = convolver(nx, ny - 1, Lyy);

    // Bar-space L times a real or complex bar vector.
    function Lbar(vx, vy, vxi, vyi) {
      const ox = new Float64Array(NXB), oxi = new Float64Array(NXB), oy = new Float64Array(NYB), oyi = new Float64Array(NYB);
      convX(vx, vxi || new Float64Array(NXB), ox, oxi, [1, 0]);
      convY(vy, vyi || new Float64Array(NYB), oy, oyi, [1, 0]);
      return { x: ox, xi: oxi, y: oy, yi: oyi };
    }

    /* ---------- the trace ---------- */
    const route = o.route && o.route.length >= 2 ? o.route : [o.S, o.L];
    const segs = [];
    for (let k = 0; k + 1 < route.length; k++) {
      const a = route[k], b = route[k + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const alongX = Math.abs(b[1] - a[1]) < 1e-9;
      segs.push(alongX
        ? { ax: 'x', dir: Math.sign(b[0] - a[0]), s0: Math.min(a[0], b[0]), s1: Math.max(a[0], b[0]), c: a[1], len: Math.abs(b[0] - a[0]) }
        : { ax: 'y', dir: Math.sign(b[1] - a[1]), s0: Math.min(a[1], b[1]), s1: Math.max(a[1], b[1]), c: a[0], len: Math.abs(b[1] - a[1]) });
    }
    const Mx = new Float64Array(NXB), My = new Float64Array(NYB);
    segs.forEach((s) => {
      const tape = [s.s0, s.s1, s.c - w / 2, s.c + w / 2];
      if (s.ax === 'x') {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) Mx[xb(i, j)] += s.dir * tapeM([(i + 0.5) * d, (i + 1.5) * d, j * d, (j + 1) * d], tape, h);
      } else {
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) My[yb(i, j)] += s.dir * tapeM([(j + 0.5) * d, (j + 1.5) * d, i * d, (i + 1) * d], tape, h);
      }
    });
    let Ltrace = 0;
    segs.forEach((s) => segs.forEach((t) => {
      if (s.ax === t.ax) Ltrace += s.dir * t.dir * tapeM([s.s0, s.s1, s.c - w / 2, s.c + w / 2], [t.s0, t.s1, t.c - w / 2, t.c + w / 2], 0);
    }));
    const Dsl = Math.max(Math.hypot(o.L[0] - o.S[0], o.L[1] - o.S[1]), 2 * VIA.r);
    const Lvias = 2 * wireSelf(h, VIA.r) - 2 * wireMutual(h, Dsl);

    const LIp = Lbar(Ip.x, Ip.y);
    const LP = capPaths.map((p) => Lbar(p.x, p.y));

    /* ---------- operators ---------- */
    // Bar currents -> corner sums (C^T), then summed into the unknowns.
    function barsToCorners(vx, vxi, vy, vyi, outr, outi) {
      const add = (I, J, a, b) => { if (I > 0 && J > 0 && I < nx && J < ny) { const k = (I - 1) + (J - 1) * mx; outr[k] += a; outi[k] += b; } };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) {
        const k = xb(i, j), a = vx[k], b = vxi ? vxi[k] : 0;
        if (a === 0 && b === 0) continue;
        add(i + 1, j + 1, a, b); add(i + 1, j, -a, -b);
      }
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
        const k = yb(i, j), a = vy[k], b = vyi ? vyi[k] : 0;
        if (a === 0 && b === 0) continue;
        add(i, j + 1, a, b); add(i + 1, j + 1, -a, -b);
      }
    }
    function reduce(cr, ci, yr, yi) {                      // corner array -> unknowns (sum over each group)
      for (let k = 0; k < NC; k++) { const g = grp[k]; if (g >= 0) { yr[g] += cr[k]; yi[g] += ci[k]; } }
    }
    function expand(xr, xi, cr, ci) {
      for (let k = 0; k < NC; k++) { const g = grp[k]; if (g >= 0) { cr[k] = xr[g]; ci[k] = xi[g]; } else { cr[k] = 0; ci[k] = 0; } }
    }
    const dot = (vx, vy, px, py) => { let s = 0; for (let k = 0; k < NXB; k++) if (px[k]) s += px[k] * vx[k]; for (let k = 0; k < NYB; k++) if (py[k]) s += py[k] * vy[k]; return s; };

    /* The operator for one impedance setting:
         zd  per-square bar impedance [re, im]   lm  multiplier of L [re, im]   zc  capacitor impedance [re, im]
       A = B^T (zd + lm L) B + diag(zc) on [psi; capacitor currents]. */
    function operator(zd, lm, zc) {
      const cr = new Float64Array(NC), ci = new Float64Array(NC), tr = new Float64Array(NC), ti = new Float64Array(NC);
      // Capacitor columns: B_psi^T (zd p + lm L p), and the capacitor block.
      const col = capPaths.map((p, c) => {
        const vr = new Float64Array(NXB), vi = new Float64Array(NXB), wr = new Float64Array(NYB), wi = new Float64Array(NYB);
        for (let k = 0; k < NXB; k++) { vr[k] = zd[0] * p.x[k] + lm[0] * LP[c].x[k]; vi[k] = zd[1] * p.x[k] + lm[1] * LP[c].x[k]; }
        for (let k = 0; k < NYB; k++) { wr[k] = zd[0] * p.y[k] + lm[0] * LP[c].y[k]; wi[k] = zd[1] * p.y[k] + lm[1] * LP[c].y[k]; }
        const ar = new Float64Array(NC), ai = new Float64Array(NC), yr = new Float64Array(NP), yi = new Float64Array(NP);
        barsToCorners(vr, vi, wr, wi, ar, ai); reduce(ar, ai, yr, yi);
        return { r: yr, i: yi, vr, vi, wr, wi };
      });
      const Acc = [];
      for (let a = 0; a < NK; a++) {
        Acc.push([]);
        for (let b = 0; b < NK; b++) {
          const p = capPaths[a];
          let re = dot(col[b].vr, col[b].wr, p.x, p.y), im = dot(col[b].vi, col[b].wi, p.x, p.y);
          if (a === b) { re += zc[0]; im += zc[1]; }
          Acc[a].push([re, im]);
        }
      }
      function apply(xr, xi, yr, yi) {
        yr.fill(0); yi.fill(0);
        expand(xr, xi, cr, ci);
        tr.fill(0); ti.fill(0);
        // zd times the 5-point Laplacian (C^T C), edge corners at zero.
        for (let J = 0; J < my; J++) for (let I = 0; I < mx; I++) {
          const k = I + J * mx;
          let sr = 4 * cr[k], si = 4 * ci[k];
          if (I > 0) { sr -= cr[k - 1]; si -= ci[k - 1]; }
          if (I < mx - 1) { sr -= cr[k + 1]; si -= ci[k + 1]; }
          if (J > 0) { sr -= cr[k - mx]; si -= ci[k - mx]; }
          if (J < my - 1) { sr -= cr[k + mx]; si -= ci[k + mx]; }
          tr[k] = zd[0] * sr - zd[1] * si; ti[k] = zd[0] * si + zd[1] * sr;
        }
        if (lm[0] !== 0 || lm[1] !== 0) convPsi(cr, ci, tr, ti, lm);
        reduce(tr, ti, yr, yi);
        for (let c = 0; c < NK; c++) {
          const ur = xr[NP + c], ui = xi[NP + c], C = col[c];
          let sr = 0, si = 0;
          for (let g = 0; g < NP; g++) {
            yr[g] += C.r[g] * ur - C.i[g] * ui; yi[g] += C.r[g] * ui + C.i[g] * ur;
            sr += C.r[g] * xr[g] - C.i[g] * xi[g]; si += C.r[g] * xi[g] + C.i[g] * xr[g];
          }
          for (let b = 0; b < NK; b++) {
            const [ar, ai] = Acc[c][b];
            sr += ar * xr[NP + b] - ai * xi[NP + b]; si += ar * xi[NP + b] + ai * xr[NP + b];
          }
          yr[NP + c] = sr; yi[NP + c] = si;
        }
      }
      // B^T (zd v + lm L v) for a real bar vector v with its L v, as a right-hand side.
      function project(vx, vy, Lv, extra) {
        const ax = new Float64Array(NXB), axi = new Float64Array(NXB), ay = new Float64Array(NYB), ayi = new Float64Array(NYB);
        for (let k = 0; k < NXB; k++) {
          const l = Lv.x[k] + (extra ? extra.x[k] : 0);
          ax[k] = zd[0] * vx[k] + lm[0] * l; axi[k] = zd[1] * vx[k] + lm[1] * l;
        }
        for (let k = 0; k < NYB; k++) {
          const l = Lv.y[k] + (extra ? extra.y[k] : 0);
          ay[k] = zd[0] * vy[k] + lm[0] * l; ayi[k] = zd[1] * vy[k] + lm[1] * l;
        }
        const r = new Float64Array(N), i = new Float64Array(N);
        const kr = new Float64Array(NC), ki = new Float64Array(NC);
        barsToCorners(ax, axi, ay, ayi, kr, ki); reduce(kr, ki, r, i);
        capPaths.forEach((p, c) => { r[NP + c] = dot(ax, ay, p.x, p.y); i[NP + c] = dot(axi, ayi, p.x, p.y); });
        return { r, i };
      }
      return { apply, project, Acc };
    }

    /* ---------- preconditioner: the slot-free operator, diagonal in the sine basis ---------- */
    const Sx = dstMatrix(nx), Sy = dstMatrix(ny);
    // Symbol of the mesh inductance at each sine mode, by separable cosine sums.
    const Khat = new Float64Array(NC);
    {
      const T = new Float64Array((2 * mx - 1) * my);
      for (let p = -(mx - 1); p <= mx - 1; p++) for (let n = 0; n < my; n++) {
        const th = Math.PI * (n + 1) / ny;
        let s = 0;
        for (let q = -(my - 1); q <= my - 1; q++) s += Kpsi(p, q) * Math.cos(q * th);
        T[(p + mx - 1) + n * (2 * mx - 1)] = s;
      }
      for (let m = 0; m < mx; m++) {
        const th = Math.PI * (m + 1) / nx;
        for (let n = 0; n < my; n++) {
          let s = 0;
          for (let p = -(mx - 1); p <= mx - 1; p++) s += T[(p + mx - 1) + n * (2 * mx - 1)] * Math.cos(p * th);
          Khat[m + n * mx] = s;
        }
      }
    }
    const lapHat = new Float64Array(NC);
    for (let n = 0; n < my; n++) for (let m = 0; m < mx; m++) {
      lapHat[m + n * mx] = 4 - 2 * Math.cos(Math.PI * (m + 1) / nx) - 2 * Math.cos(Math.PI * (n + 1) / ny);
    }
    function dst2(ar, ai) {                                 // in place, a is mx x my
      const tr = new Float64Array(NC), ti = new Float64Array(NC);
      for (let J = 0; J < my; J++) for (let m = 0; m < mx; m++) {
        let sr = 0, si = 0; const row = m * mx;
        for (let I = 0; I < mx; I++) { const s = Sx[row + I]; sr += s * ar[I + J * mx]; si += s * ai[I + J * mx]; }
        tr[m + J * mx] = sr; ti[m + J * mx] = si;
      }
      for (let n = 0; n < my; n++) for (let m = 0; m < mx; m++) {
        let sr = 0, si = 0; const row = n * my;
        for (let J = 0; J < my; J++) { const s = Sy[row + J]; sr += s * tr[m + J * mx]; si += s * ti[m + J * mx]; }
        ar[m + n * mx] = sr; ai[m + n * mx] = si;
      }
    }
    function preconditioner(zd, lm, op) {
      const ir = new Float64Array(NC), ii = new Float64Array(NC);
      for (let k = 0; k < NC; k++) {
        const a = zd[0] * lapHat[k] + lm[0] * Khat[k], b = zd[1] * lapHat[k] + lm[1] * Khat[k], m2 = a * a + b * b;
        ir[k] = a / m2; ii[k] = -b / m2;
      }
      const cr = new Float64Array(NC), ci = new Float64Array(NC);
      return function (rr, ri, zr, zi) {
        for (let k = 0; k < NC; k++) { const g = grp[k]; if (g >= 0) { cr[k] = rr[g] / size[g]; ci[k] = ri[g] / size[g]; } else { cr[k] = 0; ci[k] = 0; } }
        dst2(cr, ci);
        for (let k = 0; k < NC; k++) { const a = cr[k], b = ci[k]; cr[k] = a * ir[k] - b * ii[k]; ci[k] = a * ii[k] + b * ir[k]; }
        dst2(cr, ci);
        zr.fill(0); zi.fill(0);
        for (let k = 0; k < NC; k++) { const g = grp[k]; if (g >= 0) { zr[g] += cr[k] / size[g]; zi[g] += ci[k] / size[g]; } }
        for (let c = 0; c < NK; c++) {
          const [a, b] = op.Acc[c][c], m2 = a * a + b * b;
          zr[NP + c] = (rr[NP + c] * a + ri[NP + c] * b) / m2; zi[NP + c] = (ri[NP + c] * a - rr[NP + c] * b) / m2;
        }
      };
    }

    /* Conjugate-orthogonal CG for a complex symmetric A (bilinear, not Hermitian, products). */
    function cocg(op, M, br, bi, x0, tol, maxIt) {
      const xr = x0 ? Float64Array.from(x0.r) : new Float64Array(N), xi = x0 ? Float64Array.from(x0.i) : new Float64Array(N);
      const rr = new Float64Array(N), ri = new Float64Array(N), zr = new Float64Array(N), zi = new Float64Array(N);
      const pr = new Float64Array(N), pi = new Float64Array(N), qr = new Float64Array(N), qi = new Float64Array(N);
      op.apply(xr, xi, qr, qi);
      let bn = 0;
      for (let k = 0; k < N; k++) { rr[k] = br[k] - qr[k]; ri[k] = bi[k] - qi[k]; bn += br[k] * br[k] + bi[k] * bi[k]; }
      bn = Math.sqrt(bn) || 1;
      M(rr, ri, zr, zi);
      pr.set(zr); pi.set(zi);
      let rhoR = 0, rhoI = 0;
      for (let k = 0; k < N; k++) { rhoR += rr[k] * zr[k] - ri[k] * zi[k]; rhoI += rr[k] * zi[k] + ri[k] * zr[k]; }
      let it = 0, res = 1;
      for (; it < maxIt; it++) {
        let rn = 0;
        for (let k = 0; k < N; k++) rn += rr[k] * rr[k] + ri[k] * ri[k];
        res = Math.sqrt(rn) / bn;
        if (res < tol) break;
        op.apply(pr, pi, qr, qi);
        let dR = 0, dI = 0;
        for (let k = 0; k < N; k++) { dR += pr[k] * qr[k] - pi[k] * qi[k]; dI += pr[k] * qi[k] + pi[k] * qr[k]; }
        const m2 = dR * dR + dI * dI;
        if (!(m2 > 0)) break;
        const aR = (rhoR * dR + rhoI * dI) / m2, aI = (rhoI * dR - rhoR * dI) / m2;
        for (let k = 0; k < N; k++) {
          xr[k] += aR * pr[k] - aI * pi[k]; xi[k] += aR * pi[k] + aI * pr[k];
          rr[k] -= aR * qr[k] - aI * qi[k]; ri[k] -= aR * qi[k] + aI * qr[k];
        }
        M(rr, ri, zr, zi);
        let nR = 0, nI = 0;
        for (let k = 0; k < N; k++) { nR += rr[k] * zr[k] - ri[k] * zi[k]; nI += rr[k] * zi[k] + ri[k] * zr[k]; }
        const r2 = rhoR * rhoR + rhoI * rhoI;
        const bR = (nR * rhoR + nI * rhoI) / r2, bI = (nI * rhoR - nR * rhoI) / r2;
        for (let k = 0; k < N; k++) {
          const a = pr[k], b = pi[k];
          pr[k] = zr[k] + bR * a - bI * b; pi[k] = zi[k] + bR * b + bI * a;
        }
        rhoR = nR; rhoI = nI;
      }
      return { r: xr, i: xi, iters: it, res };
    }

    /* ---------- bar currents, fields, impedance ---------- */
    function bars(x, It) {
      const t = It === undefined ? 1 : It;
      const ix = new Float64Array(NXB), ixi = new Float64Array(NXB), iy = new Float64Array(NYB), iyi = new Float64Array(NYB);
      const cr = new Float64Array(NC), ci = new Float64Array(NC);
      expand(x.r, x.i, cr, ci);
      const ps = (I, J, a) => (I <= 0 || J <= 0 || I >= nx || J >= ny ? 0 : a[(I - 1) + (J - 1) * mx]);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) {
        const k = xb(i, j);
        ix[k] = t * Ip.x[k] + ps(i + 1, j + 1, cr) - ps(i + 1, j, cr);
        ixi[k] = ps(i + 1, j + 1, ci) - ps(i + 1, j, ci);
      }
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
        const k = yb(i, j);
        iy[k] = t * Ip.y[k] + ps(i, j + 1, cr) - ps(i + 1, j + 1, cr);
        iyi[k] = ps(i, j + 1, ci) - ps(i + 1, j + 1, ci);
      }
      capPaths.forEach((p, c) => {
        const ur = x.r[NP + c], ui = x.i[NP + c];
        for (let k = 0; k < NXB; k++) if (p.x[k]) { ix[k] += p.x[k] * ur; ixi[k] += p.x[k] * ui; }
        for (let k = 0; k < NYB; k++) if (p.y[k]) { iy[k] += p.y[k] * ur; iyi[k] += p.y[k] * ui; }
      });
      return { x: ix, xi: ixi, y: iy, yi: iyi, cap: caps.map((_, c) => [x.r[NP + c], x.i[NP + c]]) };
    }

    /* Loop impedance by Tellegen's theorem, a bilinear sum over every branch, and the
       return-path resistance by power, sum R |I|^2. The two agree only if the currents
       satisfy KVL, so their agreement measures the solve. */
    function impedance(I, zd, lm, zc) {
      const LI = Lbar(I.x, I.y, I.xi, I.yi);
      let sr = 0, si = 0, pw = 0;
      const acc = (a, b, lr, li, m) => {                    // I (zd I + lm (L I + M))
        const vr = zd[0] * a - zd[1] * b + lm[0] * (lr + m) - lm[1] * li;
        const vi = zd[0] * b + zd[1] * a + lm[0] * li + lm[1] * (lr + m);
        sr += a * vr - b * vi; si += a * vi + b * vr;
        pw += zd[0] * (a * a + b * b);
      };
      for (let k = 0; k < NXB; k++) acc(I.x[k], I.xi[k], LI.x[k], LI.xi[k], Mx[k]);
      for (let k = 0; k < NYB; k++) acc(I.y[k], I.yi[k], LI.y[k], LI.yi[k], My[k]);
      // The trace's own branch: lm (Ltrace + vias + M . I).
      let mr = 0, mi = 0;
      for (let k = 0; k < NXB; k++) { mr += Mx[k] * I.x[k]; mi += Mx[k] * I.xi[k]; }
      for (let k = 0; k < NYB; k++) { mr += My[k] * I.y[k]; mi += My[k] * I.yi[k]; }
      const lt = Ltrace + Lvias + mr;
      sr += lm[0] * lt - lm[1] * mi; si += lm[0] * mi + lm[1] * lt;
      I.cap.forEach(([a, b]) => {
        sr += zc[0] * (a * a - b * b) - zc[1] * 2 * a * b; si += zc[1] * (a * a - b * b) + zc[0] * 2 * a * b;
        pw += zc[0] * (a * a + b * b);
      });
      return { r: sr, i: si, power: pw };
    }

    /* Share of the return flowing within +-half mm of the trace (2 mm by default), across
       a cut through the middle of the longest segment, in phase with the trace current.
       Each cell counts by the part of its width inside the band. */
    const main = segs.reduce((a, s) => (!a || s.len > a.len ? s : a), null);
    function share(I, half) {
      if (!main) return { band: 0, total: 0 };
      const hw = half === undefined ? 2 : half, mid = (main.s0 + main.s1) / 2;
      const part = (c) => Math.max(0, Math.min(c + d / 2, main.c + hw) - Math.max(c - d / 2, main.c - hw)) / d;
      let band = 0, total = 0;
      /* The cut goes through the middle of the run, or the nearest place to it where
         there is copper under the trace: across a slot nothing flows to count. */
      const under = (k) => (main.ax === 'x' ? isCu(k, Math.floor(main.c / d)) && isCu(k + 1, Math.floor(main.c / d))
        : isCu(Math.floor(main.c / d), k) && isCu(Math.floor(main.c / d), k + 1));
      let k0 = Math.round(mid / d - 1);
      for (let dk = 0; dk < 200; dk++) {
        if (k0 + dk >= 0 && under(k0 + dk) && (k0 + dk + 1) * d < main.s1) { k0 += dk; break; }
        if (k0 - dk >= 0 && under(k0 - dk) && (k0 - dk + 1) * d > main.s0) { k0 -= dk; break; }
      }
      if (main.ax === 'x') {
        const i = Math.max(0, Math.min(nx - 2, k0));
        for (let j = 0; j < ny; j++) { const v = -main.dir * I.x[xb(i, j)]; total += v; band += v * part((j + 0.5) * d); }
      } else {
        const j = Math.max(0, Math.min(ny - 2, k0));
        for (let i = 0; i < nx; i++) { const v = -main.dir * I.y[yb(i, j)]; total += v; band += v * part((i + 0.5) * d); }
      }
      return { band, total };
    }

    // Sheet current at cell centres, A/m per ampere of trace current.
    function field(I) {
      const n = nx * ny, jx = new Float64Array(n), jxi = new Float64Array(n), jy = new Float64Array(n), jyi = new Float64Array(n);
      const s = 1 / (d * 1e-3);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        if (!cu[k]) continue;
        const l = i > 0 ? xb(i - 1, j) : -1, r = i < nx - 1 ? xb(i, j) : -1;
        const nl = (l >= 0) + (r >= 0);
        jx[k] = s * ((l >= 0 ? I.x[l] : 0) + (r >= 0 ? I.x[r] : 0)) / (nl || 1);
        jxi[k] = s * ((l >= 0 ? I.xi[l] : 0) + (r >= 0 ? I.xi[r] : 0)) / (nl || 1);
        const b = j > 0 ? yb(i, j - 1) : -1, t = j < ny - 1 ? yb(i, j) : -1;
        const nb = (b >= 0) + (t >= 0);
        jy[k] = s * ((b >= 0 ? I.y[b] : 0) + (t >= 0 ? I.y[t] : 0)) / (nb || 1);
        jyi[k] = s * ((b >= 0 ? I.yi[b] : 0) + (t >= 0 ? I.yi[t] : 0)) / (nb || 1);
      }
      return { jx, jxi, jy, jyi };
    }

    const TOL = 1e-7, MAXIT = 600;
    const capZ = (f) => { const wv = 2 * Math.PI * f; return [CAP.R, wv * CAP.L - 1 / (wv * CAP.C)]; };

    /* A sine of frequency f, Hz, with a unit trace current. */
    function solveFreq(f, x0) {
      const wv = 2 * Math.PI * f, zd = zSurface(f), lm = [0, wv], zc = capZ(f);
      const op = operator(zd, lm, zc), M = preconditioner(zd, lm, op);
      const rhs = op.project(Ip.x, Ip.y, LIp, { x: Mx, y: My });
      for (let k = 0; k < N; k++) { rhs.r[k] = -rhs.r[k]; rhs.i[k] = -rhs.i[k]; }
      const x = cocg(op, M, rhs.r, rhs.i, x0, TOL, MAXIT);
      const I = bars(x);
      const Z = impedance(I, zd, lm, zc), sh = share(I);
      return { f, x, I, Z: [Z.r, Z.i], L: Z.i / wv, R: Z.r, Rpower: Z.power, share: sh.band, crossing: sh.total, iters: x.iters, res: x.res };
    }

    /* The step response: t = 0+ is the inductive limit (the plane a perfect conductor
       to a sudden change); then backward Euler with the DC sheet resistance. */
    function inductive() {
      const zd = [0, 0], lm = [1, 0], zc = [CAP.L, 0];
      const op = operator(zd, lm, zc), M = preconditioner([RS * 1e-9, 0], lm, op);
      const rhs = op.project(Ip.x, Ip.y, LIp, { x: Mx, y: My });
      for (let k = 0; k < N; k++) { rhs.r[k] = -rhs.r[k]; rhs.i[k] = -rhs.i[k]; }
      const x = cocg(op, M, rhs.r, rhs.i, null, TOL, MAXIT);
      return { t: 0, x, q: new Float64Array(NK), iters: x.iters, res: x.res };
    }
    function stepFrom(state, t1) {
      const dt = t1 - state.t, zd = [RS, 0], lm = [1 / dt, 0];
      const zc = [CAP.R + CAP.L / dt + dt / CAP.C, 0];
      const op = operator(zd, lm, zc), M = preconditioner(zd, lm, op);
      // RHS: (B^T L B / dt) x_n + caps (L/dt) i_n - B^T Rs I_p - q_n / C
      const opL = operator([0, 0], lm, [CAP.L / dt, 0]);
      const br = new Float64Array(N), bi = new Float64Array(N);
      opL.apply(state.x.r, state.x.i, br, bi);
      const rp = op.project(Ip.x, Ip.y, { x: new Float64Array(NXB), y: new Float64Array(NYB) }, null);
      for (let k = 0; k < N; k++) br[k] -= rp.r[k];
      for (let c = 0; c < NK; c++) br[NP + c] -= state.q[c] / CAP.C;
      bi.fill(0);
      const x = cocg(op, M, br, bi, state.x, TOL, MAXIT);
      const q = Float64Array.from(state.q);
      for (let c = 0; c < NK; c++) q[c] += dt * x.r[NP + c];
      return { t: t1, x, q, iters: x.iters, res: x.res };
    }
    function stepInfo(state) {
      const I = bars(state.x), sh = share(I);
      return { t: state.t, I, share: sh.band, crossing: sh.total };
    }

    /* DC: resistive only, capacitors open. */
    function dc() {
      const zd = [RS, 0], lm = [0, 0], zc = [1e12, 0];
      const op = operator(zd, lm, zc), M = preconditioner(zd, [1e-30, 0], op);
      const rhs = op.project(Ip.x, Ip.y, LIp, null);
      for (let k = 0; k < N; k++) { rhs.r[k] = -rhs.r[k]; rhs.i[k] = -rhs.i[k]; }
      const x = cocg(op, M, rhs.r, rhs.i, null, TOL, MAXIT);
      const I = bars(x), Z = impedance(I, zd, [0, 0], zc), sh = share(I);
      return { x, I, R: Z.r, Rpower: Z.power, share: sh.band, crossing: sh.total, iters: x.iters, res: x.res };
    }

    return {
      nx, ny, d, h, cu, caps, segs, route, cS, cL, N, NP, Ltrace, Lvias,
      solveFreq, inductive, stepFrom, stepInfo, dc, field, share, bars
    };
  }

  /* Frequencies of the sweep: the E6 series, 10 Hz to 100 MHz. */
  const E6 = [1, 1.5, 2.2, 3.3, 4.7, 6.8];
  const SWEEP = [];
  for (let e = 1; e < 8; e++) E6.forEach((m) => SWEEP.push(+(m * Math.pow(10, e)).toPrecision(2)));
  SWEEP.push(1e8);
  // Times of the step: 10 ns to 10 ms, four per factor of ten.
  const TIMES = [];
  for (let e = -8; e < -2; e++) [1, 1.8, 3.2, 5.6].forEach((m) => TIMES.push(+(m * Math.pow(10, e)).toPrecision(2)));
  TIMES.push(1e-2);

  NS.models.returnPath = {
    BOARD, COPPER, RS, TRACE, VIA, CAP, HEIGHTS, SWEEP, TIMES, MU0,
    create, slotCells, cellOf, tapeM, wireSelf, wireMutual, zSurface, F
  };
})();
