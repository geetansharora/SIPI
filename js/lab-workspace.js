/* The lab workspace: the desktop arrangement that puts a control and the plots it
   changes on one screen.
 *
 * It owns layout and nothing else. It never reads or writes model state, never
 * changes a measurement, and every height it sets is restored exactly when it is
 * disposed — a workspace that is switched off leaves the lab drawing at the sizes
 * its module asked for.
 *
 * The page supplies the structure: .lab-frame with .lab-rail columns around a
 * .lab-stage, plot blocks marked data-lab-unit, and optional view tabs. This file
 * supplies the behaviour that needs measurement at runtime — fitting plot heights
 * to the window, switching views, expanding a plot, full screen, and the rail help
 * line. Nothing here builds the arrangement itself; markup that is absent is a
 * feature the page did not ask for, not an error.
 *
 * Mounted by viz-loader.js for a [data-viz] root that contains a .lab-frame. */
(function () {
  'use strict';
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  if (!K) return;

  /* The one height policy. A plot is never drawn shorter than this, unless it is so
     narrow that this would make it taller than 0.9 of its own width — then the width
     cap wins, because a plot taller than it is wide reads as a column, not a trace.
     The kit deliberately imposes no floor of its own, so this is the only place a
     minimum height is decided. */
  const MIN_PLOT_PX = 110;
  const WIDTH_CAP = 0.9;

  const box = (el) => el.getBoundingClientRect();
  const visible = (el) => el.getClientRects().length > 0;

  /* ---------- fitting the plots to the window ---------- */

  function fit(root, state0) {
    state0 = state0 || {};
    const frame = root.querySelector('.lab-frame');
    const stage = root.querySelector('.lab-stage');
    if (!frame || !stage) return false;
    const all = [].slice.call(root.querySelectorAll('canvas[data-cv]'));

    /* Below the desktop breakpoint the frame is ordinary page flow and every plot
       keeps the height its module asked for. */
    if (state0.applyViewVisibility) state0.applyViewVisibility();
    if (getComputedStyle(frame).display !== 'grid') return release(root, all);

    const shown = all.filter((cv) => stage.contains(cv) && visible(cv));
    if (!shown.length) return false;
    shown.sort((a, b) => box(a).top - box(b).top);

    /* Rows by vertical overlap, so two plots side by side count once even when a
       hint above one of them offsets its top edge. */
    const rows = [];
    shown.forEach((cv) => {
      const r = box(cv), row = rows[rows.length - 1];
      if (row && r.top < row.bottom - 4) { row.cvs.push(cv); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ bottom: r.bottom, cvs: [cv] });
    });
    const shownH = rows.reduce((s, row) => s + Math.max.apply(null, row.cvs.map((cv) => box(cv).height)), 0);

    /* A side column may use whatever height is left below its own top edge and
       scrolls beyond that, so it never decides how tall the plots can be. */
    const padBottom = parseFloat(getComputedStyle(stage).paddingBottom) || 0;
    root.querySelectorAll('.lab-side').forEach((side) => {
      if (!stage.contains(side) || !visible(side)) return;
      const top = box(side).top - box(stage).top + stage.scrollTop;
      side.style.maxHeight = Math.max(160, Math.floor(stage.clientHeight - top - padBottom - 2)) + 'px';
    });

    const kids = [].slice.call(stage.children).filter(visible);
    if (!kids.length) return false;
    const bottom = Math.max.apply(null, kids.map((k) => box(k).bottom));
    const used = bottom - box(stage).top + stage.scrollTop + padBottom;
    const room = stage.clientHeight - (used - shownH) - 4;        // 4 px: rounding across rows
    const ceiling = stage.classList.contains('is-focus') ? 3.2 : 1.6;

    /* One factor for every plot, each held between the pixel floor and its width
       cap. A floor in pixels rather than as a fraction lets a tall plot give up more
       height than a short one. The largest factor whose rows fit is found by
       bisection, since those floors make total height a piecewise function of it. */
    /* A lab whose plots do not survive being drawn shorter -- a bar chart with a
       row per contributor loses its last rows -- marks its frame data-lab-fit="grow".
       Its plots are then never drawn below the heights its module asked for: they
       grow where there is room (full screen, an expanded plot), and where there is
       not, the stage scrolls as it would with no workspace at all. */
    const grow = frame.dataset.labFit === 'grow';
    const native = (cv) => K.canvasHeight.native(cv) || box(cv).height;
    const heightAt = (cv, f) => {
      // a plot that gains nothing from height, a row of bars, keeps its own
      if (cv.hasAttribute('data-lab-fixed')) return native(cv);
      const cap = WIDTH_CAP * (cv.clientWidth || 320);
      const h = Math.min(cap, Math.max(Math.min(MIN_PLOT_PX, cap), f * native(cv)));
      return grow ? Math.max(native(cv), h) : h;
    };
    const total = (f) => rows.reduce((s, row) => s + Math.max.apply(null, row.cvs.map((cv) => heightAt(cv, f))), 0);
    let lo = grow ? 1 : 0.2, hi = ceiling;
    if (total(hi) <= room) lo = hi;
    else if (!grow || total(lo) <= room) {
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (total(mid) <= room) lo = mid; else hi = mid; }
    }

    let changed = false;
    shown.forEach((cv) => {
      const want = Math.round(heightAt(cv, lo));
      const have = K.canvasHeight.get(cv) || native(cv);
      if (Math.abs(have - want) <= 1) return;
      // within a pixel of its own height, the override is noise: drop it entirely
      if (Math.abs(want - native(cv)) <= 1) K.canvasHeight.clear(cv);
      else K.canvasHeight.set(cv, want);
      changed = true;
    });
    if (changed) K.repaint(root);
    return changed;
  }

  /* Give every plot its own height back. Used below the breakpoint and on dispose,
     so switching the workspace off is not a different rendering path — it is the
     page the module would have drawn on its own. */
  function release(root, all) {
    let cleared = false;
    (all || root.querySelectorAll('canvas[data-cv]')).forEach((cv) => {
      if (K.canvasHeight.get(cv)) { K.canvasHeight.clear(cv); cleared = true; }
    });
    root.querySelectorAll('.lab-side').forEach((side) => { side.style.maxHeight = ''; });
    if (cleared) K.repaint(root);
    return cleared;
  }

  /* Two passes: the first estimate treats everything that is not a canvas as fixed,
     which text wrapping at the new widths can slightly disturb. Layout reads force a
     synchronous reflow, so no animation frame is needed — and frames are not
     delivered at all while the page is hidden. */
  function refitter(root, state) {
    return function refit() {
      if (state.dead) return;
      clearTimeout(state.second);
      fit(root, state);
      state.second = setTimeout(() => { if (!state.dead) fit(root, state); }, 60);
    };
  }

  /* ---------- plots that first appear inside a tab ----------
     The loader attaches a probe to every canvas the kit had already plotted on when
     the panel mounted. A canvas inside an inactive view had no plot yet, so it was
     skipped; it gets its probe the first time it is drawn. Marking them keeps a tab
     switch from stacking a second set of listeners on the same canvas. */
  function markProbed(root) {
    root.querySelectorAll('canvas[data-cv]').forEach((cv) => { if (cv.__plot) cv.__labProbed = true; });
  }
  function probeRevealed(root) {
    if (!K.probe) return;
    root.querySelectorAll('canvas[data-cv]').forEach((cv) => {
      if (cv.__plot && !cv.__labProbed) { cv.__labProbed = true; K.probe(cv); }
    });
  }

  /* ---------- view tabs ---------- */

  function wireViews(root, refit, off, state) {
    const tabs = [].slice.call(root.querySelectorAll('.lab-tabs [role="tab"]'));
    if (!tabs.length) return;
    const views = [].slice.call(root.querySelectorAll('.lab-view'));
    const show = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      views.forEach((v) => v.classList.toggle('is-active', v.dataset.view === tab.dataset.view));
      state.applyViewVisibility();
      if (focus) tab.focus();
      /* A view that was display:none drew its canvases at a fallback width. */
      K.repaint(root);
      probeRevealed(root);
      refit();
    };
    /* The hidden attribute has to agree with what is actually on screen. With tabs
       in use, an inactive view is hidden from everyone. Below the breakpoint the
       tabs are gone and every view is stacked and visible, so the attribute comes
       off — otherwise a screen reader would be told to skip panels a sighted
       reader can see. Re-applied on every fit, so crossing the breakpoint by
       resizing or rotating is the same as loading at that width. */
    state.applyViewVisibility = () => {
      const tabbed = getComputedStyle(root.querySelector('.lab-tabs')).display !== 'none';
      views.forEach((v) => {
        if (!tabbed || v.classList.contains('is-active')) v.removeAttribute('hidden');
        else v.setAttribute('hidden', '');
      });
    };
    state.applyViewVisibility();

    tabs.forEach((tab, i) => {
      off.push(on(tab, 'click', () => show(tab, false)));
      off.push(on(tab, 'keydown', (e) => {
        const last = tabs.length - 1;
        const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        show(tabs[to], true);
      }));
    });
  }

  /* ---------- expanded plots ----------
     Any plot can be expanded from its own header; the bar that appears lists every
     plot in the lab, so a second or third can be added without going back. Expanded
     blocks are MOVED, not copied: the model's own elements keep their listeners and
     ids, and a comment marks each block's place so it returns exactly where it came
     from. Nothing is cloned — one control, one source of scenario state. */
  function wireFocus(root, refit, off, state) {
    const stage = root.querySelector('.lab-stage');
    const units = [].slice.call(root.querySelectorAll('[data-lab-unit]'));
    if (!stage || !units.length) return;

    const bar = document.createElement('div');
    bar.className = 'lab-focusbar';
    bar.hidden = true;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Plots in the expanded view');
    const lead = document.createElement('span');
    lead.className = 'lab-focusbar__lead';
    lead.textContent = 'Showing';
    bar.append(lead);

    const chips = new Map();
    units.forEach((u) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'lab-chip';
      chip.textContent = u.dataset.labName;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => toggle(u));
      chips.set(u, chip);
      bar.append(chip);
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tool-btn lab-focusbar__back';
    back.textContent = 'back to all views';
    bar.append(back);

    const grid = document.createElement('div');
    grid.className = 'lab-focus';
    grid.hidden = true;
    stage.prepend(bar, grid);
    state.added.push(bar, grid);

    const homes = new Map();
    let chosen = [];

    const render = () => {
      const on = chosen.length > 0;
      stage.classList.toggle('is-focus', on);
      bar.hidden = !on;
      grid.hidden = !on;
      units.forEach((u) => {
        const picked = chosen.indexOf(u) >= 0;
        chips.get(u).setAttribute('aria-pressed', String(picked));
        const ex = u.querySelector('[data-lab-expand]');
        if (ex) {
          ex.setAttribute('aria-pressed', String(picked));
          ex.textContent = picked ? 'collapse' : 'expand';
        }
        if (!picked && homes.has(u)) { homes.get(u).replaceWith(u); homes.delete(u); }
      });
      chosen.forEach((u) => {
        if (!homes.has(u)) {
          const mark = document.createComment('lab-home');
          u.before(mark);
          homes.set(u, mark);
        }
        grid.append(u);
      });
      grid.dataset.count = String(chosen.length);
      stage.scrollTop = 0;
      K.repaint(root);
      probeRevealed(root);
      refit();
    };
    state.collapse = () => { if (chosen.length) { chosen = []; render(); } };

    const toggle = (u) => {
      chosen = chosen.indexOf(u) >= 0 ? chosen.filter((x) => x !== u) : chosen.concat(u);
      render();
    };

    units.forEach((u) => {
      const ex = u.querySelector('[data-lab-expand]');
      if (ex) off.push(on(ex, 'click', () => {
        toggle(u);
        (chosen.indexOf(u) >= 0 ? chips.get(u) : ex).focus();
      }));
    });
    off.push(on(back, 'click', () => {
      const last = chosen[chosen.length - 1];
      chosen = [];
      render();
      const ex = last && last.querySelector('[data-lab-expand]');
      if (ex) ex.focus();
    }));
    off.push(on(root, 'keydown', (e) => {
      if (e.key !== 'Escape' || !chosen.length || root.classList.contains('is-full')) return;
      back.click();
    }));
  }

  /* ---------- full screen ----------
     The browser's own full-screen mode, asked for from a click; where it is refused
     — some embedded browsers do — the frame covers the window instead. Escape leaves
     either, and leaving restores the page scroll and the focus that opened it. */
  function wireFullScreen(root, refit, off, state) {
    const btn = root.querySelector('[data-lab-full]');
    if (!btn) return;
    let scrollY = 0, returnTo = null;

    const set = (full) => {
      if (full === root.classList.contains('is-full')) return;
      if (full) { scrollY = window.scrollY; returnTo = document.activeElement; }
      root.classList.toggle('is-full', full);
      document.documentElement.classList.toggle('lab-lock', full);
      btn.setAttribute('aria-pressed', String(full));
      btn.textContent = full ? 'exit full screen' : 'full screen';
      refit();
      if (!full) {
        window.scrollTo(0, scrollY);
        const to = returnTo && document.contains(returnTo) ? returnTo : btn;
        to.focus();
      }
    };
    state.unfull = () => {
      if (document.fullscreenElement === root && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      set(false);
    };

    off.push(on(btn, 'click', () => {
      if (root.classList.contains('is-full')) { state.unfull(); return; }
      if (root.requestFullscreen && document.fullscreenEnabled) {
        // Denied is not a failure: the covering frame is the tested fallback.
        root.requestFullscreen().then(() => set(true), () => set(true));
      } else set(true);
    }));
    /* Leaving native full screen — by Escape, by the browser's own control, or by
       exitFullscreen — takes the frame out with it, so one Escape is always enough. */
    off.push(on(document, 'fullscreenchange', () => {
      if (!document.fullscreenElement && root.classList.contains('is-full')) set(false);
    }));
    off.push(on(document, 'keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('is-full') && !document.fullscreenElement) set(false);
    }));
  }

  /* ---------- the rail help line ----------
     A slider's note is shown once, in the rail's help line, instead of under every
     control where the stack of notes would push the controls off the screen. The
     note element itself stays in the control and stays bound to its input by
     aria-describedby, so what a screen reader announces does not depend on hovering.
     A lab may offer one help line for both rails, marked data-lab-help. */
  function wireHelp(root, off, state) {
    const shared = root.querySelector('[data-lab-help]');
    /* A short laptop screen has no height to spare for the help line, so the
       stylesheet hides it there. The same words then float beside the control
       being pointed at, over the rail rather than in it, so they take no room.
       Never on a phone: there every note is printed under its own control. */
    const tip = document.createElement('p');
    tip.className = 'lab-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    root.append(tip);
    state.added.push(tip);
    const wide = window.matchMedia('(min-width: 75rem)');
    const hideTip = () => { tip.hidden = true; };
    root.querySelectorAll('.lab-rail').forEach((rail) => {
      const help = rail.querySelector('.lab-help') || shared;
      if (!help) return;
      let current = null;
      const show = (ctl) => {
        if (!ctl) { hideTip(); return; }
        if (ctl !== current) {
          current = ctl;
          const input = ctl.querySelector('input[id], select[id]');
          const label = input && root.querySelector('label[for="' + CSS.escape(input.id) + '"]');
          const note = ctl.querySelector('.ctl__note');
          const name = document.createElement('b');
          name.textContent = label ? label.textContent.trim() : '';
          help.replaceChildren(name, document.createTextNode(note ? ' ' + note.textContent.trim() : ''));
        }
        if (!wide.matches || getComputedStyle(help).display !== 'none') { hideTip(); return; }
        tip.replaceChildren(...[].map.call(help.childNodes, (n) => n.cloneNode(true)));
        tip.hidden = false;
        // under the control, or above it where the window ends first
        const c = box(ctl), r = box(rail);
        tip.style.left = Math.round(r.left + 6) + 'px';
        tip.style.width = Math.round(r.width - 12) + 'px';
        const h = tip.offsetHeight;
        const top = c.bottom + 4 + h <= window.innerHeight - 4 ? c.bottom + 4 : Math.max(4, c.top - h - 4);
        tip.style.top = Math.round(top) + 'px';
      };
      // focus as well as pointer: the keyboard reaches every control the mouse does
      off.push(on(rail, 'focusin', (e) => show(e.target.closest('.ctl'))));
      off.push(on(rail, 'pointerover', (e) => show(e.target.closest('.ctl'))));
      off.push(on(rail, 'pointerleave', hideTip));
      off.push(on(rail, 'focusout', (e) => { if (!rail.contains(e.relatedTarget)) hideTip(); }));
      off.push(on(rail, 'scroll', hideTip, { passive: true }));
    });
    off.push(on(window, 'scroll', hideTip, { passive: true }));
  }

  /* A scenario note in a rail shows in full wherever the rail has the room. Only
     when the whole note would make the rail scroll is it cut, to as many lines as
     still fit and never fewer than the stylesheet's clamp, with a toggle to open it.
     The module rewrites the note on every preset and the rail's room changes with
     the window and with groups opened in it, so the fit is redone on each. The cut
     text stays whole for a screen reader. */
  function wireNote(root, off, state) {
    // a phone may already have moved the scenarios under the chart (viz-loader.js)
    const note = root.querySelector('.lab-rail [data-out="note"], .lab-primary [data-out="note"]');
    const boxEl = note && note.parentElement;
    if (!boxEl || !root.querySelector('.lab-rail')) return;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'lab-more';
    boxEl.append(more);
    state.added.push(more);
    let rail = null;
    const fits = () => !rail || rail.scrollHeight <= rail.clientHeight + 1;
    const sync = () => {
      if (state.dead) return;
      rail = note.closest('.lab-rail');
      const open = boxEl.classList.contains('is-open');
      note.style.removeProperty('display');
      note.style.removeProperty('-webkit-line-clamp');
      const floor = parseInt(getComputedStyle(note).webkitLineClamp, 10) || 3;
      more.textContent = open ? 'less' : 'more';
      more.setAttribute('aria-expanded', String(open));
      // the whole note first: if the rail holds it, there is nothing to open
      more.hidden = true;
      note.style.display = 'block';
      if (fits()) return;
      more.hidden = false;
      if (open) return;
      const line = parseFloat(getComputedStyle(note).lineHeight) || 16;
      const lines = Math.round(note.scrollHeight / line);
      note.style.removeProperty('display');
      let n = lines - 1;
      for (; n > floor; n--) {
        note.style.setProperty('-webkit-line-clamp', String(n));
        if (fits()) break;
      }
      note.style.setProperty('-webkit-line-clamp', String(Math.max(n, floor)));
      more.hidden = note.scrollHeight <= note.clientHeight + 1;
    };
    let timer = 0;
    const later = () => { clearTimeout(timer); timer = setTimeout(sync, 0); };
    off.push(() => clearTimeout(timer));
    off.push(on(more, 'click', () => { boxEl.classList.toggle('is-open'); sync(); }));
    // a group opened or closed in the rail changes the room left for the note
    off.push(on(root, 'toggle', later, true));
    const mo = new MutationObserver(later);
    mo.observe(note, { childList: true, characterData: true, subtree: true });
    state.observers.push(mo);
    // a rail's own box is set by the frame, so this sees the window and full
    // screen, not the note's own changes
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(later);
      root.querySelectorAll('.lab-rail').forEach((r) => ro.observe(r));
      state.observers.push(ro);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    later();
  }

  /* ---------- the eye's held scale ----------
     Lab B holds the eye and histogram at one vertical scale so a closing eye
     visibly closes. The module records the scale on the canvas; this shows it in
     the eye's header with a button to refit. Where the module does not record one,
     nothing is added. */
  function wireEyeScale(root, off, state) {
    const eye = root.querySelector('canvas[data-cv="eye"]');
    const unit = eye && eye.closest('[data-lab-unit]');
    const head = unit && unit.querySelector('.lab-panel-head');
    if (!head) return;

    const label = document.createElement('span');
    label.className = 'lab-scale';
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'tool-btn';
    fitBtn.textContent = 'fit';
    fitBtn.title = 'Rescale the eye and histogram to the current received signal';
    const expand = head.querySelector('[data-lab-expand]');
    head.insertBefore(label, expand);
    head.insertBefore(fitBtn, expand);
    state.added.push(label, fitBtn);

    const show = () => {
      const limit = parseFloat(eye.dataset.eyeLimit);
      label.hidden = fitBtn.hidden = !isFinite(limit);
      if (isFinite(limit)) {
        label.textContent = '±' + Math.round(limit * 1000) + ' mV';
        label.title = 'Eye and histogram scale. It is held while you change settings and grows only if the signal would be cut off.';
      }
    };
    const mo = new MutationObserver(show);
    mo.observe(eye, { attributes: true, attributeFilter: ['data-eye-limit'] });
    state.observers.push(mo);
    show();

    const ask = (how) => root.dispatchEvent(new CustomEvent('sipi:eye-scale', { detail: how }));
    off.push(on(fitBtn, 'click', () => ask('fit')));
    /* A protocol example is a different signal level, so choosing one refits; the
       comparison presets return to the shared starting scale so they stay directly
       comparable. */
    off.push(on(root, 'click', (e) => {
      const preset = e.target.closest('.preset[data-preset]');
      if (!preset) return;
      let group = preset.previousElementSibling;
      while (group && !group.classList.contains('presets__group')) group = group.previousElementSibling;
      ask(group && /protocol/i.test(group.textContent) ? 'fit' : 'start');
    }));
  }

  /* ---------- mount ---------- */

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    return () => target.removeEventListener(type, fn, opts);
  }

  function mount(root) {
    if (root.__labWorkspace) return root.__labWorkspace;
    const state = { dead: false, second: 0, added: [], observers: [], collapse: null, unfull: null,
                    applyViewVisibility: null };
    const off = [];
    const refit = refitter(root, state);

    markProbed(root);
    wireEyeScale(root, off, state);
    wireViews(root, refit, off, state);
    wireFocus(root, refit, off, state);
    wireFullScreen(root, refit, off, state);
    wireHelp(root, off, state);
    wireNote(root, off, state);

    /* Resizes are coalesced and the observer watches the stage, not the canvases:
       a canvas whose height this file just changed would otherwise report a resize
       and ask for another fit, which is the feedback loop that makes a layout
       oscillate. Only plots in view are measured, and the fit is a no-op when
       nothing moved. */
    let timer = 0;
    const later = () => { clearTimeout(timer); timer = setTimeout(refit, 140); };
    off.push(on(window, 'resize', later));
    const stage = root.querySelector('.lab-stage');
    if (stage && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(later);
      ro.observe(stage);
      state.observers.push(ro);
    }
    /* Guided mode inserts its step card above the plots, which changes the room. */
    off.push(on(root, 'click', (e) => {
      if (e.target.closest('.mode, .mode-stage button, .preset')) later();
    }));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!state.dead) later(); });
    refit();

    const dispose = () => {
      if (state.dead) return;
      state.dead = true;
      clearTimeout(timer);
      clearTimeout(state.second);
      if (state.unfull) state.unfull();
      if (state.collapse) state.collapse();
      document.documentElement.classList.remove('lab-lock');
      off.forEach((fn) => fn());
      state.observers.forEach((o) => o.disconnect());
      state.added.forEach((el) => el.remove());
      release(root);
      delete root.__labWorkspace;
    };
    root.__labWorkspace = { dispose, refit };
    return root.__labWorkspace;
  }

  NS.labWorkspace = { mount, MIN_PLOT_PX };
})();
