/* SI & PI — models/cross-section-model.js
 * A two-dimensional field solver for a trace cross-section, small enough to watch.
 *
 * The quasi-TEM recipe every 2D solver follows: solve Laplace's equation for the
 * potential around the conductors twice, once with the real dielectric and once
 * with air everywhere, and take the capacitance per unit length from each.
 *
 *   div(eps grad phi) = 0,   phi = V on the trace, 0 on the planes and the box
 *   C = 2 W / V^2,  W = (1/2) integral of eps |grad phi|^2
 *   Z0 = 1 / (c sqrt(C C_air)),   eps_eff = C / C_air,   L = 1 / (c^2 C_air)
 *
 * Discretisation: bilinear finite elements on a tensor-product mesh, graded from
 * fine at the conductor edges (where the field is singular) to coarse far away.
 * The finite-element energy is never below the true minimum, so the solved C can
 * only fall, and Z0 only rise, as the mesh is refined: a convergence ladder of
 * a few meshes shows the answer settling and lets it be extrapolated.
 *
 * Only half the structure is solved: the mirror plane x = 0 is a natural (zero
 * normal field) boundary for a single trace and for the even mode of a pair, and
 * phi = 0 for the odd mode. The solve is a direct banded Cholesky factorisation.
 * Lengths in mils at the interface. Pure: no DOM.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  NS.models = NS.models || {};

  const EPS0 = 8.8541878128e-12, C0 = 299792458, MIL = 25.4e-6;
  const LEVELS = [2, 3, 4, 6, 8, 12, 16];                 // mesh density: cells across the narrowest feature
  const DEFAULTS = { type: 'ms', pair: false, mode: 'odd', w: 5.5, h: 3.5, t: 1.4, s: 6, er: 4.2, n: 8, box: 40 };

  /* Mesh lines on [a, b]: steps of sa at a and sb at b, growing by r toward the middle. */
  function fill(a, b, sa, sb, r) {
    const L = b - a;
    if (L <= 0) return [a];
    const left = [0], right = [0];
    let x = 0, y = 0, da = sa, db = sb;
    while (x + y + Math.min(da, db) < L) {
      if (da <= db) { x += da; left.push(x); da *= r; } else { y += db; right.push(y); db *= r; }
    }
    // Close the gap evenly: stretch the two runs to meet.
    const k = L / (x + y || 1);
    const pts = left.map((v) => a + v * k);
    for (let i = right.length - 1; i >= 0; i--) pts.push(b - right[i] * k);
    const out = [];
    pts.sort((p, q) => p - q).forEach((p) => { if (!out.length || p - out[out.length - 1] > 1e-9 * (Math.abs(L) + 1)) out.push(p); });
    if (out[out.length - 1] < b - 1e-12) out.push(b); else out[out.length - 1] = b;
    out[0] = a;
    return out;
  }
  function lines(keys, r) {                                // keys: [[coordinate, fine step], ...] sorted; r the growth
    let out = [];
    for (let i = 0; i + 1 < keys.length; i++) {
      const seg = fill(keys[i][0], keys[i + 1][0], keys[i][1], keys[i + 1][1], r || 1.3);
      out = out.concat(i ? seg.slice(1) : seg);
    }
    return out;
  }

  /* The geometry, half of it: x >= 0. Returns the trace rectangles and mesh keys. */
  function geometry(p) {
    const w = p.w, h = p.h, t = p.t, s = p.s;
    const x1 = p.pair ? s / 2 : 0, x2 = p.pair ? s / 2 + w : w / 2;
    const yb = h, yt = h + t;                               // trace bottom and top
    const top = p.type === 'sl' ? 2 * h + t : null;         // the upper plane of a stripline
    const reach = p.box * h;                                // the box walls, this far from the copper
    const X = x2 + reach, Y = p.type === 'sl' ? top : yt + reach;
    return { x1, x2, yb, yt, top, X, Y, w, h, t };
  }

  function solve(p, n, air) {
    const g = geometry(p), d = Math.min(p.w, p.h, p.pair ? p.s : Infinity) / n;
    /* Finest at the conductor edges, where the field is singular: the edge step shrinks as
       1/n^2. The near field, out to 3h, refines as 1/n; beyond it the mesh grows freely. */
    const fine = d / n, mid = 1.5 * d, far = Math.max(4 * mid, p.h);
    const kx = [[0, p.pair ? fine : mid]];
    if (p.pair) kx.push([g.x1, fine]);
    kx.push([g.x2, fine]);
    if (g.x2 + 3 * p.h < g.X - 2 * mid) kx.push([g.x2 + 3 * p.h, mid]);
    kx.push([g.X, Math.max(mid, Math.min(far, (g.X - g.x2) / 3), g.X / 12)]);
    const ky = [[0, mid]];
    if (g.t > 0) ky.push([g.yb, fine], [g.yt, fine]); else ky.push([g.yb, fine]);
    if (g.top !== null) ky.push([g.top, mid]);
    else {
      if (g.yt + 3 * p.h < g.Y - 2 * mid) ky.push([g.yt + 3 * p.h, mid]);
      ky.push([g.Y, Math.max(mid, Math.min(far, (g.Y - g.yt) / 3), g.Y / 12)]);
    }
    // Refining means smaller cells and gentler growth between them: both are needed to converge.
    const grow = 1 + Math.min(0.5, 2 / n);
    const xs = lines(kx, grow), ys = lines(ky, grow);
    const nx = xs.length, ny = ys.length, N = nx * ny;

    const tol = 1e-9 * (g.X + g.Y);
    const onTrace = (x, y) => x >= g.x1 - tol && x <= g.x2 + tol && y >= g.yb - tol && y <= g.yt + tol;
    const V = new Float64Array(N), fixed = new Uint8Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx, x = xs[i], y = ys[j];
      if (j === 0 || j === ny - 1 || i === nx - 1) fixed[k] = 1;                 // planes and box: 0 V
      else if (onTrace(x, y)) { fixed[k] = 1; V[k] = 1; }
      else if (i === 0 && p.pair && p.mode === 'odd') fixed[k] = 1;            // the odd-mode mirror: 0 V
    }
    // Dielectric per element: below the trace top for a microstrip (the trace sits on it), everywhere in a stripline.
    const epsOf = (yc) => (air ? 1 : p.type === 'sl' ? p.er : yc < g.yb ? p.er : 1);

    // Unknowns numbered along the shorter side of the mesh, so the band is as narrow as it can be.
    const id = new Int32Array(N).fill(-1);
    let nf = 0;
    if (nx <= ny) { for (let k = 0; k < N; k++) if (!fixed[k]) id[k] = nf++; }
    else for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const k = i + j * nx; if (!fixed[k]) id[k] = nf++; }
    const bw = Math.min(nx, ny) + 1, A = new Float64Array(nf * (bw + 1)), rhs = new Float64Array(nf);
    const at = (r, c) => r * (bw + 1) + (r - c);           // lower band, r >= c
    const KA = [[2, -2, -1, 1], [-2, 2, 1, -1], [-1, 1, 2, -2], [1, -1, -2, 2]];
    const KB = [[2, 1, -1, -2], [1, 2, -2, -1], [-1, -2, 2, 1], [-2, -1, 1, 2]];
    const elems = [];
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = xs[i + 1] - xs[i], b = ys[j + 1] - ys[j], xc = (xs[i] + xs[i + 1]) / 2, yc = (ys[j] + ys[j + 1]) / 2;
      if (onTrace(xc, yc) && g.t > 0) continue;            // inside the copper: no field
      const e = epsOf(yc), nodes = [i + j * nx, i + 1 + j * nx, i + 1 + (j + 1) * nx, i + (j + 1) * nx];
      elems.push([nodes, e, b / a, a / b]);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const v = e / 6 * ((b / a) * KA[r][c] + (a / b) * KB[r][c]);
        const R = id[nodes[r]], Cc = id[nodes[c]];
        if (R < 0) continue;
        if (Cc < 0) { rhs[R] -= v * V[nodes[c]]; continue; }
        if (R >= Cc) A[at(R, Cc)] += v;
      }
    }
    // Banded Cholesky, in place, then the two triangular solves.
    for (let r = 0; r < nf; r++) {
      const c0 = Math.max(0, r - bw);
      for (let c = c0; c <= r; c++) {
        let s = A[at(r, c)];
        const k0 = Math.max(c0, c - bw);
        for (let k = k0; k < c; k++) s -= A[at(r, k)] * A[at(c, k)];
        if (c === r) A[at(r, r)] = Math.sqrt(Math.max(s, 1e-300));
        else A[at(r, c)] = s / A[at(c, c)];
      }
    }
    const z = new Float64Array(nf);
    for (let r = 0; r < nf; r++) {
      let s = rhs[r];
      for (let k = Math.max(0, r - bw); k < r; k++) s -= A[at(r, k)] * z[k];
      z[r] = s / A[at(r, r)];
    }
    for (let r = nf - 1; r >= 0; r--) {
      let s = z[r];
      for (let k = r + 1; k <= Math.min(nf - 1, r + bw); k++) s -= A[at(k, r)] * z[k];
      z[r] = s / A[at(r, r)];
    }
    const phi = Float64Array.from(V);
    for (let k = 0; k < N; k++) if (id[k] >= 0) phi[k] = z[id[k]];

    // Field energy of the half, per unit eps0: W = (1/2) phi^T K phi.
    let W = 0;
    elems.forEach(([nd, e, ba, ab]) => {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) W += 0.5 * phi[nd[r]] * phi[nd[c]] * e / 6 * (ba * KA[r][c] + ab * KB[r][c]);
    });
    // A single trace is split by the mirror: C = 2 W_full = 4 W_half. A trace of a pair, per mode: C = W_full = 2 W_half.
    const C = (p.pair ? 2 : 4) * W * EPS0;                 // F/m
    return { xs, ys, nx, ny, phi, C, nodes: N, g };
  }

  /* A full answer at one mesh: both solves, and the line parameters. */
  function line(p, n) {
    const q = Object.assign({}, DEFAULTS, p);
    const d = solve(q, n || q.n, false), a = solve(q, n || q.n, true);
    const z = 1 / (C0 * Math.sqrt(d.C * a.C)), eeff = d.C / a.C;
    return { z, eeff, C: d.C, Cair: a.C, L: 1 / (C0 * C0 * a.C), nodes: d.nodes, field: d, params: q };
  }

  /* The convergence ladder: Z0 at every mesh up to the finest asked for, and an
     estimate of the limit by Aitken's delta-squared on the meshes that double, 4, 8
     and 16 cells, which needs no assumption about the order of convergence. */
  function ladder(p, upTo) {
    const out = [];
    for (const n of LEVELS) { if (n > upTo) break; out.push(Object.assign({ n }, line(p, n))); }
    return { rungs: out, limit: limitOf(out) };
  }
  function limitOf(rungs) {
    const pick = [4, 8, 16].map((n) => rungs.find((r) => r.n === n));
    let limit = null;
    if (pick.every(Boolean)) {
      const [a, b, c] = pick.map((r) => r.z), den = (c - b) - (b - a);
      limit = Math.abs(den) > 1e-12 ? c - (c - b) * (c - b) / den : c;
      if (!(Math.abs(limit - c) < Math.abs(c - a) * 3)) limit = c;   // a sequence that is not settling has no limit to report
    }
    return limit;
  }

  /* Field lines of D, started on the trace surface at equal steps of charge, so that
     their density is the surface charge. Returns polylines in mils, for the half. */
  function fieldLines(f, count) {
    const { xs, ys, nx, ny, phi, g } = f;
    const cell = (v, arr) => { let lo = 0, hi = arr.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; };
    function grad(x, y) {
      const i = cell(x, xs), j = cell(y, ys), a = xs[i + 1] - xs[i], b = ys[j + 1] - ys[j];
      const u = (x - xs[i]) / a, v = (y - ys[j]) / b, k = i + j * nx;
      const p00 = phi[k], p10 = phi[k + 1], p01 = phi[k + nx], p11 = phi[k + nx + 1];
      return [((1 - v) * (p10 - p00) + v * (p11 - p01)) / a, ((1 - u) * (p01 - p00) + u * (p11 - p10)) / b];
    }
    // Seeds around the outside of the trace, by the normal field just outside it.
    const per = [], eps = 1e-3 * Math.min(g.w, g.h);
    const edges = [];
    const N = 400;
    for (let k = 0; k < N; k++) {                          // top, outer side, bottom, (inner side for a pair)
      const u = (k + 0.5) / N;
      edges.push(['top', g.x1 + u * (g.x2 - g.x1), g.yt + eps, 0, 1, (g.x2 - g.x1) / N]);
      edges.push(['bottom', g.x1 + u * (g.x2 - g.x1), g.yb - eps, 0, -1, (g.x2 - g.x1) / N]);
      if (g.t > 0) {
        edges.push(['out', g.x2 + eps, g.yb + u * g.t, 1, 0, g.t / N]);
        if (g.x1 > 0) edges.push(['in', g.x1 - eps, g.yb + u * g.t, -1, 0, g.t / N]);
      }
    }
    let total = 0;
    edges.forEach((e) => { const [gx, gy] = grad(e[1], e[2]); const q = Math.max(0, -(gx * e[3] + gy * e[4])) * e[5]; per.push(q); total += q; });
    const seeds = [];
    let acc = 0, next = total / count / 2;
    edges.forEach((e, k) => { acc += per[k]; while (acc >= next && seeds.length < count) { seeds.push([e[1], e[2]]); next += total / count; } });
    // Follow -grad phi with a step that scales with the local mesh.
    return seeds.map(([x0, y0]) => {
      const pts = [[x0, y0]];
      let x = x0, y = y0;
      for (let s = 0; s < 1500; s++) {
        const [gx, gy] = grad(x, y), m = Math.hypot(gx, gy);
        if (!(m > 1e-12)) break;
        const i = cell(x, xs), j = cell(y, ys);
        const step = 0.35 * Math.min(xs[i + 1] - xs[i], ys[j + 1] - ys[j]);
        x -= step * gx / m; y -= step * gy / m;
        if (x < 0) x = -x;                                   // reflect at the mirror plane
        if (y <= 0 || x >= g.X || y >= g.Y || (g.top !== null && y >= g.top)) { pts.push([Math.max(0, Math.min(g.X, x)), Math.max(0, Math.min(g.Y, y))]); break; }
        pts.push([x, y]);
        if (x >= g.x1 && x <= g.x2 && y >= g.yb && y <= g.yt && s > 3) break;
      }
      return pts;
    });
  }

  NS.models.crossSection = { DEFAULTS, LEVELS, EPS0, C0, MIL, solve, line, ladder, limitOf, fieldLines, geometry, lines };
})();
