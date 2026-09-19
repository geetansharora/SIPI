/* SIPI — site.js
 * Theme toggle and the share row. Three states cycle: light → dark → system → light.
 * Light is the default and the first state, because the site's default is light:
 * a reader who has never touched this sees Light and the cycle starts from what
 * they are looking at.
 *
 * The theme itself is NOT applied here. It is applied by a blocking inline script
 * in <head> (scaffold.py, stamp_theme_boot) so the first paint is already correct;
 * doing it here meant the page painted in one palette and swapped to the other,
 * which on a phone moving between pages reads as the site flashing. This file only
 * keeps the button label in step and re-broadcasts the change.
 *
 * Visualisations listen for the 'sipi:theme' event to re-read their tokens. */
(function () {
  const KEY = 'sipi-theme';
  const root = document.documentElement;

  /* Keep brand/browser metadata consistent on every page, including nested topics. */
  function ensureBrandLinks() {
    const script = document.currentScript;
    const siteRoot = script && script.src ? new URL('../', script.src) : new URL('/', location.href);
    const links = [
      { rel: 'icon', href: 'assets/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: 'assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: 'assets/apple-touch-icon.png' },
      { rel: 'manifest', href: 'site.webmanifest' }
    ];
    links.forEach((spec) => {
      if (document.head.querySelector(`link[rel="${spec.rel}"][href$="${spec.href}"]`)) return;
      const link = document.createElement('link');
      Object.entries(spec).forEach(([key, value]) => link.setAttribute(key, key === 'href' ? new URL(value, siteRoot).href : value));
      document.head.appendChild(link);
    });
    /* theme-color tints the browser chrome on a phone. It was pinned to the dark
       surface, so a light page still got a dark bar. It has to follow the theme,
       and apply() below keeps it in step. */
    if (!document.head.querySelector('meta[name="theme-color"]')) {
      const theme = document.createElement('meta');
      theme.name = 'theme-color'; theme.content = '#F7F8FA';
      document.head.appendChild(theme);
    }
  }

  ensureBrandLinks();
  document.querySelectorAll('.wordmark').forEach((mark) => mark.setAttribute('aria-label', 'SIPI'));

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(v) {
    try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }

  /* 'dark' and 'system' are attributes; light is the absence of one, because
     light is what :root already is. Keep this in step with the boot script in
     <head> -- they set the same attribute and must agree on its values. */
  function apply(mode) {
    if (mode === 'dark' || mode === 'system') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    const dark = mode === 'dark'
      || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.head.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0B1015' : '#F7F8FA';
    document.querySelectorAll('[data-act="theme"]').forEach((b) => {
      b.textContent = mode === 'dark' ? 'Dark' : mode === 'system' ? 'System' : 'Light';
      b.setAttribute('aria-label', 'Colour theme: ' + (mode || 'light') + '. Click to change.');
    });
    window.dispatchEvent(new CustomEvent('sipi:theme', { detail: { mode: mode || 'light' } }));
  }

  const ORDER = [null, 'dark', 'system'];
  function init() {
    apply(stored());
    document.querySelectorAll('[data-act="theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = stored();
        const i = ORDER.indexOf(cur === 'dark' || cur === 'system' ? cur : null);
        const next = ORDER[(i + 1) % ORDER.length];
        save(next); apply(next);
      });
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (stored() === 'system') apply('system');
    });
  }

  /* ---------- sharing ----------
     The LinkedIn, X and email links are ordinary anchors stamped into the page, so
     they work with JavaScript off and load nothing from anyone else — a social
     widget would put a third party's script, and its tracking, on every page here.

     This adds only the two things an anchor cannot do: copy the link to the
     clipboard, and hand the page to the operating system's own share sheet where
     one exists, which is what a reader on a phone expects. Both degrade to the
     anchors beside them. */
  function wireShare() {
    document.querySelectorAll('[data-share]').forEach((row) => {
      const url = row.dataset.shareUrl || location.href;
      const title = row.dataset.shareTitle || document.title;

      const copy = row.querySelector('[data-act="copy-link"]');
      if (copy) {
        copy.addEventListener('click', () => {
          const done = (ok) => {
            const was = copy.textContent;
            copy.textContent = ok ? 'copied' : 'press ⌘C';
            setTimeout(() => { copy.textContent = was; }, 1600);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
          } else done(false);
        });
      }

      /* Only offered where the browser actually has a share sheet, so it is never
         a button that does nothing. */
      const native = row.querySelector('[data-act="share-native"]');
      if (native) {
        if (navigator.share) {
          native.hidden = false;
          native.addEventListener('click', () => {
            navigator.share({ title: title, url: url }).catch(() => {});
          });
        } else {
          native.remove();
        }
      }
    });
  }

  const initShare = () => { try { wireShare(); } catch (e) { /* sharing is optional */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShare);
  else initShare();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
