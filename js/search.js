/* SI & PI — search.js
 * Client-side search over topics.json. Progressive enhancement: the markup is
 * injected into the masthead, so the 53 static pages carry no search markup of
 * their own and nothing drifts. If topics.json can't be fetched (file://, or the
 * Artifact preview, which blocks fetch entirely) the UI is never inserted.
 *
 * Site root is derived from this script's own src, so the same file works from
 * / and from /topics/<section>/ with no per-page configuration. */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const me = document.currentScript && document.currentScript.src;
  if (!me) return;
  const ROOT = me.replace(/js\/search\.js(?:[?#].*)?$/, '');

  let index = null;   // flat [{ title, section, status, num, href, kw, hay, words }]
  let dlg = null, input = null, list = null, rows = [], cursor = -1;

  /* ---------- index ---------- */
  function build(data) {
    const out = [];
    data.sections.forEach((s) => {
      s.topics.forEach((t, i) => {
        const hay = (t.title + ' ' + s.title + ' ' + t.slug + ' ' + (t.keywords || []).join(' ')).toLowerCase();
        out.push({
          title: t.title,
          section: s.title,
          status: t.status,
          num: String(i + 1).padStart(2, '0'),
          href: ROOT + 'topics/' + s.id + '/' + t.slug + '.html',
          kw: (t.keywords || []).map((k) => k.toLowerCase()),
          hay: hay,
          words: hay.split(/[^a-z0-9.]+/).filter(Boolean)
        });
      });
    });
    return out;
  }

  /* Score: every query token must appear. Earlier matches and title-start
     matches rank higher, so typing "pdn" puts "What the PDN actually is" above
     "PDN-induced jitter" only when the former matches nearer the front. */
  function score(item, tokens) {
    let total = 0;
    for (const tk of tokens) {
      // SI/PI is full of 2-3 letter acronyms (RJ, TJ, EQ, EM, UI, Zt, SSO) and every
      // one of them is a substring of some ordinary word — "sso" hides inside
      // "aggressor". Short tokens must therefore match a whole word.
      let at;
      if (tk.length <= 3) {
        at = item.words.some((w) => w === tk || w.replace(/\./g, '') === tk) ? item.hay.indexOf(tk) : -1;
      } else {
        at = item.hay.indexOf(tk);
      }
      if (at < 0) return Infinity;              // sentinel must sit outside the score range
      total += at === 0 ? 0 : at < 24 ? 4 : 12;
      if (item.title.toLowerCase().startsWith(tk)) total -= 6;
      if (item.kw.indexOf(tk) >= 0) total -= 3; // an exact jargon hit beats an incidental substring
    }
    return total;
  }

  function searchIndex(items, q) {
    const query = q.toLowerCase().trim().replace(/\s+/g, ' ');
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return items.slice(0, 8);
    const equivalents = [
      ['return loss', 's11'],
      ['anti-resonance', 'pdn peak'],
      ['reference plane', 'de-embedding']
    ].find((group) => group.includes(query));
    return items
      .map((it) => ({
        it,
        s: score(it, tokens) - (it.kw.includes(query) ? 8 : 0)
          - (equivalents ? 12 * equivalents.filter((term) => it.kw.includes(term)).length : 0)
      }))
      .filter((r) => Number.isFinite(r.s))
      .sort((a, b) => a.s - b.s)
      .slice(0, 12)
      .map((r) => r.it);
  }

  function search(q) { return searchIndex(index, q); }

  // Pure surface used by the model gate; the UI remains progressively enhanced.
  NS.searchModel = { build, score, search: searchIndex };

  /* ---------- render ---------- */
  function mark(text, q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return esc(text);
    const re = new RegExp('(' + tokens.map(escRe).join('|') + ')', 'ig');
    return esc(text).replace(re, '<mark>$1</mark>');
  }
  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function paint(q) {
    rows = search(q);
    cursor = rows.length ? 0 : -1;
    list.innerHTML = rows.length
      ? rows.map((it, i) => `
          <li>
            <a class="sr__row${i === 0 ? ' is-cur' : ''}" href="${it.href}" role="option" aria-selected="${i === 0}">
              <span class="sr__sec">${esc(it.section)}</span>
              <span class="sr__ttl">${mark(it.title, q)}</span>
              <span class="sr__st sr__st--${it.status}">${it.status === 'live' ? 'full' : it.status === 'brief' ? 'brief' : 'soon'}</span>
            </a>
          </li>`).join('')
      : '<li class="sr__none">Nothing matches — try “eye”, “decap”, “PCIe”, “jitter”.</li>';
  }

  function move(d) {
    if (!rows.length) return;
    cursor = (cursor + d + rows.length) % rows.length;
    list.querySelectorAll('.sr__row').forEach((a, i) => {
      const on = i === cursor;
      a.classList.toggle('is-cur', on);
      a.setAttribute('aria-selected', String(on));
      if (on) a.scrollIntoView({ block: 'nearest' });
    });
  }

  function go() {
    if (cursor < 0) return;
    location.href = rows[cursor].href;
  }

  /* ---------- mount ---------- */
  function mount(data) {
    index = build(data);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-open';
    btn.innerHTML = '<span aria-hidden="true">⌕</span> Search <kbd>/</kbd>';
    btn.setAttribute('aria-label', 'Search topics. Shortcut: forward slash.');

    dlg = document.createElement('dialog');
    dlg.className = 'searchbox';
    dlg.innerHTML = `
      <form method="dialog" class="sb__form">
        <label class="sb__field">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search 50+ topics — reflections, decap, PAM4…"
                 autocomplete="off" spellcheck="false" role="combobox"
                 aria-expanded="true" aria-controls="sr-list" aria-label="Search topics">
        </label>
        <button class="sb__close" type="submit" aria-label="Close search">esc</button>
      </form>
      <ul class="sr" id="sr-list" role="listbox" aria-label="Search results"></ul>`;
    document.body.appendChild(dlg);
    input = dlg.querySelector('input');
    list = dlg.querySelector('.sr');

    const open = () => {
      if (dlg.open) return;
      paint('');
      dlg.showModal();
      input.value = '';
      input.focus();
    };

    btn.addEventListener('click', open);
    input.addEventListener('input', () => paint(input.value));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
    list.addEventListener('mousemove', (e) => {
      const a = e.target.closest('.sr__row');
      if (!a) return;
      const i = [].indexOf.call(list.querySelectorAll('.sr__row'), a);
      if (i >= 0 && i !== cursor) { cursor = i; move(0); }
    });
    // click on the backdrop closes
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing && !dlg.open) { e.preventDefault(); open(); }
    });

    const nav = document.querySelector('.masthead nav');
    const toggle = nav && nav.querySelector('[data-act="theme"]');
    if (nav) nav.insertBefore(btn, toggle || null);
  }

  fetch(ROOT + 'topics.json')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(mount)
    .catch(() => { /* file:// or a CSP that blocks fetch — no search, no error */ });
})();
