/* SI & PI — models/plane-cavity-model.js
 * What the return current does to the plane pair when a signal via changes reference.
 *
 * A two-dimensional finite-difference time-domain (FDTD) solver for the field
 * between two parallel planes, seen from above. Between closely spaced planes
 * the only field that matters is the vertical E (Ez) and the in-plane H, so
 * Maxwell's equations reduce exactly to the TMz set on a Yee grid:
 *
 *   dEz/dt = (dHy/dx - dHx/dy - sigma*Ez - Jz) / eps
 *   dHx/dt = -(dEz/dy) / mu        dHy/dt = (dEz/dx) / mu
 *
 * A signal via that passes through the pair and changes reference carries its
 * return current across the gap: that is a current source Jz at the via. A
 * stitching via shorts the planes, so Ez = 0 in its cell. A stitching capacitor
 * is a series R-L-C between the planes, stepped alongside the field. The board
 * edge is open, modelled as a magnetic wall (tangential H = 0), which is the
 * textbook cavity boundary and ignores what the edge radiates.
 *
 * Voltage between the planes is V = -Ez * h, signed so that the source pushes
 * it positive. Lengths in mm, time in ps, current in mA, voltage in mV.
 *
 * Pure: no DOM. create() returns a stepper the view animates; run() steps it to
 * the end and returns a K.result. Requires js/viz-kit.js for K.result, K.fft, K.erfc.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  NS.models = NS.models || {};

  const C0 = 299.792458;                  // mm/ns
  const EPS0 = 8.8541878128e-12, MU0 = 4e-7 * Math.PI;

  const BOARD = { a: 100, b: 60, dx: 0.5, er: 4, h: 0.2 };       // mm, mm, mm, Dk at 1 GHz, mm
  /* Loss. The laminate's tan d of 0.02 (Q = 50) and the copper of a 0.2 mm plane
     pair, Rs / (eta h) against beta (Q about 96 at 1 GHz, rising as root f), give a
     plane-pair Q of 30 to 40 across 0.3 to 6 GHz. A constant conductivity cannot
     do that: its Q grows in proportion to f, so the 5 GHz modes would ring five
     times too long. One Debye pole plus a small conductivity holds the combined
     tan d within 15% of the target from 0.3 to 6 GHz, with Dk 4.00 at 1 GHz
     falling to 3.86 at 6 GHz, about what an FR-4 class laminate does. */
  const LOSS = { fp: 2.8, dEps: 0.2, sigma: 0.0115 * 4 * 2 * Math.PI * 1e9 * EPS0 };   // GHz, -, S/m
  LOSS.epsInf = BOARD.er - LOSS.dEps / (1 + (1 / LOSS.fp) ** 2);
  const CAP = { L: 0.7, C: 100, R: 10 };          // nH, nF, mohm: a 0402 at its mounting
  const BULK = { L: 1.0, C: 100, R: 10 };         // the four PDN capacitors of a GND/PWR pair
  const TIES = [[5, 5], [95, 5], [5, 55], [95, 55]];    // mounting holes, or PDN capacitors

  const DEFAULTS = {
    planes: 'gnd',            // 'gnd': GND/GND, ties and stitches are vias; 'pwr': GND/PWR, they are capacitors
    src: [30, 30], victim: [80, 42],
    stitches: [],             // [[x, y], ...] mm
    ties: TIES,
    trPs: 60,                 // 10-90% rise of the return current
    iMa: 10,                  // a 0.5 V edge into 50 ohm
    shape: 'step',            // or 'gauss': a Gaussian current pulse with the same 10-90 width,
                              // or 'burst': a tone at fGHz under a 1 ns Gaussian envelope centred at 4 ns
    lossless: false,          // Dk 4 flat, no loss: the closed-form cavity
    recordNs: 20,
    board: null,              // { a, b } mm, to test a smaller cavity
    cap: null                 // { L, C, R } nH, nF, mohm, to replace the stitching capacitor
  };

  /* Dk and tan d of the lossy medium at f GHz. */
  function medium(fGHz) {
    const x = fGHz / LOSS.fp, ep = LOSS.epsInf + LOSS.dEps / (1 + x * x);
    const epp = LOSS.dEps * x / (1 + x * x) + LOSS.sigma / (2 * Math.PI * fGHz * 1e9 * EPS0);
    return { dk: ep, df: epp / ep };
  }

  /* Cavity modes of a rectangle with magnetic walls: Ez ~ cos(m pi x/a) cos(n pi y/b),
     f_mn = v / 2 * sqrt((m/a)^2 + (n/b)^2), v = c / sqrt(Dk). Pass dk as a function
     of frequency for a dispersive laminate; it is iterated to a fixed point. */
  function bareModes(a, b, dk, fmaxGHz) {
    const out = [], D = typeof dk === 'function' ? dk : () => dk;
    for (let m = 0; m < 40; m++) for (let n = 0; n < 40; n++) {
      if (!m && !n) continue;
      const g = 0.5 * C0 * Math.sqrt((m / a) ** 2 + (n / b) ** 2);
      let f = g / 2;
      for (let it = 0; it < 30; it++) f = g / Math.sqrt(D(f));
      if (f <= fmaxGHz) out.push({ m, n, f });
    }
    return out.sort((p, q) => p.f - q.f);
  }

  function create(o) {
    const p = Object.assign({}, DEFAULTS, o || {});
    const B = Object.assign({}, BOARD, p.board || {}), nx = Math.round(B.a / B.dx), ny = Math.round(B.b / B.dx);
    const dx = B.dx * 1e-3, h = B.h * 1e-3;
    const epsInf = (p.lossless ? B.er : LOSS.epsInf) * EPS0;
    const vFast = C0 / Math.sqrt(epsInf / EPS0);           // mm/ns, the fastest wave on the grid
    const dt = 0.95 * B.dx / (vFast * Math.SQRT2) * 1e-9;  // s, 95% of the 2D Courant limit

    /* Debye by an auxiliary polarisation current Jp (Taflove and Hagness, ch. 9):
         tau dJp/dt + Jp = eps0 dEps dE/dt,  eps_inf dE/dt = curl H - sigma E - Jp - J
       with Jp and sigma*E averaged across the step, so the update stays second order:
         Jp1 = kp Jp0 + bp (E1 - E0),  kp = (2 tau - dt)/(2 tau + dt),  bp = 2 eps0 dEps/(2 tau + dt). */
    const sigma = p.lossless ? 0 : LOSS.sigma;
    const dEps = p.lossless ? 0 : LOSS.dEps * EPS0;
    const tau = 1 / (2 * Math.PI * LOSS.fp * 1e9);
    const kp = (2 * tau - dt) / (2 * tau + dt), bp = 2 * dEps / (2 * tau + dt);
    const A = epsInf / dt + bp / 2;
    const ca = (A - sigma / 2) / (A + sigma / 2), cb = 1 / (A + sigma / 2);
    const cbc = cb / dx, cpj = cb * (1 + kp) / 2;          // curl term (dx = dy); old Jp
    const cj = cb / (dx * dx);                             // a current I in one cell: J = I / dx^2
    const jpE = bp;                                        // Jp gained per V/m of change in E
    const ch = dt / (MU0 * dx);

    const Ez = new Float32Array(nx * ny), Jp = new Float32Array(nx * ny);
    const Hy = new Float32Array((nx + 1) * ny);            // x-faces; i = 0 and nx stay 0: magnetic wall
    const Hx = new Float32Array(nx * (ny + 1));            // y-faces; j = 0 and ny stay 0
    const peak = new Float32Array(nx * ny);                // largest |V| each cell has seen, mV
    const toMv = -h * 1e3;

    const clampI = (x) => Math.max(0, Math.min(nx - 1, Math.floor(x / B.dx)));
    const clampJ = (y) => Math.max(0, Math.min(ny - 1, Math.floor(y / B.dx)));
    const cell = (q) => clampJ(q[1]) * nx + clampI(q[0]);
    const kSrc = cell(p.src), kVic = cell(p.victim);

    /* Shorts and lumped parts. One placed on the signal via's own cell would short
       the source, so it is refused there. */
    const shorts = [], parts = [];
    const asCap = p.planes === 'pwr';
    const place = (q, spec) => {
      const k = cell(q);
      if (k === kSrc) return;
      if (!asCap) { shorts.push(k); return; }
      const L = spec.L * 1e-9, C = spec.C * 1e-9, R = spec.R * 1e-3, g = R * dt / (2 * L);
      parts.push({ k, L, C, R, i: 0, q: 0, a: (1 - g) / (1 + g), b: dt / L / (1 + g) });
    };
    (p.ties || []).forEach((q) => place(q, BULK));
    (p.stitches || []).forEach((q) => place(q, p.cap || CAP));
    const shortArr = Int32Array.from(new Set(shorts));

    const nSteps = Math.ceil(p.recordNs * 1e-9 / dt);
    const tr = p.trPs * 1e-12, sd = tr / 2.5631;          // 10-90% of a Gaussian edge is 2.563 sigma
    const t0 = 4 * sd + 20e-12;
    const current = (t) => p.shape === 'gauss' ? p.iMa * 1e-3 * Math.exp(-0.5 * ((t - t0) / sd) ** 2)
      : p.shape === 'burst' ? p.iMa * 1e-3 * Math.exp(-0.5 * ((t - 4e-9) / 1e-9) ** 2) * Math.sin(2 * Math.PI * p.fGHz * 1e9 * t)
      : p.iMa * 1e-3 * 0.5 * K.erfc(-(t - t0) / (sd * Math.SQRT2));

    const vic = new Float32Array(nSteps + 1), src = new Float32Array(nSteps + 1);
    const vsrc = new Float32Array(nSteps + 1);
    let n = 0;

    /* A correction dE applied to one cell after the sweep (a source, a part, a
       short) has to reach its polarisation current too, or the cell would carry
       a Debye memory of a field it never had. */
    const kick = (k, dE) => { Ez[k] += dE; Jp[k] += jpE * dE; };

    function step(count) {
      const end = Math.min(nSteps, n + count);
      for (; n < end; n++) {
        for (let j = 0; j < ny; j++) {                     // H from the curl of E
          const r = j * nx, f = j * (nx + 1), s = r - nx;
          for (let i = 1; i < nx; i++) Hy[f + i] += ch * (Ez[r + i] - Ez[r + i - 1]);
          if (j) for (let i = 0; i < nx; i++) Hx[r + i] -= ch * (Ez[r + i] - Ez[s + i]);
        }
        for (let j = 0; j < ny; j++) {                     // E from the curl of H
          const r = j * nx, f = j * (nx + 1), u = r + nx;
          for (let i = 0; i < nx; i++) {
            const k = r + i, e0 = Ez[k];
            const e1 = ca * e0 + cbc * ((Hy[f + i + 1] - Hy[f + i]) - (Hx[u + i] - Hx[k])) - cpj * Jp[k];
            Jp[k] = kp * Jp[k] + jpE * (e1 - e0);
            Ez[k] = e1;
            const a = e1 < 0 ? -e1 : e1;
            if (a > peak[k]) peak[k] = a;                  // in V/m here; scaled to mV once, below
          }
        }
        const I = current((n + 0.5) * dt);                 // J at the half step, with the curl of H
        kick(kSrc, -cj * I);
        for (const e of parts) kick(e.k, -cj * e.i);
        for (let s = 0; s < shortArr.length; s++) { Ez[shortArr[s]] = 0; Jp[shortArr[s]] = 0; peak[shortArr[s]] = 0; }
        for (const e of parts) {                           // L di/dt + R i + q/C = V, R semi-implicit
          e.q += dt * e.i;
          e.i = e.a * e.i + e.b * (Ez[e.k] * h - e.q / e.C);
        }
        vic[n + 1] = Ez[kVic] * toMv; vsrc[n + 1] = Ez[kSrc] * toMv; src[n + 1] = I * 1e3;
      }
      return n < nSteps;
    }

    /* Field energy between the planes, J. E is at step n and H at n - 1/2, so the
       magnetic term pairs H(n - 1/2) with H(n + 1/2), computed here without
       advancing: that product is the quantity the Yee scheme conserves exactly in a
       lossless cavity. Energy held by the Debye polarisation is not included. */
    function energy() {
      let we = 0, wh = 0;
      for (let k = 0; k < Ez.length; k++) we += Ez[k] * Ez[k];
      for (let j = 0; j < ny; j++) {
        const r = j * nx, f = j * (nx + 1), s = r - nx;
        for (let i = 1; i < nx; i++) { const hy = Hy[f + i]; wh += hy * (hy + ch * (Ez[r + i] - Ez[r + i - 1])); }
        if (j) for (let i = 0; i < nx; i++) { const hx = Hx[r + i]; wh += hx * (hx - ch * (Ez[r + i] - Ez[s + i])); }
      }
      return 0.5 * (epsInf * we + MU0 * wh) * dx * dx * h;
    }

    return {
      params: p, board: B, nx, ny, dxMm: B.dx, dtPs: dt * 1e12, nSteps, kSrc, kVic,
      shorts: shortArr, parts, Ez, step, energy, vic, vsrc, src, toMv,
      peakMv: (k) => peak[k] * -toMv,
      peakRaw: peak,
      get n() { return n; },
      get tNs() { return n * dt * 1e9; },
      get done() { return n >= nSteps; }
    };
  }

  /* Transfer impedance from the signal via to the victim, Z21 = V_victim / I_source,
     from the derivatives of both records so a step source has a finite spectrum.
     The last 30% of the record is tapered (Tukey) so ringing cut off by the end
     of the record does not ripple. edge(f) is the source spectrum relative to its peak,
     below about 1e-2 of which the division only measures round-off. For a step
     source that peak is at DC; for a pulse, where the derivative is largest. */
  function transfer(sim, fmaxGHz, which) {
    const N = sim.n, rec = which === 'self' ? sim.vsrc : sim.vic;
    let nfft = 1; while (nfft < 4 * N) nfft <<= 1;
    const vr = new Float64Array(nfft), vi = new Float64Array(nfft);
    const ir = new Float64Array(nfft), ii = new Float64Array(nfft);
    const taper = Math.floor(0.3 * N);
    for (let k = 1; k <= N; k++) {
      const u = k - (N - taper);
      const w = u > 0 ? 0.5 * (1 + Math.cos(Math.PI * u / taper)) : 1;
      vr[k] = (rec[k] - rec[k - 1]) * w;
      ir[k] = (sim.src[k] - sim.src[k - 1]) * w;
    }
    K.fft(vr, vi); K.fft(ir, ii);
    const df = 1 / (nfft * sim.dtPs * 1e-3);               // GHz
    let i0 = 0;
    for (let k = 0; k <= nfft / 2; k++) i0 = Math.max(i0, Math.hypot(ir[k], ii[k]));
    const out = [];
    for (let k = 1; k * df <= fmaxGHz; k++) {
      const d = ir[k] * ir[k] + ii[k] * ii[k];
      const zr = (vr[k] * ir[k] + vi[k] * ii[k]) / d, zi = (vi[k] * ir[k] - vr[k] * ii[k]) / d;
      out.push({ f: k * df, z: Math.hypot(zr, zi) , edge: Math.sqrt(d) / i0 });   // mV / mA = ohm
    }
    return out;
  }

  /* Resonant peaks: local maxima of |Z21| that stand clear of their neighbourhood. */
  function peaks(spec, count) {
    const out = [];
    for (let k = 2; k < spec.length - 2; k++) {
      const z = spec[k].z;
      if (spec[k].edge < 0.02) break;
      if (z > spec[k - 1].z && z >= spec[k + 1].z && z > spec[k - 2].z && z >= spec[k + 2].z) out.push(spec[k]);
    }
    return out.sort((p, q) => q.z - p.z).slice(0, count || 4).sort((p, q) => p.f - q.f);
  }

  function run(o) {
    const sim = create(o), p = sim.params;
    const ok = ['gnd', 'pwr'].includes(p.planes) && p.trPs >= 20 && p.trPs <= 1000 && p.recordNs > 0 && p.recordNs <= 200;
    if (!ok) return K.result({ model: 'planeCavity', version: '1.0', status: 'unsupported', params: p,
      why: 'Planes must be gnd or pwr, the rise time 20 to 1000 ps and the record up to 200 ns.' });
    while (sim.step(4096)) { /* to the end of the record */ }
    return summarise(sim);
  }

  function summarise(sim) {
    const p = sim.params, spec = transfer(sim, 6);
    let pk = 0, late = 0, nl = 0;
    const lateFrom = Math.floor(5000 / sim.dtPs);           // ringing after 5 ns
    for (let k = 0; k <= sim.n; k++) {
      pk = Math.max(pk, Math.abs(sim.vic[k]));
      if (k >= lateFrom) { late += sim.vic[k] * sim.vic[k]; nl++; }
    }
    return K.result({
      model: 'planeCavity', version: '1.0', status: 'ok', params: p,
      units: { peakMv: 'mV', lateRmsMv: 'mV', z: 'ohm', f: 'GHz', t: 'ps' },
      measurements: {
        peakMv: pk, lateRmsMv: nl ? Math.sqrt(late / nl) : 0,
        dtPs: sim.dtPs, steps: sim.n, cells: sim.nx * sim.ny
      },
      generated: { sim, spectrum: spec, peaks: peaks(spec, 4), modes: bareModes(sim.board.a, sim.board.b, p.lossless ? BOARD.er : (f) => medium(f).dk, 6) }
    });
  }

  NS.models.planeCavity = { BOARD, LOSS, CAP, BULK, TIES, DEFAULTS, C0, EPS0, medium, create, run, summarise, transfer, peaks, bareModes };
})();
