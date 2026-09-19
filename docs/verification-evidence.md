# Verification evidence for N8

This records permanent checks that can be rerun from the repository. It separates semantic
consistency from numerical truth: a browser export can prove that the saved numbers are the same
numbers the model produced, but only an analytical limit or an independent solver can establish
that those numbers describe the intended physics.

For the **current browser Lab C transient**, use the causal update at the end of this file and
`docs/pdn-causal-evidence.json`. The earlier periodic PDN sections remain dated evidence of the
superseded browser path and the retained test-only helpers.

## Current mapping

| Item | Permanent evidence and layer | What remains pending |
|---|---|---|
| **N8-2 parameter domain** | `check-models.js`, **Model domain — causality, admissibility, and what "ok" may mean**, checks the Lab B admissibility boundary on both sides, non-finite result rejection, explicit reasons, a combined 200-case reach/loss/rate/EQ matrix, and sweep cells across the boundary. `tests/check-domain.js` adds a small **public-model integration** matrix over combined allowed UI corners for Lab A, Lab C and CDR; an accepted result must have finite measurements and traces, while a refusal must name why and expose no measurements. Touchstone malformed/overflow cases live in **Touchstone — refuses what it cannot trust**. | Malformed percent encoding now has permanent parser rejection assertions and a browser-checked explanation. Broader out-of-range scenario semantics and malformed imports remain browser-input work. The compact matrix does not prove physical accuracy or exhaust every Cartesian product. |
| **N8-3 independent numerical comparisons** | `check-models.js` contains analytical limits and independent algorithms: matched/lossless channel limits in **Lab B assembled** and **Causal line**; complex KCL and energy conservation in **Lab C assembled** and **Lab A assembled**; power iteration against the closed-form singular value in **Passivity**; the CDR hand-solved bandwidth relation in **CDR loop**. `tests/check-pdn-multi.js` compares the current causal Lab C browser path with the independently written trapezoidal time-domain solver in `tests/pdn-reference.js` at six selected two-load corners and both nodes. Older FFT comparisons remain regression evidence for the retained periodic helpers. | These benchmarks validate selected laws, limits and scenarios, not every plotted quantity or the full allowed parameter space. Lab B still lacks measurement or field-solver correlation. |
| **N8-4 displayed-measurement convergence** | `check-models.js`, **Lab B assembled**, compares every released preset eye against a four-times-longer record. The current causal Lab C test separately checks timestep refinement and fixed-timestep record extension at six selected production-grid corners; the earlier `Lab C assembled` record-length check remains relevant to the legacy periodic helper. **Lab A quadrature** calls the public production model, demonstrates second-order spatial convergence, refuses the old coarse grid, and sweeps all allowed length/edge combinations at the shipped grid. `tests/state-transitions.html` adds browser integration from controls through the published result and reload. | Lab C does not certify timestep convergence on each browser edit, and a finite observation interval can omit a later peak. There is no browser assertion for every rounded visible label against its published measurement. CDR has no explicit resolution-refinement suite because its direct frequency evaluation is not an iterative solver. |
| **N8-5 visual bounds** | `check-models.js`, **CDR loop**, permanently proves that allowed low damping exceeds the former fixed plot limits for transfer, residual and tolerance. This catches restoring those obsolete constants only if the plotting rule is coupled to the asserted measurements. | `tests/check-plot-layout.js` checks non-overlapping horizontal labels at five widths using synthetic font metrics. The CDR phase plot is coupled to tested bounds derived from all three traces, and the 390 px phase view was inspected. General plot-extrema containment, legend/margin/unit layout, report composition and 200% zoom still need broader visual/browser or human evidence. A numerical maximum is not proof that pixels fit inside an axis. N8-5 is therefore partial. |
| **N8-7 distinct layers** | **Structure/unit:** `scaffold.py check`, `check-numbers.py`, and focused helpers in `check-models.js`. **Mutation sensitivity:** `mutate.js`, including named negative cases and a no-op control. **Browser integration:** `tests/preset-sweep.html` and `tests/state-transitions.html`; the latter has `?fault=export` to demonstrate semantic-export failure. **Numerical benchmark:** independent limits/algorithms in `check-models.js` plus `tests/pdn-reference.js`. **Human technical review:** Geetansh's dated 59-topic page review is recorded in `topics.json`. Claim-specific ledger/standards and new feature validation remain separate. The requested regressions are placed by claim: non-finite validity in **Model domain**, asymmetric passivity in **Passivity**, and numerical quality/convergence checks in the relevant assembled-lab suites. | Mutation results should be recorded from the current run rather than copied from an old count. Screen-reader, physical-device, production, learner-task and licensed-specification review remain human checkpoints. N8-7 documents the separation; it does not turn a missing layer into a pass. |

## Commands

```sh
node tests/check-domain.js
node check-models.js
node mutate.js
python3 serve.py
```

With the server running, open `tests/preset-sweep.html` and `tests/state-transitions.html`. The
transition suite completes with `window.__DONE === true` and passes only when
`#sum[data-state="passed"]` exists. Open `tests/state-transitions.html?fault=export` to verify that
semantic corruption is rejected.

These checks do not establish accessibility, physical-device behavior, production deployment,
learner success, licensed-specification compliance, measurement correlation or review of new
features beyond Geetansh's dated page-review scope. N8-2, N8-3 and N8-4 have substantial permanent
evidence; N8-5 remains partial, and N8-7 is an evidence taxonomy with human layers still pending.

## Takeover run

The current executed results are recorded below.
`./check` now includes domain, plot-label layout, reference-helper and script-load-order
checks alongside the existing model gate. The search-before-kit regression is retained
in `tests/check-load-order.js`; the preset sweep also refuses an unmounted panel.

## Historical periodic two-load PDN evidence — 16 September 2026

`tests/check-pdn-multi.js` is now part of `./check`. Its reproducible inputs are
`tests/fixtures/pdn/two-load-corners.json`; the dated numerical record is
`docs/pdn-two-load-evidence.json`. Six selected combined corners cover overlapping
loads, separated board-first pulses, a 200 ps die edge, sparse low-ESR banks,
dense damped banks with 40 A loads, and a slow VRM. This is not an exhaustive
parameter-domain validation.

The independent causal companion solver uses physical-time pulse construction,
with reference timesteps of one quarter and one eighth of the production step.
Reference refinement differs by less than 0.131% of reference peak excursion in
these cases. Production refinement is tested separately: half timestep at fixed
record duration, and double record duration at fixed timestep. Pulses retain
physical onset and fall times; waveform comparisons use the same physical
observation interval. Baseline-corrected production traces are compared with the
causal reference, while raw trace changes are also recorded. Network topology is
supplied by the production model: this checks the numerical solution of that
network, not independent validation of every topology parameter.

With half timestep **and** twice record duration, five corners meet the predefined
5% waveform / 2% droop budgets at both board and die. These refined runs are test
configurations, not a new browser accuracy mode. The default grid does not meet
those budgets everywhere: separated-pulse board droop differs by 2.72%; the dense
bank case differs by 5.08% at the die and 6.57% at the board. Both can have a quiet
pre-event baseline. The sparse-bank board peak changes by 2.153 mV on timestep
refinement, outside the existing 2 mV comparison budget. These failures are
recorded, not redefined as passes. Fast-edge pointwise changes and peak changes
are distinct quantities.

The slow-VRM case is deliberately diagnostic: even the longer/finer test remains
outside the waveform budget (about 10.2% die / 15.1% board), and the default run
flags baseline drift. The tests require that warning and unresolved accuracy
classification. Low pre-event drift alone is **not a convergence certificate**.
A6 remains partial; the next technical task is an affordable finite-record/error
qualification strategy, not blanket acceptance of the current grid or silently
increasing all interactive workloads.

A separate analytical three-node RL fixture, `tests/fixtures/pdn/shared-rl-tone.json`,
checks shared-path DC and entire bin-aligned sinusoidal waveforms directly from
KCL/KVL and v=L di/dt. It uses a helper topology, not an exact Lab C scenario.
Four process-local faults must fail that comparison: reversed withdrawal sign,
swapped load nodes, omitted second load and discarded transfer reactance. All
functions are restored and the correct calculation reruns afterward. Node-specific
cancellation and malformed timestep/current/node refusals are also checked.
These four faults are separate from the existing `mutate.js` inventory.

No production solver, supported range, public contract or model version changed
in this batch. No new browser, learner, device or human-review pass is claimed.

## Historical periodic PDN presentation and browser interaction — 16 September 2026

The Lab C result now names `stats.settled` as **“Baseline drift within budget”** and
the refused case as **“Excessive pre-event drift; measurements withheld.”** The
approved finite/repeating-window explanation is beside the two-load transient
readout and in the model contract's limitations, which accompany the values CSV,
trace CSV and composed image. The old 3.3 µs/305 kHz tooltip was corrected to the
nominal 6.6 µs/152 kHz record. These are presentation changes; the model status
`not-settled`, 2% threshold, solver, samples, event hooks and exports' native
numeric values remain unchanged. The wording is intentionally not an accuracy
badge. `shared-rl-tone.json` remains a downloadable helper fixture and is not
represented as a Lab C saved scenario or a fifteenth teaching card.

Browser: Codex in-app Chromium on local `python3 serve.py 8765`, desktop viewport
1280 px at DPR 2, with an explicit 390×844 px responsive override. The four-lab
`tests/state-transitions.html` journey passed **4/4** after the wording change:
preset, physical control edit, view switch, summary and native trace exports,
scenario reload and published-result identity. In Lab C with the board load set to
3 A, all **six** die/board observation × combined/load-1/load-2 comparisons showed
the selected node/mode's own drift and status. At 10 kHz VRM bandwidth the main
result withheld its droop for 3.4% pre-event drift; four comparison states withheld
measurements, while two board states remained within their own drift budget.
That is evidence of node-specific labelling, not convergence of those two peaks.

Keyboard inspection exercised a numeric entry with Enter, the Lab C transfer
plot's right arrow (native sample moved to 1.051311 MHz), a disclosure with Enter,
and Lab A/B/C/CDR preset/edit/view flows through the transition harness. A native
comparison `<select>` was focusable, but ArrowDown/End/Space automation did not
change its option in this in-app browser; programmatic native `selectOption`
changed it and the six readouts correctly. Physical keyboard and screen-reader
operation of the select remain an explicit manual check, not a diagnosed site
failure. At 390 px all four pages had document width equal to viewport width;
theme changes light/dark and page navigation retained working controls/readouts.
At 640 px the CDR document also had no horizontal overflow. This narrower
viewport is only a layout proxy; **actual 200% browser zoom was not exercised**.
The active environment reported `prefers-reduced-motion: reduce` false. The
reduced-motion branches in `css/base.css`, `css/components.css`, `js/viz-kit.js`
and Lab A's renderer remain source-inspected but were not emulated in this browser.

A malformed `#lab=` Lab C link displayed “This experiment link could not be
read” and left the default settings and computed result in place. Lab B's file
inspector refused a local Touchstone 2.0 fixture with the explicit 1.0-only reason.
Search found Return-Current Paths for `return current`, PDN lessons for `PDN`,
gave a no-match explanation for `zzq-no-topic-927`, and keyboard selection of
`PDN Impedance` navigated back to Lab C. The values drawer exposed caption,
model/status/units and table/trace/image actions. Semantic table/trace export
and scenario reload passed the harness. The in-app browser did not expose a
completed blob-image download event or a print-preview/200%-zoom control during
this run; **downloaded PNG appearance, printed page boundaries, true 200% zoom,
and reduced-motion rendering remain unverified**. Do not infer a visual pass
from source code or a button click.

Representative local action-to-visible observations (one browser run, not a
benchmark distribution): board-load normal edits 179–246 ms; setting each die
and board edge to 200 ps took 663 and 621 ms; setting slow VRM bandwidth to
10 kHz took 587 ms. Lab A four physical edits took 18.2 ms through the input
action; its final default-length history was ready at 43.3 ms. The former
figures include browser automation transport, handler work and rendering; the
Lab A history number distinguishes the eventual published result from its
immediate edit action. These values do not establish physical-phone frame rate
or responsiveness for all corners. No samples or records were shortened.

Geetansh's existing dated review covers the 59 published topics; this browser
run and A6 changes do not extend that review to new numerical behavior. Observed
learners, physical phone and screen reader, licensed specification review, and
live Cloudflare hosting remain external release checkpoints.

Integrated `./check` passed on 16 September with all 31 active mutations
detected; log: `/tmp/sol-pdn-release-check-16sept.log`. `git diff --check` passed.
The command wrapper's read-only `status` assignment failed only after the gate
finished; the log ends “All gates passed.”

## Causal PDN update — 16 September 2026 (supersedes the earlier periodic-browser limitation)

Lab C result 1.3 / contract 2.3 now uses `K.pdnCausalTransient` for the browser two-load path, including zero board current. It advances a zero-state ladder with a matrix exponential and sampled-current interpolation. The independent reference remains the trapezoidal companion-network solver. Derivation and scope: `docs/pdn-causal-model.md`.

All six selected production-grid corners now meet the unchanged 5% waveform / 2% droop budgets at both observations. Worst observed differences were about 0.466%; record extension changed earlier samples by zero. The slow-VRM case is included and no longer contains a periodic tail. This does not establish accuracy for every possible control combination or every later time. The historical periodic metrics remain in `pdn-two-load-evidence.json`; current metrics are in `pdn-causal-evidence.json`.

The new path additionally passes an independently derived causal quadratic-current trajectory and two-load shared-path DC values. Four causal-path faults are detected (withdrawal sign, input derivative, node mapping, omitted second load), alongside the four retained periodic-helper faults. Invalid network/grid options are refused rather than silently falling back to another grid. The browser does not perform per-edit convergence certification; that diagnostic remains null.

Integrated `./check` passed (`/tmp/astra-causal-full-check.log`), including all 31 existing mutation cases. After a final invalid-grid guard, the focused PDN gate and structural check were rerun. Browser state journeys passed 4/4 with fast-edge/slow-VRM edits, method/version checks, zero pre-event response and scenario/export restoration. Reference browser replay passed 10/10. The direct page showed the causal method and interval-qualified peaks without recorded browser warnings/errors. The journey harness uses its existing narrow iframe. A separate viewport override did not produce a confirmed 390 px top-level viewport in this run, so no new top-level phone-width result is claimed.

Local browser input-handler-to-publication samples: slow-VRM edit 66.2 ms; fast-edge edits 243.5 and 241.4 ms; bandwidth edit with both fast edges 249.2 ms. These are spot observations from the local in-app browser, not frame timing, a controlled before/after benchmark or physical-device evidence. Fast-edge synchronous work can still be noticeable; no generic worker/scheduler was added without a separate interaction design.

## Sol causal presentation follow-up — 16 September 2026

The Lab C explanation now uses the approved causal wording: zero-state forward
evolution, record extension exposing later behavior without altering earlier
samples, finite timestep and observation interval, and no convergence claim from
a quiet baseline. No physical input, model hook, numerical grid, trace ID, status,
budget or solver code changed. The retained load-current FFT and frequency-domain
impedance panels are not confused with the causal rail-voltage calculation.

The values drawer and copied summary/trace CSVs now identify
`causal-state-space-foh-v1` from the published result's stimulus, alongside result
1.3 and contract 2.3. The summary CSV had two contradictory `# model version`
headers (the first was actually the contract version); its keys are now distinct.
The report-image composition includes the same method and the contract's wrapped
assumptions/limitations. The four-lab transition harness now checks method
provenance where present and the summary version-header uniqueness. These
changes are report presentation, not numerical export rounding or re-computation.

Local in-app Chromium at `http://localhost:8765`, with a confirmed 390×844 px
viewport override: default Lab C and board-load 3 A, both observation nodes and
combined/load-1/load-2 modes, slow VRM at 10 kHz, and 200 ps die/board edges all
kept the causal method, selected node/mode, mV units, and the stated
786.4–4061.4 ns peak interval visible. The combined modes share voltage bounds
by one calculation across all nodes/modes in `drawMulti`; no per-view rescale was
introduced. The compact values strip occupied its available 316 px without
overflow. Opening the values drawer exposed a new 390 px bug: long full-precision
cells expanded the document to 792 px. Fixed table layout and word wrapping in
`css/components.css`; after reload and a slow-VRM edit, document width stayed
390 px and the table width 316 px. The full-precision CSV remains unchanged.

The copied summary and trace CSVs contained the causal method; the summary
included distinct model/contract versions and the current finite-observation
limitations. A browser image-download click did not yield an accessible completed
download artifact in this environment, so its **visual appearance is not yet
verified**. Actual 200% zoom was attempted with browser keyboard shortcuts but
the in-app viewport, DPR and root font size did not change; a 390 px viewport is
not a substitute. Native Chrome access was attempted twice and remained blocked
pending the computer-use Accessibility and Screen Recording permissions. Actual
200% Chrome zoom, system reduced-motion, real-keyboard native select, print-page
boundaries and downloaded PNG appearance therefore remain unverified. The
390 px override was reset after the test. Physical-phone and screen-reader
sessions still require real participants/devices.

These observations do not extend Geetansh's dated 59-topic technical review to
the new solver, certify universal convergence, or approve a deployment. The
remaining launch queue is tracked separately.

Final integrated verification on 17 September: regenerated cache references
and README statistics; full `./check` passed with all 31 active mutations
detected (`/tmp/sol-causal-pdn-check-17sept.log`); `git diff --check` passed. A
fresh `tests/state-transitions.html` browser run passed 4/4. Lab A exported 22
values/21 sampled trace checks, Lab B 24/24, Lab C 33/57 and CDR 21/18; every
scenario reload reproduced identical computed state with no recorded errors.
The first in-app browser attempt crashed and is excluded rather than reported
as a product failure or a pass.

## 18 September 2026 — Opus launch integration

All browser observations below were made in the desktop app's own browser pane against
`python3 serve.py` on this machine. They are local browser evidence. They are **not** physical
device, screen reader, native zoom or print evidence, and none of those was performed.

### Gates

Full `./check` passes: structure, 114 arithmetic claims across 34 pages, 834 model assertions,
44 of 44 mutations caught by the assertion that names each one, the ADC scenario regressions, the
numeric-entry gate, the lab parity gate, and the experimental-isolation assertion.

New gates added in this work, with their demonstrated sensitivity:

| Gate | Holds | Shown to fail when |
| --- | --- | --- |
| `tests/check-lab-parity.js` | 933 identities across five lab pages, each surviving exactly once | a control is removed, a control is cloned, or a default is changed |
| `tests/check-numeric-entry.js` | 18 display and commit assertions on the real kit code | the initial display reverts to raw multiplication, or one fixed decimal count is used for every control |
| `check-models.js` — Lab B eye scale | 5 assertions on the scale ladder | the ladder stops growing at its top rung |
| `check-models.js` — eight ADC suites | 47 assertions | ten planted faults, each routed to its own assertion |
| `tests/check-adc-integration.js` | 56 scenario values quoted in prose | a scenario note is left quoting an old SNR |
| `tests/check-plot-layout.js` | Lab B and Lab D publish byte-identical measurements with and without a height override | — a property assertion, no mutation planted |
| `tests/check-load-order.js` | nothing the site serves references `tests/experimental-labs` | the ADC contract island named a file in that folder, which is how the assertion earned its place |

### Browser suites

- `tests/state-transitions.html`: **4 of 4**. Preset → control edit → view switch → summary and
  trace export → scenario reload, with computed state identical, on all four flagship panels after
  the workspace migration.
- `tests/preset-sweep.html`: **210 of 210** rows, no errors; 36 of them on the migrated pages.
- `tests/reference-experiments.html`: **10 of 10** replays, each with its download, restored
  controls and analytical checks.

### Layout, measured

Every lab page fits its frame inside the window at 1470×846, 1536×730, 1280×720 and 1920×970, with
no rail overflow, no plot under 110 px and no plot narrower than 200 px. At 390 px each frame falls
back to page flow, releases every canvas height override, and shows **0 px** of horizontal overflow
— it was 72 px on the clock-recovery page and 32 px on Lab A before the instrument bar was reset
below the breakpoint. No console errors on any page. The typed "read at" box measures 0 px folded and
23 px when focused, accepts a typed frequency and folds again on blur, so the only non-pointer route
to an exact value is in the tab order.

### Lab D journey

Both architectures run. All four combinations of coupling path and coupling type run, with SNR
losses of 11.91, 29.24, 7.63 and 21.05 dB. A shared converter clock reports 168 masked components
against an independent oscillator's none. The rise/fall cap holds requested and applied apart
correctly: 21.3 ns requested stays recorded while the applied value falls to 0.246 ns as the
aggressor frequency rises. Two control changes back to back publish the later one. Four view tabs,
four plotted canvases, none double-probed. Expand moves a plot into the focus grid and returns it to
its own parent. A scenario link round-trips exactly: SNR 67.948 dB before and after a reload from the
hash, with architecture, path, coupling and applied edge identical.

### Explicitly not done

Actual 200 % browser zoom, the operating system's reduced-motion setting, native select operated by
a real keyboard, the appearance of a downloaded PNG, print page boundaries, any physical phone, any
screen reader, any observed learner task, and every live-host check. The browser pane cannot set page
zoom or an OS motion preference; an emulated viewport is neither of those things, and recording it as
one would be the specific error this file exists to prevent.

**Superseded in part on 19 September 2026.** The live-host checks, 200 % zoom, print output and a
physical phone were performed; see the last section of this file. A screen reader, observed learner
tasks, reduced motion, native keyboard select and downloaded-PNG appearance remain not done. This
paragraph is kept because it records what was true when the work above it was written.

### Review record, 18 September 2026

Geetansh reviewed the whole catalogue at about eight pages a day from 12 to 18 September 2026, in
catalogue order, reading the labs last. That is now recorded **per page** in `topics.json` rather
than as one frozen list, so a byline states the date its own page was read. The site-level entry
records the reviewer and the date the pass finished, and the scope note says what the pass covered.

Lab D's review covered its lesson text and its model: the discrete-time second-order loop ordering
and the transfer function it produces, the SAR bit-trial timing, and the masking and
noise-replacement conventions. It is accepted, `noindex` is removed and the page is listed on two
curated routes. `docs/model-types.json` records `reviewed: 2026-09-18, reviewer: Geetansh` for
`adcLab`; that is the first human sign-off this model has had, and it is recorded because it
happened, not derived from the assertion count.

Re-running every gate against the reviewed text found nothing: all 114 arithmetic claims still match
their prose, so no edit moved a number away from its anchor; tags balance; 44 of 44 mutations are
still caught. The only stale artefact was the README word count.

This changes nothing about the device and human work. Actual 200 % browser zoom, the reduced-motion
setting, native select by real keyboard, downloaded PNG appearance, print boundaries, a physical
phone, a screen reader, observed learner tasks and every live-host check remain unperformed and
unrecorded as passed.

## Live host and device session, 19 September 2026

The site went live on `https://sipi.work` (Cloudflare Workers static assets, release
`5dc34b8`). Three of the checks listed above as never performed have now been performed,
and two production defects were found that no local gate could see.

### Live-host checks, machine-verified

All 66 sitemap URLs return `200` with zero redirects, measured against `sipi.work` itself.
Every excluded path is refused: `.git/config`, `.git/HEAD`, `.git/objects`,
`wrangler.jsonc`, `.assetsignore`, `_redirects`, `_headers`, `.gitignore`, `scaffold.py`,
`check`, `mutate.js`, `tests/check-load-order.js`, `tests/panels.json`. Everything the
pages link to but that is not a page is served: the reference-JSON downloads under
`tests/fixtures/`, `docs/claims.md`, `llms.txt`, `robots.txt`, `sitemap.xml`. The cache
policy in `_headers` reached the edge unchanged, immutable on `css/`, `js/` and `assets/`,
revalidating on HTML and JSON. TLS issued 19 September 2026 by Google Trust Services.

A 404 at `/topics/interfaces/typo-that-does-not-exist` renders fully styled, and the
network log shows why: `css/base.css`, `css/components.css` and `js/site.js` each return
`200` from the root rather than from the missing directory. That is the first observation
of the root-absolute `404.html` fix under the condition it was written for, since the
defect exists at every path except the page's own.

Lab D on the live host: five canvases, 78 controls, model registered, no console errors,
no failed requests, device-pixel-ratio honoured. Driving the architecture control from SAR
to delta-sigma republished the measurements — SNR 85.2 to 79.3 dB, ENOB 14.02 to 14.18
bits — and the modulator panel went from its "a SAR has no modulator" message to a drawn
spectrum. The model runs in production, not only in the gate.

### Human session, reported by Geetansh

Performed on the live site after launch, on his own devices:

| Check | Result |
|---|---|
| Physical phone | Works. **Lab dashboards are large and awkward to use at phone size.** Deferred, not fixed. |
| Actual 200 % browser zoom | Works, and reads well. |
| Print output | Acceptable, **not good**. Deferred, not optimised. |

These are Geetansh's observations on real devices, which is what makes them admissible
here; they are not screenshots from an emulated viewport. Two of the three carry a
qualification, recorded as given rather than rounded up to a pass. The phone result is
"the site works, the labs are hard to operate", which is not the same as a phone pass for
the labs.

### Still not done

A screen reader, and any observed learner task. Also still open: the operating system's
reduced-motion setting, native select operated by a real keyboard, and the appearance of a
downloaded PNG. Nothing in this section should be read as covering those.
