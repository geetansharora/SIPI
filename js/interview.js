/* Interview question banks: answers are folded <details>, so the page works with
   scripts off. This adds three conveniences on top:
   - a link to #q-... opens that question's answer;
   - "Random question" jumps to one, answer still folded, for practice;
   - "Show all answers" for reading straight through. Printing opens them all. */
(function () {
  const qs = [...document.querySelectorAll('.qa')];
  if (!qs.length) return;
  const ans = (q) => q.querySelector('details.qa__ans');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  function openHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const q = id && document.getElementById(id);
    if (q && q.classList.contains('qa') && ans(q)) ans(q).open = true;
  }
  openHash();
  window.addEventListener('hashchange', openHash);

  const tools = document.querySelector('[data-qa-tools]');
  if (tools) {
    tools.hidden = false;
    const all = tools.querySelector('[data-qa="all"]');
    let last = null;

    tools.querySelector('[data-qa="random"]').addEventListener('click', () => {
      let q;
      do { q = qs[Math.floor(Math.random() * qs.length)]; } while (qs.length > 1 && q === last);
      last = q;
      if (ans(q)) ans(q).open = false;
      q.setAttribute('tabindex', '-1');
      q.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
      q.focus({ preventScroll: true });
      q.classList.remove('qa--picked');
      void q.offsetWidth;                   // restart the highlight if the same card comes up twice
      q.classList.add('qa--picked');
    });

    all.addEventListener('click', () => {
      const show = all.getAttribute('aria-pressed') !== 'true';
      qs.forEach((q) => { if (ans(q)) ans(q).open = show; });
      all.setAttribute('aria-pressed', String(show));
      all.textContent = show ? 'Hide all answers' : 'Show all answers';
    });
  }

  let shut = null;
  window.addEventListener('beforeprint', () => {
    if (shut) return;
    shut = qs.map(ans).filter((d) => d && !d.open);
    shut.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!shut) return;
    shut.forEach((d) => { d.open = false; });
    shut = null;
  });
})();
