#!/usr/bin/env python3
"""Stamp, relink and check the topic pages listed in topics.json.

This is a dev-time tool, not a build step — it writes real HTML into the repo,
which is then served as-is. Prose is always hand-written; the script only owns
the chrome, and only inside the marked regions.

    python3 scaffold.py new              create pages that don't exist yet
    python3 scaffold.py relink           rewrite the <!-- pager --> and <!-- map --> blocks
    python3 scaffold.py experiments      publish the verified reference-experiment cards
    python3 scaffold.py check            dead links, tag balance, headings, orphans, numbers
    python3 scaffold.py bust             re-stamp ?v= on every local css/js reference
    python3 scaffold.py meta             canonical + OpenGraph per page, sitemap.xml, robots.txt

Anything between <!-- pager:start --> and <!-- pager:end -->, between
<!-- map:start --> and <!-- map:end --> in index.html, or between
<!-- reference-experiments:start --> and <!-- reference-experiments:end --> in
reference.html belongs to this script. Everything else is yours.
"""
import hashlib
import json
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent

# Directories that hold HTML which is NOT a published page. tests/ carries the
# browser harnesses -- they are tools, not site pages, so the canonical-URL,
# mobile-table and placeholder gates do not apply to them.
NON_PAGE_DIRS = {"tests"}


def site_html():
    """Every HTML file the site actually publishes."""
    for f in sorted(ROOT.rglob("*.html")):
        rel = f.relative_to(ROOT)
        if rel.parts and rel.parts[0] in NON_PAGE_DIRS:
            continue
        yield f
TOPICS = ROOT / "topics.json"

PAGE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<link rel="stylesheet" href="../../css/base.css">
<link rel="stylesheet" href="../../css/components.css">
</head>
<body>

<header class="masthead">
  <a class="wordmark" href="../../index.html">SI<span class="amp">&amp;</span>PI</a>
  <nav>
    <a href="../../index.html#fundamentals">Fundamentals</a>
    <a href="../../index.html#power-integrity">Power</a>
    <a href="../../index.html#interfaces">Interfaces</a>
    <a href="../../start.html">Start</a>
    <a href="../../labs.html">Labs</a>
    <a href="../../reference.html">Reference</a>
    <button class="theme-toggle" data-act="theme" type="button">System</button>
  </nav>
</header>

<main>
  <div class="page-head">
    <p class="crumb"><a href="../../index.html#{section_id}">{section}</a> / {num}</p>
    <h1>{h1}</h1>
    <p class="byline">
      <span>By Geetansh — Principal SI/PI Engineer</span>
      <span>Updated Sep 2026</span>
      <span>~{mins} min</span>
    </p>
    <p class="answer">
      {answer}
    </p>
  </div>

  <div class="prose">
{body}
  </div>

{extra}
  <!-- pager:start -->
  <!-- pager:end -->
</main>

<footer class="site-foot">
  <span>SIPI — signal and power integrity, visualised.</span>
  <span>Created and directed by Geetansh Arora. <a href="../../colophon.html">About, review &amp; AI assistance</a> &#183; <a href="../../model-contract.html">Model assumptions</a> &#183; <a href="../../docs/claims.md">Claim ledger</a></span>
</footer>

<script src="../../js/site.js"></script>
<script src="../../js/search.js"></script>
</body>
</html>
'''

STUB_BODY = """    <h2>Not written yet</h2>
    <p>
      This topic is on the map and scheduled, but the page isn't written. When it lands it will
      cover {scope}.
    </p>
    <p>
      In the meantime, the <a href="../../index.html">topic map</a> shows what's already written —
      and the previous and next topics below are the nearest thing to it.
    </p>"""

STUB_NOTE = """  <p class="stub-note">
    <b>This is a brief.</b> It covers the idea and the numbers you need to make a decision, but
    doesn't yet have the interactive panel or the full derivation. Those land as the section is
    deepened — see the <a href="../../index.html">topic map</a> for what's already full-depth.
  </p>
"""


def load():
    data = json.loads(TOPICS.read_text(encoding="utf-8"))
    flat = []
    for sec in data["sections"]:
        for i, t in enumerate(sec["topics"]):
            flat.append({
                "section": sec["title"], "section_id": sec["id"],
                "num": f"{i + 1:02d}", "path": ROOT / "topics" / sec["id"] / f"{t['slug']}.html",
                **t,
            })
    return data, flat


def scope(t):
    """A readable scope line straight from the topic's search keywords."""
    kw = t.get("keywords", [])[:5]
    if not kw:
        return t["title"].lower()
    return ", ".join(kw[:-1]) + " and " + kw[-1] if len(kw) > 1 else kw[0]


def pager_html(flat, i):
    """Prev/next are stamped as real <a> tags, not injected at runtime — a crawler
    following internal links is how a reference site gets found."""
    def cell(j, direction, label):
        if j < 0 or j >= len(flat):
            # Either end of the sequence. A card reading "Next —" looks broken and
            # leaves the reader with nowhere to go, so the end is named and points
            # back at the map it came from.
            here = flat[i]
            end = "Start of the sequence" if j < 0 else "End of the sequence"
            return (f'    <a class="{direction} pager__end" '
                    f'href="../../index.html#{here["section_id"]}">'
                    f'<span class="dir">{end}</span><span>Back to the topic map</span></a>')
        t = flat[j]
        href = f"../../topics/{t['section_id']}/{t['slug']}.html"
        return (f'    <a class="{direction}" href="{href}">'
                f'<span class="dir">{label}</span><span>{t["title"]}</span></a>')
    return ("  <nav class=\"pager\" aria-label=\"Previous and next topic\">\n"
            + cell(i - 1, "prev", "Previous") + "\n"
            + cell(i + 1, "next", "Next") + "\n"
            + "  </nav>")


SHARE_MARKERS = {"head": ("<!-- share:head:start -->", "<!-- share:head:end -->"),
                 "foot": ("<!-- share:foot:start -->", "<!-- share:foot:end -->")}


def share_html(url, title, where):
    """Share links as ordinary anchors, stamped per page.

    No third-party widget. A LinkedIn or X button that loads their script puts
    their tracking on every page of a site whose whole claim is that you can read
    its source and see everything it does. These are plain links to the same share
    intents, they work with JavaScript off, and site.js adds only the two things an
    anchor cannot do: clipboard copy, and the operating system's share sheet where
    one exists."""
    from urllib.parse import quote
    u, t = quote(url, safe=""), quote(title, safe="")
    amp = "&amp;"
    links = [
        ("LinkedIn", f"https://www.linkedin.com/sharing/share-offsite/?url={u}"),
        ("X", f"https://x.com/intent/post?url={u}{amp}text={t}"),
        ("Email", f"mailto:?subject={t}{amp}body={u}"),
    ]
    a = "".join(f'<a class="share__btn" href="{h}" target="_blank" rel="noopener">{esc(n)}</a>'
                for n, h in links)
    return (f'<div class="share share--{where}" data-share data-share-url="{esc(url)}" '
            f'data-share-title="{esc(title)}">'
            f'<span class="share__label">Share</span>{a}'
            f'<button class="share__btn" type="button" data-act="copy-link">Copy link</button>'
            f'<button class="share__btn" type="button" data-act="share-native" hidden>'
            f'Share\u2026</button></div>')


def stamp_share():
    """Put a share row under the byline and again above the pager, on every topic."""
    n = 0
    data, flat = load()
    base = data["site"]["url"].rstrip("/")
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        url = f'{base}/topics/{t["section_id"]}/{t["slug"]}.html'
        out = html
        for where in ("head", "foot"):
            start, end = SHARE_MARKERS[where]
            blk = start + share_html(url, t["title"], where) + end
            if start in out:
                out = re.sub(re.escape(start) + r"[\s\S]*?" + re.escape(end), lambda _m: blk, out)
            elif where == "head":
                # directly after the byline, which is where a reader decides
                m = re.search(r'<p class="byline">[\s\S]*?</p>', out)
                if not m:
                    continue
                out = out[:m.end()] + "\n    " + blk + out[m.end():]
            else:
                # above the pager, where the reading ends
                m = re.search(r'  <!-- pager:start -->', out)
                if not m:
                    continue
                out = out[:m.start()] + "  " + blk + "\n\n" + out[m.start():]
        if out != html:
            t["path"].write_text(out, encoding="utf-8")
            n += 1
    return n


def cmd_new():
    _, flat = load()
    made = 0
    for i, t in enumerate(flat):
        if t["path"].exists():
            continue
        t["path"].parent.mkdir(parents=True, exist_ok=True)
        t["path"].write_text(PAGE.format(
            title=t["title"], desc=t["title"], section=t["section"],
            section_id=t["section_id"], num=t["num"], h1=t["title"], mins=3,
            answer=f"This page is planned but not yet written. It will cover {scope(t)}.",
            body=STUB_BODY.format(scope=scope(t)), extra="",
        ), encoding="utf-8")
        made += 1
        print(f"  + {t['path'].relative_to(ROOT)}")
    print(f"{made} page(s) created, {len(flat) - made} already present")


def map_html(data):
    """The homepage topic map, as real anchors.

    This used to be fetched and rendered client-side. It is stamped statically because
    a crawler that does not run JavaScript would otherwise see a homepage that links to
    nothing at all — and discovery for this site is search-driven. Stamping it here also
    means index.html works from file://.
    """
    out = []
    for sec in data["sections"]:
        rows = []
        for t in sec["topics"]:
            # M6-4 · The tag used to read "full", and it meant nothing more than
            # "this page has a <details> block". A completeness badge earned by
            # the presence of an element is not a completeness badge; Astra's §9
            # asks for honest metadata instead, so the tag now says what has
            # actually happened to the page.
            #
            # A finished page carries NO tag. It used to carry one of checked /
            # sourced / written, derived from what evidence the page had. Every page
            # in the catalogue now has a dated human review, so "written" — which
            # meant "authored, and nothing further claimed" — understated 34 pages,
            # and "checked" beside it invited the reader to conclude that the others
            # had not been. The evidence each page actually rests on is on the page:
            # its byline names the reviewer and the date, and its model contract
            # names the suites. A word on a card could not carry that and was read
            # as a grade.
            #
            # The tag remains for the two statuses that are genuinely about SCOPE
            # rather than about evidence:
            #   brief  ~400 words, real numbers, no interactive panel
            #   soon   the page exists and says so
            tag, cls = "soon", t["status"]
            if t["status"] == "brief":
                tag = "brief"
            elif t["status"] == "live":
                tag, cls = "", "live"
            rows.append(
                f'        <div class="topic is-{cls}">'
                f'<a href="topics/{sec["id"]}/{t["slug"]}.html">{t["title"]}</a>'
                + (f'<span class="tag">{tag}</span>' if tag else "") + '</div>')
        out.append(
            f'    <section class="sec" id="{sec["id"]}">\n'
            f'      <div class="sec__head"><h2>{sec["title"]}</h2><p>{sec["blurb"]}</p></div>\n'
            f'      <div class="topic-grid">\n' + "\n".join(rows) + "\n"
            f'      </div>\n'
            f'    </section>')
    return "\n".join(out)


REFERENCE_START = "<!-- reference-experiments:start -->"
REFERENCE_END = "<!-- reference-experiments:end -->"


def _reference_number(value):
    """Readable, deterministic formatting for verified fixture numbers."""
    if value == 0:
        return "0"
    return format(value, ".12g")


def reference_library_html():
    """Generate reader-facing cards from the checked manifest and fixtures.

    The analytical values remain owned by the fixture. The rendered block is
    compared byte-for-byte by scaffold.py check, while check-experiments.js
    independently evaluates the fixture values against the public models.
    """
    manifest_path = ROOT / "docs" / "reference-experiments.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cards = []
    for entry in manifest.get("experiments", []):
        fixture_path = ROOT / entry["input"].lstrip("/")
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        if fixture.get("id") != entry.get("id"):
            raise SystemExit(f"reference fixture id disagrees with manifest: {fixture_path}")
        lesson = fixture["lesson"]
        tags = entry.get("tags", [])
        tag_html = "".join(f'<span class="reference-tag">{esc(tag)}</span>' for tag in tags)
        checks = []
        for check in fixture["checks"]:
            value = _reference_number(check["expected"])
            unit = check["unit"]
            unit_label = "dimensionless" if unit == "-" else unit
            displayed = f"{value} {esc(unit_label)}"
            if check["metric"] == "groupDelay" and unit == "s":
                displayed += f" ({_reference_number(check['expected'] * 1e12)} ps)"
            tolerance = f"± {_reference_number(check['absoluteTolerance'])} {esc(unit_label)}"
            checks.append(
                "              <tr>"
                f"<th scope=\"row\"><code>{esc(check['metric'])}</code></th>"
                f"<td>{displayed}</td><td>{tolerance}</td>"
                f"<td>{esc(check['derivation'])}</td></tr>")
        limits = "".join(f"<li>{esc(item)}</li>" for item in fixture["limitations"])
        scenario = esc(entry["scenario"].lstrip("/"))
        download = esc(entry["input"].lstrip("/"))
        cards.append(f'''    <article class="reference-card" id="experiment-{esc(entry['id'])}">
      <header class="reference-card__head">
        <div><p class="reference-card__eyebrow">Reference {esc(entry['id'])}</p><h3>{esc(entry['title'])}</h3></div>
        <div class="reference-tags" aria-label="Categories">{tag_html}</div>
      </header>
      <div class="reference-card__actions">
        <a class="tool-btn" href="{scenario}">Open experiment</a>
        <a class="tool-btn" href="{download}" download>Download reference JSON</a>
      </div>
      <dl class="reference-card__meta">
        <div><dt>Model pin</dt><dd><code>{esc(entry['model'])}</code> {esc(entry['modelVersion'])}; contract {esc(fixture['contractVersion'])}</dd></div>
        <div><dt>Stimulus</dt><dd>{esc(fixture['stimulus'])}</dd></div>
        <div><dt>Observation</dt><dd>{esc(fixture['planes'])}</dd></div>
        <div><dt>Evidence</dt><dd>{esc(entry['evidence'])}; {esc(fixture['evidence']['provenance'])}</dd></div>
      </dl>
      <div class="experiment-flow" aria-label="Learning sequence">
        <div class="experiment-step"><strong>Predict</strong><p>{esc(entry['question'])}</p></div>
        <div class="experiment-step"><strong>Experiment</strong><p>{esc(lesson['experiment'])}</p></div>
        <div class="experiment-step"><strong>Explain</strong><p>{esc(lesson['explanation'])}</p></div>
        <div class="experiment-step"><strong>Transfer</strong><p>{esc(lesson['transferQuestion'])}</p></div>
      </div>
      <details class="reference-result">
        <summary>Expected results, derivations, and limits</summary>
        <p><strong>Transfer answer:</strong> {esc(lesson['answer'])}</p>
        <div class="table-scroll"><table>
          <thead><tr><th>Metric</th><th>Expected</th><th>Absolute tolerance</th><th>Derivation</th></tr></thead>
          <tbody>
{chr(10).join(checks)}
          </tbody>
        </table></div>
        <h4>Limits</h4><ul class="tight">{limits}</ul>
      </details>
    </article>''')
    staged = json.loads((ROOT / "docs" / "reference-experiments-next.json").read_text(encoding="utf-8"))
    first_ids = {entry["id"] for entry in manifest.get("experiments", [])}
    staged_ids = set()
    for entry in staged.get("experiments", []):
        if entry["id"] in first_ids or entry["id"] in staged_ids:
            raise SystemExit(f"duplicate reference id across manifests: {entry['id']}")
        staged_ids.add(entry["id"])
        fixture_path = ROOT / entry["input"].lstrip("/")
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        if fixture.get("id") != entry.get("id") or fixture.get("availability") != entry.get("availability"):
            raise SystemExit(f"staged reference disagrees with manifest: {fixture_path}")
        helper = fixture["availability"] == "helper-only"
        tags = ["SI" if fixture["kind"] in ("pad", "stub", "cdr") else "PI",
                "analytical helper" if helper else "clock recovery"]
        tag_html = "".join(f'<span class="reference-tag">{esc(tag)}</span>' for tag in tags)
        checks = []
        for check in fixture["checks"]:
            unit = "dimensionless" if check["unit"] == "-" else check["unit"]
            checks.append(
                "              <tr>"
                f"<th scope=\"row\"><code>{esc(check['metric'])}</code></th>"
                f"<td>{_reference_number(check['expected'])} {esc(unit)}</td>"
                f"<td>± {_reference_number(check['absoluteTolerance'])} {esc(unit)}</td>"
                f"<td>{esc(check['derivation'])}</td></tr>")
        inputs = ", ".join(f"{esc(key)} = {_reference_number(value)} {esc(fixture['inputUnits'][key])}"
                           for key, value in fixture["inputs"].items())
        limits = "".join(f"<li>{esc(item)}</li>" for item in fixture["limitations"])
        action = (f'<a class="tool-btn" href="{esc(fixture["scenario"].lstrip("/"))}">Open experiment</a>'
                  if not helper else
                  f'<a class="tool-btn" href="{esc(fixture["relatedPage"].lstrip("/"))}">Read related lesson</a>')
        mode = ("Saved lab scenario: the published traces can be compared with the analytical answer."
                if not helper else
                "Helper-only reference: use the downloadable inputs with the checked numerical helper. "
                "The related lesson does not run this exact case.")
        model = (f"cdr {fixture['modelVersion']}; contract {fixture['contractVersion']}"
                 if fixture["kind"] == "cdr" else
                 "viz-kit numerical helper; no interactive scenario")
        cards.append(f'''    <article class="reference-card" id="experiment-{esc(entry['id'])}">
      <header class="reference-card__head">
        <div><p class="reference-card__eyebrow">Reference {esc(entry['id'])}</p><h3>{esc(entry['title'])}</h3></div>
        <div class="reference-tags" aria-label="Categories">{tag_html}</div>
      </header>
      <div class="reference-card__actions">
        {action}
        <a class="tool-btn" href="{esc(entry['input'].lstrip('/'))}" download>Download reference JSON</a>
      </div>
      <dl class="reference-card__meta">
        <div><dt>Execution</dt><dd>{esc(mode)}</dd></div>
        <div><dt>Model pin</dt><dd>{esc(model)}</dd></div>
        <div><dt>Inputs</dt><dd>{inputs}</dd></div>
        <div><dt>Evidence</dt><dd>{esc(fixture['evidence']['type'])}; {esc(fixture['evidence']['provenance'])}</dd></div>
      </dl>
      <div class="experiment-flow" aria-label="Learning sequence">
        <div class="experiment-step"><strong>Predict</strong><p>{esc(fixture['prediction'])}</p></div>
        <div class="experiment-step"><strong>Experiment</strong><p>{esc(mode)}</p></div>
        <div class="experiment-step"><strong>Explain</strong><p>{esc(fixture['explanation'])}</p></div>
      </div>
      <details class="reference-result">
        <summary>Expected results, derivations, and limits</summary>
        <div class="table-scroll"><table>
          <thead><tr><th>Metric</th><th>Expected</th><th>Absolute tolerance</th><th>Derivation</th></tr></thead>
          <tbody>
{chr(10).join(checks)}
          </tbody>
        </table></div>
        <h4>Limits</h4><ul class="tight">{limits}</ul>
      </details>
    </article>''')
    return "\n".join(cards)


def stamp_reference_library():
    page = ROOT / "reference.html"
    html = page.read_text(encoding="utf-8")
    block = f"  {REFERENCE_START}\n{reference_library_html()}\n  {REFERENCE_END}"
    new, hits = re.subn(r"  <!-- reference-experiments:start -->.*?<!-- reference-experiments:end -->",
                        lambda _m: block, html, flags=re.S)
    if hits != 1:
        raise SystemExit("reference.html must contain one reference-experiment fence")
    if new != html:
        page.write_text(new, encoding="utf-8")
        print("reference.html experiment library regenerated")
        return 1
    print("reference.html experiment library already current")
    return 0


def reference_library_problems():
    page = ROOT / "reference.html"
    if not page.exists():
        return ["reference.html is missing"]
    html = page.read_text(encoding="utf-8")
    match = re.search(r"  <!-- reference-experiments:start -->\n(.*?)\n  <!-- reference-experiments:end -->",
                      html, flags=re.S)
    if not match:
        return ["reference.html has no generated reference-experiment block"]
    if match.group(1) != reference_library_html():
        return ["reference.html experiment cards disagree with verified fixtures — run "
                "`python3 scaffold.py experiments`"]
    return []


TITLE_RENAMES = {
    "Units, conventions, and the numbers people mix up": "SI/PI Units, Conventions, and Reference Planes",
    "Time, frequency, and how to move between them": "Time-Domain and Frequency-Domain Analysis",
    "Edge rate, not clock rate": "Signal Bandwidth: Why Edge Rate Matters",
    "Where characteristic impedance comes from": "Transmission-Line Characteristic Impedance",
    "Reflections: why an unterminated line rings": "Transmission-Line Reflections and Ringing",
    "Termination schemes and what each one costs": "Transmission-Line Termination Schemes",
    "Return current: the path everyone forgets": "Return-Current Paths and Reference Continuity",
    "Crosstalk — NEXT, FEXT, and mutual coupling": "PCB Crosstalk: NEXT, FEXT, and Mutual Coupling",
    "Loss: conductor, dielectric, roughness": "PCB Transmission-Line Loss Mechanisms",
    "ISI — how loss turns into a data-dependent error": "Intersymbol Interference (ISI) and Channel Memory",
    "The eye diagram: how it's built, how to read it": "Eye Diagrams: Construction and Interpretation",
    "Jitter — RJ, DJ, DCD, PJ, and TJ at a BER": "Jitter Components: RJ, DJ, DCD, PJ, and TJ",
    "S-parameters without pain": "S-Parameters: Insertion Loss, Return Loss, and Mixed Mode",
    "Vias: stubs, resonance, backdrilling": "High-Speed Vias: Stubs, Resonance, and Backdrilling",
    "What the PDN actually is": "Power Delivery Networks: From Regulator to Die",
    "Target impedance and where the formula stops working": "PDN Target Impedance: Use and Limitations",
    "Decoupling caps — ESR, ESL, and placement": "Decoupling Capacitors: ESR, ESL, and Placement",
    "Anti-resonance: two good caps, one bad peak": "PDN Anti-Resonance and Impedance Peaks",
    "Board, package, die — who owns what": "PDN Frequency Regions: Board, Package, and Die",
    "Plane cavity resonance and edge radiation": "Power-Plane Cavity Resonance and Edge Radiation",
    "SSN and ground bounce": "Simultaneous Switching Noise and Ground Bounce",
    "PDN-induced jitter — where PI meets SI": "Power-Supply-Induced Jitter: Connecting PI and SI",
    "Channel budgeting across die, package, board": "Channel Loss Budgeting Across Die, Package, and Board",
    "What closes the eye — IL, RL, TDR, crosstalk": "Eye Closure: Loss, Reflections, Discontinuities, and Crosstalk",
    "CTLE, DFE, FFE, CDR — what each one fixes": "Equalization and Clock Recovery: CTLE, FFE, DFE, and CDR",
    "NRZ vs PAM4 and the SNR penalty": "NRZ and PAM4: Levels, Bandwidth, and SNR",
    "Statistical vs time-domain simulation": "Statistical and Time-Domain Channel Simulation",
    "IBIS, IBIS-AMI and SPICE models": "IBIS, IBIS-AMI, and SPICE Model Selection",
    "Compliance masks and receiver eye masks": "Transmitter Compliance Masks and Receiver Eye Masks",
    "What the receiver actually does": "Receiver Sampling, Clock Recovery, and Jitter Tolerance",
    "Etch, glass weave skew, impedance control": "PCB Manufacturing Variation: Etch, Glass Weave, and Impedance",
    "Where the package stops being a wire": "Package Interconnects as Transmission Lines",
    "The simulation flow, end to end": "Signal Integrity Simulation Workflow",
    "2D vs 2.5D vs 3D field solvers": "Field Solvers for SI/PI: 2D, 2.5D, and 3D",
    "Correlating simulation to measurement": "Correlating Simulation and Measurement",
    "Reporting margin honestly": "Reporting Signal and Power Integrity Margin",
    "Debug playbook: symptom to cause": "SI/PI Debugging: From Symptom to Cause",
    "Measuring it: fixtures, calibration, and what the instrument adds": "SI/PI Measurement: Fixtures, Calibration, and Instrument Effects",
    "Lab A — travelling waves, termination and return paths": "Lab A: Transmission-Line Reflections and Energy Flow",
    "Lab B — one channel, every domain": "Lab B: Channel Response, ISI, and Eye Diagrams",
    "Lab C — the PDN from regulator to die": "Lab C: PDN Impedance, Current Sharing, and Transient Droop",
    "Differential signalling and mode conversion": "Differential Signaling and Mode Conversion",
    "DC IR drop and electromigration": "DC IR Drop and Electromigration",
    "VRM control loop bandwidth": "VRM Control-Loop Bandwidth and Load Transients",
    "Chip-package-system co-analysis": "Chip-Package-System Power Integrity Co-Analysis",
    "Real capacitors: bias, tolerance, temperature, and mounting": "Real Capacitors: Bias, Tolerance, Temperature, and Mounting",
    "De-embedding and fixture removal": "S-Parameter De-Embedding and Fixture Removal",
    "Wirebond, flip-chip, FOWLP, interposer, chiplets": "IC Package Interconnects: Wirebond, Flip-Chip, FOWLP, Interposers, and Chiplets",
    "Stackup design and dielectric selection": "PCB Stackup Design and Dielectric Selection",
    "BGA escape routing and breakout congestion": "BGA Escape Routing and Breakout Congestion",
    "Layer transitions and stitching vias": "PCB Layer Transitions and Return-Path Stitching",
    "Connectors, cables, and their discontinuities": "High-Speed Connectors and Cables",
    "LPDDR5/5X — timing budget, ODT, training": "LPDDR5 and LPDDR5X Signal Integrity: Timing, ODT, and Training",
    "PCIe Gen 4/5 — loss budget and equalisation": "PCIe 4.0 and 5.0 Signal Integrity: Loss and Equalization",
    "PCIe Gen 6 — PAM4, FLIT, FEC": "PCIe 6.0 Signal Integrity: PAM4, FLIT, and FEC",
    "USB 3.1/3.2 — SSC and compliance": "USB 3.1 and 3.2 Signal Integrity: SSC and Compliance",
    "UFS 4.0 — M-PHY HS-Gear5": "UFS 4.0 Signal Integrity: M-PHY Gear 5",
}


def cmd_titles():
    """Apply reviewed title changes to pages and keep topic H1/title tags aligned."""
    data, flat = load()
    changed = 0
    for f in site_html():
        html = f.read_text(encoding="utf-8")
        new = html
        for old, title in TITLE_RENAMES.items():
            new = new.replace(old, title)
        if new != html:
            f.write_text(new, encoding="utf-8")
            changed += 1
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        title = esc(t["title"])
        new = re.sub(r"<title>.*?</title>", f"<title>{title} | SIPI</title>", html, count=1, flags=re.S)
        new = re.sub(r"<h1>.*?</h1>", f"<h1>{title}</h1>", new, count=1, flags=re.S)
        if new != html:
            t["path"].write_text(new, encoding="utf-8")
            changed += 1
    print(f"updated titles or title references in {changed} page(s)")


def stamp_masthead():
    """One definition of the site header, stamped onto every page.

    It was 67 hand-written copies. They happened to agree, but adding a link meant
    67 edits and nothing checked that they still matched afterwards.

    The bar holds destinations, not section anchors. Fundamentals, Power and
    Interfaces used to sit here -- three of the eight sections, chosen for no
    stated reason, each jumping to an anchor on the homepage. `Topics` reaches the
    whole map instead, and the space pays for `About`, which had no route from the
    header at all.
    """
    n = 0
    for f in site_html():
        rel = f.relative_to(ROOT)
        prefix = "../../" if rel.parts and rel.parts[0] == "topics" else ""
        links = [
            (f"{prefix}index.html#groundwork", "Topics"),
            (f"{prefix}start.html", "Start"),
            (f"{prefix}labs.html", "Labs"),
            # Reference is a lookup tool rather than a route into the material,
            # and at 67 px it was the widest item in a bar that has to fit on a
            # phone. It stays in the footer, which is where a reader looks for a
            # glossary. Dropping it also retires the 3 px of slack the nav had at
            # 375 px, which was too little to be stable.
            (f"{prefix}colophon.html", "About"),
        ]
        nav = "\n".join(f'    <a href="{href}">{label}</a>' for href, label in links)
        # The theme button is a direct child, not a nav item. It is a control
        # rather than a destination, and the position matters on a phone: as a
        # sibling of the wordmark it shares that row instead of taking a third
        # one of its own. js/search.js inserts its button before the toggle if it
        # finds one in the nav and appends otherwise, so Search stays last either way.
        head = (f'<header class="masthead">\n'
                f'  <a class="wordmark" href="{prefix}index.html">SIPI</a>\n'
                f'  <button class="theme-toggle" data-act="theme" type="button">Light</button>\n'
                f'  <nav aria-label="Site">\n'
                f'{nav}\n'
                f'  </nav>\n'
                f'</header>')
        html = f.read_text(encoding="utf-8")
        new, hits = re.subn(r'<header class="masthead">[\s\S]*?</header>', head, html, count=1)
        if hits and new != html:
            f.write_text(new, encoding="utf-8")
            n += 1
    return n


def stamp_footer():
    """Keep authorship concise in the footer and detailed in the colophon."""
    n = 0
    for f in site_html():
        rel = f.relative_to(ROOT)
        prefix = "../../" if rel.parts and rel.parts[0] == "topics" else ""
        # "Claim ledger" pointed at docs/claims.md, which Cloudflare serves as
        # text/markdown with nosniff -- so on all 67 pages that link downloaded a
        # file instead of opening one. _headers now serves markdown as plain text,
        # and the label says what the reader is getting.
        footer = (f'<footer class="site-foot">\n'
                  f'  <span>SIPI &#8212; signal and power integrity, visualised.</span>\n'
                  f'  <nav class="site-foot__nav" aria-label="Site, footer">\n'
                  f'    <a href="{prefix}start.html">Start</a>\n'
                  f'    <a href="{prefix}labs.html">Labs</a>\n'
                  f'    <a href="{prefix}reference.html">Reference</a>\n'
                  f'    <a href="{prefix}colophon.html">About &amp; AI disclosure</a>\n'
                  f'    <a href="{prefix}model-contract.html">Model assumptions</a>\n'
                  f'    <a href="{prefix}docs/claims.md">Claim ledger (Markdown)</a>\n'
                  f'  </nav>\n'
                  f'  <span>Created and directed by Geetansh Arora. '
                  f'Text <a href="{prefix}LICENSE-CONTENT">CC BY 4.0</a>, '
                  f'code <a href="{prefix}LICENSE-CODE">MIT</a>.</span>\n'
                  f'</footer>')
        html = f.read_text(encoding="utf-8")
        new, hits = re.subn(r'<footer class="site-foot">[\s\S]*?</footer>', footer, html, count=1)
        if hits and new != html:
            f.write_text(new, encoding="utf-8")
            n += 1
    return n


def cmd_identity():
    cmd_titles()
    heads = stamp_masthead()
    footers = stamp_footer()
    reviews = stamp_review()
    print(f"updated {heads} masthead(s), {footers} footer(s) and "
          f"{reviews} review-status block(s)")


def cmd_relink():
    data, flat = load()
    n = 0
    for i, t in enumerate(flat):
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        block = "  <!-- pager:start -->\n" + pager_html(flat, i) + "\n  <!-- pager:end -->"
        new, hits = re.subn(
            r"  <!-- pager:start -->.*?<!-- pager:end -->", lambda _m: block, html, flags=re.S)
        if not hits:
            # a hand-written page that predates the fence: insert before </main>
            new = html.replace("</main>", block + "\n</main>", 1)
        if new != html:
            t["path"].write_text(new, encoding="utf-8")
            n += 1

    index = ROOT / "index.html"
    html = index.read_text(encoding="utf-8")
    block = "  <!-- map:start -->\n" + map_html(data) + "\n  <!-- map:end -->"
    sh = stamp_share()
    print(f"share rows stamped on {sh} page(s)")
    new, hits = re.subn(r"  <!-- map:start -->.*?<!-- map:end -->", lambda _m: block,
                        html, flags=re.S)
    if hits and new != html:
        index.write_text(new, encoding="utf-8")
        print(f"pager rewritten in {n} page(s); homepage topic map regenerated")
    else:
        print(f"pager rewritten in {n} page(s)"
              + ("" if hits else "; index.html has no <!-- map --> fence"))
    stamp_reference_library()


VOID = {"area", "base", "br", "col", "embed", "hr", "img",
        "input", "link", "meta", "source", "track", "wbr"}


class Balance(HTMLParser):
    """Unclosed tags render 'fine' and are still wrong — an unclosed <span> inside a
    section rule swallows the ::after divider. Nothing else in the toolchain catches it."""

    def __init__(self):
        super().__init__()
        self.stack, self.bad = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.bad.append(f"stray </{tag}> at line {self.getpos()[0]}")
            return
        if self.stack[-1][0] != tag:
            open_tag, open_line = self.stack[-1]
            self.bad.append(f"</{tag}> at line {self.getpos()[0]} closes "
                            f"<{open_tag}> opened at line {open_line}")
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    return
            return
        self.stack.pop()


def cmd_bust():
    """Stamp ?v=<content hash> on every local css/js reference on every page.

    Browsers cache css/js aggressively and will serve a stale copy from an
    in-process cache even against Cache-Control: no-store — so an edit appears not
    to have taken effect. Changing the URL is the only reliable invalidation, and a
    version query is what a static host wants for the same reason.

    The version is a hash of the file's CONTENT, not a timestamp. A timestamp makes
    every run rewrite all 51 pages, which in a git repo is a diff of pure noise and
    is never idempotent. With a hash, re-running on unchanged assets does nothing,
    and a diff means "these pages picked up a real change".
    """
    n, files = _stamp_all()
    if files:
        print(f"stamped content hashes on {n} reference(s) across {files} page(s)")
    else:
        print("asset versions already current — nothing to do")


ASSET_REF = re.compile(
    r'((?:href|src)=")((?:\.\./)*(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')


def _stamp_one(html, rel, digests):
    """Stamp one page's asset references. Split out of cmd_bust because the
    generated pages have to stamp themselves — a generator that writes
    unversioned hrefs silently undoes the cache-busting every time it runs, and
    under an immutable cache rule that is a stale asset nobody can invalidate."""
    def digest(href):
        key = ((ROOT / rel).parent / href).resolve()
        if key not in digests:
            try:
                digests[key] = hashlib.sha1(key.read_bytes()).hexdigest()[:8]
            except FileNotFoundError:
                digests[key] = None
        return digests[key]

    def sub(m):
        d = digest(m.group(2))
        return m.group(1) + m.group(2) + (("?v=" + d) if d else "") + m.group(3)

    return ASSET_REF.subn(sub, html)


def _stamp_all():
    digests = {}
    n = files = 0
    for f in site_html():
        rel = f.relative_to(ROOT)
        html = f.read_text(encoding="utf-8")
        new, k = _stamp_one(html, rel, digests)
        if k and new != html:
            f.write_text(new, encoding="utf-8")
            files += 1
            n += k
    return n, files


def _meta_block(url, title, desc):
    """The canonical + OpenGraph block for one page. Factored out of cmd_meta
    because a GENERATED page has to stamp its own — the same reason _stamp_one
    exists. `scaffold.py contract` rewrites model-contract.html from a template,
    and a template with no meta fence silently undid `scaffold.py meta` every
    time it ran. That is the unversioned-asset bug wearing different clothes,
    and the metadata gate is what surfaced it."""
    data, _flat = load()
    site = data["site"]
    base = site["url"].rstrip("/")

    def e(t):
        return (str(t).replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))

    og = "\n".join(
        f'  <meta property="{k}" content="{v}">' for k, v in [
            ("og:type", "article"), ("og:site_name", e(site["name"])),
            ("og:title", e(title)), ("og:description", e(desc)),
            ("og:url", url), ("og:image", base + "/assets/og.png"),
            ("og:image:width", "1200"), ("og:image:height", "630"),
        ])
    tw = "\n".join(
        f'  <meta name="{k}" content="{v}">' for k, v in [
            ("twitter:card", "summary_large_image"),
            ("twitter:title", e(title)), ("twitter:description", e(desc)),
            ("twitter:image", base + "/assets/og.png"),
        ])
    return ("  <!-- meta:start -->\n"
            f'  <link rel="canonical" href="{url}">\n'
            f'  <link rel="describedby" href="{base}/llms.txt" type="text/markdown">\n'
            f'{og}\n{tw}\n'
            "  <!-- meta:end -->")



THEME_MARKERS = ("  <!-- theme:start -->", "  <!-- theme:end -->")

# Inline, blocking, and in <head> on purpose. The theme used to be applied by
# site.js at DOMContentLoaded, which is after the first paint: a reader with a
# stored preference saw the page render in one palette and swap to the other,
# and on a phone moving between pages that reads as the site flashing. Nothing
# asynchronous can fix that -- the attribute has to be on <html> before the
# browser paints, which means a blocking script, which means inline.
#
# It is deliberately tiny and deliberately total: it reads one key, sets one
# attribute, and swallows every error, because localStorage throws in private
# mode on some browsers and a theme preference is never worth a broken page.
# Light needs no attribute at all -- it is what :root already is -- so the
# default costs nothing and the no-JavaScript case lands on it too.
THEME_BOOT = """  <!-- theme:start -->
  <meta name="theme-color" content="#F7F8FA">
  <script>(function(){try{var t=localStorage.getItem('sipi-theme');\
if(t==='dark'||t==='system'){document.documentElement.setAttribute('data-theme',t);\
var m=document.querySelector('meta[name=theme-color]');\
if(m&&(t==='dark'||matchMedia('(prefers-color-scheme:dark)').matches))m.content='#0B1015';}}catch(e){}})();</script>
  <!-- theme:end -->"""


def stamp_theme_boot(html):
    """Put the pre-paint theme block in <head>, replacing any earlier copy."""
    block = THEME_BOOT
    new, hits = re.subn(r"  <!-- theme:start -->.*?<!-- theme:end -->",
                        lambda _m: block, html, flags=re.S)
    if hits:
        return new
    # A page may already carry a hand-written theme-color; the block owns it now.
    html = re.sub(r'\n\s*<meta name="theme-color"[^>]*>', "", html, count=1)
    m = re.search(r'(<meta name="viewport"[^>]*>)', html)
    if m:
        return html.replace(m.group(1), m.group(1) + "\n" + block, 1)
    return html.replace("</head>", block + "\n</head>", 1)


def cmd_theme():
    """Stamp the pre-paint theme boot block on every page."""
    n = 0
    for f in sorted(ROOT.rglob("*.html")):
        rel = f.relative_to(ROOT).as_posix()
        if rel.startswith("tests/") or "experimental" in rel:
            continue
        html = f.read_text(encoding="utf-8")
        new = stamp_theme_boot(html)
        if new != html:
            f.write_text(new, encoding="utf-8")
            n += 1
    print(f"  theme boot stamped on {n} page(s)")


def cmd_meta():
    """Stamp canonical + OpenGraph tags on every page, and write sitemap/robots.

    LinkedIn is the only distribution channel in the plan, and without OpenGraph a
    post there renders as a bare link with no card. Canonical URLs matter because a
    Pages preview URL and the custom domain otherwise serve every page twice.

    Everything lives between <!-- meta:start --> and <!-- meta:end --> in <head>,
    so it is regenerated rather than hand-maintained across 51 pages.
    """
    data, flat = load()
    site = data["site"]
    base = site["url"].rstrip("/")
    name = site["name"]

    def esc(t):
        return (t.replace("&", "&amp;").replace("<", "&lt;")
                 .replace(">", "&gt;").replace('"', "&quot;"))

    def block(url, title, desc, is_home=False, kind="article", crumb=None,
              reviewed=None):
        """kind is the Open Graph type, and it is not decorative.

        Every page declared og:type="article", including the homepage and the
        three hub pages, which are collections rather than articles. `website`
        is the type for those, and telling an aggregator that a site root is an
        article is telling it something untrue.
        """
        og = "\n".join(
            f'  <meta property="{k}" content="{v}">' for k, v in [
                ("og:type", kind), ("og:site_name", esc(name)),
                ("og:title", esc(title)), ("og:description", esc(desc)),
                ("og:url", url), ("og:image", base + "/assets/og.png"),
                ("og:image:width", "1200"), ("og:image:height", "630"),
            ])
        tw = "\n".join(
            f'  <meta name="{k}" content="{v}">' for k, v in [
                ("twitter:card", "summary_large_image"),
                ("twitter:title", esc(title)), ("twitter:description", esc(desc)),
                ("twitter:image", base + "/assets/og.png"),
            ])
        website = ""
        if is_home:
            website = ('\n  <script type="application/ld+json">'
                       + json.dumps({
                           "@context": "https://schema.org",
                           "@type": "WebSite",
                           "name": "SIPI",
                           "alternateName": ["SI/PI Work", "SI & PI"],
                           "url": base + "/",
                           "description": desc,
                           "creator": {
                               "@type": "Person",
                               "name": "Geetansh Arora",
                               "jobTitle": "Principal SI/PI Engineer",
                           },
                       }, ensure_ascii=False, separators=(",", ":"))
                       .replace("</", "<\\/") + '</script>')
        # A topic page is a technical article inside a named section, and both
        # facts are already in topics.json. This is not decoration: a
        # BreadcrumbList is how a result reads "SIPI > Fundamentals > ..."
        # instead of a bare URL, and TechArticle is what these pages are.
        # Nothing is invented -- headline, section and date all come from the
        # source the page itself was stamped from.
        if crumb:
            art = {
                "@context": "https://schema.org",
                "@type": "TechArticle",
                "headline": title.split(" | ")[0],
                "description": desc,
                "url": url,
                "articleSection": crumb[0],
                "isPartOf": {"@type": "WebSite", "name": "SIPI", "url": base + "/"},
                "author": {"@type": "Person", "name": "Geetansh Arora",
                           "jobTitle": "Principal SI/PI Engineer"},
                "publisher": {"@type": "Person", "name": "Geetansh Arora"},
            }
            if reviewed:
                art["dateModified"] = reviewed
            crumbs = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "SIPI",
                     "item": base + "/"},
                    {"@type": "ListItem", "position": 2, "name": crumb[0],
                     "item": base + "/#" + crumb[1]},
                    {"@type": "ListItem", "position": 3,
                     "name": title.split(" | ")[0]},
                ],
            }
            for obj in (art, crumbs):
                website += ('\n  <script type="application/ld+json">'
                            + json.dumps(obj, ensure_ascii=False,
                                         separators=(",", ":"))
                            .replace("</", "<\\/") + "</script>")
        return ('  <!-- meta:start -->\n'
                f'  <link rel="canonical" href="{url}">\n'
                f'  <link rel="describedby" href="{base}/llms.txt" type="text/markdown">\n'
                f'{og}\n{tw}{website}\n'
                '  <!-- meta:end -->')

    pages = [(ROOT / "index.html", base + "/", None, None, "website", None, None)]
    for t in flat:
        if not t["path"].exists():
            continue
        pages.append((t["path"],
                      f'{base}/topics/{t["section_id"]}/{t["slug"]}.html',
                      None, None, "article",
                      (t["section"], t["section_id"]), t.get("reviewed")))
    # M5-7 · The standalone pages are not topics, so they were not in this list
    # and quietly shipped with no canonical URL and no card. A Pages preview
    # domain then serves each of them twice as far as a crawler is concerned,
    # which is the exact problem canonical tags exist for.
    # start, labs and reference are collections of links rather than prose, so
    # they are websites; the colophon and the model contract are documents.
    HUBS = {"start", "labs", "reference"}
    for stem in ("start", "labs", "reference", "model-contract", "colophon"):
        f = ROOT / (stem + ".html")
        if f.exists():
            pages.append((f, f"{base}/{stem}.html", None, None,
                          "website" if stem in HUBS else "article", None, None))

    n = 0
    for path, url, title, desc, kind, crumb, reviewed in pages:
        html = path.read_text(encoding="utf-8")
        if title is None:
            m = re.search(r"<title>(.*?)</title>", html, re.S)
            title = m.group(1).strip() if m else path.stem
            m = re.search(r'<meta name="description" content="(.*?)">', html, re.S)
            desc = m.group(1).strip() if m else ""
        b = block(url, title, desc, path.name == "index.html", kind, crumb,
                  reviewed)
        new, hits = re.subn(r"  <!-- meta:start -->.*?<!-- meta:end -->", lambda _m: b, html, flags=re.S)
        if not hits:                       # first run: insert just before </head>
            new = html.replace("</head>", b + "\n</head>", 1)
        if new != html:
            path.write_text(new, encoding="utf-8")
            n += 1

    # sitemap — every page, one source of truth
    urls = "\n".join(
        f"  <url><loc>{u}</loc></url>" for _p, u, *_rest in pages)
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + urls + "\n</urlset>\n", encoding="utf-8")

    (ROOT / "robots.txt").write_text(
        "User-agent: *\n"
        "Allow: /\n\n"
        "# Permit search indexing and query-time AI retrieval; reserve model-training use.\n"
        "Content-Signal: search=yes, ai-input=yes, ai-train=no\n\n"
        "Sitemap: " + base + "/sitemap.xml\n", encoding="utf-8")

    llms = [
        "# SIPI",
        "",
        "> Learn signal and power integrity through clear explanations, engineering examples, and interactive browser-based models.",
        "",
        "Created and directed by Geetansh Arora, Principal SI/PI Engineer. The site states model assumptions and evidence explicitly. Educational models do not establish standards compliance, measurement correlation, or suitability for design sign-off outside their documented scope.",
        "",
        "## Start here",
        "",
        f"- [Learning paths]({base}/start.html): Guided routes for students, practising SI and PI engineers, and board debug.",
        f"- [Interactive labs]({base}/labs.html): Long-form labs for transmission lines, channel response, and PDN behavior.",
        f"- [Reference]({base}/reference.html): SI/PI symbols, formulas, assumptions, and unit tools.",
        f"- [Model assumptions and evidence]({base}/model-contract.html): Scope, equations, numerics, limitations, and supporting checks for each interactive model.",
        f"- [About, review, and attribution]({base}/colophon.html): Authorship, review status, sources, licenses, and AI-assistance disclosure.",
    ]
    for sec in data["sections"]:
        live = [t for t in sec["topics"] if t.get("status") in ("live", "brief")]
        if not live:
            continue
        llms += ["", "## " + sec["title"], "", sec["blurb"], ""]
        llms += [
            f'- [{t["title"]}]({base}/topics/{sec["id"]}/{t["slug"]}.html)'
            for t in live
        ]
    llms += [
        "",
        "## Supporting records",
        "",
        f"- [Claim ledger]({base}/docs/claims.md): Source scope and verification state for tracked specification claims.",
        f"- [Code license]({base}/LICENSE-CODE)",
        f"- [Content license]({base}/LICENSE-CONTENT)",
        "",
    ]
    (ROOT / "llms.txt").write_text("\n".join(llms), encoding="utf-8")

    print(f"meta stamped on {n} page(s); sitemap.xml lists {len(pages)}; robots.txt and llms.txt written")


# The four evidence levels, kept deliberately separate (P7-2). A generic
# "verified" badge would collapse claims that are not the same claim.
EVIDENCE = {
    "computed":     "computed",       # the model computes what it says; no independent check
    "plausible":    "plausible",      # physically reasonable, illustrative, not validated
    "independent":  "independent",    # agrees with an independent model or analytical limit
    "specification": "specification",  # compliant with a named, cited specification
}

REQUIRED_CONTRACT_FIELDS = (
    "kind", "evidence", "purpose", "topology", "planes",
    "equations", "units", "validity", "numerics", "limitations", "verified",
    "suites", "version", "reviewed",
)


def _model_types():
    """Every panel publishes a model contract: purpose, topology and reference
    planes, equations and units, validity, numerics, evidence level, version and
    review date. Astra §11: do not collapse the evidence levels into one badge."""
    f = ROOT / "docs" / "model-types.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def contract_problems():
    """Every contract must be complete and name a known evidence level."""
    out = []
    for name, c in MODEL_TYPES.items():
        if not isinstance(c, dict):
            out.append(f"model-types.json: {name} is not a contract object")
            continue
        for field in REQUIRED_CONTRACT_FIELDS:
            if not c.get(field):
                out.append(f"model-types.json: {name} has no {field}")
        if c.get("evidence") and c["evidence"] not in EVIDENCE:
            out.append(f"model-types.json: {name} claims unknown evidence level "
                       f"{c['evidence']!r} (expected one of {sorted(EVIDENCE)})")
        # `kind` is about fidelity, `evidence` is about how well it was checked, and
        # they are genuinely independent. A simplified model can have rigorously
        # verified arithmetic — pdnJitter is a first-order loop whose three transfer
        # paths are nevertheless asserted. An earlier version of this rule forbade
        # that pairing and would have forced a mislabel.
        #
        # The one combination that must not pass unsupported is a specification
        # claim with nothing cited.
        if c.get("evidence") == "specification" and not c.get("source"):
            out.append(f"model-types.json: {name} claims specification evidence with no source cited")
        if c.get("kind") and c["kind"] not in KINDS:
            out.append(f"model-types.json: {name} claims unknown kind {c['kind']!r} "
                       f"(expected one of {sorted(KINDS)})")
    out += evidence_link_problems()
    return out


def evidence_link_problems():
    """M3-1. A `verified` field that names a suite is a claim about this repo, and
    it used to be unchecked prose. The most common way for it to rot is not a
    typo — it is a suite being renamed or split while the contract keeps
    pointing at the old name, so the badge goes on claiming evidence that has
    moved. So: every suite a contract names must exist in check-models.js.

    What this cannot check is whether that suite tests the claim the badge
    makes. Astra's A5 is explicit that a suite's existence is not evidence, so
    the mapping is recorded per panel in docs/model-types.json and reviewed by a
    person; this only enforces referential integrity."""
    out = []
    gate = ROOT / "check-models.js"
    if not gate.exists():
        return out
    text = gate.read_text(encoding="utf-8")
    suites = set(re.findall(r"^suite\('([^']+)'", text, re.M))
    suites |= set(re.findall(r'^suite\("([^"]+)"', text, re.M))
    for name, c in MODEL_TYPES.items():
        named = c.get("suites")
        if not named:
            out.append(f"model-types.json: {name} lists no suites, so its evidence "
                       f"claim points at nothing checkable")
            continue
        for want in named:
            if not any(s == want or s.startswith(want + " \u2014") for s in suites):
                out.append(f"model-types.json: {name} cites check-models.js suite "
                           f"{want!r}, which does not exist \u2014 renamed or removed?")
    return out


MODEL_TYPES = _model_types()


def esc(t):
    """The contract is generated into HTML, and its fields are prose that will
    one day contain an ampersand or an angle bracket."""
    return (str(t).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


CONTRACT_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interactive Model Assumptions and Evidence | SIPI</title>
<meta name="description" content="What every interactive model on this site assumes, what it computes, and how well it has been checked. Generated from the catalogue the build gate validates.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
</head>
<body>

<header class="masthead">
  <a class="wordmark" href="index.html">SI<span class="amp">&amp;</span>PI</a>
  <nav>
    <a href="index.html#fundamentals">Fundamentals</a>
    <a href="index.html#power-integrity">Power</a>
    <a href="index.html#interfaces">Interfaces</a>
    <a href="start.html">Start</a>
    <a href="labs.html">Labs</a>
    <a href="reference.html">Reference</a>
    <button class="theme-toggle" data-act="theme" type="button">System</button>
  </nav>
</header>

<main>
  <div class="page-head">
    <p class="crumb"><a href="index.html">SIPI</a> / model contracts</p>
    <h1>Interactive model assumptions and evidence</h1>
    <p class="byline"><span>Generated from <code>docs/model-types.json</code></span><span>{n} panels</span><span>{tally}</span></p>
    <p class="answer">
      Each interactive panel uses a model with a defined scope. This page publishes the
      contract for all {n} panels: the
      topology, the reference planes, the equations, the units, the range over which it is
      valid, how it is computed, and the evidence available for its behavior.
    </p>
  </div>

  <div class="prose">
    <h2>How to read the evidence labels</h2>
    <p>
      Evidence can support several different kinds of conclusions. A model that
      computes its own formula correctly, a model that behaves plausibly, and a model that
      agrees with an independent check are three different claims, and collapsing them into
      one label would blur those distinctions, so the site reports the evidence category explicitly.
    </p>
    <div class="ev-key">{levels}</div>
    <p>
      The fourth level is listed for reference and is currently unused. These model labels do not
      claim validation against a published specification. Where a page states a
      specification claim, it is recorded in the
      <a href="docs/claims.md">claim ledger</a> with its status, and most of those are still
      awaiting a primary source.
    </p>
    <p>
      <em>Kind</em> and <em>evidence</em> answer different questions. A deliberately
      simplified model can have rigorously checked arithmetic: the PDN-induced jitter panel
      is a first-order loop rather than a solved PLL, and the behaviour that matters &#8212;
      that its three injection points are treated oppositely &#8212; is asserted by the model
      gate.
    </p>
    <p>
      This page is generated by <code>python3 scaffold.py contract</code> from the same file
      the build gate validates, so what is published here and what is enforced cannot drift
      apart.
    </p>
  </div>
{rows}
</main>

<footer class="site-foot">
  <span>SIPI &#8212; signal and power integrity, visualised.</span>
  <span>Created and directed by Geetansh Arora. <a href="colophon.html">About, review &amp; AI assistance</a> &#183; <a href="model-contract.html">Model assumptions</a> &#183; <a href="docs/claims.md">Claim ledger</a></span>
</footer>

<script src="js/site.js"></script>
</body>
</html>
"""


# M3-2. Fidelity: how much a number can be trusted. Kept separate from
# `evidence`, which is how well it has been checked — a simplified model can
# have rigorously verified arithmetic, and a sophisticated one can be unchecked.
KINDS = {"exact", "analytical", "numerical", "illustrative", "specification"}

EVIDENCE_BLURB = {
    "computed": "The model computes the stated relation. An independent comparison "
                "has not been recorded for this result.",
    "plausible": "Physically reasonable and useful for teaching. Deliberately "
                 "simplified, with no independent validation recorded.",
    "independent": "Agrees with an independent model, an analytical limit or a "
                   "conservation law that does not reuse the implementation result.",
    "specification": "Matches a named, cited specification. No panel on this site "
                     "claims this level.",
}


# ── M3-4 · the claim ledger ────────────────────────────────────────────────
# docs/claims.json is the source; docs/claims.md is generated from it. It used
# to be the other way round, and the counts were taken by grepping status words
# out of the prose — which also counted the status key, the "may not be marked
# verified" paragraph and the closing notes, and gave the wrong answer. G-7.
# N0-3 / Astra §8.2. A tick used to mean one thing: "I wrote this." That is what
# produced the last round's surprise -- M7 was 76 of 77 complete and shipped three
# P0 blockers, one of them introduced by the commit that closed it. A badge should
# answer a SPECIFIC question, so these are the five separate questions.
EVIDENCE_LEVELS = {
    "built": "the code exists and the author believes it works",
    "gated": "a check in ./check fails if it regresses",
    "exercised": "driven through the path a reader actually takes, in a browser",
    "benchmarked": "compared against an independently written implementation or an "
                   "analytical limit",
    "reviewed": "read and approved by a person with the domain knowledge",
}


def contract_prose_problems():
    """Contract text is READER-FACING: it is painted into every exported report
    and CSV. It must describe the model, not narrate its repair history.

    Found by reading an actual export (N4-8): labChannel's validity carried
    "(N2-2)" and "The retired claim that..." into every downloaded artefact. A
    reader has no idea what N2-2 is, and should not have to."""
    out = []
    tags = re.compile(r"\b(?:N\d-\d+[a-z]?|M\d-\d+[a-z]?|R\d+)\b")
    narration = re.compile(r"\b(?:retired|used to say|previously said|the old (?:note|claim|comment))\b",
                           re.I)
    for name, c in MODEL_TYPES.items():
        for field in ("purpose", "validity", "limitations", "numerics", "topology"):
            text = c.get(field) or ""
            hit = tags.search(text)
            if hit:
                out.append(f"model-types.json: {name}.{field} carries the internal "
                           f"reference {hit.group(0)!r}, which is painted into every "
                           f"export a reader downloads")
            if narration.search(text):
                out.append(f"model-types.json: {name}.{field} narrates the model's "
                           f"repair history; a contract describes what the model IS")
    return out


def evidence_problems():
    """Both plans must define the vocabulary and use only its words.

    The failure this prevents is not a typo. It is an item marked done on the
    strength of "I wrote it" while the reader takes it to mean "somebody checked
    it" -- which is exactly how a ReferenceError reached the site's featured
    button behind a green gate."""
    out = []
    plans = sorted(ROOT.glob("docs/opus_fixes_astra_*.md"))
    if not plans:
        return out
    legal = set(EVIDENCE_LEVELS)
    for f in plans:
        text = f.read_text(encoding="utf-8")
        used = set(re.findall(r"\bevidence:\s*([a-z]+)", text))
        for word in sorted(used - legal):
            out.append(f"{f.name}: unknown evidence level {word!r} - "
                       f"legal values are {', '.join(sorted(legal))}")
    newest = plans[-1]
    if "## Evidence levels" not in newest.read_text(encoding="utf-8"):
        out.append(f"{newest.name}: the current plan must define the evidence "
                   f"vocabulary it uses - add an `## Evidence levels` section")
    return out


SOURCE_TYPES = {
    "normative": "a requirement in a named standard",
    "public-rate": "a data rate the standards body has published openly",
    "vendor": "an implementation guide or application note",
    "commercial": "a supplier capability, not a standard",
    # Added for M7-5. A measurement somebody published and signed their name to
    # is not a standard's requirement and not a supplier's claim about its own
    # product; it is evidence, and conflating it with either loses what makes it
    # worth citing -- that it is independent and reproducible in principle.
    "measured": "a measurement published in the open literature",
}
CLAIM_STATUS = ("verified", "scoped", "awaiting")


def _claims():
    f = ROOT / "docs" / "claims.json"
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text(encoding="utf-8"))["claims"]
    except (ValueError, KeyError) as e:
        raise SystemExit(f"docs/claims.json is not readable: {e}")


def _panel_manifest():
    """Every page carrying a panel, with the presets it exposes. tests/preset-sweep.html
    drives this: a preset missing from the manifest is a preset nothing exercises."""
    pages = []
    for f in sorted(list(ROOT.glob("topics/*/*.html")) + [ROOT / "index.html"]):
        s = f.read_text(encoding="utf-8")
        vizzes = re.findall(r'data-viz="([^"]+)"', s)
        if not vizzes:
            continue
        pages.append({"url": str(f.relative_to(ROOT)), "panels": vizzes,
                      "presets": sorted(set(re.findall(r'data-preset="([^"]+)"', s)))})
    return {"generated": "scaffold.py panels", "pages": pages,
            "totals": {"pages": len(pages),
                       "panels": sum(len(p["panels"]) for p in pages),
                       "presets": sum(len(p["presets"]) for p in pages)}}


def panel_manifest_problems():
    """N1-1. The browser sweep cannot run in this gate -- it needs a browser -- but a
    STALE manifest is catchable here, and a stale manifest is how a new preset would
    quietly never be exercised."""
    path = ROOT / "tests" / "panels.json"
    want = _panel_manifest()
    if not path.exists():
        return ["tests/panels.json is missing - run `python3 scaffold.py panels`"]
    try:
        have = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"tests/panels.json will not parse: {e}"]
    if have.get("pages") != want["pages"]:
        hp = {p["url"]: p for p in have.get("pages", [])}
        wp = {p["url"]: p for p in want["pages"]}
        out = []
        for u in sorted(set(hp) | set(wp)):
            if u not in hp:
                out.append(f"tests/panels.json: {u} has a panel but is not in the manifest")
            elif u not in wp:
                out.append(f"tests/panels.json: {u} is in the manifest but has no panel")
            elif hp[u] != wp[u]:
                a, b = set(hp[u]["presets"]), set(wp[u]["presets"])
                out.append(f"tests/panels.json: {u} presets drifted "
                           f"(added {sorted(b - a)}, removed {sorted(a - b)})")
        return (out or ["tests/panels.json is stale"]) + \
               ["  run `python3 scaffold.py panels`, then re-run tests/preset-sweep.html"]
    return []


def claim_problems():
    """The rules a ledger row has to satisfy. The important one is the last:
    a normative claim cannot be verified from a press release."""
    out = []
    seen = set()
    for c in _claims():
        cid = c.get("id", "?")
        for field in ("id", "statement", "pages", "source_type", "source",
                      "conditions", "status", "note", "owner"):
            if field not in c:
                out.append(f"claims.json: {cid} has no {field}")
        if cid in seen:
            out.append(f"claims.json: duplicate id {cid}")
        seen.add(cid)
        if c.get("source_type") not in SOURCE_TYPES:
            out.append(f"claims.json: {cid} has unknown source_type "
                       f"{c.get('source_type')!r}")
        if c.get("status") not in CLAIM_STATUS:
            out.append(f"claims.json: {cid} has unknown status {c.get('status')!r}")
        # N3-2g. One `reviewer` field carried three different meanings: who owns
        # the claim, who checked it against its source, and whether a person with
        # the domain knowledge has read and approved it. All thirteen named rows
        # said "Geetansh" and every one of those checks was in fact done by the
        # model. A badge should answer a specific question, so the fields are now
        # separate and a human review cannot be implied by an AI one.
        if c.get("status") in ("verified", "scoped") and not (c.get("sourceCheckedBy")
                                                              and c.get("sourceCheckedOn")):
            out.append(f"claims.json: {cid} is {c['status']} with no source check and date")
        if c.get("humanReviewedBy") and not c.get("humanReviewedOn"):
            out.append(f"claims.json: {cid} names a human reviewer with no date")
        if c.get("sourceCheckedBy") and "claude" in str(c.get("sourceCheckedBy")).lower() \
                and c.get("humanReviewedBy"):
            out.append(f"claims.json: {cid} records an AI source check AND a human review "
                       f"- if both happened, say so in the note; the fields are not "
                       f"interchangeable")
        # THE RULE. A standard's requirement is verified by reading the standard.
        # A rate announcement, an application note or a supplier's datasheet can
        # support a different KIND of claim, and saying so is the point of
        # source_type — but none of them verifies a normative one.
        if c.get("status") == "verified" and c.get("source_type") == "normative":
            out.append(f"claims.json: {cid} claims a normative requirement is "
                       f"verified. That needs the standard read, and the ledger "
                       f"cannot record it from anything else")
        for pg in c.get("pages", []):
            if not (ROOT / "topics" / (pg + ".html")).exists():
                out.append(f"claims.json: {cid} names page {pg!r}, which does not exist")
    return out


def claim_counts():
    cl = _claims()
    n = {k: 0 for k in CLAIM_STATUS}
    for c in cl:
        if c.get("status") in n:
            n[c["status"]] += 1
    return {"total": len(cl), **n}


CLAIMS_HEAD = """# Claim ledger — protocol and specification statements

**Generated from [`claims.json`](claims.json) by `python3 scaffold.py claims`.**
Edit the JSON, not this file.

Every claim on this site that rests on a **specification** rather than on first
principles belongs here, with the source it needs, the conditions it assumes,
who checked it and when. Numbers derivable from physics are handled instead by
`check-numbers.py`, which recomputes them.

## What a source type means

| type | means | can verify |
|---|---|---|
| `normative` | a requirement in a named standard | only by reading that standard |
| `public-rate` | a data rate the standards body has published openly | itself, and nothing electrical |
| `vendor` | an implementation guide or application note | how somebody implemented it |
| `commercial` | a supplier capability, not a standard | what suppliers offer |

A **normative** claim cannot be marked verified from a rate announcement, an
application note or a datasheet. `scaffold.py check` enforces that, so the
distinction cannot quietly erode.

## Status

| | |
|---|---|
| **verified** | read against the cited source, with who checked it and when recorded. This is a SOURCE check, and on every current row it was done by the model, not by a person - see the owner / sourceCheckedBy / humanReviewedBy split |
| **scoped** | wording narrowed so it no longer asserts more than is known |
| **awaiting** | stated on the page and not yet checked against its source |

"""


def cmd_claims():
    cl = _claims()
    probs = claim_problems()
    if probs:
        for x in probs:
            print("  \u2717", x)
        return 1
    n = claim_counts()
    rows = ["| # | Claim | Pages | Source needed | Type | Status | Reviewed |",
            "|---|---|---|---|---|---|---|"]
    for c in cl:
        pages = ", ".join(f"`{x}`" for x in c["pages"])
        note = (" \u2014 " + c["note"]) if c["note"] else ""
        who = (c.get("reviewer") or "") + (", " + c["reviewed"] if c.get("reviewed") else "")
        who = who or "\u2014"
        rows.append(f"| {c['id']} | {c['statement']} | {pages} | {c['source']} "
                    f"| `{c['source_type']}` | **{c['status']}**{note} | {who} |")
    body = (CLAIMS_HEAD
            + f"**{n['total']} claims: {n['verified']} verified, {n['scoped']} scoped, "
            + f"{n['awaiting']} awaiting a source.**\n\n"
            + "Compound claims are split, because verifying one half used to verify the whole\n"
            + "row. \"Gen 4 is 28 dB and Gen 5 is 36 dB\" is two budgets against two editions;\n"
            + "\"FLIT-only with FEC and CRC and replay\" is four mechanisms doing different jobs.\n\n"
            + "## Ledger\n\n" + "\n".join(rows) + "\n")
    (ROOT / "docs" / "claims.md").write_text(body, encoding="utf-8")
    k = stamp_sources()
    if k:
        print(f"  stamped source blocks on {k} page(s)")
    r = stamp_review()
    if r:
        print(f"  stamped review status on {r} page(s)")
    print(f"  docs/claims.md \u2014 {n['total']} claims "
          f"({n['verified']} verified, {n['scoped']} scoped, {n['awaiting']} awaiting)")
    return 0


# ── M3-5 / M3-6 · sources, on the page rather than in a ledger ─────────────
SOURCES_START = "<!-- sources:start -->"
SOURCES_END = "<!-- sources:end -->"


def _extra_sources():
    """References a page cites that are not tied to a ledger claim. These were
    the only two external links on the whole site before M3-5."""
    return {
        "signal-integrity/ibis-ami-spice": [
            ("IBIS 8.0 specification \u2014 AMI lifecycle and flags",
             "https://ibis.org/ver8.0/ver8_0.pdf")],
        "power-integrity/pdn-induced-jitter": [
            ("Analog Devices AN-143 \u2014 PLL noise injection paths",
             "https://www.analog.com/media/en/technical-documentation/application-notes/AN143f.pdf")],
        "methodology/measurement-practice": [
            ("Keysight \u2014 impedance measurement parameter definitions",
             "https://helpfiles.keysight.com/csg/e5061b/measurement_with_options/option_005_impedance_analysis/setting_up_measurement/setting_measurement_condition/setting_measurement_parameters_and_display_formats.htm"),
            ("Keysight 5991-0213EN \u2014 low-impedance measurement",
             "https://www.keysight.com/us/en/assets/7018-03423/application-notes/5991-0213.pdf")],
        "groundwork/domain-bridges": [
            ("Keysight 5990-5266EN \u2014 causality and Kramers-Kronig in "
             "S-parameter models",
             "https://www.keysight.com/zz/en/assets/7018-02435/white-papers/5990-5266.pdf")],
        "labs/one-channel": [
            ("Ansys \u2014 the Djordjevic-Sarkar causal dielectric model",
             "https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v242/en/Subsystems/HFSS/Content/HFSS/DjordjevicSarkarCausalDielectricModel.htm"),
            ("Touchstone 2.1 specification",
             "https://ibis.org/touchstone_ver2.1/touchstone_ver2_1.pdf")],
    }


def _sources_for_page(slug):
    """Every source this page should show: the ones its ledger claims cite, plus
    any hand-listed references. Deduplicated by URL."""
    out, seen = [], set()
    for c in _claims():
        if slug in c.get("pages", []) and c.get("source_url"):
            key = c["source_url"]
            if key in seen:
                continue
            seen.add(key)
            out.append((c["source_title"], key, c["id"]))
    for title, url in _extra_sources().get(slug, []):
        if url not in seen:
            seen.add(url)
            out.append((title, url, None))
    return out


def stamp_sources():
    """M3-5. Before this, 57 of 59 topic pages had no external reference at all,
    and a reader who wanted to check a normative claim had to find the internal
    ledger and work out which row applied. The block is generated, so a page
    cannot cite a source the ledger does not have and the ledger cannot hold a
    source the page never shows."""
    n = 0
    for f in sorted((ROOT / "topics").rglob("*.html")):
        slug = f.relative_to(ROOT / "topics").with_suffix("").as_posix()
        srcs = _sources_for_page(slug)
        html = f.read_text(encoding="utf-8")
        if not srcs:
            # remove a stale block if the claims moved away from this page
            if SOURCES_START in html:
                html = re.sub(re.escape(SOURCES_START) + r"[\s\S]*?"
                              + re.escape(SOURCES_END) + r"\n?", "", html)
                f.write_text(html, encoding="utf-8")
                n += 1
            continue
        items = "".join(
            # target="_blank" as well as rel="noopener". These are citations inside
            # a lesson: a reader who follows one to a 40-page specification and
            # comes back has lost their scroll position and whatever they had set
            # in the panel above. Adding the attribute by hand in the page does
            # nothing, because this block regenerates over it -- which is exactly
            # what happened on 19 September 2026.
            f'\n      <li><a href="{esc(u)}" target="_blank" rel="noopener">{esc(t)}</a>'
            + (f' <span class="src__for">{esc(cid)}</span>' if cid else "")
            + "</li>" for t, u, cid in srcs)
        blk = (SOURCES_START
               + '\n    <section class="sources">'
               + '\n      <h2 class="section-rule"><span>Sources</span></h2>'
               + '\n      <ul class="sources__list">' + items
               + '\n      </ul>'
               + '\n      <p class="sources__note">Rows marked with a claim id are tracked in '
               + '<a href="../../docs/claims.md">the claim ledger</a>, which records what each '
               + 'source can and cannot establish.</p>'
               + '\n    </section>\n    ' + SOURCES_END + "\n")
        if SOURCES_START in html:
            new = re.sub(re.escape(SOURCES_START) + r"[\s\S]*?" + re.escape(SOURCES_END)
                         + r"\n?", blk, html)
        else:
            anchor = "  <!-- pager:start -->"
            if anchor not in html:
                continue
            new = html.replace(anchor, blk + anchor, 1)
        if new != html:
            f.write_text(new, encoding="utf-8")
            n += 1
    return n


def source_gaps():
    """M3-5's report. A link count is not evidence (A5), so this names the
    claims that have no reachable source rather than counting links per page."""
    out = []
    for c in _claims():
        if c["status"] == "verified" and not c.get("source_url"):
            out.append(f"claims.json: {c['id']} is verified with no reachable "
                       f"source_url, so a reader cannot check it")
    return out


# ── M3-7 · attribution, in four separate statuses ─────────────────────────
REVIEW_START = "<!-- review:start -->"
REVIEW_END = "<!-- review:end -->"


def review_state(topic, slug, html, site_review=None):
    """Four different questions, kept apart because they have four different
    answers and only one of them needs a person.

      authored      somebody wrote it. Every page.
      model checked a panel on this page has a contract whose evidence names
                    suites that exist. Derived.
      spec scoped   a specification claim on this page has been narrowed or
                    sourced. Derived from the ledger.
      reviewed      a human read it for technical correctness. NOT derivable,
                    and absent by default.

    Astra's point is that generating content into a repository is not review,
    and a schema that demands a reviewer will get an invented one. So `reviewed`
    is opt-in per topic or recorded in a dated, frozen site-review page list."""
    site_review = site_review or {}
    in_site_review = slug in site_review.get("topics", [])
    st = {"authored": True, "modelled": False, "scoped": False,
          "reviewed": (topic.get("reviewed") or
                       (site_review.get("date") if in_site_review else None)),
          "reviewer": (topic.get("reviewer") or
                       (site_review.get("reviewer") if in_site_review else None))}
    for viz in re.findall(r'<section class="instrument[^"]*" data-viz="(\w+)"', html):
        c = MODEL_TYPES.get(viz)
        if c and c.get("suites"):
            st["modelled"] = True
    for c in _claims():
        if slug in c.get("pages", []) and c["status"] in ("verified", "scoped"):
            st["scoped"] = True
    return st


def review_problems():
    """A review attribution needs a person and a date, or it is decoration."""
    out = []
    data, flat = load()
    for t in flat:
        if t.get("reviewed") and not t.get("reviewer"):
            out.append(f"topics.json: {t['slug']} has a review date with no reviewer")
        if t.get("reviewer") and not t.get("reviewed"):
            out.append(f"topics.json: {t['slug']} names a reviewer with no date")
    site_review = data["site"].get("technicalReview", {})
    reviewed_topics = site_review.get("topics", [])
    if reviewed_topics:
        if not site_review.get("reviewer") or not site_review.get("date"):
            out.append("topics.json: site technicalReview needs a reviewer and date")
        known = {f'{t["section_id"]}/{t["slug"]}' for t in flat}
        unknown = set(reviewed_topics) - known
        if unknown:
            out.append("topics.json: technicalReview names unknown topic(s): " +
                       ", ".join(sorted(unknown)))
        if len(reviewed_topics) != len(set(reviewed_topics)):
            out.append("topics.json: technicalReview contains duplicate topic paths")
    return out


def stamp_review():
    """The byline, generated from the review record so it cannot drift from it.

    It used to be three hand-written spans plus a stamped evidence sentence —
    "model evidence documented · technical review: Geetansh 2026-09-14" — sitting
    under an "Updated Sep 2026" that meant something else. Two dates, one of them
    vague, and a sentence most readers skipped.

    Now there is one line: who wrote it, the date that page was reviewed, and how
    long it takes to read. The date IS the review date, carried in a <time> element
    so it stays machine-readable, with the claim it represents in the title
    attribute rather than spelled out on screen. What the review covered is on the
    colophon; the suites behind a panel are in that panel's model contract.

    A page with no recorded review keeps a plain "Updated" date, because an
    unexplained date on an unreviewed page would imply a review that did not happen.
    """
    MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    n = 0
    data, flat = load()
    site = data["site"]
    author = site.get("author", "Geetansh Arora")
    site_review = site.get("technicalReview", {})
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        slug = t["path"].relative_to(ROOT / "topics").with_suffix("").as_posix()
        st = review_state(t, slug, html, site_review)

        m = re.search(r"~?(\d+)\s*min", html)
        mins = m.group(1) if m else "10"

        if st["reviewed"]:
            y, mo, d = st["reviewed"].split("-")
            shown = f"{int(d)} {MONTHS[int(mo) - 1]} {y}"
            who = st["reviewer"] or author
            when = (f'<time datetime="{esc(st["reviewed"])}" '
                    f'title="Technical review by {esc(who)} on this date">{esc(shown)}</time>')
        else:
            when = "<span>Updated Sep 2026</span>"

        blk = (REVIEW_START
               + f"<span>By {esc(author)} — Principal SI/PI Engineer</span>"
               + when + f"<span>{mins} min</span>" + REVIEW_END)
        out = re.sub(r'<p class="byline">[\s\S]*?</p>',
                     lambda _m: f'<p class="byline">\n      {blk}\n    </p>', html, count=1)
        if out != html:
            t["path"].write_text(out, encoding="utf-8")
            n += 1
    return n

def _absolutes():
    f = ROOT / "docs" / "absolutes.json"
    if not f.exists():
        return {"banned": [], "reviewed": []}
    return json.loads(f.read_text(encoding="utf-8"))


def banned_phrase_problems():
    """Each banned phrase was WRONG on this site and was corrected. This refuses
    to let it come back — which is a narrow claim and a true one.

    What it deliberately does not do is gate the 1,229 absolute-sounding words
    across the topic pages. A5 is explicit that annotating every occurrence of
    "always" does not establish technical scope, and word-matching would have
    missed two of the five errors found this round: "a matched load absorbs half
    the power" contains no absolute word at all. `scaffold.py absolutes` prints
    the queue for a person to work; this only stops regressions."""
    out = []
    banned = _absolutes()["banned"]
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        # Two exemptions, both explicit. The JSON islands quote corrected
        # wording in their `limitations`; and a page may QUOTE the old error in
        # order to explain it, which is worth more than hiding it — marked with
        # <q data-was-wrong>…</q> so the exemption is visible in the source
        # rather than inferred by the scanner.
        body = re.sub(r'<script type="application/json"[\s\S]*?</script>', "", text)
        body = re.sub(r'<q data-was-wrong>[\s\S]*?</q>', "", body)
        for b in banned:
            if b["phrase"].lower() in body.lower():
                out.append(f"{rel}: the phrase {b['phrase']!r} was corrected and "
                           f"must not return. {b['why']} Instead: {b['instead']}")
    return out


def cmd_absolutes():
    """The work queue. Prints every absolute-sounding word in the prose, worst
    pages first, so a sweep is repeatable — and says plainly that the count is
    not a measure of anything."""
    a = _absolutes()
    data, flat = load()
    rows = []
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        if "<main>" not in html:
            continue
        body = html.split("<main>")[1].split("</main>")[0]
        body = re.sub(r"<(script|style)[\s\S]*?</\1>", "", body)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))
        n = sum(len(re.findall(w, text, re.I)) for w in ABS_WORDS)
        rows.append((n, t["path"].relative_to(ROOT).as_posix()))
    rows.sort(reverse=True)
    total = sum(n for n, _ in rows)
    print(f"  {total} absolute-sounding word(s) across {len(rows)} page(s)")
    print(f"  {len(a['banned'])} phrase(s) banned as regressions, "
          f"{len(a['reviewed'])} scoping judgement(s) recorded")
    print("")
    print("  Most of these are ordinary English and correct. The count is a work")
    print("  queue, not a defect measure — and it would have missed two of the five")
    print("  errors found this round, because those had no absolute word in them.")
    print("")
    for n, rel in rows[:12]:
        print(f"    {n:4d}  {rel}")
    return 0


def cmd_contract():
    """Publish docs/model-types.json as a page. Generated, never hand-edited, so
    the published contract cannot drift from the one the gate validates."""
    probs = contract_problems()
    if probs:
        for x in probs:
            print("  \u2717", x)
        return 1

    order = sorted(MODEL_TYPES.items(), key=lambda kv: (kv[1]["evidence"], kv[0]))
    rows = []
    for name, c in order:
        eqs = "".join(f"<li><code>{esc(e)}</code></li>" for e in c["equations"])
        rows.append(f"""
  <section class="contract" id="{esc(name)}">
    <div class="contract__head">
      <h2>{esc(name)}</h2>
      <span class="model-tag model-tag--{esc(c['kind'])}">{esc(c['kind'])} model</span>
      <span class="ev ev--{esc(c['evidence'])}">{esc(c['evidence'])}</span>
      <span class="contract__ver">v{esc(c['version'])} &#183; reviewed {esc(c['reviewed'])}</span>
    </div>
    <p class="contract__purpose">{esc(c['purpose'])}</p>
    <dl class="contract__body">
      <dt>Topology</dt><dd>{esc(c['topology'])}</dd>
      <dt>Reference planes</dt><dd>{esc(c['planes'])}</dd>
      <dt>Equations</dt><dd><ul class="tight">{eqs}</ul></dd>
      <dt>Units</dt><dd>{esc(c['units'])}</dd>
      <dt>Validity</dt><dd>{esc(c['validity'])}</dd>
      <dt>Numerics</dt><dd>{esc(c['numerics'])}</dd>
      <dt>Known limitations</dt><dd>{esc(c.get('limitations', c['validity']))}</dd>
      <dt>Evidence</dt><dd>{esc(c['verified'])}</dd>
    </dl>
  </section>""")

    levels = "".join(
        f'<div class="ev-key__row"><span class="model-tag model-tag--{k}">{k}</span>'
        f'<p>{esc(v)}</p></div>' for k, v in KIND_BLURB.items() if k != "specification")
    levels += "".join(
        f'<div class="ev-key__row"><span class="ev ev--{k}">{k}</span>'
        f'<p>{esc(v)}</p></div>' for k, v in EVIDENCE_BLURB.items())

    kinds, evs = {}, {}
    for _, c in order:
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
        evs[c["evidence"]] = evs.get(c["evidence"], 0) + 1
    tally = ("fidelity: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
             + " · evidence: "
             + ", ".join(f"{n} {k}" for k, n in sorted(evs.items())))
    counts = evs

    page = CONTRACT_PAGE.format(n=len(order), tally=esc(tally),
                                levels=levels, rows="".join(rows))
    page, _ = _stamp_one(page, "model-contract.html", {})
    # and its own metadata, for the same reason
    data, _f = load()
    base = data["site"]["url"].rstrip("/")
    blk = _meta_block(base + "/model-contract.html", "Interactive Model Assumptions and Evidence | SIPI",
                      "What each interactive model on this site assumes, how it "
                      "is computed, what it is known not to do, and which test "
                      "suites its evidence rests on.")
    if "<!-- meta:start -->" in page:
        page = re.sub(r"  <!-- meta:start -->[\s\S]*?<!-- meta:end -->", blk, page)
    else:
        page = page.replace("</head>", blk + "\n</head>", 1)
    (ROOT / "model-contract.html").write_text(page, encoding="utf-8")
    k = stamp_badges()
    print(f"  model-contract.html \u2014 {len(order)} panels ({tally})")
    if k:
        print(f"  stamped evidence + version on badges across {k} page(s)")
    return 0


def deployment_problems():
    """P7-8. The _headers file grants a one-year immutable cache to /css/* and
    /js/*, which is only safe while every reference to them carries a content
    hash. An unversioned reference under that rule is a stale asset that nobody
    can invalidate — not by redeploying, not by purging, not by a hard refresh on
    someone else's machine. This has been broken once, by a page generator that
    wrote its own hrefs without stamping them, so it is checked rather than
    trusted."""
    out = []
    for f in site_html():
        html = f.read_text(encoding="utf-8")
        for m in re.finditer(r'(?:href|src)="((?:\.\./)*(?:css|js)/[^"]+\.(?:css|js))(\?[^"]*)?"', html):
            if not (m.group(2) or "").startswith("?v="):
                out.append(f"{f.relative_to(ROOT)}: {m.group(1)} has no ?v= — "
                           f"it would be cached immutably and could never be updated")
    h = ROOT / "_headers"
    if h.exists():
        text = h.read_text(encoding="utf-8")
        # A Cache-Control under a bare /* would overlap every other rule, and
        # which one wins is a host detail this file must not depend on.
        block, in_star = None, False
        for line in text.splitlines():
            if line.startswith("/"):
                block = line.strip()
                in_star = block == "/*"
            elif in_star and line.strip().lower().startswith("cache-control"):
                out.append("_headers: /* sets Cache-Control, which overlaps every "
                           "other rule — set it per path instead")
    return out


KIND_LABEL = {
    "exact": "exact",
    "analytical": "analytical",
    "numerical": "numerical",
    "illustrative": "illustrative",
    "specification": "from a specification",
}

# M3-2. "EXACT MODEL" was on sixteen of twenty-four panels, which made it a
# decoration rather than a claim. These four say something a reader can act on:
# whether a number can be trusted to its last digit, whether it rests on a
# physical assumption, whether it depends on a grid, or whether only its shape
# is meant.
KIND_BLURB = {
    "exact": "Arithmetic, or a closed form, with no modelling assumption beyond "
             "the waveform or topology named. Read the stated precision and scope.",
    "analytical": "A closed form under stated physical assumptions. Exact for the "
                  "circuit described; the assumptions are where it departs from a "
                  "real one, and they are listed.",
    "numerical": "The answer depends on a grid — an FFT length, a quadrature, a "
                 "sweep. Convergence bounds are stated, and a scenario that does "
                 "not meet them returns no number rather than a wrong one.",
    "illustrative": "The model is intended to explain a mechanism or qualitative shape. "
                    "Its numbers are for teaching and are not intended for a design budget.",
    "specification": "Taken from a named, cited specification.",
}


CONTRACT_KEYS = ("kind", "evidence", "purpose", "equations", "units", "validity",
                 "numerics", "limitations", "suites", "version", "reviewed")


def _stamp_contract_blocks(html):
    """M3-3. Verify mode used to read the badge's `title` attribute — a
    hand-written sentence that could say anything and frequently said less than
    the contract did. It now reads the contract itself, which means the contract
    has to be ON the page: there is no build step to fetch it at runtime, and a
    fetch would break the pages that work from file://.

    So each panel gets a JSON island carrying its own entry, re-stamped on every
    build. About a kilobyte a panel, and Verify mode becomes self-contained —
    equations, assumptions, numerics, known limitations and the suites its
    evidence rests on, for THAT model rather than a shared page."""
    def one(m):
        viz = m.group(1)
        c = MODEL_TYPES.get(viz)
        if not c:
            return m.group(0)
        slim = {k: c[k] for k in CONTRACT_KEYS if k in c}
        slim["panel"] = viz
        block = ('<script type="application/json" data-contract>'
                 + json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
                 .replace("</", "<\\/")
                 + '</script>')
        body = m.group(0)
        # replace an existing island, or insert one right after the section tag
        if 'data-contract>' in body:
            return re.sub(r'<script type="application/json" data-contract>[\s\S]*?</script>',
                          block, body, count=1)
        head_end = body.index('>') + 1
        return body[:head_end] + "\n    " + block + body[head_end:]

    # match each instrument section up to its closing tag
    return re.sub(r'<section class="instrument[^"]*" data-viz="(\w+)"[\s\S]*?</section>',
                  one, html)


def stamp_badges():
    """Put the contract's evidence level and version on the badge itself, so an
    export can carry provenance without fetching anything. The catalogue stays
    the single source of truth; this is a projection of it, re-stamped on every
    build and checked by cmd_check."""
    n = 0
    for f in sorted((ROOT / "topics").rglob("*.html")):
        html = f.read_text(encoding="utf-8")
        out = html

        def sub(m):
            viz = m.group(1)
            c = MODEL_TYPES.get(viz)
            if not c:
                return m.group(0)
            tag = m.group(2)
            tag = re.sub(r'\s+data-(evidence|model-version)="[^"]*"', "", tag)
            # The KIND class and the visible label are stamped too. They used to
            # be hand-written, so a catalogue that said "analytical" sat beside a
            # badge that still read "exact model" — the drift G-7 exists to stop,
            # and cmd_check could only report it, never fix it.
            kind = c["kind"]
            tag = re.sub(r'model-tag--\w+', f'model-tag--{kind}', tag)
            tag = tag.replace(
                "<span class=\"model-tag",
                f'<span data-evidence="{esc(c["evidence"])}" '
                f'data-model-version="{esc(c["version"])}" class="model-tag', 1)
            return m.group(0)[:m.start(2) - m.start(0)] + tag

        out = re.sub(
            r'<section class="instrument[^"]*" data-viz="(\w+)"[\s\S]*?(<span[^>]*class="model-tag[^>]*>)',
            sub, out)

        def label(m):
            c = MODEL_TYPES.get(m.group(1))
            if not c:
                return m.group(0)
            return m.group(0)[:m.start(2) - m.start(0)] + KIND_LABEL.get(
                c["kind"], c["kind"] + " model")

        out = re.sub(
            r'<section class="instrument[^"]*" data-viz="(\w+)"[\s\S]*?<span[^>]*class="model-tag[^>]*>([^<]*)',
            label, out)

        # M3-3 · see _stamp_contract_blocks
        out = _stamp_contract_blocks(out)
        if out != html:
            f.write_text(out, encoding="utf-8")
            n += 1
    return n


def site_stats():
    """The counts the README publishes. Computed, never typed.

    An earlier README table claimed to be "produced by the scripts" and was in
    fact hand-written, and it went stale within the hour — which is the same
    failure P7-5 existed to fix, reintroduced by the fix. So the numbers are
    computed here and cmd_check compares the published table against them."""
    import statistics
    data, flat = load()
    pages = len(flat)
    panels = len(MODEL_TYPES)
    svg = words = 0
    counts = []
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        body = html[html.index("<main>"):html.index("</main>")] if "<main>" in html else ""
        svg += len(re.findall(r"<svg", body))
        stripped = re.sub(r"<(script|svg)[\s\S]*?</\1>", "", body)
        n = len(re.sub(r"<[^>]+>", " ", stripped).split())
        counts.append(n)
        words += n
    claims = len(re.findall(r'^\s*\(\w+ \+ "', (ROOT / "check-numbers.py").read_text(), re.M))
    gate = _run_model_gate() or ""
    m = re.search(r"ok (\d+) model assertion", gate)
    pend = re.search(r"(\d+) claim\(s\) PENDING", gate)

    # Mutation coverage, parsed from the manifest rather than counted by hand.
    mut = (ROOT / "mutate.js")
    mut_total = mut_active = 0
    if mut.exists():
        mtext = mut.read_text(encoding="utf-8")
        body = mtext.split("const MUTATIONS = [", 1)[-1].split("\n];", 1)[0]
        mut_total = len(re.findall(r"^\s{4}id: '", body, re.M))
        mut_active = len(re.findall(r"active: true", body))

    # M3-4 · counted from the structured records, not from the generated prose
    # and certainly not by grepping status words out of a whole file, which is
    # how the earlier figure came to be wrong. G-7.
    cn = claim_counts()
    led_rows = cn["total"]
    led = {k: cn[k] for k in ("verified", "scoped", "awaiting")}
    return {
        "pages": pages, "panels": panels, "svg": svg, "words": words,
        "median": int(statistics.median(counts)) if counts else 0,
        "claims": claims,
        "assertions": int(m.group(1)) if m else None,
        "pending": int(pend.group(1)) if pend else 0,
        "mutations": mut_total, "mutations_active": mut_active,
        "ledger": led_rows, "ledger_verified": led.get("verified", 0),
        "ledger_scoped": led.get("scoped", 0), "ledger_awaiting": led.get("awaiting", 0),
        "deeper": sum(1 for t in flat if t["path"].exists()
                      and 'class="deeper"' in t["path"].read_text(encoding="utf-8")),
    }


def _run_model_gate():
    import subprocess
    try:
        r = subprocess.run(["node", "check-models.js"], cwd=ROOT,
                           capture_output=True, text=True, timeout=120)
        return r.stdout
    except Exception:
        return ""


def cmd_panels(_args=None):
    """Regenerate tests/panels.json. Run after adding a panel or a preset, then
    re-run tests/preset-sweep.html in a browser -- this script cannot click."""
    out = ROOT / "tests" / "panels.json"
    out.parent.mkdir(exist_ok=True)
    man = _panel_manifest()
    out.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    t = man["totals"]
    print(f"  tests/panels.json - {t['pages']} page(s), {t['panels']} panel(s), "
          f"{t['presets']} preset(s)")
    print("  now run tests/preset-sweep.html in a browser; it is the only layer")
    print("  that executes a click handler.")


def cmd_stats():
    st = site_stats()
    for k, v in st.items():
        print(f"  {k:12} {v}")
    readme = ROOT / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        new = re.sub(
            r"(\| Words \| )~?[\d,]+(; median )[\d,]+( per page \|)",
            lambda m: f"{m.group(1)}{st['words']}{m.group(2)}{st['median']}{m.group(3)}",
            text,
        )
        if new != text:
            readme.write_text(new, encoding="utf-8")
            print("  README.md    updated")
    return 0


def ledger_drift():
    """docs/claims.md is generated, so a hand edit to it is a lie that survives
    until the next regeneration. Compare the counts it publishes against the
    records, the same way the README table is checked."""
    f = ROOT / "docs" / "claims.md"
    if not f.exists():
        return []
    text = f.read_text(encoding="utf-8")
    n = claim_counts()
    m = re.search(r"\*\*(\d+) claims: (\d+) verified, (\d+) scoped, (\d+) awaiting",
                  text)
    if not m:
        return ["docs/claims.md has no generated count line — run "
                "`python3 scaffold.py claims`"]
    got = tuple(int(x) for x in m.groups())
    want = (n["total"], n["verified"], n["scoped"], n["awaiting"])
    if got != want:
        return [f"docs/claims.md says {got} but claims.json has {want} — run "
                f"`python3 scaffold.py claims`"]
    rows = len(re.findall(r"^\| C-[\w-]+ \|", text, re.M))
    if rows != n["total"]:
        return [f"docs/claims.md has {rows} table rows but claims.json has "
                f"{n['total']} records — run `python3 scaffold.py claims`"]
    return []


TABLE_WRAPPERS = ("table-scroll", "table-wrap")


def css_class_problems():
    """A class name with no rule behind it is a silent no-op, and this project's
    dominant bug class. I invented three during Milestones 3 to 6 —
    `table-wrap`, `field-fill`, `figure--wide` — and each degraded to nothing
    without a single error anywhere.

    Checking EVERY class would need a real CSS parser and would flag every
    JS-applied state class. So this checks the two families that are purely
    presentational and purely hand-written: the SVG figure vocabulary that
    the project conventions name, and the block-level modifiers on it."""
    out = []
    css = ""
    for f in (ROOT / "css").glob("*.css"):
        css += f.read_text(encoding="utf-8")
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"<figure class=\"([^\"]+)\"([\s\S]*?)</figure>", text):
            names = set(m.group(1).split())
            for inner in re.findall(r'class="([a-z0-9\- ]+)"', m.group(2)):
                names |= set(inner.split())
            for n in sorted(names):
                if not n or n.startswith("is-"):
                    continue
                if ("." + n) not in css:
                    out.append(f"{rel}: figure uses class {n!r}, which has no CSS rule "
                               f"— it degrades to nothing silently")
    return out


def table_problems():
    """M5-5. A wide table must sit in a scroll container — a project rule,
    and the reason the page body must never scroll horizontally. Two failures
    are possible and both were present: a table with no wrapper at all, and a
    wrapper whose class has no CSS rule behind it, which degrades silently to
    no wrapper. The second is this project's dominant bug class."""
    out = []
    css = ""
    for f in (ROOT / "css").glob("*.css"):
        css += f.read_text(encoding="utf-8")
    known = [w for w in TABLE_WRAPPERS if "." + w in css]
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"<table\b", text):
            before = text[max(0, m.start() - 240):m.start()]
            used = [w for w in TABLE_WRAPPERS if w in before]
            if not used:
                out.append(f"{rel}: a <table> with no scroll wrapper — it will push "
                           f"the page wider than the viewport on a phone")
            elif not any(u in known for u in used):
                out.append(f"{rel}: <table> wrapped in {used[0]!r}, which has no CSS "
                           f"rule — a class name with nothing behind it is a no-op")
    # and any wrapper class we do not know about at all
    for f in site_html():
        if "node_modules" in str(f):
            continue
        for cls in set(re.findall(r'class="(table-[a-z-]+)"',
                                  f.read_text(encoding="utf-8"))):
            if cls not in TABLE_WRAPPERS:
                out.append(f"{f.relative_to(ROOT)}: unknown table wrapper {cls!r} "
                           f"(expected one of {list(TABLE_WRAPPERS)})")
    return out


def asset_reference_problems():
    """M5-11. Every page's OpenGraph block points at an image. If that file is
    not in the repository the miss is invisible locally — nothing fetches it —
    and every social card on the deployed site points at a 404. This is the one
    deployment property a local gate CAN settle, so it should."""
    out = []
    idx = ROOT / "index.html"
    if not idx.exists():
        return out
    for m in re.finditer(r'<meta property="og:image" content="([^"]+)"', idx.read_text(encoding="utf-8")):
        url = m.group(1)
        rel = url.split("//", 1)[-1].split("/", 1)[-1] if "//" in url else url.lstrip("/")
        if not (ROOT / rel).exists():
            out.append(f"index.html: og:image points at {rel!r}, which is not in the "
                       f"repository — every social card would 404. Create it, or "
                       f"remove the og:image tags")
    return out


def preset_problems():
    """M7-1. A `.preset` button carries preset styling, and ten modules read
    `PRESETS[b.dataset.preset]` straight out of the table when one is clicked.
    A `.preset` without a `data-preset` therefore threw — and I created exactly
    one by reusing the class for the sweep action.

    Two rules: a preset button names a preset, or it declares itself an action
    with `preset--act`; and a named preset must exist in the module that owns
    the panel."""
    out = []
    for f in sorted((ROOT / "topics").rglob("*.html")):
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r'<button[^>]*class="([^"]*\bpreset\b[^"]*)"([^>]*)>', text):
            cls, rest = m.group(1), m.group(2)
            if "data-preset=" in rest:
                continue
            if "preset--act" in cls:
                if "data-act=" not in rest:
                    out.append(f"{rel}: a preset--act button carries no data-act, so "
                               f"nothing is wired to it")
                continue
            out.append(f"{rel}: a .preset button has no data-preset. Modules read "
                       f"PRESETS[dataset.preset] when one is clicked; add the name, or "
                       f"mark it `preset--act` if it is an action rather than a preset")
    return out


def guide_problems():
    """M6-2. A guide has to be an exercise rather than a demonstration, and two
    things make the difference: a step that asks something must have an answer
    to reveal, and the guide as a whole must ask the reader to apply the idea
    somewhere it was not shown. Without the second, a guide tests recall of the
    settings it just applied."""
    out = []
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        m = re.search(r'<script type="application/json" data-guide>([\s\S]*?)</script>', text)
        if not m:
            continue
        try:
            g = json.loads(m.group(1))
        except ValueError as e:
            out.append(f"{rel}: the guide is not valid JSON ({e})")
            continue
        if not g.get("transfer"):
            out.append(f"{rel}: the guide has no `transfer` question, so it only asks "
                       f"about the settings it applied — see M6-2")
        for i, st in enumerate(g.get("steps", [])):
            if st.get("ask") and not st.get("answer"):
                out.append(f"{rel}: guide step {i + 1} asks a question with no answer "
                           f"to reveal")
            if st.get("answer") and not st.get("ask"):
                out.append(f"{rel}: guide step {i + 1} has an answer but asks nothing")
    return out


def scenario_link_problems():
    """M6-3. A hand-written scenario link is a URL that encodes another page's
    control ids and value encodings, and nothing tells you when it stops being
    right. The homepage's featured experiment was written with `lc-eq=on` where
    the encoding is `1`/`0`, so the link applied every slider and silently left
    the equaliser off — the panel then showed -205 mV where the text promised
    48 mV, and the link looked like it had worked.

    Two rules. A link naming a preset must name one that exists in the module.
    A link setting a control must use an id that exists on the target page, and
    a checkbox must be given 1 or 0."""
    out = []
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r'href="([^"]*?)#lab=([^"]+)"', text):
            target, frag = m.group(1), m.group(2)
            parts = frag.split(";")
            viz = parts[0]
            # resolve the target page
            tf = (f.parent / target).resolve() if target else f
            if not tf.exists():
                out.append(f"{rel}: scenario link points at {target!r}, which does not exist")
                continue
            tgt = tf.read_text(encoding="utf-8")
            ids = set(re.findall(r'id="([\w-]+)"', tgt))
            checkboxes = set(re.findall(r'type="checkbox"\s+id="([\w-]+)"', tgt))
            checkboxes |= set(re.findall(r'id="([\w-]+)"[^>]*type="checkbox"', tgt))
            presets = set(re.findall(r'data-preset="(\w+)"', tgt))
            for seg in parts[1:]:
                if "=" not in seg:
                    continue
                k, v = seg.split("=", 1)
                if k == "v":
                    continue
                if k == "_p":
                    if v not in presets:
                        out.append(f"{rel}: scenario link names preset {v!r}, which "
                                   f"{target or 'this page'} does not offer")
                    continue
                if k not in ids:
                    out.append(f"{rel}: scenario link sets {k!r}, which is not a "
                               f"control on {target or 'this page'}")
                elif k in checkboxes and v not in ("0", "1"):
                    out.append(f"{rel}: scenario link sets checkbox {k!r} to {v!r}; the "
                               f"encoding is 1 or 0, so this silently does nothing")
    return out


def path_problems():
    """M6-1. A learning path whose steps are only links is a table of contents.
    Each step declares what it assumes, what the reader will be able to do, the
    misconception it corrects, a five-minute experiment and a transfer check —
    and a step missing one of those is a step that has quietly become a link
    again."""
    out = []
    f = ROOT / "start.html"
    if not f.exists():
        return out
    text = f.read_text(encoding="utf-8")
    need = ("assumes", "you will be able to", "corrects", "five minutes",
            "transfer check")
    for m in re.finditer(r'<dl class="step">([\s\S]*?)</dl>', text):
        block = m.group(1)
        missing = [k for k in need if f"<dt>{k}</dt>" not in block]
        if missing:
            head = re.search(r">([^<]{6,60})<", block)
            out.append(f"start.html: a path step is missing {missing} "
                       f"(near {head.group(1).strip()[:40] if head else '?'})")
    steps = len(re.findall(r'<dl class="step">', text))
    if steps and steps < 8:
        out.append(f"start.html: the first path has {steps} annotated steps; the "
                   f"SI-and-PI route needs eight to cover both disciplines")
    return out


def metadata_problems():
    """M5-7. Twelve pages shipped with no canonical URL and no OpenGraph card,
    because cmd_meta built its list from topics.json and the standalone pages
    are not topics. A missing canonical is invisible until a preview domain is
    indexed alongside the real one, at which point every page exists twice."""
    out = []
    for f in site_html():
        if "node_modules" in str(f):
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8")
        if rel.name == "404.html":
            if '<meta name="robots" content="noindex, follow">' not in text:
                out.append("404.html must be noindex, follow")
            continue
        if 'rel="canonical"' not in text:
            out.append(f"{rel}: no canonical URL — run `python3 scaffold.py meta`")
        elif 'property="og:title"' not in text:
            out.append(f"{rel}: no OpenGraph title — run `python3 scaffold.py meta`")
        else:
            title = re.search(r"<title>(.*?)</title>", text, re.S)
            og = re.search(r'<meta property="og:title" content="([^"]*)"', text)
            if title and og and title.group(1).strip() != og.group(1).strip():
                out.append(f"{rel}: OpenGraph title disagrees with <title> — "
                           "run `python3 scaffold.py meta`")
        if 'rel="describedby"' not in text or '/llms.txt"' not in text:
            out.append(f"{rel}: no llms.txt discovery link — run `python3 scaffold.py meta`")
    return out


def discovery_problems():
    """Keep the three discovery surfaces aligned with the canonical page set."""
    import xml.etree.ElementTree as ET
    out = []
    data, flat = load()
    base = data["site"]["url"].rstrip("/")
    expected = {base + "/"}
    expected.update(
        f'{base}/topics/{t["section_id"]}/{t["slug"]}.html'
        for t in flat if t["path"].exists())
    expected.update(
        f"{base}/{stem}.html" for stem in
        ("start", "labs", "reference", "model-contract", "colophon")
        if (ROOT / (stem + ".html")).exists())

    robots = ROOT / "robots.txt"
    if not robots.exists():
        out.append("robots.txt is missing — run `python3 scaffold.py meta`")
    else:
        rt = robots.read_text(encoding="utf-8")
        if f"Sitemap: {base}/sitemap.xml" not in rt:
            out.append("robots.txt does not advertise the production sitemap")

    sitemap = ROOT / "sitemap.xml"
    if not sitemap.exists():
        out.append("sitemap.xml is missing — run `python3 scaffold.py meta`")
    else:
        try:
            root = ET.parse(sitemap).getroot()
            got = [e.text for e in root.findall(
                "{http://www.sitemaps.org/schemas/sitemap/0.9}url/"
                "{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
            if len(got) != len(set(got)):
                out.append("sitemap.xml contains duplicate URLs")
            if set(got) != expected:
                out.append("sitemap.xml disagrees with the canonical page set — "
                           "run `python3 scaffold.py meta`")
        except (ET.ParseError, OSError) as exc:
            out.append(f"sitemap.xml is not valid XML: {exc}")

    llms = ROOT / "llms.txt"
    if not llms.exists():
        out.append("llms.txt is missing — run `python3 scaffold.py meta`")
    else:
        lt = llms.read_text(encoding="utf-8")
        if not lt.startswith("# SIPI\n"):
            out.append("llms.txt has no SI/PI Work H1")
        missing = [u for u in expected if u not in lt and u != base + "/"]
        if missing:
            out.append(f"llms.txt omits {len(missing)} canonical page link(s) — "
                       "run `python3 scaffold.py meta`")
    if not (ROOT / "404.html").exists():
        out.append("404.html is missing; Cloudflare Pages would use its SPA fallback")
    return out


def readme_problems():
    """The README's status table must agree with the site. Checked, not trusted."""
    f = ROOT / "README.md"
    if not f.exists():
        return []
    text = f.read_text(encoding="utf-8")
    st = site_stats()
    out = []

    def want(label, pattern, value):
        m = re.search(pattern, text)
        if not m:
            return
        got = int(m.group(1).replace(",", ""))
        if got != value:
            out.append(f"README.md: {label} says {got}, site has {value} — run "
                       f"`python3 scaffold.py stats`")

    want("topic pages", r"\| Topic pages \| \*\*(\d+)\*\*", st["pages"])
    want("words", r"\| Words \| ~?([\d,]+)", st["words"])
    want("median words", r"\| Words \|.*?median ([\d,]+)", st["median"])
    want("interactive panels", r"\| Interactive panels \| \*\*(\d+)\*\*", st["panels"])
    want("SVG figures", r"\| SVG figures \| (\d+)", st["svg"])
    want("arithmetic claims", r"\| Arithmetic claims checked \| \*\*(\d+)\*\*", st["claims"])
    if st["assertions"]:
        want("model assertions", r"\| Model assertions \| \*\*(\d+)\*\*", st["assertions"])
        want("pending claims", r"\| Model assertions \|.*?\*\*(\d+) claims pending\*\*",
             st["pending"])
    want("mutations caught", r"\| Mutation coverage \| \*\*(\d+) of \d+\*\*", st["mutations_active"])
    want("mutations known", r"\| Mutation coverage \| \*\*\d+ of (\d+)\*\*", st["mutations"])
    want("ledger rows", r"\| Specification claims \| \*\*(\d+) tracked", st["ledger"])
    want("ledger verified", r"\| Specification claims \| \*\*\d+ tracked: (\d+) verified",
         st["ledger_verified"])
    want("ledger scoped", r"\| Specification claims \| \*\*\d+ tracked: \d+ verified, (\d+) scoped",
         st["ledger_scoped"])
    want("ledger awaiting",
         r"\| Specification claims \| \*\*\d+ tracked: \d+ verified, \d+ scoped, (\d+) awaiting",
         st["ledger_awaiting"])
    return out


def cmd_check():
    data, flat = load()
    known = {t["path"].resolve() for t in flat}
    dead, checked = [], 0
    for f in site_html():
        html = f.read_text(encoding="utf-8")
        for href in re.findall(r'(?:href|src)="([^"]+)"', html):
            if href.startswith(("http", "mailto:", "#", "data:")) or "${" in href:
                continue  # "${" is a JS template literal inside a <script>, not a link
            bare = href.split("#")[0].split("?")[0]
            # A leading slash is resolved from the SITE root, not the file's own
            # directory. 404.html has to use that form: the server returns it for a
            # path that does not exist, and the browser's URL stays at that path, so
            # a relative stylesheet or link would resolve one or three directories
            # deep and fail.
            target = ((ROOT / bare.lstrip("/")) if bare.startswith("/")
                      else (f.parent / bare)).resolve()
            checked += 1
            if not target.exists():
                dead.append(f"{f.relative_to(ROOT)} → {href}")

    structural = (list(contract_problems()) + deployment_problems()
                  + readme_problems() + claim_problems() + ledger_drift()
                  + source_gaps() + review_problems()
                  + banned_phrase_problems() + metadata_problems() + discovery_problems()
                  + table_problems() + css_class_problems()
                  + asset_reference_problems()
                  + path_problems() + scenario_link_problems()
                  + guide_problems() + preset_problems()
                  + panel_manifest_problems() + evidence_problems()
                  + contract_prose_problems() + reference_library_problems())
    for t in flat:
        if not t["path"].exists():
            continue
        html = t["path"].read_text(encoding="utf-8")
        rel = t["path"].relative_to(ROOT)
        b = Balance()
        b.feed(html)
        b.close()
        for e in b.bad:
            structural.append(f"{rel}: {e}")
        if b.stack:
            structural.append(f"{rel}: never closed {[tag for tag, _ in b.stack]}")
        h1 = re.findall(r"<h1>(.*?)</h1>", html, re.S)
        if len(h1) != 1:
            structural.append(f"{rel}: {len(h1)} <h1> (expected 1)")
        elif h1[0].strip() != t["title"]:
            structural.append(f"{rel}: <h1> {h1[0].strip()!r} disagrees with topics.json {t['title']!r}")
        for viz in re.findall(r'<section class="instrument[^"]*" data-viz="(\w+)"', html):
            if viz not in MODEL_TYPES:
                structural.append(f"{rel}: panel \"{viz}\" has no entry in docs/model-types.json")
            elif f'model-tag--{MODEL_TYPES[viz]["kind"]}' not in html:
                structural.append(f"{rel}: panel \"{viz}\" badge disagrees with the catalogue — re-stamp")
            # M3-3 · Verify mode renders this island. Without it the mode says
            # "no stamped contract" instead of quietly falling back to the badge
            # text — but a page shipping in that state is still a page whose
            # Verify target is missing, so the gate catches it here.
            if viz in MODEL_TYPES and 'data-contract>' not in html:
                structural.append(f"{rel}: panel \"{viz}\" has no stamped contract island, "
                                  f"so Verify mode has nothing to show — run "
                                  f"`python3 scaffold.py contract`")
        # Exercises are rendered by viz-loader.js. A page that declares them
        # without loading it shows nothing at all, silently — the same class as
        # the unversioned-asset bug, and just as invisible.
        if "data-exercises" in html and "viz-loader" not in html:
            structural.append(f"{rel}: declares exercises but does not load viz-loader.js — "
                              f"they would render nothing")
        if "pager:start" not in html:
            structural.append(f"{rel}: no pager fence — run relink")
        # a page past "planned" must not still carry the generated placeholder text
        if t["status"] != "planned":
            if "This page is planned but not yet written" in html:
                structural.append(f"{rel}: status is \"{t['status']}\" but the answer is still the placeholder")
            if "<h2>Not written yet</h2>" in html:
                structural.append(f"{rel}: status is \"{t['status']}\" but the body is still the stub")
        # A [data-viz] with no module script mounts nothing and fails silently in
        # the browser. Cheap to check here, expensive to notice by eye.
        for name in re.findall(r'data-viz="([^"]+)"', html):
            if "viz-loader.js" not in html:
                structural.append(f"{rel}: data-viz=\"{name}\" but no viz-loader.js")
            mods = re.findall(r'js/viz/([a-z0-9-]+)\.js', html)
            if not mods:
                structural.append(f"{rel}: data-viz=\"{name}\" but no js/viz/*.js module")
            # only modules that actually use the kit need it on the page
            needs_kit = any((ROOT / "js" / "viz" / f"{mo}.js").exists()
                            and "NS.kit" in (ROOT / "js" / "viz" / f"{mo}.js").read_text(encoding="utf-8")
                            for mo in mods)
            if needs_kit and "viz-kit.js" not in html:
                structural.append(f"{rel}: its viz module uses viz-kit but the page does not load it")
            if not any(f'NS.viz.{name} ' in (ROOT / "js" / "viz" / f"{mo}.js").read_text(encoding="utf-8")
                       or f'NS.viz.{name}=' in (ROOT / "js" / "viz" / f"{mo}.js").read_text(encoding="utf-8")
                       for mo in mods if (ROOT / "js" / "viz" / f"{mo}.js").exists()):
                structural.append(f"{rel}: no loaded module defines NS.viz.{name}")
        if t.get("viz") and 'data-viz="' not in html:
            structural.append(f"{rel}: topics.json declares viz \"{t['viz']}\" but the page has no [data-viz]")

    # A responsive grid whose column minimum is a bare length cannot shrink below
    # it, so when the reader's font size grows and the viewport does not, the
    # column outgrows its container and the whole page scrolls sideways. At 150%
    # text the homepage map was 408 px of column in a 335 px grid, 53 px of
    # overflow, and 189 px at 200% -- against WCAG 1.4.4, which asks for 200%
    # without loss of content. min(100%, ...) is the fix and most of this
    # stylesheet already used it.
    #
    # Scanned across the stylesheets AND inline <style> blocks, because the rule
    # that caused this lived in one of those and no grep of css/ could see it.
    sources = [(f.relative_to(ROOT).as_posix(), f.read_text(encoding="utf-8"))
               for f in sorted((ROOT / "css").glob("*.css"))]
    for f in site_html():
        html_s = f.read_text(encoding="utf-8")
        for block in re.findall(r"<style>(.*?)</style>", html_s, re.S):
            sources.append((f.relative_to(ROOT).as_posix() + " <style>", block))
    for name, text in sources:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        for m in re.finditer(r"repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*([^,]+?)\s*,", text):
            floor = m.group(1).strip()
            if floor.startswith("min(") or floor in ("0", "0px", "auto", "min-content"):
                continue
            structural.append(
                f"{name}: a responsive grid floors its column at {floor} with no "
                f"min(100%, ...), so it overflows once the reader enlarges the text")

    # Every link that leaves the site should open beside the page rather than
    # replace it: these are source citations inside a lesson, and a reader who
    # follows one loses their place and their panel state. target="_blank"
    # without rel="noopener" hands the opened page a handle back to this one, so
    # the two travel together. Twenty-nine links were missing both on
    # 19 September 2026, against two hundred and forty that had them.
    for f in site_html():
        rel_name = f.relative_to(ROOT).as_posix()
        html_f = f.read_text(encoding="utf-8")
        for tag in re.findall(r'<a [^>]*href="https?://[^"]*"[^>]*>', html_f):
            href = re.search(r'href="([^"]*)"', tag).group(1)
            if 'target="_blank"' not in tag:
                structural.append(f"{rel_name}: external link opens in the same tab - {href}")
            elif "noopener" not in tag:
                structural.append(f"{rel_name}: target=_blank without rel=noopener - {href}")

    planned = [t for t in flat if t["status"] == "planned" and not t["path"].exists()]
    orphans = [p for p in sorted((ROOT / "topics").rglob("*.html")) if p.resolve() not in known]

    print(f"{checked} internal link(s) checked across {len(list(ROOT.rglob('*.html')))} page(s)")
    if dead:
        print(f"\n{len(dead)} DEAD LINK(S):")
        for d in dead:
            print("  ✗ " + d)
    else:
        print("  ✓ no dead links")
    if structural:
        print(f"\n{len(structural)} STRUCTURAL PROBLEM(S):")
        for m in structural:
            print("  ✗ " + m)
    else:
        print("  ✓ tags balanced, headings agree with topics.json, pagers present")
    # numeric claims — the prose has to agree with the arithmetic
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("checknum", ROOT / "check-numbers.py")
        cn = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cn)
        print()
        num_bad = cn.main()
    except FileNotFoundError:
        num_bad = 0
        print("\n  (check-numbers.py not found — skipping numeric claims)")

    if orphans:
        print(f"\n{len(orphans)} page(s) not listed in topics.json:")
        for o in orphans:
            print("  ? " + str(o.relative_to(ROOT)))
    if planned:
        print(f"\n{len(planned)} topic(s) still planned with no page:")
        for t in planned:
            print(f"  · {t['section_id']}/{t['slug']}")
    return 1 if (dead or structural or num_bad) else 0


if __name__ == "__main__":
    cmds = {"new": cmd_new, "relink": cmd_relink, "titles": cmd_titles,
            "identity": cmd_identity, "check": cmd_check,
            "bust": cmd_bust, "meta": cmd_meta, "theme": cmd_theme, "contract": cmd_contract,
            "claims": cmd_claims, "absolutes": cmd_absolutes,
            "stats": cmd_stats, "panels": cmd_panels,
            "experiments": stamp_reference_library}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    sys.exit(cmds[sys.argv[1]]() or 0)
