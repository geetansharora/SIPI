# Claim ledger — protocol and specification statements

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

**35 claims: 7 verified, 7 scoped, 21 awaiting a source.**

Compound claims are split, because verifying one half used to verify the whole
row. "Gen 4 is 28 dB and Gen 5 is 36 dB" is two budgets against two editions;
"FLIT-only with FEC and CRC and replay" is four mechanisms doing different jobs.

## Ledger

| # | Claim | Pages | Source needed | Type | Status | Reviewed |
|---|---|---|---|---|---|---|
| C-1 | Data bus inversion reduces the number of simultaneously switching outputs on an LPDDR5X data byte. | `power-integrity/ssn-ground-bounce` | JESD209-5x, DBI mode definitions | `normative` | **scoped** — Wording now distinguishes transition-minimising from level-minimising inversion and claims no universal 50% bound. | — |
| C-2a | LPDDR5X reaches 8533 MT/s. | `interfaces/lpddr5x` | JESD209-5x speed bin tables | `normative` | **awaiting** — Needs an edition. 8533 is not a timeless family maximum — later editions raise it, so the claim has to carry its edition. | — |
| C-2b | LPDDR5 reaches 6400 MT/s. | `interfaces/lpddr5x` | JESD209-5 speed bin tables | `normative` | **awaiting** — Split from C-2: a different standard from LPDDR5X, so verifying one says nothing about the other. | — |
| C-3 | An LPDDR5X channel is point-to-point rather than multidrop. | `interfaces/lpddr5x` | JEDEC topology definitions, plus a controller/PHY implementation guide | `normative` | **awaiting** — 'No multidrop' is too categorical — rank count changes it. | — |
| C-4a | WCK is the write data clock on LPDDR5X. | `interfaces/lpddr5x` | JESD209-5x clocking architecture | `normative` | **awaiting** — Split from C-4. WCK and RDQS have distinct roles and the page must not blur them. | — |
| C-4b | RDQS is returned by the memory with read data on LPDDR5X. | `interfaces/lpddr5x` | JESD209-5x clocking architecture | `normative` | **awaiting** — Split from C-4. | — |
| C-5 | Read and write training centre the strobe in the data eye. | `interfaces/lpddr5x` | JESD209-5x training sequences | `normative` | **scoped** — Narrowed: training also adjusts ODT, drive strength and reference levels, so 'training centres the eye' is one of several things it does. The panel labels its training model illustrative. | — |
| C-6a | A PCIe Gen 4 channel budget is about 28 dB. | `interfaces/pcie-gen4-gen5`, `signal-integrity/channel-budgeting` | PCIe Base and CEM, Gen 4, with the reference plane for the figure | `normative` | **awaiting** — Split from C-6. Currently labelled 'commonly quoted', which is honest but not sourced. | — |
| C-6b | A PCIe Gen 5 channel budget is about 36 dB. | `interfaces/pcie-gen4-gen5`, `signal-integrity/channel-budgeting` | PCIe Base and CEM, Gen 5, with the reference plane for the figure | `normative` | **awaiting** — Split from C-6: a different edition, so it needs its own reading. | — |
| C-7 | Gen 5 designs commonly backdrill long via stubs. | `interfaces/pcie-gen4-gen5` | none — channel-dependent practice | `commercial` | **scoped** — Treated as an implementation remedy, never a specification requirement. | — |
| C-8a | PCIe 6.0 uses FLIT mode. | `interfaces/pcie-gen6` | PCIe 6.0 Base, FLIT mode | `normative` | **awaiting** — Split from C-8, which bundled four separate mechanisms into one row. | — |
| C-8b | PCIe 6.0 applies forward error correction. | `interfaces/pcie-gen6` | PCIe 6.0 Base, FEC | `normative` | **awaiting** — Split from C-8. | — |
| C-8c | PCIe 6.0 applies a CRC with link-level replay. | `interfaces/pcie-gen6` | PCIe 6.0 Base, CRC and replay | `normative` | **awaiting** — Split from C-8. FEC and CRC-with-replay are different mechanisms doing different jobs. | — |
| C-9 | PCIe 6.0 tolerates a raw error rate near 1e-6 and delivers about 1e-12 after correction. | `interfaces/pcie-gen6` | PCIe 6.0 Base, raw versus post-correction error metrics | `normative` | **awaiting** — The two numbers are different quantities, not one before and after. | — |
| C-10 | A Gen 6-capable link uses FLIT mode at lower rates as well. | `interfaces/pcie-gen6` | PCIe 6.0 Base, negotiation rules | `normative` | **awaiting** — Lower-rate behaviour must not be inferred from Gen 6 capability. | — |
| C-18 | PCIe Gen 4 and Gen 5 define eleven transmitter presets, P0 to P10. | `interfaces/pcie-gen4-gen5` | PCIe Base, per edition | `normative` | **awaiting** | — |
| C-11 | The PAM4 links in common use pair it with forward error correction. | `signal-integrity/nrz-vs-pam4` | would need the standards set defined and each one checked | `normative` | **scoped** — Narrowed from 'PAM4 standards mandate FEC', which would need every such standard read. | — |
| C-12a | MIPI M-PHY v5.0 defines HS-GEAR5. | `interfaces/ufs4` | MIPI press release, M-PHY v5.0 | `public-rate` | **verified** — Public fact from the standards body's own announcement. Verifies the existence of the gear and nothing about its electricals. | — |
| C-12b | M-PHY HS-GEAR5 runs at 23.32 Gb/s per lane. | `interfaces/ufs4` | MIPI press release, M-PHY v5.0 | `public-rate` | **scoped** — The page said 23.2 Gb/s; the announcement says 23.32. Neither figure is wrong for a different quantity — raw versus post-encoding differ — so the page now states the raw rate and names it as raw. The discrepancy is why this is split from C-12a. | — |
| C-12c | UFS 4.0 binds M-PHY HS-GEAR5. | `interfaces/ufs4` | JESD220E and the M-PHY revision it references | `normative` | **awaiting** — A rate announcement says nothing about which revision UFS binds. | — |
| C-13 | UFS over M-PHY uses spread-spectrum clocking. | `interfaces/ufs4` | MIPI M-PHY | `normative` | **awaiting** — Do not carry USB's SSC behaviour across to another PHY. | — |
| C-14 | An M-PHY burst requires re-acquisition from a preamble. | `interfaces/ufs4` | MIPI M-PHY burst and power-state definitions | `normative` | **awaiting** | — |
| C-15 | USB 3.2 spread-spectrum clocking is down-spread, 0 to -5000 ppm, at roughly 30 to 33 kHz. | `interfaces/usb-3x` | USB 3.2 specification, SSC section | `normative` | **awaiting** | — |
| C-16a | USB 3.2 Gen 1 operates at 5 Gb/s. | `interfaces/usb-3x` | USB-IF, usb.org/usb-32-0 | `public-rate` | **verified** — Public rate fact from the standards body. Says nothing about electrical requirements. | — |
| C-16b | USB 3.2 Gen 2 operates at 10 Gb/s. | `interfaces/usb-3x` | USB-IF, usb.org/usb-32-0 | `public-rate` | **verified** — Public rate fact from the standards body. | — |
| C-16c | USB 3.2 Gen 2x2 operates at 20 Gb/s. | `interfaces/usb-3x` | USB-IF, usb.org/usb-32-0 | `public-rate` | **verified** — Public rate fact from the standards body. Two lanes, which is why it is split from Gen 2. | — |
| C-17 | Controlled impedance is typically specified to +/-10%, with +/-7% available at a premium. | `package-board/manufacturing-tolerance` | fabricator capability statements, not a standard | `commercial` | **scoped** — Presented as typical fabricator capability rather than a specification. | — |
| C-19 | The DC bias dependence of the same nominal MLCC part differs markedly between vendors, and X7R is not reliably less bias-sensitive than X5R. | `power-integrity/real-capacitors` | I. Novak, B. Williams, J. R. Miller, G. J. Blando, N. Shannon, 'DC and AC Bias Dependence of MLCC Capacitors and its Temperature Dependence', DesignCon East 2011 | `measured` | **verified** — Read from the paper's own conclusions, not from its plotted curves. The authors anonymise the vendors, which is why this site names no part's derating curve. This claim is the reason the panel takes the retained fraction as an input. Retrieved 12 September 2026 from the authors' paper archive. The link is http, not https: the https endpoint on that host returns 404, so an upgraded URL silently fails. | — |
| C-20 | MLCC DC bias sensitivity does not depend on temperature, so bias and temperature derating multiply as separable factors. | `power-integrity/real-capacitors` | Novak et al., DesignCon East 2011, conclusions | `measured` | **verified** — This is what lets docs/real-capacitor-model.md carry bias and temperature in one retained scalar rather than a two-dimensional surface. Recorded because it is a measured finding being used as a modelling licence. Retrieved 12 September 2026 from the authors' paper archive. The link is http, not https: the https endpoint on that host returns 404, so an upgraded URL silently fails. | — |
| C-21 | Beyond the immediate capacitance change when DC bias is applied, MLCCs show a slower settling that can move capacitance by as much as a further 25% over a few minutes. | `power-integrity/real-capacitors` | Novak et al., DesignCon East 2011, conclusions | `measured` | **verified** — Quoted on the page as a reason the retained fraction is a band rather than a number. The figure is the paper's stated bound, not one read off a curve. Retrieved 12 September 2026 from the authors' paper archive. The link is http, not https: the https endpoint on that host returns 404, so an upgraded URL silently fails. | — |
| C-22 | A successive-approximation converter compares against its reference once per bit trial, so a reference that moves during a conversion weighs the early bits differently from the late ones. | `labs/adc-interference` | SAR converter datasheets and application notes describing reference settling and bit-trial timing | `commercial` | **awaiting** — The mechanism is what this lab models and it follows from the architecture, but the claim as written is about SAR converters in general and has no primary source recorded yet. The page already states that its own converter is ideal and that trial times are a modelling choice. | — |
| C-23 | A one-bit delta-sigma modulator's feedback DAC is scaled by the reference, so reference ripple multiplies the bitstream rather than adding to the signal. | `labs/adc-interference` | Delta-sigma converter datasheets and texts on oversampling converters, for the reference path of a switched-capacitor feedback DAC | `commercial` | **awaiting** — The page now bounds this to the loop it simulates and says explicitly that a continuous-time or multi-bit modulator will move the result. The derivation for this loop is in the model contract. Status is awaiting rather than scoped because narrowing the wording is not the same as reading a source. | — |
| C-24 | Counting interference as noise, with the fundamental, DC and harmonics 2 to 6 excluded, is the usual convention for a converter dynamic test. | `labs/adc-interference` | IEEE Std 1241, terminology and test methods for analog-to-digital converters | `normative` | **awaiting** — Stated as this lab’s declared convention rather than as a standard it complies with. No licensed source has been read, and the page makes no compliance claim. The exclusion widths, the window and the masking limitation are published in the result contract. | — |
| C-25 | Input-referred coupling appears as an offset error, a constant reference error as a gain error, and a reference that changes during the bit trials as a linearity error. | `labs/adc-interference` | Derived on this page from the converter model, and measured with it: offset 0.90 mV, gain −0.318 dBFS implying a 2.41 V effective reference, and THD rising to −53.5 dB | `measured` | **scoped** — Narrowed in this batch: DNL and INL are named as the mechanism and explicitly not measured, because the lab runs no static ramp or histogram test and THD is not a substitute for one. The resemblance to a static nonlinearity holds only while the disturbance repeats in step with the conversions, which the page now says. | — |
| C-26 | A sinc-cubed decimator is the usual filter after a second-order modulator, and it nulls exactly at multiples of the output data rate. | `labs/adc-interference` | Delta-sigma converter datasheets describing sinc-filter order and notch placement | `commercial` | **awaiting** — The null positions and the 3·OSR−2 length are first principles and are asserted in the ADC decimation suite. What has no source recorded is the claim that this is the usual choice in commercial parts; the page describes it as what this lab does. | — |
