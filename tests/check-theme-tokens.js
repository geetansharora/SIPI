#!/usr/bin/env node
/* The theme palettes, checked against each other and against WCAG.
 *
 * This exists because of a real defect. The light palette used to be written
 * twice -- once under a prefers-color-scheme media query and once under
 * [data-theme="light"] -- and the media-query copy was missing --signal-text and
 * --alarm-text. Every reader whose system asked for light and who never touched
 * the toggle therefore got those two colours at their DARK values on a white
 * background, at 2.93:1 and 3.20:1 against the 4.5:1 WCAG asks for small text.
 * Nothing could see it: both copies were valid CSS, the page looked fine to
 * anyone testing in dark, and no gate read colours at all.
 *
 * Light now lives in the bare :root block and cannot be duplicated. Dark still
 * must be, because CSS with no build step cannot share one declaration block
 * between a media query and an attribute selector, so the first assertion below
 * is that those two copies agree -- exactly the check whose absence cost the
 * contrast bug.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = process.env.SIPI_SRC || path.join(__dirname, '..');
const css = fs.readFileSync(path.join(SRC, 'css', 'base.css'), 'utf8');

/* ---- pull the three palettes out of the stylesheet ---- */
function tokensIn(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  const scheme = body.match(/color-scheme\s*:\s*([a-z]+)\s*;/);
  if (scheme) out['color-scheme'] = scheme[1];
  return out;
}
function blockAfter(marker) {
  const i = css.indexOf(marker);
  assert(i >= 0, 'cannot find the block starting ' + marker);
  const open = css.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) break;
  }
  return css.slice(open + 1, j);
}

const light = tokensIn(blockAfter('\n:root {'));
const darkExplicit = tokensIn(blockAfter('\n:root[data-theme="dark"] {'));
const darkSystem = tokensIn(blockAfter('  :root[data-theme="system"] {'));

/* ---- 1. the two dark copies must be the same palette ---- */
{
  const a = Object.keys(darkExplicit).sort();
  const b = Object.keys(darkSystem).sort();
  assert.deepEqual(a, b,
    'the two dark blocks define different token sets. A reader who picks Dark and '
    + 'a reader whose system is dark would see different palettes:\n  only in '
    + '[data-theme="dark"]: ' + a.filter((k) => !b.includes(k)).join(', ')
    + '\n  only in the media query: ' + b.filter((k) => !a.includes(k)).join(', '));
  const differing = a.filter((k) => darkExplicit[k] !== darkSystem[k]);
  assert.deepEqual(differing, [],
    'the two dark blocks disagree on: '
    + differing.map((k) => `${k} (${darkExplicit[k]} vs ${darkSystem[k]})`).join(', '));
  console.log('Theme tokens: both dark blocks define the same ' + a.length + ' tokens, identically.');
}

/* ---- 2. no token may exist in one theme and not the other ----
   This is the shape of the original bug: a token defined for one palette and
   inherited from the other, which is never what was meant and is invisible
   until someone views the site in the theme that inherits. */
{
  const COLOUR = /^--(ground|surface|surface-2|border|border-soft|ink|ink-2|muted|signal|reflect|alarm|signal-text|alarm-text|grid|glow)$/;
  const lightColours = Object.keys(light).filter((k) => COLOUR.test(k)).sort();
  const darkColours = Object.keys(darkExplicit).filter((k) => COLOUR.test(k)).sort();
  assert.deepEqual(darkColours, lightColours,
    'a colour is defined for one theme only, so the other inherits it:\n  missing from dark: '
    + lightColours.filter((k) => !darkColours.includes(k)).join(', ')
    + '\n  missing from light: ' + darkColours.filter((k) => !lightColours.includes(k)).join(', '));
  console.log('Theme tokens: all ' + lightColours.length
    + ' colours are defined in both themes, so neither inherits from the other.');
}

/* ---- 3. text colours must actually be readable on their own background ----
   The assertion the contrast bug needed. WCAG 2.1 SC 1.4.3: 4.5:1 for normal
   text, 3:1 for large text and for graphical objects. --signal and --reflect are
   stroke colours and are held to 3:1; the -text variants exist precisely because
   those strokes do not clear 4.5:1, and they are held to it. */
{
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  let checked = 0;
  for (const [name, pal] of [['light', light], ['dark', darkExplicit]]) {
    /* Text sits on --surface in a card and on --ground in the page body; the
       worse of the two is the one that has to pass. */
    const bgs = [pal['--ground'], pal['--surface']].filter(Boolean);
    const at45 = ['--ink', '--ink-2', '--signal-text', '--alarm-text'];
    const at30 = ['--muted', '--signal', '--reflect', '--alarm'];
    for (const [tokens, need, kind] of [[at45, 4.5, 'small text'], [at30, 3.0, 'large text or a stroke']]) {
      for (const tok of tokens) {
        const colour = pal[tok];
        if (!colour || !colour.startsWith('#')) continue;
        const worst = Math.min(...bgs.map((bg) => ratio(colour, bg)));
        assert(worst >= need,
          `${name}: ${tok} (${colour}) is ${worst.toFixed(2)}:1 against its own background, `
          + `below the ${need}:1 WCAG asks for ${kind}`);
        checked++;
      }
    }
  }
  console.log('Theme tokens: ' + checked + ' colour(s) meet their WCAG contrast minimum in both themes.');
}

/* ---- 4. no rule may target a theme the site cannot set ----
   The generalisation of a real bug. When light stopped being an attribute value
   and became the bare :root default, two rules in components.css went on saying
   [data-theme="light"] -- valid CSS, matching nothing, silently dead. They were
   the rules that removed the invert filter from the wordmark, so a fresh visitor
   on a dark-mode phone got the light palette with a white logo on it.

   The set of themes the site can set is decided in one place, js/site.js, so read
   it from there rather than restating it here. */
{
  const js = fs.readFileSync(path.join(SRC, 'js', 'site.js'), 'utf8');
  const order = js.match(/const ORDER = \[([^\]]+)\]/);
  assert(order, 'cannot find the theme ORDER in site.js');
  const settable = new Set(
    order[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s && s !== 'null'));
  assert(settable.size, 'site.js sets no theme attribute at all');

  const offenders = new Set();
  for (const file of ['base.css', 'components.css', 'adc-lab.css']) {
    const full = path.join(SRC, 'css', file);
    if (!fs.existsSync(full)) continue;
    /* Comments first. The rules this check exists for are explained in comments
       that necessarily quote the dead selector, and matching those would fail the
       build on its own documentation -- which it did, the first time it ran. */
    const text = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/\[data-theme\s*=\s*"([^"]+)"\]/g)) {
      if (!settable.has(m[1])) offenders.add(`${file}: [data-theme="${m[1]}"]`);
    }
  }
  assert.deepEqual([...offenders], [],
    'these selectors target a theme site.js never sets, so they match nothing and '
    + 'are dead:\n  ' + [...offenders].join('\n  ')
    + '\n  settable themes are: ' + [...settable].join(', '));
  console.log('Theme tokens: every [data-theme] selector names a theme site.js can set ('
    + [...settable].join(', ') + ').');
}
