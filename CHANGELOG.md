# Change log

Substantive changes only — corrections, new models, and changes to what a page
claims. The full history is in the repository; this is the subset that would
change what a reader believes.

Each correction says what was wrong, what it is now, and how it was caught.
Entries are newest first.

---

## September 2026

### Corrections to model behaviour

These were all found by building an independent physics gate (`check-models.js`)
and asking each model questions it could not answer by restating its own formula.

- **A closed bathtub reported a fully open eye.** The interval search returned a
  number when no sampling position met the target BER, and the caller could not
  tell "zero width" from "no interval". It now returns an explicit empty result.
  *Caught by: asking what a closed eye should return.*
- **The CTLE applied magnitude without phase.** A magnitude-only filter is not
  physical — it produced energy before the impulse that caused it, which made
  equalisation look better than it is. Pre-cursor energy fell from 24.46% to
  0.58% once the phase was applied. *Caught by: asking whether energy appeared
  before t = 0.*
- **The DFE double-counted a tap boundary.** Its window was inclusive at both
  ends. *Caught by: asserting exact cancellation, which failed by one tap.*
- **Echo amplitude used ΓL² instead of Γs·ΓL,** and the echo was then truncated
  away entirely by a length cut. *Caught by: a conservation check on the
  cascaded network.*
- **Anti-resonance kept drawing a peak after the peak had gone.** Same class as
  the bathtub bug — a search that could fail returned a number.
- **PDN-induced jitter had a time-unit error** and an underspecified transfer
  model.
- **The four-impairment lab did not represent one consistent channel.** It now
  assembles direct, echo and crosstalk contributions on a single network before
  equalisation.
- **The cursor was taken from the pulse peak rather than the eye centre.**

### Corrections to prose

- **The project plan §3.1.7 had FEXT and stripline backwards.** Annotated inline.
- **The project plan §3.3.3 gave the PAM4 penalty as 3 dB.** It is 20·log₁₀(3) ≈
  9.54 dB. Annotated inline.
- **"0.5/tᵣ" was presented as a derived constant.** It is a conservative
  round-up of 1/(πtᵣ) ≈ 0.32/tᵣ, and the edge-rate page now says so.
- **"A PLL tracks out slow supply noise" was stated without qualification.** It
  is true for noise at the VCO, exactly backwards at the reference, and false
  for anything outside the loop. Corrected on the PSIJ page.
- **"Adding decoupling capacitors lowers the impedance" was stated too
  simply.** Parts in parallel divide the bank's ESR as well as its ESL, so they
  remove the damping from an anti-resonance. Measured in Lab C: 20 → 50 board
  parts takes the worst peak from 56.8 to 61.3 mΩ. Both numbers are now in
  `check-numbers.py`.
- **Reciprocity was implied to follow from passivity.** It does not — a ferrite
  isolator is passive and deliberately non-reciprocal. Corrected on the
  S-parameters page.
- **Black's equation was presented as a lifetime prediction.** Its constants
  belong to a specific metallurgy and the temperature term dominates, so the
  honest use is comparative. Corrected on the IR-drop page.
- **A TDR resolution figure was out by a factor of two** in Lab B's verdict
  text (`tr*2/170/2` cancels). Resolution is tr·v/2 because the round trip
  halves it. Now pinned in `check-numbers.py`.

### Changes to what is claimed

- **Evidence levels are no longer collapsed.** "Computed", "physically
  plausible", "verified against an independent model" and "compliant with a
  named specification" are recorded and displayed separately. There is no
  generic "verified" badge. See [model contracts](model-contract.html).
- **Eye diagrams now state what their run supports.** A few hundred simulated
  symbols evidences a BER around 10⁻³, not a compliance rate. Enforced by 13
  assertions.
- **Specification claims are tracked rather than asserted.** 24 protocol claims
  are recorded in [the claim ledger](docs/claims.md) with status: 2 verified, 5
  scoped, 17 awaiting a primary source. Interface pages now state where their
  sourced numbers stop.

### New

- Three flagship labs: travelling waves, one channel in six domains, and the
  PDN from regulator to die.
- Every panel gained a scenario link, a values table, a probe cursor, zoom,
  legend trace toggles, an A/B reference overlay and Guided/Explore/Verify
  modes.
- All 53 topic pages rewritten to build from first principles and close with
  what to tune and how to diagnose. Every page gained a "go deeper" section.

---

*Earlier history predates this changelog and is in the repository.*
