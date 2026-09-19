/* tests/pdn-reference.js — an INDEPENDENT time-domain solver for the PDN ladder.
 *
 * N2-4 / R7. Astra asked for "an independent time-domain circuit/state-space
 * solution" to check Lab C against, and this is it. It shares no code with
 * js/viz/lab-pdn.js and uses a different method entirely:
 *
 *     lab-pdn.js     frequency domain, FFT convolution over a PERIODIC record
 *     this file      time domain, trapezoidal companion models, causal from rest
 *
 * Every branch (series R+L, shunt R+L+C, n in parallel) becomes a conductance
 * plus a history current source under the trapezoidal rule, so each timestep is
 * one tridiagonal nodal solve down the ladder. Thomas algorithm, no matrices.
 *
 * Validated against a limit neither implementation can fudge: with capacitors
 * open and inductors shorted, the DC resistance at the die is the series chain
 * plus the regulator's own resistance, 7.8 mOhm for the default rail. Driven
 * with a long step this solver settles to 62.4000 mV at 8 A, against an
 * analytical 62.4000 mV — agreement to under a microvolt.
 *
 * It is a TEST FIXTURE, not part of the site. It is never loaded in a browser.
 */

function branch(r, l, c, n, h) {
  n = n || 1;
  r = r / n; l = l / n; c = c ? c * n : Infinity;
  if (l === 0) {
    const B = r + (isFinite(c) ? h / (2*c) : 0);
    return {G:1/B, r,l,c,B,i:0,v:0, algebraic:true};
  }
  const A = h / (2 * l);
  const B = r + (isFinite(c) ? h / (2 * c) : 0);
  const den = 1 + A * B;
  return { G: A / den, A, B, den, r, l, c, i: 0, v: 0 };
}
/* i_{n+1} = G*u_{n+1} + Ihist, from
   i_{n+1}(1+AB) = i_n(1-AB) + A(u_{n+1}+u_n) - 2A*vC_n            */
function hist(b, uPrev) {
  if (b.algebraic) return -(b.v + (isFinite(b.c) ? h_ * b.i / (2*b.c) : 0)) / b.B;
  return (b.i * (1 - b.A * b.B) + b.A * uPrev - 2 * b.A * b.v) / b.den;
}
function advance(b, uNow) {
  const iNew = b.G * uNow + b.Ih;
  if (isFinite(b.c)) b.v += (h_ / (2 * b.c)) * (iNew + b.i);
  b.i = iNew;
}
let h_ = 0;

function solve(stages, load, h, nodeLoads, observe) {
  h_ = h;
  const N = stages.length;
  const ser = [], sh = [];
  for (let k = 0; k < N; k++) {
    const s = stages[k];
    ser.push(s.series ? branch(s.series.r, s.series.l, null, 1, h) : null);
    sh.push(branch(s.shunt.r, s.shunt.l, s.shunt.c, s.shunt.n, h));
  }
  const v = new Float64Array(N), vPrev = new Float64Array(N);
  const out = new Float64Array(load.length);
  const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), d = new Float64Array(N);

  for (let t = 0; t < load.length; t++) {
    // history from the PREVIOUS step's branch voltages
    for (let k = 0; k < N; k++) {
      if (ser[k]) ser[k].Ih = hist(ser[k], vPrev[k - 1] - vPrev[k]);
      sh[k].Ih = hist(sh[k], vPrev[k]);
    }
    // tridiagonal G*v = rhs
    for (let k = 0; k < N; k++) {
      const gUp = ser[k] ? ser[k].G : 0;                 // to node k-1
      const gDn = (k + 1 < N && ser[k + 1]) ? ser[k + 1].G : 0;  // to node k+1
      a[k] = -gUp; b[k] = gUp + gDn + sh[k].G; c[k] = -gDn;
      d[k] = -sh[k].Ih
           + (ser[k] ? ser[k].Ih : 0)
           - ((k + 1 < N && ser[k + 1]) ? ser[k + 1].Ih : 0);
    }
    if (nodeLoads) nodeLoads.forEach(q => { d[q.node] -= q.current[t]; });
    else d[N - 1] -= load[t];                                  // load drawn at the die
    // Thomas
    for (let k = 1; k < N; k++) {
      const m = a[k] / b[k - 1];
      b[k] -= m * c[k - 1];
      d[k] -= m * d[k - 1];
    }
    v[N - 1] = d[N - 1] / b[N - 1];
    for (let k = N - 2; k >= 0; k--) v[k] = (d[k] - c[k] * v[k + 1]) / b[k];
    // advance branch states with the solved voltages
    for (let k = 0; k < N; k++) {
      if (ser[k]) advance(ser[k], v[k - 1] - v[k]);
      advance(sh[k], v[k]);
    }
    vPrev.set(v);
    out[t] = v[observe === undefined ? N - 1 : observe];
  }
  return out;
}
module.exports = { solve };
