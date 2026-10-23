#!/usr/bin/env python3
"""Recompute the derivable numbers on the site and check the prose states them.

Most numbers here are arithmetic, not opinion: propagation delay from Dk, skin
depth from frequency, a unit interval from a data rate, a stub resonance from its
length. Each entry below computes the value from first principles, then asserts
the page actually says it.

This exists because four wrong claims were found only on the pages that happened
to have an exact interactive model checking them. Twenty-nine pages have no model;
this gives them the same protection, and protects every page against future edits.

    python3 check-numbers.py            # report
    python3 check-numbers.py -v         # include passes

To add a claim: page, one-line description, a lambda-free computed value, and a
regex with ONE capture group matching the number as the page states it. Patterns
run against normalised text (see page_text) so superscripts and middle dots are
already flattened.
"""
import math
import re
import sys
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).parent

# characters HTML stripping leaves behind, flattened so patterns stay readable
SUPERSCRIPTS = str.maketrans(
    "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207b",
    "0123456789-")
REPLACEMENTS = [
    ("\u2212", "-"),   ("\u00a0", " "), ("\u202f", " "), ("\u2009", " "),
    ("\u00b5", "u"),   ("\u03bc", "u"), ("\u2013", "-"), ("\u2014", " - "),
    ("\u03a9", "ohm"), ("\u00b7", "."), ("\u2248", "~"), ("\u00d7", "x"),
    ("\u03c3", "s"),   ("\u0393", "G"), ("\u2192", "->"),
]


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.buf, self.skip, self.injson = [], 0, False

    def handle_starttag(self, tag, attrs):
        # A guided-mode step is prose a reader is shown; it just happens to be
        # delivered as JSON. Skipping every <script> put those numbers outside
        # this gate entirely, which is exactly where a wrong one hides.
        if tag == "script" and dict(attrs).get("type") == "application/json":
            self.injson = True
            return
        self.skip += tag in ("script", "style")

    def handle_endtag(self, tag):
        if tag == "script" and self.injson:
            self.injson = False
            return
        self.skip -= tag in ("script", "style")

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)


def page_text(rel):
    html = (ROOT / "topics" / (rel + ".html")).read_text(encoding="utf-8")
    body = html.split("<main>")[1].split("</main>")[0]
    p = Text()
    p.feed(body)
    t = " ".join(p.buf).translate(SUPERSCRIPTS)
    for a, b in REPLACEMENTS:
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


# ---------- the physics, stated once ----------
def tpd(dk):
    """Propagation delay, ps per inch."""
    return 84.72 * math.sqrt(dk)


def skin(f_ghz):
    """Copper skin depth, um."""
    return 2.06 / math.sqrt(f_ghz)


def diel(f_ghz, df, dk):
    """Dielectric loss, dB per inch."""
    return 2.3 * f_ghz * df * math.sqrt(dk)


def preset(ps_db, de_db):
    """PCIe 3-tap transmitter preset from its preshoot and de-emphasis (dB).

    Taps scaled to full swing, |c-1| + c0 + |c+1| = 1, outer taps negative. With
    a = |c-1| and b = |c+1|: Vd = 1 (a lone bit), Va = 1 - 2a, Vb = 1 - 2a - 2b,
    Vc = 1 - 2b; de-emphasis = 20 log(Vb/Va), preshoot = 20 log(Vc/Vb).
    Returns (a, b, Vb, boost_dB)."""
    r1, r2 = 10 ** (de_db / 20), 10 ** (ps_db / 20)
    m = [[2 * r1 - 2, -2], [2 * r2, 2 * r2 - 2]]
    y = [r1 - 1, r2 - 1]
    det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
    a = (y[0] * m[1][1] - m[0][1] * y[1]) / det
    b = (m[0][0] * y[1] - y[0] * m[1][0]) / det
    vb = 1 - 2 * a - 2 * b
    return a, b, vb, 20 * math.log10(1 / vb)


def stub(mil, dk):
    """Quarter-wave via stub resonance, GHz."""
    return 2950 / (mil * math.sqrt(dk))


def srf(c_f, l_h):
    """Self-resonant frequency, Hz."""
    return 1 / (2 * math.pi * math.sqrt(c_f * l_h))


def ui_ps(rate_per_s):
    """Unit interval, ps."""
    return 1e12 / rate_per_s


def qinv(ber):
    """The Q value a bit error rate demands (dual-Dirac)."""
    def Q(x):
        if x < 3:
            return 0.5 * math.erfc(x / math.sqrt(2))
        i = 1 / (x * x)
        return math.exp(-x * x / 2) / (x * math.sqrt(2 * math.pi)) * (1 - i + 3 * i * i)
    lo, hi = 0.0, 12.0
    for _ in range(90):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if Q(mid) > ber else (lo, mid)
    return (lo + hi) / 2


def plane_mode(a_mm, b_mm, dk, m=1, n=0):
    """Rectangular cavity mode, MHz."""
    v = 299.792458 / math.sqrt(dk)
    return (v / 2) * math.sqrt((m / a_mm) ** 2 + (n / b_mm) ** 2) * 1000


def lorentz_frac(a):
    """Fraction of return current within +/- a*h of the trace centreline."""
    return 2 * math.atan(a) / math.pi * 100


def _via_loop(l_mm, r_mm, s_mm):
    """Exact external inductance of two parallel round conductors, in nH.
    L = l * (mu0/pi) * acosh(s / 2r). No thin-wire approximation."""
    if s_mm <= 2 * r_mm:
        raise ValueError("barrels intersect")
    return l_mm * 1e-3 * 4e-7 * math.acosh(s_mm / (2 * r_mm)) * 1e9


_RC_L = _via_loop(1.6, 0.15, 1.0) * 1e-9 + 600e-12   # mount + declared part ESL


def _rc_z(f, c_f, l_h, esr_min=3e-3, f_esr=2e6):
    """|Z| of one mounted capacitor. The ESR uses the closed form the panel's
    two-term expression collapses to at p = 1/2, so this is a second path to the
    same quantity rather than a transcription of the first."""
    w = 2 * math.pi * f
    r = esr_min * math.cosh(math.log(f / f_esr) / 2)
    x = w * l_h - 1 / (w * c_f)
    return math.hypot(r, x)


def _rc_extreme(c_m, c_d, l_h, lo, hi, sign):
    """Golden-section on log f for the extremum of the derated/marked ratio."""
    g = (math.sqrt(5) - 1) / 2
    a, b = math.log(lo), math.log(hi)
    ratio = lambda f: _rc_z(f, c_d, l_h) / _rc_z(f, c_m, l_h)
    for _ in range(200):
        c, d = b - g * (b - a), a + g * (b - a)
        if sign * ratio(math.exp(c)) > sign * ratio(math.exp(d)):
            b = d
        else:
            a = c
    return math.exp((a + b) / 2)


def _rc_cross(c_m, c_d, l_h, lo, hi):
    """Bisection for where the derated and marked curves cross."""
    ratio = lambda f: _rc_z(f, c_d, l_h) / _rc_z(f, c_m, l_h)
    a, b = lo, hi
    for _ in range(200):
        m = math.sqrt(a * b)
        if (ratio(m) - 1) * (ratio(a) - 1) > 0:
            a = m
        else:
            b = m
    return math.sqrt(a * b)


def _rt_ratio(shape):
    """(t20-80)/(t10-90) for a named edge shape. Closed forms, not fits:
    a linear ramp is 0.6/0.8, a single-pole exponential is ln(4)/ln(9), and a
    Gaussian cumulative is the ratio of normal quantiles."""
    if shape == "ramp":
        return 0.6 / 0.8
    if shape == "expo":
        return math.log(4) / math.log(9)
    if shape == "gauss":
        z = lambda p: math.sqrt(2) * _erfinv(2 * p - 1)
        return (z(0.8) - z(0.2)) / (z(0.9) - z(0.1))
    raise ValueError(shape)


def _erfinv(y):
    lo, hi = -6.0, 6.0
    for _ in range(300):
        mid = (lo + hi) / 2
        if math.erf(mid) < y:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _ramp_dip(tau, tr, step=0.01e-12):
    """A shunt-C dip seen through a 0-100 % ramp edge: (depth, width at half depth).
    Closed-form depth; the width is found by stepping the closed-form waveform."""
    depth = (tau / tr) * (1 - math.exp(-tr / tau))
    def r(t):
        return (tau / tr) * (1 - math.exp(-t / tau)) if t < tr else (tau / tr) * (math.exp(tr / tau) - 1) * math.exp(-t / tau)
    ts = [i * step for i in range(int(20 * tau / step))]
    half = [t for t in ts if r(t) >= depth / 2]
    return depth, half[-1] - half[0]


def _shunt_err(target):
    """|Z| at which Z0*S21/2 departs from Z0*S21/[2(1-S21)] by `target`.
    Bisected rather than solved, because the inverse has no tidy closed form."""
    Z0 = 50.0
    lo, hi = 1e-9, 0.9
    for _ in range(300):
        mid = (lo + hi) / 2
        exact = Z0 * mid / (2 * (1 - mid))
        approx = Z0 * mid / 2
        if abs(approx - exact) / exact < target:
            lo = mid
        else:
            hi = mid
    s = (lo + hi) / 2
    return Z0 * s / (2 * (1 - s))


F = "fundamentals"
P = "power-integrity"
S = "signal-integrity"
I = "interfaces"
LAB = "labs"
G = "groundwork"
M = "methodology"
T = "tools"

#          page, description, computed value, pattern with one group, tolerance %
CLAIMS = [

    # ── Figures ─────────────────────────────────────────────────────────────
    # Numbers drawn on, or captioned under, the Batch 1 figures.
    (M + "/measurement-practice", "probe resonance, 20 nH clip lead with 5 pF tip, MHz",
     1 / (2 * math.pi * math.sqrt(20e-9 * 5e-12)) / 1e6, r"rings near (\d+) MHz", 0.2),
    (M + "/measurement-practice", "probe resonance, 2 nH spring with 5 pF tip, GHz",
     1 / (2 * math.pi * math.sqrt(2e-9 * 5e-12)) / 1e9, r"rings near ([\d.]+) GHz", 0.2),
    (M + "/measurement-practice", "TDR resolution, 20 ps edge at 0.15 mm/ps, mm",
     20 * 0.15 / 2, r"20 ps step resolves [^=]*= ([\d.]+) mm", 0.1),
    (M + "/measurement-practice", "TDR resolution, 100 ps edge at 0.15 mm/ps, mm",
     100 * 0.15 / 2, r"100 ps step resolves ([\d.]+) mm", 0.1),
    (G + "/units-and-conventions", "RMS of a sine as a fraction of its peak",
     1 / math.sqrt(2), r"RMS = ([\d.]+) x peak", 0.1),
    (G + "/units-and-conventions", "two sigma-1 Gaussians convolved: sigma",
     math.sqrt(2), r"combine into a Gaussian of s = .2 = ([\d.]+)", 0.5),

    # ── Capacitive and inductive coupling ───────────────────────────────────
    # First principles only: i = C dV/dt, v = M dI/dt, a capacitive divider, and
    # a linear edge that covers its swing in t_r / 0.8.
    (F + "/capacitive-inductive-coupling", "crossover Z* = M/(Cm R_L), 1 nH, 0.5 pF, 50 ohm",
     1e-9 / (0.5e-12 * 50), r"50 ohm load give Z\* = (\d+) ohm", 0.01),
    (F + "/capacitive-inductive-coupling", "dV/dt of a 3.3 V, 1 ns (10-90) edge, V/ns",
     3.3 / (1e-9 / 0.8) / 1e9, r"1 ns edge slews ([\d.]+) V/ns", 0.1),
    (F + "/capacitive-inductive-coupling", "edge current into 10 pF at that slew, mA",
     10e-12 * 3.3 / (1e-9 / 0.8) * 1e3, r"into 10 pF it\s+draws ([\d.]+) mA", 0.1),
    (F + "/capacitive-inductive-coupling", "divider 0.5 pF into 5 pF, %",
     100 * 0.5 / 5.5, r"into a 5 pF node that is ([\d.]+)%", 0.2),
    (F + "/capacitive-inductive-coupling", "plateau: 3.3 V times the divider, mV",
     3.3 * 0.5 / 5.5 * 1e3, r"lift the victim by at most (\d+) mV", 0.2),
    (F + "/capacitive-inductive-coupling", "victim corner, 10 kohm and 5.5 pF, MHz",
     1 / (2 * math.pi * 10e3 * 5.5e-12) / 1e6, r"which is only ([\d.]+) MHz for a 10 kohm node", 0.2),
    (F + "/capacitive-inductive-coupling", "first-derivative bound for 4x faster edges, dB",
     10 * math.log10(4), r"Four times\s+faster is 10.log 4 = ([\d.]+) dB", 0.05),
    (F + "/capacitive-inductive-coupling", "second-derivative bound for 4x faster edges, dB",
     20 * math.log10(4), r"Four times faster is 20.log 4 = ([\d.]+) dB", 0.05),
    (F + "/capacitive-inductive-coupling", "regulator loop dI/dt: 3 A in a 5 ns (10-90) edge, A/ns",
     3 / (5e-9 / 0.8) / 1e9, r"5 ns edge moves ([\d.]+) A/ns", 0.1),
    (F + "/capacitive-inductive-coupling", "M dI/dt through 1 nH at that slew, mV",
     1e-9 * 3 / (5e-9 / 0.8) * 1e3, r"through 1 nH of mutual inductance that is (\d+) mV", 0.1),

    # ── Calculators ─────────────────────────────────────────────────────────
    # The numbers the calculator pages state in prose. Each value is computed
    # here from first principles -- c, mu0, the copper resistivity and the
    # Gaussian tail -- rather than from the rounded helpers above, so a helper
    # constant cannot vouch for itself.
    (T + "/return-loss-vswr", "|gamma| at 20 dB return loss",
     10 ** (-20 / 20), r"20 dB means \|G\| = (\d+\.\d+)", 0.01),
    (T + "/return-loss-vswr", "reflected power at 20 dB return loss (%)",
     100 * (10 ** (-20 / 20)) ** 2, r"and ([\d.]+)% of the power", 0.01),
    (T + "/ber-q-jitter", "eye cost of 1 ps RMS jitter at 1e-12 (ps)",
     2 * qinv(1e-12), r"costs about ([\d.]+) ps of eye", 1.0),
    (T + "/ber-q-jitter", "2Q at 1e-12, transition density 1",
     2 * qinv(1e-12), r"that is 2Q = (\d+\.\d+)", 0.05),
    (T + "/ber-q-jitter", "Q_BER at 1e-12, transition density 1",
     qinv(1e-12), r"Q_BER = (\d+\.\d+)", 0.1),
    (T + "/bit-rate-ui-nyquist", "single-pole f3dB x tr(10-90) = ln9/2pi",
     math.log(9) / (2 * math.pi), r"the ([\d.]+) is 2\.2/2π", 0.2),
    (T + "/bit-rate-ui-nyquist", "Gaussian-edge f3dB x tr(10-90)",
     math.sqrt(math.log(2)) / (2 * math.pi) * 2 * 1.2815515655446004,
     r"a Gaussian edge gives ([\d.]+)", 0.5),
    (T + "/electrical-length", "vacuum delay per inch (ps)",
     1e12 * 0.0254 / 299792458, r"covers an inch in ([\d.]+) ps", 0.05),
    (T + "/electrical-length", "critical length, 100 ps edge at Dk 3.8 (in)",
     100e-12 / (6 * 0.0254 / 299792458 * math.sqrt(3.8)),
     r"longer than about ([\d.]+) in at Dk 3\.8", 2.0),
    (T + "/via-stub-resonance", "quarter-wave constant (GHz x mil)",
     299792458 / (4 * 25.4e-6) / 1e9, r"~ (\d+) / \(", 0.05),
    (T + "/skin-depth", "copper skin depth at 1 GHz (um)",
     math.sqrt(1.68e-8 / (math.pi * 1e9 * 4e-7 * math.pi)) * 1e6,
     r"skin depth is (\d+\.\d+) um at 1 GHz", 0.5),
    (T + "/skin-depth", "copper skin depth at 60 Hz (mm)",
     math.sqrt(1.68e-8 / (math.pi * 60 * 4e-7 * math.pi)) * 1e3,
     r"textbook ([\d.]+) mm at 60 Hz", 1.0),
    (T + "/loss-budget", "dielectric loss constant (dB/in per GHz)",
     20 / math.log(10) * math.pi * 1e9 / (299792458 / 0.0254),
     r"dielectric loss is (\d+\.\d+)\.f", 1.0),

    # ── Lab D · ADC interference ────────────────────────────────────────────
    # The closed-form group of this page: folds, beats, quantization limits, the
    # trapezoid's fundamental, sinc-cubed nulls and kT/C. Every one is arithmetic
    # from a stated formula, so it belongs here rather than in a simulation
    # regression. Each anchor below was checked to match exactly once on the page
    # and to capture the number it names — an anchor that matches a second
    # sentence beginning with the same digits would pass for the wrong reason. One
    # entry was dropped for exactly that: the only anchor for the ideal 16-bit SNR
    # one dB below full scale landed on a simulated SINAD that happens to round to
    # the same 97.1 dB, so it would have passed whatever the arithmetic said.
    # Six further closed forms have no unique anchor in the prose, or appear only
    # in the guide JSON; those stay in tests/check-adc-integration.js with the
    # simulated values, and nothing is checked in both places.
    (LAB + "/adc-interference", "fold of 4.1273 MHz at 1 MS/s",
     127.3, r"ly like ([\d,.]+) kHz", 0.041),
    (LAB + "/adc-interference", "locked offset, -60 dB of a 1.8 V swing",
     0.9, r" phase: ([\d,.]+) mV", 0.583),
    (LAB + "/adc-interference", "that offset in 16-bit +/-2.5 V LSBs",
     11.796479999999999, r" mV, or ([\d,.]+) LSB", 0.445),
    (LAB + "/adc-interference", "20 ppm of 1 MHz: the GPIO beat",
     20, r"eats at ([\d,.]+) Hz", 2.625),
    (LAB + "/adc-interference", "the SAR record length",
     65.536, r"e lab's ([\d,.]+) ms record", 0.08),
    (LAB + "/adc-interference", "20 ppm of 50 Hz",
     1, r"ff sits ([\d,.]+) mHz from its ", 52.5),
    (LAB + "/adc-interference", "harmonic corner, 1 ns 10-90%",
     254.64790894703256, r"ond it: ([\d,.]+) MHz for 1 ns", 0.206),
    (LAB + "/adc-interference", "harmonic corner, 10 ns 10-90%",
     25.464790894703256, r"r 1 ns, ([\d,.]+) MHz for 10 ns", 2.062),
    (LAB + "/adc-interference", "rise/fall limit at 1 MHz",
     200.00000000000003, r": up to ([\d,.]+) ns at 1 MHz", 0.262),
    (LAB + "/adc-interference", "rise/fall limit at 100 MHz",
     2, r" 1 MHz, ([\d,.]+) ns at 100 MHz", 26.25),
    (LAB + "/adc-interference", "sideband step when the input halves",
     6.020599913279624, r" SNR is ([\d,.]+) dB", 0.087),
    (LAB + "/adc-interference", "sinc-cubed rejection of a 51 Hz sine",
     102.86724728743087, r"cted by ([\d,.]+) dB", 0.51),
    (LAB + "/adc-interference", "sinc-cubed rejection of a 55 Hz sine",
     74.23096602443638, r"by only ([\d,.]+) dB", 0.707),
    (LAB + "/adc-interference", "where harmonic 251 lands",
     1.2560199999988981, r"z, sits ([\d,.]+) Hz", 0.418),
    (LAB + "/adc-interference", "modulator clock for 10 Hz at OSR 256",
     2.56, r"mes the ([\d,.]+) kHz", 0.02),
    (LAB + "/adc-interference", "20 ppm of 256 kHz",
     5.12, r"lock at ([\d,.]+) Hz", 0.103),
    (LAB + "/adc-interference", "ideal 16-bit SNR",
     98.0905112030308, r"e sine: ([\d,.]+) dB", 0.054),
    (LAB + "/adc-interference", "dB per OSR doubling, second order",
     15.05149978319906, r"f 64, and ([\d,.]+) dB", 0.035),
    (LAB + "/adc-interference", "fundamental of a 1.8 V square wave",
     1.1459155902616465, r"g has a ([\d,.]+) V", 0.046),
    (LAB + "/adc-interference", "that fundamental 80 dB down at 1 MHz, capacitive at 4.1273 MHz",
     114.59155902616465 * 4.1273, r"that is ([\d,.]+) uV", 0.046),
    (LAB + "/adc-interference", "kT/C noise, 10 pF at 300 K",
     20.35177387846082, r"s kT/C: ([\d,.]+) uV", 0.258),
    (F + "/edge-rate-not-clock-rate", "knee for a 300 ps edge (GHz)",
     0.5 / 300e-12 / 1e9, r"300 ps edge puts the knee at ([\d.]+) GHz", 3),
    (F + "/when-is-a-trace-a-transmission-line", "stripline t_pd (ps/in)",
     tpd(4.2), r"roughly (\d+) ps/inch", 2),
    (F + "/when-is-a-trace-a-transmission-line", "microstrip t_pd (ps/in)",
     tpd(3.0), r"about (\d+) ps/inch", 2),
    (F + "/when-is-a-trace-a-transmission-line", "figure: stripline t_pd (ps/in)",
     tpd(4.2), r"at about (\d+) ps per inch it is", 1),
    (F + "/when-is-a-trace-a-transmission-line", "figure: length of a 100 ps edge on stripline (in)",
     100 / tpd(4.2), r"it is ([\d.]+) in long", 1),
    (LAB + "/one-channel", "TDR resolution at a 12 ps edge (in)",
     12.0 / 170 / 2, r"that is roughly ([\d.]+) inches in principle", 3),
    # M1-10 · a matched attenuator reflects nothing and still loses half the
    # voltage, which is the counter-example to "S11 determines S21".
    (G + "/domain-bridges", "voltage through a 6 dB matched attenuator (%)",
     100 * 10 ** (-6.0206 / 20), r"exactly ([\d.]+)% of the launched voltage", 3),
    # M2-10 · C5. Two inches is 340 ps ONE WAY. The page said 340 ps round trip,
    # which halves every ringing estimate built on it.
    (LAB + "/travelling-waves", "2 in one-way flight at 170 ps/in (ps)",
     2 * 170.0, r"170 ps/inch is (\d+) ps one way", 1),
    (LAB + "/travelling-waves", "2 in round trip at 170 ps/in (ps)",
     4 * 170.0, r"one way and (\d+) ps per round trip", 1),
    # M7-4 · the one return-path question with an exact closed form. A 1.6 mm
    # board with 0.3 mm barrels; the ln approximation is 23.3% wrong at the
    # close spacing that actually matters.
    (LAB + "/travelling-waves", "via loop L at 0.5 mm (nH)",
     _via_loop(1.6, 0.15, 0.5), r"0.5 mm ([\d.]+) nH", 1),
    (LAB + "/travelling-waves", "via loop L at 2.0 mm (nH)",
     _via_loop(1.6, 0.15, 2.0), r"2.0 mm ([\d.]+) nH", 1),
    (LAB + "/travelling-waves", "cost of moving the via 0.5 to 2.0 mm (nH)",
     _via_loop(1.6, 0.15, 2.0) - _via_loop(1.6, 0.15, 0.5),
     r"costs ([\d.]+) nH", 1.5),
    (LAB + "/travelling-waves", "ln overstates acosh at s/r = 2.7 (%)",
     100 * abs(math.log(0.4 / 0.15) - math.acosh(0.4 / 0.3)) / math.acosh(0.4 / 0.3),
     r"overstates the inductance by ([\d.]+)%", 2),
    # N3-2c · a wrong DFE decision adds twice the tap instead of removing it, so
    # a single-tap DFE bursts once the post-cursor exceeds half the main cursor.
    (S + "/equalization", "post-cursor at which one wrong DFE decision propagates",
     1 / 2, r"post-cursor\s+above ([\d.]+) of the main cursor", 1),
    # N3-2e · the return-via estimate is NOT an upper bound. Internal inductance
    # is omitted and ADDS: mu0/(8*pi) per unit length inside each conductor at DC.
    (LAB + "/travelling-waves", "internal inductance of two 1.6 mm barrels (nH)",
     2 * 1.6e-3 * (4e-7 * math.pi) / (8 * math.pi) * 1e9,
     r"is ([\d.]+) nH on top of", 1),
    (LAB + "/travelling-waves", "external loop L at 1.0 mm spacing (nH)",
     _via_loop(1.6, 0.15, 1.0), r"on top of the ([\d.]+) nH external", 1),
    (LAB + "/travelling-waves", "internal as a fraction of external at 1.0 mm (%)",
     100 * (2 * 1.6e-3 * (4e-7 * math.pi) / (8 * math.pi) * 1e9) / _via_loop(1.6, 0.15, 1.0),
     r"1 mm spacing - ([\d.]+)%", 1),
    # M7-5 · real capacitors. One 22 uF 0603 part, 1 mm return via on a 1.6 mm
    # board, derated to 35% of its marking. The point of these numbers is that
    # the marked-value error changes SIGN across the band, so a single "derating
    # is conservative" rule of thumb is wrong twice.
    (P + "/real-capacitors", "22 uF at 35% retained (uF)",
     22.0 * 0.35, r"falls to ([\d.]+) uF", 2),
    (P + "/real-capacitors", "derated SRF (MHz)",
     1 / (2 * math.pi * math.sqrt(_RC_L * 22e-6 * 0.35)) / 1e6,
     r"800 kHz to ([\d.]+) MHz", 3),
    (P + "/real-capacitors", "worst marked-value error (x)",
     (lambda f: _rc_z(f, 22e-6 * 0.35, _RC_L) / _rc_z(f, 22e-6, _RC_L))(
         _rc_extreme(22e-6, 22e-6 * 0.35, _RC_L, 3e5, 1.1e6, +1)),
     r"the error is ([\d.]+)x", 3),
    (P + "/real-capacitors", "best marked-value error, inverted (x)",
     1 / (lambda f: _rc_z(f, 22e-6 * 0.35, _RC_L) / _rc_z(f, 22e-6, _RC_L))(
         _rc_extreme(22e-6, 22e-6 * 0.35, _RC_L, 1.1e6, 3e6, -1)),
     r"([\d.]+)x better", 2),
    (P + "/real-capacitors", "crossover frequency (MHz)",
     _rc_cross(22e-6, 22e-6 * 0.35, _RC_L, 3e5, 3e6) / 1e6,
     r"crossover at ([\d.]+) MHz", 3),
    (P + "/real-capacitors", "one over the retained fraction",
     1 / 0.35, r"1/0.35 = ([\d.]+)", 3),
    (P + "/real-capacitors", "ratio actually reached at 10 kHz",
     _rc_z(1e4, 22e-6 * 0.35, _RC_L) / _rc_z(1e4, 22e-6, _RC_L),
     r"against ([\d.]+) measured at 10 kHz", 3),
    # M4-6 · C8. The 20-80 to 10-90 ratio is waveform-dependent, and the
    # widely-repeated 0.6 is wrong for every shape people actually mean.
    (G + "/units-and-conventions", "20-80/10-90 for a Gaussian edge",
     _rt_ratio("gauss"), r"Gaussian cumulative ([\d.]+)", 0.5),
    (G + "/units-and-conventions", "20-80/10-90 for a linear ramp",
     0.6 / 0.8, r"Linear ramp ([\d.]+)", 0.5),
    (G + "/units-and-conventions", "20-80/10-90 for a first-order exponential",
     math.log(4) / math.log(9), r"First-order exponential ([\d.]+)", 0.5),
    (G + "/units-and-conventions", "inflation from using 10-90 as 20-80, Gaussian",
     1 / _rt_ratio("gauss"), r"inflates a 10-90% time by ([\d.]+)x", 1),
    # M4-3 · the shunt-through approximation Z = Z0*S21/2 against the exact
    # Z = Z0*S21/[2(1-S21)]. I stated these four bounds from feel and all four
    # were wrong; they are computed here from the two expressions.
    (M + "/measurement-practice", "|Z| where Z0*S21/2 errs by 1% (ohm)",
     _shunt_err(0.01), r"1% at ([\d.]+) ohm", 2),
    (M + "/measurement-practice", "|Z| where Z0*S21/2 errs by 10% (ohm)",
     _shunt_err(0.10), r"10% at\s+([\d.]+)\s*ohm", 2),
    (M + "/measurement-practice", "error of Z0*S21/2 at 1 ohm (%)",
     100 * abs(50 * (2 * 1.0 / (50 + 2 * 1.0)) / 2 - 1.0) / 1.0,
     r"At 1 ohm it is already\s+([\d.]+)%", 2),
    # M3-8 · C7. Reflections on a 10-30 mm LPDDR net do NOT settle inside a
    # 117 ps UI: the round trip alone spans 134 to 402 ps.
    (I + "/lpddr5x", "10 mm round trip at 6.7 ps/mm (ps)",
     2 * 10 * 170.0 / 25.4, r"one way and (\d+) ps per round trip; a 30 mm", 1.5),
    (I + "/lpddr5x", "30 mm round trip at 6.7 ps/mm (ps)",
     2 * 30 * 170.0 / 25.4, r"net is 201 ps and (\d+) ps", 1.5),
    # ── Lab C ────────────────────────────────────────────────────────────────
    (LAB + "/pdn-chain", "more board caps make the peak worse, from (mohm)",
     56.8, r"peak increased from (\d+) m", 3),
    (LAB + "/pdn-chain", "…to (mohm)",
     61.3, r"peak increased from \d+ m[^ ]* to (\d+) m", 3),
    # ── Lab B ────────────────────────────────────────────────────────────────
    (LAB + "/one-channel", "quarter-wave null of a 40 ps stub (GHz)",
     1 / (4 * 40e-12) / 1e9, r"At ([\d.]+) GHz - a quarter-wave resonance", 1),
    (LAB + "/one-channel", "symbols in the eye after skip and guard",
     420 - 24 - 3, r"built from (\d+) symbols", 0.5),
    # ── Lab A ────────────────────────────────────────────────────────────────
    (LAB + "/travelling-waves", "3 inches of stripline, one way (ps)",
     3 * 170, r"At (\d+) ps - 3 inches at about 170 ps/inch", 2),
    (LAB + "/travelling-waves", "launched current, 833 mV into 50 ohm (mA)",
     1000 * (1.0 * 50 / 60) / 50, r"you have also launched ([\d.]+) mA", 1),
    (LAB + "/travelling-waves", "launched voltage from 10 ohm into 50 ohm (mV)",
     1000 * 50 / 60, r"Launch (\d+) mV into a 50 ohm line", 1),
    (F + "/reflections", "launched from 10 ohm into 50 ohm (mV)",
     1000 * 50 / 60, r"launches about (\d+) mV", 1),
    (F + "/reflections", "open-circuit doubling (V)",
     2 * 50 / 60, r"jumps to ([\d.]+) V", 2),
    (F + "/reflections", "figure: gamma, 50 into 75 ohm",
     (75 - 50) / (75 + 50), r"into 75 ohm, . = \+([\d.]+)", 0.5),
    (F + "/reflections", "figure: transmitted, 50 into 75 ohm",
     1 + (75 - 50) / (75 + 50), r"1 \+ . = ([\d.]+) of it", 0.5),
    (F + "/reflections", "figure: |gamma|, 50 into 30 ohm",
     abs((30 - 50) / (30 + 50)), r"into 30 ohm, . = .([\d.]+)", 0.5),
    (F + "/reflections", "figure: transmitted, 50 into 30 ohm",
     1 + (30 - 50) / (30 + 50), r"transmitted wave shrinks to (\d\.\d+)", 0.5),
    # ── Interview guide ─────────────────────────────────────────────────────
    ("../interview", "UI at 10 Gb/s (ps)", ui_ps(10e9), r"inverse of the bit rate: (\d+) ps", 0.1),
    ("../interview", "Nyquist of 10 Gb/s NRZ (GHz)", 5, r"half the bit rate: (\d+) GHz", 0.1),
    ("../interview", "knee of a 50 ps edge, 0.5/tr (GHz)", 0.5 / 50e-12 / 1e9, r"0.5/t r : (\d+) GHz", 0.1),
    ("../interview", "-3 dB bandwidth, 0.35/tr (GHz)", 0.35 / 50e-12 / 1e9, r"0.35/t r , (\d+) GHz", 0.1),
    ("../interview", "stripline delay, 170 ps/in in ps/mm", 170 / 25.4, r"roughly ([\d.]+) ps/mm, set by", 0.5),
    ("../interview", "critical length, 100 ps / (6 x 6.7 ps/mm) (mm)", 100 / (6 * 6.7), r"about ([\d.]+) mm at 6.7 ps/mm", 1),
    ("../interview", "gamma, 50 into 75", (75 - 50) / (75 + 50), r": \+([\d.]+) into 75 ohm", 0.1),
    ("../interview", "gamma, 50 into 30 (magnitude)", abs((30 - 50) / (30 + 50)), r"-([\d.]+) into 30 ohm", 0.1),
    ("../interview", "|gamma| at 20 dB return loss", 10 ** (-20 / 20), r"10 -RL/20 = ([\d.]+) ,", 0.1),
    ("../interview", "VSWR at |gamma| 0.1", 1.1 / 0.9, r"VSWR of about ([\d.]+)", 0.5),
    ("../interview", "skin depth of copper at 1 GHz (um)", skin(1), r"skin depth is about ([\d.]+) um", 2),
    ("../interview", "skin depth of copper at 10 GHz (um)", skin(10), r"about ([\d.]+) um at 10 GHz", 3),
    ("../interview", "60 mil stub in Dk 4, quarter wave (GHz)", 11.8028 / (4 * 0.060 * 2), r"about ([\d.]+) GHz \. Halve", 0.5),
    ("../interview", "target impedance, 0.8 V x 3% / 20 A (mohm)", 0.8 * 0.03 / 20 * 1000, r"= ([\d.]+) mohm , across", 0.1),
    ("../interview", "SRF, 100 nF with 1.6 nH (MHz)", srf(100e-9, 1.6e-9) / 1e6, r"about ([\d.]+) MHz \. Above it", 0.5),
    ("../interview", "ground bounce, 1 nH x 20 mA / 50 ps (V)", 1e-9 * 0.02 / 50e-12, r"/ 50 ps = ([\d.]+) V for one driver", 0.1),
    ("../interview", "Q at BER 1e-12", qinv(1e-12), r"Q ~ ([\d.]+) each side", 0.5),
    ("../interview", "2Q at BER 1e-12", 2 * qinv(1e-12), r"plus about ([\d.]+) x the rms", 0.5),
    ("../interview", "PAM4 eye penalty, 20 log10 3 (dB)", 20 * math.log10(3), r"a penalty of about ([\d.]+) dB", 1),
    ("../interview", "via dip time constant, 50 x 1 pF / 2 (ps)", 50 * 1e-12 / 2 * 1e12, r"Z 0 C/2 = (\d+) ps", 0.1),
    ("../interview-power-integrity", "target impedance example (mohm)", 0.8 * 0.03 / 20 * 1000, r"20 A step needs ([\d.]+) mohm", 0.1),
    ("../interview-power-integrity", "SRF of 100 nF with 1.6 nH (MHz)", srf(100e-9, 1.6e-9) / 1e6, r"self-resonance is near (\d+) MHz", 4),
    ("../interview-signal-integrity", "Ethernet Q: 224G Nyquist, 106.25 GBd / 2 (GHz)", 106.25 / 2, r"doubles, from [\d.]+ to ([\d.]+) GHz", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: 112G Nyquist, 53.125 GBd / 2 (GHz)", 53.125 / 2, r"doubles, from ([\d.]+) to [\d.]+ GHz", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: lower limit of the loss ratio, sqrt 2", math.sqrt(2), r"rises by between about ([\d.]+) and 2 times", 0.5),
    ("../interview-signal-integrity", "Ethernet Q: ball to ball, 40 - 2 x 5 (dB)", 40 - 2 * 5, r"and (\d+) or \d+ dB remain between the balls", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: ball to ball, high-loss host with a nominal one, 40 - 9 - 5 (dB)", 40 - 9 - 5, r"and \d+ or (\d+) dB remain between the balls", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: two packages, 2 x 5 (dB)", 2 * 5, r"packages now take (\d+) to \d+ dB of the 40", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: a 9 dB and a 5 dB package, 9 + 5 (dB)", 9 + 5, r"packages now take \d+ to (\d+) dB of the 40", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: RS(544,514) parity symbols", 544 - 514, r"whose (\d+) parity symbols correct", 0.1),
    ("../interview-signal-integrity", "Ethernet Q: RS(544,514) correctable symbols", (544 - 514) / 2, r"correct up to (\d+) wrong symbols per 544", 0.1),
    ("../interview-signal-integrity", "60 mil stub notch (GHz)", 11.8028 / (4 * 0.060 * 2), r"60 mil stub notches near (\d+) GHz", 2),
    ("../interview-signal-integrity", "dip area 25 ps on 50 ohm is C = 2 x 25 ps / 50 (pF)", 2 * 25e-12 / 50 * 1e12, r"50 ohm line is (\d+) pF", 0.1),
    ("../interview-signal-integrity", "PAM4 eye penalty (dB)", 20 * math.log10(3), r"about ([\d.]+) dB less", 1),

    ("../interview-signal-integrity", "plot: dip depth, 1 pF on 50 ohm, 50 ps ramp", _ramp_dip(25e-12, 50e-12)[0], r"is about ([\d.]+) deep and", 1),
    ("../interview-signal-integrity", "plot: dip width at half depth (ps)", _ramp_dip(25e-12, 50e-12)[1] * 1e12, r"deep and (\d+) ps wide at half", 2),
    ("../interview-signal-integrity", "plot: depth x width estimate (ps)", _ramp_dip(25e-12, 50e-12)[0] * _ramp_dip(25e-12, 50e-12)[1] * 1e12, r"depth times width is about (\d+) ps", 3),
    ("../interview-signal-integrity", "plot: quarter wave at 20 GHz in Dk 4 (mm)", 11.8028 / (4 * 20 * 2) * 25.4, r"D k 4 is about ([\d.]+) mm", 3),
    ("../interview-signal-integrity", "plot: quarter wave at 20 GHz in Dk 4 (mil)", 11.8028 / (4 * 20 * 2) * 1000, r"mm, (\d+) mil, a plausible", 1),
    ("../interview-power-integrity", "plot: 29 pH against 250 nF (MHz)", 1 / (2 * math.pi * math.sqrt(29e-12 * 250e-9)) / 1e6, r"which gives (\d+) MHz", 1),

    # ── Interview guide: questions added 4 Oct 2026 ─────────────────────────
    ("../interview-signal-integrity", "edge question: knee of a 100 ps edge (GHz)", 0.5 / 100e-12 / 1e9, r"0.5/t r = (\d+) GHz", 0.1),
    ("../interview-signal-integrity", "edge question: -3 dB bandwidth of a 100 ps edge (GHz)", 0.35 / 100e-12 / 1e9, r"0.35/t r , ([\d.]+) GHz here", 0.1),
    ("../interview-signal-integrity", "edge question: harmonic of 100 MHz at the 5 GHz knee", 5e9 / 100e6, r"the (\d+)th harmonic sits at the knee", 0.1),
    ("../interview-signal-integrity", "timing: 1 mm of stripline at 170 ps/in (ps)", 170 / 25.4, r"1 mm of stripline is ([\d.]+) ps", 1.5),
    ("../interview-signal-integrity", "timing: 10 mm of stripline (ps)", 10 * 170 / 25.4, r"so 10 mm is (\d+) ps", 1.5),
    ("../interview-signal-integrity", "timing: UI at 6400 MT/s (ps)", ui_ps(6.4e9), r"of the (\d+) ps unit interval of a 6400", 0.5),
    ("../interview-signal-integrity", "timing: 10 mm as a share of the 6400 MT/s UI (%)", 100 * 10 * 170 / 25.4 / ui_ps(6.4e9), r"67 ps, (\d+)% of the", 2),
    ("../interview-signal-integrity", "timing: microstrip at 147 ps/in (ps/mm)", 147 / 25.4, r"faster, about ([\d.]+) ps/mm, so a net", 1),
    ("../interview-signal-integrity", "timing: UI at 3200 MT/s (ps)", ui_ps(3.2e9), r"the ([\d.]+) ps interval at 3200", 0.2),
    ("../interview-signal-integrity", "timing: 67 ps as a share of the 3200 MT/s UI (%)", 100 * 67 / ui_ps(3.2e9), r"is about (\d+)% of the 312", 3),
    ("../interview-signal-integrity", "AC coupling: corner of 100 nF into 50 ohm (kHz)", 1 / (2 * math.pi * 50 * 100e-9) / 1e3, r"corner near (\d+) kHz", 2),
    ("../interview-signal-integrity", "AC coupling: time constant 50 ohm x 100 nF (us)", 50 * 100e-9 * 1e6, r"of the (\d+) us time constant", 0.1),
    ("../interview-signal-integrity", "AC coupling: 128 bits at 10 Gb/s (ns)", 128 * ui_ps(10e9) / 1e3, r"lasts ([\d.]+) ns", 0.1),
    ("../interview-signal-integrity", "AC coupling: that run as a share of the time constant (%)", 100 * 128 * 100e-12 / (50 * 100e-9), r"about ([\d.]+)% of the 5", 3),
    ("../interview-power-integrity", "placement: spreading inductance, mu0 x 50 um per square (pH)", 4e-7 * math.pi * 50e-6 * 1e12, r"per square: (\d+) pH", 1),
    ("../interview-power-integrity", "bulk: C = 1/(2 pi f Z), 200 kHz and 1.2 mohm (uF)", 1 / (2 * math.pi * 200e3 * 1.2e-3) * 1e6, r"about (\d+) uF\. It is a first", 1),
    ("../interview-power-integrity", "filter: 1 uH into 10 uF resonates (kHz)", 1 / (2 * math.pi * math.sqrt(1e-6 * 10e-6)) / 1e3, r"resonates near (\d+) kHz", 1),
    ("../interview-power-integrity", "filter: sqrt(L/C) of 1 uH and 10 uF (ohm)", math.sqrt(1e-6 / 10e-6), r"impedance of ([\d.]+) ohm; with", 2),
    ("../interview-power-integrity", "filter: Q = sqrt(L/C)/R with 0.1 ohm", math.sqrt(1e-6 / 10e-6) / 0.1, r"a Q of about (\d+)", 6),
    ("../interview-signal-integrity", "chiplets: 8 TB/s total over 1317 GB/s/mm (mm)", 8000 / 1317, r"over 1317 GB/s/mm: about ([\d.]+) mm", 1),
    ("../interview-signal-integrity", "chiplets: 2 mm round trip at 6.7 ps/mm (ps)", 2 * 2 * 6.7, r"2 mm has a round trip of about ([\d.]+) ps", 0.2),
    ("../interview-signal-integrity", "chiplets: half a UI at 16 GT/s (ps)", ui_ps(16e9) / 2, r"under the ([\d.]+) ps of half a UI at 16", 0.1),
    ("../interview-signal-integrity", "chiplets: half a UI at 32 GT/s (ps)", ui_ps(32e9) / 2, r"over the ([\d.]+) ps at 32 GT/s", 0.5),
    ("../interview-signal-integrity", "chiplets: 1 mm at 6.7 ps/mm as a share of the 64 GT/s UI (%)", 100 * 6.7 / ui_ps(64e9), r"6\.7 ps/mm is (\d+)% of the", 1),
    ("../interview-signal-integrity", "chiplets: UI at 64 GT/s (ps)", ui_ps(64e9), r"6\.7 ps/mm is \d+% of the ([\d.]+) ps unit interval", 0.5),
    ("../interview-signal-integrity", "chiplets: PAM4 penalty, 20 log10(3) (dB)", 20 * math.log10(3), r"costing about ([\d.]+) dB of signal-to-noise", 1),
    ("../interview-signal-integrity", "3D: 4,000 GB/s/mm2 x 8 x 0.05 pJ/b (W/mm2)", 4000 * 8 * 0.05 / 1000, r"rises from ([\d.]+) W/mm2 to", 0.1),
    ("../interview-signal-integrity", "3D: 300,000 GB/s/mm2 x 8 x 0.01 pJ/b (W/mm2)", 300000 * 8 * 0.01 / 1000, r"W/mm2 to (\d+) W/mm2 if every", 0.1),
    ("../interview-signal-integrity", "3D: 24 W/mm2 over 700 W / 814 mm2", 24 / (700 / 814), r"about (\d+) times the average of a 700 W", 1),
    ("../interview-signal-integrity", "3D: density rise from 9 to 1 um", 300000 / 4000, r"density rises faster than energy falls, (\d+)-fold", 0.1),
    ("../interview-power-integrity", "PSIJ: 40 mV x 0.12 ps/mV (ps)", 40 * 0.12, r"turns 40 mV of ripple into ([\d.]+) ps", 0.1),
    ("../interview-power-integrity", "PSIJ: UI of a 32 Gb/s NRZ link (ps)", ui_ps(32e9), r"the ([\d.]+) ps unit interval of a 32", 0.1),
    ("../interview-power-integrity", "PSIJ: 4.8 ps as a share of that UI (%)", 100 * 4.8 / ui_ps(32e9), r"which is (\d+)% of the 31", 3),

    # ── UFS 3.x / 4.x / 5.0 (C-157 to C-164) ──
    ("interfaces/ufs4", "glance: two HS-G5 lanes on the wire (Gb/s)", 2 * 23.32, r"Two HS-G5 lanes carry ([\d.]+) Gb/s", 0.1),
    ("interfaces/ufs4", "glance: after 8b10b (GB/s)", 2 * 23.32 * 8 / 10 / 8, r"After 8b10b coding that is ([\d.]+) GB/s", 0.2),
    ("interfaces/ufs4", "glance: 4.2 GB/s as a share of 4.66 GB/s (%)", 100 * 4.2 / (2 * 23.32 * 8 / 10 / 8), r"roughly (\d+)% of it once the protocol", 2),
    ("interfaces/ufs4", "glance: two HS-G4 lanes (Gb/s)", 2 * 11.6, r"reach ([\d.]+) Gb/s on the wire over two HS-G4", 0.1),
    ("interfaces/ufs4", "table: HS-G4 UI (ps)", 1e3 / 11.6, r"Unit interval (\d+) ps", 1),
    ("interfaces/ufs4", "table: HS-G5 UI (ps)", 1e3 / 23.32, r"Unit interval \d+ ps ([\d.]+) ps", 0.2),
    ("interfaces/ufs4", "table: HS-G6 symbol period (ps)", 2e3 / 46.694, r"Unit interval \d+ ps [\d.]+ ps ([\d.]+) ps per symbol", 0.2),
    ("interfaces/ufs4", "table: HS-G4 Nyquist (GHz)", 11.6 / 2, r"Nyquist frequency ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "table: HS-G5 Nyquist (GHz)", 23.32 / 2, r"Nyquist frequency [\d.]+ GHz ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "table: HS-G6 Nyquist (GHz)", 46.694 / 4, r"Nyquist frequency [\d.]+ GHz [\d.]+ GHz ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "table: two HS-G4 lanes (Gb/s)", 2 * 11.6, r"([\d.]+) Gb/s on the wire about", 0.1),
    ("interfaces/ufs4", "figure: HS-G4 Nyquist (GHz)", 11.6 / 2, r"11\.6 GBd -> Nyquist ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "figure: HS-G5 Nyquist (GHz)", 23.32 / 2, r"23\.32 GBd -> Nyquist ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "figure: HS-G6 symbol rate (GBd)", 46.694 / 2, r"([\d.]+) GBd -> Nyquist [\d.]+ GHz UFS 5\.0", 0.1),
    ("interfaces/ufs4", "figure: HS-G6 Nyquist (GHz)", 46.694 / 4, r"[\d.]+ GBd -> Nyquist ([\d.]+) GHz UFS 5\.0", 0.1),
    ("interfaces/ufs4", "caption: HS-G6 symbol rate (billion/s)", 46.694 / 2, r"so it sends ([\d.]+) billion symbols", 0.1),
    ("interfaces/ufs4", "caption: HS-G6 Nyquist (GHz)", 46.694 / 4, r"its Nyquist frequency, ([\d.]+) GHz", 0.1),
    ("interfaces/ufs4", "figure: PAM4 eye penalty, 20 log 3 (dB)", 20 * math.log10(3), r"third of the swing: -([\d.]+) dB", 1),
    ("interfaces/ufs4", "answer: HS-G6 Nyquist (GHz)", 46.694 / 4, r"Nyquist frequency of about ([\d.]+) GHz", 1),
    ("interfaces/ufs4", "deeper: 2 x 23.32 (Gb/s)", 2 * 23.32, r"2 x 23\.32 = ([\d.]+) Gb/s", 0.1),
    ("interfaces/ufs4", "deeper: after 8b10b (Gb/s)", 2 * 23.32 * 8 / 10, r"leaving ([\d.]+) Gb/s", 0.2),
    ("interfaces/ufs4", "deeper: after 8b10b (GB/s)", 2 * 23.32 * 8 / 10 / 8, r"Gb/s, which is ([\d.]+) GB/s", 0.2),
    ("interfaces/ufs4", "deeper: 4.2 / 4.66 (%)", 100 * 4.2 / (2 * 23.32 * 8 / 10 / 8), r"for UFS 4\.0 is about (\d+)% of that", 2),
    ("interfaces/ufs4", "deeper: two lanes at 46.6 Gb/s, 1b1b (GB/s)", 2 * 46.6 / 8, r"two lanes at 46\.6 Gb/s carry ([\d.]+) GB/s", 0.2),
    ("interfaces/ufs4", "deeper: 10.8 / 11.65 (%)", 100 * 10.8 / (2 * 46.6 / 8), r"about 10\.8 GB/s is about (\d+)% of it", 2),

    # ── UCIe ────────────────────────────────────────────────────────────────
    ("interfaces/ucie", "bump pitch ratio, 110 / 45 um", 110 / 45, r"about ([\d.]+) times finer", 0.5),
    ("interfaces/ucie", "shoreline ratio at 32 GT/s, 1317 / 224", 1317 / 224, r"about ([\d.]+) times higher", 1),
    ("interfaces/ucie", "UCIe-S shoreline scaled to 4 GT/s, 224 / 8", 224 / 8, r"get ([\d.]+) and [\d.]+ GB/s/mm", 0.2),
    ("interfaces/ucie", "UCIe-A shoreline scaled to 4 GT/s, 1317 / 8", 1317 / 8, r"get [\d.]+ and ([\d.]+) GB/s/mm", 0.1),
    ("interfaces/ucie", "UCIe-S gain from 32 to 64 GT/s, 370 / 224", 370 / 224, r"only ([\d.]+) times its 32", 0.5),
    ("interfaces/ucie", "4 TB/s on UCIe-A at 32 GT/s (mm)", 4000 / 1317, r"about ([\d.]+) mm of edge on an advanced", 0.5),
    ("interfaces/ucie", "4 TB/s on UCIe-S at 32 GT/s (mm)", 4000 / 224, r"about ([\d.]+) mm on a standard one", 0.5),
    ("interfaces/ucie", "t_pd at Dk 4 (ps/mm)", 2 / 0.299792458, r"t pd is about ([\d.]+) ps/mm", 1),
    ("interfaces/ucie", "round trip of 2 mm at 6.7 ps/mm (ps)", 2 * 2 * 6.7, r"round trip of about ([\d.]+) ps\. At 16", 0.2),
    ("interfaces/ucie", "half a UI at 16 GT/s (ps)", ui_ps(16e9) / 2, r"half a unit interval is ([\d.]+) ps, and the echoes", 0.1),
    ("interfaces/ucie", "half a UI at 32 GT/s (ps)", ui_ps(32e9) / 2, r"32 GT/s it is ([\d.]+) ps: the first echo", 0.5),
    ("interfaces/ucie", "round trip of 25 mm at 6.7 ps/mm (ps)", 2 * 25 * 6.7, r"round trip of about (\d+) ps: [\d.]+ unit intervals", 0.2),
    ("interfaces/ucie", "25 mm round trip in UI at 4 GT/s", 2 * 25 * 6.7 / ui_ps(4e9), r"about \d+ ps: ([\d.]+) unit intervals at 4 GT/s", 0.5),
    ("interfaces/ucie", "25 mm round trip in UI at 16 GT/s", 2 * 25 * 6.7 / ui_ps(16e9), r"at 4 GT/s and ([\d.]+) at 16 GT/s", 0.5),
    ("interfaces/ucie", "first-arrival overshoot, 40 ohm driver on 50 ohm, open (%)", 100 * (2 * 50 / 90 - 1), r"2.50/90 . 1 = ([\d.]+)% of the swing", 0.5),
    ("interfaces/ucie", "1.5 mm round trip at 16 GT/s (UI)", 2 * 1.5 * 6.7 / ui_ps(16e9), r"the round trip is only ([\d.]+) of a unit", 2),
    ("interfaces/ucie", "UCIe-A x64 at 32 GT/s, each way (GB/s)", 64 * 32 / 8, r"0\.389 mm wide and sends (\d+) GB/s each way", 0.1),
    ("interfaces/ucie", "UCIe-A x64 module, both directions over 0.389 mm (GB/s/mm)", 2 * 64 * 32 / 8 / 0.389, r"512 GB/s over 0\.389 mm is (\d+) GB/s/mm", 0.1),
    ("interfaces/ucie", "UCIe-A x64 at 32 GT/s, both directions (GB/s)", 2 * 64 * 32 / 8, r"each way, and (\d+) GB/s over 0\.389", 0.1),
    ("interfaces/ucie", "UCIe-S x32 at 32 GT/s, each way (GB/s)", 32 * 32 / 8, r"1\.143 mm wide and sends (\d+) GB/s each way", 0.1),
    ("interfaces/ucie", "UCIe-S x32 module, both directions over 1.143 mm (GB/s/mm)", 2 * 32 * 32 / 8 / 1.143, r"256 GB/s over 1\.143 mm is (\d+) GB/s/mm", 0.5),
    ("interfaces/ucie", "4 TB/s in total is 2 TB/s each way", 4 / 2, r"Moving 4 TB/s in total across one edge, (\d+) TB/s each way", 0.1),
    ("interfaces/ucie", "64 GT/s against 32 GT/s energy on UCIe-A, 0.5 / 0.3", 0.5 / 0.3, r"against 0\.3, ([\d.]+) times the energy per bit", 0.5),
    ("interfaces/ucie", "real world: shoreline ratio at 32 GT/s, 1317 / 224", 1317 / 224, r"buys about ([\d.]+) times the bandwidth per millimetre", 1),
    ("interfaces/ucie", "sideband vs mainband, 512 Gb/s / 800 Mb/s", 512 / 0.8, r"each way, (\d+) times slower than the 512 Gb/s mainband", 0.1),
    ("interfaces/ucie", "real world: UCIe-A energy as a share of UCIe-S at 32 GT/s, 0.3 / 0.75 (%)", 100 * 0.3 / 0.75, r"edge at (\d+)% of the energy per bit", 0.1),
    ("interfaces/ucie", "1 TB/s at 0.3 pJ/b (W)", 1 * 8 * 0.3, r"1 TB/s at 0\.3 pJ/b costs ([\d.]+) W", 0.1),
    ("interfaces/ucie", "4 TB/s at 0.3 pJ/b (W)", 4 * 8 * 0.3, r"4 TB/s costs ([\d.]+) W", 0.1),
    ("interfaces/ucie", "pitch ratio squared, (9 / 1)^2", (9 / 1) ** 2, r"\(9/1\)2 = (\d+)", 0.1),
    ("interfaces/ucie", "81 x 4 TB/s/mm2", 81 * 4, r"is (\d+) TB/s/mm2", 0.1),
    ("interfaces/ucie", "UCIe-S x16 at 32 GT/s per direction (Gb/s)", 16 * 32, r"carries (\d+) Gb/s in each direction", 0.1),

    ("interfaces/ucie", "forwarded clock at 64 GT/s, quarter rate (GHz)", 64 / 4, r"At 64 GT/s the forwarded clock runs at (\d+) GHz", 0.1),
    ("interfaces/ucie", "forwarded clock at 48 GT/s, quarter rate (GHz)", 48 / 4, r"at 48 GT/s at (\d+) GHz", 0.1),
    ("interfaces/ucie", "P1 low-frequency level, sum of taps", -0.05 + 0.95 + 0, r"P1 -0\.05 0\.95 0 ([\d.]+) ", 0.5),
    ("interfaces/ucie", "P1 de-emphasis, -20 log10(sum of taps) (dB)", -20 * math.log10(-0.05 + 0.95 + 0), r"P1 -0\.05 0\.95 0 [\d.]+ ([\d.]+) dB", 1),
    ("interfaces/ucie", "P2 low-frequency level, sum of taps", 0 + 0.9 + -0.1, r"P2 0 0\.9 -0\.1 ([\d.]+) ", 0.5),
    ("interfaces/ucie", "P2 de-emphasis, -20 log10(sum of taps) (dB)", -20 * math.log10(0 + 0.9 + -0.1), r"P2 0 0\.9 -0\.1 [\d.]+ ([\d.]+) dB", 1),
    ("interfaces/ucie", "P3 low-frequency level, sum of taps", -0.05 + 0.85 + -0.1, r"P3 -0\.05 0\.85 -0\.1 ([\d.]+) ", 0.5),
    ("interfaces/ucie", "P3 de-emphasis, -20 log10(sum of taps) (dB)", -20 * math.log10(-0.05 + 0.85 + -0.1), r"P3 -0\.05 0\.85 -0\.1 [\d.]+ ([\d.]+) dB", 1),
    ("interfaces/ucie", "P4 low-frequency level, sum of taps", 0 + 0.8 + -0.2, r"P4 0 0\.8 -0\.2 ([\d.]+) ", 0.5),
    ("interfaces/ucie", "P4 de-emphasis, -20 log10(sum of taps) (dB)", -20 * math.log10(0 + 0.8 + -0.2), r"P4 0 0\.8 -0\.2 [\d.]+ ([\d.]+) dB", 1),
    ("interfaces/ucie", "P5 low-frequency level, sum of taps", -0.05 + 0.75 + -0.2, r"P5 -0\.05 0\.75 -0\.2 ([\d.]+) ", 0.5),
    ("interfaces/ucie", "P5 de-emphasis, -20 log10(sum of taps) (dB)", -20 * math.log10(-0.05 + 0.75 + -0.2), r"P5 -0\.05 0\.75 -0\.2 [\d.]+ ([\d.]+) dB", 1),
    ("interfaces/ucie", "40% of 0.5 pJ/b per end", 0.4 * 0.5, r"about ([\d.]+) pJ/b each end", 0.1),
    ("interfaces/ucie", "20% of 0.5 pJ/b shared", 0.2 * 0.5, r"each end and ([\d.]+) shared", 0.1),
    ("interfaces/ucie", "UI at 64 GT/s, the timing window (ps)", ui_ps(64e9), r"that window is ([\d.]+) ps", 0.5),
    ("interfaces/ucie", "1 mm at 6.7 ps/mm as a share of the 64 GT/s UI (%)", 100 * 6.7 / ui_ps(64e9), r"6\.7 ps, (\d+)% of the unit interval", 1),

    # ── Ethernet 112G / 224G ────────────────────────────────────────────────
    ("interfaces/ethernet-112g-224g", "112G Nyquist, 53.125 GBd / 2 (GHz)", 53.125 / 2, r"doubles from ([\d.]+) to [\d.]+ GHz", 0.1),
    ("interfaces/ethernet-112g-224g", "224G Nyquist, 106.25 GBd / 2 (GHz)", 106.25 / 2, r"doubles from [\d.]+ to ([\d.]+) GHz", 0.1),
    ("interfaces/ethernet-112g-224g", "224G symbol rate, twice 53.125 GBd", 2 * 53.125, r"PAM4 at ([\d.]+) GBd \(billion symbols per second\), twice the", 0.1),
    ("interfaces/ethernet-112g-224g", "112G line rate, 100 Gb/s x 17/16", 100 * 17 / 16, r"lanes carry ([\d.]+) and [\d.]+ Gb/s, data plus", 0.1),
    ("interfaces/ethernet-112g-224g", "224G line rate, 200 Gb/s x 17/16", 200 * 17 / 16, r"lanes carry [\d.]+ and ([\d.]+) Gb/s, data plus", 0.1),
    ("interfaces/ethernet-112g-224g", "one symbol at 112G, 1 / 53.125 GBd (ps)", 1e3 / 53.125, r"One symbol lasts ([\d.]+) ps at 112G", 0.5),
    ("interfaces/ethernet-112g-224g", "one symbol at 224G, 1 / 106.25 GBd (ps)", 1e3 / 106.25, r"ps at 112G and ([\d.]+) ps at 224G, and Nyquist", 0.5),
    ("interfaces/ethernet-112g-224g", "panel reading note: 112G symbol (ps)", 1e3 / 53.125, r"sit one symbol apart, ([\d.]+) ps at", 0.5),
    ("interfaces/ethernet-112g-224g", "panel reading note: 224G symbol (ps)", 1e3 / 106.25, r"apart, [\d.]+ ps at 112G and ([\d.]+) ps at 224G; every", 0.5),
    ("interfaces/ethernet-112g-224g", "table: 112G symbol (ps)", 1e3 / 53.125, r"26\.56 GHz; ([\d.]+) ps", 0.5),
    ("interfaces/ethernet-112g-224g", "table: 224G symbol (ps)", 1e3 / 106.25, r"53\.125 GHz; ([\d.]+) ps", 0.5),
    ("interfaces/ethernet-112g-224g", "skin effect per octave, sqrt 2", math.sqrt(2), r"about ([\d.]+) times per doubling", 0.5),
    ("interfaces/ethernet-112g-224g", "lower limit of the loss ratio, sqrt 2", math.sqrt(2), r"by something between ([\d.]+) and 2", 0.5),
    ("interfaces/ethernet-112g-224g", "reach at a fixed budget, upper limit 1 / sqrt 2 (%)", 100 / math.sqrt(2), r"about half to (\d+)% as far", 2),
    ("interfaces/ethernet-112g-224g", "budget growth quoted, 40 - 28 (dB)", 40 - 28, r"the budget grew by (\d+) dB", 0.1),
    ("interfaces/ethernet-112g-224g", "ball to ball at 224G, 40 - 2 x 5 (dB)", 40 - 2 * 5, r"out and (\d+) dB remains between the balls", 0.1),
    ("interfaces/ethernet-112g-224g", "ball to ball, high-loss host with a nominal one, 40 - 9 - 5 (dB)", 40 - 9 - 5, r"or\s+(\d+) dB when one end is the high-loss host", 0.1),
    ("interfaces/ethernet-112g-224g", "two nominal packages, 2 x 5 (dB)", 2 * 5, r"the packages take (\d+) to \d+ dB, a quarter", 0.1),
    ("interfaces/ethernet-112g-224g", "a 9 dB and a 5 dB package, 9 + 5 (dB)", 9 + 5, r"the packages take \d+ to (\d+) dB, a quarter", 0.1),
    ("interfaces/ethernet-112g-224g", "figure: ball to ball at 224G (dB)", 40 - 2 * 5, r"between the balls: (\d+) dB", 0.1),
    ("interfaces/ethernet-112g-224g", "figure: ball to ball with one 9 dB package (dB)", 40 - 9 - 5, r"or (\d+) with one 9 dB pkg", 0.1),
    ("interfaces/ethernet-112g-224g", "figure: 11.5 + 17 + 11.5 (dB)", 11.5 + 17 + 11.5, r"11\.5 \+ 17 \+ 11\.5 = (\d+) dB", 0.1),
    ("interfaces/ethernet-112g-224g", "figure: 112G channel 19.75 + 2 x 10.975 - 2 x 6.6 (dB)", 19.75 + 2 * 10.975 - 2 * 6.6, r"board \+ cable: ([\d.]+) dB", 0.1),
    ("interfaces/ethernet-112g-224g", "host board trace, 6 dB over 4.28 in (dB/in)", 6 / 4.28, r"board trace, ([\d.]+) dB per inch", 0.5),
    ("interfaces/ethernet-112g-224g", "30 AWG twinax, 2.2 dB over 6.8 in (dB/in)", 2.2 / 6.8, r"twinax, ([\d.]+) dB per inch", 1.5),
    ("interfaces/ethernet-112g-224g", "32 AWG twinax, 3.2 dB over 8 in (dB/in)", 3.2 / 8, r"for 3\.2 dB, ([\d.]+) dB per inch", 0.5),
    ("interfaces/ethernet-112g-224g", "board over 32 AWG twinax per inch, 1.4 / 0.40", 1.4 / 0.40, r"the cable loses ([\d.]+) to [\d.]+ times less", 0.5),
    ("interfaces/ethernet-112g-224g", "board over 30 AWG twinax per inch, 1.4 / (2.2 / 6.8)", 1.4 / (2.2 / 6.8), r"the cable loses [\d.]+ to ([\d.]+) times less", 1),
    ("interfaces/ethernet-112g-224g", "RS(544,514) parity symbols, 544 - 514", 544 - 514, r"Its (\d+) parity symbols", 0.1),
    ("interfaces/ethernet-112g-224g", "RS(544,514) correctable symbols, 30 / 2", (544 - 514) / 2, r"correct up to (\d+) wrong symbols", 0.1),
    ("interfaces/ethernet-112g-224g", "deeper: 100 Gb/s x 17/16 (Gb/s)", 100 * 17 / 16, r"100 Gb/s of data becomes ([\d.]+) Gb/s", 0.1),
    ("interfaces/ethernet-112g-224g", "deeper: 106.25 Gb/s / 2 bits (GBd)", 100 * 17 / 16 / 2, r"on the wire, ([\d.]+) GBd at two bits", 0.1),
    ("interfaces/ethernet-112g-224g", "deeper: 200 Gb/s x 17/16 (Gb/s)", 200 * 17 / 16, r"turns 200 Gb/s into ([\d.]+) Gb/s", 0.1),
    ("interfaces/ethernet-112g-224g", "deeper: 212.5 Gb/s / 2 bits (GBd)", 200 * 17 / 16 / 2, r"Gb/s, ([\d.]+) GBd, the rate the 802\.3dj", 0.1),
    ("interfaces/ethernet-112g-224g", "802.3ck Eq. 163-5 at 26.5625 GHz (dB)", 0.693 + 2.161 * math.sqrt(26.5625) + 0.607 * 26.5625, r"which reaches ([\d.]+) dB at 26\.5625", 0.05),
    ("interfaces/ethernet-112g-224g", "Tomahawk 6 at 200G, 102.4 Tb/s / 200 Gb/s (lanes)", 102.4e3 / 200, r"the same capacity is (\d+) lanes", 0.1),
    ("interfaces/ethernet-112g-224g", "Tomahawk 6 at 100G, 102.4 Tb/s / 100 Gb/s (lanes)", 102.4e3 / 100, r"option for ([\d,]+) lanes of 100G", 0.1),

    # ── PCIe 4.0 vs 5.0 ────────────────────────────────────────────────────
    ("interfaces/pcie-gen4-gen5", "glance: Gen 4 UI (ps)", ui_ps(16e9), r"halved from ([\d.]+) to [\d.]+ ps", 0.1),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 5 UI (ps)", ui_ps(32e9), r"halved from [\d.]+ to ([\d.]+) ps", 0.1),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 4 Nyquist (GHz)", 16 / 2, r"doubled from (\d+) to \d+ GHz", 0.1),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 5 Nyquist (GHz)", 32 / 2, r"doubled from \d+ to (\d+) GHz", 0.1),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 4 x1 after 128b/130b (GB/s)", 16 / 8 * 128 / 130, r"PCIe 4\.0 carries ([\d.]+) GB/s per lane", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 5 x1 after 128b/130b (GB/s)", 32 / 8 * 128 / 130, r"and PCIe 5\.0 ([\d.]+) GB/s\.", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 4 x4 (GB/s)", 16 * 4 / 8 * 128 / 130, r"That makes ([\d.]+) and [\d.]+ GB/s on an x4", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 5 x4 (GB/s)", 32 * 4 / 8 * 128 / 130, r"That makes [\d.]+ and ([\d.]+) GB/s on an x4", 0.5),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 4 x16 (GB/s)", 16 * 16 / 8 * 128 / 130, r"and ([\d.]+) and [\d.]+ GB/s on an x16", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: Gen 5 x16 (GB/s)", 32 * 16 / 8 * 128 / 130, r"and [\d.]+ and ([\d.]+) GB/s on an x16", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: TI Gen 5 split sums to the budget, 9 + 16 + 1.5 + 9.5 (dB)", 9 + 16 + 1.5 + 9.5, r"About (\d+) dB at 16 GHz end to end", 0.1),
    ("interfaces/pcie-gen4-gen5", "glance: both directions, Gen 5 x16 (GB/s)", 2 * 32 * 16 / 8 * 128 / 130, r"counting both directions: (\d+) GB/s", 0.2),
    ("interfaces/pcie-gen4-gen5", "glance: 16 dB on TI's worst laminate, 16 / 1.844 (in)", 16 / 1.844, r"So 16 dB is about (\d+) in on the worst", 5),
    ("interfaces/pcie-gen4-gen5", "budget: Gen 3 to Gen 5 total growth, 36 / 23.5", 36 / 23.5, r"the total grew about ([\d.]+) times", 3),
    ("interfaces/pcie-gen4-gen5", "budget: two doublings of Nyquist, sqrt(4) to 4 times loss per inch (low end)", 4 ** 0.5, r"loss per inch by (\d) to \d times", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 3 UI (ps)", ui_ps(8e9), r"Unit interval (\d+) ps", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 3 Nyquist (GHz)", 8 / 2, r"Nyquist frequency (\d+) GHz", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 3 TI budget, 3.5 + 13 + 0.5 + 6.5 (dB)", 3.5 + 13 + 0.5 + 6.5, r"Example channel budget ([\d.]+) dB", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 4 TI budget, 5 + 14 + 0.5 + 8.5 (dB)", 5 + 14 + 0.5 + 8.5, r"Example channel budget [\d.]+ dB (\d+) dB", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 3 eye width, 0.3 UI (ps)", 0.3 * ui_ps(8e9), r"0\.3 UI, ([\d.]+) ps 0\.3 UI", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 4 eye width, 0.3 UI (ps)", 0.3 * ui_ps(16e9), r"0\.3 UI, [\d.]+ ps 0\.3 UI, ([\d.]+) ps", 0.1),
    ("interfaces/pcie-gen4-gen5", "table: Gen 5 eye width, 0.3 UI (ps)", 0.3 * ui_ps(32e9), r"0\.3 UI, [\d.]+ ps 0\.3 UI, [\d.]+ ps 0\.3 UI, ([\d.]+) ps", 0.1),
    ("interfaces/pcie-gen4-gen5", "figure: Gen 3 bar total (dB)", 3.5 + 13 + 0.5 + 6.5, r"Gen 3 \. ([\d.]+) dB total", 0.1),
    ("interfaces/pcie-gen4-gen5", "figure: Gen 4 bar total (dB)", 5 + 14 + 0.5 + 8.5, r"Gen 4 \. (\d+) dB total", 0.1),
    ("interfaces/pcie-gen4-gen5", "figure: Gen 5 bar total (dB)", 9 + 16 + 1.5 + 9.5, r"Gen 5 \. (\d+) dB total", 0.1),
    ("interfaces/pcie-gen4-gen5", "figure: P7 boost (dB)", preset(3.5, -6.0)[3], r"boost = 20\.log\(Vd/Vb\) = ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "deeper: P7 c-1", preset(3.5, -6.0)[0], r"give c\S+ = -([\d.]+) and", 1),
    ("interfaces/pcie-gen4-gen5", "deeper: P7 c+1", preset(3.5, -6.0)[1], r"and c\S+ = -([\d.]+) to two decimals", 1),
    ("interfaces/pcie-gen4-gen5", "deeper: P7 steady level Vb", preset(3.5, -6.0)[2], r"so Vb = ([\d.]+) and", 1),
    ("interfaces/pcie-gen4-gen5", "deeper: P7 boost (dB)", preset(3.5, -6.0)[3], r"20\.log\(1/0\.401\) = ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P0 c+1", preset(0, -6.0)[1], r"P0 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P0 boost (dB)", preset(0, -6.0)[3], r"P0 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P1 c+1", preset(0, -3.5)[1], r"P1 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P1 boost (dB)", preset(0, -3.5)[3], r"P1 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P2 c+1", preset(0, -4.4)[1], r"P2 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P2 boost (dB)", preset(0, -4.4)[3], r"P2 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P3 c+1", preset(0, -2.5)[1], r"P3 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P3 boost (dB)", preset(0, -2.5)[3], r"P3 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P5 c-1", preset(1.9, 0)[0], r"P5 [\d.]+ dB -?[\d.]+ dB -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P5 boost (dB)", preset(1.9, 0)[3], r"P5 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P6 c-1", preset(2.5, 0)[0], r"P6 [\d.]+ dB -?[\d.]+ dB -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P6 boost (dB)", preset(2.5, 0)[3], r"P6 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P7 c-1", preset(3.5, -6.0)[0], r"P7 [\d.]+ dB -?[\d.]+ dB -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P7 c+1", preset(3.5, -6.0)[1], r"P7 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P7 boost (dB)", preset(3.5, -6.0)[3], r"P7 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P8 c-1", preset(3.5, -3.5)[0], r"P8 [\d.]+ dB -?[\d.]+ dB -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P8 c+1", preset(3.5, -3.5)[1], r"P8 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P8 boost (dB)", preset(3.5, -3.5)[3], r"P8 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P9 c-1", preset(3.5, 0)[0], r"P9 [\d.]+ dB -?[\d.]+ dB -([\d.]+) ", 0.5),
    ("interfaces/pcie-gen4-gen5", "preset table: P9 boost (dB)", preset(3.5, 0)[3], r"P9 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ [\d.]+ -?[\d.]+ ([\d.]+) dB", 1),
    ("interfaces/pcie-gen4-gen5", "preset table: P0 c0 = 1 - |c-1| - |c+1|", 1 - preset(0, -6.0)[0] - preset(0, -6.0)[1], r"P0 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P1 c0 = 1 - |c-1| - |c+1|", 1 - preset(0, -3.5)[0] - preset(0, -3.5)[1], r"P1 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P2 c0 = 1 - |c-1| - |c+1|", 1 - preset(0, -4.4)[0] - preset(0, -4.4)[1], r"P2 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P3 c0 = 1 - |c-1| - |c+1|", 1 - preset(0, -2.5)[0] - preset(0, -2.5)[1], r"P3 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P5 c0 = 1 - |c-1| - |c+1|", 1 - preset(1.9, 0)[0] - preset(1.9, 0)[1], r"P5 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P6 c0 = 1 - |c-1| - |c+1|", 1 - preset(2.5, 0)[0] - preset(2.5, 0)[1], r"P6 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P7 c0 = 1 - |c-1| - |c+1|", 1 - preset(3.5, -6.0)[0] - preset(3.5, -6.0)[1], r"P7 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P8 c0 = 1 - |c-1| - |c+1|", 1 - preset(3.5, -3.5)[0] - preset(3.5, -3.5)[1], r"P8 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    ("interfaces/pcie-gen4-gen5", "preset table: P9 c0 = 1 - |c-1| - |c+1|", 1 - preset(3.5, 0)[0] - preset(3.5, 0)[1], r"P9 [\d.]+ dB -?[\d.]+ dB -?[\d.]+ ([\d.]+) ", 0.2),
    # ── USB 3.2 Gen 1 / Gen 2 / Gen 2x2 (C-15, C-143 to C-156) ──
    ("interfaces/usb-3x", "table: Gen 1 UI (ps)", ui_ps(5e9), r"Unit interval (\d+) ps \d+ ps", 0.1),
    ("interfaces/usb-3x", "table: Gen 2 UI (ps)", ui_ps(10e9), r"Unit interval \d+ ps (\d+) ps", 0.1),
    ("interfaces/usb-3x", "table: Gen 1 Nyquist (GHz)", 5 / 2, r"Nyquist frequency ([\d.]+) GHz", 0.1),
    ("interfaces/usb-3x", "table: Gen 2 Nyquist (GHz)", 10 / 2, r"Nyquist frequency [\d.]+ GHz (\d+) GHz", 0.1),
    ("interfaces/usb-3x", "glance: Gen 1 lane after 8b/10b (MB/s)", 5e9 * 8 / 10 / 8 / 1e6, r"one Gen 1 lane carries (\d+) MB/s", 0.1),
    ("interfaces/usb-3x", "glance: Gen 2 lane after 128b/132b (GB/s)", 10e9 * 128 / 132 / 8 / 1e9, r"one Gen 2 lane about ([\d.]+) GB/s", 2),
    ("interfaces/usb-3x", "glance: Gen 1x2 after 8b/10b (GB/s)", 2 * 5e9 * 8 / 10 / 8 / 1e9, r"double that, to (\d+) GB/s", 0.1),
    ("interfaces/usb-3x", "glance: Gen 2x2 after 128b/132b (GB/s)", 2 * 10e9 * 128 / 132 / 8 / 1e9, r"and about ([\d.]+) GB/s for Gen 2x2", 2),
    ("interfaces/usb-3x", "table: Gen 2x2 raw throughput (GB/s)", 2 * 10e9 * 128 / 132 / 8 / 1e9, r"Raw throughput \d+ MB/s about [\d.]+ GB/s about ([\d.]+) GB/s", 2),
    ("interfaces/usb-3x", "glance: each end's share, (23 - 6) / 2 (dB)", (23 - 6) / 2, r"which leaves ([\d.]+) dB for each end", 0.1),
    ("interfaces/usb-3x", "budget: 8.5 + 6 + 8.5 (dB)", 8.5 + 6 + 8.5, r"make 8\.5 \+ 6 \+ 8\.5 = (\d+) dB", 0.1),
    ("interfaces/usb-3x", "why: your share, 8.5 / 23 (%)", 100 * 8.5 / 23, r"your share is 8\.5 of the 23 dB, about (\d+)%", 2),
    ("interfaces/usb-3x", "why: the rest, 14.5 / 23 (%)", 100 * 14.5 / 23, r"the other (\d+)% arrives", 2),
    ("interfaces/usb-3x", "figure: your share (%)", 100 * 8.5 / 23, r"yours: 8\.5 dB, (\d+)%", 2),
    ("interfaces/usb-3x", "figure: their share (dB)", 23 - 8.5, r"ships with the user: ([\d.]+) dB", 0.1),
    ("interfaces/usb-3x", "figure: their share (%)", 100 * 14.5 / 23, r"ships with the user: [\d.]+ dB, (\d+)%", 2),
    ("interfaces/usb-3x", "budget: amplitude left after 23 dB (%)", 100 * 10 ** (-23 / 20), r"means about (\d+)% of the launched", 2),
    ("interfaces/usb-3x", "figure: amplitude left after 23 dB (%)", 100 * 10 ** (-23 / 20), r"23 dB at 5 GHz: about (\d+)% of the launched", 2),
    ("interfaces/usb-3x", "glance: 6 dB of 28 AWG coax at 6.1... 3.1 dB/m (m)", 6 / 3.1, r"about ([\d.]+) m of 28 AWG", 2),
    ("interfaces/usb-3x", "budget: 6 dB of 28 AWG coax at 3.1 dB/m (m)", 6 / 3.1, r"just under 1 m and about ([\d.]+) m of\s*raw cable", 2),
    ("interfaces/usb-3x", "table: Gen 1 TJ, 0.66 UI (ps)", 0.66 * ui_ps(5e9), r"0\.66 UI \((\d+) ps\)", 0.1),
    ("interfaces/usb-3x", "table: Gen 2 TJ, 0.671 UI (ps)", 0.671 * ui_ps(10e9), r"0\.671 UI \(([\d.]+) ps\)", 0.1),
    ("interfaces/usb-3x", "ssc: Gen 1 UI at -5000 ppm (ps)", ui_ps(5e9) / (1 - 5000e-6), r"stretches the 200 ps unit interval to (\d+) ps", 0.1),
    ("interfaces/usb-3x", "figure: Gen 1 UI at -5000 ppm (ps)", ui_ps(5e9) / (1 - 5000e-6), r"200 ps at 0, (\d+) ps at -5000", 0.1),
    ("interfaces/usb-3x", "deeper: half-cycle at 30 kHz (us)", 1 / 30e3 / 2 * 1e6, r"half-cycle of\s*([\d.]+) .s", 0.5),
    ("interfaces/usb-3x", "deeper: SSC phase excursion, 1/2 x 2500 ppm x half-cycle (ns)", 0.5 * 2500e-6 * (1 / 30e3 / 2) * 1e9, r"2500 ppm x [\d.]+ .s ~ (\d+) ns", 2),
    ("interfaces/usb-3x", "deeper: SSC excursion in Gen 1 UI", 0.5 * 2500e-6 * (1 / 30e3 / 2) / (ui_ps(5e9) * 1e-12), r"That is about (\d+) unit intervals at Gen 1", 1),
    ("interfaces/usb-3x", "deeper: SSC excursion in Gen 2 UI", 0.5 * 2500e-6 * (1 / 30e3 / 2) / (ui_ps(10e9) * 1e-12), r"That is about \d+ unit intervals at Gen 1 and (\d+) at Gen 2", 1),
    ("interfaces/usb-3x", "caption: SSC excursion (ns)", 0.5 * 2500e-6 * (1 / 30e3 / 2) * 1e9, r"the data drifts about (\d+) ns", 2),
    ("interfaces/usb-3x", "caption: SSC excursion in Gen 1 UI", 0.5 * 2500e-6 * (1 / 30e3 / 2) / (ui_ps(5e9) * 1e-12), r"about (\d+) unit intervals at Gen 1 and \d+ at Gen 2, so", 1),
    ("interfaces/usb-3x", "caption: SSC excursion in Gen 2 UI", 0.5 * 2500e-6 * (1 / 30e3 / 2) / (ui_ps(10e9) * 1e-12), r"unit intervals at Gen 1 and (\d+) at Gen 2, so", 1),
    ("interfaces/usb-3x", "figure: SSC excursion in Gen 1 UI", 0.5 * 2500e-6 * (1 / 30e3 / 2) / (ui_ps(5e9) * 1e-12), r"21 ns p-p, (\d+) UI at Gen 1", 1),
    ("interfaces/usb-3x", "deeper: triangle slew at 30 kHz (ppm/us)", 5000 / (1 / 30e3 / 2 * 1e6), r"triangle slews at (\d+) ppm", 0.5),
    ("interfaces/usb-3x", "figure: triangle slew at 30 kHz (ppm/us)", 5000 / (1 / 30e3 / 2 * 1e6), r"this triangle slews (\d+) ppm", 0.5),
    ("interfaces/usb-3x", "type-c: 6400 ps of skew in Gen 2 UI", 6400 / ui_ps(10e9), r"6400 ps apart, (\d+) unit intervals", 0.1),
    ("interfaces/usb-3x", "deeper: Gen 2 stimulus c-1", preset(2.2, -3.1)[0], r"c\S+ = -([\d.]+) and c\S+ = -[\d.]+, so the main tap", 1),
    ("interfaces/usb-3x", "deeper: Gen 2 stimulus c+1", preset(2.2, -3.1)[1], r"c\S+ = -[\d.]+ and c\S+ = -([\d.]+), so the main tap", 1),
    ("interfaces/usb-3x", "deeper: Gen 2 stimulus c0", 1 - preset(2.2, -3.1)[0] - preset(2.2, -3.1)[1], r"so the main tap is c\S+ = ([\d.]+)", 0.2),
    ("interfaces/usb-3x", "deeper: Gen 2 stimulus Vb", preset(2.2, -3.1)[2], r"long run is Vb = ([\d.]+)", 0.2),
    ("interfaces/usb-3x", "deeper: Gen 2 stimulus boost (dB)", preset(2.2, -3.1)[3], r"20\.log\(1/0\.582\) = ([\d.]+) dB", 1),

    # ── PCIe 6.0 vs 5.0 ────────────────────────────────────────────────────
    ("interfaces/pcie-gen6", "answer: 64 GT/s PAM4 symbol rate (GBd)", 64 / 2, r"both generations run at (\d+) GBd", 0.1),
    ("interfaces/pcie-gen6", "answer: Nyquist of 32 GBd (GHz)", 64 / 2 / 2, r"carry a (\d+) GHz Nyquist frequency", 0.1),
    ("interfaces/pcie-gen6", "answer: PAM4 eye penalty 20 log10 3 (dB)", 20 * math.log10(3), r"about ([\d.]+) dB less eye height", 1),
    ("interfaces/pcie-gen6", "answer: x16 raw each way, 64 x 16 / 8 (GB/s)", 64 * 16 / 8, r"An x16 link moves (\d+) GB/s in each direction", 0.1),
    ("interfaces/pcie-gen6", "glance: x16 raw each way (GB/s)", 64 * 16 / 8, r"64 \S 16 \S 8 = (\d+) GB/s in each direction", 0.1),
    ("interfaces/pcie-gen6", "glance: x16 raw both ways, PCI-SIG headline (GB/s)", 64 * 16 * 2 / 8, r"the (\d+) GB/s that PCI-SIG quotes", 0.1),
    ("interfaces/pcie-gen6", "glance: x16 each way after flit CRC and FEC (GB/s)", 64 * 16 / 8 * 242 / 256, r"about (\d+) GB/s each way on x16", 0.5),
    ("interfaces/pcie-gen6", "glance: x1 after flit CRC and FEC (GB/s)", 64 / 8 * 242 / 256, r"and ([\d.]+) GB/s per lane", 0.2),
    ("interfaces/pcie-gen6", "glance: x8 after flit CRC and FEC (GB/s)", 64 * 8 / 8 * 242 / 256, r"([\d.]+) on x8,", 0.2),
    ("interfaces/pcie-gen6", "glance: x4 after flit CRC and FEC (GB/s)", 64 * 4 / 8 * 242 / 256, r"([\d.]+) on x4 and", 0.2),
    ("interfaces/pcie-gen6", "glance: flit time on x16 (ns)", 256 * 8 / (64e9 * 16) * 1e9, r"one flit passes in (\d+) ns", 0.1),
    ("interfaces/pcie-gen6", "glance: flit TLP bytes, 256 - 6 - 8 - 6", 256 - 6 - 8 - 6, r"carries (\d+) bytes of transaction-layer", 0.1),
    ("interfaces/pcie-gen6", "FEC section: budget cut, 36 - 32 (dB)", 36 - 32, r"far more than the (\d+) dB the tighter", 0.1),
    ("interfaces/pcie-gen6", "FEC section: PAM4 eye cost (dB)", 20 * math.log10(3), r"PAM4 costs ([\d.]+) dB of eye height", 1),
    ("interfaces/pcie-gen6", "glance: budget cut, 36 - 32 (dB)", 36 - 32, r"(\d+) dB less than PCIe 5\.0", 0.1),
    ("interfaces/pcie-gen6", "glance: card share, 32 - 23.5 (dB)", 32 - 23.5, r"system side and ([\d.]+) dB to the card", 0.1),
    ("interfaces/pcie-gen6", "glance: x16 raw both ways at 128 GT/s (GB/s)", 128 * 16 * 2 / 8, r"up to (\d+) GB/s for an x16 link", 0.1),
    ("interfaces/pcie-gen6", "glance: PCIe 7.0 symbol rate, 128 / 2 (GBd)", 128 / 2, r"works out to (\d+) GBd and a", 0.1),
    ("interfaces/pcie-gen6", "glance: PCIe 7.0 Nyquist (GHz)", 128 / 2 / 2, r"GBd and a (\d+) GHz Nyquist frequency, twice", 0.1),
    ("interfaces/pcie-gen6", "figure: one symbol at 32 GBd (ps)", ui_ps(32e9), r"same ([\d.]+) ps symbol", 0.1),
    ("interfaces/pcie-gen6", "caption: one symbol at 32 GBd (ps)", ui_ps(32e9), r"in each ([\d.]+) ps symbol", 0.1),
    ("interfaces/pcie-gen6", "NRZ at 64 GT/s, lower end, 36 x sqrt 2 (dB)", 36 * math.sqrt(2), r"lose roughly (\d+) to \d+ dB at", 1),
    ("interfaces/pcie-gen6", "NRZ at 64 GT/s, upper end, 36 x 2 (dB)", 36 * 2, r"lose roughly \d+ to (\d+) dB at", 0.1),
    ("interfaces/pcie-gen6", "table: Gen 5 symbol (ps)", ui_ps(32e9), r"PCIe 5\.0 PCIe 6\.0 .*?32 GBd; ([\d.]+) ps", 0.1),
    ("interfaces/pcie-gen6", "table: Gen 1 Nyquist, 2.5 GBd / 2 (GHz)", 2.5 / 2, r"2\.5 GBd ([\d.]+) GHz", 0.1),
    ("interfaces/pcie-gen6", "table: Gen 3 Nyquist, 8 GBd / 2 (GHz)", 8 / 2, r" 8 GBd (\d+) GHz", 0.1),
    ("interfaces/pcie-gen6", "table: Gen 7 symbol rate (GBd)", 128 / 2, r"128 GT/s PAM4, flit (\d+) GBd", 0.1),
    ("interfaces/pcie-gen6", "table: Gen 7 Nyquist (GHz)", 128 / 4, r"128 GT/s PAM4, flit \d+ GBd (\d+) GHz", 0.1),
    ("interfaces/pcie-gen6", "Gen 3 rate step, 8 / 5", 8 / 5, r"rate only ([\d.]+) times", 0.1),
    ("interfaces/pcie-gen6", "8b/10b overhead (%)", 100 * 2 / 10, r"spends (\d+)% of the bits on coding", 0.1),
    ("interfaces/pcie-gen6", "128b/130b overhead (%)", 100 * 2 / 130, r"128b/130b, which spends ([\d.]+)%", 3),
    ("interfaces/pcie-gen6", "8b/10b efficiency (%)", 100 * 8 / 10, r"8b/10b keeps (\d+)% of the bits", 0.1),
    ("interfaces/pcie-gen6", "128b/130b efficiency (%)", 100 * 128 / 130, r"128b/130b keeps ([\d.]+)%", 0.1),
    ("interfaces/pcie-gen6", "Gen 4 x4 after coding (GB/s)", 16 * 4 / 8 * 128 / 130, r"Gen 4 x4 SSD link carries ([\d.]+) GB/s", 0.2),
    ("interfaces/pcie-gen6", "Gen 5 x4 after coding (GB/s)", 32 * 4 / 8 * 128 / 130, r"Gen 5 x4 ([\d.]+) GB/s", 0.5),
    ("interfaces/pcie-gen6", "Gen 5 x16 after coding (GB/s)", 32 * 16 / 8 * 128 / 130, r"x16 graphics slot ([\d.]+) GB/s", 0.2),
    ("interfaces/pcie-gen6", "headline: Gen 6 x16 both ways raw (GB/s)", 64 * 16 * 2 / 8, r"count both directions: (\d+) GB/s for a Gen 6", 0.1),
    ("interfaces/pcie-gen6", "headline: Gen 7 x16 both ways raw (GB/s)", 128 * 16 * 2 / 8, r"and (\d+) GB/s for Gen 7", 0.1),
    ("interfaces/pcie-gen6", "flit: TLP bytes, 256 - 6 - 8 - 6", 256 - 6 - 8 - 6, r"(\d+) bytes of transaction-layer packets", 0.1),
    ("interfaces/pcie-gen6", "flit: CRC + FEC bytes, 8 + 6", 8 + 6, r"(\d+) of every 256 bytes go to CRC and FEC", 0.1),
    ("interfaces/pcie-gen6", "figure: flit time on x16 (ns)", 256 * 8 / (64e9 * 16) * 1e9, r"one flit lasts (\d+) ns on x16", 0.1),
    ("interfaces/pcie-gen6", "figure: flit time on x1 (ns)", 256 * 8 / 64e9 * 1e9, r"one flit lasts \d+ ns on x16 and (\d+) ns on x1", 0.1),
    ("interfaces/pcie-gen6", "deeper: flit time on x16 (ns)", 256 * 8 / (64e9 * 16) * 1e9, r"lanes\) = (\d+) ns on x16", 0.1),
    ("interfaces/pcie-gen6", "deeper: flit time on x1 (ns)", 256 * 8 / 64e9 * 1e9, r"lanes\) = \d+ ns on x16 and (\d+) ns on x1", 0.1),
    ("interfaces/pcie-gen6", "budget figure: card, 32 - 23.5 (dB)", 32 - 23.5, r"card ([\d.]+) \S\d+ dB", 0.1),
    ("interfaces/pcie-gen6", "budget figure: the cut, 36 - 32 (dB)", 36 - 32, r"card [\d.]+ \S(\d+) dB", 0.1),
    ("interfaces/pcie-gen6", "budget figure: 4 dB less to spend", 36 - 32, r"PCIe 5\.0, (\d+) dB less to spend", 0.1),
    ("interfaces/pcie-gen6", "stays the same: 4 dB less allowed", 36 - 32, r"(\d+) dB less loss allowed", 0.1),
    ("interfaces/pcie-gen6", "what to do: loss budget shrinks (dB)", 36 - 32, r"The loss budget tightens by (\d+) dB", 0.1),
    ("interfaces/pcie-gen6", "fault note: budget shrank (dB)", 36 - 32, r"the budget shrank by (\d+) dB", 0.1),
    ("interfaces/pcie-gen6", "real world: PCIe 7.0 Nyquist (GHz)", 128 / 4, r"Nyquist frequency doubles to (\d+) GHz", 0.1),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 1 x1 each way (GB/s)", 2.5 * 1 / 8 * 8 / 10, r"PCIe 1\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 1 x4 each way (GB/s)", 2.5 * 4 / 8 * 8 / 10, r"PCIe 1\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 1 x8 each way (GB/s)", 2.5 * 8 / 8 * 8 / 10, r"PCIe 1\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 1 x16 each way (GB/s)", 2.5 * 16 / 8 * 8 / 10, r"PCIe 1\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 2 x1 each way (GB/s)", 5 * 1 / 8 * 8 / 10, r"PCIe 2\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 2 x4 each way (GB/s)", 5 * 4 / 8 * 8 / 10, r"PCIe 2\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 2 x8 each way (GB/s)", 5 * 8 / 8 * 8 / 10, r"PCIe 2\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 2 x16 each way (GB/s)", 5 * 16 / 8 * 8 / 10, r"PCIe 2\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 3 x1 each way (GB/s)", 8 * 1 / 8 * 128 / 130, r"PCIe 3\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 3 x4 each way (GB/s)", 8 * 4 / 8 * 128 / 130, r"PCIe 3\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 3 x8 each way (GB/s)", 8 * 8 / 8 * 128 / 130, r"PCIe 3\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 3 x16 each way (GB/s)", 8 * 16 / 8 * 128 / 130, r"PCIe 3\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 4 x1 each way (GB/s)", 16 * 1 / 8 * 128 / 130, r"PCIe 4\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 4 x4 each way (GB/s)", 16 * 4 / 8 * 128 / 130, r"PCIe 4\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 4 x8 each way (GB/s)", 16 * 8 / 8 * 128 / 130, r"PCIe 4\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 4 x16 each way (GB/s)", 16 * 16 / 8 * 128 / 130, r"PCIe 4\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 5 x1 each way (GB/s)", 32 * 1 / 8 * 128 / 130, r"PCIe 5\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 5 x4 each way (GB/s)", 32 * 4 / 8 * 128 / 130, r"PCIe 5\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 5 x8 each way (GB/s)", 32 * 8 / 8 * 128 / 130, r"PCIe 5\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 5 x16 each way (GB/s)", 32 * 16 / 8 * 128 / 130, r"PCIe 5\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 6 x1 each way (GB/s)", 64 * 1 / 8 * 242 / 256, r"PCIe 6\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 6 x4 each way (GB/s)", 64 * 4 / 8 * 242 / 256, r"PCIe 6\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 6 x8 each way (GB/s)", 64 * 8 / 8 * 242 / 256, r"PCIe 6\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 6 x16 each way (GB/s)", 64 * 16 / 8 * 242 / 256, r"PCIe 6\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 7 x1 each way (GB/s)", 128 * 1 / 8 * 1, r"PCIe 7\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){0}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 7 x4 each way (GB/s)", 128 * 4 / 8 * 1, r"PCIe 7\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){1}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 7 x8 each way (GB/s)", 128 * 8 / 8 * 1, r"PCIe 7\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){2}([\d.]+)", 0.5),
    ("interfaces/pcie-gen6", "bandwidth table: Gen 7 x16 each way (GB/s)", 128 * 16 / 8 * 1, r"PCIe 7\.0 (?=(?:[\d.]+\*? ){4})(?:[\d.]+\*? ){3}([\d.]+)", 0.5),

    # ── Chiplet interconnects ───────────────────────────────────────────────
    ("interfaces/chiplet-interconnects", "BoW example, interposer: 4096 Gb/s total over 1.60 mm (GB/s/mm)", 256 * 16 / 8 / 1.60, r"that is (\d+) GB/s/mm\. A UCIe-A", 0.1),
    ("interfaces/chiplet-interconnects", "UCIe-A at 16 GT/s, the table scaled, 1317 / 2 (GB/s/mm)", 1317 / 2, r"carries about (\d+) GB/s/mm", 0.2),
    ("interfaces/chiplet-interconnects", "UCIe-A over BoW interposer at 16 Gb/s, 658.5 / 320", (1317 / 2) / 320, r"about\s+([\d.]+) times as much", 0.5),
    ("interfaces/chiplet-interconnects", "UCIe-A depth over BoW interposer depth", 1.585 / 0.42, r"about ([\d.]+) times the BoW example", 2),
    ("interfaces/chiplet-interconnects", "UCIe-A rectangle over BoW, bump density as built", (128 / 8 / (0.389 * 1.585)) / (256 / 8 / (1.60 * 0.42)), r"it carries about ([\d.]+) times as much as the BoW", 2),
    ("interfaces/chiplet-interconnects", "3.8 x 0.55 gives the edge ratio", 3.8 * 0.55, r"times 0\.55 is the ([\d.]+):", 2),
    ("interfaces/chiplet-interconnects", "UCIe-A lowest reading below BoW at a common pitch (%)", 100 * (1 - (128 / 8 / (0.389 * 1.585)) * (45 / 40) ** 2 / (256 / 8 / (1.60 * 0.42))), r"run from about (\d+)% below", 3),
    ("interfaces/chiplet-interconnects", "UCIe-A highest reading above BoW at a common pitch (%)", 100 * (1646 / 32 * (45 / 40) ** 2 / (256 / 8 / (1.60 * 0.42)) - 1), r"example to (\d+)% above it", 3),
    ("interfaces/chiplet-interconnects", "UCIe-S lowest reading below BoW laminate (%)", 100 * (1 - (64 / 8 / (1.143 * 1.54)) * (110 / 130) ** 2 / (256 / 8 / (5.2 * 1.35))), r"UCIe-S.s from about (\d+)% to", 3),
    ("interfaces/chiplet-interconnects", "UCIe-S highest reading below BoW laminate (%)", 100 * (1 - 192 / 32 * (110 / 130) ** 2 / (256 / 8 / (5.2 * 1.35))), r"% to (\d+)% below\. BoW", 10),
    ("interfaces/chiplet-interconnects", "areal row over rectangles, UCIe-S at 110 um", (192 / 32) / (64 / 8 / (1.143 * 1.54)), r"areal row \(C-100\) is about\s+([\d.]+) times denser", 3),
    ("interfaces/chiplet-interconnects", "UCIe-A rectangle read at 45 um, moved to 40 um", (128 / 8 / (0.389 * 1.585)) * (45 / 40) ** 2, r"and ([\d.]+) if the table.s 45", 0.3),
    ("interfaces/chiplet-interconnects", "consortium areal row per Gb/s, 1646 / 32", 1646 / 32, r"at 32 GT/s and 45 .m \(C-100\), ([\d.]+) per Gb/s", 0.2),
    ("interfaces/chiplet-interconnects", "areal row moved to 40 um", 1646 / 32 * (45 / 40) ** 2, r"which is ([\d.]+)\s+at 40", 0.2),
    ("interfaces/chiplet-interconnects", "UCIe-S x32 rectangle per Gb/s", (64 / 8 / (1.143 * 1.54)), r"x32 rectangle gives ([\d.]+) and", 0.3),
    ("interfaces/chiplet-interconnects", "UCIe-S areal row per Gb/s, 192 / 32", 192 / 32, r"and the areal row ([\d.]+), both at 110", 0.5),
    ("interfaces/chiplet-interconnects", "areal row over rectangle, UCIe-S", (192 / 32) / (64 / 8 / (1.143 * 1.54)), r"is about ([\d.]+) times the rectangle for UCIe-S", 0.5),
    ("interfaces/chiplet-interconnects", "areal row over rectangle, UCIe-A at its 55 um label", (1646 / 32) / ((128 / 8 / (0.389 * 1.585)) * (55 / 45) ** 2), r"is about ([\d.]+) times the rectangle for UCIe-S", 1),
    ("interfaces/chiplet-interconnects", "BoW example total, 256 wires x 16 Gb/s (Gb/s)", 256 * 16, r"at 16 Gb/s: (\d+) Gb/s, \d+ GB/s in all", 0.1),
    ("interfaces/chiplet-interconnects", "BoW example total in bytes (GB/s)", 256 * 16 / 8, r"Gb/s, (\d+) GB/s in all", 0.1),
    ("interfaces/chiplet-interconnects", "BoW example over 1.60 mm (GB/s/mm)", 256 * 16 / 8 / 1.60, r"Over 1\.60 mm that is (\d+) GB/s/mm", 0.1),
    ("interfaces/chiplet-interconnects", "BoW example over 1.28 mm (GB/s/mm)", 256 * 16 / 8 / 1.28, r"without the optional AUX and FEC wires, (\d+)\.", 0.1),
    ("interfaces/chiplet-interconnects", "BoW interposer bump density per Gb/s", 256 / 8 / (1.60 * 0.42), r"gives ([\d.]+) GB/s per mm", 0.2),
    ("interfaces/chiplet-interconnects", "UCIe-A module bump density per Gb/s", 128 / 8 / (0.389 * 1.585), r"interposer example at 40 .m and ([\d.]+) for the UCIe-A", 0.05),
    ("interfaces/chiplet-interconnects", "UCIe-A density moved to 40 um", 128 / 8 / (0.389 * 1.585) * (55 / 40) ** 2, r"\(55/40\)2 = (\d+\.\d)", 0.2),
    ("interfaces/chiplet-interconnects", "BoW slices: 8 TX + 8 RX at 16 wires, 16 Gb/s each way (Tb/s)", 8 * 16 * 16 / 1000, r"per wire carry ([\d.]+) Tb/s each way", 3),

    ("interfaces/ucie", "copper 2 x 1 um line, 1.72e-8 / (2e-6 x 1e-6) (ohm/mm)", 1.72e-8 / (2e-6 * 1e-6) / 1000, r"1 um thick has about ([\d.]+) ohm/mm", 1),
    ("interfaces/ucie", "terminated swing with no wire resistance, 50 / (50 + 40)", 50 / 90, r"settled level falls from ([\d.]+) to", 1),
    ("interfaces/ucie", "terminated swing with 20 ohm/mm over 2 mm, 50 / (50 + 40 + 40)", 50 / 130, r"falls from [\d.]+ to ([\d.]+) of the source", 1.5),
    ("interfaces/ucie", "3D: 4,000 GB/s/mm2 x 8 x 0.05 pJ/b (W/mm2)", 4000 * 8 * 0.05 / 1000, r"0\.05 pJ/b is ([\d.]+) W/mm2", 0.1),
    ("interfaces/ucie", "3D: 300,000 GB/s/mm2 x 8 x 0.01 pJ/b (W/mm2)", 300000 * 8 * 0.01 / 1000, r"0\.01 pJ/b target is (\d+) W/mm2", 0.1),
    ("interfaces/ucie", "3D: H100 700 W over 814 mm2 (W/mm2)", 700 / 814, r"averages about ([\d.]+) W/mm2", 0.5),
    ("interfaces/ucie", "3D: 24 W/mm2 over the H100 average", 24 / (700 / 814), r"run about (\d+) times hotter", 1),
    ("interfaces/ucie", "3D: share of wires busy within the H100 average at 1 um (%)", 100 * (700 / 814) / 24, r"allows only about ([\d.]+)% of the wires", 1),
    ("interfaces/ucie", "3D: density rise from 9 to 1 um", 300000 / 4000, r"density rises (\d+)-fold", 0.1),
    # ── LPDDR6 ──────────────────────────────────────────────────────────────
    ("interfaces/lpddr6", "glance: raw bandwidth at 10.667 (GB/s)", 24 * 10.667 / 8, r"carries ([\d.]+) GB/s of raw bandwidth", 0.2),
    ("interfaces/lpddr6", "glance: data bandwidth at 10.667 (GB/s)", 24 * 10.667 / 8 * 256 / 288, r"per pin, ([\d.]+) GB/s of it data", 0.3),
    ("interfaces/lpddr6", "glance: data bandwidth at 14.4 (GB/s)", 24 * 14.4 / 8 * 256 / 288, r"and ([\d.]+) GB/s of data at 14.4 Gb/s", 0.2),
    ("interfaces/lpddr6", "glance: LPDDR5X channel at 8533 (GB/s)", 16 * 8.533 / 8, r"8533 MT/s carries ([\d.]+) GB/s", 0.3),
    ("interfaces/lpddr6", "UI at 10.667 Gb/s (ps)", ui_ps(10.667e9), r"a bit lasts ([\d.]+) ps and", 0.1),
    ("interfaces/lpddr6", "UI at 14.4 Gb/s (ps)", ui_ps(14.4e9), r"ps and ([\d.]+) ps \. The fir", 0.2),
    ("interfaces/lpddr6", "UI of LPDDR5 at 6400 (ps)", ui_ps(6400e6), r"6400 MT/s gave each bit (\d+) ps", 0.5),
    ("interfaces/lpddr6", "UI at 14.4 Gb/s, rounded (ps)", ui_ps(14.4e9), r"top defined rate gives it (\d+) ps", 1),
    ("interfaces/lpddr6", "PAM4 eye, a third of 250 mV (mV)", 250 / 3, r"anything: (\d+) mV of a 250 mV swing", 0.5),
    ("interfaces/lpddr6", "PAM4 penalty, 20 log10 3 (dB)", 20 * math.log10(3), r"a loss of ([\d.]+) dB", 1),
    ("interfaces/lpddr6", "deeper: PAM4 penalty (dB)", 20 * math.log10(3), r"or ([\d.]+) dB\. In return", 0.1),
    ("interfaces/lpddr6", "CK at 10.667 Gb/s with WCK = 2 CK and data on both WCK edges (GHz)", 10.667 / 4, r"runs at ([\d.]+) GHz at the starting rate", 0.1),
    ("interfaces/lpddr6", "WCK = 2 CK (GHz)", 10.667 / 2, r"runs at twice CK, ([\d.]+) GHz", 0.1),
    ("interfaces/lpddr6", "CA pin rate, DDR on CK (Gb/s)", 2 * 10.667 / 4, r"each runs at ([\d.]+) Gb/s", 0.1),
    ("interfaces/lpddr6", "LPDDR5X CK, 1066.5 MHz (GHz)", 1.0665, r"against ([\d.]+) GHz on LPDDR5X", 0.5),
    ("interfaces/lpddr6", "12 DQ x BL24 (bits)", 12 * 24, r"burst of 24 make (\d+) ,", 0.1),
    ("interfaces/lpddr6", "12 DQ x BL16 (bits)", 12 * 16, r"would make (\d+) bits", 0.1),
    ("interfaces/lpddr6", "LVSTL swing, 0.5 V x 40/80 (mV)", 500 * 40 / 80, r"the model.s choice, that is (\d+) mV", 0.1),
    ("interfaces/lpddr6", "energy of a 1 at 10.667 Gb/s (pJ)", 0.25 / 80 * ui_ps(10.667e9), r"costs about ([\d.]+) pJ of termination", 2),
    ("interfaces/lpddr6", "deeper: energy of a 1 (pJ)", 0.25 / 80 * ui_ps(10.667e9), r"for 93.75 ps, about ([\d.]+) pJ", 2),
    ("interfaces/lpddr6", "24 pins at 10.667 Gb/s (GB/s)", 24 * 10.667 / 8, r"10.667 Gb/s moves ([\d.]+) GB/s on the wire", 0.2),
    ("interfaces/lpddr6", "data share, x 256/288 (GB/s)", 24 * 10.667 / 8 * 256 / 288, r"of which ([\d.]+) GB/s is data", 0.3),
    ("interfaces/lpddr6", "data at 14.4 Gb/s (GB/s)", 24 * 14.4 / 8 * 256 / 288, r"at 14.4 Gb/s, ([\d.]+) GB/s of data", 0.2),
    ("interfaces/lpddr6", "LPDDR5X 16 pins at 8533 (GB/s)", 16 * 8.533 / 8, r"8533 MT/s moves ([\d.]+) GB/s", 0.3),
    ("interfaces/lpddr6", "faster NRZ, 24/16 of 10.667 (Gb/s)", 10.667 * 24 / 16, r"the rate: (\d+) Gb/s for the starting bin", 0.5),
    ("interfaces/lpddr6", "PAM4 baud, half of that (GBd)", 10.667 * 24 / 32, r"at half that, (\d+) GBd", 0.5),
    # Bandwidth table, figure and comparison (23 Oct 2026): rate x pins / 8, LPDDR6 data = 256/288 of it (C-56, C-192).
    *[("interfaces/lpddr6", "bandwidth table: %s %s, column %d (GB/s)" % (lab, gen, k), v,
       re.escape("%s %s " % (lab, gen)) + r"(?:[\d.]+ ){%d}([\d.]+)" % k, 0.2)
      for lab, gen, r, pins, wide, share in (
          ("8533 MT/s", "LPDDR5X, x16 channel", 8.533, 16, 64, 1),
          ("10.7 Gb/s", "LPDDR5X, vendor parts", 10.7, 16, 64, 1),
          ("10.667 Gb/s", "LPDDR6, x24 channel, first bin", 10.667, 24, 96, 256 / 288),
          ("12.8 Gb/s", "LPDDR6, in vendor material", 12.8, 24, 96, 256 / 288),
          ("14.4 Gb/s", "LPDDR6, highest defined", 14.4, 24, 96, 256 / 288))
      for k, v in enumerate((r * pins / 8, r * pins / 8 * share, r * wide / 8 * share))],
    ("interfaces/lpddr6", "bandwidth: LPDDR6 at 10.667 vs LPDDR5X at 10.7, data per channel (% more)",
     100 * ((24 * 10.667 / 8 * 256 / 288) / (16 * 10.7 / 8) - 1), r"channel carries (\d+)% more data", 1.5),
    ("interfaces/lpddr6", "figure: UI of LPDDR5X at 10700 MT/s (ps)", ui_ps(10.7e9), r"10700 ([\d.]+) ps", 0.1),

    # ── DDR5 ────────────────────────────────────────────────────────────────
    ("interfaces/ddr5", "UI at 3200 MT/s (ps)", ui_ps(3200e6), r"At 3200 MT/s a bit lasts ([\d.]+) ps", 0.1),
    ("interfaces/ddr5", "UI at 4800 MT/s (ps)", ui_ps(4800e6), r"at 4800, (\d+) ps", 0.5),
    ("interfaces/ddr5", "UI at 6400 MT/s (ps)", ui_ps(6400e6), r"at 6400, (\d+) ps", 0.5),
    ("interfaces/ddr5", "UI at 8800 MT/s (ps)", ui_ps(8800e6), r"at 8800, (\d+) ps", 0.5),
    ("interfaces/ddr5", "tCK at 6400 MT/s, two transfers a clock (ps)", 2 * ui_ps(6400e6), r"one clock period, t CK , is ([\d.]+) ps", 0.1),
    ("interfaces/ddr5", "POD low level, 1.1 V x 34/(34+40) (V)", 1.1 * 34 / 74, r"0: ([\d.]+) V", 0.2),
    ("interfaces/ddr5", "POD swing, 1.1 V x 40/(34+40) (mV)", 1100 * 40 / 74, r"Vref \d+% (\d+) mV", 0.2),
    ("interfaces/ddr5", "POD eye centre as a share of VDDQ (%)", (1.1 + 1.1 * 34 / 74) / 2 / 1.1 * 100, r"Vref (\d+)% \d+ mV", 1),
    ("interfaces/ddr5", "caption: POD low level (V)", 1.1 * 34 / 74, r"With 34 ohm and 40 ohm that is ([\d.]+) V", 0.2),
    ("interfaces/ddr5", "caption: POD swing (mV)", 1100 * 40 / 74, r"a swing of (\d+) mV", 0.2),
    ("interfaces/ddr5", "caption: eye centre (%)", (1.1 + 1.1 * 34 / 74) / 2 / 1.1 * 100, r"eye sits at (\d+)% of V DDQ", 1),
    ("interfaces/ddr5", "VrefDQ step, 0.5% of 1.1 V (mV)", 0.005 * 1100, r"0.5% of V DDQ , ([\d.]+) mV", 0.1),
    ("interfaces/ddr5", "10 mm between slots at 6.7 ps/mm (ps)", 10 * 6.7, r"10 mm of trace between slots \( (\d+) ps", 1),
    ("interfaces/ddr5", "20 mm on the module at 6.7 ps/mm (ps)", 20 * 6.7, r"20 mm on the module \( (\d+) ps", 0.5),
    ("interfaces/ddr5", "far branch one way, 67 + 25 + 134 + 30 (ps)", 67 + 25 + 134 + 30, r"(\d+) ps one way", 0.5),
    ("interfaces/ddr5", "far branch round trip (ps)", 2 * (67 + 25 + 134 + 30), r"and (\d+) ps there and back", 0.5),
    ("interfaces/ddr5", "echo at 4800 MT/s (UI)", 512 / ui_ps(4800e6), r"that echo lands ([\d.]+) bits", 2),
    ("interfaces/ddr5", "echo at 6400 MT/s (UI)", 512 / ui_ps(6400e6), r"at 6400, ([\d.]+) bits", 2),
    ("interfaces/ddr5", "echo at 8800 MT/s (UI)", 512 / ui_ps(8800e6), r"bits; at 8800, ([\d.]+) \.", 2),
    ("interfaces/ddr5", "near branch one way, 25 + 134 + 30 (ps)", 25 + 134 + 30, r"(\d+) ps each way", 0.5),
    ("interfaces/ddr5", "near branch round trip (ps)", 2 * (25 + 134 + 30), r"each way and (\d+) ps there and back", 0.5),
    ("interfaces/ddr5", "near-branch echo at 4800 MT/s (UI)", 378 / ui_ps(4800e6), r"about ([\d.]+) bits at 4800 MT/s", 2),
    ("interfaces/ddr5", "fly-by line capacitance per 12 mm pitch, 6.7 x 12 / 50 (pF)", 6.7 * 12 / 50, r"each pitch of line holds ([\d.]+) pF", 0.5),
    ("interfaces/ddr5", "loaded slow-down, sqrt(1 + 1/1.608)", math.sqrt(1 + 1 / (6.7 * 12 / 50)), r"slows by a factor of ([\d.]+)", 0.5),
    ("interfaces/ddr5", "loaded delay per pitch (ps)", 6.7 * 12 * math.sqrt(1 + 1 / (6.7 * 12 / 50)), r"each gap now takes (\d+) ps", 0.5),
    ("interfaces/ddr5", "unloaded delay per pitch (ps)", 6.7 * 12, r"ps instead of (\d+),", 1),
    ("interfaces/ddr5", "loaded impedance (ohm)", 50 / math.sqrt(1 + 1 / (6.7 * 12 / 50)), r"the line looks like ([\d.]+) ohm", 0.2),
    ("interfaces/ddr5", "fly-by skew over four pitches (ps)", 4 * 6.7 * 12 * math.sqrt(1 + 1 / (6.7 * 12 / 50)), r"subchannel (\d+) ps after the first", 0.5),
    ("interfaces/ddr5", "fly-by skew in tCK at 6400", 4 * 6.7 * 12 * math.sqrt(1 + 1 / (6.7 * 12 / 50)) / (2 * ui_ps(6400e6)), r"that is ([\d.]+) clock periods", 1),
    ("interfaces/ddr5", "fly-by skew in tCK at 8800", 4 * 6.7 * 12 * math.sqrt(1 + 1 / (6.7 * 12 / 50)) / (2 * ui_ps(8800e6)), r"clock periods; at 8800, ([\d.]+)", 1),
    ("interfaces/ddr5", "1e16 bits at 6400 MT/s, in days", 1e16 * ui_ps(6400e6) * 1e-12 / 86400, r"errs about once every (\d+) days", 1),
    ("interfaces/ddr5", "1e16 bits over 80 lanes at 6400 MT/s, in hours", 1e16 * ui_ps(6400e6) * 1e-12 / 80 / 3600, r"about once every ([\d.]+) hours", 1),
    ("interfaces/ddr5", "bits for 1e-9 at 99.5% confidence, x 1e9", -math.log(0.005) / 1e-9 / 1e9, r"needs ([\d.]+) x 10 9 bits", 1),
    ("interfaces/ddr5", "time for those bits on one lane at 6400 MT/s (s)", -math.log(0.005) / 1e-9 * ui_ps(6400e6) * 1e-12, r"error \(-ln\(0.005\)/10 -9 \), ([\d.]+) s", 1),
    ("interfaces/ddr5", "subchannel burst, 32 bits x 16 (bytes)", 32 * 16 / 8, r"(\d+) bytes from one subchannel", 0.5),
    # At a glance, bandwidth table and routing section (22 Oct 2026). Lengths at the page's 6.7 ps/mm, 170 ps/in.
    ("interfaces/ddr5", "at a glance: UI at 8800 MT/s (ps)", ui_ps(8800e6), r"where each bit lasts (\d+) ps", 0.5),
    ("interfaces/ddr5", "at a glance: DIMM at 4800 MT/s, x64 (GB/s)", 4800 * 64 / 8 / 1000, r"subchannels: ([\d.]+) GB/s at 4800", 0.2),
    ("interfaces/ddr5", "at a glance: DIMM at 6400 MT/s, x64 (GB/s)", 6400 * 64 / 8 / 1000, r"GB/s at 4800 MT/s and ([\d.]+) GB/s at 6400", 0.2),
    *[("interfaces/ddr5", "bandwidth table: %d MT/s %s, x%d (GB/s)" % (r, lab, w),
       r * w / 8 / 1000,
       re.escape("%d MT/s %s " % (r, lab)) + r"(?:[\d.]+ ){%d}([\d.]+)" % k, 0.2)
      for r, lab in ((4800, "4th Gen Xeon server, one DIMM per channel"),
                     (5600, "5th Gen Xeon server, one DIMM per channel"),
                     (6400, "client DIMMs without a clock driver"),
                     (7200, "clocked client DIMMs, first version"),
                     (8000, "RDIMM interface chips announced"),
                     (8800, "top of the JESD79-5C timing"),
                     (8800, "MRDIMM Gen1, DRAMs at 4400"),
                     (12800, "MRDIMM Gen2 target, DRAMs at 6400"))
      for k, w in enumerate((32, 64))],
    ("interfaces/ddr5", "MRDIMM Gen1: DRAMs at half the bus rate", 8800 / 2, r"8800 MT/s MRDIMM Gen1, DRAMs at (\d+)", 0.1),
    ("interfaces/ddr5", "MRDIMM Gen2: DRAMs at half the bus rate", 12800 / 2, r"MRDIMM Gen2 target, DRAMs at (\d+)", 0.1),
    ("interfaces/ddr5", "real world: MRDIMM Gen1 DRAMs at half of 8800", 8800 / 2, r"on the bus from DRAMs at (\d+)", 0.1),
    ("interfaces/ddr5", "routing: 4.5 in one way at 170 ps/in (ps)", 4.5 * 170, r"4.5 inches is (\d+) ps one way", 0.5),
    ("interfaces/ddr5", "routing: 4.5 in round trip (ps)", 2 * 4.5 * 170, r"is \d+ ps one way and (\d+) ps there and back", 0.5),
    ("interfaces/ddr5", "routing: round trip in 6400 MT/s bits", 2 * 4.5 * 170 / ui_ps(6400e6), r"there and back, about ([\d.]+) bits at 6400", 1),
    ("interfaces/ddr5", "routing: 4.5 in (mm)", 4.5 * 25.4, r"4.5 inches is (\d+) mm", 0.5),
    ("interfaces/ddr5", "routing: 3.5 ps at 170 ps/in (mm)", 3.5 / 170 * 25.4, r"is about ±\s?([\d.]+) mm of trace", 10),
    ("interfaces/ddr5", "routing: 3.5 ps of a 6400 MT/s bit (%)", 3.5 / ui_ps(6400e6) * 100, r"trace, and ([\d.]+)% of a bit at 6400", 2.5),
    ("interfaces/ddr5", "routing: 50 ohm line loaded with 1 pF per 12 mm (ohm)", 50 / math.sqrt(1 + 1 / (6.7 * 12 / 50)), r"every 12 mm behaves like ([\d.]+) ", 0.2),
    ("interfaces/ddr5", "routing: 0.025 mm at 6.7 ps/mm (ps)", 0.025 * 6.7, r"on the module, about ([\d.]+) ps", 2),

    (F + "/tdr", "round trip per inch at 170 ps/in (ps)",
     2 * 170, r"each inch of trace is (\d+) ps of round trip", 0.5),
    (F + "/tdr", "resolution of a 35 ps edge, tr.v/2 (in)",
     35 / (2 * 170), r"a 35 ps edge resolves about ([\d.]+) in", 5),
    (F + "/tdr", "resolution of a 10 ps edge, tr.v/2 (in)",
     10 / (2 * 170), r"a 10 ps edge about ([\d.]+) in", 5),
    (F + "/tdr", "dip area of 0.5 pF on 50 ohm, Z0.C/2 (ps)",
     50 * 0.5e-12 / 2 * 1e12, r"that is ([\d.]+) ps of", 0.5),
    (F + "/tdr", "bump area of 1 nH on 50 ohm, L/(2 Z0) (ps)",
     1e-9 / (2 * 50) * 1e12, r"for a 1 nH bump, (\d+) ps", 0.5),
    (F + "/loss-mechanisms", "skin depth at 1 GHz (um)",
     skin(1), r"([\d.]+) um at 1 GHz", 2),
    (F + "/loss-mechanisms", "skin depth at 10 GHz (um)",
     skin(10), r"([\d.]+) um at 10 GHz", 3),
    (F + "/loss-mechanisms", "figure: skin depth at 1 GHz (um)",
     skin(1), r"confined to about (\d+) um of the surface", 5),
    (F + "/loss-mechanisms", "figure: skin depth at 10 GHz (um)",
     skin(10), r"at 10 GHz to ([\d.]+) um", 3),
    (F + "/loss-mechanisms", "dielectric loss Df .008 at 10 GHz (dB/in)",
     diel(10, 0.008, 3.8), r"~ ([\d.]+) dB/inch at 10 GHz from dielectric alone", 3),
    (F + "/loss-mechanisms", "dielectric loss Df .003 at 10 GHz (dB/in)",
     diel(10, 0.003, 3.8), r"cuts that to ([\d.]+) dB/inch", 5),
    (F + "/eye-diagram", "UI at 32 GT/s (ps)",
     ui_ps(32e9), r"32 GT/s a UI is ([\d.]+) ps", 1),
    (F + "/eye-diagram", "UI at 16 GT/s (ps)",
     ui_ps(16e9), r"at 16 GT/s it is ([\d.]+) ps", 1),
    (F + "/eye-diagram", "UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"8533 MT/s occupies about (\d+) ps", 2),
    (F + "/jitter-taxonomy", "2 x Q at BER 1e-12",
     2 * qinv(1e-12), r"multiplier on RJ is ([\d.]+)s", 1),
    (F + "/jitter-taxonomy", "2 x Q at BER 1e-15",
     2 * qinv(1e-15), r"At 10-15 it is ([\d.]+)s", 1),
    (F + "/vias", "60 mil stub resonance (GHz)",
     stub(60, 4.0), r"60 mil stub in D_k 4.0 resonates near (\d+) GHz", 4),
    (F + "/vias", "200 mil stub resonance (GHz)",
     stub(200, 4.0), r"lands at about ([\d.]+) GHz", 3),
    (F + "/return-current-paths", "return within +/-h (%)",
     lorentz_frac(1), r"(\d+)% within .h", 2),
    (F + "/return-current-paths", "return within +/-3h (%)",
     lorentz_frac(3), r"(\d+)% within .3h", 2),
    (P + "/decoupling-capacitors", "SRF of 100 nF with 1.6 nH (MHz)",
     srf(100e-9, 1.6e-9) / 1e6, r"resonates at about (\d+) MHz", 5),
    (P + "/decoupling-capacitors", "|Z| at 50 MHz, 1.6 nH mounted over 0.4 nH datasheet, 100 nF (ratio)",
     abs(2 * math.pi * 50e6 * 1.6e-9 - 1 / (2 * math.pi * 50e6 * 100e-9))
     / abs(2 * math.pi * 50e6 * 0.4e-9 - 1 / (2 * math.pi * 50e6 * 100e-9)),
     r"impedance is about (\d+)x higher", 5),
    (P + "/decoupling-capacitors", "figure: SRF of 100 nF with the 0402's 0.4 nH (MHz)",
     srf(100e-9, 0.4e-9) / 1e6, r"resonance from (\d+) MHz down", 2),
    (P + "/decoupling-capacitors", "figure: SRF with 1.2 nH mounting added (MHz)",
     srf(100e-9, 1.6e-9) / 1e6, r"MHz down to ([\d.]+) MHz", 1),
    (P + "/target-impedance", "noise budget, 0.75 V at 5% (mV)",
     0.75 * 0.05 * 1000, r"gives ([\d.]+) mV of budget", 1),
    (P + "/target-impedance", "target impedance (mohm)",
     0.75 * 0.05 / 10 * 1000, r"Z_target = ([\d.]+) m", 1),
    (P + "/target-impedance", "figure: 5% of 0.75 V (mV)",
     0.75 * 0.05 * 1000, r"which is .([\d.]+) mV at 0.75 V", 1),
    (P + "/target-impedance", "figure: 37.5 mV over 10 A (mohm)",
     0.75 * 0.05 / 10 * 1000, r"mV / 10 A = ([\d.]+) m", 1),
    (P + "/plane-resonance", "first cavity mode, 100x80 mm Dk 4.2 (MHz)",
     plane_mode(100, 80, 4.2), r"first mode at about (\d+) MHz", 3),
    (P + "/plane-resonance", "figure: (1,0) mode (MHz)",
     plane_mode(100, 80, 4.2, 1, 0), r"first mode, near (\d+) MHz", 0.2),
    (P + "/plane-resonance", "figure: (0,1) mode (MHz)",
     plane_mode(100, 80, 4.2, 0, 1), r"second, near (\d+) MHz", 0.2),
    (P + "/plane-resonance", "figure: (1,1) mode (MHz)",
     plane_mode(100, 80, 4.2, 1, 1), r"third, near (\d+) MHz", 0.2),
    (P + "/ssn-ground-bounce", "di/dt per DQ (x 1e7 A/s)",
     13e-3 / 150e-12 / 1e7, r"~ ([\d.]+) x 10 ?7 A/s", 3),
    (P + "/ssn-ground-bounce", "16 DQ mean slope (x 1e9 A/s)",
     16 * 13e-3 / 150e-12 / 1e9, r"mean slope of ~ ([\d.]+) x 109 A/s", 4),
    (S + "/nrz-vs-pam4", "PAM4 amplitude penalty (dB)",
     20 * math.log10(3), r"20.log ?10 ?\(3\) ~ ([\d.]+) dB", 2),
    (I + "/pcie-gen6", "PAM4 amplitude penalty (dB)",
     20 * math.log10(3), r"20.log ?10 ?\(3\) ~ ([\d.]+) dB", 2),
    # ── LPDDR5X, rebuilt 18 Oct 2026. Rates C-2a/C-169, clocks C-4a/C-167. A
    # transfer rate is bits per pin per second, so UI = 1/rate; data on both WCK
    # edges makes WCK = rate/2, and 4:1 makes CK = rate/8.
    (I + "/lpddr5x", "UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"where each bit lasts about (\d+) ps", 1),
    (I + "/lpddr5x", "figure: UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"spent from a (\d+) ps bit", 1),
    (I + "/lpddr5x", "reflections: UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"Against a (\d+) ps bit, even", 1),
    (I + "/lpddr5x", "x16 channel bandwidth at 8533 MT/s (GB/s)",
     8.533e9 * 16 / 8 / 1e9, r"16-bit channel at 8533 MT/s moves ([\d.]+) GB/s", 0.5),
    (I + "/lpddr5x", "x16 channel bandwidth at 10.7 Gb/s (GB/s)",
     10.7e9 * 16 / 8 / 1e9, r"and at 10.7 Gb/s ([\d.]+) GB/s", 0.5),
    (I + "/lpddr5x", "CK at 8533 MT/s, 4:1 (MHz)",
     8533 / 8, r"At 8533 MT/s CK runs at ([\d.]+) MHz", 0.1),
    (I + "/lpddr5x", "WCK at 8533 MT/s (MHz)",
     8533 / 2, r"and WCK at ([\d.]+) MHz ?, and data moves", 0.1),
    (I + "/lpddr5x", "caption: CK at 8533 MT/s (MHz)",
     8533 / 8, r"CK runs at ([\d.]+) MHz and WCK at [\d.]+ MHz \(C-167\)\. Data", 0.1),
    (I + "/lpddr5x", "caption: WCK at 8533 MT/s (MHz)",
     8533 / 2, r"MHz and WCK at ([\d.]+) MHz \(C-167\)\. Data", 0.1),
    (I + "/lpddr5x", "caption: CA rate, both CK edges (Mb/s)",
     8533 / 4, r"they move at (\d+) Mb/s, a quarter", 0.1),
    (I + "/lpddr5x", "caption: one CA bit at 2133 Mb/s (ps)",
     ui_ps(8.533e9 / 4), r"the command bus gets (\d+) ps", 0.5),
    (I + "/lpddr5x", "figure: one CK period at 8533 MT/s (ps)",
     ui_ps(8.533e9 / 8), r"one CK cycle at 8533 MT/s: (\d+) ps", 0.5),
    (I + "/lpddr5x", "figure: WCK period at 8533 MT/s (ps)",
     ui_ps(8.533e9 / 2), r"four cycles per CK, (\d+) ps each", 0.5),
    (I + "/lpddr5x", "figure: one bit (ps)",
     ui_ps(8.533e9), r"one bit: (\d+) ps", 1),
    (I + "/lpddr5x", "table: UI at LPDDR4X 4267 Mb/s (ps)",
     ui_ps(4.267e9), r"Unit interval at the top rate (\d+) ps", 0.5),
    (I + "/lpddr5x", "table: UI at LPDDR5 6400 MT/s (ps)",
     ui_ps(6.4e9), r"top rate \d+ ps (\d+) ps", 0.5),
    (I + "/lpddr5x", "table: UI at LPDDR5X 8533 MT/s (ps)",
     ui_ps(8.533e9), r"top rate \d+ ps \d+ ps (\d+) ps;", 0.5),
    (I + "/lpddr5x", "table: UI at 10.7 Gb/s (ps)",
     ui_ps(10.7e9), r"(\d+) ps at 10.7 Gb/s (\d+) to", 0.6),
    (I + "/lpddr5x", "table: UI at LPDDR6 10.667 Gb/s (ps)",
     ui_ps(10.667e9), r"(\d+) to \d+ ps Data pins", 0.6),
    (I + "/lpddr5x", "table: UI at LPDDR6 14.4 Gb/s (ps)",
     ui_ps(14.4e9), r"\d+ to (\d+) ps Data pins", 1),
    (I + "/lpddr5x", "3.0 in round trip at 170 ps/in (ps)",
     2 * 3.0 * 170.0, r"the round trip is about (\d+) ps", 1),
    (I + "/lpddr5x", "3.0 in round trip in 8533 MT/s bits",
     2 * 3.0 * 170.0 / ui_ps(8.533e9), r"nearly ([\d.]+) bits", 1),
    (I + "/lpddr5x", "deeper: 1e6/8533 (ps)",
     ui_ps(8.533e9), r"/8533 = ([\d.]+) ps", 0.1),
    (I + "/lpddr5x", "deeper: WCK = rate/2 (MHz)",
     8533 / 2, r"half the transfer rate, ([\d.]+) MHz", 0.1),
    (I + "/lpddr5x", "deeper: WCK period (ps)",
     ui_ps(8.533e9 / 2), r"a period of (\d+) ps\. At 4:1", 0.5),
    (I + "/lpddr5x", "deeper: CK = rate/8 (MHz)",
     8533 / 8, r"an eighth of the transfer rate, ([\d.]+) MHz", 0.1),
    (I + "/lpddr5x", "deeper: CK period (ps)",
     ui_ps(8.533e9 / 8), r"a period of (\d+) ps ?\. The same arithmetic", 0.5),
    (I + "/lpddr5x", "deeper: CK at 6400 MT/s, 4:1 (MHz)",
     6400 / 8, r"gives the (\d+) MHz CK", 0.1),
    (I + "/lpddr5x", "deeper: UI at 10.7 Gb/s (ps)",
     ui_ps(10.7e9), r"at 10.7 Gb/s a bit of (\d+) ps", 0.6),
    (I + "/lpddr5x", "vs table: UI at 6400 MT/s (ps)",
     ui_ps(6.4e9), r"Bit time at the top bin (\d+) ps", 0.5),
    (I + "/lpddr5x", "vs table: UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"Bit time at the top bin \d+ ps (\d+) ps;", 0.5),
    (I + "/lpddr5x", "vs table: UI at 10.7 Gb/s (ps)",
     ui_ps(10.7e9), r"(\d+) ps at 10.7 Gb/s CK and WCK", 0.6),
    (I + "/lpddr5x", "vs table: CK at 6400 MT/s, 4:1 (MHz)",
     6400 / 8, r"CK and WCK at the top bin (\d+) MHz", 0.1),
    (I + "/lpddr5x", "vs table: WCK at 6400 MT/s (MHz)",
     6400 / 2, r"CK and WCK at the top bin \d+ MHz and (\d+) MHz", 0.1),
    (I + "/lpddr5x", "vs table: CK at 8533 MT/s (MHz)",
     8533 / 8, r"\(C-4a\) ([\d.]+) MHz and [\d.]+ MHz \(C-167\)", 0.1),
    (I + "/lpddr5x", "vs table: WCK at 8533 MT/s (MHz)",
     8533 / 2, r"\(C-4a\) [\d.]+ MHz and ([\d.]+) MHz \(C-167\)", 0.1),
    (I + "/lpddr5x", "compatibility: UI at 6400 MT/s (ps)",
     ui_ps(6.4e9), r"6400 MT/s had a (\d+) ps bit", 0.5),
    (I + "/lpddr5x", "compatibility: UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"at 8533 it has (\d+) ps", 0.5),
    # Bandwidth table: rate x width / 8, every cell (19 Oct 2026).
    *[(I + "/lpddr5x", "bandwidth table: %d MT/s, x%d (GB/s)" % (r, w),
       r * w / 8 / 1000,
       re.escape("%d MT/s %s " % (r, lab)) + r"(?:[\d.]+ ){%d}([\d.]+)" % k, 0.2)
      for r, lab in ((6400, "LPDDR5 top bin"), (7500, "LPDDR5X"),
                     (8533, "LPDDR5X top bin in JESD209-5B"), (9600, "vendor parts"),
                     (10700, "vendor parts, sold as 10.7 Gb/s"))
      for k, w in enumerate((16, 32, 64, 128))],
    # CAMM2 section, from JESD318B (C-176, C-177, C-175); 6.7 ps/mm is the page's assumption.
    (I + "/lpddr5x", "CAMM2: 40 mm motherboard round trip (ps)",
     2 * 40 * 170.0 / 25.4, r"a round trip of about (\d+) ps", 1),
    (I + "/lpddr5x", "CAMM2: 40 mm round trip in 8533 MT/s bits",
     2 * 40 * 170.0 / 25.4 / ui_ps(8.533e9), r"or ([\d.]+) bits at 8533 MT/s", 1.5),
    (I + "/lpddr5x", "CAMM2: 0.6 mm at 6.7 ps/mm (ps)",
     0.6 * 6.7, r"within 0.6 mm of its byte.s read strobe, about (\d+) ps", 3),
    (I + "/lpddr5x", "CAMM2: DQ-WCK window, -2 to +3.2 mm (mm)",
     3.2 - (-2), r"data-to-WCK window is ([\d.]+) mm wide", 0.1),
    (I + "/lpddr5x", "CAMM2: 5.2 mm at 6.7 ps/mm (ps)",
     5.2 * 6.7, r"mm wide, about (\d+) ps", 1.5),
    (I + "/lpddr5x", "CAMM2: VDDQ range 1 window, 0.577 - 0.477 V (mV)",
     1000 * (0.577 - 0.477), r"a (\d+) mV window around 0.507 V", 0.1),
    # PS-007A connector limits (C-180) scaled to the 250 mV LPDDR5 signalling level (C-166).
    (I + "/lpddr5x", "PS-007A: Nyquist at 8533 MT/s (GHz)",
     8.533 / 2, r"half the transfer rate: ([\d.]+) GHz at 8533", 0.2),
    (I + "/lpddr5x", "PS-007A: Nyquist at 10.7 Gb/s (GHz)",
     10.7 / 2, r"and ([\d.]+) GHz at 10.7 Gb/s\. Before", 0.2),
    *[(I + "/lpddr5x", "PS-007A scale: %s" % d, v, rx, t) for d, v, rx, t in (
        ("IL -0.40 dB, % lost", 100 * (1 - 10 ** (-0.40 / 20)), r"([\d.]+)% of the swing lost", 2),
        ("IL -0.40 dB, mV lost of 250", 250 * (1 - 10 ** (-0.40 / 20)), r"of the swing lost, (\d+) mV", 5),
        ("RL -20 dB, % reflected", 100 * 10 ** (-20 / 20), r"(\d+)% reflected", 0.5),
        ("RL -20 dB, mV of 250", 250 * 10 ** (-20 / 20), r"reflected, (\d+) mV", 0.5),
        ("NEXT -34 dB, %", 100 * 10 ** (-34 / 20), r"below .34 dB below .34 dB ([\d.]+)%", 1),
        ("NEXT -34 dB, mV of 250", 250 * 10 ** (-34 / 20), r"below .34 dB below .34 dB [\d.]+%, (\d+) mV", 2),
        ("FEXT -38 dB, %", 100 * 10 ** (-38 / 20), r"below .38 dB below .36 dB ([\d.]+)%", 4),
        ("FEXT -38 dB, mV of 250", 250 * 10 ** (-38 / 20), r"below .38 dB below .36 dB [\d.]+%, (\d+) mV", 5),
        ("PSFEXT -35 dB, %", 100 * 10 ** (-35 / 20), r"below .35 dB below .32 dB ([\d.]+)%", 2),
        ("PSFEXT -35 dB, mV of 250", 250 * 10 ** (-35 / 20), r"below .35 dB below .32 dB [\d.]+%, (\d+) mV", 11.5),
        ("40 to 45 ohm step, reflection (%)", 100 * (45 - 40) / (45 + 40), r"reflects about ([\d.]+)%", 1),
    )],
    (I + "/lpddr5x", "deeper: LVSTL swing, VDDQ 0.5 V, Ron = RTT (mV)",
     1000 * 0.5 * 40 / (40 + 40), r"a 0.5 V supply gives (\d+) mV", 0.1),
    (F + "/characteristic-impedance", "microstrip t_pd (ps/in)",
     tpd(3.0), r"(\d+) ps/inch against the stripline", 2),
    (F + "/characteristic-impedance", "stripline t_pd (ps/in)",
     tpd(4.2), r"against the stripline's (\d+)", 2),
    (F + "/termination-schemes", "parallel termination current (mA)",
     1.2 / 50 * 1000, r"50 ohm draws (\d+) mA", 2),
    (F + "/termination-schemes", "parallel termination power (mW)",
     1.2 ** 2 / 50 * 1000, r"about (\d+) mW", 2),
    (P + "/ir-drop-electromigration", "budget, 0.75 V at 5% (mV)",
     0.75 * 0.05 * 1000, r"5% ripple budget on a 0.75 V rail is ([\d.]+) mV", 1),
    (P + "/ir-drop-electromigration", "left after 20 mV of DC drop (mV)",
     0.75 * 0.05 * 1000 - 20, r"fighting over the remaining ([\d.]+) mV", 1),
    (S + "/channel-budgeting", "board trace length from 17 dB at 1.3 dB/in (inches)",
     17 / 1.3, r"about (\d+) inches of trace", 4),
    (I + "/pcie-gen4-gen5", "UI at 16 GT/s (ps)",
     ui_ps(16e9), r"unit interval is ([\d.]+) ps at Gen 4", 1),
    (I + "/pcie-gen4-gen5", "UI at 32 GT/s (ps)",
     ui_ps(32e9), r"at Gen 4 and ([\d.]+) ps at Gen 5", 1),
    (I + "/pcie-gen4-gen5", "200 mil stub resonance (GHz)",
     stub(200, 4.0), r"resonates at around ([\d.]+) GHz", 3),
    (I + "/pcie-gen6", "Nyquist for 64 GT/s PAM4 (GHz)",
     64 / 4, r"same (\d+) GHz Nyquist", 2),
    (I + "/pcie-gen6", "time between raw errors at 1e-6, 64 GT/s (us)",
     1e6 / 64e9 * 1e6, r"every (\d+) microseconds", 8),
    (S + "/what-closes-the-eye", "LPDDR5X UI (ps)",
     ui_ps(8.533e9), r"LPDDR5X 8533 MT/s (\d+) ps", 2),
    (S + "/what-closes-the-eye", "LPDDR5X Nyquist (GHz)",
     8.533 / 2, r"LPDDR5X 8533 MT/s \d+ ps ([\d.]+) GHz", 2),
    (S + "/what-closes-the-eye", "UFS 4.0 UI (ps)",
     ui_ps(23.2e9), r"UFS 4.0 HS-G5 (\d+) ps", 2),
    (S + "/what-closes-the-eye", "PCIe Gen 5 UI (ps)",
     ui_ps(32e9), r"PCIe Gen 5 ([\d.]+) ps", 1),
    (S + "/what-closes-the-eye", "LPDDR5X echo delay (UI)",
     2 * 171 / ui_ps(8.533e9), r"~2.5 dB ([\d.]+) UI", 4),
    (S + "/what-closes-the-eye", "PCIe Gen 4 echo delay (UI)",
     2 * 1736 / ui_ps(16e9), r"~18 dB ([\d.]+) UI", 3),
    (S + "/what-closes-the-eye", "PCIe Gen 5 echo delay (UI)",
     2 * 1736 / ui_ps(32e9), r"~28 dB (\d+) UI", 3),
    (P + "/pdn-induced-jitter", "PSIJ pk-pk, 1 MHz at the VCO (ps)",
     2 * 30 * 8 * 0.030 * ((1/4) / (1 + (1/4)**2) ** 0.5), r"([\d.]+) ps.{0,24}peak-to-peak entering at the VCO", 3),
    (P + "/pdn-induced-jitter", "PSIJ pk-pk, 1 MHz at the reference (ps)",
     2 * 30 * 8 * 0.030 * (1 / (1 + (1/4)**2) ** 0.5), r"and ([\d.]+) ps entering at the reference", 3),
    (S + "/what-closes-the-eye", "through-section max mismatch loss, 45/50 ohm (dB)",
     0.048121, r"50 ohm system that is ([\d.]+) dB", 3),
    (S + "/what-closes-the-eye", "through-section max mismatch loss, 25/50 ohm (dB)",
     1.938200, r"25 ohm section only costs about ([\d.]+) dB", 4),
    (F + "/termination-schemes", "10 ohm driver into 50 ohm, fraction of rail (%)",
     50 / 60 * 100, r"delivers (\d+)% of the rail", 2),
    (F + "/termination-schemes", "terminator power with a 10 ohm driver (mW)",
     (1.2 * 50 / 60) ** 2 / 50 * 1000, r"terminator burns about (\d+) mW", 4),
    (F + "/bathtub-curves", "bits for 95% confidence at BER 1e-12 (x 1e12)",
     2.995732, r"-ln\(0.05\)/BER ~ (\d+) x 10 ?12 bits", 4),
    (F + "/bathtub-curves", "time for that at 16 Gb/s (s)",
     187.233267, r"about ([\d]+) seconds", 2),
    (P + "/vrm-loop-bandwidth", "single-pole time constant at 100 kHz (us)",
     1.591549, r"1/\(2..100 kHz\) = ([\d.]+) us", 2),
    (P + "/vrm-loop-bandwidth", "10-90% rise from that time constant (us)",
     3.501409, r"2.2. = ([\d.]+) us", 4),
]


def main(verbose=False):
    fails, missing, passes = [], [], 0
    cache = {}
    for rel, what, want, pat, tol in CLAIMS:
        if rel not in cache:
            cache[rel] = page_text(rel)
        m = re.search(pat, cache[rel])
        if not m:
            missing.append((rel, what, want, pat))
            continue
        got = float(m.group(1).replace(",", ""))
        err = abs(got - want) / want * 100 if want else 0.0
        if err > tol:
            fails.append((rel, what, want, got, err))
        else:
            passes += 1
            if verbose:
                print("  ok  {:44s} {:42s} page {:g} / computed {:.4g}".format(rel, what, got, want))

    pages = len(set(c[0] for c in CLAIMS))
    print("{} derivable claim(s) checked across {} page(s)".format(len(CLAIMS), pages))
    if fails:
        print("\n{} MISMATCH(ES) - the page disagrees with the arithmetic:".format(len(fails)))
        for rel, what, want, got, err in fails:
            print("  x {}\n      {}\n      page says {:g}, computed {:.4g}  ({:.1f}% off)"
                  .format(rel, what, got, want, err))
    else:
        print("  ok every checked number agrees with its formula")
    if missing:
        print("\n{} claim(s) NOT FOUND - wording moved, or the number was removed:".format(len(missing)))
        for rel, what, want, pat in missing:
            print("  ? {}\n      {} (expected {:.4g})\n      pattern: {}".format(rel, what, want, pat))
    return 1 if (fails or missing) else 0


if __name__ == "__main__":
    sys.exit(main("-v" in sys.argv))
