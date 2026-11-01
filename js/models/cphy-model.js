/* SI & PI — models/cphy-model.js
 * A C-PHY trio, a symbol at a time.
 *
 *   wire states  three wires A, B, C; in every state one wire sits at the mid
 *                level and the other two are driven high and low, which gives the
 *                six states +x −x +y −y +z −z (C-202)
 *   symbols      from any state there are five others, so a symbol is one of five
 *                transitions; every symbol therefore changes the state, and the
 *                receivers see an edge on every symbol: the clock rides in the data
 *   receivers    A − B, B − C and C − A, which sum to zero at every instant
 *   mapper       16 bits to 7 symbols, since 2^16 = 65,536 fits in 5^7 = 78,125
 *
 * The specification's mapper table and its flip/rotate/polarity assignment are
 * members-only. This uses A VALID MAPPING, labelled so: the 16-bit word written
 * as a seven-digit base-5 number, and digit d choosing the d-th of the five other
 * states in a fixed order. Every property the page teaches (a transition on every
 * symbol, three levels, two sizes of edge, the multi-crossing eye, sensitivity to
 * wire-to-wire skew) holds for any valid mapping.
 *
 * Levels are in units of the mid-to-high step: high +1, mid 0, low −1, so each
 * receiver sees ±2 (a strong level) or ±1 (a weak one), never zero.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const SPS = 32, NFFT = 2048;
  const STATES = [
    { name: '+x', w: [1, -1, 0] }, { name: '−x', w: [-1, 1, 0] },
    { name: '+y', w: [0, 1, -1] }, { name: '−y', w: [0, -1, 1] },
    { name: '+z', w: [-1, 0, 1] }, { name: '−z', w: [1, 0, -1] }
  ];
  const rx = (w) => [w[0] - w[1], w[1] - w[2], w[2] - w[0]];

  /* The d-th of the five states other than s. */
  const next = (s, d) => { const o = [0, 1, 2, 3, 4, 5].filter((t) => t !== s); return o[d]; };
  const digitOf = (s, t) => [0, 1, 2, 3, 4, 5].filter((u) => u !== s).indexOf(t);

  /* 16 bits → 7 base-5 digits, most significant first, and back. */
  function encode(word) {
    const d = new Array(7); let w = word >>> 0;
    for (let i = 6; i >= 0; i--) { d[i] = w % 5; w = Math.floor(w / 5); }
    return d;
  }
  function decode(digits) { return digits.reduce((a, d) => a * 5 + d, 0); }

  /* Digits → wire states, starting from state s0. */
  function states(digits, s0) {
    const out = []; let s = s0;
    for (const d of digits) { s = next(s, d); out.push(s); }
    return out;
  }
  function symbolsOf(stateSeq, s0) {
    const out = []; let s = s0;
    for (const t of stateSeq) { out.push(digitOf(s, t)); s = t; }
    return out;
  }

  /* A stream of random words as wire states, seeded, for the eye. */
  function stream(nWords, seed) {
    const rnd = K.rng(seed || 0xc0de);
    const seq = []; let s = 0;
    for (let i = 0; i < nWords; i++) {
      const st = states(encode(Math.floor(rnd() * 65536)), s);
      seq.push(...st); s = st[st.length - 1];
    }
    return seq;
  }

  /* One wire's waveform: its level per symbol, each change a raised-cosine edge of
     tr (share of a UI, 0 to 100% of its swing), delayed by `delay` UI, then
     through the channel if lossDb > 0. */
  function wire(levels, tr, delay, h) {
    const n = levels.length * SPS, x = new Float64Array(n);
    const trs = Math.max(1, tr * SPS), d = delay * SPS;
    for (let i = 0; i < n; i++) {
      const t = i - d, k = Math.floor(t / SPS);
      const kk = Math.max(0, Math.min(levels.length - 1, k)), prev = levels[Math.max(0, kk - 1)], cur = levels[kk];
      const u = (t - kk * SPS) / trs;
      const a = u >= 1 ? 1 : u <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * u);
      x[i] = k < 0 ? levels[0] : prev + (cur - prev) * a;
    }
    if (!h) return x;
    const y = new Float64Array(n);
    // the channel is a low-pass with unity DC gain. Before the record starts the trio
    // has sat in its first state for ever, so the taps that reach back past sample 0
    // see that level, not zero, and there is no start-up transient.
    const tail = new Float64Array(h.length + 1);
    for (let k = h.length - 1; k >= 0; k--) tail[k] = tail[k + 1] + h[k];
    for (let i = 0; i < n; i++) {
      let s = 0; const km = Math.min(h.length, i + 1);
      for (let k = 0; k < km; k++) s += h[k] * x[i - k];
      y[i] = s + x[0] * tail[km];
    }
    return y;
  }

  const hCache = new Map();
  function channel(lossDb) {
    if (!(lossDb > 0)) return null;
    const key = lossDb.toFixed(3);
    if (!hCache.has(key)) {
      if (hCache.size > 16) hCache.delete(hCache.keys().next().value);
      hCache.set(key, K.channelImpulse(lossDb, SPS, NFFT));
    }
    return hCache.get(key);
  }

  /* The channel's delay to the centre of a symbol: the cursor of the single-symbol
     response less the half symbol a lossless pulse already takes to reach its
     centre. Not the peak of h, which comes early and would fold the eye off-centre. */
  const lagCache = new Map();
  function delayOf(lossDb) {
    const h = channel(lossDb);
    if (!h) return 0;
    const key = lossDb.toFixed(3);
    if (!lagCache.has(key)) {
      if (lagCache.size > 16) lagCache.delete(lagCache.keys().next().value);
      lagCache.set(key, Math.max(0, Math.round(K.singleBit(h, SPS).cursor - (SPS - 1) / 2)));
    }
    return lagCache.get(key);
  }

  /* The three wires and the three receivers for a run of states. Skew delays wire
     C against A and B. The channel delay is removed so the eye stays centred. */
  function waves(seq, cfg) {
    const h = channel(cfg.loss), lag = delayOf(cfg.loss);
    const W = [0, 1, 2].map((j) => {
      const lv = seq.map((s) => STATES[s].w[j]);
      const delay = j === 2 ? cfg.skew : 0;
      const y = wire(lv, cfg.tr, delay, h);
      return lag ? y.subarray(lag) : y;
    });
    const n = Math.min(...W.map((w) => w.length));
    const R = [0, 1, 2].map((j) => { const a = W[j], b = W[(j + 1) % 3], r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = a[i] - b[i]; return r; });
    return { W, R, n };
  }

  /* The eye of the three receivers. At each phase of the UI, the margin is the
     smallest correct-signed receiver voltage over every symbol and receiver, in
     units of the weak level (1). The height is the best phase's margin; the width
     is the share of the UI where the margin is at least 0.2 of the weak level.
     Where the UI is cut decides nothing about the eye, so every cut within half a
     symbol of the boundary is tried and the widest kept (then the tallest), as a
     scope centres its eye: a cut through the open window would halve it. */
  const THRESH = 0.2;
  function eye(seq, cfg) {
    const { R, n } = waves(seq, cfg);
    const skip = 8, last = Math.floor(n / SPS) - 2;
    let best = null;
    for (let off = -SPS / 2; off < SPS / 2; off++) {
      const margin = new Float64Array(SPS);
      for (let ph = 0; ph < SPS; ph++) {
        let m = Infinity;
        for (let b = skip; b < last; b++) {
          const want = rx(STATES[seq[b]].w);
          for (let j = 0; j < 3; j++) m = Math.min(m, Math.sign(want[j]) * R[j][b * SPS + off + ph]);
        }
        margin[ph] = m;
      }
      const height = Math.max(...margin), width = margin.filter((x) => x >= THRESH).length / SPS;
      if (!best || width > best.width || (width === best.width && height > best.height)) best = { off, margin, height, width };
    }
    return { margin: best.margin, height: best.height, width: best.width, off: best.off, R, n };
  }

  NS.models.cphy = { SPS, NFFT, STATES, THRESH, rx, next, digitOf, encode, decode, states, symbolsOf, stream, wire, channel, delayOf, waves, eye };
})();
