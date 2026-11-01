/* SI & PI — models/flit-fec-model.js
 * PCIe 6.0 flit, FEC and replay: raw errors in, replays out.
 *
 *   flit        256 bytes, one lane's bytes in order (an x1 view)
 *   FEC         three interleaved codes, each correcting one bad byte; byte i
 *               belongs to code i mod 3 (C-132). A code with two or more bad
 *               bytes cannot correct them, and the CRC sends the flit back for
 *               replay (C-132 guarantees detection up to 8 bad bytes; beyond that
 *               the panel assumes detection, which is the CRC's job)
 *   errors      a burst starts at a byte with probability b = 1 − (1 − FBER)^8,
 *               the first-bit error rate counting only each burst's first error
 *               (C-131); it carries on into the next byte with probability q, the
 *               stand-in for DFE error propagation
 *
 * Independent errors (q = 0) have a closed form: a code of n bytes survives with
 * probability (1 − b)^n + n·b·(1 − b)^(n−1), and the flit replays unless all three
 * survive. Bursts do not, so the chance a flit fails given k bursts is estimated
 * by drawing k bursts at random positions with a seeded generator, and summed
 * over the binomial number of bursts a flit gets. The k-burst failure chances do
 * not depend on the error rate, so a whole curve against FBER costs one set of
 * draws.
 *
 * What this is not: no lane striping or flit-boundary-crossing bursts, no
 * precoding, no miscorrection model, and the CRC is assumed to catch every flit
 * the FEC cannot fix. A proportion model of the mechanism, not the specification's
 * reliability analysis.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const FLIT = 256, WAYS = 3, KMAX = 12, DRAWS = 4000;
  const GBPS_PER_LANE = 64;                        // PCIe 6.0, GT/s with PAM4 at 32 GBd
  const flitNs = (width) => (FLIT * 8) / (GBPS_PER_LANE * width);   // 2 ns at x16

  const group = (i) => i % WAYS;
  const sizes = (() => { const n = new Array(WAYS).fill(0); for (let i = 0; i < FLIT; i++) n[group(i)]++; return n; })();

  const byteRate = (fber) => 1 - Math.pow(1 - fber, 8);

  /* Is this set of bad bytes correctable? One bad byte per code at most. */
  function correctable(bad) {
    const seen = new Array(WAYS).fill(0);
    for (const i of bad) if (++seen[group(i)] > 1) return false;
    return true;
  }

  /* The bytes one burst spoils: from its start, each further byte with
     probability q, stopping at the flit's end. */
  function burst(start, q, rnd) {
    const out = [start];
    for (let i = start + 1; i < FLIT && rnd() < q; i++) out.push(i);
    return out;
  }

  /* Independent byte errors: the closed form. */
  function replayIndependent(fber) {
    const b = byteRate(fber);
    let ok = 1;
    for (const n of sizes) ok *= Math.pow(1 - b, n) + n * b * Math.pow(1 - b, n - 1);
    return 1 - ok;
  }
  /* The chance a flit has any bad byte at all. */
  const hitRate = (fber) => 1 - Math.pow(1 - byteRate(fber), FLIT);

  /* P(flit fails | k bursts), k = 1..KMAX, by seeded draws. Memoised on q. */
  const memo = new Map();
  function failGivenK(q) {
    const key = q.toFixed(4);
    if (memo.has(key)) return memo.get(key);
    const rnd = K.rng(0x5eed + Math.round(q * 1e4));
    // a byte is bad in this draw when its stamp equals the draw number, so nothing
    // needs clearing between draws
    const stamp = new Int32Array(FLIT), seen = new Int32Array(WAYS);
    const f = [0];
    let draw = 0;
    for (let k = 1; k <= KMAX; k++) {
      // once failure is all but certain, more bursts can only keep it so
      if (f[k - 1] > 0.9995) { f.push(1); continue; }
      let fails = 0;
      for (let d = 0; d < DRAWS; d++) {
        draw++; seen.fill(0);
        let lost = false;
        for (let j = 0; j < k && !lost; j++) {
          for (let i = Math.floor(rnd() * FLIT); i < FLIT; i++) {
            if (stamp[i] !== draw) { stamp[i] = draw; if (++seen[group(i)] > 1) { lost = true; break; } }
            if (!(rnd() < q)) break;
          }
        }
        if (lost) fails++;
      }
      f.push(fails / DRAWS);
    }
    if (memo.size > 32) memo.delete(memo.keys().next().value);
    memo.set(key, f);
    return f;
  }

  /* Replay probability with bursts: Σ_k P(k bursts start in the flit) · P(fail | k).
     Beyond KMAX bursts a flit is counted as failed. */
  function replayBursty(fber, q) {
    const b = byteRate(fber), f = failGivenK(q);
    let pk = Math.pow(1 - b, FLIT), sum = 0, cum = pk;      // P(0)
    for (let k = 1; k <= KMAX; k++) {
      pk *= ((FLIT - k + 1) / k) * (b / (1 - b));
      cum += pk;
      sum += pk * f[k];
    }
    return sum + Math.max(0, 1 - cum);
  }

  /* One flit to draw on the map: either a random flit with at least one burst,
     from the current statistics, or one burst of a set length at a random place. */
  function drawFlit(fber, q, burstLen, seed) {
    const rnd = K.rng(seed >>> 0);
    const bad = new Set();
    if (burstLen > 0) {
      const start = Math.floor(rnd() * (FLIT - burstLen + 1));
      for (let i = 0; i < burstLen; i++) bad.add(start + i);
    } else {
      const b = byteRate(fber);
      // at least one burst, then each other byte may start one too
      const first = Math.floor(rnd() * FLIT);
      for (const i of burst(first, q, rnd)) bad.add(i);
      for (let s = 0; s < FLIT; s++) if (s !== first && rnd() < b) for (const i of burst(s, q, rnd)) bad.add(i);
    }
    const perGroup = new Array(WAYS).fill(0);
    for (const i of bad) perGroup[group(i)]++;
    return { bad, perGroup, ok: correctable(bad) };
  }

  function analyse(cfg) {
    const pInd = replayIndependent(cfg.fber);
    const pRep = cfg.q > 0 ? replayBursty(cfg.fber, cfg.q) : pInd;
    const pHit = cfg.q > 0 ? 1 - Math.pow(1 - byteRate(cfg.fber), FLIT) : hitRate(cfg.fber);
    const tf = flitNs(cfg.width);
    return { pInd, pRep, pHit, corrected: pHit > 0 ? 1 - pRep / pHit : 1, tf, every: pRep > 0 ? tf / pRep : Infinity };
  }

  NS.models.flitFec = { FLIT, WAYS, KMAX, DRAWS, GBPS_PER_LANE, flitNs, group, sizes, byteRate, correctable, burst, replayIndependent, hitRate, failGivenK, replayBursty, drawFlit, analyse };
})();
