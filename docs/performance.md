# Performance — measured, then budgeted

> **Current Lab C update — 16 September 2026:** The Lab C transient now uses a causal, zero-state state-space calculation (result 1.3, contract 2.3), including when the board load is zero. The 12 September FFT rebuild timings and record-length tradeoff below document the former browser method; they are not current Lab C costs or a reason to extend the FFT record for slow VRM. The load-current *spectrum* still uses an FFT, and the frequency-domain impedance/branch panels remain frequency-domain calculations. See [the causal model](pdn-causal-model.md) and [its selected-corner evidence](pdn-causal-evidence.json).

| Current local browser action | Synchronous publication observation | Interpretation |
|---|---:|---|
| Slow-VRM edit | 66.2 ms | One desktop run; all selected-corner budgets pass, including this case. |
| Fast-edge edits | 241.4–243.5 ms | Noticeable synchronous work; not an animation-frame measurement. |
| Bandwidth edit with both fast edges | 249.2 ms | Same local browser; not a phone bound or controlled benchmark distribution. |

These are input-handler-to-publication observations from the local in-app browser, not paint/INP, sustained drag, real-network or physical-device results. Do not infer that every edit fits one frame. Keep the numerical grid intact; a concrete blocking interaction on a real device should be profiled before changing scheduling or resolution. The historical sweep guidance below is not an instruction to lower the current Lab C solver's resolution during drag.

Astra §11: *"Measure real mobile performance before setting budgets. Source size
is not performance."* So this file records the measurement first and derives the
budgets from it, rather than the other way round.

## Method

Measured in a Chromium browser at a **375 × 812** viewport (the mobile preset),
against the local dev server. `PerformanceNavigationTiming` and
`PerformanceResourceTiming` for load; a scripted slider sweep for interaction.

### What these figures are, and four things they are not

Astra's §11 is blunt about the gap between what this method measures and what the
conclusions claimed, and the corrections are worth stating before the numbers
rather than after:

- **A synchronous loop of 40 input events is not 40 frames.** It measures the
  handler work — model rebuild plus canvas draw — with the browser given no
  chance to paint in between. It is a good proxy for *whether* a change is
  affordable and it is **not** a frame rate, a drag rate, or INP. Anything below
  called a "sweep step" is handler cost, and the earlier version of this file
  drew an fps figure from it, which it should not have.
- **Network is ~0.** This is localhost, so it captures compute and not delivery.
  Cache headers in `_headers` help delivery and are not a measurement of it.
- **A font stylesheet is not the font payload.** The earlier version reported the
  stylesheet's size as though it settled the question; the faces themselves come
  from a third party over a network this method never touches.
- **The host is a developer machine** and the viewport is an emulated phone, not
  a phone. A resized desktop has a desktop's CPU, memory bandwidth and thermal
  headroom. The *ratios* between page types are the durable finding; the absolute
  numbers are optimistic by an unmeasured factor.

**What is therefore still unmeasured, and recorded as such:** frame timing and
long tasks during a real drag, input-to-visible-update latency, behaviour over a
realistic network, actual font and asset transfer, and anything at all on real
phone hardware. Those need a device and a throttled profile, and until somebody
runs them this file's conclusions stop at compute cost on one machine.

## Measured, 12 Sep 2026

| Page | DOM ready | Load | JS transferred | Sweep step |
|---|---|---|---|---|
| Prose only (`termination-schemes`) | 14 ms | 17 ms | 30 KB | — |
| Typical panel (`crosstalk`) | 40 ms | 40 ms | 125 KB | **1.0 ms** |
| Heaviest lab (`one-channel`, 7 canvases) | 206 ms | 425 ms | 140 KB | **26.2 ms** |

Fonts: 33 faces resolved, `document.fonts.status` = `loaded`, and the stylesheet
request is under 1 KB. Font loading is not a bottleneck on any page measured.

## What the numbers say

**The labs are the outlier, by 26×.** A typical panel redraws in about a
millisecond per control change; Lab B takes 26 ms because one change rebuilds
seven canvases, two of which run a 4096-point FFT. That 26 ms is **handler cost,
not a frame rate** — the earlier version of this file converted it to "38 fps",
which the method cannot support. What it does support is that a control change
on Lab B costs more than a 16.7 ms frame's budget, so a continuous drag there
cannot be keeping up.

**JS size is nearly flat across panel pages and says nothing useful.** Crosstalk
transfers 125 KB and sweeps at 1 ms; Lab B transfers 140 KB and sweeps at 26 ms.
A 12% difference in bytes against a 26× difference in latency is the clearest
possible demonstration of Astra's point.

**Prose pages are effectively free.** 14 ms to DOM ready with no panel to mount.

## Budgets

Set from the measurements above, at the same viewport and method.

| Budget | Limit | Rationale |
|---|---|---|
| Prose page, DOM ready | 50 ms | 3× the measured 14 ms |
| Panel page, DOM ready | 120 ms | 3× the measured 40 ms |
| Lab page, load | 700 ms | ~1.6× the measured 425 ms |
| **Sweep step, typical panel** | **8 ms** | 8× headroom, and still 120 fps |
| **Sweep step, lab** | **33 ms** | 30 fps — the floor for a drag to feel attached to the finger |
| Local JS per page | 200 KB | above measured, and a ceiling on scope creep rather than a target |

The two sweep budgets are the ones that matter. The rest are tripwires against
a regression, not goals.

## If a budget is breached

In order of what has actually helped:

1. **Redraw less, not faster.** Most control changes only invalidate one canvas.
2. **Cache the expensive transform.** In Lab B the FFT dominates, and it only
   needs redoing when the network changes — not when the sampling phase moves.
3. **Lower the resolution during a drag** and restore it on release. A sweep does
   not need a 4096-point grid.
4. Only then look at bytes.

## Measured, 12 Sep 2026 — second pass (M5-8, M5-9)

Re-measured after Milestones 1 to 5, in the same browser, warmed up, median of
five rather than a single run.

| | cost | note |
|---|---|---|
| Cursor move on Lab C (`\|Z\|` panel) | **0.31 ms** | reads recorded trace points and moves DOM; no model rebuild |
| Control change on Lab C | **18.2 ms** | full rebuild: ladder sweep, 32768-point transient, six canvases |
| Ratio | **58×** | |

**M5-9 asked for the FFT not to rebuild when only a cursor moves, and it did
not in this 12 September measurement.** The measurement is the evidence rather than a reading of the code: 0.31 ms
against 18.2 ms. The probe reads points that `K.plot` recorded during the last
draw, and the zoom band moves a `<div>`. Nothing on either path calls the model.

**Lab C got slower at that milestone on purpose.** M2-4 doubled the former periodic transient record from 16384 to
32768 because 16384 left 3.2% of the reported droop as record contamination. The
model cost went 5.4 ms → 9.5 ms and the whole panel redraw is 18.2 ms. 65536
would have brought the contamination to 0.32% at 18.3 ms for the model alone,
which is over a frame on its own — so the record length is set by the accuracy
the panel needs, bounded by the frame it has to fit in, and both halves of that
are written into the model contract.

### Phone-width layout, measured at 375 × 812

| | before | after |
|---|---|---|
| Lab C controls, share of viewport height | **774 px, 95%** | 341 px, 42%, collapsible to 0 |
| `travelling-waves` document width at a 375 px viewport | **531 px** | 375 px |
| `reflections` document width | **524 px** | 375 px, table scrolls in a 301 px wrapper |
| Panel tab labels | truncated mid-word at 28 chars | word-boundary, full text as the accessible name |

The two overflows had two different causes, and the first hid the second: a
non-wrapping `.transport` flex row was about 520 px wide, and once the layout
viewport expanded to fit it, every later measurement read against the wider
viewport. Fixing the row revealed a `<table>` whose `.table-scroll` wrapper had
`overflow-x: auto` but no `min-width: 0`, so inside a grid track the wrapper
sized to its content instead of scrolling.

## Re-measuring

```
python3 serve.py
```

Then at a 375 px viewport, on the page under test:

```js
const nav = performance.getEntriesByType('navigation')[0];
const s = document.querySelector('.ctl input[type="range"]');
const t0 = performance.now();
for (let i = 0; i < 40; i++) { s.value = +s.min + (i % 20); s.dispatchEvent(new Event('input', {bubbles:true})); }
console.log({ domReady: Math.round(nav.domContentLoadedEventEnd),
              msPerSweepStep: (performance.now() - t0) / 40 });
```

## 18 September 2026 — Lab D and the desktop workspace

Measured in Node on this machine, so these are cost figures rather than a claim about any reader's
device. One ADC run is **synchronous and cannot be cancelled part way**; a dragged control coalesces
to one run rather than queueing, and the queued run is now held and cancelled on destroy.

| Run | Median | Record |
| --- | --- | --- |
| SAR, 16 bit | 14.4 ms | 65,536 samples |
| Delta-sigma, OSR 32 | 38.0 ms | 16,384 outputs, 524,288 modulator samples |
| Delta-sigma, OSR 128 | 88.7 ms | 8,192 outputs, 1,048,576 modulator samples |
| Delta-sigma, OSR 256 | 85.7 ms | 4,096 outputs, 1,048,576 modulator samples |

The worst case blocks the main thread for about five frames at 60 Hz. That is why the record length
falls as the oversampling ratio rises — the policy holds the cost near a million modulator samples
whatever the ratio — and why a slider drag coalesces. No worker was added: the profile above is the
honest description, and a worker would change the numerical configuration for a responsiveness
problem that has not been measured on a real device.

The workspace's plot fitting is layout work only. It runs two passes, the second 60 ms after the
first, coalesced at 140 ms on resize, and it observes the stage rather than the canvases so a height
it has just changed cannot ask for another fit. Frame heights measured in the browser pane: every
lab page fits its frame inside the window at 1470×846, 1536×730, 1280×720 and 1920×970 with no rail
overflow, and below the breakpoint every height override is released so the modules draw at their
own sizes.

Still not measured, and not claimed: frame timing on a physical phone, and ADC run cost on anything
but this machine.
