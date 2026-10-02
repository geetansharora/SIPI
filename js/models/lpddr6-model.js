/* SIPI — models/lpddr6-model.js
 * Two models for the LPDDR6 page.
 *
 * 1. Three roads to the same bandwidth. A channel's raw bandwidth is pins x
 *    symbol rate x bits per symbol. LPDDR6 raised it by going wider (12 DQ per
 *    sub-channel, 24 per channel) at NRZ. The alternatives on the same 16 pins as
 *    LPDDR5X are to run NRZ faster, or to send PAM4 at half the faster route's
 *    symbol rate. All three carry the same raw bandwidth through the same
 *    physical channel:
 *      fast   16 pins, NRZ,  rate = B/16
 *      pam4   16 pins, PAM4, baud = B/32
 *      wide   N pins,  NRZ,  rate = B/N       (N = 24 is LPDDR6)
 *    The channel is the kit's causal two-term loss law, with the loss each route
 *    sees taken at ITS OWN Nyquist frequency from one physical law, plus an echo
 *    of fixed size and fixed delay in picoseconds, so a faster route sees the same
 *    echo land more symbols later. The swing is LVSTL's: VDDQ 0.5 V into a
 *    pull-up Ron against RTT to ground. Eyes are built by superposing the pulse
 *    response over a PRBS-11 pattern and measured with the kit's eyeContour; noise
 *    and jitter are taken off as a +/-Q sigma allowance.
 *
 * 2. The 288-bit packet. 12 DQ x BL24 = 288 bits: 256 data, 16 metadata, and 16
 *    bits that are either DBI flags or link-protection check bits, never both.
 *    LVSTL terminates to VSSQ, so a 1 is the bit that draws termination current;
 *    DBI here inverts a 16-bit group when more than half of it is 1.
 *
 * No DOM. Requires js/viz-kit.js.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });
  const K = NS.kit;
  const L = ((NS.models = NS.models || {}).lpddr6 = {});

  const VDDQ = 0.5, RON = 40, RTT = 40;          // V, ohm; Ron and RTT are model choices
  const SPS = 32, NFFT = 4096, TR_UI = 0.3;
  L.VDDQ = VDDQ; L.RON = RON; L.RTT = RTT; L.SPS = SPS;
  L.SWING = VDDQ * RTT / (RON + RTT);             // high level of an LVSTL pin; low is 0 V
  L.RATES = [10667, 12800, 14400];                // MT/s on the wide route

  /* rate is the LPDDR6 bin that sets the target: B = 24 pins x rate. pins is how
     many the wide route spends on it, so its own rate is B / pins. */
  L.defaults = { rate: 10667, pins: 24, loss5: 3, echo: 8, echoPs: 240, noiseMv: 4, jitterPs: 1.5, q: 7, dfe: false };

  /* One physical loss law in frequency: L5 dB at 5 GHz, 35% skin, 65% dielectric. */
  L.lossAt = (fGHz, L5) => L5 * (0.35 * Math.sqrt(fGHz / 5) + 0.65 * (fGHz / 5));

  L.routes = function (p) {
    const raw = 24 * p.rate;                      // Mb/s per channel, the LPDDR6 bin's
    return [
      { id: 'fast', name: 'Faster NRZ', short: 'faster NRZ', pins: 16, levels: 2, baud: raw / 16 },
      { id: 'pam4', name: 'PAM4', short: 'PAM4', pins: 16, levels: 4, baud: raw / 32 },
      { id: 'wide', name: 'Wide NRZ', short: 'wide NRZ', pins: p.pins, levels: 2, baud: raw / p.pins }
    ].map((r) => Object.assign(r, { raw, ui: 1e6 / r.baud, fN: r.baud / 2000, slicers: r.levels - 1 }));
  };

  L.prbs11 = function () {
    let s = 0x7ff; const out = new Uint8Array(2047);
    for (let i = 0; i < 2047; i++) { out[i] = s & 1; s = ((s << 1) | (((s >> 10) ^ (s >> 8)) & 1)) & 0x7ff; }
    return out;
  };

  /* The channel a route sees: its Nyquist loss, and the echo at a fixed delay in ps.
     DC gain is held at one, so the levels the eye settles to are the driver's. */
  L.channel = function (r, p) {
    const loss = L.lossAt(r.fN, p.loss5);
    const h0 = K.channelImpulse(loss, SPS, NFFT);
    const rho = (p.echo || 0) / 100, d = p.echoPs / r.ui * SPS;
    const n = h0.length + Math.ceil(d) + 2, h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = i < h0.length ? h0[i] : 0;
      const j = i - d, j0 = Math.floor(j);
      if (rho && j0 >= 0 && j0 + 1 < h0.length) v += rho * (h0[j0] + (h0[j0 + 1] - h0[j0]) * (j - j0));
      else if (rho && j0 >= 0 && j0 < h0.length) v += rho * h0[j0];
      h[i] = v / (1 + rho);
    }
    return { h, loss, rho, delayUI: p.echoPs / r.ui };
  };

  /* Superpose the pulse over a symbol stream. levels: 2 for NRZ, 4 for PAM4. */
  L.eye = function (r, p, opts) {
    opts = opts || {};
    const ch = L.channel(r, p), pr = K.pulseResponse(ch.h, SPS, TR_UI);
    const P = pr.sbr, cur = pr.cursor;
    const bits = L.prbs11(), lead = 32;
    const nSym = r.levels === 2 ? 2047 : 1023;
    const sym = new Uint8Array(nSym + lead);
    for (let k = 0; k < nSym + lead; k++) {
      const i = (k - lead + nSym) % nSym;
      sym[k] = r.levels === 2 ? bits[i] : (bits[(2 * i) % 2047] << 1 | bits[(2 * i + 1) % 2047]);
    }
    const step = L.SWING / (r.levels - 1), n = sym.length;
    const pre = Math.ceil(cur / SPS) + 1, span = Math.ceil((P.length - cur) / SPS);
    const y = new Float64Array(n * SPS);
    for (let b = 0; b < n; b++) {
      const a = sym[b] * step;
      if (!a) continue;
      for (let k = -pre; k < span; k++) {
        const j0 = cur + k * SPS;
        for (let s = 0; s < SPS; s++) {
          const pj = j0 + s - SPS / 2, yi = (b + k) * SPS + s;
          if (pj >= 0 && pj < P.length && yi >= 0 && yi < y.length) y[yi] += a * P[pj];
        }
      }
    }
    /* an ideal one-tap DFE: subtract the first post-cursor times the previous
       symbol, over the whole UI the decision applies to */
    const tap = p.dfe ? P[cur + SPS] || 0 : 0;
    if (tap) for (let b = 1; b < n; b++) {
      const c = sym[b - 1] * step * tap;
      if (c) for (let s = 0; s < SPS; s++) y[b * SPS + s] -= c;
    }
    const sample = (b, s) => { const i = b * SPS + SPS / 2 + s; return i >= 0 && i < y.length ? y[i] : undefined; };
    const eyes = [];
    for (let k = 0; k < r.levels - 1; k++) {
      const above = Array.from(sym, (v) => (v >= k + 1 ? 1 : 0));
      /* for a PAM4 eye only the two adjacent levels bound it */
      const keep = (b) => sym[b] === k || sym[b] === k + 1;
      const c = K.eyeContour((b, s) => (keep(b) ? sample(b, s) : undefined), above, lead, n, -SPS, SPS);
      const mid = c.pts ? c.pts.find((q) => q[0] === 0) : null;
      eyes.push({ c, h: mid ? mid[1] - mid[2] : 0, w: c.pts ? (c.right[0] - c.left[0]) * r.ui / SPS : 0, centre: mid ? (mid[1] + mid[2]) / 2 : (k + 0.5) * step });
    }
    const h = Math.min.apply(null, eyes.map((e) => e.h)), w = Math.min.apply(null, eyes.map((e) => e.w));
    const mV = 2 * p.q * p.noiseMv / 1000, mT = 2 * p.q * p.jitterPs;
    return {
      r, ch, P, cur, y, sym, lead, n, sample, eyes, step, tap,
      height: h, width: w,
      marginV: Math.max(0, h - mV), marginT: Math.max(0, w - mT),
      openV: h > mV, openT: w > mT
    };
  };

  L.run = function (p) {
    return L.routes(p).map((r) => L.eye(r, p));
  };

  /* ---------- the packet ---------- */
  L.PACKET = { dq: 12, bl: 24, data: 256, meta: 16, extra: 16 };
  L.energyPerOne = (ratePerPin) => VDDQ * VDDQ / (RON + RTT) * (1e6 / ratePerPin);   // W x ps = pJ
  L.patterns = {
    random: () => { const g = K.rng(0x6d6); return Array.from({ length: 256 }, () => (g() < 0.5 ? 1 : 0)); },
    zeros: () => new Array(256).fill(0),
    ones: () => new Array(256).fill(1),
    mostlyOnes: () => { const g = K.rng(0x11); return Array.from({ length: 256 }, () => (g() < 0.8 ? 1 : 0)); },
    text: () => {
      const s = 'LPDDR6 moves 256 bits per burst!';            // 32 bytes
      const out = [];
      for (let i = 0; i < 32; i++) { const c = s.charCodeAt(i); for (let b = 7; b >= 0; b--) out.push((c >> b) & 1); }
      return out;
    },
    ramp: () => Array.from({ length: 256 }, (_, i) => ((i % 16) < Math.floor(i / 16) + 1 ? 1 : 0))
  };
  L.packet = function (data, meta, mode, rate) {
    const groups = [], flags = [];
    let ones = 0;
    for (let g = 0; g < 16; g++) {
      const raw = data.slice(16 * g, 16 * g + 16);
      const n1 = raw.reduce((a, b) => a + b, 0);
      const inv = mode === 'dbi' && n1 > 8;
      const sent = inv ? raw.map((b) => 1 - b) : raw;
      groups.push({ raw, sent, inv, n1, sent1: sent.reduce((a, b) => a + b, 0) });
      flags.push(inv ? 1 : 0);
    }
    const dataOnes = groups.reduce((a, g) => a + g.sent1, 0);
    const metaOnes = meta.reduce((a, b) => a + b, 0);
    /* DBI flags are real bits; link-protection check bits depend on the code the
       standard defines, so they are counted at their average, half of 16. */
    const extraOnes = mode === 'dbi' ? flags.reduce((a, b) => a + b, 0) : mode === 'link' ? 8 : 0;
    ones = dataOnes + metaOnes + extraOnes;
    const e1 = L.energyPerOne(rate);
    return { groups, flags, dataOnes, metaOnes, extraOnes, ones, energy: ones * e1, e1, bits: 256 + 16 + (mode === 'none' ? 0 : 16) };
  };
})();
