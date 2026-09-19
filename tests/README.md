# Browser checks

Serve the repository root, then open `tests/preset-sweep.html` for broad preset activation or
`tests/state-transitions.html` for the flagship Lab A, Lab B, Lab C and CDR journey. A completed
suite sets `window.__DONE = true` and exposes structured results as `window.__RESULT`.
The transition suite also marks `#sum[data-state="passed"]` only when every state and
semantic-export comparison passes; it verifies that its 390 px layout shows exactly one
plot and that selecting another view actually changes the visible plot.

The transition suite compares the model's full-precision published parameters, measurements,
identity and sampled trace values with the clipboard CSV, then reloads the public scenario URL and
compares the rebuilt result. Open `tests/state-transitions.html?fault=export` to plant a bad exported
value; at least one case must fail, demonstrating that the harness can reject semantic corruption.

These are browser integration checks. They do not establish physical accuracy, convergence,
visual bounds, accessibility, device behavior or production deployment; those need their own
numerical, visual and human-review evidence.

The domain helper also checks Lab A history against matched-line closed forms and
open/short limits, and Lab B decision attribution against the sampled convolution
and a raw-path build at the same sample index. These latter comparisons are
integration regressions, not independent validation of the channel physics.
The browser transition harness additionally checks collapsible control groups,
compact measurement consistency, Lab A prediction/history state and Lab B
worst-margin decision selection without changing the physical experiment.

Reference experiment fixtures: `node tests/check-experiments.js` verifies eight first-tranche
cases (39 expectations). `node tests/check-reference-next.js` verifies six second-tranche
cases (23 expectations) and detects five deliberate numerical faults. Both run in `./check`.
Open `tests/reference-experiments.html` for ten download + public-scenario replay checks:
the original eight plus two CDR cases. The other four cases are helper-only and have no
exact lab scenario.
The PDN reference evaluates DC separately from the linked finite-pulse display.
Details and fixture contract: `docs/reference-experiments.md`.

Two-load PDN evidence: `node tests/check-pdn-multi.js` runs six selected corners,
independent causal reference/refinement comparisons, an analytical shared-path RL
tone and four scoped numerical faults. It is included in `./check`. To capture all
metrics, set `PDN_EVIDENCE_PATH=/tmp/pdn-evidence.json`. The optional output path
only writes evidence; it does not disable assertions. Some default-grid cases
miss accuracy budgets; five longer/finer test configurations meet them, while the
slow-VRM case remains diagnostic. See `docs/verification-evidence.md` and the dated
`docs/pdn-two-load-evidence.json`; passing this suite does not certify the entire
interactive parameter domain.

Causal PDN update: the current two-load production path must pass those budgets
on all six corners, including slow VRM. The suite now also checks a closed-form
causal trajectory, shared-path DC limits, four causal-path faults and invalid
numerical configurations. Four periodic-helper faults remain separate. Current
evidence: `docs/pdn-causal-evidence.json`; old periodic metrics are historical.
