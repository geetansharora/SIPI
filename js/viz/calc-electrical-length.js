/* SIPI — viz/calc-electrical-length.js
 * Is this trace a transmission line? Delay per inch, round trip, and the
 * critical length -- by the same 2·Td > tr/3 rule the topic page uses.
 * Maths: js/models/calc-models.js (C.elen). Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const inch = (x) => (x < 10 ? x.toPrecision(3) : x.toFixed(1)) + ' in (' + (x * 25.4).toPrecision(3) + ' mm)';

  NS.viz.calcElectricalLength = function (root) {
    return K.calc(root, {
      inputs: [
        { id: 'len', label: 'Trace length', kind: 'length', unit: 'in', base: 0.0254, dp: 2,
          min: 0.05, max: 40, log: true, def: 3, positive: true },
        { id: 'tr', label: 'Rise time t<sub>r</sub>', kind: 'si', unit: 's', min: 1e-12, max: 1e-8, log: true,
          def: 100e-12, positive: true },
        { id: 'dk', label: 'Effective Dk', kind: 'plain', dp: 2, min: 1, max: 10, def: 3.8, lo: 1,
          hint: 'Stripline: the laminate Dk. Microstrip: lower, part of the field is in air.' }
      ],
      compute: (v) => M.elen(v.len, v.tr, v.dk),
      outputs: (r) => [
        { k: 'Delay t<sub>pd</sub>', v: (r.tpd * 1e12).toFixed(1) + ' ps/in' },
        { k: 'One way T<sub>d</sub>', v: K.si(r.td, 's') },
        { k: 'Round trip 2T<sub>d</sub>', v: K.si(r.round, 's') },
        { k: 't<sub>r</sub> / 3', v: K.si(r.third, 's') },
        { k: 'Critical length', v: inch(r.lcrit) },
        { k: 'Length ÷ critical', v: r.ratio.toPrecision(3) + '×' },
        { k: 'Verdict', tone: r.long ? 'alarm' : 'ok', v: r.long ? 'Transmission line' : 'Lumped' }
      ],
      chart: {
        draw(s, T, v, r) {
          const xMax = Math.max(2 * v.len, 2.5 * r.lcrit);
          const P = K.plot(s, T, {
            pad: { l: 58, r: 16, t: 20, b: 32 },
            x: { min: 0, max: xMax, count: 5, fmt: (x) => (x < 10 ? x.toPrecision(2) : x.toFixed(0)), title: 'length, in' },
            y: { min: 0, max: Math.max(2 * r.tpd * xMax, r.third * 1.3), count: 5,
                 fmt: (y) => K.si(y, 's', 2), title: 'time' }
          }).grid();
          K.shadeX(P, r.lcrit, xMax, K.rgba(T.alarm, 0.07));
          P.trace([[0, 0], [xMax, 2 * r.tpd * xMax]], T.signal, { width: 2.2, label: 'round trip', unit: 's' });
          P.hline(r.third, T.reflect, [4, 4], 'tᵣ/3');
          P.vline(r.lcrit, T.ink2, [3, 4], 'critical ' + r.lcrit.toPrecision(2) + ' in');
          K.dot(s.ctx, P.X(v.len), P.Y(r.round), r.long ? T.alarm : T.signal, true);
          P.frame();
          return [{ label: 'round trip 2Td', colour: T.signal },
                  { label: 'tᵣ/3', colour: T.reflect, dash: true },
                  { label: 'transmission-line region', colour: K.rgba(T.alarm, 0.35) }];
        }
      }
    });
  };
})();
