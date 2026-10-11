/* SI & PI — models/d2d-model.js
 * Chiplet interconnects compared: how much bandwidth published UCIe and BoW layouts
 * put through each millimetre of die edge, and through each square millimetre of
 * bump field once the bump pitch is taken out.
 *
 * Edge view. Only layouts a primary source gives the dimensions of, each in full,
 * with the bumps for its clocks and optional wires included:
 *   UCIe-S  an x32 (two x16 modules), 1.143 x 1.54 mm (ledger C-76)
 *   UCIe-A  an x64 module, 0.389 x 1.585 mm (C-76)
 *   BoW     the specification's example link, 8 TX and 8 RX slices of 16 data wires,
 *           5.2 x 1.35 mm on laminate at 130 um and 1.60 x 0.42 mm on an interposer at
 *           40 um, AUX and FEC wires included (C-87). The two are one layout, scaled.
 * Bandwidth counts both directions together, the way the UCIe table does (C-76), and
 * with the geometry fixed it scales with the wire rate. UCIe-S at 48 and 64 GT/s is
 * the exception: the table (C-68) gives less than its 32 GT/s figure scaled up, so
 * only the table figure is used there. The edge widths and the consortium's shoreline
 * table agree, so the edge view has one value per layout.
 *
 * Bump view. Here the sources disagree, and the model reports the disagreement as a
 * range rather than picking one reading:
 *   - the HOTI slide labels the UCIe-A module "@ 55 um"; the deck says its figures are
 *     for 45 um (C-68). The same rectangle read at 45 um is 33% less dense per bump
 *     area at a common pitch.
 *   - the deck's own areal row (C-100: 22-192 and 188-1646 GB/s/mm2 at 4-32 GT/s, for
 *     110 and 45 um) is about 1.3 times denser than the module rectangles, for both
 *     packages.
 * So UCIe-A's range spans the rectangle at 45 um, the rectangle at 55 um and the
 * deck's row at 45 um; UCIe-S's spans the rectangle and the deck's row, both at
 * 110 um. BoW has one layout and one value. AIB publishes no layout (C-96).
 *
 * Density per bump area is divided by the wire rate and moved to a common pitch with
 * (own pitch / common pitch)^2, since bumps per area go as the inverse square of pitch.
 * That assumes the same bump arrangement, and the same circuits still fitting, at the
 * new pitch.
 *
 * Pure: no DOM, no state. Requires js/viz-kit.js for K.result.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  NS.models = NS.models || {};

  const RATES = [2, 4, 8, 12, 16, 24, 32, 48, 64];          // Gb/s per wire, every rate either standard defines
  const LAYOUTS = {
    ucieS: { name: 'UCIe-S x32', std: 'UCIe', pkg: 'organic', wires: 64, edge: 1.143, depth: 1.54,
             rates: [4, 8, 12, 16, 24, 32, 48, 64], table: { 48: 278, 64: 370 } },
    ucieA: { name: 'UCIe-A x64 module', std: 'UCIe', pkg: 'interposer', wires: 128, edge: 0.389, depth: 1.585,
             rates: [4, 8, 12, 16, 24, 32, 48, 64], table: {} },
    bowL:  { name: 'BoW example, laminate', std: 'BoW', pkg: 'organic', wires: 256, edge: 5.2, depth: 1.35,
             rates: [2, 4, 8, 16, 24, 32], table: {} },
    bowI:  { name: 'BoW example, interposer', std: 'BoW', pkg: 'interposer', wires: 256, edge: 1.60, depth: 0.42,
             rates: [2, 4, 8, 16, 24, 32], table: {} }
  };
  const KEYS = ['ucieS', 'ucieA', 'bowL', 'bowI'];

  /* The readings of each layout's bump-field density, in GB/s per mm2 per Gb/s of wire
     rate, each at the pitch its source states. */
  const rect = (k) => LAYOUTS[k].wires / 8 / (LAYOUTS[k].edge * LAYOUTS[k].depth);
  const READINGS = {
    ucieS: [{ src: 'x32 rectangle (C-76)', d: rect('ucieS'), pitch: 110 },
            { src: 'consortium areal row (C-100)', d: 192 / 32, pitch: 110 }],
    ucieA: [{ src: 'x64 rectangle read at 45 um (C-68)', d: rect('ucieA'), pitch: 45 },
            { src: 'x64 rectangle at its labelled 55 um (C-76)', d: rect('ucieA'), pitch: 55 },
            { src: 'consortium areal row (C-100)', d: 1646 / 32, pitch: 45 }],
    bowL:  [{ src: 'example link (C-87)', d: rect('bowL'), pitch: 130 }],
    bowI:  [{ src: 'example link (C-87)', d: rect('bowI'), pitch: 40 }]
  };

  /* GB/s per mm of edge, both directions, at a wire rate; null where the standard has no such rate. */
  function edgeDensity(key, rate) {
    const L = LAYOUTS[key];
    if (!L.rates.includes(rate)) return null;
    if (L.table[rate] !== undefined) return L.table[rate];
    return L.wires * rate / 8 / L.edge;
  }
  /* Every reading of a layout's bump density moved to a common pitch, and its range. */
  function areaAt(key, pitch) {
    const v = READINGS[key].map((r) => r.d * Math.pow(r.pitch / pitch, 2));
    return { values: v, lo: Math.min(...v), hi: Math.max(...v) };
  }

  NS.models.d2d = function (p) {
    const ok = p && RATES.includes(p.rate) && Number.isFinite(p.pitch) && p.pitch >= 10 && p.pitch <= 150;
    if (!ok) return K.result({ model: 'd2d', version: '1.1', status: 'unsupported', params: p,
      why: 'The rate must be one of ' + RATES.join(', ') + ' Gb/s per wire and the common pitch 10 to 150 um.' });
    const edge = {}, area = {}, curves = {}, bands = {};
    KEYS.forEach((k) => {
      edge[k] = edgeDensity(k, p.rate);
      area[k] = areaAt(k, p.pitch);
      curves[k] = LAYOUTS[k].rates.map((r) => [r, edgeDensity(k, r)]);
      bands[k] = [10, 150].map((q) => { const a = areaAt(k, q); return [q, a.lo, a.hi]; });
    });
    const bow = area.bowI.lo;
    return K.result({
      model: 'd2d', version: '1.1', status: 'ok', params: p,
      units: { rate: 'Gb/s per wire', edge: 'GB/s per mm of edge, both directions', area: 'GB/s per mm2 per Gb/s of wire rate', pitch: 'um' },
      measurements: {
        edge, area,
        ucieAVsBow: [area.ucieA.lo / bow, area.ucieA.hi / bow],       // the range, against BoW's one layout
        ucieSVsBow: [area.ucieS.lo / area.bowL.lo, area.ucieS.hi / area.bowL.lo],
        depthRatio: LAYOUTS.ucieA.depth / LAYOUTS.bowI.depth,
        aib: null                                                     // C-96: no published layout or shoreline
      },
      generated: { curves, bands, layouts: LAYOUTS, readings: READINGS, keys: KEYS, rates: RATES }
    });
  };
  NS.models.d2d.RATES = RATES;
  NS.models.d2d.LAYOUTS = LAYOUTS;
  NS.models.d2d.READINGS = READINGS;
  NS.models.d2d.edgeDensity = edgeDensity;
  NS.models.d2d.areaAt = areaAt;
})();
