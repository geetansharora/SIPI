/* SI & PI — viz/lab-pdn.js
 * Lab C: the PDN from regulator to die.
 *
 * One ladder, five stages, six views. The ladder is K.pdnLadder in the kit and
 * the model gate cross-checks its input impedance against K.cascadeS, which is
 * an entirely separate code path — so this is a second view of one circuit
 * rather than a second circuit.
 *
 * The question this lab exists to answer is not "what is the impedance" but
 * "why is there a peak there, and which parts made it". So every panel is keyed
 * to a selected frequency: pick a peak and the topology lights up the banks that
 * are fighting each other at it, and the branch-current panel says in amps who
 * is supplying the load and who is taking current back.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const FLO = 1e3, FHI = 5e9, NF = 420;
  /* M2-4 · 6.6 us window, 152 kHz to 2.5 GHz. The record was 16384, and at that
     length the pre-event drift left by baseline subtraction was 4.412 mV against
     a 137.78 mV droop — 3.2%, which is not a footnote on a number quoted to a
     tenth of a millivolt. Doubling it costs 5.4 ms -> 9.5 ms, still inside a
     frame, and brings the drift to 0.89%. 65536 would give 0.32% but takes
     18.3 ms, which is not.

     In the legacy periodic path, the residual cause is: the VRM's control bandwidth is 120 kHz, so
     its time constant is comparable with the whole record. A periodic FFT cannot
     represent a response slower than its own window, and this is how much of
     that is left. The panel reports it per scenario rather than quoting the
     default case. */
  const DT = 200e-12, NT = 32768;
  /* The pre-event drift allowed, as a fraction of the reported droop. Beyond
     this the droop is not a number to a tenth of a millivolt and the result
     says so instead. */
  const PRE_EVENT_BUDGET = 0.02;

  const NAMES = ['VRM', 'bulk', 'board', 'package', 'die'];

  function stagesFor(p) {
    return [
      /* A regulator's closed-loop output impedance is flat at R inside its
         control bandwidth and rises above it, because that is what the loop is
         for. This models that as a series R + jwL with L chosen so that wL = R
         at the bandwidth — which IS the R + jwL family, and saying otherwise
         would be dishonest. The point is the choice of L, not the form: taking
         the datasheet inductance instead gives a huge apparent impedance at low
         frequency and invents a violent resonance against the bulk capacitors
         that no real rail has, because it ignores the loop entirely.

         What this is: a first-order teaching approximation with the right
         asymptotes and the corner in the right place. What it is not: a control
         loop. A real one has order, phase margin, peaking near crossover, and a
         response that depends on the compensation network — none of which is
         here. The contract says so, and a reader asking whether a rail is stable
         needs the regulator's own model, not this. */
      { name: 'VRM', series: null,
        shunt: { r: p.rvrm / 1000, l: (p.rvrm / 1000) / (2 * Math.PI * p.fbw * 1e3) } },
      { name: 'bulk', series: { r: 4e-4, l: 1.2e-9 },
        shunt: { r: 0.01, l: 2.5e-9, c: 47e-6, n: 4 } },
      { name: 'board', series: { r: 6e-4, l: p.lplane * 1e-12 },
        shunt: { r: p.esr / 1000, l: p.esl * 1e-12, c: p.cboard * 1e-6, n: p.nboard } },
      { name: 'package', series: { r: 8e-4, l: p.lpkg * 1e-12 },
        shunt: { r: 0.05, l: 250e-12, c: 100e-9, n: 12 } },
      { name: 'die', series: { r: 2e-3, l: 40e-12 },
        shunt: { r: 5e-3, l: 2e-12, c: p.cdie * 1e-9 } }
    ];
  }

  /* ---------- the pure model (M0-6) ----------
     The sweep, the peak search and the transient measurement all lived inside
     the closure, so N2 — a transient contaminated by the periodic FFT record —
     could only be seen by reading a canvas. Astra found roughly 3% of peak
     change and 4.4 mV of pre-event drift at 16k that largely vanished at 64k.

     Preserved as it ships. M2-4 establishes the settling requirement and splits
     droop from overshoot; M2-5 pins the convergence table. */
  /* Legacy `at` pins absolute sample indices for historical benchmarks.
     Normal use specifies onset/width in physical nanoseconds, so record
     extension does not move the stimulus. */
  function currentWaveFor(p, nt, dt, at) {
    const a = new Float64Array(nt), derivative = new Float64Array(nt);
    const t0 = at ? at.t0 : Math.round((p.startNs === undefined ? 786.4 : p.startNs) * 1e-9 / dt);
    const fall = at ? at.fall : t0 + Math.round((p.widthNs === undefined ? 1835 : p.widthNs) * 1e-9 / dt);
    const rise = Math.max(2, Math.round(p.tr * 1e-12 / dt));
    for (let i = 0; i < nt; i++) {
      const u = (i - t0) / rise, dn = (i - fall) / rise;
      const up = u <= 0 ? 0 : (u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));
      const df = dn <= 0 ? 0 : (dn >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * dn));
      a[i] = p.imax * (up - df);
      const slope = q => q <= 0 || q >= 1 ? 0 : Math.PI * Math.sin(Math.PI*q)/(2*rise*dt);
      derivative[i] = p.imax * (slope(u)-slope(dn));
    }
    return { a, derivative, t0, fall };
  }

  function findPeaks(sweep) {
    const peaks = [];
    const W = 14;
    for (let i = W; i < sweep.length - W - 1; i++) {
      let localMax = true;
      for (let j = i - 4; j <= i + 4; j++) if (j !== i && sweep[j].mag > sweep[i].mag) localMax = false;
      if (!localMax) continue;
      let lo = Infinity, hi = Infinity;
      for (let j = i - W; j < i; j++) lo = Math.min(lo, sweep[j].mag);
      for (let j = i + 1; j <= i + W; j++) hi = Math.min(hi, sweep[j].mag);
      if (sweep[i].mag > 1.08 * Math.max(lo, hi)) peaks.push(i);
    }
    return peaks.filter((i, k) => k === 0 || i - peaks[k - 1] > W);
  }

  NS.models = NS.models || {};
  /* N2-4 / R7. The default timestep is 200 ps and the edge was built as
     max(2, round(tr/dt)) samples, so a requested 200 ps edge and a requested
     400 ps edge both became two samples and produced BIT-IDENTICAL results —
     142.992954 mV droop, 69.308866 mV overshoot, for two different experiments.
     A panel inviting you to study edge rate has to realise the edge you asked
     for or say that it cannot.

     So the grid is chosen from the request: at least MIN_EDGE_SAMPLES across the
     transition, by halving dt and doubling nt, which holds the record DURATION
     fixed. That matters — refining the timestep and changing the record length
     are different experiments, and changing both at once is why a convergence
     sweep cannot separate numerical error from a different stimulus.

     EIGHT, chosen by measurement rather than taste. At four samples across a
     200 ps edge BOTH this model and the independent reference solver in
     tests/pdn-reference.js are still wrong — 144.21 and 147.69 mV against
     converged values near 143.5 and 142.6. At eight they agree to 0.29% and
     from there the difference settles to the same ~0.68% that every slower edge
     shows. Four looked adequate and was not; the cost of finding out was one
     convergence table. */
  const MIN_EDGE_SAMPLES = 8;

  function gridFor(p, opts) {
    if (opts && opts.dt) return { dt: opts.dt, nt: (opts && opts.nt) || NT };
    let div = 1;
    while (DT / div > (Math.min(p.tr, p.imax2 ? p.tr2 : p.tr) * 1e-12) / MIN_EDGE_SAMPLES && div < 8) div *= 2;
    return { dt: DT / div, nt: NT * div };
  }

  // Per-observation/mode drift measurement. Zero excitation is exactly settled;
  // cancellation uses an absolute numerical floor, not a fabricated droop ratio.
  function assess(v, start, to) {
    const stop=Math.max(1,start-8);
    let base=0; for(let i=0;i<stop;i++) base+=v[i]; base/=stop;
    let pre=0,droop=0,overshoot=0;
    for(let i=0;i<stop;i++) pre=Math.max(pre,Math.abs(v[i]-base));
    for(let i=start;i<to;i++) {droop=Math.max(droop,base-v[i]);overshoot=Math.max(overshoot,v[i]-base);}
    const fraction=pre/Math.max(droop,overshoot,1e-12);
    return {base,pre,fraction,droop,overshoot,settled:fraction<=PRE_EVENT_BUDGET};
  }

  NS.models.labPdn = function (p, opts) {
    if (p.imax2 !== undefined) {
      p=Object.assign({tr2:800,startNs:786.4,widthNs:1835,start2Ns:786.4,width2Ns:1835},p);
      const limits={imax:[0,40],tr:[200,20000],imax2:[0,40],tr2:[200,20000],startNs:[100,1500],start2Ns:[100,1500],widthNs:[100,2500],width2Ns:[100,2500]};
      if(Object.keys(limits).some(k=>!Number.isFinite(p[k])||p[k]<limits[k][0]||p[k]>limits[k][1]))
        return K.result({model:'labPdn',version:'1.3',status:'unsupported',params:p,why:'Load settings are outside the supported finite amplitude, edge or timing ranges.'});
    }
    if(opts && ((opts.dt!==undefined&&(!Number.isFinite(opts.dt)||opts.dt<=0))
        ||(opts.nt!==undefined&&(!Number.isInteger(opts.nt)||opts.nt<2||(opts.nt&(opts.nt-1))||opts.nt>2097152))
        ||(opts.method!==undefined&&!['causal','periodic'].includes(opts.method))))
      return K.result({model:'labPdn',version:'1.3',status:'unsupported',params:p,why:'Invalid numerical configuration.'});
    const networkKeys=['rvrm','fbw','lplane','lpkg','cboard','nboard','esr','esl','cdie','zt'];
    if(networkKeys.some(k=>!Number.isFinite(p[k])||p[k]<=0)||!Number.isInteger(p.nboard))
      return K.result({model:'labPdn',version:'1.3',status:'unsupported',params:p,why:'Network values must be positive and finite; capacitor count must be an integer.'});
    const causal=p.imax2!==undefined && !(opts&&opts.method==='periodic');
    const grid = gridFor(p, opts);
    const nt = (opts && opts.nt) || grid.nt;
    const dt = grid.dt;
    if (p.imax2 !== undefined && (Math.max(p.startNs+p.widthNs+p.tr/1000,p.start2Ns+p.width2Ns+p.tr2/1000)*1e-9 >= nt*dt || dt>Math.min(p.tr,p.imax2?p.tr2:p.tr)*1e-12/8))
      return K.result({model:'labPdn',version:'1.3',status:'out-of-record',params:p,why:'The two-load record must contain both pulses and resolve each active edge with at least eight samples.'});
    if(!Number.isFinite(dt)||dt<=0||!Number.isInteger(nt)||nt<2||(nt&(nt-1))||nt>2097152)
      return K.result({model:'labPdn',version:'1.3',status:'unsupported',params:p,why:'The numerical grid must have a finite positive timestep and a bounded power-of-two sample count.'});
    const stages = stagesFor(p);

    const sweep = [];
    for (let i = 0; i < NF; i++) {
      const f = FLO * Math.pow(FHI / FLO, i / (NF - 1));
      sweep.push(Object.assign({ f }, K.pdnLadder(stages, f)));
    }
    const peaks = findPeaks(sweep);
    const transfer=sweep.map(q=>({f:q.f,columns:K.pdnNodal(stages,q.f,[4,2])}));

    const wave = currentWaveFor(p, nt, dt, opts && opts.at);
    let v = p.imax2 === undefined ? K.pdnTransient(stages, wave.a, dt) : null;
    let multi=null;
    if (p.imax2 !== undefined) {
      const second=currentWaveFor({imax:p.imax2,tr:p.tr2,startNs:p.start2Ns,widthNs:p.width2Ns},nt,dt);
      const loads=[{node:4,current:wave.a,derivative:wave.derivative},{node:2,current:second.a,derivative:second.derivative}];
      const nodes=causal ? K.pdnCausalTransient(stages,loads,dt,[4,2]) : K.pdnMultiTransient(stages,loads,dt,[4,2]);
      const start=Math.min(wave.t0,p.imax2?second.t0:wave.t0);
      const to=Math.min(nt-1,Math.max(wave.fall,p.imax2?second.fall:wave.fall)+Math.round(1.44e-6/dt));
      nodes.forEach(q=>{q.stats=[assess(q.parts[0],start,to),assess(q.parts[1],start,to),assess(q.combined,start,to)];});
      multi={nodes,second,start,to,loads};
      v=Float64Array.from(nodes[0].combined,x=>-x); // legacy positive-droop internal convention
    }

    /* Legacy periodic-path accounting (zero baseline on the causal path): a pre-event average subtracted from a periodic
       record is not an AC-coupling filter and does not make the transient
       causal. Both the drift it leaves and the peak it reports are recorded so
       the contamination is a number rather than a footnote. */
    let sum = 0, cnt = 0;
    for (let i = 0; i < (multi ? multi.start : wave.t0) - 8; i++) { sum += v[i]; cnt++; }
    const base = sum / cnt;
    let preDev = 0;
    for (let i = 0; i < (multi ? multi.start : wave.t0) - 8; i++) preDev = Math.max(preDev, Math.abs(v[i] - base));

    const to = multi ? multi.to : (opts && opts.at)
      ? Math.min(nt - 1, wave.fall + Math.round((wave.fall - wave.t0) * 0.55))
      : Math.round(nt * 0.62);
    let droop = 0, overshoot = 0, worstAbs = 0;
    for (let i = multi ? multi.start : wave.t0; i < to; i++) {
      const d = v[i] - base;
      if (d > droop) droop = d;               // positive draw pulls the rail down
      if (-d > overshoot) overshoot = -d;
      worstAbs = Math.max(worstAbs, Math.abs(d));
    }

    /* M2-4 · A droop quoted to a tenth of a millivolt while 3% of it is record
       contamination is not a measurement. The fraction is computed for THIS
       scenario, not copied from the default one, and when it exceeds the budget
       the result carries a status rather than a number. */
    const preFraction = preDev / Math.max(droop,overshoot,1e-12);
    const settled = preFraction <= PRE_EVENT_BUDGET;

    return K.result({
      model: 'labPdn',
      version: '1.3',
      status: settled ? 'ok' : 'not-settled',
      why: settled ? null
        : 'pre-event drift is ' + (preFraction * 100).toFixed(1) + '% of the droop, '
          + 'above the ' + (PRE_EVENT_BUDGET * 100) + '% budget — the record is too '
          + 'short for this rail\u2019s slowest pole',
      params: {
        rvrm: p.rvrm, fbw: p.fbw, lplane: p.lplane, lpkg: p.lpkg,
        cboard: p.cboard, nboard: p.nboard, esr: p.esr, esl: p.esl,
        cdie: p.cdie, imax: p.imax, tr: p.tr, zt: p.zt,
        ...(multi ? {imax2:p.imax2,tr2:p.tr2,startNs:p.startNs,widthNs:p.widthNs,start2Ns:p.start2Ns,width2Ns:p.width2Ns} : {})
      },
      units: {
        rvrm: 'mohm', fbw: 'kHz', lplane: 'pH', lpkg: 'pH', cboard: 'uF',
        esr: 'mohm', esl: 'pH', cdie: 'nF', imax: 'A', tr: 'ps', zt: 'mohm',
        impedance: 'ohm', voltage: 'V', frequency: 'Hz',
        imax2:'A', tr2:'ps',startNs:'ns',widthNs:'ns',start2Ns:'ns',width2Ns:'ns'
      },
      conventions: {
        multiLoad: 'Load 1 withdraws at die; load 2 withdraws at board. dV_i=-sum_j Zij Ij. Frequency/branch panels retain 1 A die excitation. v-t exports uncorrected positive droop; multi traces export signed rail deviation before baseline correction. Per-node/mode drift diagnostics govern comparison measurements.',
        excitation: '1 A injected at the die node; |Z| is the driving-point '
          + 'impedance seen there',
        vrm: 'R flat inside the control bandwidth, rising as an inductor above '
          + 'it, with L = R/(2*pi*fbw) — a teaching approximation, NOT a '
          + 'control-loop model (C6/M2-11)',
        transient: causal ? 'Zero-state causal ladder response. Matrix-exponential steps integrate linearly interpolated sampled currents; analytic raised-cosine derivatives recover inductive voltage. No repeating-record tail or pre-event baseline correction is needed. Finite timestep and observation-window limits still apply.' : 'Z(f) x I(f) over a periodic FFT record of ' + (nt * dt * 1e6).toFixed(1)
          + ' us with a pre-event average subtracted. That is not an AC-coupling '
          + 'filter and does not make the response causal; what it leaves is '
          + 'measured and reported as preEventFraction (M2-4)',
        droop: 'droop (rail pulled down) and overshoot (rail pushed up) are '
          + 'SEPARATE measurements. max|dV| cannot tell them apart and is '
          + 'reported only as worstAbs (M2-4)',
        branchCurrent: 'complex phasors. Magnitudes legitimately sum past the '
          + 'injected current when banks circulate out of phase — 6.6 A for 1 A '
          + 'injected at the 6.9 MHz anti-resonance — while the complex sum is '
          + 'exactly 1 A (M2-6)'
      },
      stimulus: { numericalMethod: causal ? 'causal-state-space-foh-v1' : 'periodic-fft', kind: multi ? 'two raised-cosine load pulses' : 'raised-cosine pulse', imax: p.imax, tr: p.tr, nt: nt, dt: dt,
        dieStart:wave.t0*dt,dieFall:wave.fall*dt,boardStart:multi?multi.second.t0*dt:null,boardFall:multi?multi.second.fall*dt:null },
      origins: { t0: 0, dt: dt, fLo: FLO, fHi: FHI, nf: NF },
      valid: K.validRange(multi ? multi.start : wave.t0, to, nt, 1),
      /* N4-4. Labels with no numbers became traces carrying them. The time
         axis is built from the model's own dt, not the module default, so a
         refined grid exports the time it actually used. */
      traces: (function () {
         const fs2 = sweep.map((q) => q.f);
         const ts = []; for (let i = 0; i < nt; i++) ts.push(i * dt);
         return [
           K.trace('z-mag', '|Z| at the die', 'ohm', 'frequency', 'Hz',
                   fs2, sweep.map((q) => q.mag)),
           K.trace('z-phase', 'phase of Z', 'deg', 'frequency', 'Hz',
                   fs2, sweep.map((q) => q.phase)),
           K.trace('v-t', 'die positive droop, uncorrected', 'V', 'time', 's', ts, Array.from(v)),
           K.trace('i-t', 'die load current', 'A', 'time', 's', ts, Array.from(wave.a)),
           ...['die','board'].flatMap((observe,i)=>['die','board'].flatMap((excite,j)=>['re','im'].map(component=>
             K.trace('z-'+observe+'-'+excite+'-'+component, 'Z observe '+observe+', excite '+excite+' / '+component,
               'ohm','frequency','Hz',fs2,transfer.map(q=>q.columns[j][i===0?4:2][component]))))),
           ...(multi ? [K.trace('i2-t','board load current','A','time','s',ts,Array.from(multi.second.a)),
             ...multi.nodes.flatMap((q,j)=>[...q.parts,q.combined].map((a,k)=>K.trace('multi-'+j+'-'+k,
               ['die','board'][j]+' rail deviation / '+['load 1','load 2','combined'][k], 'V','time','s',ts,Array.from(a))))] : [])
         ];
      }()),
      measurements: {
        droop: droop, overshoot: overshoot, worstAbs: worstAbs,
        /* What the model actually built, which is not always what was asked
           for: the edge is an integer number of samples. Reported so the reader
           can see when the two differ instead of being silently rounded. */
        edgeRequestedPs: p.tr,
        edgeRealisedPs: Math.max(2, Math.round(p.tr * 1e-12 / dt)) * dt * 1e12,
        dtPs: dt * 1e12,
        edgeSamples: Math.max(2, Math.round(p.tr * 1e-12 / dt)),
        baseline: base, peakCount: peaks.length,
        peakFreqs: peaks.map((i) => sweep[i].f),
        peakMags: peaks.map((i) => sweep[i].mag),
        zAtDc: sweep[0].mag, zAtHi: sweep[NF - 1].mag,
        targetZ: p.zt / 1000, targetV: (p.zt / 1000) * p.imax
      },
      diagnostics: {
        transientMethod: causal ? 'causal-state-space-foh-v1' : 'periodic-fft',
        initialState: causal ? 'zero' : 'periodic',
        timestepConverged: null,
        measurementEndSeconds: to*dt,
        multi: multi ? multi.nodes.map(q=>q.stats) : null,
        preEventDeviation: preDev,
        preEventFraction: preFraction,
        preEventBudget: PRE_EVENT_BUDGET,
        recordLength: nt, sampleInterval: dt,
        window: nt * dt,
        settled: settled,
        known: settled ? [] : [
          'the record is too short for this rail: pre-event drift is '
            + (preFraction * 100).toFixed(1) + '% of the reported droop'
        ]
      },
      generated: { stages: stages, sweep: sweep, peaks: peaks, wave: wave, v: v,
                   nt: nt, dt: dt, multi:multi, transfer:transfer }
    });
  };

  NS.viz.labPdn = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = {};
    root.querySelectorAll('canvas[data-cv]').forEach((c) => (cv[c.dataset.cv] = c));

    const p = { rvrm: 4, fbw: 120, lplane: 900, lpkg: 350,
                cboard: 1, nboard: 20, esr: 20, esl: 1100, cdie: 200,
                imax: 8, tr: 800, zt: 10, imax2:0,tr2:800,
                startNs:786.4,widthNs:1835,start2Ns:786.4,width2Ns:1835 };
    let observe=0, compare=2, excite=0, frequencyInspector=null;
    let S = null, RES = null, T = null, sweep = null, fSel = 0, peaks = [];

    const PRESETS = {
      soc:   { rvrm: 4, fbw: 120, nboard: 20, esr: 20, esl: 1100, cdie: 200, imax: 8, zt: 10,
               note: 'A typical SoC core rail: 8 A of step, 10 mΩ target.' },
      thin:  { rvrm: 4, fbw: 120, nboard: 4, esr: 20, esl: 1100, cdie: 200, imax: 8, zt: 10,
               note: 'The same rail with most of the board capacitors deleted — watch the mid-band peak.' },
      lossy: { rvrm: 4, fbw: 120, nboard: 20, esr: 90, esl: 1100, cdie: 200, imax: 8, zt: 10,
               note: 'Deliberately lossy capacitors. Higher floor, much smaller peak — damping is a design choice.' },
      nodie: { rvrm: 4, fbw: 120, nboard: 20, esr: 20, esl: 1100, cdie: 20, imax: 8, zt: 10,
               note: 'On-die capacitance cut by ten. Nothing else changes, and the high-frequency end collapses.' }
    };

    /* N4-2. Zoom, a legend toggle and a tab switch are view operations: they
       repaint from RES rather than re-solving the ladder and the transient. */
    K.onRepaint(root, () => { if (RES) draw(); });

    function rebuild() {
      RES = K.publish(root, NS.models.labPdn(p));
      S = RES.generated.stages;
      sweep = RES.generated.sweep;
      peaks = RES.generated.peaks;
      frequencyInspector=K.traceInspector(RES.traces.find(t=>t.id==='z-mag'));
      if (!fSel) {
        fSel = sweep[peaks.length ? peaks[peaks.length - 1] : Math.round(NF * 0.7)].f;
      }
      fSel=frequencyInspector.at(fSel).x;
      syncControls();
      draw();
    }


    function syncControls() {
      const set = (id, v, txt) => { $('#' + id).value = v; $('#' + id + '-out').value = txt; };
      set('pd-fbw', p.fbw, p.fbw + ' kHz');
      set('pd-lplane', p.lplane, p.lplane + ' pH');
      set('pd-lpkg', p.lpkg, p.lpkg + ' pH');
      set('pd-nboard', p.nboard, p.nboard + '');
      set('pd-esr', p.esr, p.esr + ' mΩ');
      set('pd-esl', p.esl, p.esl + ' pH');
      set('pd-cdie', p.cdie, p.cdie + ' nF');
      set('pd-imax', p.imax, p.imax + ' A');
      /* N2-4. Show the edge the model actually built alongside the one you
         asked for. They agree across this control's range now, but saying so is
         the point: the two used to differ silently, and 200 ps and 400 ps both
         became a 400 ps two-sample edge. */
      const realised = RES && RES.measurements ? RES.measurements.edgeRealisedPs : null;
      set('pd-tr', p.tr, realised !== null && Math.abs(realised - p.tr) > 1e-9
        ? p.tr + ' ps → built as ' + realised.toFixed(0) + ' ps'
        : p.tr + ' ps');
      set('pd-zt', p.zt, p.zt + ' mΩ');
      ['imax2','tr2','startNs','widthNs','start2Ns','width2Ns'].forEach(key=>{ $('#pd-'+key).value=p[key]; });
    }

    const nearest = (f) => {
      let bi = 0, bd = Infinity;
      sweep.forEach((s, i) => { const d = Math.abs(Math.log(s.f / f)); if (d < bd) { bd = d; bi = i; } });
      return bi;
    };

    /* ---------- |Z| ---------- */
    function drawZ() {
      const s = K.canvas(cv.z, 240);
      const hi = Math.max(0.2, Math.max.apply(null, sweep.map((d) => d.mag)) * 1.6);
      const P = K.plot(s, T, {
        pad: { l: 58, r: 16, t: 18, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: 1e-4, max: hi, log: true, fmt: K.fmt.ohm, title: '|Z|' }
      }).grid();
      /* M7-2 · Driving-point AND transfer, on one plot, because they answer
         different questions and the gap between them is the lesson.

         The die's own |Z| is what a load there sees. The volts appearing at
         another node per amp drawn at the die is a transfer impedance, and at
         the 6.9 MHz anti-resonance the two are 56.6 mOhm and 1.6 mOhm — a factor
         of 35. At 100 kHz the same pair is 9.8 and 5.5, a factor of 1.8. So the
         mid-band peak is LOCAL: it barely reaches the regulator, and a
         measurement taken there would not find it.

         That is why a regulator-node transfer is not a universal quiet-rail
         model, and why "where did you probe" is the first question to ask of any
         PDN measurement. */
      /* N4-6. Each series names itself and its unit, so a probe reading is a
         MEASUREMENT — "seen at the regulator, 1.6 mOhm" — rather than a swatch
         and a number the reader has to match by eye. */
      P.trace(sweep.map((d) => [d.f, Math.max(d.branches[0].v, 1e-5)]), T.ink2,
              { width: 1.2, dash: [4, 3],
                id: 'z-vrm', label: 'seen at the regulator', unit: 'ohm' });
      P.trace(sweep.map((d) => [d.f, Math.max(d.branches[2].v, 1e-5)]), T.reflect,
              { width: 1.2, dash: [2, 3],
                id: 'z-board', label: 'seen at the board', unit: 'ohm' });
      P.trace(sweep.map((d) => [d.f, Math.max(d.mag, 1e-5)]), T.signal,
              { width: 2.2, glow: true, id: 'z-die', label: 'at the die', unit: 'ohm' });
      P.hline(p.zt / 1000, T.alarm, [5, 4], 'target ' + p.zt + ' mΩ');
      const ctx = s.ctx;
      peaks.forEach((i) => {
        K.dot(ctx, P.X(sweep[i].f), P.Y(sweep[i].mag), T.reflect, T.surface, 3.5);
      });
      const k = nearest(fSel);
      P.vline(sweep[k].f, T.ink2, [3, 3], null);
      K.dot(ctx, P.X(sweep[k].f), P.Y(Math.max(sweep[k].mag, 1e-5)), T.alarm, T.surface, 5);
      if (!P.narrow) K.text(ctx, 'click a peak', P.box.R - 2, P.box.TP + 6, T.muted, 10, 'right');
      P.frame();
      cv.z.__P = P;
    }

    /* ---------- phase ---------- */
    function drawPhase() {
      const s = K.canvas(cv.phase, 200);
      const P = K.plot(s, T, {
        pad: { l: 50, r: 16, t: 16, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: -90, max: 90, count: 4, fmt: (v) => v.toFixed(0) + '°', title: 'phase' }
      }).grid();
      P.trace(sweep.map((d) => [d.f, d.phase]), T.signal, { width: 2 });
      P.hline(0, T.muted, [4, 4], null);
      const ctx = s.ctx, B = P.box;
      if (!P.narrow) {
        K.text(ctx, 'inductive', B.L + 6, P.Y(60), T.muted, 10, 'left');
        K.text(ctx, 'capacitive', B.L + 6, P.Y(-60), T.muted, 10, 'left');
      }
      P.vline(sweep[nearest(fSel)].f, T.ink2, [3, 3], null);
      P.frame();
    }

    /* ---------- who supplies the current ---------- */
    function drawBranches() {
      const s = K.canvas(cv.branch, 200);
      /* The axis follows the data rather than clipping at 100%. At an
         anti-resonance two banks circulate far more current between themselves
         than the load is drawing — the magnitudes can each exceed 1 A while the
         complex sum is still exactly 1 A. Clipping that to 135% would hide the
         single most diagnostic thing on the panel. */
      let top = 1.15;
      sweep.forEach((d) => d.branches.forEach((b) => { if (b.i > top) top = b.i; }));
      top = Math.min(top * 1.1, 12);
      const P = K.plot(s, T, {
        pad: { l: 50, r: 16, t: 16, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: 0, max: top, count: 4, fmt: (v) => (v * 100).toFixed(0) + '%', title: 'of the load current' }
      }).grid();
      if (top > 1.2) P.hline(1, T.muted, [4, 4], '100% — above this, banks circulate');
      /* Five traces would need five colours and the palette is validated for
         two. Each bank is drawn in the same colour with a different dash, and
         labelled directly at its own peak — identity by position and label, not
         by hue. */
      /* N4-6 / R10. FOUR of these five share one colour and are told apart only
         by dash pattern — which is exactly Astra's "a cursor at 12 MHz should
         return WHICH capacitor bank". Each now carries its stage name and its
         unit, so the probe answers that, and its own id, so the legend can hide
         one without hiding the other three. */
      const dashes = [[1, 3], [4, 3], [7, 3], [2, 2], null];
      for (let b = 0; b < 5; b++) {
        P.trace(sweep.map((d) => [d.f, d.branches[b] ? d.branches[b].i : 0]),
                b === 4 ? T.signal : T.reflect,
                { width: b === 4 ? 2.2 : 1.6, dash: dashes[b],
                  id: 'i-' + NAMES[b].toLowerCase(),
                  label: NAMES[b] });
      }
      const ctx = s.ctx;
      if (!P.narrow) {
        for (let b = 0; b < 5; b++) {
          let bi = 0, bv = 0;
          sweep.forEach((d, i) => { const v = d.branches[b] ? d.branches[b].i : 0; if (v > bv) { bv = v; bi = i; } });
          if (bv > 0.25) K.text(ctx, NAMES[b], P.X(sweep[bi].f), P.Y(Math.min(top * 0.96, bv)) - 9,
                                b === 4 ? T.signal : T.reflect, 10, 'center');
        }
      }
      P.vline(sweep[nearest(fSel)].f, T.ink2, [3, 3], null);
      P.frame();
    }

    /* ---------- the topology, annotated at the selected frequency ---------- */
    function drawTopo() {
      const s = K.canvas(cv.topo, 200);
      const ctx = s.ctx, w = s.w, h = s.h;
      ctx.clearRect(0, 0, w, h);
      const d = sweep[nearest(fSel)];
      const railY = 40, gndY = h - 34;
      const x = (i) => 36 + i * ((w - 72) / 4);

      K.line(ctx, x(0), railY, x(4), railY, T.ink2, 2);
      K.line(ctx, x(0), gndY, x(4), gndY, T.ink2, 2);
      K.text(ctx, 'rail', 6, railY, T.muted, 10, 'left');
      K.text(ctx, 'ground', 6, gndY, T.muted, 10, 'left');

      const share = d.branches.map((b) => b.i);
      const top = Math.max.apply(null, share) || 1;
      for (let i = 0; i < 5; i++) {
        const frac = share[i] / top;
        const on = frac > 0.28;
        const col = on ? (i === 4 ? T.signal : T.reflect) : T.grid;
        K.line(ctx, x(i), railY, x(i), gndY, col, on ? 3 : 1.2);
        // the element body
        ctx.save();
        ctx.fillStyle = T.surface; ctx.strokeStyle = col; ctx.lineWidth = on ? 2 : 1;
        const bw = 26, bh = 20, by = (railY + gndY) / 2 - bh / 2;
        ctx.beginPath(); ctx.rect(x(i) - bw / 2, by, bw, bh); ctx.fill(); ctx.stroke();
        ctx.restore();
        K.text(ctx, NAMES[i], x(i), gndY + 13, on ? T.ink : T.muted, 10, 'center');
        K.text(ctx, (share[i] * 100).toFixed(0) + '%', x(i), (railY + gndY) / 2, col, 10, 'center');
        if (i < 4) {
          K.text(ctx, '⌁', (x(i) + x(i + 1)) / 2, railY - 11, T.muted, 12, 'center');
        }
      }
      K.text(ctx, '↓ L1', x(4), railY-12, T.signal, 10, 'center');
      K.text(ctx, '↓ L2 '+(p.imax2?'on':'off'), x(2),railY-12,T.reflect,10,'center');
      K.dot(ctx,x(observe===0?4:2),railY,T.alarm,T.surface,5);
      K.text(ctx,'observe '+(observe===0?'die':'board'),6,14,T.alarm,10,'left');
      K.text(ctx, 'at ' + K.fmt.hz(d.f) + ' · |Z| = ' + K.fmt.ohm(d.mag),
             w - 6, 14, T.ink2, 10, 'right');
    }

    /* ---------- the transient ---------- */

    /* M2-4 · Reads the model's own transient rather than recomputing one, shows
       the CURRENT that caused it on the same time axis, and marks droop and
       overshoot separately. The old version reported max|dV| as "droop", which
       cannot tell a rail pulled down from one pushed up — and on the default
       preset those are 143.0 mV and 69.3 mV, not one number. */
    function drawTransient() {
      const g = RES.generated;
      const v = g.v, wave = g.wave, base = RES.measurements
        ? RES.measurements.baseline : 0;
      /* N2-4. The record length now follows the requested edge, so these must
         come from the model's own grid. Reading the module constants built a
         window past the end of a refined record — `RangeError: Invalid array
         length` on the first control change, caught by the browser sweep and
         invisible to every model assertion. */
      const NTv = RES.generated.nt, DTv = RES.generated.dt;
      const from = Math.max(0, (g.multi ? g.multi.start : wave.t0) - Math.round(NTv * 0.04));
      const to = g.multi ? g.multi.to : Math.min(NTv - 1, Math.round(NTv * 0.62));

      let lo = 0, hi = 0;
      for (let i = from; i < to; i++) { const d = v[i] - base; if (d < lo) lo = d; if (d > hi) hi = d; }
      const pad = Math.max(2e-3, (hi - lo) * 0.18);

      const s = K.canvas(cv.vt, 210);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 52, t: 16, b: 30 },
        x: { min: 0, max: (to - from) * DTv * 1e9, count: 5, fmt: (x2) => x2.toFixed(0), title: 'ns from view start' },
        y: { min: -(hi + pad), max: -(lo - pad), count: 4, fmt: (y2) => (y2 * 1000).toFixed(0), title: 'mV' }
      }).grid();

      /* The stimulus, drawn on its own scale against the right edge. A rail
         excursion without the current that caused it is half an experiment. */
      const iMax = Math.max(1e-9, p.imax);
      const yTop = -(hi + pad), yBot = -(lo - pad);
      P.trace((i) => [i * DTv * 1e9,
                      yTop + (wave.a[from + i] / iMax) * (yBot - yTop) * 0.22],
              T.ink2, { n: to - from, width: 1.4, dash: [4, 3] });
      K.text(P.ctx, p.imax.toFixed(0) + ' A', P.box.R + 6, P.Y(yTop) + 10, T.ink2, 10, 'left');
      K.text(P.ctx, 'I die', P.box.R + 6, P.Y(yTop) - 2, T.ink2, 10, 'left');

      // drawn as a droop: a positive current draw pulls the rail down
      P.trace((i) => [i * DTv * 1e9, -(v[from + i] - base)], T.signal,
              { n: to - from, width: 2.2, glow: true });
      const rip = p.zt / 1000 * p.imax;
      if (!p.imax2) P.hline(-rip, T.alarm, [5, 4], 'target Z × I');
      P.hline(0, T.muted, [4, 4], null);

      if (RES.measurements) {
        P.hline(-RES.measurements.droop, T.reflect, [2, 3], 'worst droop');
        if (RES.measurements.overshoot > 0.05 * RES.measurements.droop) {
          P.hline(RES.measurements.overshoot, T.reflect, [2, 3], 'overshoot');
        }
      }
      P.frame();
      return { base, v, from, to };
    }

    function drawSpectrum(wave) {
      const NTs = RES.generated.nt, DTs = RES.generated.dt;
      const re = Float64Array.from(wave.a), im = new Float64Array(NTs);
      K.fft(re, im, false);
      const s = K.canvas(cv.spec, 210);
      const pts = [];
      for (let k = 1; k <= NTs / 2; k++) {
        const f = k / (NTs * DTs);
        if (f < FLO || f > FHI) continue;
        pts.push([f, Math.hypot(re[k], im[k]) * 2 / NTs]);
      }
      const hi = Math.max.apply(null, pts.map((q) => q[1]));
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 16, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: hi * 1e-5, max: hi * 2, log: true, fmt: (v2) => (v2 * 1000).toFixed(0), title: 'mA' }
      }).grid();
      P.trace(pts, T.reflect, { width: 1.6 });
      P.vline(sweep[nearest(fSel)].f, T.ink2, [3, 3], null);
      P.frame();
    }

    function readouts() {
      const d = sweep[nearest(fSel)];
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      /* The worst PEAK, not the worst sample. |Z| rises monotonically at the top
         of the sweep because the die capacitor's own ESL takes over, so the
         global maximum is always the last point — 5 GHz, where no load draws
         anything. Reporting that as "the worst impedance" is a number with no
         consequence attached to it. */
      let worstF = null;
      peaks.forEach((i) => { if (!worstF || sweep[i].mag > worstF.mag) worstF = sweep[i]; });
      if (!worstF) {
        worstF = sweep[0];
        sweep.forEach((q) => { if (q.mag > worstF.mag) worstF = q; });
      }
      set('zpk', K.fmt.ohm(worstF.mag) + ' at ' + K.fmt.hz(worstF.f));
      set('knee', K.fmt.hz(0.5 / (p.tr * 1e-12)));
      set('zsel', K.fmt.ohm(d.mag));
      set('fsel', K.fmt.hz(d.f));
      set('ph', d.phase.toFixed(0) + '°');
      set('zt', K.fmt.ohm(worstF.mag / (p.zt / 1000)) .replace(' Ω', '×'));
      /* M2-4 · two numbers, because they are two things. */
      const m = RES.measurements;
      if (m) {
        set('droop', (m.droop * 1000).toFixed(1) + ' mV');
        set('overshoot', (m.overshoot * 1000).toFixed(1) + ' mV');
        set('quality', RES.diagnostics.initialState==='zero' ? 'Causal from rest · finite timestep and observation window' : 'Baseline drift within budget · '
            + (RES.diagnostics.preEventFraction * 100).toFixed(2) + '% pre-event drift');
      } else {
        set('droop', 'withheld: excessive pre-event drift');
        set('overshoot', '—');
        set('quality', RES.why || 'Excessive pre-event drift; measurements withheld');
      }
      const zt = $('[data-out="zt"]');
      if (zt) zt.style.color = worstF.mag > p.zt / 1000 ? 'var(--alarm-text)' : 'var(--ink)';

      /* M2-6 · the phase is shown, because it is what says whether a bank is
         supplying the load or circulating against its neighbour. Magnitudes
         alone cannot distinguish those, and at an anti-resonance they sum to
         several times the load current while the complex sum is exactly 1 A. */
      let sr = 0, si = 0;
      d.branches.forEach((b) => { sr += b.ir; si += b.ii; });
      const rows = d.branches.map((b, i) => ({
        label: NAMES[i],
        value: (b.i * 100).toFixed(0) + '%'
                 + (b.i > 1.05 ? ' \u2014 circulating' : ' of the load current'),
        note: b.phase.toFixed(0) + '\u00b0 \u00b7 ' + K.fmt.ohm(b.v / Math.max(b.i, 1e-12)) + ' branch',
        colour: i === 4 ? 'signal' : (b.i > 0.25 ? 'reflect' : 'muted')
      }));
      rows.push({ label: 'the five phasors, summed',
                  value: Math.hypot(sr, si).toFixed(4) + ' A',
                  note: 'exactly the 1 A injected \u2014 what the magnitudes cannot show' });

      /* M6-9 · An explanation computed from THIS circuit at THIS frequency,
         rather than a fixed "each bank hands off to the next" story. The
         handoff narrative is usually right and is not always right, and a panel
         that recites it cannot tell you which case you are looking at.

         Three questions, all answered from the phasors the ladder returned:
         which branch is actually supplying the current, which branch is
         dissipating (the real part of V*conj(I) per branch), and whether any
         pair is circulating against the load rather than feeding it. */
      const dom = d.branches.reduce((a, b, i) =>
        (b.i > d.branches[a].i ? i : a), 0);
      /* Power into each branch: Re(V * conj(I)). A branch with a large current
         and a small real power is storing and returning energy, not supplying
         it — which is exactly the distinction a magnitude cannot show. */
      const diss = d.branches.map((b) => b.vr * b.ir + b.vi * b.ii);
      const damp = diss.reduce((a, v, i) => (v > diss[a] ? i : a), 0);
      const circulating = d.branches
        .map((b, i) => ({ i, name: NAMES[i], mag: b.i,
                          feeding: (b.vr * b.ir + b.vi * b.ii) > 0 }))
        .filter((x) => x.mag > 0.6 && !x.feeding);

      rows.push({
        label: 'what is happening here',
        value: NAMES[dom] + ' carries the current',
        note: (damp === dom
                ? 'and dissipates the most of it, so this band is that bank\u2019s own'
                : NAMES[damp] + ' dissipates the most, so the damping is coming from '
                  + 'somewhere other than the bank supplying the load')
              + (circulating.length
                  ? ' \u00b7 ' + circulating.map((x) => x.name).join(' and ')
                    + (circulating.length > 1 ? ' are' : ' is')
                    + ' returning energy rather than supplying it'
                  : ''),
        colour: circulating.length ? 'alarm' : 'signal'
      });
      rows.push({ label: 'transfer impedance to the VRM node',
                  value: K.fmt.ohm(d.zTransfer),
                  note: 'volts there per amp drawn here' });
      K.summary(root, rows, { label: 'At ' + K.fmt.hz(d.f) });
    }

    function drawMulti() {
      const g=RES.generated, m=g.multi; if(!m) return;
      const q=m.nodes[observe], selected=compare===2?q.combined:q.parts[compare], st=q.stats[compare];
      const from=Math.max(0,m.start-Math.round(0.15e-6/g.dt)), to=m.to;
      let lo=0,hi=0;
      m.nodes.forEach(node=>[...node.parts,node.combined].forEach((a,k)=>{
        for(let i=from;i<to;i++){const v=a[i]-node.stats[k].base;lo=Math.min(lo,v);hi=Math.max(hi,v);}
      }));
      const pad=Math.max(.002,(hi-lo)*.12);
      const P=K.plot(K.canvas(cv.multi,230),T,{
        x:{min:from*g.dt*1e9,max:to*g.dt*1e9,count:4,fmt:x=>x.toFixed(0),title:'ns from record start'},
        y:{min:lo-pad,max:hi+pad,count:4,fmt:y=>(y*1000).toFixed(0),title:'rail ΔV (mV)'}
      }).grid();
      P.trace(i=>[(from+i)*g.dt*1e9,selected[from+i]-st.base],T.signal,
        {n:to-from,width:2,id:'selected-rail',label:['die','board'][observe]+' rail deviation',unit:'mV'});
      P.hline(0,T.muted,[3,3]);P.frame();
      const C=K.plot(K.canvas(cv.loads,170),T,{
        x:{min:from*g.dt*1e9,max:to*g.dt*1e9,count:4,fmt:x=>x.toFixed(0),title:'same record time (ns)'},
        y:{min:0,max:Math.max(1,p.imax,p.imax2)*1.15,count:3,fmt:y=>y.toFixed(1),title:'withdrawal (A)'}
      }).grid();
      [g.wave.a,m.second.a].forEach((a,k)=>C.trace(i=>[(from+i)*g.dt*1e9,a[from+i]],k?T.reflect:T.signal,
        {n:to-from,width:2,dash:k?[5,3]:[],id:'load-'+k,label:k?'board load 2':'die load 1',unit:'A'}));C.frame();
      const z=RES.generated.transfer[nearest(fSel)].columns[excite][observe===0?4:2];
      $('[data-out="multi-detail"]').textContent='Observe '+['die','board'][observe]+', excite '+['die','board'][excite]
        +': |Z| '+K.fmt.ohm(Math.hypot(z.re,z.im))+' at '+K.fmt.hz(fSel)+'; phase '+(Math.atan2(z.im,z.re)*180/Math.PI).toFixed(1)+'°. '
        +['Load 1 alone','Load 2 alone','Combined loads'][compare]+': '
        +(st.settled?'Causal from rest; droop '+(st.droop*1000).toFixed(1)+' mV; overshoot '+(st.overshoot*1000).toFixed(1)+' mV. ':'Excessive pre-event drift; measurements withheld. ')
        +'Peaks cover '+(m.start*g.dt*1e9).toFixed(1)+'–'+(m.to*g.dt*1e9).toFixed(1)+' ns; timestep convergence is not inferred from a quiet baseline. '
        +'Both observations and all modes share fixed voltage bounds; currents below show both configured stimuli. '
        +'Built edges: die '+(Math.max(2,Math.round(p.tr*1e-12/g.dt))*g.dt*1e12).toFixed(0)+' ps, board '
        +(Math.max(2,Math.round(p.tr2*1e-12/g.dt))*g.dt*1e12).toFixed(0)+' ps.';
    }

    function selectFrequency(f) {
      const q=frequencyInspector.at(f);
      if(q.status!=='ok') {$('[data-out="transfer-detail"]').textContent='Enter a frequency within the sampled range; the previous selection is unchanged.';return;}
      fSel=q.x;draw();
    }
    function drawTransfer() {
      ['pd-observe','pd-transfer-observe'].forEach(id=>$('#'+id).value=observe);
      ['pd-excite','pd-transfer-excite'].forEach(id=>$('#'+id).value=excite);
      const rows=RES.generated.transfer, node=observe===0?4:2;
      const values=rows.map(q=>q.columns[excite][node]);
      // Common bounds across all four pairs prevent visual rescaling on selection.
      let lo=Infinity,hi=0;
      rows.forEach(q=>q.columns.forEach(col=>[4,2].forEach(i=>{
        const v=Math.hypot(col[i].re,col[i].im);if(v>0)lo=Math.min(lo,v);hi=Math.max(hi,v);
      })));
      const P=K.plot(K.canvas(cv.transferZ,230),T,{
        pad:{l:66,r:16,t:18,b:30},
        x:{min:FLO,max:FHI,log:true,fmt:K.fmt.hz,title:'frequency'},
        y:{min:Math.max(1e-12,lo/1.5),max:Math.max(1e-11,hi*1.5),log:true,fmt:K.fmt.ohm,title:'|Z|'}
      }).grid();
      const label='observe '+['die','board'][observe]+', excite '+['die','board'][excite];
      P.trace(rows.map((q,i)=>[q.f,Math.hypot(values[i].re,values[i].im)]),T.signal,{width:2,id:'selected-transfer',label,unit:'ohm'});
      P.vline(fSel,T.alarm,[2,3],'selected');P.frame();cv.transferZ.__frequencyPlot=cv.transferZ.__plot;
      const k=nearest(fSel), z=values[k];$('#pd-frequency').value=fSel;
      $('[data-out="transfer-detail"]').textContent=label+'. Native sample '+k+' at '+fSel.toPrecision(7)+' Hz: '
        +'Re(Z) '+K.fmt.ohm(z.re)+'; Im(Z) '+K.fmt.ohm(z.im)+'; |Z| '+K.fmt.ohm(Math.hypot(z.re,z.im))
        +'; phase '+(Math.atan2(z.im,z.re)*180/Math.PI).toFixed(2)+'°. '
        +(observe===excite?'Driving-point impedance. ':'Transfer impedance. ')
        +'Nearest sample in physical frequency; no interpolation. Positive withdrawal produces ΔV = −Z I. '
        +'Observation and excitation selectors in the two-load panel also control this spectrum.';
    }
    $('#pd-frequency').addEventListener('change',e=>selectFrequency(e.target.value===''?NaN:Number(e.target.value)));
    $('#pd-frequency-go').addEventListener('click',()=>{const el=$('#pd-frequency');selectFrequency(el.value===''?NaN:Number(el.value)*1);});
    $('#pd-frequency').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#pd-frequency-go').click();}});
    [['pd-frequency-prev',-1],['pd-frequency-next',1]].forEach(([id,step])=>$('#'+id).addEventListener('click',()=>{
      selectFrequency(sweep[Math.max(0,Math.min(sweep.length-1,nearest(fSel)+step))].f);
    }));
    $('#pd-frequency-fit').addEventListener('click',()=>{delete cv.transferZ.__zoom;draw();});
    cv.transferZ.tabIndex=0;
    cv.transferZ.addEventListener('keydown',e=>{
      const step=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
      if(step){e.preventDefault();selectFrequency(sweep[Math.max(0,Math.min(sweep.length-1,nearest(fSel)+step))].f);}
    });
    cv.transferZ.addEventListener('click',e=>{
      const P=cv.transferZ.__frequencyPlot,r=cv.transferZ.getBoundingClientRect();if(!P||!r.width)return;
      const px=(e.clientX-r.left)*P.box.w/r.width;
      if(px>=P.box.L&&px<=P.box.R)selectFrequency(P.invX(px));
    });

    function draw() {
      T = K.theme(root);
      drawZ(); drawPhase(); drawBranches(); drawTopo();
      drawTransient(); drawMulti(); drawTransfer();
      drawSpectrum(RES.generated.wave);
      readouts();
    }

    /* ---------- pick a peak ---------- */
    cv.z.addEventListener('click', (e) => {
      const P = cv.z.__P; if (!P) return;
      const r = cv.z.getBoundingClientRect();
      if (!(r.width > 0)) return;
      const scale = r.width / P.box.w;
      const px = (e.clientX - r.left) / scale;
      /* Snap to a peak when the click is near one — that is what a reader means
         by clicking a peak — and otherwise take the frequency under the pointer. */
      let best = null, bd = Infinity;
      peaks.forEach((i) => { const d = Math.abs(P.X(sweep[i].f) - px); if (d < bd) { bd = d; best = i; } });
      if (best !== null && bd < 22) { fSel = sweep[best].f; draw(); return; }
      const frac = (px - P.box.L) / (P.box.R - P.box.L);
      if (frac >= 0 && frac <= 1) { selectFrequency(cv.z.__plot.invX(px)); }
    });
    cv.z.tabIndex = 0;
    cv.z.addEventListener('keydown', (e) => {
      if (!peaks.length) return;
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      let at = 0, bd = Infinity;
      peaks.forEach((i, j) => { const q = Math.abs(Math.log(sweep[i].f / fSel)); if (q < bd) { bd = q; at = j; } });
      fSel = sweep[peaks[Math.max(0, Math.min(peaks.length - 1, at + d))]].f;
      draw();
    });

    /* ---------- controls ---------- */
    [['pd-fbw', 'fbw'], ['pd-lplane', 'lplane'], ['pd-lpkg', 'lpkg'], ['pd-nboard', 'nboard'],
     ['pd-esr', 'esr'], ['pd-esl', 'esl'], ['pd-cdie', 'cdie'], ['pd-imax', 'imax'],
     ['pd-tr', 'tr'], ['pd-zt', 'zt']
    ].forEach(([id, key]) => {
      $('#' + id).addEventListener('input', (e) => { p[key] = +e.target.value; clearPreset(); rebuild(); });
    });

    ['imax2','tr2','startNs','widthNs','start2Ns','width2Ns'].forEach(key=>{
      const el=$('#pd-'+key);
      el.addEventListener('change',()=>{
        const value=Number(el.value);
        if (el.value === '' || !Number.isFinite(value) || value<Number(el.min) || value>Number(el.max)) {el.value=p[key];return;}
        p[key]=value; clearPreset(); rebuild();
      });
      // Scenario replay uses input for numeric controls.
      el.addEventListener('input',e=>{if (!e.isTrusted) el.dispatchEvent(new Event('change'));});
    });
    [['pd-observe',v=>observe=Number(v)],['pd-compare',v=>compare=Number(v)],['pd-excite',v=>excite=Number(v)],
     ['pd-transfer-observe',v=>observe=Number(v)],['pd-transfer-excite',v=>excite=Number(v)]].forEach(([id,update])=>{
      $('#'+id).addEventListener('change',e=>{update(e.target.value);draw();});
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const q = PRESETS[b.dataset.preset];
        /* A `.preset` without a data-preset is not a preset — the sweep button
           on Lab B is one. Reading straight from the table threw on it. */
        if (!q) return;
        Object.assign(p, q, {imax2:0,tr2:800,startNs:786.4,widthNs:1835,start2Ns:786.4,width2Ns:1835});
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = q.note;
        rebuild();
      });
    });

    Object.assign(p, PRESETS.soc);
    rebuild();
    $('[data-out="note"]').textContent = PRESETS.soc.note;
    root.querySelector('.preset[data-preset="soc"]').setAttribute('aria-pressed', 'true');

    document.addEventListener('sipi:theme', draw);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 140); };
    window.addEventListener('resize', onResize);

    return {
      start() {}, stop() {},
      destroy() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('sipi:theme', draw);
      }
    };
  };
})();
