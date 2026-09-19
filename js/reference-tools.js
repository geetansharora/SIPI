/* SI & PI reference helpers. Pure conversions first; the DOM is only a view. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SIPIReference = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const EXPONENT = { p: -12, n: -9, u: -6, m: -3, '': 0, k: 3, M: 6, G: 9 };

  function positive(value, name) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new RangeError((name || 'value') + ' must be positive');
    return n;
  }
  function convert(value, from, to) {
    const n = positive(value);
    if (!Object.prototype.hasOwnProperty.call(EXPONENT, from) || !Object.prototype.hasOwnProperty.call(EXPONENT, to)) throw new RangeError('unknown SI prefix');
    return positive(n * Math.pow(10, EXPONENT[from] - EXPONENT[to]), 'converted value');
  }
  function uiPs(rateGtPerSecond) {
    return positive(1000 / positive(rateGtPerSecond, 'transfer rate'), 'unit interval');
  }
  function fmt(n) { return Number(n.toPrecision(8)).toString(); }

  function mount(doc) {
    const form = doc.querySelector('[data-reference-tools]');
    if (!form) return;
    const value = form.querySelector('#prefix-value');
    const from = form.querySelector('#prefix-from');
    const to = form.querySelector('#prefix-to');
    const converted = form.querySelector('#prefix-result');
    const rate = form.querySelector('#ui-rate');
    const ui = form.querySelector('#ui-result');
    function updatePrefix() {
      try { converted.textContent = fmt(convert(value.value, from.value, to.value)); }
      catch (_) { converted.textContent = 'Enter a positive value with a finite, non-zero converted result.'; }
    }
    function updateUi() {
      try { ui.textContent = fmt(uiPs(rate.value)) + ' ps'; }
      catch (_) { ui.textContent = 'Enter a positive transfer rate with a finite unit interval.'; }
    }
    [value, from, to].forEach((el) => el.addEventListener('input', updatePrefix));
    rate.addEventListener('input', updateUi);
    updatePrefix(); updateUi();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(document));
    else mount(document);
  }
  return { convert, uiPs };
});
