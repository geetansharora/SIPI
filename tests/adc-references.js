/* Independent references for the ADC lab's assertions.
 *
 * None of these shares code with the model. The fold is computed by remainder and
 * mirror rather than by rounding; the trapezoid's harmonics come from its Fourier
 * series summed here; the tone amplitudes come from a least-squares fit to the
 * converter's own output record, which knows nothing of the model's FFT, its window
 * or its bin bookkeeping. They are required by check-models.js so the ADC suites
 * can assert against them, and by tests/check-adc-integration.js.
 */
'use strict';
const TAU = 2 * Math.PI;

// remainder, then mirror: a different construction from the model's round()
const foldRef = (f, fs) => { const r = ((f % fs) + fs) % fs; return r > fs / 2 ? fs - r : r; };

// odd harmonic n of a 50%-duty trapezoid, A pk-pk, full linear ramp as a fraction of the period
// (the lab's rise/fall time is 10–90%, so the full ramp is that divided by 0.8)
const trapezoidHarmonic = (A, n, edgeFrac) => {
  const x = Math.PI * n * edgeFrac;
  return (2 * A / (n * Math.PI)) * Math.abs(Math.sin(x) / x);
};

/* The coupled waveform at phase th, summed from its Fourier series through the
   single pole: the wave rises from phase 0, so its mid-edge is at edge/2. */
function seriesValue(A, edgeFrac, faOverFbw, th) {
  let s = 0;
  for (let n = 1; n < 400000; n += 2) {
    const k = n * faOverFbw;
    s += trapezoidHarmonic(A, n, edgeFrac) / Math.sqrt(1 + k * k)
       * Math.sin(TAU * n * (th - edgeFrac / 2) - Math.atan(k));
  }
  return s;
}

/* Least-squares fit of DC plus a cosine/sine pair per frequency (cycles per
   sample). Aliasing needs no special handling: a tone above Nyquist and its
   alias produce identical samples. Returns the peak amplitude of each tone. */
function toneFit(y, freqs) {
  const P = 1 + 2 * freqs.length, n = y.length;
  const G = Array.from({ length: P }, () => new Float64Array(P)), b = new Float64Array(P);
  const phi = new Float64Array(P);
  for (let i = 0; i < n; i++) {
    phi[0] = 1;
    for (let j = 0; j < freqs.length; j++) {
      const a = TAU * freqs[j] * i;
      phi[1 + 2 * j] = Math.cos(a); phi[2 + 2 * j] = Math.sin(a);
    }
    for (let r = 0; r < P; r++) {
      b[r] += phi[r] * y[i];
      for (let c = r; c < P; c++) G[r][c] += phi[r] * phi[c];
    }
  }
  for (let r = 0; r < P; r++) for (let c = 0; c < r; c++) G[r][c] = G[c][r];
  for (let col = 0; col < P; col++) {                      // Gaussian elimination, partial pivoting
    let piv = col;
    for (let r = col + 1; r < P; r++) if (Math.abs(G[r][col]) > Math.abs(G[piv][col])) piv = r;
    [G[col], G[piv]] = [G[piv], G[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < P; r++) {
      const f = G[r][col] / G[col][col];
      for (let c = col; c < P; c++) G[r][c] -= f * G[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(P);
  for (let r = P - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < P; c++) s -= G[r][c] * x[c];
    x[r] = s / G[r][r];
  }
  return { dc: x[0], amps: freqs.map((_, j) => Math.hypot(x[1 + 2 * j], x[2 + 2 * j])) };
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

module.exports = { TAU, foldRef, trapezoidHarmonic, seriesValue, toneFit, lcg };
