# The real-capacitor model — contract

What `K.realCap` computes, what it refuses to compute, and where every number in it
comes from. Written before the implementation, as `docs/channel-model.md` was.

The short version: **this model will not tell you your derating.** It takes the retained
capacitance as an input, because no honest model can supply it — see clause 4.

---

## 1. What it computes

One capacitor mounted on a board, as a two-terminal impedance against frequency:

```
Z(f) = ESR(f) + j( 2*pi*f*Ltot  -  1/(2*pi*f*Ceff) )
Ltot = ESL_part + L_mount
SRF  = 1 / ( 2*pi*sqrt( Ltot * Ceff ) )
```

`|Z|` has a minimum of exactly `ESR(SRF)` at `f = SRF`. Below it the part is a capacitor;
above it, an inductor. That crossover is the whole point of the panel.

## 2. Inputs, and which are facts

| Input | Kind | Where it comes from |
|---|---|---|
| `cNom` marked capacitance | **catalog fact** | the part marking / datasheet |
| `vRated` rated voltage | **catalog fact** | datasheet |
| `case` size, `dielectric` | **catalog fact** | datasheet |
| `retained` fraction of `cNom` still present at the operating point | **reader input** | clause 4 |
| `eslPart` part self-inductance | **derived or declared** | clause 5 |
| `lMount` mounting loop inductance | **derived** | clause 5 |
| `esrMin`, `fEsrMin` | **declared** | clause 6 |

Catalog facts are reproduced for named parts because a marking, a case size and a voltage
rating are published identically by the manufacturer and every distributor. **No vendor's
measured characteristic curve is reproduced in this repository.**

## 3. Derived quantity

```
Ceff = cNom * retained
```

That is the only place `retained` enters. Tolerance, temperature, bias and ageing all
land in this one scalar, deliberately: see clause 4.

## 4. The derating is an input, not a model — and why

The obvious design is a bias-derating curve per part. This model refuses to have one.

Novak, Williams, Miller, Blando and Shannon measured MLCCs from six vendors and
concluded that "the bias dependence for the same nominal part from different vendors can
be very different", that "bias sensitivity of X7R parts is not necessarily better than
that of X5R parts, sometimes not even from the same vendor", and that beyond the
immediate change there is a slower settling that moves capacitance "by as much as 25%
over the course of a few minutes". Their Figure 4 shows ten samples of a single part
number — one vendor, one order code — spreading visibly.

A panel that shipped one curve and labelled it "22 uF X5R" would therefore teach the
wrong thing: that derating is a property you look up. It is a property you **bound**, per
part, per vendor, per lot, from the curve your vendor publishes for the part you are
actually buying.

So the panel takes `retained` from the reader, marks the published brackets on the
control, and sweeps the band to show what the uncertainty costs. The brackets:

| Bracket | Retained | Source |
|---|---|---|
| Class II, historically | 0.60 – 0.80 | Novak et al. §I: "a modest 20 to 40% maximum capacitance degradation over the full DC working range" |
| Class III, historically | <= 0.40 | same: "a maximum capacitance loss of 60% or higher" |
| high-density Class II, today | down to Class III figures | same: today's X5R/X7R "exhibit capacitance drops, which were previously seen mostly from Class III ceramics" |

These are read from the paper's prose, not from its graphs. Nothing here is read off a
plotted curve by eye.

**Separability.** Bias and temperature are applied as one scalar rather than a
two-dimensional surface because the same paper found "the DC bias sensitivity of
capacitance does not depend on the temperature" — so the two effects multiply and a
single retained fraction carries both without loss. That is a measured finding, cited,
not a modelling convenience.

**What the reference condition means.** A marked capacitance is measured at a stated
condition, which for Class II MLCCs is set by JEITA RCR-2335. This repository does not
hold a copy of that standard; the reference is recorded as a normative claim awaiting a
licensed read, in `docs/claims.json`, and the page states the condition qualitatively
rather than quoting a clause.

## 5. Inductance

`eslPart` is the part's own terminal-to-terminal inductance. `lMount` is the loop the
board builds: pads, traces, vias, and the plane return. The model adds them, and adds
nothing else — no mutual coupling to neighbouring parts, no plane spreading inductance.

For a via pair the site computes the loop exactly, from `K.viaLoopInductance`:

```
L = length * (mu0/pi) * acosh( spacing / (2*radius) )
```

which is the same helper M7-4 introduced, so the two panels cannot drift apart.

**The model does not derive `eslPart` from a published SRF.** It could — `L = 1/((2*pi*f0)^2*C)`
is exact — but the published SRF is itself measured at the marked capacitance, so
feeding it back in alongside a derated `Ceff` would double-count. `eslPart` is declared
per part and stated as declared.

## 6. ESR

Two mechanisms, opposite slopes, as the page already describes:

```
ESR(f) = Rd * (fmin/f)^p  +  Rm * sqrt(f/fmin)
```

Dielectric loss falls with frequency; metal loss rises as `sqrt(f)` from the skin effect.
`Rd`, `Rm` and `p` are chosen so the minimum lands at `fEsrMin` with value `esrMin`;
the shape between is **illustrative** and the panel says so.

The model applies **no temperature coefficient to ESR**, although Novak et al. found one
at high frequency and around the piezoelectric resonance. Declining to model it is
recorded here rather than hidden: a panel that showed a temperature-independent ESR
without saying so would be making a claim it had not earned.

## 7. What this model is not

- Not a vendor's part model. It will not reproduce a measured `.s2p` or a SPICE macro.
- Not a multi-capacitor network. One part, one mount. Anti-resonance between parts is
  Lab C's job, and Lab C is where that lesson lives.
- Not valid above the first structural resonance of the part body, where a lumped
  `R + L + C` stops describing an MLCC at all.
- Not a source of derating figures. Clause 4.

## 8. Sources

1. I. Novak, B. Williams, J. R. Miller, G. J. Blando, N. Shannon, "DC and AC Bias
   Dependence of MLCC Capacitors and its Temperature Dependence", **DesignCon East 2011**.
   Retrieved from the authors' Electrical Integrity paper archive,
   `http://electrical-integrity.com/Paper_download_files/DCE11_200.pdf`, 12 September 2026.
   Measurement conditions as stated in the paper: DC stepped in 0.2 V increments over
   -20 V to +20 V, AC levels 10 mVrms and 500 mVrms, temperature -5 degC to +70 degC.
   Vendors anonymised by the authors as Vendor-A through Vendor-F.
2. Murata, "Does the capacitance change when a DC voltage is applied to ceramic
   capacitors?", capacitor FAQ. The polarization mechanism quoted in clause 4's prose:
   DC bias ties spontaneous polarization to the field direction and inhibits independent
   reversal. Retrieved 12 September 2026.
3. JEITA RCR-2335 C:2014, the specification governing Class II MLCC characterisation.
   **Not held.** Cited as the reference condition only, and recorded in `docs/claims.json`
   as awaiting a licensed read.
