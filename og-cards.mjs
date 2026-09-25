#!/usr/bin/env node
/* og-cards.mjs — one preview card per topic page, for link previews.
 *
 * A shared card made every link to the site look the same in a feed. This renders
 * each topic page's own first figure (or, on a page without one, its first panel)
 * into a 1200 x 630 card with the page's title, in the site's own fonts, and writes
 * it to assets/og/<section>/<slug>.png. `python3 scaffold.py meta` then points the
 * page's og:image at it, and `scaffold.py check` fails for a page without one.
 *
 *   python3 serve.py &                  # the dev server, on port 8000
 *   node og-cards.mjs                   # every topic page
 *   node og-cards.mjs fundamentals/crosstalk   # just these
 *
 * No npm dependencies: it drives a local Chrome over the DevTools protocol with
 * Node's own fetch and WebSocket. Set CHROME to the browser binary if it is not
 * in the default macOS location, and BASE if the server is not on :8000.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.env.BASE || 'http://localhost:8000';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sipi-og-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 50 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page'); } catch (e) { /* not up yet */ }
    if (!targets.length) await sleep(200);
  }
  if (!targets.length) throw new Error('Chrome did not start; set CHROME to its binary');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), waiters = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) for (const w of waiters.splice(0)) (w.method === m.method ? w.res(m.params) : waiters.push(w));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  await send('Page.enable'); await send('Runtime.enable');
  const b = {
    size: (width, height, dpr) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }),
    goto: async (url) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url }); await l; },
    eval: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    shot: async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    close: async () => {
      const exited = new Promise((r) => proc.once('exit', r));
      try { await send('Browser.close'); } catch (e) { /* gone */ }
      await Promise.race([exited, sleep(3000)]);
      proc.kill();
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });   // Chrome may still be flushing
    }
  };
  return b;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* The card itself. Light theme, because a feed card has no theme of its own. */
function cardHtml(section, title, visual) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@500&display=block">
<style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; background: #F7F8FA; display: grid; grid-template-columns: 450px 1fr;
         font-family: "Archivo", Arial, sans-serif; color: #0E171F; overflow: hidden; }
  .text { padding: 56px 0 48px 60px; display: flex; flex-direction: column; }
  .logo { height: 44px; align-self: flex-start; }
  .kicker { margin-top: 44px; font: 500 20px/1 "IBM Plex Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: #0284C7; }
  h1 { margin: 18px 0 0; font-weight: 700; letter-spacing: -.02em; line-height: 1.08; font-size: 48px; }
  .site { margin-top: auto; font: 500 22px/1 "IBM Plex Mono", monospace; color: #5A6B78; letter-spacing: .04em; }
  .col { display: flex; align-items: center; justify-content: center; padding: 36px 44px 36px 20px; min-width: 0; }
  .visual { background: #FFFFFF; border: 1px solid #D5DEE5; border-radius: 12px; padding: 18px;
            max-width: 100%; max-height: 100%; box-sizing: border-box; display: flex; }
  .visual img { max-width: 100%; max-height: 522px; width: auto; height: auto; object-fit: contain; display: block; }
</style></head><body>
  <div class="text">
    <img class="logo" src="${BASE}/assets/brand/sipi-logo-600.png" alt="">
    <div class="kicker">${esc(section)}</div>
    <h1 id="t">${esc(title)}</h1>
    <div class="site">sipi.work</div>
  </div>
  <div class="col"><div class="visual"><img src="${visual}" alt=""></div></div>
</body></html>`;
}

async function main() {
  const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'topics.json'), 'utf8'));
  const want = new Set(process.argv.slice(2));
  const jobs = [];
  for (const s of topics.sections) for (const t of s.topics) {
    const rel = `${s.id}/${t.slug}`;
    if (!fs.existsSync(path.join(ROOT, 'topics', rel + '.html'))) continue;
    if (want.size && !want.has(rel)) continue;
    jobs.push({ rel, section: s.title, title: t.title.split(' | ')[0], section_id: s.id, slug: t.slug });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sipi-og-v-'));
  const b = await browser();
  let n = 0;
  for (const j of jobs) {
    /* 1. the page's own visual, at 2x so the card downsamples it cleanly */
    /* 800 px is still the desktop layout, and near the size the card shows it at,
       so a chart's own labels stay legible instead of shrinking with it */
    await b.size(800, 900, 2);
    await b.goto(`${BASE}/topics/${j.rel}.html`);
    await sleep(1400);
    const box = await b.eval(`(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      /* a figure's first diagram; else the panel's numbers and chart together */
      let el = document.querySelector('figure.figure svg');
      if (!el) {
        const v = document.querySelector('[data-viz]');
        if (!v) return null;
        const sized = (x) => x && x.querySelector('canvas') && x.getBoundingClientRect().width > 50;   // display: contents has no box
        el = ['.calc__main', '.calc__chart', '.lab-row', '.panels', '.panel'].map((q) => v.querySelector(q)).find(sized)
          || v.querySelector('canvas[data-cv]');
        if (!el) return null;
        const rr = el.getBoundingClientRect();
        if (rr.height > 1.25 * rr.width) el = el.querySelector('.panel') || el.querySelector('canvas') || el;   // too tall for a card
      }
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left, y: r.top + scrollY, w: r.width, h: r.height, kind: el.tagName });
    })()`);
    if (!box) { console.log('skip (no figure or panel):', j.rel); continue; }
    const r = JSON.parse(box);
    await sleep(300);
    const vfile = path.join(tmp, j.rel.replace('/', '__') + '.png');
    const pad = 8;
    await b.shot(vfile, { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad });

    /* 2. the card, at exactly 1200 x 630 */
    await b.size(1200, 630, 1);
    const cfile = path.join(tmp, 'card.html');
    fs.writeFileSync(cfile, cardHtml(j.section, j.title, 'file://' + vfile));
    await b.goto('file://' + cfile);
    await b.eval(`document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))))`);
    /* long titles step down until they fit four lines */
    await b.eval(`(() => { const h = document.getElementById('t'); let s = 52;
      while (h.getBoundingClientRect().height > 4 * 1.08 * s + 2 && s > 34) { s -= 2; h.style.fontSize = s + 'px'; } return s; })()`);
    const out = path.join(ROOT, 'assets', 'og', j.section_id, j.slug + '.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await b.shot(out, { x: 0, y: 0, width: 1200, height: 630 });
    n++;
    console.log('card', j.rel, '(' + r.kind.toLowerCase() + ')');
  }
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(n + ' card(s) written to assets/og/');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
