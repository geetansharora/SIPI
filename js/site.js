/* SI & PI — site.js
 * Theme toggle. Three states cycle: system → light → dark → system.
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
    if (!document.head.querySelector('meta[name="theme-color"]')) {
      const theme = document.createElement('meta');
      theme.name = 'theme-color'; theme.content = '#17191c';
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

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-act="theme"]').forEach((b) => {
      b.textContent = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System';
      b.setAttribute('aria-label', 'Colour theme: ' + (mode || 'system') + '. Click to change.');
    });
    window.dispatchEvent(new CustomEvent('sipi:theme', { detail: { mode: mode || 'system' } }));
  }

  const ORDER = [null, 'light', 'dark'];
  function init() {
    apply(stored());
    document.querySelectorAll('[data-act="theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = stored();
        const next = ORDER[(ORDER.indexOf(cur === null ? null : cur) + 1) % ORDER.length];
        save(next); apply(next);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
