#!/usr/bin/env node
'use strict';
// K.numericEntry: what the typed box shows, and what it hands back.
//
// A regression guard for display formatting, not a physics check. The box is the
// only way to read or set an exact value without dragging, so it has to show the
// value the control actually holds: 70 steps of 0.01 is 0.7, and a reader who sees
// 0.7000000000000001 has been shown the binary representation instead of the
// number. Clamping and snapping belong to the range and are asserted separately
// from the string that is displayed.

const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

// ---- the smallest DOM that K.numericEntry actually uses ----
function el(tag) {
  const listeners = {};
  return {
    tag, style: {}, dataset: {}, className: '', textContent: '', value: '',
    children: [],
    setAttribute() {}, appendChild(c) { this.children.push(c); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
    fire(name, ev) { (listeners[name] || []).forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev))); },
    insertAdjacentElement(where, node) { this.after = this.after || []; this.after.push(node); return node; }
  };
}

function harness(spec) {
  const range = Object.assign(el('input'), {
    id: spec.id, type: 'range', min: String(spec.min), max: String(spec.max),
    step: String(spec.step), value: String(spec.value)
  });
  const out = Object.assign(el('output'), { id: spec.id + '-out', value: spec.shown });
  const label = Object.assign(el('label'), { textContent: spec.label || spec.id });
  const root = {
    querySelectorAll(sel) { return sel.includes('range') ? [range] : []; },
    querySelector(sel) {
      if (sel === '#' + spec.id + '-out') return out;
      if (sel.startsWith('label')) return label;
      return null;
    }
  };
  const sandbox = {
    console,
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1 },
    document: { activeElement: null, addEventListener() {}, createElement: el,
                querySelector: () => null, querySelectorAll: () => [] },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: function (fn) { this.observe = () => { out.__sync = fn; }; },
    Event: function (type) { this.type = type; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/viz-kit.js'), 'utf8'), ctx, { filename: 'viz-kit.js' });

  // Stand in for the module: when the range moves, it redraws and rewrites the
  // readout. Registered first, so it updates the output before the kit mirrors it,
  // which is the order a real page produces.
  range.addEventListener('input', () => {
    out.value = String(+(+range.value * spec.scale).toFixed(9)) + (spec.unit || '');
    if (out.__sync) out.__sync();
  });

  ctx.window.SIPI.kit.numericEntry(root);
  const box = (out.after || []).find((n) => n.className === 'ctl__num');
  return { range, out, box, doc: sandbox.document };
}

let checks = 0;
const is = (got, want, what) => { assert.strictEqual(got, want, what + ' — got ' + JSON.stringify(got)); checks++; };

// 1 · The reported case. CDR damping: 15..150 by 5, displayed as hundredths.
{
  const h = harness({ id: 'cdr-zeta', min: 15, max: 150, step: 5, value: 70, shown: '0.70', scale: 0.01 });
  assert(h.box, 'numericEntry attaches to a power-of-ten scaled slider');
  is(h.box.value, '0.7', 'damping 70 x 0.01 shows as 0.7, not its binary expansion');
  assert(!/\d{8}/.test(h.box.value), 'no float dust in the displayed value');
  checks++;
}

// 2 · Typing commits through the step, and the echo stays clean.
{
  const h = harness({ id: 'cdr-zeta', min: 15, max: 150, step: 5, value: 70, shown: '0.70', scale: 0.01 });
  h.box.value = '1.15';
  h.box.fire('change');
  is(h.range.value, '115', 'a typed 1.15 lands on raw 115');
  is(h.box.value, '1.15', 'and echoes back as typed');

  h.box.value = '0.73';                       // between steps: snaps to the nearest
  h.box.fire('change');
  is(h.range.value, '75', '0.73 snaps to the 0.75 step');
  is(h.box.value, '0.75', 'the echo shows where it landed, cleanly');
}

// 3 · Clamping is the range's job and is not confused by formatting.
{
  const h = harness({ id: 'cdr-zeta', min: 15, max: 150, step: 5, value: 70, shown: '0.70', scale: 0.01 });
  h.box.value = '9';   h.box.fire('change');
  is(h.range.value, '150', 'above maximum clamps to the maximum');
  is(h.box.value, '1.5', 'and shows the clamped value');
  h.box.value = '0';   h.box.fire('change');
  is(h.range.value, '15', 'below minimum clamps to the minimum');
  is(h.box.value, '0.15', 'and shows that');
}

// 4 · Arrow keys move by one declared step, repeatedly, without drift.
{
  const h = harness({ id: 'cdr-zeta', min: 15, max: 150, step: 5, value: 70, shown: '0.70', scale: 0.01 });
  for (let i = 0; i < 6; i++) h.box.fire('keydown', { key: 'ArrowUp' });
  is(h.box.value, '1', 'six steps up from 0.70 reads exactly 1');
  is(h.range.value, '100', 'and the range agrees');
  for (let i = 0; i < 6; i++) h.box.fire('keydown', { key: 'ArrowDown' });
  is(h.box.value, '0.7', 'and six back down returns to 0.7');
}

// 5 · A round trip through the module's own readout does not accumulate digits.
{
  const h = harness({ id: 'cdr-zeta', min: 15, max: 150, step: 5, value: 70, shown: '0.70', scale: 0.01 });
  for (let i = 0; i < 20; i++) h.box.fire('change');   // commit → module → mirror → commit
  is(h.box.value, '0.7', 'twenty mirror/commit round trips leave the display unchanged');
  is(h.range.value, '70', 'and the underlying value unchanged');
}

// 6 · Integer and sub-milli scales get their own decimal counts, not one fixed count.
{
  const a = harness({ id: 'lw-z0', min: 25, max: 100, step: 1, value: 50, shown: '50 Ω', scale: 1, unit: ' Ω' });
  is(a.box.value, '50', 'an integer slider shows no decimal point');
  const b = harness({ id: 'fine', min: 0, max: 5000, step: 1, value: 1234, shown: '1.234 ns', scale: 0.001, unit: ' ns' });
  is(b.box.value, '1.234', 'a milli-scaled slider keeps its three decimals');
}

// 7 · A mapped slider — an index that displays a speed bin — is still refused.
{
  const h = harness({ id: 'mapped', min: 0, max: 5, step: 1, value: 3, shown: '5120 MT/s', scale: 1706.67 });
  assert(!h.box, 'an index-to-bin slider gets no typed box: writing back would land on the wrong bin');
  checks++;
}

console.log('Numeric entry: ' + checks + ' display and commit assertions passed.');
