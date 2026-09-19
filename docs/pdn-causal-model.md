# Causal two-load PDN model

Implemented 16 September 2026. Lab C result version 1.3, contract 2.3.

## Scope and reason for the change

The browser's five-stage ladder now uses a zero-state time-domain calculation for its one-die/one-board load comparison, including when the board load is zero. The former periodic FFT transient carried the preceding repetition's tail into the current experiment. A quiet pre-event baseline did not bound the resulting peak error. Causal evolution removes that repeating-tail mechanism without extending every interactive record.

Frequency-domain impedance and branch-current inspection remain unchanged. The old `K.pdnMultiTransient` and legacy single-load API are retained for analytical periodic benchmarks and regression comparisons. `labPdn(p,{method:'periodic'})` is a test-only comparison option, not a browser control. Its metadata identifies the periodic method. Normal two-load results identify `causal-state-space-foh-v1` in stimulus and diagnostics.

## First-principles construction

The regulator is a series RL shunt at node 0. Each subsequent node k has an upstream series RL link and a shunt series RLC bank. Equivalent parallel-bank R/L divide by count; C multiplies by count. All these R/L/C values are positive in the supported browser topology.

Let i contain the four bank currents flowing toward ground, c their capacitor voltages, and I the load withdrawals. For bank indices k,m beginning at 1:

```text
P_L(k,m) = Lreg + sum(link L from 1 through min(k,m))
P_R(k,m) = Rreg + sum(link R from 1 through min(k,m))
M(k,m) = P_L(k,m) + delta(k,m)*Lbank(k)
R(k,m) = P_R(k,m) + delta(k,m)*Rbank(k)
Bl(k,j) = P_L(k,load-node(j))
Br(k,j) = P_R(k,load-node(j))
D = diag(1/Cbank)

M i' + R i + c = -Br I - Bl I'
c' = D i
```

These equations follow by summing downstream shunt/load currents in each link, then applying KVL from the regulator to each bank. They include both shared upstream impedance and local bank impedance.

Set B=M^-1 Bl and u=i+B I. This removes the input derivative from state evolution:

```text
u' = -M^-1 R u - M^-1 c + (M^-1 R B - M^-1 Br) I
c' = D u - D B I
x = [u,c]; x' = A x + F I
```

The initial incremental state and initial load/derivative are zero. At a bank observation:

```text
i_k = u_k - B(k,:) I
i'_k = (A x + F I)_k - B(k,:) I'
v_k = Rbank(k)*i_k + Lbank(k)*i'_k + c_k
```

Positive withdrawal therefore produces negative rail deviation. Loads are evolved separately; their contributions sum to the combined response.

## Numerical integration

For one step h, integrate linearly interpolated sampled currents with a small augmented matrix exponential. In normalized step coordinate, the augmented generator is:

```text
[hA  hF  0]
[ 0   0  1]
[ 0   0  0]
```

The second/third blocks have one component per load. The final augmented state holds the step's delta-I; the middle block starts at the preceding sample's current. Scaling and squaring with a converged Taylor series computes the transition once per network/grid. Only matrix-vector arithmetic is needed per sample. No dependency or generic simulation framework was added.

The smooth raised-cosine stimulus supplies its analytic derivative at each sample to recover inductive output voltage. State integration approximates the smooth current by its piecewise-linear samples; this approximation is checked by timestep refinement. The method is not claimed exact for arbitrary smooth inputs. Input times/edges retain the existing sample-rounding conventions and exported realized values.

There is no periodic tail. Extending the record at fixed timestep leaves its existing prefix unchanged. Nevertheless, a finite observation interval may omit a later extremum, and sampled peaks can shift on refinement. `timestepConverged` is deliberately null: the browser does not run an independent convergence check on every edit. Zero baseline is not an accuracy certificate.

## Evidence

`tests/check-pdn-multi.js` now requires all six selected production-grid cases to meet the existing 5% waveform / 2% droop budgets at both nodes, including slow VRM. Maximum observed waveform and droop differences against the refined independent reference were about 0.466% of reference peak/droop. The unchanged budgets were not relaxed. Fixed-grid record extension changed earlier samples by zero in these cases; peak timestep changes stayed within 2 mV.

The causal trapezoidal reference uses a different formulation and integration algorithm. Its own refinement is checked. A separate closed-form quadratic-current two-node trajectory and shared-path DC values test the new helper independently of that reference. Four new causal-path faults detect wrong withdrawal sign, omitted inductive input derivative, swapped load nodes and omitted second load. The earlier four periodic-helper faults remain distinct.

Reproducible corner inputs: `tests/fixtures/pdn/two-load-corners.json`. Current record: `docs/pdn-causal-evidence.json`. The older `docs/pdn-two-load-evidence.json` remains historical evidence of the previous method, not a current failure report.

The UI exposes method and finite-window qualification, model/contract versions advance, and reference scenario pins are updated. This is selected-corner validation of the declared teaching network, not a universal parameter-domain proof, field-solver correlation, regulator-loop stability analysis or hardware sign-off.
