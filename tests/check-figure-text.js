#!/usr/bin/env node
/* Tier-3 figure labels, checked for collisions and for leaving the frame.
 *
 * SVG <text> does not wrap. A label longer than the space its column has runs
 * straight over its neighbour, and because `.figure svg` is `overflow: visible`
 * a label past the viewBox paints outside the figure entirely -- which is the
 * one thing CLAUDE.md warns about for this tier. Neither shows up in a link
 * check, a tag-balance check or a physics gate; the SVG is valid and the page
 * renders. It is only wrong to look at.
 *
 * Found by a reader: four cross-sections on the travelling-waves lab whose
 * captions printed on top of each other, 52 characters of 6 px monospace in a
 * column 196 px wide.
 *
 * The width model is exact for the fonts these labels actually use. Every
 * .figure label class is var(--font-mono), IBM Plex Mono, whose advance width is
 * 600/1000 em -- so a character is 0.6 x font-size, with no kerning and no
 * variable-width guessing. A label in a proportional font would need measuring
 * in a browser, and there are none.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = process.env.SIPI_SRC || path.join(__dirname, '..');
const ADVANCE = 0.6;                       // IBM Plex Mono, em per character

/* Label class -> font size, read from the stylesheet rather than restated. */
const css = fs.readFileSync(path.join(SRC, 'css', 'components.css'), 'utf8');
const SIZES = {};
for (const m of css.matchAll(/\.figure\s+\.([a-z-]+)\s*\{[^}]*font-size:\s*([\d.]+)px/g)) {
  SIZES[m[1]] = parseFloat(m[2]);
}
assert(Object.keys(SIZES).length, 'no .figure label sizes found in components.css');

const decode = (s) => s
  .replace(/<tspan[^>]*>/g, '').replace(/<\/tspan>/g, '')
  .replace(/&mdash;|&#8212;/g, '-').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&[a-z]+;|&#\d+;/g, '?')
  .replace(/\s+/g, ' ').trim();

function pagesWithFigures() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tests') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.html')) continue;
      const html = fs.readFileSync(full, 'utf8');
      if (html.includes('<figure class="figure"')) out.push([path.relative(SRC, full), html]);
    }
  };
  walk(SRC);
  return out;
}

const problems = [];
let svgCount = 0, textCount = 0;

for (const [rel, html] of pagesWithFigures()) {
  for (const fig of html.split('<figure class="figure"').slice(1)) {
    const svgM = fig.match(/<svg[^>]*viewBox="([^"]+)"[\s\S]*?<\/svg>/);
    if (!svgM) continue;
    svgCount++;
    /* The right edge is minX + width, not width. Several figures start at a
       negative min-x to give a stroke room, and comparing against the width alone
       would let a label run past the frame unnoticed on exactly those. */
    const vb = svgM[1].trim().split(/[\s,]+/).map(Number);
    const vbRight = vb[0] + vb[2], vbW = vb[2];
    const body = svgM[0];

    /* Every label, with the x/y it is drawn at and the width it will occupy.

       The group stack is the whole reason this is a walk and not a regex over
       <text>. Several figures lay their panels out as
       <g transform="translate(148,0)"> and give each panel LOCAL coordinates, so
       comparing raw x values across groups reports collisions between labels
       that are nowhere near each other. The first version of this check did
       exactly that and produced 35 false positives against 9 real ones.

       Only translate is followed. A group carrying scale, rotate or a matrix
       changes the geometry in ways this model cannot predict, so its labels are
       skipped rather than guessed at. */
    const labels = [];
    const stack = [{ dx: 0, dy: 0, ok: true }];
    const token = /<g\b([^>]*)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = token.exec(body))) {
      const top = stack[stack.length - 1];
      if (m[0] === '</g>') { if (stack.length > 1) stack.pop(); continue; }
      if (m[1] !== undefined) {                       // opening <g ...>
        const tf = (m[1].match(/transform="([^"]*)"/) || [, ''])[1];
        const tr = tf.match(/translate\(\s*([-\d.]+)[\s,]*([-\d.]*)\s*\)/);
        const other = /scale|rotate|matrix|skew/.test(tf);
        stack.push({ dx: top.dx + (tr ? parseFloat(tr[1]) : 0),
                     dy: top.dy + (tr && tr[2] ? parseFloat(tr[2]) : 0),
                     ok: top.ok && !other });
        continue;
      }
      const attrs = m[2], text = decode(m[3]);
      if (!text || !top.ok) continue;
      const cls = (attrs.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/)
        .find((c) => SIZES[c]);
      if (!cls) continue;                   // not a sized label class
      if (/transform=/.test(attrs)) continue;   // rotated labels are out of scope
      const x = parseFloat((attrs.match(/\bx="([-\d.]+)"/) || [, NaN])[1]) + top.dx;
      const y = parseFloat((attrs.match(/\by="([-\d.]+)"/) || [, NaN])[1]) + top.dy;
      if (!isFinite(x) || !isFinite(y)) continue;
      const size = SIZES[cls];
      const w = text.length * size * ADVANCE;
      const anchor = (attrs.match(/text-anchor="([^"]+)"/) || [, 'start'])[1];
      const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      labels.push({ text, x, y, w, left, right: left + w, size });
      textCount++;
    }

    /* 1. Past the right edge of the viewBox. overflow:visible means this paints
          over whatever is beside the figure rather than being clipped. */
    for (const l of labels) {
      /* One character of slack. The width model uses the advance width, which is
         what the layout reserves, but the last glyph's ink rarely fills it -- so a
         label ending a pixel or two past the frame is inside the model's own error
         rather than a defect. Four figures sit 1 to 4 px over by this measure and
         look correct. The overrun this check exists for was 146 px, 24 characters,
         so the tolerance costs nothing real. */
      if (l.right > vbRight + l.size * ADVANCE) {
        problems.push(`${rel}: "${l.text.slice(0, 44)}..." ends at `
          + `${Math.round(l.right)}, past the viewBox right edge of ${vbRight} `
          + `(${vbW} wide from ${vb[0]}), so it paints outside the figure`);
      }
    }

    /* 2. Two labels on the same baseline whose boxes overlap. Same baseline is
          the only case that is certainly a collision; labels on different lines
          can overlap horizontally and still read. */
    const rows = {};
    labels.forEach((l) => { (rows[l.y] = rows[l.y] || []).push(l); });
    for (const y of Object.keys(rows)) {
      const row = rows[y].sort((a, b) => a.left - b.left);
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1], cur = row[i];
        if (cur.left < prev.right - 0.5) {
          problems.push(`${rel}: on baseline y=${y}, "${prev.text.slice(0, 32)}..." runs to `
            + `${Math.round(prev.right)} and "${cur.text.slice(0, 32)}..." starts at `
            + `${Math.round(cur.left)} — they print on top of each other`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} FIGURE TEXT PROBLEM(S):`);
  problems.forEach((p) => console.error('  x ' + p));
  process.exit(1);
}
console.log(`Figure labels: ${textCount} label(s) across ${svgCount} inline figure(s) `
  + `stay inside their viewBox and off each other.`);
