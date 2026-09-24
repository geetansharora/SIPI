/* SIPI — models/laminates.js
 * Laminate Dk and Df as the manufacturers publish them, for the calculators'
 * Laminate preset. Data, not physics: every number below is copied from the
 * cited document, for the construction named, and nothing is rounded or derived.
 *
 * A laminate's Dk and Df depend on frequency, on the glass-and-resin
 * construction and on the test method, so each record carries all three.
 * Points measured by different methods sit in separate series, and `at()`
 * interpolates only inside one series: joining a 1 GHz split-post value to a
 * 13 GHz disk-resonator value with a line would state a number neither
 * method measured. Outside every series it returns the nearest tabulated
 * point, unchanged, and says so. All values are typical, not guaranteed.
 *
 * No DOM; runs under Node for check-models.js.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });

  const IPC_2559 = 'IPC-TM-650 2.5.5.9';
  const IPC_2555 = 'IPC-TM-650 2.5.5.5';
  const IEC_63185 = 'balanced-type circular disk resonator, IEC 63185 (2020)';

  /* `group` is the heading the select files a laminate under. */
  const LIST = [
    /* Shengyi's "conventional FR-4", Tg 140 °C, the standard material at the
       low-cost board houses. Its data sheet gives one GHz point, measured on a
       glass-heavy 7628 board; a resin-rich thin core runs higher in Dk and Df. */
    { id: 'shengyi-s1141', name: 'Shengyi S1141', group: 'FR-4', vendor: 'Shengyi',
      product: 'S1141, conventional FR-4, Tg 140 °C',
      construction: 'standard FR-4, Tg 140 °C; 1.6 mm board of 8×7628 glass (glass-heavy)',
      doc: 'Shengyi S1141 technical data sheet', date: '2021-01-19',
      url: 'https://www.syst.com.cn/ajax/download.aspx?name=2021/01/20210119183954576.pdf',
      series: [{ method: IPC_2559, pts: [[1e9, 4.4, 0.013]] }] },
    { id: 'isola-370hr', name: 'Isola 370HR', group: 'FR-4', vendor: 'Isola', product: '370HR',
      construction: 'high-Tg FR-4; core, 1×2116, 51 % resin',
      doc: 'Isola 370HR Dk/Df tables, Revision C', date: '2020-03-16',
      url: 'https://www.isola-group.com/wp-content/uploads/data-sheets/370HR__Dk_Df_Tables.pdf',
      series: [{ method: 'not stated in the table', pts: [
        [100e6, 4.24, 0.015], [500e6, 4.19, 0.017], [1e9, 4.17, 0.019],
        [2e9, 4.14, 0.020], [5e9, 4.03, 0.023], [10e9, 4.03, 0.023]] }] },
    { id: 'megtron4', name: 'Panasonic MEGTRON 4', group: 'Low loss', vendor: 'Panasonic', product: 'MEGTRON 4 R-5725',
      construction: 'core, 2116×1, 56 % resin',
      doc: 'Panasonic data sheet No. 22040132', date: '2022-04',
      url: 'https://industrial.panasonic.com/content/data/EM/PDF/ipcdatasheet_R-5725_new.pdf',
      series: [
        { method: IPC_2559, pts: [[1e6, 3.93, 0.005], [100e6, 3.88, 0.005], [1e9, 3.86, 0.005]] },
        { method: IPC_2555, pts: [[2e9, 3.85, 0.006], [4e9, 3.85, 0.006], [6e9, 3.84, 0.006],
                                  [8e9, 3.83, 0.007], [10e9, 3.83, 0.007]] },
        { method: IEC_63185, pts: [[13e9, 3.68, 0.0074], [23e9, 3.68, 0.0078], [34e9, 3.68, 0.0083],
                                   [45e9, 3.68, 0.0087], [55e9, 3.68, 0.0091]] }] },
    { id: 'megtron6n', name: 'Panasonic MEGTRON 6 (N)', group: 'Low loss', vendor: 'Panasonic',
      product: 'MEGTRON 6 R-5775(N), low-Dk glass',
      construction: 'core, 2116, 56 % resin',
      doc: 'Panasonic data sheet No. 22040130', date: '2022-04',
      url: 'https://industrial.panasonic.com/content/data/EM/PDF/CDS_MEGTRON6_R-5775(N)_220401.pdf',
      series: [
        { method: IPC_2559, pts: [[1e9, 3.40, 0.002]] },
        { method: IEC_63185, pts: [[13e9, 3.34, 0.0037], [24e9, 3.34, 0.0040], [36e9, 3.34, 0.0042],
                                   [47e9, 3.34, 0.0044], [58e9, 3.34, 0.0046]] }] },
    { id: 'megtron7ge', name: 'Panasonic MEGTRON 7 (GE)', group: 'Low loss', vendor: 'Panasonic',
      product: 'MEGTRON 7 R-5785(GE), E glass',
      construction: 'core, 2116×1, 53 % resin',
      doc: 'Panasonic data sheet No. 22040128', date: '2022-04',
      url: 'https://industrial.panasonic.com/cdbs/www-data/pdf/EMB0000/ast-ind-232633.pdf',
      series: [
        { method: IPC_2559, pts: [[1e9, 3.63, 0.002]] },
        { method: IEC_63185, pts: [[13e9, 3.60, 0.0034], [24e9, 3.60, 0.0037], [36e9, 3.60, 0.0041],
                                   [47e9, 3.60, 0.0045], [58e9, 3.60, 0.0049]] }] },
    { id: 'megtron7gn', name: 'Panasonic MEGTRON 7 (GN)', group: 'Low loss', vendor: 'Panasonic',
      product: 'MEGTRON 7 R-5785(GN), low-Dk glass',
      construction: 'core, 2116, 55 % resin',
      doc: 'Panasonic data sheet No. 22040128', date: '2022-04',
      url: 'https://industrial.panasonic.com/cdbs/www-data/pdf/EMB0000/ast-ind-232633.pdf',
      series: [
        { method: IPC_2559, pts: [[1e9, 3.37, 0.001]] },
        { method: IEC_63185, pts: [[14e9, 3.31, 0.0023], [25e9, 3.31, 0.0025], [36e9, 3.31, 0.0028],
                                   [48e9, 3.31, 0.0030], [59e9, 3.31, 0.0033]] }] },
    /* Rogers publishes two Dk values. 3.48 ± 0.05 is the process Dk, a quality-
       control figure; the data sheet directs circuit designers to the design Dk. */
    { id: 'ro4350b', name: 'Rogers RO4350B', group: 'Low loss', vendor: 'Rogers', product: 'RO4350B',
      construction: 'laminate (design Dk, not the 3.48 process Dk)',
      doc: 'Rogers RO4350B product page (undated; read 2026-09-24)', date: null,
      url: 'https://www.rogerscorp.com/advanced-electronics-solutions/ro4000-series-laminates/ro4350b-laminates',
      series: [{ method: 'design Dk; Df by ' + IPC_2555, pts: [[10e9, 3.66, 0.0037]] }] }
  ];

  const byId = {};
  LIST.forEach((m) => { byId[m.id] = m; });

  /* Dk and Df of laminate `id` at frequency f (Hz).
     -> { dk, df, f, method, exact, clamped } where f is the frequency the values
     belong to: f itself when interpolated or tabulated, else the point used. */
  function at(id, f) {
    const m = byId[id];
    if (!m) return null;
    const lf = Math.log(f);
    for (const s of m.series) {
      const p = s.pts;
      if (f < p[0][0] || f > p[p.length - 1][0]) continue;
      for (let i = 0; i < p.length; i++) {
        if (p[i][0] === f) return { dk: p[i][1], df: p[i][2], f, method: s.method, exact: true, clamped: false };
      }
      let i = 0;
      while (i < p.length - 2 && p[i + 1][0] < f) i++;
      const a = p[i], b = p[i + 1];
      const u = (lf - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
      return { dk: a[1] + u * (b[1] - a[1]), df: a[2] + u * (b[2] - a[2]), f,
               method: s.method, exact: false, clamped: false };
    }
    let best = null, gap = Infinity;
    m.series.forEach((s) => s.pts.forEach((q) => {
      const d = Math.abs(Math.log(q[0]) - lf);
      if (d < gap) { gap = d; best = { dk: q[1], df: q[2], f: q[0], method: s.method, exact: true, clamped: true }; }
    }));
    return best;
  }

  NS.laminates = { list: LIST, byId, at, REF_HZ: 10e9 };
})();
