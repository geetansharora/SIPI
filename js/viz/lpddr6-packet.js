/* SIPI — viz/lpddr6-packet.js
 * The 288-bit packet. One LPDDR6 sub-channel burst, 12 DQ x BL24, drawn as what it
 * carries rather than where each bit travels: 256 data bits in sixteen 16-bit
 * groups, 16 metadata bits, and 16 bits that are DBI flags or link-protection
 * check bits. LVSTL terminates to ground, so every 1 sent draws termination
 * current; the panel counts them and prices them.
 *   packet   the burst, with inverted groups marked; select a data bit to flip it
 *   cost     ones sent and termination energy with DBI, with link protection, and
 *            with neither, for the same data
 * Maths: js/models/lpddr6-model.js. Requires viz-kit.js and lpddr6-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const NOTES = {
    random: 'Random data: about half the bits are 1, so DBI rarely finds a group worth inverting and saves little. Random data is also what scrambled or compressed traffic looks like.',
    mostlyOnes: 'Data that is mostly 1s. Every 1 draws termination current, and DBI inverts nearly every group, cutting the ones sent by more than half. This is the case DBI exists for.',
    ones: 'All ones. With DBI every group is inverted and sent as zeros; the only 1s left are the sixteen flags and the metadata. With link protection instead, all 256 go out as 1s.',
    zeros: 'All zeros: almost free on an LVSTL bus. Only the metadata and, with link protection, the check bits draw any current.',
    text: 'Thirty-two bytes of ASCII text. Letters have a 0 in their top bit and a 1 in the next, so the groups sit close to half ones and DBI helps a little.',
    ramp: 'A ramp: group 1 has one 1, group 16 has sixteen. DBI inverts exactly the groups with more than eight, and the cost stops climbing halfway down.'
  };

  NS.viz.lpddr6Packet = function (root) {
    const M = (NS.models || {}).lpddr6;
    if (!M) throw new Error('js/models/lpddr6-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cvP = $('[data-cv="packet"]'), cvC = $('[data-cv="cost"]');
    const st = { pattern: 'mostlyOnes', mode: 'dbi', rate: 10667 };
    let data = M.patterns[st.pattern](), meta = Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    let cells = [];
    const out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };

    function drawPacket(T) {
      /* the grid sets the height: 16 rows, a gap and the metadata row */
      const wCss = cvP.clientWidth || 600, narrow = wCss < 480;
      const cellW = Math.floor((wCss - (narrow ? 80 : 150)) / 18);
      const s = K.canvas(cvP, Math.round(26 + 17 * Math.max(10, Math.min(22, cellW)) + 30)), ctx = s.ctx;
      const r = M.packet(data, meta, st.mode, st.rate);
      const cols = 16, gap = 10, flagW = 1;
      const cell = Math.max(10, Math.min(22, cellW, Math.floor((s.h - 64) / 17.6)));
      /* centre the whole block, row labels to readout, in the canvas; the readout
         beside the grid is dropped where there is no room for it */
      const textW = 170, withText = 60 + cols * cell + gap + cell + 18 + textW <= s.w - 10;
      const blockW = 60 + cols * cell + gap + cell + (withText ? 18 + textW : 0);
      const blockH = 26 + 17 * cell + 8;
      const x0 = Math.max(60, Math.round((s.w - blockW) / 2) + 60), y0 = Math.max(26, Math.round((s.h - blockH) / 2) + 26);
      const fx = x0 + cols * cell + gap;
      cells = [];
      K.text(ctx, 'data, 16 groups of 16 bits', x0, y0 - 14, T.muted, 10, 'left');
      K.text(ctx, st.mode === 'dbi' ? 'DBI' : st.mode === 'link' ? 'check' : '', fx + cell / 2, y0 - 14, T.muted, 10, 'center');
      r.groups.forEach((g, gi) => {
        const y = y0 + gi * cell;
        if (g.inv) { ctx.fillStyle = K.rgba(T.reflect, 0.16); ctx.fillRect(x0 - 4, y, cols * cell + 8, cell); }
        K.text(ctx, 'group ' + (gi + 1), x0 - 8, y + cell / 2, g.inv ? T.reflect : T.muted, 9, 'right');
        g.sent.forEach((b, bi) => {
          const x = x0 + bi * cell;
          ctx.fillStyle = b ? T.signal : T.surface; ctx.strokeStyle = T.border; ctx.lineWidth = 1;
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2); ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
          cells.push({ x, y, w: cell, h: cell, i: gi * 16 + bi });
        });
        const fy = y + 1;
        if (st.mode === 'dbi') {
          ctx.fillStyle = r.flags[gi] ? T.reflect : T.surface; ctx.strokeStyle = T.reflect;
          ctx.fillRect(fx + 1, fy, cell - 2, cell - 2); ctx.strokeRect(fx + 1.5, fy + 0.5, cell - 3, cell - 3);
        } else if (st.mode === 'link') {
          ctx.strokeStyle = T.muted; ctx.setLineDash([2, 2]); ctx.strokeRect(fx + 1.5, fy + 0.5, cell - 3, cell - 3); ctx.setLineDash([]);
          K.text(ctx, '?', fx + cell / 2, fy + cell / 2 - 1, T.muted, 9, 'center');
        }
      });
      const my = y0 + 16 * cell + 8;
      K.text(ctx, 'metadata', x0 - 8, my + cell / 2, T.muted, 9, 'right');
      meta.forEach((b, i) => {
        const x = x0 + i * cell;
        ctx.fillStyle = b ? T.ink2 : T.surface; ctx.strokeStyle = T.border;
        ctx.fillRect(x + 1, my + 1, cell - 2, cell - 2); ctx.strokeRect(x + 1.5, my + 1.5, cell - 3, cell - 3);
      });
      const tx = fx + cell + 18;
      if (withText) {
        const lines = [
          [r.ones + ' ones sent', T.ink],
          ['of ' + r.bits + ' bits', T.muted],
          ['', T.muted],
          [r.energy.toFixed(1) + ' pJ', T.ink],
          ['termination energy', T.muted],
          ['this burst', T.muted],
          ['', T.muted],
          [st.mode === 'dbi' ? r.flags.reduce((a, b) => a + b, 0) + ' groups inverted' : st.mode === 'link' ? 'check bits counted' : 'no DBI, no check', T.ink2],
          [st.mode === 'link' ? 'at their average' : '', T.muted]
        ];
        lines.forEach(([t, c], i) => K.text(ctx, t, tx, y0 + 6 + i * 16, c, 11, 'left'));
      }
      return r;
    }

    function drawCost(T) {
      const s = K.canvas(cvC, 150), ctx = s.ctx;
      const modes = [['none', 'neither'], ['dbi', 'DBI'], ['link', 'link protection']];
      const res = modes.map(([m]) => M.packet(data, meta, m, st.rate));
      const max = Math.max.apply(null, res.map((r) => r.energy)) || 1;
      const lab = 120, bw = s.w - lab - 120;
      modes.forEach(([m, name], i) => {
        const y = 14 + i * 42, r = res[i];
        K.text(ctx, name, lab - 10, y + 10, m === st.mode ? T.ink : T.muted, 11, 'right');
        ctx.fillStyle = m === st.mode ? T.signal : K.rgba(T.signal, 0.35);
        ctx.fillRect(lab, y, Math.max(2, bw * r.energy / max), 20);
        K.text(ctx, r.ones + ' ones · ' + r.energy.toFixed(1) + ' pJ', lab + Math.max(2, bw * r.energy / max) + 8, y + 10, T.ink2, 10, 'left');
      });
      return res;
    }

    function syncControls() {
      root.querySelectorAll('[data-pattern]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pattern === st.pattern)));
      root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
      root.querySelectorAll('[data-prate]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.prate === st.rate)));
    }

    const m = K.mount({
      root, params: st, height: 0,
      draw(T) {
        const r = drawPacket(T), res = drawCost(T);
        const none = res[0];
        out('ones', r.ones + ' of ' + r.bits);
        out('energy', r.energy.toFixed(1) + ' pJ');
        out('perbit', (r.energy / 256 * 1000).toFixed(0) + ' fJ per data bit');
        out('save', st.mode === 'dbi' ? (none.energy > 0 ? Math.round(100 * (1 - r.energy / none.energy)) + '% less than without' : '—') : st.mode === 'link' ? 'DBI given up' : '—');
        syncControls();
      }
    });

    root.querySelectorAll('[data-pattern]').forEach((b) => b.addEventListener('click', () => {
      st.pattern = b.dataset.pattern; data = M.patterns[st.pattern]();
      $('[data-out="pknote"]').textContent = NOTES[st.pattern]; m.render();
    }));
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; m.render(); }));
    root.querySelectorAll('[data-prate]').forEach((b) => b.addEventListener('click', () => { st.rate = +b.dataset.prate; m.render(); }));
    /* flipping a bit flips what the host wanted to send, not what went on the wire */
    const flip = (i) => { data = data.slice(); data[i] = 1 - data[i]; $('[data-out="pknote"]').textContent = 'Your own data: bit ' + (i + 1) + ' flipped. Watch its group cross eight ones and invert.'; m.render(); };
    cvP.addEventListener('click', (e) => {
      const rc = cvP.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
      const hit = cells.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
      if (hit) flip(hit.i);
    });
    $('[data-out="pknote"]').textContent = NOTES[st.pattern];
    const off = K.onRepaint(root, () => m.render());
    m.render();
    return { start() {}, stop() {}, destroy() { off(); m.teardown(); } };
  };
})();
