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

console.log('Script registration: both search/plot load orders passed.');
