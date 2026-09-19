/* SI & PI — viz/real-caps.js
 * One real capacitor on a real board: what the marking promises, what the part
 * delivers at your operating point, and how wide the gap between them is.
 *
 * Contract: docs/real-capacitor-model.md. Read clause 4 before adding a derating
 * curve here. This panel deliberately does NOT know your derating — it takes the
 * retained fraction from you, because Novak et al. measured the same nominal part
 * from different vendors behaving very differently, so any single shipped curve
 * would teach that derating is a lookup. It is not. It is a band you must bound.
 *
 * Everything computed here is exact given that input:
 *   Z(f) = ESR(f) + j( 2πf·Ltot − 1/(2πf·Ceff) )      Ltot = ESL_part + L_mount
 * The mounting loop comes from K.viaLoopInductance — the same helper the return-path
 * panel uses, so the two cannot drift apart.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const F_LO = 1e3, F_HI = 1e8, NF = 260;

  /* The board the mounting loop is computed on. Fixed, and stated on the panel,
     so that the spacing slider moves one thing only. */
  const BOARD_T = 1.6e-3;     // finished thickness, m
  const VIA_R = 0.15e-3;      // drilled barrel radius, m

  function readTheme(el) {
    const cs = getComputedStyle(el), g = (n) => cs.getPropertyValue(n).trim();
    return { ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'),
             signal: g('--signal'), reflect: g('--reflect'), alarm: g('--alarm'),
             grid: g('--grid'), border: g('--border'), surface: g('--surface') };
  }

  function fmtOhm(z) {
    if (!isFinite(z)) return '—';
    if (z >= 1) return z.toFixed(2) + ' Ω';
    if (z >= 1e-3) return (z * 1e3).toFixed(1) + ' mΩ';
    return (z * 1e6).toFixed(0) + ' µΩ';
  }
  function fmtHz(f) {
    if (!isFinite(f)) return '—';
    if (f >= 1e6) return (f / 1e6).toFixed(2) + ' MHz';
    if (f >= 1e3) return (f / 1e3).toFixed(0) + ' kHz';
    return f.toFixed(0) + ' Hz';
  }
  function fmtF(c) {
    if (c >= 1e-6) return (c * 1e6).toFixed(2) + ' µF';
    if (c >= 1e-9) return (c * 1e9).toFixed(1) + ' nF';
    return (c * 1e12).toFixed(0) + ' pF';
  }

  NS.viz.realCaps = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="zplot"]');
    let T = null;

    const p = { partId: 'grm188-22u', retained: 0.55, band: 0.15,
                eslPart: 600e-12, spacing: 1.0e-3 };

    const PRESETS = {
      marked: { retained: 1.0, band: 0, spacing: 1.0e-3,
        note: 'Marked value with no derating or tolerance bound. This is the curve produced when a simulation uses the nominal marking alone; a real assembled board also includes bias, tolerance, temperature, and mounting effects.' },
      classII: { retained: 0.70, band: 0.10, spacing: 1.0e-3,
        note: 'The historic Class II bracket — Novak et al. record "a modest 20 to 40% maximum capacitance degradation over the full DC working range" for parts of that era. Even this mild band moves the resonance visibly.' },
      today: { retained: 0.35, band: 0.15, spacing: 1.0e-3,
        note: 'Today’s high-density Class II. The same paper finds X5R and X7R now "exhibit capacitance drops, which were previously seen mostly from Class III ceramics" — losses of 60% and beyond. The band is wide because the spread between vendors is wide.' },
      badmount: { retained: 0.35, band: 0.15, spacing: 3.0e-3,
        note: 'Same derating, the return via moved 3 mm away. Mounting inductance now dominates the loop, the resonance falls, and the floor above it rises everywhere — a placement error that no choice of part recovers.' }
    };

    function mountL() { return K.viaLoopInductance(BOARD_T, VIA_R, p.spacing); }
    function part() { return K.REAL_CAP_PARTS.find((x) => x.id === p.partId); }

    function run() {
      const lo = Math.max(0.02, p.retained - p.band);
      const hi = Math.min(1.0, p.retained + p.band);
      return K.realCap({
        part: part(), retained: p.retained,
        eslPart: p.eslPart, lMount: mountL(),
        esrMin: 3e-3, fEsrMin: 2e6,
        bandLo: lo, bandHi: hi,
        n: NF, fLo: F_LO, fHi: F_HI
      });
    }

    let res = K.publish(root, run());

    function sync() {
      res = K.publish(root, run());
      const pt = part();
      const m = res.measurements;

      $('#rc-retained').value = Math.round(p.retained * 100);
      $('#rc-retained-out').value = Math.round(p.retained * 100) + '% retained';
      $('#rc-band').value = Math.round(p.band * 100);
      $('#rc-band-out').value = '± ' + Math.round(p.band * 100) + ' points';
      $('#rc-esl').value = Math.round(p.eslPart * 1e12);
      $('#rc-esl-out').value = (p.eslPart * 1e12).toFixed(0) + ' pH';
      $('#rc-spacing').value = Math.round(p.spacing * 1e6);
      $('#rc-spacing-out').value = (p.spacing * 1e3).toFixed(2) + ' mm';
      $('#rc-part').value = p.partId;

      $('[data-out="marked"]').textContent = fmtF(pt.cNom);
      $('[data-out="ceff"]').textContent = m ? fmtF(m.cEff) : '—';
      $('[data-out="srf"]').textContent = m
        ? fmtHz(m.srfMarked) + ' → ' + fmtHz(m.srfEffective) : '—';
      $('[data-out="shift"]').textContent = m ? '×' + m.srfRatio.toFixed(2) : '—';
      $('[data-out="zsrf"]').textContent = m ? fmtOhm(m.zAtSrf) : '—';
      $('[data-out="mount"]').textContent = m
        ? (m.mountShare * 100).toFixed(0) + '% of ' + (m.lTot * 1e9).toFixed(2) + ' nH' : '—';
      $('[data-out="rating"]').textContent = pt.vRated.toFixed(1) + ' V ' + pt.dielectric
        + ' · ' + pt.size;

      render();
    }

    /* N4-2. A view operation repaints the plot from `res`; it does not re-run
       the model or disturb the selected preset. */
    K.onRepaint(root, () => { if (res) render(); });

    function render() {
      if (!T) T = readTheme(root);
      const s = K.canvas(cv, 300);
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);

      const P = K.plot(s, T, {
        x: { min: F_LO, max: F_HI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: 1e-3, max: 1e2, log: true, fmt: K.fmt.ohm, title: '|Z|' }
      });
      P.grid();

      const tr = (id) => res.traces.find((t) => t.id === id);
      const marked = tr('z-marked'), eff = tr('z-effective');
      const bLo = tr('z-band-lo'), bHi = tr('z-band-hi');

      if (bLo && bHi && p.band > 0) {
        /* The band is the honest part of this picture: every curve inside it is
           consistent with what you actually know about the part. */
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < bHi.x.values.length; i++) {
          const X = P.X(bHi.x.values[i]), Y = P.Y(bHi.y[i]);
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        for (let i = bLo.x.values.length - 1; i >= 0; i--) ctx.lineTo(P.X(bLo.x.values[i]), P.Y(bLo.y[i]));
        ctx.closePath();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = T.reflect;
        ctx.fill();
        ctx.restore();
      }

      if (marked) {
        P.trace(marked.x.values.map((f, i) => [f, marked.y[i]]), T.muted,
                { dash: [5, 4], width: 1.5, label: 'as marked' });
      }
      if (eff) {
        P.trace(eff.x.values.map((f, i) => [f, eff.y[i]]), T.signal,
                { width: 2, label: 'at your operating point' });
      }

      const m = res.measurements;
      if (m) {
        P.vline(m.srfMarked, T.muted, [3, 3], null);
        P.vline(m.srfEffective, T.reflect, [3, 3], 'SRF');
      }
    }

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }

    const bound = [];
    function on(sel, ev, fn) {
      const el = $(sel);
      if (!el) return;
      el.addEventListener(ev, fn);
      bound.push([el, ev, fn]);
    }

    on('#rc-part', 'change', (e) => { p.partId = e.target.value; clearPreset(); sync(); });
    on('#rc-retained', 'input', (e) => { p.retained = +e.target.value / 100; clearPreset(); sync(); });
    on('#rc-band', 'input', (e) => { p.band = +e.target.value / 100; clearPreset(); sync(); });
    on('#rc-esl', 'input', (e) => { p.eslPart = +e.target.value * 1e-12; clearPreset(); sync(); });
    on('#rc-spacing', 'input', (e) => { p.spacing = +e.target.value * 1e-6; clearPreset(); sync(); });

    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      const fn = () => {
        /* Guarded: a .preset with no matching entry is a markup bug, and it used
           to throw here in ten modules at once. M7's finding. */
        const cfg = PRESETS[b.dataset.preset];
        if (!cfg) return;
        Object.assign(p, { retained: cfg.retained, band: cfg.band, spacing: cfg.spacing });
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        sync();
        $('[data-out="note"]').textContent = cfg.note;
      };
      b.addEventListener('click', fn);
      bound.push([b, 'click', fn]);
    });

    function onTheme() { T = null; sync(); }
    window.addEventListener('sipi:theme', onTheme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);
    const onResize = () => render();
    window.addEventListener('resize', onResize);

    sync();
    /* N4-1: the panel publishes through the kit now, so the loader reads one
       object rather than a per-module convention. */

    return {
      start() {},
      stop() {},
      destroy() {
        window.removeEventListener('sipi:theme', onTheme);
        mq.removeEventListener('change', onTheme);
        window.removeEventListener('resize', onResize);
        bound.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
        bound.length = 0;
      }
    };
  };
})();
