/* SI & PI — viz/critical-length.js
 * When does a trace become a transmission line? Two views of one inequality.
 *
 * Exact arithmetic, no model: t_pd = 84.72·√Dk_eff ps/inch gives 147 ps/inch for
 * microstrip (Dk_eff ≈ 3.0) and 173 ps/inch for stripline (Dk ≈ 4.2). The rule is
 *     2·T_d > t_r / 3      ⇔      l > t_r / (6·t_pd)
 * Panel 1 plots that boundary. Panel 2 draws the two times against each other so
 * the inequality is something you can see rather than evaluate.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const TPD = { microstrip: 5.787, stripline: 6.811 };   // ps per mm
  const L_LO = 0.5, L_HI = 500;                          // mm
  const TR_LO = 10, TR_HI = 5000;                        // ps

  function crit(tr, tpd) { return tr / (6 * tpd); }      // mm

  NS.viz.criticalLength = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvMap = $('[data-cv="map"]'), cvBar = $('[data-cv="bars"]');

    const PRESETS = {
      reset:  { len: 200, tr: 1000, strip: true,
        note: 'An 8-inch reset line is electrically long even with a 1 ns edge, so low switching rate alone does not make it lumped.' },
      ddr:    { len: 25,  tr: 100,  strip: true,
        note: 'A 25 mm DDR net with a 100 ps edge — 34× longer than critical, placing it clearly in the distributed regime.' },
      short:  { len: 3,   tr: 800,  strip: false,
        note: 'A 3 mm microstrip stub off a slow buffer. Genuinely lumped — no termination needed.' },
      edge:   { len: 5,   tr: 180,  strip: true,
        note: 'Right at the boundary. This is where the /3 in the rule stops being a detail.' }
    };

    /* Derived from the preset shown as selected. Declaring the same values a
       second time by hand works until one copy is edited and the other is not. */
    const p = Object.assign({}, PRESETS.ddr); delete p.note;

    function tpd() { return p.strip ? TPD.stripline : TPD.microstrip; }
    function td() { return p.len * tpd(); }              // ps, one way

    /* ---------- panel 1: the boundary ---------- */
    function drawMap(T) {
      const s = K.canvas(cvMap, 250);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 18, b: 32 },
        x: { min: TR_LO, max: TR_HI, log: true, fmt: (v) => v >= 1000 ? (v / 1000) + ' ns' : v + ' ps', title: 'rise time' },
        y: { min: L_LO, max: L_HI, log: true, fmt: (v) => v >= 1 ? v + ' mm' : v + '', title: 'length' }
      }).grid();

      // the boundary, for both stackups
      const curve = (k) => {
        const pts = [];
        for (let i = 0; i <= 120; i++) {
          const tr = TR_LO * Math.pow(TR_HI / TR_LO, i / 120);
          pts.push([tr, crit(tr, k)]);
        }
        return pts;
      };
      const ctx = s.ctx, B = P.box;

      /* N4-5. This region and the boundary line share one colour, so under
         colour-keyed suppression the loader had to disable BOTH legend toggles —
         which left this panel with none at all. Each now carries its own series
         id and is independently addressable.

         The shade is a filled REGION, not a polyline, so it registers through
         K.series rather than P.trace. Registering is what lets the loader match
         the legend entry to it — without that the entry fell back to a colour
         key while the draw asked by id, and the toggle silently did nothing. */
      const act = curve(tpd());
      if (!K.series(ctx, T.reflect, 'transmission-line-region', 'transmission-line region')) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(P.X(act[0][0]), P.Y(act[0][1]));
        for (const [x, y] of act) ctx.lineTo(P.X(x), P.Y(Math.min(y, L_HI)));
        ctx.lineTo(B.R, B.TP); ctx.lineTo(B.L, B.TP); ctx.closePath();
        ctx.fillStyle = K.rgba(T.reflect, 0.10); ctx.fill();
        ctx.restore();
      }

      P.trace(curve(TPD.microstrip), T.muted, { width: 1.2, dash: [4, 3] });
      P.trace(curve(TPD.stripline), T.muted, { width: 1.2, dash: [4, 3] });
      P.trace(act, T.reflect, { width: 2, id: 'critical-length', label: 'critical length' });

      K.text(ctx, 'TRANSMISSION LINE — terminate it', B.L + 10, B.TP + 16, T.reflect, 10, 'left');
      K.text(ctx, 'LUMPED — it is just a wire', B.R - 8, B.B - 12, T.muted, 10, 'right');

      // where the reader is
      const x = P.X(p.tr), y = P.Y(p.len);
      K.line(ctx, x, B.TP, x, B.B, T.ink2, 1, [2, 3]);
      K.line(ctx, B.L, y, B.R, y, T.ink2, 1, [2, 3]);
      const over = p.len > crit(p.tr, tpd());
      K.dot(ctx, x, y, over ? T.alarm : T.signal, T.surface, 5);
      P.frame();
    }

    /* ---------- panel 2: the inequality, drawn ---------- */
    function drawBars(T) {
      const s = K.canvas(cvBar, 200);
      const { ctx, w, h } = s;
      const L = 92, R = w - 20;
      const tr = p.tr, round = 2 * td(), third = tr / 3;
      const span = Math.max(tr, round) * 1.15;
      const X = (t) => L + (t / span) * (R - L);

      const bar = (y, t, colour, name, val) => {
        ctx.save();
        ctx.fillStyle = K.rgba(colour, 0.28); ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
        ctx.fillRect(L, y, X(t) - L, 26); ctx.strokeRect(L, y, X(t) - L, 26);
        ctx.restore();
        K.text(ctx, name, L - 10, y + 13, T.ink2, 10, 'right');
        K.text(ctx, val, Math.min(X(t) + 6, R), y + 13, colour, 10, 'left');
      };

      bar(30, tr, T.signal, 'the edge', K.fmt.ps(tr));
      bar(74, third, T.muted, 't_r / 3', K.fmt.ps(third));
      bar(118, round, T.reflect, 'round trip 2T_d', K.fmt.ps(round));

      const over = round > third;
      K.line(ctx, X(third), 22, X(third), 152, T.muted, 1, [3, 3]);
      const verdict = over ? 'ROUND TRIP EXCEEDS t_r/3 — TERMINATE' : 'reflection lands inside the edge — lumped';
      K.text(ctx, verdict, L, 178, over ? T.alarm : T.signal, 11, 'left');
      K.text(ctx, over ? 'the echo arrives after the driver has finished'
                       : 'the echo blends into the transition and never shows',
             L, 192, T.muted, 10, 'left');
    }

    function readouts() {
      const lc = crit(p.tr, tpd());
      const over = p.len > lc;
      $('[data-out="td"]').textContent = K.fmt.ps(td());
      $('[data-out="lcrit"]').textContent = lc < 1 ? (lc * 1000).toFixed(0) + ' µm' : lc.toFixed(2) + ' mm';
      $('[data-out="ratio"]').textContent = (p.len / lc).toFixed(p.len / lc < 10 ? 1 : 0) + '×';
      const v = $('[data-out="verdict"]');
      v.textContent = over ? 'transmission line' : 'lumped';
      v.style.color = over ? 'var(--alarm-text)' : 'var(--signal)';
      $('#cl-len').value = Math.round(Math.log10(p.len / L_LO) * 100);
      $('#cl-len-out').value = p.len < 10 ? p.len.toFixed(1) + ' mm' : p.len.toFixed(0) + ' mm';
      $('#cl-tr').value = Math.round(Math.log10(p.tr / TR_LO) * 100);
      $('#cl-tr-out').value = K.fmt.ps(p.tr);
      $('#cl-strip').checked = p.strip;
    }

    const m = K.mount({
      root, params: p,
      draw(T) { drawMap(T); drawBars(T); readouts(); }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    $('#cl-len').addEventListener('input', (e) => {
      p.len = L_LO * Math.pow(10, +e.target.value / 100); clearPreset(); m.render();
    });
    $('#cl-tr').addEventListener('input', (e) => {
      p.tr = TR_LO * Math.pow(10, +e.target.value / 100); clearPreset(); m.render();
    });
    $('#cl-strip').addEventListener('change', (e) => { p.strip = e.target.checked; clearPreset(); m.render(); });

    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = PRESETS[b.dataset.preset];
        if (!c) return;   // a .preset with no data-preset is not one
        p.len = c.len; p.tr = c.tr; p.strip = c.strip;
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = c.note;
        m.render();
      });
    });

    root.querySelector('.preset[data-preset="ddr"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.ddr.note;
    m.render();

    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
