# Architecture

Astra §11: *separate pure model functions from DOM state and rendering; one
canonical unit system internally; name quantities explicitly.* This file records
where the site stands against that — including the one place it does not comply,
and why.

## Layers

```
docs/model-types.json      the contract: what each model assumes and how well
                           it has been checked. Single source of truth.
        │
        ├─ scaffold.py contract  →  model-contract.html   (published)
        └─ scaffold.py contract  →  data-evidence / data-model-version on badges
                                     (so an export can carry provenance)

js/viz-kit.js
  ├─ MODEL LAYER    pure functions. No DOM, no state, no rendering.
  │                 line1D, cascadeS, pdnLadder, ctle*, fft, channelImpulse,
  │                 tdrProfile, berFloor, applyDFE, pulseResponse
  │
  ├─ DRAWING LAYER  canvas, plot, line, text, dot, fmt
  └─ UI LAYER       mount, probe, numericEntry, summary, scenario read/apply

js/viz/<name>.js    one module per panel. Owns its own state and its own DOM.
js/viz-loader.js    everything cross-cutting: probes, scenario links, values,
                    exports, tabs, modes. See "the kit is opt-in" below.
```

**The model layer's purity is checked, not asserted.** `check-models.js` loads
`viz-kit.js` in Node with no DOM at all and runs 241 assertions against it. If a
model function reached for `document`, the gate would fail immediately.

### The kit is opt-in; the loader is universal

Four panel modules predate the kit and never call `K.mount`. So anything that
must reach *every* panel — the probe cursor, scenario links, the values table,
exports, mobile tabs, Guided/Explore/Verify — lives in `viz-loader.js` and works
by reading the DOM rather than by asking the module.

That is why modules written before any of those features existed picked them all
up unchanged.

## Units

**There is not one canonical system, and this is the honest statement of it.**

| Function group | Time | Frequency | Other |
|---|---|---|---|
| `line1D`, `line1DAt`, `line1DEnergy` | **picoseconds** | — | V, A, Ω, pJ |
| `sectionABCD`, `cascadeS`, `groupDelay` | **seconds** | hertz | Ω |
| `pdnLadder`, `pdnTransient` | **seconds** | hertz | H, F, Ω, A, V |
| `ctleResponse`, `ctleZeroFor` | — | **normalised to Nyquist** | dB |
| `channelImpulse`, `pulseResponse`, `applyDFE` | **samples / UI** | — | V |
| `berFloor` | — | — | a count, and a probability |

`line1D` is in picoseconds because it grew out of a panel that displays
picoseconds. Converting it would touch two modules for no behavioural gain, and
a half-done conversion is worse than a documented inconsistency.

So instead the convention is **pinned by the gate**. `check-models.js` has a
`Units` suite that asserts each group behaves in the units this table claims — a
wave launched into a `td: 500` line arrives at t = 500; an open stub of
`td: 25e-12` nulls at 10 GHz; a 1 nH shunt reads 62.8 Ω at 10 GHz. Change a
unit and a test fails rather than a page quietly showing a wrong number.

### Why this matters more than it sounds

The site has had exactly one units bug, and it was expensive.
`K.ctleZeroFor` takes poles **normalised to Nyquist**; Lab B handed it hertz.
The bisection could not bracket 12 GHz, converged on its own lower bound, and
returned a zero at DC whose peak gain was about 10¹⁰ — which propagated through
the equaliser into a **10 GV eye height** before anything looked obviously
wrong.

Two things came out of that. The function now refuses out-of-range poles rather
than answering (see *empty results* below), and the units are asserted.

## Naming

Quantities carry their units in the name where the unit is not obvious from
context:

- `trUI`, `tdUI`, `echoUI` — times in unit intervals
- `lossDb`, `boostDb`, `rlDb` — quantities in decibels
- `trSamples` — a time expressed in grid samples
- `rjRms`, `djPp` — a standard deviation and a peak-to-peak, which are
  different quantities and must never be added

Where a bare name survives (`td`, `tr`, `f`), the units table above governs and
the gate enforces it.

## Empty results

**No model function returns a value inside the range of real answers to mean
"nothing".** A search that can fail returns `null`, or `NaN`, or an object with
a flag.

This is rule G-5, and it exists because the same bug appeared three times: the
search scoring, the bathtub interval, and the anti-resonance peak finder all
returned a number when the honest answer was "there isn't one", and the caller
could not tell zero from none. In the bathtub's case a fully closed eye
reported as wide open.

`check-models.js` has an `Empty results` suite that generalises it rather than
guarding the three cases individually.

## The three gates

| Gate | Catches | Cannot catch |
|---|---|---|
| `scaffold.py check` | dead links, tag balance, headings vs `topics.json`, unwired panels, missing or stale model contracts, unversioned assets that would be cached immutably | anything at runtime |
| `check-numbers.py` | a number in the prose that disagrees with its own formula | a number nobody wrote down |
| `check-models.js` | physics, units, empty results, state drift | anything needing a DOM |

Run all three with `./check`.

**Model assertions must be independent of the code they test.** Re-running the
same formula in a second file catches a typo and proves nothing. What counts:
analytical limits, conservation laws, closed-form special cases, monotonicity,
dimensional checks, and cross-checks between two separate implementations —
`pdnLadder` and `cascadeS` are asked to agree on the same circuit to 1e-6 Ω.
