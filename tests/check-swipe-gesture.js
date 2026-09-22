#!/usr/bin/env node
/* The phone swipe track, checked for the one thing that silently switches it off.
 *
 * A scroll-snap track scrolls sideways. `touch-action` decides, before any script
 * runs, whether a finger is allowed to make that happen -- and it is resolved on
 * the element the finger LANDS on, then intersected up the ancestor chain. So a
 * single restrictive declaration deep inside the track disables the gesture for
 * the whole track, however scrollable the track itself is.
 *
 * That is what shipped. `.panel canvas` sets `touch-action: pan-y`, which is right
 * for an article -- a finger on a plot scrolls the page down, and left/right stays
 * with the canvas's own handlers -- but the lab charts are that same `.panel
 * canvas`, and they are two thirds of a panel's area on a phone. Every swipe that
 * started on a chart was refused.
 *
 * Nothing else could see it. The markup is correct, the track is scrollable, the
 * listeners are attached, no error is logged, and the dots keep working the entire
 * time, because scrollTo() is a scripted scroll and touch-action governs only
 * input-driven ones. It is visible on a real phone and nowhere else.
 *
 * So the invariant is stated in CSS terms, where it is decidable: no rule may take
 * the horizontal axis away from anything that ends up inside the track, unless a
 * more specific rule scoped to the track gives it back.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = process.env.SIPI_SRC || path.join(__dirname, '..');
const SHEETS = ['components.css', 'base.css', 'adc-lab.css'];

/* Every `touch-action` declaration, with the selector that carries it. Comments
   are stripped first so a rule quoted in prose is not read as a rule. */
const decls = [];
for (const name of SHEETS) {
  const file = path.join(SRC, 'css', name);
  if (!fs.existsSync(file)) continue;
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*touch-action\s*:\s*([^;}]+)[^}]*)\}/g)) {
    m[1].split(',').forEach((sel) => decls.push({ name, sel: sel.trim(), value: m[3].trim() }));
  }
}
assert(decls.length, 'no touch-action declarations found — has the selector parser drifted?');

/* Horizontal panning is permitted by `auto`, by `manipulation`, and by any list
   naming pan-x. Every other value hands left/right to the element. */
const refusesPanX = (v) => v !== 'auto' && v !== 'manipulation' && !/\bpan-x\b/.test(v);

/* Rough specificity: [ids, classes+attrs+pseudo-classes, elements]. Enough to
   compare two selectors for the same subject, which is all this needs. */
const spec = (sel) => [
  (sel.match(/#[\w-]+/g) || []).length,
  (sel.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length,
  (sel.match(/(?:^|[\s>+~])([a-z][\w-]*)/g) || []).length,
];
const beats = (a, b) => { const x = spec(a), y = spec(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const subject = (sel) => sel.trim().split(/[\s>+~]+/).filter(Boolean).pop();

/* 1. The track has to be able to scroll sideways in the first place. */
const comp = fs.readFileSync(path.join(SRC, 'css', 'components.css'), 'utf8');
const trackRule = comp.match(/\.lab-swipe\s*\{[^}]*\}/g) || [];
assert(trackRule.some((r) => /overflow-x:\s*(auto|scroll)/.test(r)),
  '.lab-swipe must declare overflow-x: auto or scroll, or there is nothing to swipe');
assert(trackRule.some((r) => /scroll-snap-type:\s*x\b/.test(r)),
  '.lab-swipe must snap on x, or a swipe lands between charts');

/* 2. Nothing inside the track may refuse the axis the track scrolls in. The
      panels are .panel elements moved into .lab-swipe by viz-loader, so any rule
      reaching a .panel descendant reaches the track's contents. */
const problems = [];
let guarded = 0;
for (const d of decls) {
  if (!/\.panel\b/.test(d.sel) || /\.lab-swipe\b/.test(d.sel)) continue;
  if (!refusesPanX(d.value)) continue;
  const rescue = decls.find((o) => /\.lab-swipe\b/.test(o.sel)
    && subject(o.sel) === subject(d.sel) && !refusesPanX(o.value) && beats(o.sel, d.sel));
  if (rescue) { guarded++; continue; }
  problems.push(`${d.name}: \`${d.sel} { touch-action: ${d.value} }\` reaches the swipe `
    + `track and refuses horizontal panning. A finger landing on this element cannot `
    + `move the track — only the dots and the keyboard will work, with no error `
    + `anywhere. Add a rule under .lab-swipe restoring it for ${subject(d.sel)}.`);
}

if (problems.length) {
  console.error(`\n${problems.length} SWIPE GESTURE PROBLEM(S):`);
  problems.forEach((p) => console.error('  x ' + p));
  process.exit(1);
}
console.log(`Swipe gesture: track scrolls and snaps on x; `
  + `${guarded} restrictive touch-action rule(s) reaching it are overridden inside it.`);
