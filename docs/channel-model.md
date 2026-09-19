# The channel's line model — parameters, quantities, conventions and qualification

**Status:** contract for `K.sectionABCD` / `K.cascadeS`, written before the implementation
(M1-3a, then M1-3b). **Version 1.0 · 12 September 2026.**
Every test in `check-models.js` that touches the cascade cites a clause here by number.

## Why this document exists before the code

The previous line model assigned attenuation from a `√f` + `f` mixture and phase from `ω·td`
alone. Those two are not independent: a causal medium's loss and dispersion are tied by
Kramers–Kronig, and choosing a magnitude law without the matching phase produces a network whose
impulse response starts before its own propagation delay. Measured, on a matched line with an
integer 4000 ps flight delay:

| Loss at the reference | Energy arriving before the nominal delay |
|---|---:|
| 0 dB | numerical zero |
| 14 dB | **47.63%** |
| 28 dB | **48.98%** |

Naming a recognised dielectric model does not fix that by itself, so this document fixes the
parameterisation, the derived quantities, the delay definitions, the numerical conventions and
the qualification evidence first. §5 is what the tests assert.

## 1. Parameters

A `line` section is a **length of a material**, not a loss figure with a delay attached.

| Field | Meaning | Unit |
|---|---|---|
| `td` | nominal one-way delay **at `lossRefHz`** | s |
| `z` | **nominal** characteristic impedance — the lossless `√(L/C)` | Ω |
| `lossDb` | **propagation loss** `8.686·Re(γ)·ℓ` of this section at `lossRefHz` | dB |
| `lossRefHz` | **the physical frequency `lossDb` refers to.** Belongs to the board | Hz |
| `dielFrac` | share of `lossDb` attributed to the dielectric; the rest is conductor | — |
| `Dk` | relative permittivity at `lossRefHz` (default 4.03, the site's stripline) | — |

`lossRefHz` is the correction for **F1**. The old code passed the *current Nyquist* frequency as
the loss reference, so a fixed 22 dB knob described a different physical board at every symbol
rate — 22.00 dB at 8 GHz on the Gen4 preset and 13.05 dB at the same 8 GHz on Gen5. A rate-only
experiment changed the channel. The reference is now a property of the section.

Length follows from the nominal delay: **ℓ = td·c/√Dk**.

**What this parameterisation cannot represent.** A loss budget assigns `lossDb` at one frequency
and splits it between two mechanisms; it does not express an arbitrary measured |S21| curve. A
very large `lossDb` over a short `td` demands a physically extreme material: 28 dB at 8 GHz over
8 inches needs tanδ ≈ 0.052, worse than FR-4, and such a material disperses strongly (§3). The
model reports that honestly rather than silently decoupling loss from dispersion. Arbitrary
measured curves belong to file import (M7-5), not to this knob.

## 2. Derived line quantities

Both propagation constant and characteristic impedance come from **one** pair of per-unit-length
quantities. Changing the dielectric's phase while keeping an unrelated real impedance is not a
consistent line model.

```text
z'(f) = R_s(f)·(1 + j) + jωL_ext          series impedance, Ω/m
y'(f) = jω·C_vac·ε_r(f)                   shunt admittance, S/m

γ(f)  = √(z'(f)·y'(f))                    propagation constant, 1/m
Zc(f) = √(z'(f)/y'(f))                    characteristic impedance, Ω
```

- `R_s(f) = R_s0·√(f/lossRefHz)` is the conductor's surface resistance. The `(1 + j)` is the
  causal skin-effect form: a good conductor's internal impedance has equal resistive and
  reactive parts, and that equality is what satisfies Kramers–Kronig. Taking the real part alone
  is the error the old model made in miniature.
- `L_ext = z·√Dk/c` and `C_vac = 1/(z·c·√Dk)`, so that `√(L_ext/(C_vac·Dk)) = z` and
  `√(L_ext·C_vac·Dk) = √Dk/c` — the nominal impedance and delay are reproduced exactly at the
  reference, and exactly at all frequencies when the loss is zero.
- `ε_r(f)` is the Djordjević–Sarkar wideband Debye permittivity of §3.

**Square-root branches.** Both roots take the principal branch with non-negative real part, so
`Re γ ≥ 0` (attenuation, never gain) and `Re Zc ≥ 0` (a passive impedance). The sign of the
imaginary part follows the argument's, which for a passive medium gives `Im γ ≥ 0`.

**Complex `Zc` in ABCD.** With `θ = γ·ℓ`:

```text
A = D = cosh θ        B = Zc·sinh θ        C = sinh θ / Zc
```

All four entries are complex. `B` and `C` are complex *products and quotients*, not a real `z`
multiplying a complex sinh — that substitution is what made the old matrix inconsistent with its
own loss law.

## 3. The dielectric

```text
ε_r(f) = ε_∞ + Δε · ln((10^m2 + jf)/(10^m1 + jf)) / (ln10·(m2 − m1)),   m1 = 4, m2 = 13
```

A superposition of Debye relaxations spread uniformly over decades 10 kHz to 10 THz. It is causal
by construction: ε′ and ε″ are the Hilbert transform pair of one analytic function, so no
separate Kramers–Kronig correction is applied or needed.

`ε_∞` and `Δε` are solved so that at `lossRefHz`, `Re ε_r = Dk` exactly and `−Im ε_r/Re ε_r = Df`
exactly, where `Df` is the loss tangent that delivers `dielFrac · lossDb`. Verified for
Dk = 4.03, Df = 0.006 at 8 GHz: ε′ = 4.03000, Df = 6.0000e-3, with ε′ falling monotonically from
4.1684 at 1 MHz to 3.9911 at 100 GHz while ε″ stays within 0.6% of flat across the plateau — the
defining behaviour of this model, and the reason it disperses.

## 4. Delay definitions

Five distinct quantities, kept distinct. Conflating them is how a legitimate dispersive response
gets mistaken for a causality violation.

| Name | Definition | For an 8-inch, 14 dB line |
|---|---|---|
| **wavefront** | `ℓ·√(ε_∞)/c` — earliest possible arrival, set by the `f → ∞` limit | 1277.4 ps |
| **nominal** | `td`, the delay at `lossRefHz` | 1360.0 ps |
| **phase** | `Im(γ)·ℓ/ω` at a given `f` | 1374.4 ps at 8 GHz |
| **group** | `d(Im γ · ℓ)/dω` | frequency-dependent |
| **sample phase** | where the receiver decides — a receiver property, not the channel's | see M1-5 |

**The wavefront is the only boundary causality guarantees.** Energy between the wavefront and the
nominal delay is real dispersion: the high-frequency components travel faster because ε′ falls
with frequency. At 14 dB, 16.6% of the energy legitimately arrives in that window. A pre-arrival
test applied at the *nominal* delay would fail a correct model.

Transport delay is carried as a **sample offset with its fraction preserved** (M1-1), separately
from the channel's memory, so that a long flight time costs record length rather than truncating
the response.

## 5. Numerical conventions

- **Fourier sign**: `K.fft(re, im, inverse)`; the forward transform carries `e^{-jωt}`. The
  spectrum is filled for `k ≤ N/2` and mirrored with conjugate symmetry, so the impulse response
  is real.
- **DC** is evaluated at 1 kHz rather than 0 Hz, to keep `γ` off the branch point.

  The claim that used to sit here — *"the error is below 1e-9 of the DC value for every released
  preset"* — was wrong by nearly six orders of magnitude, and wrong about the cause. Corrected
  from the actual computation (N3-2d), on an 8-inch 14 dB line:

  ```
  S21(1 kHz) = 0.999744 − j0.000266      |S21 − 1| = 3.689e−4
  ```

  **The substitution frequency is not what produces that.** The same value comes back at 1 kHz,
  100 Hz, 10 Hz and 1 Hz — identical to six decimals — so lowering the substitute would not
  improve it. It is a property of the material model: splitting the budget differently moves it
  by two orders of magnitude, and it is the **conductor** term that dominates, not the
  dielectric.

  | loss split | `\|S21(1 kHz) − 1\|` at 14 dB | at 0 dB |
  |---|---|---|
  | all conductor (`dielFrac` 0) | 8.309e−4 | 8.545e−6 |
  | as shipped (0.55) | 3.689e−4 | 8.545e−6 |
  | all dielectric (1.0) | 1.029e−5 | 8.545e−6 |

  A `√f` conductor term has no finite DC limit in the ratio `Rs/ωL`, so the line becomes
  resistance-dominated as the frequency falls and `S21` leaves unity before the substitution
  frequency is reached. The 8.5e−6 floor in the lossless column is numerical and is the best this
  path does. **The model's DC behaviour is therefore accurate to about 4e−4, not to 1e−9**, and a
  reader wanting a true DC point needs an extrapolation this model does not perform.
- **Nyquist** (`k = N/2`) is filled once and not mirrored.
- **Time origin** is the launch instant; sample 0 is `t = 0`.
- **Tail truncation does not happen.** This clause used to describe an energy budget — keep the
  response until 99.99% of its energy is accounted for, then round to the next power of two. The
  implementation does no such thing: it is `const keep = NFFT`, the whole record, and has been
  since M1 removed the `SPS * 40` cutoff that caused B1. The document described a design that was
  considered and not built. What the model does instead is measure whether the response has
  decayed *inside* the record it already has — see §6 and `periodicResidual`, which N2-2 rewrote
  to measure from the response peak rather than a fixed window.
- **Record duration and bandwidth vary independently.** They are different knobs with different
  artefacts, and §6 measures both.

## 6. Qualification

What the model has to demonstrate, and what `check-models.js` asserts.

**6.1 Analytical limits.** A lossless section reproduces `Zc = z + 0j` and phase delay `= td`
exactly at every frequency, and the existing exact ABCD identities still hold.

**6.2 Independent reference.** Complex S11 and S21 are compared across the band against a
separately implemented reference — built from `γ` and `Zc` directly rather than through
`abcdMul` — using identical parameters and port conventions. Two implementations of the same
formula would prove nothing; these share the material model but not the matrix algebra.

**6.3 Passivity.** For a passive section with real positive reference impedances, the test is
**σ_max(S) ≤ 1** — the largest singular value of the scattering matrix. Checking each `|S_ij| ≤ 1`
individually is insufficient and would pass networks that gain energy. For a reciprocal,
symmetric two-port the singular values have a closed form, `|S11 ± S21|`, so no decomposition is
needed: **σ_max = max(|S11 + S21|, |S11 − S21|)**. Measured on the 400 ps / 14 dB line,
σ_max = 0.9666 while max `|S_ij|` = 0.8760 — the per-element check has 12% of slack the real
criterion does not. This applies to the channel only; the receiver equaliser is active and is
**not** subject to it.

**6.4 Causality at the wavefront.** Pre-wavefront energy must be below 1e-5 of the total and must
**fall as the record is refined at fixed bandwidth**. Measured, 4000 ps nominal delay, 512 GHz
sampling:

| | N = 16384 | N = 32768 | N = 65536 |
|---|---:|---:|---:|
| 14 dB | 4.06e-7 | 4.66e-8 | 5.52e-9 |
| 28 dB | 4.24e-6 | 4.88e-7 | 5.77e-8 |

Roughly a factor of nine per doubling. Raising the **bandwidth** at fixed record makes it worse
(4.06e-7 → 3.81e-6 → 4.50e-5 at 512/1024/2048 GHz), because the record shortens in time and
circular wraparound grows. Those are different artefacts and the convergence claim is about the
first. **Strict monotonic improvement at every FFT size is not required** — the envelope is.

**6.5 Loss budget, and the two quantities it is not.** `lossDb` is the section's **propagation
loss**, `8.686·Re(γ)·ℓ` at `lossRefHz`. That is an intrinsic, composable property of a length of
material, and it is hit to **2.4e-11 dB** after §7.

It is deliberately *not* the cascade's `|S21|`, for a reason worth teaching rather than hiding.
`z` is the **lossless** `√(L/C)`; the actual `Zc = √(z'/y')` of a *lossy* line departs from it,
because `z'` carries the conductor's `Rs(1 + j)` term. For a 50 Ω nominal line at 14 dB over
8 inches, `Zc` = **50.53 + 0.13j** at 8 GHz — about 1% high and slightly reactive. Against a real
50 Ω reference that is a genuine port mismatch, so `|S21|` through `cascadeS` is 14.00021 dB
where the propagation loss is 14.00000 dB. The difference is the mismatch, not an error, and a
section's contribution to a cascade's `|S21|` depends on its neighbours in any case — which is
the reason for using ABCD rather than adding decibels.

The gap grows as the line gets shorter for the same loss, because more loss per unit length means
a larger `Zc` departure: a **400 ps** line carrying the same 14 dB has `Zc` = 51.72 + 0.53j and
`|S21|` = 14.00237 dB. So the asserted bound is **propagation loss exact, `|S21|` within
5e-3 dB** across the released range.

**Zc at low frequency, and why the TDR slopes.** As `f → 0` the series term `R_s(1 + j)`
overtakes `jωL`, so `Zc → √(R/(jωC))`, which grows as `1/√f`. For that 400 ps line: 51.51 Ω at
4 GHz, 52.14 − 2.32j at 1 GHz, **58.76 − 8.96j at 100 MHz**. A TDR step is dominated by the low
end of the band, so a lossy line reads as a *rising* impedance profile — the familiar upward slope
on a real TDR trace. It is physics, not an artefact, and a matched-value section embedded in lossy
line is therefore **not** invisible to the TDR.

**6.6 Rate independence (F1/M1-13).** Changing the symbol rate leaves complex S11 and S21
unchanged at every common physical frequency. Asserted at 4, 8 and 12 GHz.

## 7. The loss-budget correction

Solving the material from a target loss is approximate at first pass, because `α_d` uses `√Dk`
while propagation uses `√(ε′(f))`, and the conductor's internal inductance perturbs both. Without
correction the first pass gives 14.0154 dB for a 14 dB budget. A fixed-point correction on `tanδ`
and `R_s0`, measuring the achieved propagation loss at `lossRefHz` and rescaling, is applied once
at section construction and cached — never per frequency. Measured convergence:

| iteration | 0 | 1 | 2 | 3 |
|---|---:|---:|---:|---:|
| error, dB | 1.54e-2 | 1.76e-5 | 2.00e-8 | **2.36e-11** |

## What this model is not

It is a **causal, analytically specified single-conductor line with a physically motivated
dielectric and conductor loss.** It is not a field solver, not a coupled-line model, not
correlated against measurement, and not a substitute for a 3-D extraction. `docs/model-types.json`
records `labChannel` accordingly, and the panel says so where a reader can see it.

---

## 8. The admissible domain — added 13 September 2026 (N1-2 / R2)

Clauses 1–7 describe how the material is solved. This one says when the answer is a
material at all, and it exists because the model shipped for a while without it.

**The inverse problem has no physical guardrail.** `fitDielectric` solves `eps_inf` and
`delta_eps` so that the line delivers a requested loss *budget* at `fRef`. Ask a short
line for a large loss and `delta_eps` rises to meet it, while

```
eps_inf = Dk - plateau(delta_eps)
```

falls. Nothing in that algebra stops it passing through 1 and then through 0.

**Two failures live below 1, and only the lower one is loud.**

| Range | What happens | Visible? |
|---|---|---|
| `eps_inf < 0` | `sqrt` is NaN; the NaN reaches the eye | a NaN readout, eventually |
| `0 < eps_inf < 1` | **nothing looks wrong** | **no** |

The second is the dangerous one. There is no NaN. The line is finite, the eye is
plausible, the error count is plausible — and the wavefront arrives sooner than light
crosses the same distance *in vacuum*. At 1 inch and 14 dB, one slider move from Lab B's
default, the model gave a wavefront of **65.16 ps against a vacuum transit of 84.73 ps**.
That is a causality violation presented as an engineering result, which is worse than a
NaN precisely because nothing downstream can detect it.

**So the boundary is `eps_inf >= 1`, not `eps_inf > 0`.** `K.lineMaterial` sets
`M.admissible` accordingly, returns `wavefront: NaN` when it is false, and reports
`M.maxLossDb` — the largest budget this geometry can carry — by bisection.

**The limit is computed, never tabulated.** It moves with all three of the loss reference
frequency, the dielectric fraction and `Dk`:

| Condition | Limit |
|---|---|
| 8 GHz, Dk 4.03, dielFrac 0.5 | 12.33 dB/inch |
| 16 GHz, same | 27.31 dB/inch |
| 28 GHz, same | 52.34 dB/inch |
| 8 GHz, dielFrac 0.25 | 22.52 dB/inch |
| 8 GHz, dielFrac 1.0 | 6.13 dB/inch |

Lab B splits its loss pro-rata by delay across the sections either side of the
discontinuity, so the binding constraint is the same per-unit-length limit on every
section, and at `dielFrac` 0.55 it is about **11.3 dB/inch**.

**What the model does at the boundary.** It refuses. `NS.models.labChannel` returns
`status: 'unsupported'` with a `why` that names the permittivity it would have needed and
the loss this length can actually carry. It does **not** clamp: silently substituting an
admissible material would answer a different question under this one's label.

`check-models.js` asserts the physical law rather than the fit — no admissible line may
deliver a wavefront faster than light in vacuum — so a future change to the fit cannot
reopen this without failing.


## Discrete impulse inspection and export units (15 September 2026)

The impulse arrays are dimensionless convolution weights: `y[n] = Σ h[k] x[n-k]`.
Their sum is the DC bin of the discrete FFT model, subject to its documented low-frequency
substitution. They are not continuous-time impulse densities in inverse seconds. The
normalized single-bit response is dimensionless too; the pulse plot multiplies it by the
transmitted voltage amplitude before displaying mV. Lab B numerical result version 1.1
corrects these export units and adds the active raw/CTLE kernel alongside the raw kernel.

Exported impulse time remains seconds after the removed integer transport delay.
`origins.tdBulk` records that removed delay in seconds. The impulse-view absolute labels
add it back without altering samples, fractional delay, normalization or finite-record
behavior. Switching origin or record window resets the display zoom to fit the new
coordinates. The full record remains available when the early window is selected;
late periodic-record residue is not hidden from the export or decay diagnostics.
