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
    (LAB + "/adc-interference", "that fundamental 80 dB down",
     114.59155902616465, r"that is ([\d,.]+) uV", 0.046),
    (LAB + "/adc-interference", "kT/C noise, 10 pF at 300 K",
     20.35177387846082, r"s kT/C: ([\d,.]+) uV", 0.258),
    (F + "/edge-rate-not-clock-rate", "knee for a 300 ps edge (GHz)",
     0.5 / 300e-12 / 1e9, r"300 ps edge puts the knee at ([\d.]+) GHz", 3),
    (F + "/when-is-a-trace-a-transmission-line", "stripline t_pd (ps/in)",
     tpd(4.2), r"roughly (\d+) ps/inch", 2),
    (F + "/when-is-a-trace-a-transmission-line", "microstrip t_pd (ps/in)",
     tpd(3.0), r"about (\d+) ps/inch", 2),
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
    (F + "/loss-mechanisms", "skin depth at 1 GHz (um)",
     skin(1), r"([\d.]+) um at 1 GHz", 2),
    (F + "/loss-mechanisms", "skin depth at 10 GHz (um)",
     skin(10), r"([\d.]+) um at 10 GHz", 3),
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
    (P + "/decoupling-capacitors", "SRF of 100 nF with 1.5 nH (MHz)",
     srf(100e-9, 1.5e-9) / 1e6, r"resonates at about (\d+) MHz", 5),
    (P + "/target-impedance", "noise budget, 0.75 V at 5% (mV)",
     0.75 * 0.05 * 1000, r"gives ([\d.]+) mV of budget", 1),
    (P + "/target-impedance", "target impedance (mohm)",
     0.75 * 0.05 / 10 * 1000, r"Z_target = ([\d.]+) m", 1),
    (P + "/plane-resonance", "first cavity mode, 100x80 mm Dk 4.2 (MHz)",
     plane_mode(100, 80, 4.2), r"first mode at about (\d+) MHz", 3),
    (P + "/ssn-ground-bounce", "di/dt per DQ (x 1e7 A/s)",
     13e-3 / 150e-12 / 1e7, r"~ ([\d.]+) x 10 ?7 A/s", 3),
    (P + "/ssn-ground-bounce", "16 DQ mean slope (x 1e9 A/s)",
     16 * 13e-3 / 150e-12 / 1e9, r"mean slope of ~ ([\d.]+) x 109 A/s", 4),
    (S + "/nrz-vs-pam4", "PAM4 amplitude penalty (dB)",
     20 * math.log10(3), r"20.log ?10 ?\(3\) ~ ([\d.]+) dB", 2),
    (I + "/pcie-gen6", "PAM4 amplitude penalty (dB)",
     20 * math.log10(3), r"20.log ?10 ?\(3\) ~ ([\d.]+) dB", 2),
    (I + "/lpddr5x", "UI at 8533 MT/s (ps)",
     ui_ps(8.533e9), r"about (\d+) ps", 2),
    (I + "/usb-3x", "UI at 5 Gbps (ps)",
     ui_ps(5e9), r"Unit intervals of (\d+) ps", 1),
    (I + "/usb-3x", "UI at 10 Gbps (ps)",
     ui_ps(10e9), r"Unit intervals of \d+ ps and (\d+) ps", 1),
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
