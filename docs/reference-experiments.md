# Analytical reference experiments

15 September 2026, with a second tranche integrated 16 September. Manifest version 1.0, schema version 1. The references use public model entry points and numerical helpers; they do not add a second simulation engine.

The first manifest is [reference-experiments.json](reference-experiments.json). Each `input` is a downloadable, self-contained JSON fixture containing exact parameters and units, model/contract versions, topology, observation planes, stimulus, independently derived expected values and absolute tolerances, teaching material and limits. The second manifest is [reference-experiments-next.json](reference-experiments-next.json); its four helper cases use a smaller schema and do not claim an exact lab scenario. Its two CDR cases pin the model and contract versions. Fixture URLs and available scenario URLs are site-root-relative so they work on localhost and sipi.work. Version changes intentionally fail the checker until the reference is reviewed.

| Reference | What it demonstrates |
|---|---|
| `matched-line` | Matched load has no reflected voltage; launch amplitude still includes the source divider. |
| `open-line` | Voltage adds while current cancels at the open boundary. |
| `shorted-line` | Voltage cancels while current adds at the short boundary. |
| `source-terminated-line` | Source matching suppresses the later return to the load. |
| `resistive-step` | A resistive mismatch has partial reflection, rather than only open/short behavior. |
| `matched-channel-delay` | Unity transmission magnitude can coexist with nonzero physical delay. |
| `pdn-shared-dc` | Two loads share upstream resistance but see different driving-point impedance. |
| `cdr-natural-frequency` | Residual phase requires complex subtraction, not subtraction of magnitudes. |

The second tranche adds a matched resistive T pad, a quarter-wave open stub, series RLC reactance cancellation, parallel RL/RC branch cancellation, and low/high-frequency CDR response. The first four are helper-only; only the CDR pair opens an exact saved scenario.

## Evidence and interpretation

Expected values were calculated from boundary conditions, DC resistor paths and the declared loop's special-case algebra, not copied from production output. The checker replays public production entry points against those values. Every group-delay sample is checked in the ideal channel, not just an average. The PDN reference checks the exact zero-frequency nodal result and the signed constant-current FFT result independently against resistor-path arithmetic.

The PDN lab link opens the corresponding network with finite pulses. Its displayed peak droop is **not** the DC reference voltage. The frequency inspector's lower endpoint is also above DC. Present this as an analytical reference connected to a lab, not as an expected screenshot/readout. Lab A reference times are after the first edge settles; they are not edge midpoints. CDR is steady-state phase response, not acquisition or BER-qualified performance.

`tests/check-experiments.js` checks schema essentials, units, current contract/model versions, fixture/scenario paths and control IDs, and 39 analytical expectations across eight fixtures. Its deliberate wrong-number check verifies the comparator can fail; it is not a new production-code mutation. Existing independent model and mutation suites remain separate evidence.

Open [the browser replay harness](../tests/reference-experiments.html) while serving the repository. It downloads the eight first-tranche fixtures and two second-tranche CDR fixtures, follows their public scenario links, checks restored controls and evaluates the resulting public model outputs. The four helper-only second-tranche cases have no exact UI scenario and are checked by `node tests/check-reference-next.js`. Both that command and `node tests/check-experiments.js` are included in `./check`.

## Published library

Fourteen references are published as static, crawlable cards in [the formula and experiment reference](../reference.html#reference-experiments). `python3 scaffold.py experiments` generates the fenced section directly from both manifests and their fixtures. The cards therefore remain useful without JavaScript and expose the same questions, settings, evidence, units, tolerances, derivations and limitations as the downloadable records. Four second-tranche entries are labelled helper-only and link to related lessons rather than implying those pages run the exact inputs.

`python3 scaffold.py check` regenerates the section in memory and compares it byte for byte with `reference.html`. That publication-drift check complements both numerical fixture gates: the Node checks establish the fixture values, while the scaffold check establishes that the public prose was generated from those fixtures instead of being maintained as an independent numerical copy.

## Further references, still pending

An asymmetric two-port reference and wider two-load PDN corner/convergence references remain. The second tranche contains a matched resistive pad, an open-stub quarter-wave case, series RLC and parallel branch-cancellation cases, and finite low/high-frequency CDR cases. The CDR ratios approach their tracking limits; they are not exact zero or infinite-frequency asymptotes. The parallel cancellation frequency is not asserted to be the global impedance peak.
