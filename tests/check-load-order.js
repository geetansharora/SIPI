#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
for (const order of [
  ['search.js', 'viz-kit.js', 'viz/reflection.js'],
  ['viz-kit.js', 'viz/reflection.js', 'search.js']
]) {
  const context = vm.createContext({
    URL, console,
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: { currentScript: { src: 'http://localhost/js/search.js' }, readyState: 'loading',
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    fetch: () => new Promise(() => {})
  });
  order.forEach((name) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context, { filename: name }));
  assert.equal(typeof context.window.SIPI.viz.reflection, 'function', order.join(' → '));
  assert(context.window.SIPI.searchModel, 'search registration survives either order');
}
/* Nothing the site serves may reach into the experimental folder. That folder is a
   scratch area: it is not in the sitemap, its pages carry noindex, and it can be
   deleted at any time. A production page or module that referenced it would break
   silently the moment it went, and the break would be invisible locally because the
   file is still there. Checked as a dependency rule rather than as a habit. */
{
  const EXPERIMENTAL = 'experimental-labs';
  /* `docs/` records how the work was done, and saying the folder's name in a
     progress log is not a dependency on it. Everything the site SERVES is in
     scope. */
  const skip = new Set(['node_modules', '.git', 'tests', 'docs']);
  const offenders = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(full, r); continue; }
      if (!/\.(html|js|css|json|py|xml|txt|md)$/.test(e.name)) continue;
      if (fs.readFileSync(full, 'utf8').includes(EXPERIMENTAL)) offenders.push(r);
    }
  };
  walk(path.join(__dirname, '..'), '');
  assert.deepEqual(offenders, [],
    'these served files reference the experimental folder: ' + offenders.join(', '));
  console.log('Experimental isolation: nothing outside tests/ references ' + EXPERIMENTAL + '.');
}

/* .assetsignore decides what Cloudflare does NOT upload, and it is the one kind of
   mistake every other gate is blind to: an excluded file is still on disk, so the
   link checker finds it, the page renders locally, and the 404 appears only in
   production. Note that .gitignore has no bearing here -- it governs what git
   tracks, not what Wrangler serves once a file exists -- so the two lists are
   genuinely independent and have to be checked separately.

   The matcher below implements only the subset of .gitignore syntax the file
   actually uses: a bare name matched at any level, a `*.ext` glob, and a
   `dir/*.ext` glob. It is deliberately not a general implementation; if a pattern
   form appears that it does not understand, it refuses rather than passing. */
{
  const root = path.join(__dirname, '..');
  const raw = fs.readFileSync(path.join(root, '.assetsignore'), 'utf8');
  const patterns = raw.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert(patterns.length, '.assetsignore parsed to nothing');

  for (const pat of patterns) {
    assert(!/[!\[\]?]/.test(pat) && !pat.endsWith('/') && !pat.includes('**'),
      '.assetsignore uses a pattern this gate cannot evaluate: ' + pat
      + ' -- extend the matcher rather than trusting it');
  }

  const rx = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*') + '$');
  const ignored = (rel) => patterns.some((pat) => pat.includes('/')
    ? rx(pat).test(rel)
    : rel.split('/').some((seg) => rx(pat).test(seg)));

  /* Every page Cloudflare will serve, and every local thing it points at. */
  const pages = [];
  const collect = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { collect(full, r); continue; }
      if (e.name.endsWith('.html') && !ignored(r)) pages.push([full, r]);
    }
  };
  collect(root, '');
  assert(pages.length > 60, 'expected the whole site, found ' + pages.length + ' pages');

  const offenders = [];
  for (const [full, rel] of pages) {
    const html = fs.readFileSync(full, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(href)) continue;
      const bare = href.split('#')[0].split('?')[0];
      if (!bare) continue;
      const abs = bare.startsWith('/')
        ? path.join(root, bare.slice(1))
        : path.resolve(path.dirname(full), bare);
      const target = path.relative(root, abs);
      if (target.startsWith('..')) continue;
      if (ignored(target)) offenders.push(rel + ' -> ' + target);
    }
  }
  assert.deepEqual(offenders, [],
    'these pages link to files .assetsignore stops Cloudflare serving, so they '
    + 'would 404 in production while passing every local check:\n  '
    + offenders.join('\n  '));

  /* The converse, so the list cannot quietly stop excluding anything: each
     pattern must still match something on disk. A stale line is a line nobody
     will notice has gone inert.

     `.git` is exempt, and the exemption is the point rather than a convenience.
     It is excluded defensively, against a checkout that has one -- which is what
     Cloudflare's builder produces -- while the tree this gate runs in may be a
     `git archive` export that does not. Its absence here says nothing about
     whether the line is still needed, so requiring it to match would fail the
     publish verification every time. This was caught by the export failing. */
  const all = [];
  const walkAll = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') { all.push(r); continue; }
        walkAll(path.join(dir, e.name), r);
        continue;
      }
      all.push(r);
    }
  };
  walkAll(root, '');
  const DEFENSIVE = new Set(['.git']);
  const inert = patterns.filter((pat) => !DEFENSIVE.has(pat)
    && !all.some((f) => pat.includes('/')
      ? rx(pat).test(f)
      : f.split('/').some((seg) => rx(pat).test(seg))));
  assert.deepEqual(inert, [],
    '.assetsignore lines that no longer match anything: ' + inert.join(', '));

  console.log('Asset exclusions: ' + patterns.length + ' .assetsignore pattern(s), none '
    + 'referenced by any of the ' + pages.length + ' served pages, none inert.');
}

console.log('Script registration: both search/plot load orders passed.');
