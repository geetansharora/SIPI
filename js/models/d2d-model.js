/* SI & PI — models/d2d-model.js
 * Chiplet interconnects compared: how much bandwidth a published UCIe or BoW layout
 * puts through each millimetre of die edge, and through each square millimetre of
 * bump field once the bump pitch is taken out.
 *
 * Only layouts a primary source gives the dimensions of are used, each in full,
 * with the bumps for its clocks and optional wires included:
 *   UCIe-S  a 32-lane-per-direction module, 1.143 x 1.54 mm at 110 um (ledger C-76)
 *   UCIe-A  a 64-lane-per-direction module, 0.389 x 1.585 mm at 55 um (C-76)
 *   BoW     the specification's example link, 8 TX and 8 RX slices of 16 data wires,
 *           5.2 x 1.35 mm on laminate at 130 um and 1.60 x 0.42 mm on an interposer
 *           at 40 um, AUX and FEC wires included (C-87)
 * AIB publishes no layout dimensions or shoreline (C-96), so it is reported, not drawn.
 *
 * Bandwidth counts both directions together, the way the UCIe table does (C-76). With
 * the geometry fixed, bandwidth scales with the wire rate; that is exact for these
 * layouts and is what the UCIe table's own 4 GT/s figures confirm. UCIe-S at 48 and
 * 64 GT/s is the exception: its table figures (C-68) are lower than its 32 GT/s module
 * scaled up, so the layout must change there and only the table figure is used.
 *
 * Bump-field density divides by the wire rate and scales with (own pitch / common
 * pitch)^2, since the number of bumps in an area goes as the inverse square of pitch.
 *
 * Pure: no DOM, no state. Requires js/viz-kit.js for K.result.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  NS.models = NS.models || {};

  const RATES = [2, 4, 8, 12, 16, 24, 32, 48, 64];          // Gb/s per wire, every rate either standard defines
  const LAYOUTS = {
    ucieS: { name: 'UCIe-S module', std: 'UCIe', pkg: 'organic', wires: 64, edge: 1.143, depth: 1.54, pitch: 110,
             rates: [4, 8, 12, 16, 24, 32, 48, 64], table: { 48: 278, 64: 370 } },
    ucieA: { name: 'UCIe-A module', std: 'UCIe', pkg: 'interposer', wires: 128, edge: 0.389, depth: 1.585, pitch: 55,
             rates: [4, 8, 12, 16, 24, 32, 48, 64], table: {} },
    bowL:  { name: 'BoW example, laminate', std: 'BoW', pkg: 'organic', wires: 256, edge: 5.2, depth: 1.35, pitch: 130,
             rates: [2, 4, 8, 16, 24, 32], table: {} },
    bowI:  { name: 'BoW example, interposer', std: 'BoW', pkg: 'interposer', wires: 256, edge: 1.60, depth: 0.42, pitch: 40,
             rates: [2, 4, 8, 16, 24, 32], table: {} }
  };
  const KEYS = ['ucieS', 'ucieA', 'bowL', 'bowI'];

  /* GB/s per mm of edge, both directions, at a wire rate; null where the standard has no such rate. */
  function edgeDensity(key, rate) {
    const L = LAYOUTS[key];
    if (!L.rates.includes(rate)) return null;
    if (L.table[rate] !== undefined) return L.table[rate];
    return L.wires * rate / 8 / L.edge;
  }
  /* GB/s per mm^2 of bump field per Gb/s of wire rate, at the layout's own pitch. */
  function areaDensity(key) {
    const L = LAYOUTS[key];
    return L.wires / 8 / (L.edge * L.depth);
  }

  NS.models.d2d = function (p) {
    const ok = p && RATES.includes(p.rate) && Number.isFinite(p.pitch) && p.pitch >= 10 && p.pitch <= 150;
    if (!ok) return K.result({ model: 'd2d', version: '1.0', status: 'unsupported', params: p,
      why: 'The rate must be one of ' + RATES.join(', ') + ' Gb/s per wire and the common pitch 10 to 150 um.' });
    const edge = {}, area = {}, areaAt = {}, curves = {}, lines = {};
    KEYS.forEach((k) => {
      const L = LAYOUTS[k];
      edge[k] = edgeDensity(k, p.rate);
      area[k] = areaDensity(k);
      areaAt[k] = area[k] * Math.pow(L.pitch / p.pitch, 2);
      curves[k] = L.rates.map((r) => [r, edgeDensity(k, r)]);
      lines[k] = [10, 150].map((q) => [q, area[k] * Math.pow(L.pitch / q, 2)]);
    });
    return K.result({
      model: 'd2d', version: '1.0', status: 'ok', params: p,
      units: { rate: 'Gb/s per wire', edge: 'GB/s per mm of edge, both directions', area: 'GB/s per mm2 per Gb/s of wire rate', pitch: 'um' },
      measurements: {
        edge, areaAtCommonPitch: areaAt,
        interposerRatio: areaAt.bowI / areaAt.ucieA,      // same pitch, same wire rate
        organicRatio: areaAt.bowL / areaAt.ucieS,
        aib: null                                          // C-96: no published layout or shoreline
      },
      generated: { curves, lines, layouts: LAYOUTS, keys: KEYS, rates: RATES }
    });
  };
  NS.models.d2d.RATES = RATES;
  NS.models.d2d.LAYOUTS = LAYOUTS;
  NS.models.d2d.edgeDensity = edgeDensity;
  NS.models.d2d.areaDensity = areaDensity;
})();
