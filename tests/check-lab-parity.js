#!/usr/bin/env node
'use strict';
// Lab parity: a rearrangement must not lose or duplicate anything the instrument carries.
//
// The workspace layout moves controls, readouts and plots into a different
// arrangement. Every id, live readout, action, plot, preset and control range has
// to survive that move exactly once. Losing one fails silently in a browser — a
// slider that no longer exists simply stops being drawn, and a cloned one gives
// the scenario two sources of truth for the same parameter.
//
// The manifest is the identity inventory recorded before the move. This check is a
// regression guard, not a physics test: it proves the page still carries what it
// carried, and says nothing about whether those numbers are right.
//
//   node tests/check-lab-parity.js            verify against the manifest
//   node tests/check-lab-parity.js --update   re-record it (review the diff)
//   node tests/check-lab-parity.js -v         also list identities added since

const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(__dirname, 'fixtures', 'lab-parity.json');
const update = process.argv.includes('--update');
const verbose = process.argv.includes('-v');

const LABS = [
  'topics/labs/travelling-waves.html',
  'topics/labs/one-channel.html',
  'topics/labs/pdn-chain.html',
  'topics/signal-integrity/receiver-and-clock.html',
  'topics/labs/adc-interference.html'
];

// The instrument section, from its opening tag to its own closing tag.
function instrument(src, file) {
  const open = /<section class="instrument[^"]*"[^>]*\bdata-viz="([^"]+)"[^>]*>/.exec(src);
  assert(open, file + ': no <section class="instrument…" data-viz="…">');
  let depth = 0, i = open.index;
  const tag = /<section\b|<\/section>/g;
  tag.lastIndex = i;
  for (let m; (m = tag.exec(src)); ) {
    depth += m[0] === '</section>' ? -1 : 1;
    if (depth === 0) return { viz: open[1], html: src.slice(open.index, m.index + m[0].length) };
  }
  throw new Error(file + ': instrument section is not closed');
}

const attrs = (html, name) => {
  const out = [];
  const re = new RegExp('\\b' + name + '="([^"]+)"', 'g');
  for (let m; (m = re.exec(html)); ) out.push(m[1]);
  return out;
};

// A control is identified by what changes the model: its kind, its range and its
// default. A label reworded is presentation; a step or a default changed is not.
function controls(html) {
  const out = {};
  const re = /<(input|select)\b([^>]*)>/g;
  for (let m; (m = re.exec(html)); ) {
    const tagAttrs = m[2];
    const id = /\bid="([^"]+)"/.exec(tagAttrs);
    if (!id) continue;
    const pick = (n) => { const v = new RegExp('\\b' + n + '="([^"]*)"').exec(tagAttrs); return v ? v[1] : null; };
    const rec = { tag: m[1], type: pick('type'), name: pick('name'),
                  min: pick('min'), max: pick('max'), step: pick('step'), value: pick('value') };
    if (m[1] === 'select') {
      const end = html.indexOf('</select>', m.index);
      rec.options = attrs(html.slice(m.index, end), 'value');
    }
    if (/\bchecked\b/.test(tagAttrs)) rec.checked = true;
    out[id[1]] = rec;
  }
  return out;
}

function snapshot(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const inst = instrument(src, file);
  const uniq = (a) => Array.from(new Set(a)).sort();
  return {
    viz: inst.viz,
    ids: uniq(attrs(inst.html, 'id')),
    outs: uniq(attrs(inst.html, 'data-out')),
    acts: uniq(attrs(inst.html, 'data-act')),
    plots: uniq(attrs(inst.html, 'data-cv')),
    presets: uniq(attrs(inst.html, 'data-preset')),
    controls: controls(inst.html),
    // Script order matters: the kit has to register before a module reads it.
    scripts: attrs(src, 'src').filter((s) => s.endsWith('.js') || s.includes('.js?'))
                              .map((s) => s.split('?')[0].replace(/^.*\//, ''))
  };
}

if (update) {
  const out = {};
  LABS.forEach((f) => { out[f] = snapshot(f); });
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
  console.log('Lab parity: manifest recorded for ' + LABS.length + ' pages → tests/fixtures/lab-parity.json');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let checked = 0, added = 0;

for (const file of Object.keys(manifest)) {
  const was = manifest[file], now = snapshot(file);
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const inst = instrument(src, file).html;

  assert.equal(now.viz, was.viz, file + ': the instrument mounts a different module');

  for (const kind of ['ids', 'outs', 'acts', 'plots', 'presets']) {
    for (const value of was[kind]) {
      assert(now[kind].includes(value),
        file + ': ' + kind.replace(/s$/, '') + ' "' + value + '" is gone from the instrument');
      checked++;
    }
    added += now[kind].filter((v) => !was[kind].includes(v)).length;
    if (verbose) now[kind].filter((v) => !was[kind].includes(v))
      .forEach((v) => console.log('  + ' + file + ' ' + kind.replace(/s$/, '') + ' "' + v + '"'));
  }

  // Exactly once. A second slider with the same id gives the scenario two sources
  // of truth, and only one of them is ever read back.
  for (const id of was.ids) {
    const n = (inst.match(new RegExp('\\bid="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
    assert.equal(n, 1, file + ': id "' + id + '" appears ' + n + ' times; a cloned control competes for the same state');
  }

  for (const id of Object.keys(was.controls)) {
    const a = was.controls[id], b = now.controls[id];
    assert(b, file + ': control "' + id + '" is gone');
    for (const key of Object.keys(a)) {
      assert.deepEqual(b[key], a[key],
        file + ': control "' + id + '" ' + key + ' changed from ' + JSON.stringify(a[key]) + ' to ' + JSON.stringify(b[key]));
      checked++;
    }
  }

  // Recorded scripts keep their relative order; new ones may be inserted anywhere.
  let at = -1;
  for (const s of was.scripts) {
    const i = now.scripts.indexOf(s, at + 1);
    assert(i > at, file + ': script ' + s + ' is missing or loads out of order');
    at = i;
    checked++;
  }
}

console.log('Lab parity: ' + checked + ' identities held across ' + Object.keys(manifest).length +
            ' lab pages' + (added ? ' (' + added + ' added)' : '') + '.');
