/* Touchstone inspector — what a file says, and what this reader will not do with it.
 *
 * M7-5, the half of it that is completable now. M5-10 hardened the parser:
 * negative frequencies refused, converted values checked for overflow, and an
 * explicit declaration of the six things it does not support. None of that was
 * reachable by a reader, because the parser had no UI at all.
 *
 * This is deliberately an INSPECTOR and not an importer. It tells you what the
 * file contains and whether this reader can trust it. Feeding it into the
 * channel model needs renormalisation to the model's reference impedance,
 * interpolation onto the model's frequency grid, and a DC extrapolation — three
 * separate pieces of numerical work, each with its own error budget, and none
 * of them is here. Offering a "load into the lab" button without them would be
 * the kind of thing this whole review was about.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const REPORT_VERSION = '2.0';   // N1-3 rewrote the passivity test; N4-9 added provenance
  const K = NS.kit;

  NS.viz.touchstone = function (root) {
    const $ = (s) => root.querySelector(s);
    const out = $('[data-out="ts-report"]');
    const input = $('#ts-file');
    const drop = $('[data-ts-drop]');
    if (!out) return { start() {}, stop() {}, destroy() {} };

    const esc = (t) => String(t).replace(/[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function report(name, text, file, gen) {
      const r = K.parseTouchstone(text);
      if (!r.ok) {
        out.innerHTML = '<p class="ts-bad"><b>' + esc(name) + ' was refused.</b> '
          + esc(r.error) + '</p>'
          + '<p class="ts-note">A refusal is the useful answer here. A reader that '
          + 'guessed at this file would produce numbers, and they would be wrong in a '
          + 'way nothing downstream could detect.</p>';
        return;
      }
      const f0 = r.f[0], fn = r.f[r.f.length - 1];
      let worstIl = 0, worstS11 = -Infinity, worstS11Lin = 0;
      r.S.forEach((e) => {
        const il = -20 * Math.log10(Math.max(Math.hypot(e.s21.re, e.s21.im), 1e-12));
        worstS11Lin = Math.max(worstS11Lin, Math.hypot(e.s11.re, e.s11.im));
        /* 20*log10|S11| is the REFLECTION in dB and is negative for a passive
           port. Return loss is its negation and is positive. Calling the first
           one "return loss" produced "worst return loss -240 dB", which reads as
           excellent when it means the opposite. Report the reflection, and label
           it as the reflection. */
        const s11db = 20 * Math.log10(Math.max(Math.hypot(e.s11.re, e.s11.im), 1e-12));
        if (il > worstIl) worstIl = il;
        if (s11db > worstS11) worstS11 = s11db;
      });

      /* Passivity by sigma_max(S) over the FULL complex matrix — see
         K.sigmaMax2x2. The old |S11 +/- S21| shortcut is sigma_max only for a
         reciprocal, port-symmetric matrix, and this parser accepts general
         two-ports: it called a unitary network active (1.414 against 1) and an
         active one passive (0.5 against 2.118). Both are now fixtures. */
      let sigMax = 0, elemMax = 0, reciprocity = 0, sigAt = null;
      r.S.forEach((e, i) => {
        const sm = K.sigmaMax2x2(e.s11, e.s12, e.s21, e.s22);
        if (sm > sigMax) { sigMax = sm; sigAt = r.f[i]; }
        /* All four entries. The old version compared only S11 and S21, so it
           could report a maximum element of 0.5 on a matrix containing 2 —
           contradicting the parser's own warning on the same screen. */
        [e.s11, e.s12, e.s21, e.s22].forEach((z) => {
          elemMax = Math.max(elemMax, Math.hypot(z.re, z.im));
        });
        reciprocity = Math.max(reciprocity,
          Math.hypot(e.s21.re - e.s12.re, e.s21.im - e.s12.im));
      });

      /* The key may carry markup — subscripts on sigma_max and S_ij — so it is
         NOT escaped. Every key here is a literal in this file; none comes from
         the file being inspected. The VALUES that come from the file go through
         esc() at the point they are built. */
      const row = (k, v, bad) =>
        '<div class="ts-row"><dt>' + k + '</dt><dd'
        + (bad ? ' class="ts-bad"' : '') + '>' + v + '</dd></div>';

      out.innerHTML =
        '<p class="ts-ok"><b>' + esc(name) + ' parsed.</b> '
        + r.points + ' points, ' + esc(r.format.toUpperCase()) + ' format, '
        + r.z0 + ' Ω reference.</p>'
        + '<dl class="ts-report">'
        + row('band', K.fmt.hz(f0) + ' to ' + K.fmt.hz(fn))
        + row('port order', esc(r.portOrder))
        + row('worst insertion loss', worstIl.toFixed(2) + ' dB')
        /* The 1e-12 floor inside the log is a GUARD, not a measurement, and
           printing it gave "-240.00 dB" for a port that simply does not reflect.
           A number nobody computed should not be shown as one. */
        + row('worst reflection, 20·log₁₀|S₁₁|',
              worstS11Lin === 0
                ? 'none — S₁₁ is exactly zero at every sampled frequency'
                : worstS11.toFixed(2) + ' dB — return loss ' + (-worstS11).toFixed(2) + ' dB')
        + row('passivity, σ<sub>max</sub>(S)', sigMax.toFixed(4)
              + (sigMax > 1.001
                  ? ' — this file gains energy at ' + K.fmt.hz(sigAt)
                  : ' — passive at the ' + r.points + ' sampled frequencies, to 1e-3'),
              sigMax > 1.001)
        + row('max |S<sub>ij</sub>| over all four entries', elemMax.toFixed(4)
              + (sigMax > elemMax ? ' — σ<sub>max</sub> is the stricter test, as it should be'
                                  : ' — a single entry can exceed σ<sub>max</sub>; passivity is the matrix norm'))
        + row('reciprocity, max |S₂₁ − S₁₂|', reciprocity.toExponential(2)
              + (reciprocity > 0.01 ? ' — not reciprocal' : ''))
        + row('lowest frequency', K.fmt.hz(f0)
              + (f0 === 0 ? ' — this is DC'
                          : ' — not DC. Only zero is DC, so a time-domain transform '
                          + 'would have to extrapolate one'), f0 !== 0)
        + '</dl>'
        + (r.warnings.length
            ? '<ul class="ts-warn">' + r.warnings.map((w) => '<li>' + esc(w) + '</li>').join('')
              + '</ul>' : '')
        + '<p class="ts-note"><b>What this reader will not do with it.</b> It does not '
        + 'renormalise to another reference impedance, interpolate onto another '
        + 'frequency grid, or extrapolate a DC point — so it cannot be fed to the '
        + 'channel lab, and there is deliberately no button offering to. Unsupported: '
        + esc(r.accepts.notSupported.join('; ')) + '.</p>'
        /* N4-9. Provenance, so a report can be traced back to what produced it.
           A scenario URL cannot carry a local file, so it names one instead. */
        + '<dl class="ts-report">'
        + row('source file', esc(name)
              + (file ? ' &middot; ' + (file.size / 1024).toFixed(1) + ' kB' : ''))
        + row('content hash', 'fnv1a ' + hashOf(text)
              + ' &mdash; identity only, not a checksum')
        + row('parser', 'K.parseTouchstone v' + (K.TOUCHSTONE_VERSION || '?')
              + ' &middot; report v' + REPORT_VERSION)
        + row('reproducing this', 'a scenario link cannot carry a local file. To see '
              + 'this report again, open this panel and select ' + esc(name)
              + ' (hash above).')
        + '</dl>'
        + '<p class="ts-note"><b>What passivity here does and does not establish.</b> '
        + 'σ<sub>max</sub>(S) ≤ 1 is checked at the frequencies the file contains and '
        + 'nowhere else. It says nothing about the gaps between samples, nothing about '
        + 'causality, nothing about measurement quality, and nothing about whether the '
        + 'data is fit for a transient transform.</p>';
    }

    /* N4-9 / R10. Three things a file import owes, none of which this had.

       A SIZE LIMIT that refuses rather than freezing. A .s2p is text and a large
       one is a mistake or an attack; reading 200 MB into a string stalls the tab
       with no way back.

       A GENERATION COUNTER, because FileReader is asynchronous and a reader who
       picks three files quickly gets three onload callbacks in whatever order
       they finish. Without this the panel can settle on an earlier file's report
       — the same stale-async defect the M7-1 sweep had, in a different place.

       PROVENANCE, so a report can be traced back to what produced it: a hash of
       the bytes, the file's own name and size, and the parser's version. A
       scenario URL cannot carry a local file, so it has to name one. */
    const MAX_BYTES = 8 * 1024 * 1024;
    let fileGen = 0;

    /* FNV-1a over the text. Not cryptographic and not claimed to be — it is an
       identity check against "is this the same file I looked at before", which
       is what a provenance line needs. */
    function hashOf(text) {
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    }

    function take(file) {
      if (!file) return;
      const gen = ++fileGen;
      if (file.size > MAX_BYTES) {
        out.innerHTML = '<p class="ts-bad"><b>' + esc(file.name) + '</b> is '
          + (file.size / 1048576).toFixed(1) + ' MB. This reader refuses anything '
          + 'over ' + (MAX_BYTES / 1048576) + ' MB — a Touchstone file that large is '
          + 'a mistake, and reading it would stall the page with no way back.</p>';
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        /* A later pick has already started, so this result is stale. Dropping it
           is the whole point: applying it would show one file's report under
           another file's name. */
        if (gen !== fileGen) return;
        report(file.name, String(fr.result), file, gen);
      };
      fr.onerror = () => {
        if (gen !== fileGen) return;
        out.innerHTML = '<p class="ts-bad">Could not read that file.</p>';
      };
      fr.readAsText(file);
    }

    if (input) input.addEventListener('change', (e) => take(e.target.files[0]));
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.add('is-over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.remove('is-over');
      }));
      drop.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) take(e.dataTransfer.files[0]);
      });
    }

    /* A worked example, so the panel says something before anybody has a file.
       Generated from the site's own causal line model, so what it shows is a
       channel this site can also compute from first principles. */
    const demo = $('[data-act="ts-demo"]');
    if (demo) demo.addEventListener('click', () => {
      const sec = { type: 'line', z: 50, td: 1360e-12, lossDb: 14,
                    dielFrac: 0.55, lossRefHz: 8e9 };
      const lines = ['! generated by this page from its own line model',
                     '! 8 inches of stripline, 14 dB at 8 GHz', '# GHz S RI R 50'];
      for (let k = 1; k <= 60; k++) {
        const f = k * 0.5e9;
        const S = K.cascadeS([sec], f, 50, 8e9);
        lines.push([(f / 1e9).toFixed(4), S.s11r, S.s11i, S.s21r, S.s21i,
                    S.s12r, S.s12i, S.s11r, S.s11i]
          .map((v) => typeof v === 'number' ? v.toPrecision(8) : v).join(' '));
      }
      report('a generated 8-inch channel.s2p', lines.join('\n'));
    });

    return { start() {}, stop() {}, destroy() {} };
  };
})();
