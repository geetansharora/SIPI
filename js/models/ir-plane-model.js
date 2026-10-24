/* SI & PI — models/ir-plane-model.js
 * DC current in a power plane under a BGA, and what antipads do to it.
 *
 * The plane is a sheet of copper fed along one edge by the regulator. Under the
 * BGA it is pierced by a square array of vias at 1 mm pitch. The ground and
 * signal vias pass through it in clearance holes (antipads); the power vias
 * connect to it, and each carries its share of the load current down a plated
 * barrel and a solder ball to the package, which ties them together.
 *
 * Nothing about how the current divides is assumed. The sheet is a grid of
 * square cells, and the conductance between two neighbouring cells is the
 * copper actually present on the face they share, computed exactly against the
 * circles of the antipads (a cut-cell finite-volume scheme), so a neck between
 * two holes narrower than a cell still has the right width. A power via's pad
 * is one equipotential node. The package is one more node, drawing the load
 * current. Kirchhoff's current law at every node gives a symmetric positive-
 * definite system, solved by conjugate gradients, preconditioned by an incomplete Cholesky factor.
 *
 *   every cell     sum over its faces of g (V_k - V_neighbour) = 0
 *   a face         g = (rho / t)^-1 * copper length on the face / cell size
 *   a power via    g = 1 / (R_barrel + R_ball) to the package node
 *   the package    draws I
 *
 * Lengths in mm at the interface, SI inside. Pure: no DOM.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  NS.models = NS.models || {};

  const COPPER = { rho: 1.72e-8, oz: 34.8e-6 };            // ohm m; 1 oz/ft^2 of copper is 34.8 um thick
  const SOLDER = { rho: 1.3e-7 };                         // SAC305, ohm m
  const PITCH = 1.0, NBALL = 10;                          // mm; a 10 x 10 corner of the array
  const BOARD = { a: 20, b: 11.8, d: 0.2 };               // mm; feed along x = 0; cell size
  const X0 = 9.6, Y0 = 1.4;                               // the first ball, mm: every ball row and column is a cell face
  const PAD = 0.25;                                       // power via pad radius, mm
  const BARREL = { drill: 0.25, plating: 25e-6, length: 1.0e-3 };
  const BALL = { d: 0.45e-3, h: 0.4e-3 };                 // a cylinder standing in for the collapsed ball

  /* Barrel: a plated tube, R = rho L / (pi (D - t) t). Ball: rho h / area. */
  const R_BARREL = COPPER.rho * BARREL.length / (Math.PI * (BARREL.drill * 1e-3 - BARREL.plating) * BARREL.plating);
  const R_BALL = SOLDER.rho * BALL.h / (Math.PI * BALL.d * BALL.d / 4);

  /* The pin map: a 6 x 6 core of alternating power and ground, two rings of
     signal and ground around it. 'p' power (connected), 'g' ground and 's' signal
     (antipad), '.' no via. Row 0 is the bottom. */
  function defaultMap() {
    const m = [];
    for (let j = 0; j < NBALL; j++) {
      const row = [];
      for (let i = 0; i < NBALL; i++) {
        const core = i >= 2 && i <= 7 && j >= 2 && j <= 7;
        row.push(core ? ((i + j) % 2 === 0 ? 'p' : 'g') : ((i + j) % 2 === 0 ? 's' : 'g'));
      }
      m.push(row.join(''));
    }
    return m;
  }
  const site = (i, j) => [X0 + i * PITCH, Y0 + j * PITCH];

  /* Length of [a, b] on a line that lies inside any of the circles: the chords,
     merged so that overlapping antipads are not counted twice. */
  function blocked(a, b, chords) {
    if (!chords.length) return 0;
    chords.sort((u, v) => u[0] - v[0]);
    let len = 0, lo = -Infinity, hi = -Infinity;
    for (const [c0, c1] of chords) {
      const s = Math.max(c0, a), e = Math.min(c1, b);
      if (e <= s) continue;
      if (s > hi) { if (hi > lo) len += hi - lo; lo = s; hi = e; } else hi = Math.max(hi, e);
    }
    if (hi > lo) len += hi - lo;
    return len;
  }

  /* opts: { d antipad diameter mm, I amps, oz copper weight, map, cell mm,
     rVia ohm per via path (default barrel + ball), drainEdge: the far edge is
     the sink instead of the vias, a plain strip for testing } */
  function create(opts) {
    const o = Object.assign({ d: 0.7, I: 20, oz: 1, map: defaultMap(), cell: BOARD.d, rVia: R_BARREL + R_BALL, a: BOARD.a, b: BOARD.b, holes: null }, opts || {});
    const h = o.cell, nx = Math.round(o.a / h), ny = Math.round(o.b / h);
    const t = o.oz * COPPER.oz, gs = t / COPPER.rho;     // sheet conductance, S per square
    const r = o.d / 2;

    // Holes and pads from the map (or an explicit list of holes, for tests).
    const holes = [], vias = [];
    if (o.holes) o.holes.forEach((q) => holes.push(q));
    else for (let j = 0; j < NBALL; j++) for (let i = 0; i < NBALL; i++) {
      const c = o.map[j][i], [x, y] = site(i, j);
      if ((c === 'g' || c === 's') && r > 0) holes.push([x, y, r, i, j]);
      else if (c === 'p') vias.push({ x, y, i, j });
    }
    const near = (x0, x1, y0, y1) => holes.filter((q) => q[0] + q[2] > x0 && q[0] - q[2] < x1 && q[1] + q[2] > y0 && q[1] - q[2] < y1);
    const chordsX = (y, x0, x1) => near(x0, x1, y, y).filter((q) => Math.abs(y - q[1]) < q[2])
      .map((q) => { const w = Math.sqrt(q[2] * q[2] - (y - q[1]) * (y - q[1])); return [q[0] - w, q[0] + w]; });
    const chordsY = (x, y0, y1) => near(x, x, y0, y1).filter((q) => Math.abs(x - q[0]) < q[2])
      .map((q) => { const w = Math.sqrt(q[2] * q[2] - (x - q[0]) * (x - q[0])); return [q[1] - w, q[1] + w]; });

    // Copper fraction of every vertical face (between cell i and i+1) and horizontal face.
    const fx = new Float64Array((nx - 1) * ny), fy = new Float64Array(nx * (ny - 1));
    for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const x = (i + 1) * h, y0 = j * h, y1 = y0 + h;
      fx[i + j * (nx - 1)] = 1 - blocked(y0, y1, chordsY(x, y0, y1)) / h;
    }
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i < nx; i++) {
      const y = (j + 1) * h, x0 = i * h, x1 = x0 + h;
      fy[i + j * nx] = 1 - blocked(x0, x1, chordsX(y, x0, x1)) / h;
    }
    // A face with less than a micron of copper is a rounding error where two antipads touch, not a conductor.
    for (let m = 0; m < fx.length; m++) if (fx[m] < 0.01) fx[m] = 0;
    for (let m = 0; m < fy.length; m++) if (fy[m] < 0.01) fy[m] = 0;
    // Feed: the x = 0 edge of every cell in the first column, half a cell from its centre.
    const feed = new Float64Array(ny);
    for (let j = 0; j < ny; j++) feed[j] = 1 - blocked(j * h, (j + 1) * h, chordsY(0, j * h, (j + 1) * h)) / h;

    // Nodes: a cell is its own node unless it lies in a power via pad, which is one node.
    const NC = nx * ny, node = new Int32Array(NC).fill(-1);
    const padOf = new Int32Array(NC).fill(-1);
    if (!o.drainEdge) vias.forEach((v, k) => {
      const i0 = Math.max(0, Math.floor((v.x - PAD) / h)), i1 = Math.min(nx - 1, Math.floor((v.x + PAD) / h));
      const j0 = Math.max(0, Math.floor((v.y - PAD) / h)), j1 = Math.min(ny - 1, Math.floor((v.y + PAD) / h));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
        if (Math.hypot((i + 0.5) * h - v.x, (j + 0.5) * h - v.y) <= PAD) padOf[i + j * nx] = k;
    });

    const padCells = vias.map(() => []);
    for (let k = 0; k < NC; k++) if (padOf[k] >= 0) padCells[padOf[k]].push(k);
    // Only copper connected to the feed carries current: flood fill from the feed edge.
    const live = new Uint8Array(NC), stack = [];
    for (let j = 0; j < ny; j++) if (feed[j] > 0) { live[j * nx] = 1; stack.push(j * nx); }
    while (stack.length) {
      const k = stack.pop(), i = k % nx, j = (k - i) / nx;
      const go = (m, f) => { if (f > 0 && !live[m]) { live[m] = 1; stack.push(m); } };
      if (i + 1 < nx) go(k + 1, fx[i + j * (nx - 1)]);
      if (i > 0) go(k - 1, fx[i - 1 + j * (nx - 1)]);
      if (j + 1 < ny) go(k + nx, fy[i + j * nx]);
      if (j > 0) go(k - nx, fy[i + (j - 1) * nx]);
      // a pad conducts across itself
      if (padOf[k] >= 0) padCells[padOf[k]].forEach((m) => { if (!live[m]) { live[m] = 1; stack.push(m); } });
    }
    const viaLive = vias.map((v, k) => padCells[k].some((m) => live[m]));

    let N = 0;
    const viaNode = vias.map(() => -1);
    for (let k = 0; k < NC; k++) {
      if (!live[k]) continue;
      const p = padOf[k];
      if (p >= 0) { if (viaNode[p] < 0) viaNode[p] = N++; node[k] = viaNode[p]; }
      else node[k] = N++;
    }
    const nCells = N;
    const pkg = N++;                                       // the package (or, for a strip, the far edge)
    const live_vias = vias.filter((v, k) => viaLive[k]).length;
    if (!o.drainEdge && !live_vias) return { error: 'cut', nx, ny, h, holes, vias, live };

    // Assemble the conductance matrix as a list of links, then CSR.
    const links = [];
    const link = (a, b, g) => { if (a !== b && g > 0) links.push([a, b, g]); };
    for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const k = i + j * nx;
      if (live[k] && live[k + 1]) link(node[k], node[k + 1], gs * fx[i + j * (nx - 1)]);
    }
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      if (live[k] && live[k + nx]) link(node[k], node[k + nx], gs * fy[i + j * nx]);
    }
    const gVia = 1 / o.rVia;
    if (o.drainEdge) for (let j = 0; j < ny; j++) { const k = nx - 1 + j * nx; if (live[k]) link(node[k], pkg, 2 * gs * 1); }
    else vias.forEach((v, k) => { if (viaNode[k] >= 0) link(viaNode[k], pkg, gVia); });
    const diagG = new Float64Array(N);                     // conductance to the feed (ground)
    for (let j = 0; j < ny; j++) if (live[j * nx]) diagG[node[j * nx]] += 2 * gs * feed[j];

    const deg = new Int32Array(N + 1);
    links.forEach(([a, b]) => { deg[a + 1]++; deg[b + 1]++; });
    for (let k = 0; k < N; k++) deg[k + 1] += deg[k];
    const col = new Int32Array(deg[N]), val = new Float64Array(deg[N]), fill = deg.slice(0, N);
    const diag = Float64Array.from(diagG);
    links.forEach(([a, b, g]) => {
      col[fill[a]] = b; val[fill[a]++] = -g; col[fill[b]] = a; val[fill[b]++] = -g;
      diag[a] += g; diag[b] += g;
    });
    /* Incomplete Cholesky, no fill: L L^T ~ G on G's own pattern. Rows are cells in
       natural order, so the factor is a good approximation of the plane's Laplacian. */
    const lo = new Int32Array(N + 1), lcol = [], lval = [];
    {
      const rows = [];
      for (let k = 0; k < N; k++) {
        const e = [];
        for (let m = deg[k]; m < deg[k + 1]; m++) if (col[m] < k) e.push([col[m], val[m]]);
        e.sort((u, v) => u[0] - v[0]);
        rows.push(e);
      }
      // merge duplicate columns (two links between the same pair of nodes)
      for (let k = 0; k < N; k++) {
        const e = rows[k], out = [];
        for (const q of e) { if (out.length && out[out.length - 1][0] === q[0]) out[out.length - 1][1] += q[1]; else out.push(q.slice()); }
        rows[k] = out;
      }
      const Ld = new Float64Array(N), w = new Float64Array(N), mark = new Int32Array(N).fill(-1);
      const Lrows = [];
      for (let i = 0; i < N; i++) {
        const e = rows[i];
        e.forEach(([c], n) => { mark[c] = i; w[c] = 0; });
        const Li = [];
        let dsum = 0;
        for (const [kk, a] of e) {
          let s2 = a;
          for (const [m, lv] of Lrows[kk]) if (mark[m] === i) s2 -= w[m] * lv;
          const lik = s2 / Ld[kk];
          w[kk] = lik; Li.push([kk, lik]); dsum += lik * lik;
        }
        Ld[i] = Math.sqrt(Math.max(diag[i] - dsum, 1e-3 * diag[i]));
        Lrows.push(Li);
      }
      for (let i = 0; i < N; i++) { lo[i + 1] = lo[i] + Lrows[i].length; Lrows[i].forEach(([c, v]) => { lcol.push(c); lval.push(v); }); }
      lo.Ld = Ld;
    }
    const LC = Int32Array.from(lcol), LV = Float64Array.from(lval), LD = lo.Ld;
    const precond = (rr, z) => {
      for (let i = 0; i < N; i++) {                        // L y = r
        let s2 = rr[i];
        for (let m = lo[i]; m < lo[i + 1]; m++) s2 -= LV[m] * z[LC[m]];
        z[i] = s2 / LD[i];
      }
      for (let i = N - 1; i >= 0; i--) {                   // L^T z = y, column-oriented
        z[i] /= LD[i];
        const zi = z[i];
        for (let m = lo[i]; m < lo[i + 1]; m++) z[LC[m]] -= LV[m] * zi;
      }
    };
    const mul = (x, y) => {
      for (let k = 0; k < N; k++) {
        let s = diag[k] * x[k];
        for (let m = deg[k]; m < deg[k + 1]; m++) s += val[m] * x[col[m]];
        y[k] = s;
      }
    };

    /* Solve G v = b, b = -I at the package. Voltages come out negative (below the
       regulator); everything reported is a drop, positive. */
    function solve(x0, tol = 1e-8) {
      const b = new Float64Array(N); b[pkg] = -o.I;
      const x = x0 && x0.length === N ? Float64Array.from(x0) : new Float64Array(N);
      const rr = new Float64Array(N), z = new Float64Array(N), p = new Float64Array(N), q = new Float64Array(N);
      mul(x, q);
      let bn = 0;
      for (let k = 0; k < N; k++) { rr[k] = b[k] - q[k]; bn += b[k] * b[k]; }
      bn = Math.sqrt(bn);
      precond(rr, z); for (let k = 0; k < N; k++) p[k] = z[k];
      let rz = 0; for (let k = 0; k < N; k++) rz += rr[k] * z[k];
      let it = 0, res = 1;
      for (; it < 20000; it++) {
        let rn = 0; for (let k = 0; k < N; k++) rn += rr[k] * rr[k];
        res = Math.sqrt(rn) / bn;
        if (res < tol) break;
        mul(p, q);
        let pq = 0; for (let k = 0; k < N; k++) pq += p[k] * q[k];
        const al = rz / pq;
        for (let k = 0; k < N; k++) { x[k] += al * p[k]; rr[k] -= al * q[k]; }
        precond(rr, z);
        let rz1 = 0; for (let k = 0; k < N; k++) rz1 += rr[k] * z[k];
        const be = rz1 / rz; rz = rz1;
        for (let k = 0; k < N; k++) p[k] = z[k] + be * p[k];
      }
      return report(x, it, res);
    }

    function report(x, iters, res) {
      const V = new Float64Array(NC).fill(NaN);
      for (let k = 0; k < NC; k++) if (live[k]) V[k] = -x[node[k]];         // drop below the regulator, V
      // Face currents (A), positive in +x and +y. The potential is -V, so I = g (V_next - V_this).
      const Ix = new Float64Array((nx - 1) * ny), Iy = new Float64Array(nx * (ny - 1));
      for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) {
        const k = i + j * nx;
        if (live[k] && live[k + 1] && node[k] !== node[k + 1]) Ix[i + j * (nx - 1)] = gs * fx[i + j * (nx - 1)] * (V[k + 1] - V[k]);
      }
      for (let j = 0; j + 1 < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        if (live[k] && live[k + nx] && node[k] !== node[k + nx]) Iy[i + j * nx] = gs * fy[i + j * nx] * (V[k + nx] - V[k]);
      }
      const vPkg = -x[pkg];
      const viaI = vias.map((v, k) => (viaNode[k] >= 0 ? gVia * (vPkg - -x[viaNode[k]]) : 0));
      const viaV = vias.map((v, k) => (viaNode[k] >= 0 ? -x[viaNode[k]] : NaN));
      let feedI = 0;
      for (let j = 0; j < ny; j++) if (live[j * nx]) feedI += 2 * gs * feed[j] * V[j * nx];
      const drop = o.drainEdge ? vPkg : Math.max(...viaV.filter((v) => !isNaN(v)));
      let power = 0;
      links.forEach(([a, b2, g]) => { power += g * (x[a] - x[b2]) * (x[a] - x[b2]); });
      for (let k = 0; k < N; k++) power += diagG[k] * x[k] * x[k];
      return { x, V, Ix, Iy, viaI, viaV, vPkg, drop, feedI, power, iters, res, webs: webs(Ix, Iy) };
    }

    /* The webs: the copper between two neighbouring antipads, along the line joining
       their centres (a face line, since the balls sit on whole millimetres). Its
       current divided by its width and the copper thickness is the mean current
       density across the neck. */
    function webs(Ix, Iy) {
      const out = [];
      if (o.holes) return out;
      const isHole = (i, j) => i >= 0 && j >= 0 && i < NBALL && j < NBALL && (o.map[j][i] === 'g' || o.map[j][i] === 's') && r > 0;
      for (let j = 0; j < NBALL; j++) for (let i = 0; i < NBALL; i++) {
        if (!isHole(i, j)) continue;
        const [x, y] = site(i, j);
        [[1, 0], [0, 1]].forEach(([di, dj]) => {
          if (!isHole(i + di, j + dj)) return;
          const w = PITCH - 2 * r;
          if (w <= 1e-9) { out.push({ i, j, di, dj, w: 0, I: 0, J: 0, x: x + di * PITCH / 2, y: y + dj * PITCH / 2 }); return; }
          let I = 0;
          if (di) {                                         // a horizontal web: current crosses it in y
            const jj = Math.round(y / h) - 1;               // the face row on y
            for (let ii = 0; ii < nx; ii++) {
              if (ii * h < x + PITCH - r && (ii + 1) * h > x + r) I += Iy[ii + jj * nx];
            }
          } else {                                          // a vertical web: current crosses it in x
            const ii = Math.round(x / h) - 1;
            for (let jj = 0; jj < ny; jj++) {
              if (jj * h < y + PITCH - r && (jj + 1) * h > y + r) I += Ix[ii + jj * (nx - 1)];
            }
          }
          out.push({ i, j, di, dj, w, I: Math.abs(I), J: Math.abs(I) / (w * 1e-3 * t) * 1e-6, x: x + di * PITCH / 2, y: y + dj * PITCH / 2 });
        });
      }
      return out;
    }

    return { nx, ny, h, t, gs, N, nCells, holes, vias, live, node, viaLive, fx, fy, I: o.I, d: o.d, oz: o.oz, map: o.map, solve,
      Jopen: o.I / (o.b * 1e-3 * t) * 1e-6 };          // A/mm^2 in the open plane, upstream of the array
  }

  NS.models.irPlane = { COPPER, SOLDER, PITCH, NBALL, BOARD, X0, Y0, PAD, BARREL, BALL, R_BARREL, R_BALL, defaultMap, site, blocked, create };
})();
