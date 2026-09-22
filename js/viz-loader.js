/* SI & PI — viz-loader.js
 * Finds every [data-viz] container, hands it to SIPI.viz[name], and runs the
 * animation only while it is on screen. Nothing off-screen burns a frame. */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });



  /* ---------- legend entries become trace toggles ----------
     The legend is already the reader's map from a colour to a meaning, so it is
     the natural switch. An entry is only made interactive when the colour on its
     swatch was actually drawn on the canvas beside it — otherwise a reader would
     get a control that does nothing, which is worse than no control. */
  /* M5-4 · Legend visibility, and the two ways keying it to a colour failed.
     The hidden set was a set of RESOLVED COLOUR STRINGS, which meant:

       1. a theme change re-resolved every colour, so the keys in the hidden set
          no longer matched anything being drawn. A hidden trace reappeared, and
          the legend entry went on claiming it was off;
       2. two series sharing a colour were one key, so hiding either hid both —
          silently, and the legend showed only one of them as off.

     Each entry now has a STABLE ID derived from its own label, which no theme
     can change, and the colour is treated as what it is: a presentation
     property that has to be re-resolved and re-bound when the theme moves. The
     hidden set is migrated across that rebinding rather than abandoned.

     Where two entries genuinely resolve to the same colour the toggle is
     WITHHELD, because offering one would hide the wrong trace. A withheld
     toggle is a visible limitation; a lying one is not.

     What this is not: fully id-keyed drawing. The suppression still reaches the
     drawing layer through a colour, because every `P.trace` call across
     twenty-five modules passes a colour and not an id. The three labs already
     carry trace ids in their result objects (M0-6), so the remaining work is to
     thread them through `P.trace` — deferred, and named here rather than
     implied. */
  function slugOf(text) {
    return String(text || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trace';
  }

  function bindLegend(el, panel, legend, cv) {
    const K = window.SIPI.kit;
    if (!cv.__drawn) return;
    /* Re-resolve every entry's colour under the CURRENT theme, and note which
       ids collide on one colour. */
    /* N4-5. A legend entry resolves to a SERIES KEY, and a series key is the
       trace's own id when the module passed one. Only when it did not does the
       key fall back to the entry's colour — which is where two entries can
       collide and toggling has to be disabled.

       The traces record both, so the match is: find a drawn trace whose `id` or
       `label` slugs to this entry's id; use its key. Otherwise use the colour. */
    const drawnTraces = cv.__traces || [];
    const byId = {}, colourUsers = {};
    legend.querySelectorAll('span').forEach((entry) => {
      const sw = entry.querySelector('i');
      if (!sw) return;
      const id = entry.dataset.traceId || slugOf(entry.textContent);
      entry.dataset.traceId = id;
      const match = drawnTraces.find((t) =>
        (t.id && slugOf(t.id) === id) || (t.label && slugOf(t.label) === id));
      let key;
      if (match && match.id) {
        key = match.key;                       // id-keyed: never collides
      } else {
        const cs = getComputedStyle(sw);
        const raw = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? cs.color : cs.backgroundColor;
        key = K.colourKey(raw);
      }
      byId[id] = { entry, key, byIdKeyed: !!(match && match.id) };
      (colourUsers[key] = colourUsers[key] || []).push(id);
    });

    /* Migrate the hidden set from the previous binding's colours to this one's,
       so a trace the reader turned off stays off across a theme change. */
    const prev = cv.__traceBind || null;
    const hiddenIds = cv.__hiddenIds || new Set();
    if (prev) {
      Object.keys(prev).forEach((id) => {
        if (cv.__hidden && cv.__hidden.has(prev[id].key)) hiddenIds.add(id);
      });
    }
    cv.__hiddenIds = hiddenIds;
    cv.__traceBind = byId;
    cv.__hidden = new Set();
    hiddenIds.forEach((id) => { if (byId[id]) cv.__hidden.add(byId[id].key); });

    let any = false;
    Object.keys(byId).forEach((id) => {
      const { entry, key, byIdKeyed } = byId[id];
      /* An id-keyed series cannot be shared, by construction. */
      const shared = !byIdKeyed && colourUsers[key].length > 1;
      if (!cv.__drawn.has(key) || shared) {
        entry.removeAttribute('role');
        entry.removeAttribute('tabindex');
        entry.classList.remove('legend--toggle');
        if (shared) {
          entry.classList.add('legend--shared');
          entry.title = 'This colour is shared with "'
            + colourUsers[key].filter((x) => x !== id).join('", "')
            + '", so hiding one would hide the other. Toggling is disabled here '
            + 'rather than hiding the wrong trace.';
        }
        return;
      }
      any = true;
      entry.classList.remove('legend--shared');
      entry.setAttribute('role', 'switch');
      entry.setAttribute('aria-checked', String(!hiddenIds.has(id)));
      entry.tabIndex = 0;
      entry.classList.add('legend--toggle');
      entry.classList.toggle('is-off', hiddenIds.has(id));
      if (entry.dataset.legendWired) return;
      entry.dataset.legendWired = '1';
      const flip = () => {
        const b = cv.__traceBind[id];
        if (!b) return;
        const wasHidden = cv.__hiddenIds.has(id);
        wasHidden ? cv.__hiddenIds.delete(id) : cv.__hiddenIds.add(id);
        cv.__hidden = new Set();
        cv.__hiddenIds.forEach((x) => {
          if (cv.__traceBind[x]) cv.__hidden.add(cv.__traceBind[x].key);
        });
        entry.setAttribute('aria-checked', String(wasHidden));
        entry.classList.toggle('is-off', !wasHidden);
        K.repaint(el);
      };
      entry.addEventListener('click', flip);
      entry.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });
    if (any) legend.setAttribute('aria-label', 'Legend — each entry hides or shows its trace');
  }

  function wireLegend(el) {
    el.querySelectorAll('.panel').forEach((panel) => {
      const cv = panel.querySelector('canvas');
      const legend = panel.querySelector('.legend');
      if (!cv || !legend) return;
      bindLegend(el, panel, legend, cv);
    });
    /* Re-bind on a theme change. This is the whole point: the ids survive, the
       colours do not, and the hidden set follows the ids. */
    if (!el.dataset.legendThemeWired) {
      el.dataset.legendThemeWired = '1';
      document.addEventListener('sipi:theme', () => {
        setTimeout(() => wireLegend(el), 0);
      });
    }
  }

  /* ---------- zoom ----------
     Armed from a button rather than bound to a bare drag: several panels already
     use a horizontal drag as a scrubber, and silently stealing that gesture would
     break the control the page is actually teaching with. Arming also makes the
     feature findable, which a modifier-key gesture never is. */
  /* M5-5 · A collapsible control block, on narrow viewports only.
     Measured on Lab C at 375 x 812 the controls were 774 px — 95% of the
     viewport — so adjusting a slider meant losing sight of the plot it
     changed. Collapsing them and pinning the readout strip instead keeps the
     experiment visible, which is the whole point of a control.

     Open by default on first visit, because a panel whose controls are hidden
     reads as a picture. The choice is remembered per panel for the session
     only — sessionStorage, and wrapped, because the project theme rule
     applies to anything that matters and this does not. */
  function wireControlsToggle(el) {
    const controls = el.querySelector('.controls');
    if (!controls || el.querySelector('.controls-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'controls-toggle';
    const n = controls.querySelectorAll('.ctl').length;
    const key = 'sipi:ctl:' + (el.dataset.viz || 'panel');
    let open = true;
    try { open = sessionStorage.getItem(key) !== '0'; } catch (e) { open = true; }

    /* The toggle only EXISTS below 48rem — above it the controls are always
       shown and the button is display:none. So the collapsed state must not
       apply there, or a reader who collapsed the controls on a phone and later
       opened the same page on a laptop gets a panel with no controls and no
       button to bring them back. That is a hidden control with no way to show
       it, which is the corollary of "no canvas without a control" failing. */
    const narrow = window.matchMedia('(max-width: 47.99rem)');
    const paint = () => {
      const collapsible = narrow.matches;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'hide controls'
        : n + (n === 1 ? ' control' : ' controls');
      controls.hidden = collapsible && !open;
    };
    /* And repaint when the viewport crosses the breakpoint, so a window resize
       cannot leave the controls hidden either. */
    if (narrow.addEventListener) narrow.addEventListener('change', paint);
    else if (narrow.addListener) narrow.addListener(paint);
    btn.setAttribute('aria-controls', controls.id || (controls.id = 'ctl-' + key.replace(/\W/g, '')));
    btn.addEventListener('click', () => {
      open = !open;
      try { sessionStorage.setItem(key, open ? '1' : '0'); } catch (e) { /* fine */ }
      paint();
    });
    controls.parentNode.insertBefore(btn, controls);
    paint();
  }


  function wireZoom(el, tools) {
    const K = window.SIPI.kit;
    const cvs = [...el.querySelectorAll('canvas')].filter((c) => c.__plot);
    if (!cvs.length) return;

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'tool-btn'; btn.textContent = 'zoom';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Drag across a plot to zoom its x-axis. With a plot focused: + and - zoom, arrows pan, 0 resets.';
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'tool-btn'; reset.textContent = 'reset';
    reset.hidden = true;

    let armed = false;
    const setArmed = (v) => {
      armed = v;
      btn.setAttribute('aria-pressed', String(v));
      el.classList.toggle('is-zooming', v);
      cvs.forEach((c) => { c.__probeOff = v; });
    };
    btn.addEventListener('click', () => setArmed(!armed));
    reset.addEventListener('click', () => {
      cvs.forEach((c) => { c.__zoom = null; });
      reset.hidden = true;
      K.repaint(el);
    });

    /* M5-6 · A keyboard equivalent. Zooming was drag-only, so the whole feature
       was unavailable without a pointer — and it is not decoration: on a log
       sweep across six decades, reading a peak means zooming to it.

       The canvas is already focusable for the probe, so the keys go there:
       + and - zoom about the probe's position if it has one and the centre
       otherwise, arrows pan, 0 resets. Announced on the canvas's own label so a
       screen-reader user is told the range changed rather than left guessing. */
    cvs.forEach((cv) => {
      cv.addEventListener('keydown', (e) => {
        const P = cv.__plot;
        if (!P || !P.ax) return;
        const k = e.key;
        if (['+', '=', '-', '_', '0', 'ArrowLeft', 'ArrowRight'].indexOf(k) < 0) return;
        e.preventDefault();
        if (k === '0') {
          cv.__zoom = null;
          reset.hidden = cvs.every((c) => !c.__zoom);
          K.repaint(el);
          return;
        }
        const cur = cv.__zoom || { lo: P.ax.min, hi: P.ax.max };
        const log = !!P.ax.log;
        const L = log ? Math.log(cur.lo) : cur.lo, H = log ? Math.log(cur.hi) : cur.hi;
        const span = H - L;
        let lo = L, hi = H;
        if (k === '+' || k === '=') { lo = L + span * 0.15; hi = H - span * 0.15; }
        else if (k === '-' || k === '_') { lo = L - span * 0.2; hi = H + span * 0.2; }
        else if (k === 'ArrowLeft') { lo = L - span * 0.2; hi = H - span * 0.2; }
        else if (k === 'ArrowRight') { lo = L + span * 0.2; hi = H + span * 0.2; }
        const outLo = log ? Math.exp(lo) : lo, outHi = log ? Math.exp(hi) : hi;
        /* Never zoom past the data, and never invert the axis. */
        const fullLo = P.ax.min, fullHi = P.ax.max;
        cv.__zoom = (outHi - outLo) >= (fullHi - fullLo) * 0.999
          ? null
          : { lo: Math.max(fullLo, outLo), hi: Math.min(fullHi, outHi) };
        reset.hidden = cvs.every((c) => !c.__zoom);
        K.repaint(el);
        const fmt = P.ax.fmt || K.fmt.num;
        const z = cv.__zoom;
        cv.setAttribute('aria-label',
          (cv.dataset.baseLabel || (cv.dataset.baseLabel = cv.getAttribute('aria-label') || ''))
          + (z ? ' Showing ' + fmt(z.lo) + ' to ' + fmt(z.hi) + '.' : ' Showing the full range.'));
      });
      const band = document.createElement('div');
      band.className = 'zoom-band';
      band.hidden = true;
      let from = null;
      const at = (e) => {
        const r = cv.getBoundingClientRect();
        return (e.clientX - r.left) / (r.width / cv.__plot.box.w);
      };
      cv.addEventListener('pointerdown', (e) => {
        if (!armed) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        from = at(e);
        if (!band.parentNode) cv.parentNode.appendChild(band);
      });
      cv.addEventListener('pointermove', (e) => {
        if (from === null) return;
        const to = at(e), sc = cv.getBoundingClientRect().width / cv.__plot.box.w;
        band.hidden = false;
        band.style.left = Math.min(from, to) * sc + 'px';
        band.style.width = Math.abs(to - from) * sc + 'px';
        band.style.top = cv.__plot.box.TP * sc + 'px';
        band.style.height = (cv.__plot.box.B - cv.__plot.box.TP) * sc + 'px';
      });
      const finish = (e) => {
        if (from === null) return;
        const to = at(e);
        band.hidden = true;
        const P = cv.__plot;
        const lo = Math.min(from, to), hi = Math.max(from, to);
        from = null;
        /* A drag under ~12 px is a click that slipped, not a selection. Zooming to
           a sliver on a mis-click leaves the reader staring at an empty box with
           no obvious way back. */
        if (hi - lo < 12) return;
        const a = P.invX(lo), b = P.invX(hi);
        if (!isFinite(a) || !isFinite(b) || b <= a) return;
        cv.__zoom = { x: [a, b] };
        reset.hidden = false;
        setArmed(false);
        K.repaint(el);
      };
      cv.addEventListener('pointerup', finish);
      cv.addEventListener('pointercancel', () => { from = null; band.hidden = true; });
    });

    tools.appendChild(btn);
    tools.appendChild(reset);
  }

  /* ---------- A/B overlay ----------
     The pinned copy is the canvas bitmap, drawn UNDER the live one. The kit clears
     with clearRect, so a live canvas is transparent everywhere it has not drawn —
     which means the reference shows through the gaps and the two grids land on top
     of each other instead of doubling. What that cannot survive is an axis change:
     the reference would then be a picture on a different scale, so the axes are
     recorded with it and the overlay says so rather than lying quietly. */
  function wirePin(el, tools) {
    const K = window.SIPI.kit;
    const cvs = [...el.querySelectorAll('canvas')];
    if (!cvs.length) return;

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'tool-btn'; btn.textContent = 'pin A';
    btn.title = 'Freeze this result as a reference, then change something and compare';

    const note = document.createElement('span');
    note.className = 'pin-note'; note.hidden = true;
    note.setAttribute('role', 'status');

    const sig = (cv) => {
      const P = cv.__plot;
      return P ? [P.ax.min, P.ax.max, P.ay.min, P.ay.max, !!P.ax.log, !!P.ay.log].join('|') : '';
    };
    let pinned = null;
    /* N4-3 / R10. The reference is now the RESULT, not a bitmap. A pixel copy
       cannot be re-rendered when the theme changes, the panel resizes or the
       axes move — it can only be marked stale, which is what the old version
       did. Holding the result means the reference is redrawn on whatever axes
       the live plot currently has, so the two are always on common scales by
       construction rather than by luck.

       This is only general because N4-4 gave every trace one shape. The loader
       does not know what a PDN branch current is; it knows that a trace has an
       id, an x with values, and a y. */
    let pinnedResult = null, pinnedSnap = null;

    const clear = () => {
      el.querySelectorAll('.ghost').forEach((g) => g.remove());
      pinned = null; pinnedResult = null; pinnedSnap = null;
      btn.textContent = 'pin A'; note.hidden = true;
      el.classList.remove('has-pin');
    };

    /* The source is `cv.__traces`, not the model result — and that took one wrong
       turn to find. A result's x is in SI (Hz); the plot's x may be in GHz, or
       inches, or UI. Drawing the result through the live mapping put the
       reference in the wrong place by nine orders of magnitude.

       `__traces` already holds every drawn series in AXIS units, per canvas,
       recorded by P.trace for the probe. Re-projecting those through the
       CURRENT mapping is exactly what is wanted: the reference follows a zoom, a
       resize and a theme change onto whatever axes the live plot now has. */
    const pinTraces = (cv) => (cv.__traces || []).map((t) => ({
      colour: t.colour, dash: t.dash,
      pts: t.pts.map((q) => [q[0], q[1]])
    }));

    const renderGhosts = () => {
      el.querySelectorAll('canvas.ghost').forEach((g) => {
        const live = g.parentNode && g.parentNode.querySelector('canvas:not(.ghost)');
        const P = live && live.__plot;
        const rec = g.__pinTraces;
        if (!P || !rec || !rec.length) return;
        g.width = live.width; g.height = live.height;
        g.style.height = live.style.height;
        const ctx = g.getContext('2d');
        const dpr = live.width / P.box.w;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, P.box.w, P.box.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP);
        ctx.clip();
        rec.forEach((t) => {
          if (!t.pts.length) return;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < t.pts.length; i++) {
            const [xv, yv] = t.pts[i];
            if (!isFinite(yv)) { started = false; continue; }
            const X = P.X(xv), Y = P.Y(yv);
            if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
          }
          ctx.strokeStyle = t.colour || '#888';
          ctx.lineWidth = 2;
          ctx.setLineDash(t.dash ? [2, 3] : [5, 4]);
          ctx.stroke();
        });
        ctx.restore();
      });
    };

    /* What CHANGED between the reference and now, numerically. A picture of two
       curves says they differ; this says by how much, in which parameter, and
       whether either run is even valid. */
    const deltas = () => {
      if (!pinnedSnap) return '';
      const now = snapshot(el);
      const bits = [];
      const byKey = {};
      pinnedSnap.rows.forEach((r) => { if (r[0] === 'set') byKey[r[1]] = r[3]; });
      now.rows.forEach((r) => {
        if (r[0] !== 'set') return;
        const was = byKey[r[1]];
        if (was === undefined || was === r[3]) return;
        bits.push(r[1] + ' ' + was + ' → ' + r[3]);
      });
      const m = {};
      pinnedSnap.rows.forEach((r) => { if (r[0] === 'read') m[r[1]] = r[3]; });
      const reads = [];
      now.rows.forEach((r) => {
        if (r[0] !== 'read' || typeof r[3] !== 'number') return;
        const was = m[r[1]];
        if (typeof was !== 'number' || was === r[3]) return;
        const d = r[3] - was;
        if (Math.abs(d) < Math.abs(was) * 1e-9) return;
        reads.push(r[1] + ' ' + (d > 0 ? '+' : '') + K.fmt.num(d));
      });
      const validity = (pinnedSnap.status && pinnedSnap.status !== 'ok')
                    || (now.status && now.status !== 'ok')
        ? ' · A ' + (pinnedSnap.status || '?') + ', B ' + (now.status || '?') : '';
      if (!bits.length && !reads.length) return 'nothing changed' + validity;
      return (bits.length ? 'changed: ' + bits.join(', ') : '')
           + (reads.length ? (bits.length ? ' · ' : '') + reads.slice(0, 4).join(', ') : '')
           + validity;
    };

    const check = () => {
      if (!pinned) return;
      renderGhosts();
      const moved = cvs.some((cv, i) => pinned[i] !== undefined && sig(cv) !== pinned[i]);
      /* The axes-moved warning is no longer about the PICTURE being on a
         different scale — the reference is redrawn on the live axes, so it never
         is. It now reports the numerical comparison instead. */
      note.hidden = false;
      note.textContent = deltas();
      el.querySelectorAll('.ghost').forEach((g) => g.classList.remove('is-stale'));
    };

    btn.addEventListener('click', () => {
      if (pinned) { clear(); return; }
      pinned = [];
      cvs.forEach((cv, i) => {
        if (!cv.parentNode.classList.contains('probe-host')) {
          const host = document.createElement('div');
          host.className = 'probe-host';
          cv.parentNode.insertBefore(host, cv);
          host.appendChild(cv);
        }
        const g = document.createElement('canvas');
        g.className = 'ghost';
        g.setAttribute('aria-hidden', 'true');
        g.width = cv.width; g.height = cv.height;
        g.style.height = cv.style.height;
        /* The pixel copy stays as the FALLBACK, for panels that publish no
           numerical result. Where one exists, renderGhosts() overwrites this
           immediately with a redraw on the live axes. */
        g.getContext('2d').drawImage(cv, 0, 0);
        g.__pinTraces = pinTraces(cv);
        cv.parentNode.insertBefore(g, cv);
        pinned[i] = sig(cv);
      });
      pinnedResult = K.published ? K.published(el) : null;
      pinnedSnap = snapshot(el);
      renderGhosts();
      const drawable = [...el.querySelectorAll('canvas.ghost')]
        .filter((g) => g.__pinTraces && g.__pinTraces.length).length;
      note.hidden = false;
      note.textContent = drawable
        ? 'reference pinned — change something to compare'
        : 'reference pinned as an image: nothing on this panel records its series '
          + 'numerically, so it cannot be redrawn if the axes or the theme move';
      el.classList.add('has-pin');
      btn.textContent = 'clear A';
    });

    /* Bubble phase, not capture. In capture this ran BEFORE the module's own
       handler, comparing the axes against a render the control had not changed
       yet, so it never saw a move. Bubbling reaches the panel after the control's
       own listeners have run, which is when the new axes exist.

       Deliberately not requestAnimationFrame: a background or hidden tab never
       services one, so the check would sit queued indefinitely and the reference
       would keep claiming to be on the current scale. A timer still runs there. */
    const later = () => { check(); setTimeout(check, 0); };
    el.addEventListener('input', later);
    el.addEventListener('change', later);
    /* N4-3. A VIEW change — a zoom, a theme, a tab — moves the axes without any
       input event, and that is precisely the case the pixel ghost could not
       follow. Re-projecting on repaint is what makes "both runs on common axes"
       true rather than aspirational. The listener is added after the module's
       own, so the live plot has already recorded its new mapping. */
    el.addEventListener('sipi:repaint', () => { setTimeout(later, 0); });
    window.addEventListener('sipi:theme', () => { setTimeout(later, 0); });
    tools.appendChild(btn);
    tools.appendChild(note);
  }


  /* ---------- linked views become tabs on a narrow screen ----------
     Two or three plots side by side on a desktop become two or three plots
     stacked on a phone, and the second one is then a screen and a half below the
     control that changes it. Tabs put one view at a time next to its controls.

     Which state applies is decided entirely in CSS at the same 62rem breakpoint
     `.panels.two-up` already uses, so there is no resize listener to get wrong and
     no chance of the markup and the layout disagreeing. The JS only ever marks up
     the tabs and records which one is selected. */
  function wireTabs(el) {
    const K = window.SIPI.kit;
    el.querySelectorAll('.panels').forEach((group, gi) => {
      const panels = [...group.children].filter((c) => c.classList.contains('panel'));
      if (panels.length < 2 || group.dataset.tabbed) return;
      group.dataset.tabbed = '1';
      group.classList.add('has-tabs');

      const list = document.createElement('div');
      list.className = 'panel-tabs';
      list.setAttribute('role', 'tablist');
      list.setAttribute('aria-label', 'Views of the same result');

      const tabs = panels.map((panel, i) => {
        const label = panel.querySelector('.panel__label');
        const base = el.dataset.viz + '-' + gi + '-' + i;
        panel.id = base + '-panel';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', base + '-tab');
        if (i) panel.dataset.tabHidden = '1';

        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'panel-tab';
        b.id = base + '-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', base + '-panel');
        b.setAttribute('aria-selected', String(i === 0));
        b.tabIndex = i === 0 ? 0 : -1;
        b.addEventListener('click', () => {
          /* The strip scrolls, so the tab a reader just chose has to be brought
             into view or the selection is invisible. */
          if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        /* The panel label is written for a desktop caption and runs long. The tab
           takes the first clause, which is what distinguishes the views.

           M5-5 · and cuts at a WORD boundary if it still runs long. `slice(0, 28)`
           produced "Which bank supplies the curr", which is not a shorter label
           but an unreadable one. The full text stays as the accessible name and
           the tooltip, so nothing is lost — only the visible width is traded,
           and the strip scrolls now rather than compressing every tab. */
        const full = (label ? label.textContent : 'View ' + (i + 1)).trim();
        let short = full.split(/[—·,]/)[0].trim();
        if (short.length > 26) {
          const cut = short.slice(0, 26);
          const sp = cut.lastIndexOf(' ');
          short = (sp > 12 ? cut.slice(0, sp) : cut) + '\u2026';
        }
        b.textContent = short;
        if (short !== full) {
          b.title = full;
          b.setAttribute('aria-label', full);
        }
        list.appendChild(b);
        return b;
      });

      const select = (i, focus) => {
        panels.forEach((p2, j) => {
          if (j === i) delete p2.dataset.tabHidden; else p2.dataset.tabHidden = '1';
        });
        tabs.forEach((t, j) => {
          t.setAttribute('aria-selected', String(j === i));
          t.tabIndex = j === i ? 0 : -1;
        });
        if (focus) tabs[i].focus();
        /* A canvas that was display:none has no width, so whatever it drew while
           hidden was drawn at the fallback size. Ask for one more frame now that
           it has a box. */
        K.repaint(el);
      };

      tabs.forEach((t, i) => {
        t.addEventListener('click', () => select(i));
        t.addEventListener('keydown', (e) => {
          /* M5-6 · the full tablist pattern, not just the two arrows. Home and
             End matter most on the six-view labs, where stepping one tab at a
             time to reach the last view is five keypresses. */
          let to = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % tabs.length;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + tabs.length) % tabs.length;
          else if (e.key === 'Home') to = 0;
          else if (e.key === 'End') to = tabs.length - 1;
          if (to === null) return;
          e.preventDefault();
          select(to, true);
        });
      });

      group.parentNode.insertBefore(list, group);
    });
  }


  /* A phone has room for one investigation at a time. Keep desktop groups and
     their tab state intact; the mobile selector only changes presentation. */
  function groupWorkspaceControls(el) {
    const controls = el.querySelector('.controls');
    if (!controls || controls.dataset.grouped) return;
    const rules = {
      labWaves: [['Line and terminations', []], ['Source edge', ['lw-tr']], ['Probe and time', ['lw-xp', 'lw-t']]],
      labChannel: [['Channel geometry and loss', []], ['Data and measurement edges', ['lc-rate', 'lc-tr', 'lc-trtdr']], ['Receiver and display', ['lc-eq', 'lc-raw']]],
      labPdn: [['Power network', []], ['Load excitation', ['pd-imax', 'pd-tr', 'pd-imax2', 'pd-tr2', 'pd-startNs', 'pd-widthNs', 'pd-start2Ns', 'pd-width2Ns']], ['Target criterion', ['pd-zt']]],
      cdr: [['Clock recovery loop', []], ['Jitter excitation', ['cdr-jitter-f', 'cdr-jitter-a']], ['Receiver aperture', ['cdr-margin']]]
    };
    const groups = rules[el.dataset.viz];
    const items = [...controls.children].filter(child => child.classList.contains('ctl'));
    if (!groups || !items.length) return;
    controls.dataset.grouped = 'true';
    groups.forEach(([title, ids], index) => {
      const members = items.filter(item => {
        const inputs = [...item.querySelectorAll('input[id], select[id]')];
        const assigned = groups.findIndex(([, names]) => inputs.some(input => names.includes(input.id)));
        return (assigned < 0 ? 0 : assigned) === index;
      });
      if (!members.length) return;
      const section = document.createElement('details'); section.className = 'control-group'; section.open = index === 0;
      const summary = document.createElement('summary'); summary.textContent = title;
      const grid = document.createElement('div'); grid.className = 'control-group__grid';
      members.forEach(item => grid.appendChild(item));
      section.append(summary, grid); controls.appendChild(section);
    });
  }

  function wireWorkspace(el) {
    /* The view a phone opens on. labWaves opens on the probe trace rather than the
       spatial plot: it is the one that looks like a scope, it is what the time
       scrubber drives, and it is the only view whose meaning survives being 356 px
       wide. The wide layout shows every panel, so this only decides the phone. */
    const defaults = { labWaves: 'probe', labChannel: 'eye', labPdn: 'z', cdr: 'transfer' };

    /* Controls that earn a place directly under the chart on a phone, by lab.
       A lab with no entry keeps its rails as they are. Chosen by Geetansh for
       labWaves; the rest are deliberately not guessed at. */
    const PRIMARY = {
      labWaves: ['lw-rs', 'lw-z0', 'lw-xp'],
      /* One per feature of the impedance curve, which is why these three and not
         the other seven: the board bank sets the mid-band dip and the plane
         anti-resonance beside it, package inductance sets the peak above that,
         and on-die capacitance sets the high-frequency floor. A reader dragging
         them sees three different parts of the same curve move. */
      labPdn: ['pd-nboard', 'pd-lpkg', 'pd-cdie'],
      /* Loss sets how far the eye closes; the discontinuity's impedance and its
         length set what the reflection does to it. Between them they move the
         eye, the insertion loss and the TDR trace, which are the three things
         the charts on this lab show. */
      labChannel: ['lc-loss', 'lc-dz', 'lc-dlen']
    };
    if (!(el.dataset.viz in defaults)) return;
    const K = window.SIPI.kit;
    const panels = [...el.querySelectorAll('.panel')].filter((p) => p.querySelector('canvas[data-cv]'));
    if (panels.length < 2) return;
    el.classList.add('workspace');
    groupWorkspaceControls(el);
    const narrow = window.matchMedia('(max-width: 47.99rem)');
    const picker = document.createElement('div');
    picker.className = 'workspace-picker';
    const label = document.createElement('label');
    label.textContent = 'Inspect view';
    const select = document.createElement('select');
    select.id = 'view-' + el.dataset.viz;
    label.htmlFor = select.id;
    let active = 0;
    const titles = {
      line: 'Voltage along the line', current: 'Current along the line', probe: 'At the probe',
      lattice: 'Reflection events', energy: 'Energy history and balance', freq: 'Insertion and return loss', delay: 'Group delay',
      impulse: 'Impulse response', transferZ: 'Board/die transfer impedance', multi: 'Two-load rail response', loads: 'Two load currents', pulse: 'Single-bit response', tdr: 'TDR impedance', bits: 'Received data', eye: 'Eye diagram',
      hist: 'Decision histogram', sweep: 'Channel sweep', z: 'PDN impedance', bank: 'Branch currents',
      topo: 'PDN circuit', vt: 'Rail voltage in time', spec: 'Load-current spectrum',
      transfer: 'Jitter transfer', residual: 'Residual phase error', tolerance: 'Jitter tolerance',
      phase: el.dataset.viz === 'cdr' ? 'Clock phase in time' : 'Impedance phase'
    };
    panels.forEach((panel, i) => {
      const cv = panel.querySelector('canvas[data-cv]');
      const caption = panel.querySelector('.panel__label, figcaption');
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = titles[cv.dataset.cv] || (caption ? caption.textContent : cv.getAttribute('aria-label') || cv.dataset.cv).trim().split(/[—.]/)[0];
      select.appendChild(option);
      if (cv.dataset.cv === defaults[el.dataset.viz]) active = i;
    });
    select.value = String(active);
    const navigation = document.createElement('div'); navigation.className = 'workspace-picker__nav';
    navigation.append(label, select);
    const controls = el.querySelector('.controls');
    if (controls) {
      const jump = document.createElement('button'); jump.type = 'button'; jump.textContent = 'Controls';
      jump.addEventListener('click', () => {
        const toggle = el.querySelector('.controls-toggle');
        if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
        controls.querySelector('summary')?.focus();
        controls.scrollIntoView({ block: 'start' });
      });
      navigation.appendChild(jump);
    }
    const strip = document.createElement('div'); strip.className = 'workspace-measurements';
    strip.setAttribute('aria-label', 'Selected measurements');
    const fields = { labWaves: [['vp', 'Probe V'], ['ip', 'Probe I']],
      labChannel: [['eh', 'Eye height'], ['il', 'Nyquist S21']],
      labPdn: [['droop', 'combined die droop'], ['zpk', 'Peak impedance']],
      cdr: [['peak', 'Peak transfer'], ['floor', 'Worst tolerance']] }[el.dataset.viz];
    const outputs = fields.map(([key, title]) => {
      const source = el.querySelector('[data-out="' + key + '"]');
      const item = document.createElement('span');
      const value = document.createElement('b');
      item.append(title + ' ', value); strip.appendChild(item);
      return { source, value };
    });
    const updateStrip = () => outputs.forEach(({source, value}) => {
      const text = source ? source.textContent : '—';
      if (value.textContent !== text) value.textContent = text;
    });
    updateStrip();
    const readout = el.querySelector('.instrument__readout');
    if (readout) new MutationObserver(updateStrip).observe(readout, { subtree: true, childList: true, characterData: true });
    picker.append(navigation, strip);
    const firstGroup = panels[0].closest('.panels, .instrument__grid, .panel-group') || panels[0];
    firstGroup.before(picker);
    const groups = [...new Set(panels.map((p) => p.parentElement))];

    /* ---- the swipe track ----
       Panels move into a scroll-snap row on a phone and back to their own parents
       above the breakpoint. Moving rather than cloning matters: these are the
       model's own elements, with its listeners and its ids on them, and a second
       copy would be a second source of truth for the same number.

       scroll-snap does the gesture, so momentum, rubber-banding and the trackpad
       are the platform's rather than a handler's, and with no JavaScript at all
       the panels are simply a row that scrolls. */
    const home = new Map(panels.map((pn) => [pn, [pn.parentElement, pn.nextSibling]]));
    const track = document.createElement('div');
    track.className = 'lab-swipe';
    track.tabIndex = 0;
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', 'Charts, scroll sideways or use the arrow keys');
    const dots = document.createElement('div');
    dots.className = 'lab-swipe__dots';
    const live = document.createElement('p');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    const dotFor = panels.map((pn, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lab-swipe__dot';
      b.setAttribute('aria-label', select.options[i] ? select.options[i].textContent : 'View ' + (i + 1));
      b.addEventListener('click', () => goTo(i, true));
      dots.appendChild(b);
      return b;
    });
    picker.after(track);
    track.after(dots);
    dots.after(live);

    /* Lab A's three controls sit under the chart on a phone. Same rule: moved,
       with a note of where they came from so they can go home. */
    const primaryRow = document.createElement('div');
    primaryRow.className = 'lab-primary';
    const primary = (PRIMARY[el.dataset.viz] || [])
      .map((id) => { const input = el.querySelector('#' + id); return input && input.closest('.ctl'); })
      .filter(Boolean);
    const primaryHome = new Map(primary.map((c) => [c, [c.parentElement, c.nextSibling]]));
    if (primary.length) dots.after(primaryRow);

    let onTrack = false;
    /* Height BEFORE the scroll, deliberately. The track is sized to the chart
       being shown, and changing a scroll container's height while a smooth scroll
       is in flight cancels it -- the dots updated and the track stayed where it
       was. Resize first, then move. */
    const fitHeight = (i) => {
      if (!onTrack) return;
      const want = panels[i].scrollHeight;
      if (want > 0 && Math.abs(parseFloat(track.style.height || 0) - want) > 1) {
        track.style.height = want + 'px';
      }
    };
    const goTo = (i, smooth) => {
      active = Math.max(0, Math.min(panels.length - 1, i));
      select.value = String(active);
      fitHeight(active);
      if (onTrack) {
        track.scrollTo({ left: panels[active].offsetLeft - track.offsetLeft,
          behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
      }
      sync();
    };
    const sync = () => {
      dotFor.forEach((d, i) => {
        d.setAttribute('aria-current', i === active ? 'true' : 'false');
        d.tabIndex = i === active ? 0 : -1;
      });
      live.textContent = 'Chart ' + (active + 1) + ' of ' + panels.length + ': '
        + (select.options[active] ? select.options[active].textContent : '');
      /* A flex row is as tall as its tallest child, so the short charts sat above
         a gap the height of the energy panel -- about 130 px of nothing between
         the plot and the dots. fitHeight gives the track the height of the chart
         showing instead, and is called before any scroll rather than after. */
      fitHeight(active);
    };

    const enterTrack = () => {
      if (onTrack) return;
      panels.forEach((pn) => { pn.hidden = false; pn.removeAttribute('data-mobile-active'); track.appendChild(pn); });
      primary.forEach((c) => primaryRow.appendChild(c));
      groups.forEach((g) => { if (g !== el) g.hidden = false; });
      onTrack = true;
    };
    const leaveTrack = () => {
      if (!onTrack) return;
      track.style.height = '';
      panels.forEach((pn) => {
        const [parent, next] = home.get(pn);
        parent.insertBefore(pn, next && next.parentElement === parent ? next : null);
        pn.hidden = false;
        pn.removeAttribute('data-mobile-active');
      });
      primary.forEach((c) => {
        const [parent, next] = primaryHome.get(c);
        parent.insertBefore(c, next && next.parentElement === parent ? next : null);
      });
      groups.forEach((g) => { if (g !== el) g.hidden = false; });
      onTrack = false;
    };

    const paint = () => {
      picker.hidden = !narrow.matches;
      track.hidden = dots.hidden = primaryRow.hidden = !narrow.matches;
      if (narrow.matches) enterTrack(); else leaveTrack();
      K.repaint(el);
      if (narrow.matches) { sync(); goTo(active, false); }
    };

    /* Whichever panel's centre is nearest the track's centre is the one showing.
       The only definition that stays right mid-swipe and at any panel width. */
    let ticking = 0;
    track.addEventListener('scroll', () => {
      if (ticking || !onTrack) return;
      ticking = requestAnimationFrame(() => {
        ticking = 0;
        const mid = track.scrollLeft + track.clientWidth / 2;
        let best = 0, bestD = Infinity;
        panels.forEach((pn, i) => {
          const c = pn.offsetLeft - track.offsetLeft + pn.offsetWidth / 2;
          const d = Math.abs(c - mid);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best !== active) { active = best; select.value = String(active); sync(); }
      });
    }, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { goTo(active - 1, true); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(active + 1, true); e.preventDefault(); }
    });

    select.addEventListener('change', () => { goTo(Number(select.value), true); });
    if (narrow.addEventListener) narrow.addEventListener('change', paint);
    else narrow.addListener(paint);
    paint();
  }

  /* ---------- Guided / Explore / Verify ----------
     One engine, three ways in. Explore is the panel as built. Verify answers
     "should I trust this?" from what the page already declares — the model badge
     carries its own limitation text, and the values table is the settings that
     produced the number in front of you. Guided is the only one that needs
     authoring, so it is offered ONLY where a guide exists: a tab that opened an
     empty walkthrough would be worse than no tab.

     Every step reuses applyScenario, so a guide is written as settings rather
     than as instructions to click things, and a reader who wanders off mid-guide
     can always be put back exactly where the step meant them to be. */
  function wireModes(el, bar) {
    const K = window.SIPI.kit;
    const src = el.querySelector('script[type="application/json"][data-guide]');
    let guide = null;
    if (src) {
      try { guide = JSON.parse(src.textContent); }
      catch (err) { console.warn('[viz] guide for ' + el.dataset.viz + ' is not valid JSON', err); }
    }
    const badge = el.querySelector('.model-tag');
    if (!badge && !guide) return;                 // nothing to verify, nothing to guide

    const modes = document.createElement('div');
    modes.className = 'modes';
    modes.setAttribute('role', 'tablist');
    modes.setAttribute('aria-label', 'How to use this panel');

    const stage = document.createElement('div');
    stage.className = 'mode-stage';
    stage.hidden = true;

    const names = (guide ? ['guided'] : []).concat(['explore'], badge ? ['verify'] : []);
    const btns = {};
    names.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mode'; b.textContent = n;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(n === 'explore'));
      b.addEventListener('click', () => show(n));
      modes.appendChild(b);
      btns[n] = b;
    });

    let step = 0, revealed = false;

    /* M6-2 · Guided mode is two-phase where a step asks something.
       It used to apply the step's settings and THEN pose the question, so the
       answer was already on screen when the reader was asked to predict it.
       Astra's §8 names that directly: "applying settings and immediately
       revealing an answer is not yet a prediction exercise."

       Now a step with an `ask` shows the question against the state the reader
       can still see, takes a commitment, and only then applies the settings and
       reveals. A step with no `ask` is narration and applies immediately. */
    function renderGuide() {
      const s2 = guide.steps[step];
      const asks = !!s2.ask;
      const phase = (!asks || revealed) ? 'show' : 'predict';
      if (phase === 'show' && s2.set) K.applyScenario(el, s2.set);

      const nav = '<p class="mode-stage__nav">'
        + '<button type="button" class="tool-btn" data-go="-1"' + (step ? '' : ' disabled') + '>\u2039 back</button>'
        + '<button type="button" class="tool-btn" data-go="1"'
        + (step < guide.steps.length - 1 ? '' : ' disabled') + '>next \u203a</button></p>';

      if (phase === 'predict') {
        stage.innerHTML =
          '<p class="mode-stage__where">Step ' + (step + 1) + ' of ' + guide.steps.length
          + (guide.title ? ' \u00b7 ' + esc(guide.title) : '') + ' \u00b7 <b>predict first</b></p>'
          + '<p class="mode-stage__say">' + esc(s2.say) + '</p>'
          + '<p class="mode-stage__ask"><b>Before anything changes:</b> ' + esc(s2.ask) + '</p>'
          + '<p class="mode-stage__commit">'
          + '<button type="button" class="tool-btn tool-btn--go" data-commit>'
          + 'I have a prediction \u2014 show me</button>'
          + '<span class="mode-stage__hint">The panel is still showing the state before this '
          + 'step. Commit to an answer, then look.</span></p>'
          + nav;
        stage.querySelector('[data-commit]').addEventListener('click', () => {
          revealed = true;
          renderGuide();
        });
      } else {
        stage.innerHTML =
          '<p class="mode-stage__where">Step ' + (step + 1) + ' of ' + guide.steps.length
          + (guide.title ? ' \u00b7 ' + esc(guide.title) : '') + '</p>'
          + '<p class="mode-stage__say">' + esc(s2.say) + '</p>'
          + (asks ? '<p class="mode-stage__ask"><b>You predicted:</b> ' + esc(s2.ask) + '</p>'
                  + '<p class="mode-stage__answer">' + esc(s2.answer || '') + '</p>' : '')
          + (step === guide.steps.length - 1 ? renderTransfer() : '')
          + nav;
      }

      stage.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
        step = Math.max(0, Math.min(guide.steps.length - 1, step + (+b.dataset.go)));
        revealed = false;
        renderGuide();
      }));
    }

    /* M6-2 · the transfer question. A guide that only asks about the settings it
       just applied tests recall of a demonstration. This asks the reader to
       apply the idea somewhere it was not shown, and deliberately has no
       "reveal" — there is nothing to press, because the answer is theirs. */
    function renderTransfer() {
      if (!guide.transfer) return '';
      return '<div class="mode-stage__transfer">'
        + '<p class="mode-stage__where">Take it somewhere else</p>'
        + '<p class="mode-stage__say">' + esc(guide.transfer) + '</p>'
        + (guide.transferNote
            ? '<p class="mode-stage__hint">' + esc(guide.transferNote) + '</p>' : '')
        + '</div>';
    }

    function renderVerify() {
      let c = null;
      const island = el.querySelector('script[type="application/json"][data-contract]');
      if (island) {
        try { c = JSON.parse(island.textContent); }
        catch (err) { console.warn('[viz] contract island for ' + el.dataset.viz
                                   + ' is not valid JSON', err); }
      }
      if (!c) {
        /* No island means scaffold.py has not stamped this panel. Say so rather
           than falling back to the badge text, which is how the old version came
           to disagree with the catalogue in the first place. */
        stage.innerHTML = '<p class="mode-stage__where">What this model is</p>'
          + '<p class="mode-stage__say">This panel has no stamped contract. Run '
          + '<code>python3 scaffold.py contract</code>.</p>';
        return;
      }

      const eqs = (c.equations || []).map((e) => '<li><code>' + esc(e) + '</code></li>').join('');
      const suites = (c.suites || []).map((x) => '<code>' + esc(x) + '</code>').join(', ');
      const depth = (location.pathname.match(/\//g) || []).length - 1;
      const up = depth > 0 ? '../'.repeat(depth) : '';

      stage.innerHTML =
        '<p class="mode-stage__where">What this model is · '
        + '<a href="' + up + 'model-contract.html#' + esc(c.panel) + '">full contract</a></p>'
        + '<p class="mode-stage__say"><b>' + esc(c.kind) + ', v' + esc(c.version)
        + '.</b> ' + esc(c.purpose || '') + '</p>'
        + '<dl class="verify">'
        + '<dt>Equations</dt><dd><ul class="tight">' + eqs + '</ul></dd>'
        + '<dt>Units and conventions</dt><dd>' + esc(c.units || '') + '</dd>'
        + '<dt>Holds under</dt><dd>' + esc(c.validity || '') + '</dd>'
        + '<dt>How it is computed</dt><dd>' + esc(c.numerics || '') + '</dd>'
        + '<dt>Known limitations</dt><dd>' + esc(c.limitations || '') + '</dd>'
        + '<dt>Checked by</dt><dd>' + esc(c.evidence) + ' \u00b7 ' + suites
        + ' in <code>check-models.js</code></dd>'
        + '</dl>'
        + '<p class="mode-stage__say">The values table below is the settings and readouts as '
        + 'they stand right now — copy them into a report, or send the link beside them to put '
        + 'someone else on this exact case.</p>';
      const vals = [...el.querySelectorAll('.instrument__tools .tool-btn')]
        .find((b) => b.textContent === 'values');
      const table = el.querySelector('.viz-values');
      if (vals && table && table.hidden) vals.click();
    }

    function show(n) {
      names.forEach((m2) => btns[m2].setAttribute('aria-selected', String(m2 === n)));
      el.classList.toggle('mode-guided', n === 'guided');
      if (n === 'explore') { stage.hidden = true; return; }
      stage.hidden = false;
      if (n === 'guided') { step = 0; renderGuide(); } else renderVerify();
    }

    bar.insertAdjacentElement('afterend', stage);
    bar.appendChild(modes);
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }


  /* ---------- exercises ----------
     Deliberately not a quiz. A green tick teaches nothing and a red cross
     teaches less, so every response explains the MECHANISM — the same
     explanation whether the answer was right or wrong, because getting a
     numerical answer right by luck is common and getting it wrong for an
     interesting reason is useful.

     Wrong answers also get a reading of what reasoning would produce that
     number, where the author supplied one. "You are out by a factor of two"
     with the reason is worth more than "incorrect".

     Declared per page as <script type="application/json" data-exercises>, so a
     prose-only page can have them too — this pass is page-level, not panel-level. */
  function wireExercises() {
    document.querySelectorAll('script[type="application/json"][data-exercises]')
      .forEach((src) => {
        let spec;
        try { spec = JSON.parse(src.textContent); }
        catch (err) { console.warn('[viz] exercises are not valid JSON', err); return; }
        if (!spec || !spec.items || !spec.items.length) return;

        const host = document.createElement('section');
        host.className = 'exercises';
        host.innerHTML = '<h2 class="section-rule"><span>'
          + esc(spec.title || 'Check yourself') + '</span></h2>'
          + '<p class="exercises__intro">' + esc(spec.intro
            || 'No score, no tick. Each answer explains the mechanism, because that is '
             + 'the part worth keeping.') + '</p>';

        spec.items.forEach((item, i) => host.appendChild(buildExercise(item, i)));
        src.parentNode.insertBefore(host, src);
      });
  }

  function buildExercise(item, i) {
    const box = document.createElement('div');
    box.className = 'ex';
    const id = 'ex-' + i + '-' + Math.random().toString(36).slice(2, 7);
    const isChoice = Array.isArray(item.options) && item.options.length;

    box.innerHTML =
      '<p class="ex__ask">' + esc(item.ask) + '</p>'
      + (isChoice
        ? '<div class="ex__opts" role="group">' + item.options.map((o, k) =>
            '<button type="button" class="tool-btn" data-pick="' + k + '">'
            + esc(o.label) + '</button>').join('') + '</div>'
        : '<p class="ex__num"><input type="text" inputmode="decimal" id="' + id + '" '
          + 'aria-label="your answer">'
          + (item.unit ? '<span class="ex__unit">' + esc(item.unit) + '</span>' : '')
          + '<button type="button" class="tool-btn" data-check>check</button></p>')
      + (item.hint ? '<p class="ex__hintline"><button type="button" class="tool-btn" '
                   + 'data-hint>hint</button></p>' : '')
      + '<div class="ex__out" role="status" aria-live="polite" hidden></div>';

    const out = box.querySelector('.ex__out');

    const hintBtn = box.querySelector('[data-hint]');
    if (hintBtn) hintBtn.addEventListener('click', () => {
      hintBtn.parentNode.innerHTML = '<p class="ex__hint">' + esc(item.hint) + '</p>';
    });

    /* One renderer for every outcome. `verdict` is a plain statement of what
       happened; `why` is the mechanism and is ALWAYS shown. */
    function respond(verdict, tone, note) {
      out.hidden = false;
      out.className = 'ex__out ex__out--' + tone;
      out.innerHTML =
        '<p class="ex__verdict">' + esc(verdict) + '</p>'
        + (note ? '<p class="ex__note">' + esc(note) + '</p>' : '')
        + '<p class="ex__why">' + esc(item.why) + '</p>';
    }

    if (isChoice) {
      box.querySelectorAll('[data-pick]').forEach((b) => {
        b.addEventListener('click', () => {
          const o = item.options[+b.dataset.pick];
          box.querySelectorAll('[data-pick]').forEach((x) => {
            x.disabled = true;
            x.classList.toggle('is-answer', !!item.options[+x.dataset.pick].correct);
            x.classList.toggle('is-picked', x === b);
          });
          respond(o.correct ? 'That is the one.' : 'Not that one.',
                  o.correct ? 'ok' : 'no', o.note || '');
        });
      });
    } else {
      const input = box.querySelector('input');
      const check = () => {
        const v = parseFloat(String(input.value).replace(/,/g, ''));
        if (!isFinite(v)) { respond('Give a number and I will tell you what it means.', 'no', ''); return; }
        const want = item.answer, tol = item.tolerance === undefined ? 0.1 : item.tolerance;
        const rel = Math.abs(v - want) / (Math.abs(want) || 1);
        if (rel <= tol) {
          respond('Yes — ' + want + (item.unit ? ' ' + item.unit : '') + '.', 'ok', '');
          return;
        }
        /* A wrong number usually comes from a specific misreading, and naming it
           is the useful part. `misreads` lets the author say which. */
        let note = 'The answer is ' + want + (item.unit ? ' ' + item.unit : '') + '.';
        (item.misreads || []).forEach((m) => {
          if (Math.abs(v - m.value) / (Math.abs(m.value) || 1) <= tol) note = m.note;
        });
        const f = v / want;
        if (note.indexOf('answer is') === 0 && f > 1.8 && f < 2.2) {
          note += ' You are out by a factor of two, which on this site is almost always a '
                + 'convention: peak against peak-to-peak, a round trip against one way, or '
                + '10·log against 20·log.';
        }
        respond('Not quite.', 'no', note);
      };
      box.querySelector('[data-check]').addEventListener('click', check);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    }
    return box;
  }

  /* ---------- panel tools ----------
     A scenario link and a values table, added to every panel from the outside.
     Both read the DOM rather than asking the module for its state, which is what
     makes them universal: a module written before either existed still gets them,
     and neither can drift out of step with what is actually on screen. */
  function addTools(el) {
    const bar = el.querySelector('.instrument__bar');
    if (!bar || !window.SIPI.kit || bar.querySelector('.instrument__tools')) return;
    const K = window.SIPI.kit;
    const name = el.dataset.viz;

    const tools = document.createElement('span');
    tools.className = 'instrument__tools';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'tool-btn';
    link.textContent = 'link';
    link.title = 'Copy a link that reopens this panel with exactly these settings';
    link.addEventListener('click', () => {
      const url = location.origin + location.pathname + K.scenarioHash(el, name);
      const done = (ok) => {
        link.textContent = ok ? 'copied' : 'in address bar';
        link.dataset.done = '1';
        setTimeout(() => { link.textContent = 'link'; delete link.dataset.done; }, 1800);
      };
      /* history.replaceState, not location.hash: assigning the hash scrolls the
         page to whatever id happens to match, and a scenario string is not an id. */
      history.replaceState(null, '', K.scenarioHash(el, name));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
      } else done(false);
    });
    tools.appendChild(link);

    const vals = document.createElement('button');
    vals.type = 'button';
    vals.className = 'tool-btn';
    vals.textContent = 'values';
    vals.setAttribute('aria-expanded', 'false');
    const table = document.createElement('div');
    table.className = 'viz-values';
    table.hidden = true;
    el.appendChild(table);
    vals.addEventListener('click', () => {
      const open = table.hidden;
      vals.setAttribute('aria-expanded', String(open));
      if (open) renderValues(el, table);
      table.hidden = !open;
    });
    tools.appendChild(vals);

    /* M5-1 · keep it live. Every module writes its readouts synchronously in the
       same turn as the control event, so re-rendering on the bubble phase after
       a microtask gets the values the panel just computed rather than the ones
       it is about to replace.

       The events are the panel's own: a slider moving, a select changing, a
       checkbox, a preset button. Watching the panel subtree rather than binding
       each control means a module that adds a control later is covered without
       anybody remembering to come back here. */
    const refresh = () => {
      if (table.hidden) return;
      Promise.resolve().then(() => { if (!table.hidden) renderValues(el, table); });
    };
    el.addEventListener('input', refresh);
    el.addEventListener('change', refresh);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.preset, .mode, [data-act]')) refresh();
    });
    document.addEventListener('sipi:theme', refresh);

    wireControlsToggle(el);
    wireZoom(el, tools);
    wirePin(el, tools);
    bar.appendChild(tools);
    wireLegend(el);
    wireTabs(el);
    wireWorkspace(el);
    wireModes(el, bar);
  }

  /* M5-1 · ONE atomic snapshot — settings, readouts, scenario link and timestamp
     all taken in a single pass, so they cannot describe different moments.

     What this replaces: renderValues scraped the DOM into `rows` when the table
     was OPENED, and the CSV button closed over that array. Nothing re-scraped
     when a control moved or a preset was applied, while exportCsv called
     provenance() fresh — so opening the values on the Gen5 preset and then
     selecting Gen4 gave a table still showing 10 in / 22 dB / 32 GT/s and a CSV
     pairing those rows with the Gen4 scenario URL. The export was internally
     inconsistent, and nothing on screen said so.

     The table is now LIVE: it re-renders whenever the panel does, and the CSV
     takes its own fresh snapshot at click time rather than reusing a captured
     one. A4 allowed either that or a clearly-labelled pinned snapshot; live is
     the one that cannot be misread. */
  /* N4-1 / R10. A snapshot is now the MODEL RESULT where one exists, and the
     scraped display only where it does not — and it says which.

     What it replaced: `.ctl` outputs and `[data-out]` text, which are rounded
     display strings ("254 mV", "14 dB"), miss any control that is not inside a
     `.ctl`, and were stamped with the CONTRACT ISLAND's version rather than the
     version of the code that produced the numbers. Those two already disagreed —
     Lab B's contract read 3.0 while its result read 1.0 — so an export could
     carry a version that described neither the numbers nor the panel.

     A scraped snapshot is not wrong, it is just weaker, and mixing the two
     silently was the actual defect. `source` distinguishes them. */
  function numberRows(res) {
    const rows = [], units = res.units || {};
    const unitFor = (k) => (units[k] ? ' ' + units[k] : '');
    Object.keys(res.params || {}).forEach((k) => {
      const v = res.params[k];
      rows.push(['set', k, typeof v === 'number' ? v + unitFor(k) : String(v), v]);
    });
    Object.keys(res.measurements || {}).forEach((k) => {
      const v = res.measurements[k];
      rows.push(['read', k, typeof v === 'number' ? v + unitFor(k) : String(v), v]);
    });
    return rows;
  }

  function snapshot(el) {
    const K = window.SIPI.kit;
    const published = K && K.published ? K.published(el) : null;
    if (published) {
      const island0 = el.querySelector('script[type="application/json"][data-contract]');
      let contract0 = null;
      if (island0) { try { contract0 = JSON.parse(island0.textContent); } catch (e0) { contract0 = null; } }
      return {
        panel: el.dataset.viz,
        source: 'model',
        model: published.model,
        modelVersion: published.version,
        status: published.status,
        why: published.why || null,
        units: published.units || {},
        origins: published.origins || {},
        conventions: published.conventions || {},
        stimulus: published.stimulus || null,
        diagnostics: published.diagnostics || {},
        rows: numberRows(published),
        contract: contract0,
        /* Recorded, not reconciled. The contract island describes the PANEL's
           fidelity tier and is versioned by hand; the result is versioned by the
           code. When they differ that is information, so both travel. */
        contractVersion: contract0 ? contract0.version : null,
        scenario: K && K.scenarioHash
          ? location.origin + location.pathname + K.scenarioHash(el, el.dataset.viz) : location.href,
        at: new Date().toISOString()
      };
    }
    const rows = [];
    el.querySelectorAll('.ctl').forEach((c) => {
      const inp = c.querySelector('input, select');
      const lab = c.querySelector('label, .ctl__label');
      if (!inp || !lab) return;
      const out = c.querySelector('output, .ctl__out');
      rows.push(['set', lab.textContent.trim(),
        (out && out.textContent.trim()) || (inp.type === 'checkbox' ? (inp.checked ? 'on' : 'off') : inp.value)]);
    });
    el.querySelectorAll('[data-out]').forEach((o) => {
      const host = o.closest('span, li, div');
      const label = host ? host.textContent.replace(o.textContent, '').trim() : o.dataset.out;
      rows.push(['read', label || o.dataset.out, o.textContent.trim()]);
    });
    /* The contract island, so an export carries the model's own fidelity tier
       and version rather than the badge's rendered text. */
    let contract = null;
    const island = el.querySelector('script[type="application/json"][data-contract]');
    if (island) { try { contract = JSON.parse(island.textContent); } catch (err) { contract = null; } }
    const name = el.dataset.viz;
    return {
      panel: name,
      source: 'display',
      model: null,
      modelVersion: null,
      status: null,
      rows: rows,
      contract: contract,
      contractVersion: contract ? contract.version : null,
      scenario: K && K.scenarioHash
        ? location.origin + location.pathname + K.scenarioHash(el, name) : location.href,
      at: new Date().toISOString()
    };
  }

  function renderValues(el, into) {
    const snap = snapshot(el);
    into.innerHTML =
      '<table><caption>Settings and readouts, live — this table follows the panel</caption><tbody>'
      + snap.rows.map((r) => '<tr><td class="viz-values__k">' + esc(r[0]) + '</td><th scope="row">'
        + esc(r[1]) + '</th><td>' + esc(r[2]) + '</td></tr>').join('')
      + '</tbody></table>'
      /* N4-1. The stamp used to carry the CONTRACT's version as if it described
         the numbers. It describes the panel. Where the two differ — and they
         did — both are shown, because that difference is information. */
      + '<p class="viz-values__stamp">' + esc(snap.panel)
      + (snap.contract ? ' · ' + esc(snap.contract.kind) : '')
      + (snap.source === 'model'
          ? ' · model ' + esc(snap.model) + ' v' + esc(snap.modelVersion)
            + (snap.contractVersion && snap.contractVersion !== snap.modelVersion
                ? ' · contract v' + esc(snap.contractVersion) : '')
            + (snap.stimulus && snap.stimulus.numericalMethod
                ? ' · method ' + esc(snap.stimulus.numericalMethod) : '')
            + (snap.status && snap.status !== 'ok' ? ' · ' + esc(snap.status) : '')
          : ' · displayed values, not the model result')
      + ' · read ' + esc(snap.at.replace('T', ' ').slice(0, 19)) + 'Z</p>'
      + '<div class="viz-values__acts">'
      + '<button type="button" class="tool-btn" data-x="csv">copy this table</button>'
      + (snap.source === 'model'
          ? '<button type="button" class="tool-btn" data-x="traces">copy the traces</button>' : '')
      + '<button type="button" class="tool-btn" data-x="png">save image</button>'
      + '</div>';
    into.querySelector('[data-x="csv"]').addEventListener('click', (e) => {
      /* A FRESH snapshot, not the one this table was rendered from. Even a live
         table can be a frame behind if a control moved between render and
         click, and the export is the artefact somebody keeps. */
      const ok = copyText(exportCsv(el, snapshot(el)));
      flash(e.target, ok ? 'copied' : 'copy failed', 'copy this table');
    });
    const traceBtn = into.querySelector('[data-x="traces"]');
    if (traceBtn) traceBtn.addEventListener('click', (e) => {
      const ok = copyText(exportTraceCsv(el, snapshot(el)));
      flash(e.target, ok ? 'copied' : 'copy failed', 'copy the traces');
    });
    into.querySelector('[data-x="png"]').addEventListener('click', (e) => {
      exportPng(el);
      flash(e.target, 'saved', 'save image');
    });
  }

  function flash(btn, msg, back) {
    btn.textContent = msg;
    btn.dataset.done = '1';
    setTimeout(() => { btn.textContent = back; delete btn.dataset.done; }, 1600);
  }

  function copyText(t) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
    navigator.clipboard.writeText(t);
    return true;
  }

  /* ---------- provenance ----------
     A number copied out of a panel and pasted into a report loses everything
     that made it meaningful: what model produced it, what that model assumes,
     and what settings it was computed at. So every export carries all three.

     The evidence level and version come from data attributes the build stamps
     onto the model badge from docs/model-types.json, and the assumptions are the
     badge's own title. Nothing here is typed twice or fetched at runtime. */
  function provenance(el, snap) {
    const K = window.SIPI.kit;
    const badge = el.querySelector('.model-tag');
    const name = el.dataset.viz;
    const c = snap && snap.contract;
    const title = (document.querySelector('h1') || {}).textContent || document.title;
    return {
      panel: name,
      page: (title || '').trim(),
      model: c ? c.kind : (badge ? badge.textContent.trim() : 'unknown'),
      evidence: c ? c.evidence
        : (badge ? (badge.dataset.evidence || 'unstated') : 'unstated'),
      version: c ? c.version
        : (badge ? (badge.dataset.modelVersion || 'unstated') : 'unstated'),
      assumptions: c ? (c.validity || '') : (badge ? (badge.getAttribute('title') || '') : ''),
      limitations: c ? (c.limitations || '') : '',
      /* Both from the snapshot when there is one, so the URL and the timestamp
         describe the same instant as the rows. */
      scenario: (snap && snap.scenario) || (K && K.scenarioHash
        ? location.origin + location.pathname + K.scenarioHash(el, name) : location.href),
      exported: (snap && snap.at) || new Date().toISOString()
    };
  }

  function exportCsv(el, snap) {
    const rows = snap.rows;
    const p = provenance(el, snap);
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const head = [
      ['# panel', p.panel], ['# page', p.page],
      ['# model', p.model], ['# evidence', p.evidence], ['# contract version', p.version],
      ['# assumptions', p.assumptions],
      ['# known limitations', p.limitations],
      ['# scenario', p.scenario], ['# exported', p.exported],
      ['# snapshot', 'settings and readouts below were read in one pass at the '
                     + 'timestamp above, from the scenario link above'],
      ['# source', snap.source === 'model'
        ? 'the model result itself — full precision, the model\u2019s own units'
        : 'the panel\u2019s DISPLAYED values — rounded for reading, and only the '
          + 'controls inside a .ctl block. This panel publishes no model result.'],
      ['# model version', snap.modelVersion || '(none)'],
      ...(snap.stimulus && snap.stimulus.numericalMethod
        ? [['# numerical method', snap.stimulus.numericalMethod]] : []),
      ['# status', snap.status || '(not reported)'],
      ['# note', 'This is a model result, not a measurement \u2014 see the '
                 + 'assumptions above.'],
      [], ['kind', 'quantity', 'value']
    ];
    return head.concat(rows.map((r) => r.slice(0, 3)))
               .map((r) => r.map(q).join(',')).join('\n');
  }

  /* N4-4 / R10. A DISTINCT numerical trace export. The summary above is a table
     of settings and readouts; this is the curves themselves, at the precision the
     model computed them, each with its own abscissa and both units named.

     Every trace is emitted, and the header says which views the panel was showing
     — an export whose contents depend on which tab happened to be open is not
     reproducible, which was one of the report figure's faults too. */
  function exportTraceCsv(el, snap) {
    const K = window.SIPI.kit;
    const res = K && K.published ? K.published(el) : null;
    const p = provenance(el, snap);
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [
      ['# panel', p.panel], ['# page', p.page],
      ['# model', snap.model || p.model], ['# model version', snap.modelVersion || '(none)'],
      ...(snap.stimulus && snap.stimulus.numericalMethod
        ? [['# numerical method', snap.stimulus.numericalMethod]] : []),
      ['# status', snap.status || '(not reported)'],
      ['# scenario', p.scenario], ['# exported', p.exported],
      ['# assumptions', p.assumptions],
      ['# known limitations', p.limitations]
    ];
    if (!res || !res.traces || !res.traces.length) {
      lines.push([], ['# this panel publishes no numerical traces']);
      return lines.map((r) => r.map(q).join(',')).join('\n');
    }
    if (res.status !== 'ok') {
      lines.push([], ['# the model refused this configuration, so there are no '
                      + 'numbers to export'], ['# why', res.why || '']);
      return lines.map((r) => r.map(q).join(',')).join('\n');
    }
    res.traces.forEach((t) => {
      const xs = t.x && t.x.values, ys = t.y;
      if (!xs || !ys) return;
      lines.push([]);
      lines.push(['# trace', t.id, t.label || '']);
      lines.push([t.x.name + ' [' + t.x.unit + ']', (t.label || t.id) + ' [' + t.unit + ']']);
      const n = Math.min(xs.length, ys.length);
      for (let i = 0; i < n; i++) lines.push([xs[i], ys[i]]);
    });
    return lines.map((r) => r.map(q).join(',')).join('\n');
  }

  /* The image carries the same provenance, painted into it — a screenshot that
     loses its assumptions the moment it is pasted into a slide is exactly the
     failure this is meant to prevent. */
  /* M5-2 · A deliberate report figure, not a stack of canvases.
     What this replaces stitched every canvas together with no labels, dropped
     the HTML legends and the readouts entirely, and passed a maxWidth to
     fillText — which does not wrap, it COMPRESSES, so a long assumptions string
     became one squashed illegible line. The footer also carried less than the
     CSV did, so the two exports of the same result disagreed about what the
     result was.

     The figure now carries what somebody would need to read it a year later
     with no website around it: a title, each view with its own caption, the
     parameters that produced it, the readouts, the model's fidelity tier and
     version, its stated assumptions and known limitations wrapped properly, the
     scenario link, and a timestamp. */
  function wrapText(ctx, text, maxW) {
    const lines = [];
    let line = '';
    const push = () => { if (line) { lines.push(line); line = ''; } };
    String(text || '').split(/\s+/).filter(Boolean).forEach((word) => {
      /* A scenario URL is one unbreakable token and was clipping at the right
         edge — a provenance line you cannot read is not provenance. Break by
         character when a single word will not fit on a line of its own. */
      if (ctx.measureText(word).width > maxW) {
        push();
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxW && chunk) { lines.push(chunk); chunk = ''; }
          chunk += ch;
        }
        line = chunk;
        return;
      }
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= maxW || !line) { line = next; return; }
      push(); line = word;
    });
    push();
    return lines;
  }

  function exportPng(el) {
    const snap = snapshot(el);
    const p = provenance(el, snap);
    /* N4-7 / R10. Five faults in this selection and its geometry.

       GHOSTS were filtered out, so a pinned A/B comparison — the one thing a
       reader most wants to put in a report — never reached the image. They are
       included now and labelled.

       HIDDEN VIEWS are still excluded, because a tab nobody is looking at has
       not necessarily been drawn. But the report now carries a MANIFEST saying
       which views it contains and which it left out, so an export whose contents
       depend on the open tab says so instead of looking complete. */
    const all = [...el.querySelectorAll('canvas')].filter((c) => c.width > 0);
    const live = all.filter((c) => !c.classList.contains('ghost'));
    const src = live.filter((c) => !c.closest('[hidden]'));
    const omitted = live.filter((c) => c.closest('[hidden]'));
    /* A pinned reference is not a separate view — it is drawn BEHIND its live
       canvas at 42% opacity, and that is what the reader sees. Listing the two
       separately doubled the report with near-identical pictures; compositing
       them reproduces the comparison. */
    const ghostOf = (c) => {
      const host = c.closest('.probe-host');
      const g = host && host.querySelector('canvas.ghost');
      return g && g.width === c.width ? g : null;
    };
    const withGhost = src.filter((c) => ghostOf(c)).length;
    if (!src.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = (n) => Math.round(n * dpr);
    const pad = S(16), lineH = S(15), capH = S(18);
    /* The RIGHT EDGE was clipped by exactly one pad. W was the widest canvas,
       and every canvas is drawn at x = pad — so the widest one ran from pad to
       pad + W and lost its last `pad` pixels, which on a plot is the right-hand
       axis labels. Both margins are allocated now. */
    const W = Math.max(Math.max.apply(null, src.map((c) => c.width)) + pad * 2, S(560));
    const inner = W - pad * 2;

    const cs = getComputedStyle(document.documentElement);
    const col = (n, f) => cs.getPropertyValue(n).trim() || f;
    const MONO = (window.SIPI.kit ? window.SIPI.kit.MONO : 'monospace');

    /* Measure first, then draw, because the height depends on how the prose
       wraps and the wrap depends on the font. */
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = S(10) + 'px ' + MONO;
    const sets = snap.rows.filter((r) => r[0] === 'set');
    const reads = snap.rows.filter((r) => r[0] === 'read');
    const blocks = [];
    const addProse = (label, text) => {
      if (!text) return;
      blocks.push({ label, lines: wrapText(probe, text, inner - S(90)) });
    };
    if (snap.stimulus && snap.stimulus.numericalMethod) {
      addProse('method', snap.stimulus.numericalMethod);
    }
    addProse('assumptions', p.assumptions);
    /* Several contracts have no distinct `limitations` field yet and fall back
       to their validity text, so printing both would repeat the same paragraph
       under two headings — which reads as two separate caveats. */
    if (p.limitations && p.limitations.trim() !== (p.assumptions || '').trim()) {
      addProse('limitations', p.limitations);
    }
    addProse('scenario', p.scenario);

    /* Captions are WRAPPED now. They were painted with a bare fillText while the
       assumptions beside them went through wrapText, so a long panel label ran
       off the right edge of the very report that exists to be readable. */
    /* N4-8. `closest('figure')` was the bug the DOWNLOADED-EXPORT AUDIT found and
       every programmatic check missed: Lab B's canvases live in `div.panel`, not
       in a `figure`, so both the caption and the legend lookup returned null and
       neither has ever appeared in a Lab B report. The margins, the compositing
       and the manifest all measured correct while the labels were simply absent.
       Look at the picture. */
    const figOf = (c) => c.closest('figure, .panel');
    const captions = src.map((c) => {
      const fig = figOf(c);
      const cap = fig && fig.querySelector('figcaption, .panel__label');
      const text = cap ? cap.textContent.trim() : '';
      return text ? wrapText(probe, text, inner) : [];
    });
    /* The HTML legend belongs in the report. Copying plot pixels alone drops the
       only thing that says which colour is which — and this site's own rule is
       that identity is never colour alone. */
    const legends = src.map((c) => {
      const fig = figOf(c) || c.parentElement;
      const leg = fig && fig.querySelector('.legend');
      if (!leg) return [];
      return [...leg.querySelectorAll('span')].map((sp) => sp.textContent.trim()).filter(Boolean);
    });

    let h = pad + S(20) + lineH * 2 + S(10);                    // title block
    src.forEach((c, i) => {
      h += captions[i].length * capH + c.height + S(8);
      if (legends[i].length) h += lineH * Math.ceil(legends[i].length / 2) + S(4);
    });
    if (omitted.length || withGhost) h += lineH + S(6);        // the view manifest
    h += S(8) + lineH * (1 + Math.ceil(sets.length / 2)) + S(6);  // parameters
    if (reads.length) h += lineH * (1 + Math.ceil(reads.length / 2)) + S(6);
    blocks.forEach((b) => { h += lineH * (b.lines.length + 0.4); });
    h += lineH * 2 + pad;

    const out = document.createElement('canvas');
    out.width = W; out.height = Math.ceil(h);
    const ctx = out.getContext('2d');
    ctx.fillStyle = col('--surface', '#fff');
    ctx.fillRect(0, 0, W, out.height);
    ctx.textBaseline = 'top';

    let y = pad;
    // ── title ──
    ctx.fillStyle = col('--ink', '#111');
    ctx.font = '600 ' + S(14) + 'px ' + MONO;
    ctx.fillText(p.page, pad, y); y += S(20);
    ctx.fillStyle = col('--ink2', '#444');
    ctx.font = S(10) + 'px ' + MONO;
    /* N4-1. Both versions, as the values stamp does — the contract versions the
       panel and the result versions the code, and they differ. */
    ctx.fillText(p.panel + ' · ' + p.model + ' · contract v' + p.version
                 + (snap.modelVersion ? ' · model v' + snap.modelVersion : '')
                 + ' · evidence: ' + p.evidence, pad, y); y += lineH;
    ctx.fillStyle = col('--muted', '#666');
    ctx.fillText('a MODEL result, not a measurement · ' + p.exported.replace('T', ' ').slice(0, 19) + 'Z',
                 pad, y); y += lineH + S(10);

    // ── each view, with its own caption ──
    src.forEach((c, i) => {
      if (captions[i].length) {
        ctx.fillStyle = col('--ink2', '#444');
        ctx.font = '600 ' + S(10) + 'px ' + MONO;
        captions[i].forEach((ln) => { ctx.fillText(ln, pad, y); y += capH; });
      }
      /* N4-8, from the MOBILE audit. The report has a minimum width so the prose
         blocks stay readable, and on a phone every canvas is far narrower than
         that — so each plot sat hard against the left edge of a page twice its
         width, which reads as a rendering fault rather than a layout choice.
         Centre anything narrower than the text column. Scaling the bitmap up
         instead would blur a plot to fill space, which is worse. */
      const cx = pad + Math.max(0, Math.round((inner - c.width) / 2));
      const gh = ghostOf(c);
      if (gh) {
        ctx.save();
        ctx.globalAlpha = 0.42;                 // the same weight the page uses
        ctx.drawImage(gh, cx, y);
        ctx.restore();
      }
      ctx.drawImage(c, cx, y);
      y += c.height + S(4);
      /* The legend, in the report, in two columns under its own plot. */
      if (legends[i].length) {
        ctx.font = S(10) + 'px ' + MONO;
        ctx.fillStyle = col('--muted', '#666');
        const halfL = Math.ceil(legends[i].length / 2);
        const legW = Math.min(inner, c.width);
        legends[i].forEach((t, j) => {
          ctx.fillText(t, cx + (j < halfL ? 0 : legW / 2), y + (j % halfL) * lineH);
        });
        y += lineH * halfL + S(4);
      }
      y += S(4);
    });
    if (omitted.length || withGhost) {
      ctx.font = S(10) + 'px ' + MONO;
      ctx.fillStyle = col('--muted', '#666');
      const bits = ['views in this report: ' + src.length + ' of ' + live.length];
      if (omitted.length) bits.push(omitted.length + ' not shown because their tab was closed');
      if (withGhost) bits.push(withGhost + ' carry a pinned reference behind them');
      ctx.fillText(bits.join(' \u2014 '), pad, y);
      y += lineH + S(6);
    }

    // ── parameters and readouts, in two columns ──
    const twoCol = (title, list) => {
      if (!list.length) return;
      ctx.fillStyle = col('--ink2', '#444');
      ctx.font = '600 ' + S(10) + 'px ' + MONO;
      ctx.fillText(title, pad, y); y += lineH;
      ctx.font = S(10) + 'px ' + MONO;
      ctx.fillStyle = col('--muted', '#666');
      const half = Math.ceil(list.length / 2), colW = inner / 2;
      list.forEach((r, i) => {
        const cx = pad + (i < half ? 0 : colW);
        const cy = y + (i % half) * lineH;
        const label = r[1].length > 26 ? r[1].slice(0, 25) + '\u2026' : r[1];
        let text = label + '  ' + r[2];
        /* Clipped at the column edge rather than painted over the next column.
           `fillText`'s maxWidth argument would COMPRESS it, which is the defect
           this whole function exists to remove. */
        if (ctx.measureText(text).width > colW - S(10)) {
          while (text.length > 4 && ctx.measureText(text + '\u2026').width > colW - S(10)) {
            text = text.slice(0, -1);
          }
          text += '\u2026';
        }
        ctx.fillText(text, cx, cy);
      });
      y += half * lineH + S(6);
    };
    twoCol('parameters', sets);
    twoCol('readouts', reads);

    // ── prose, WRAPPED rather than compressed ──
    blocks.forEach((b) => {
      ctx.fillStyle = col('--muted', '#666');
      ctx.font = '600 ' + S(10) + 'px ' + MONO;
      ctx.fillText(b.label, pad, y);
      ctx.font = S(10) + 'px ' + MONO;
      b.lines.forEach((t, i) => ctx.fillText(t, pad + S(90), y + i * lineH));
      y += lineH * (b.lines.length + 0.4);
    });

    ctx.fillStyle = col('--border', '#ccc');
    ctx.fillRect(pad, y + S(2), inner, Math.max(1, S(1)));

    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = p.panel + '-' + p.exported.slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* A scenario in the URL is applied after every panel has mounted and rendered
     once, so the controls it writes to exist and the module's own listeners are
     already attached. A link naming a panel this page does not have is reported
     rather than ignored — a stale link should fail where you can see it. */
  function applyHash() {
    const K = window.SIPI.kit;
    if (!K || !K.parseHash) return;
    const want = K.parseHash(location.hash);
    const oldError = document.querySelector('.scenario-invalid');
    if (oldError) oldError.remove();
    if (!want) {
      if (location.hash.startsWith('#lab=')) {
        const note = document.createElement('p');
        note.className = 'viz-failed scenario-invalid';
        note.setAttribute('role', 'status');
        note.textContent = 'This experiment link could not be read. The displayed settings have not been changed by the link.';
        const panel = document.querySelector('[data-viz]');
        if (panel) panel.before(note);
      }
      return;
    }
    const el = document.querySelector('[data-viz="' + CSS.escape(want.viz) + '"]');
    if (!el) { console.warn('[viz] scenario names a panel not on this page: ' + want.viz); return; }
    const n = K.applyScenario(el, want.vals);
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    console.info('[viz] scenario applied to ' + want.viz + ' (' + n + ' controls)');

    /* A4 · If the link was made against a different model version, say so where
       the reader is looking rather than only in the console. The parameters
       still apply — this is not a refusal — but the same numbers may mean
       something different now, and silently reinterpreting them is exactly what
       provenance is supposed to prevent. */
    let mine = null;
    const island = el.querySelector('script[type="application/json"][data-contract]');
    if (island) { try { mine = JSON.parse(island.textContent).version; } catch (e) { mine = null; } }
    if (want.version && mine && want.version !== mine) {
      const note = document.createElement('p');
      note.className = 'viz-stale';
      note.setAttribute('role', 'status');
      note.innerHTML = '<b>This link was made against model version '
        + esc(want.version) + '; this panel is version ' + esc(mine) + '.</b> '
        + 'The settings have been applied, but a control may not mean the same '
        + 'thing it did — check the <em>verify</em> tab before quoting the result.';
      const bar = el.querySelector('.instrument__bar');
      if (bar && !el.querySelector('.viz-stale')) bar.insertAdjacentElement('afterend', note);
    }
  }

  NS.mount = function () {
    document.querySelectorAll('[data-viz]').forEach((el) => {
      if (el.dataset.vizMounted) return;
      const factory = NS.viz[el.dataset.viz];
      if (typeof factory !== 'function') return;
      let inst;
      try { inst = factory(el); } catch (err) {
        /* A console error is invisible to a reader, who is left looking at an
           empty frame with no idea whether the panel is broken or still loading.
           Say so in the page, and keep the surrounding prose usable. */
        console.error('[viz] ' + el.dataset.viz + ' failed to mount', err);
        const note = document.createElement('p');
        note.className = 'viz-failed';
        note.setAttribute('role', 'status');
        note.innerHTML = '<b>This panel could not start.</b> The explanation below stands on its '
          + 'own — the interactive model is what is unavailable, not the physics. '
          + '<span class="viz-failed__id">' + el.dataset.viz + '</span>';
        el.appendChild(note);
        el.dataset.vizFailed = '1';
        return;
      }
      el.dataset.vizMounted = '1';

      /* Tall panels get their controls pinned to the bottom edge while on screen,
         so a slider and the plot it changes are visible together. Measured after
         a frame, because before the first render the canvases have no height —
         and applied here rather than in viz-kit, because the older modules have
         their own lifecycle and never call K.mount. */
      const measureTall = () => {
        el.classList.toggle('is-tall',
          el.getBoundingClientRect().height > window.innerHeight * 0.92);
      };
      requestAnimationFrame(() => requestAnimationFrame(measureTall));

      /* Numeric entry beside every slider. Applied here, not in viz-kit, for the
         same reason as the height measurement: the older modules never call
         K.mount, and a precise value should not need pixel-accurate dragging on
         some panels and not others. */
      // Called synchronously: the factory above already ran its first render, so
      // the <output> elements hold the values numericEntry reads to infer scale.
      try { if (NS.kit && NS.kit.numericEntry) NS.kit.numericEntry(el); }
      catch (err) { console.warn('[viz] numeric entry skipped for ' + el.dataset.viz, err); }
      /* Probe cursor on every canvas the kit drew a plot on. Same reasoning as
         above — it belongs to the loader, not the kit, because the pre-kit modules
         never call K.mount and a reader should not have to know which panel is
         which to get a readout. Canvases the kit never plotted on (the pure
         schematic views) get no probe: cv.__plot is absent and K.probe's handlers
         return early, but the wrapper would still be pointless, so skip them. */
      try {
        if (NS.kit && NS.kit.probe) {
          el.querySelectorAll('canvas').forEach((cv) => { if (cv.__plot) NS.kit.probe(cv); });
        }
      } catch (err) { console.warn('[viz] probe skipped for ' + el.dataset.viz, err); }

      addTools(el);

      /* The desktop lab workspace, for a lab whose markup declares the frame. It is
         layout only — fitted plot heights, view tabs, expanded plots, full screen —
         and it mounts after the tools so the header buttons it decorates exist. A
         page without a .lab-frame is untouched, which is what keeps this one hook
         from changing every panel on the site. */
      if (NS.labWorkspace && el.querySelector('.lab-frame')) {
        try {
          const ws = NS.labWorkspace.mount(el);
          /* Disposing the panel disposes its layout, so the canvases go back to the
             heights their module asked for and no listener outlives the panel. */
          if (inst && typeof inst.destroy === 'function') {
            const destroy = inst.destroy.bind(inst);
            inst.destroy = function () { ws.dispose(); return destroy(); };
          }
        } catch (err) { console.warn('[viz] workspace layout skipped for ' + el.dataset.viz, err); }
      }

      window.addEventListener('resize', measureTall);
      if (!inst || !inst.start) return;

      if (!('IntersectionObserver' in window)) { inst.start(); return; }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => (e.isIntersecting ? inst.start() : inst.stop()));
      }, { threshold: 0.25 });
      io.observe(el);
    });
  };

  const boot = () => { NS.mount(); wireExercises(); applyHash(); };
  /* A scenario link clicked while already on the page changes the hash without
     reloading, so boot never runs again. Without this the link looks broken in
     exactly the case it is most likely to be used: someone pasting a setting into
     a thread that is already open on that topic. */
  window.addEventListener('hashchange', applyHash);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
