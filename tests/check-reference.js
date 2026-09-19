#!/usr/bin/env node
'use strict';
const R = require('../js/reference-tools.js');
let passed = 0;
function exact(name, got, want) {
  if (got !== want) throw new Error(`${name}: got ${got}, want ${want}`);
  passed++;
}
function rejects(name, fn) {
  try { fn(); } catch (e) { if (e instanceof RangeError) { passed++; return; } }
  throw new Error(name + ': expected RangeError');
}

exact('nanofarads to picofarads', R.convert(1, 'n', 'p'), 1000);
exact('milliohms to ohms', R.convert(250, 'm', ''), 0.25);
exact('megahertz to hertz', R.convert(4, 'M', ''), 4000000);
exact('one UI at 8 GT/s', R.uiPs(8), 125);
exact('one UI at 32 GT/s', R.uiPs(32), 31.25);
rejects('zero conversion input', () => R.convert(0, 'n', 'p'));
rejects('negative transfer rate', () => R.uiPs(-8));
rejects('unknown prefix', () => R.convert(1, 'x', 'n'));
rejects('conversion overflow', () => R.convert(1e308, 'G', 'p'));
rejects('conversion underflow', () => R.convert(Number.MIN_VALUE, 'p', 'G'));
rejects('prototype key is not a prefix', () => R.convert(1, 'toString', 'n'));
rejects('unrepresentable UI', () => R.uiPs(Number.MIN_VALUE));
console.log(`ok ${passed} reference helper checks`);
