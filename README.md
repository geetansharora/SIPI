# SI &amp; PI

Signal and power integrity, visualised through interactive explanations and engineering models.

Created and directed by Geetansh, Principal SI/PI Engineer, with his technical review of the
content and hands-on exploration of the labs. Developed with assistance from Claude Opus and
OpenAI Codex models Astra and Sol. Model evidence and source status remain scoped separately.

## Run it

No build step, no dependencies. Just serve the folder:

```bash
python3 serve.py
```

Then open <http://localhost:8000>.

Every page — including the topic map — is static HTML, so the whole site also works from `file://`
if you just want to read it. The only thing that needs HTTP is search, which fetches `topics.json`;
it hides itself when it can't.

## Where the project actually stands

*Produced by `python3 scaffold.py stats`; the structural and test counts are **checked** —
`scaffold.py check` fails the build if those fields drift from the site. An earlier version of this
table claimed to be generated and was in fact hand-written; it went stale within
the hour, which is why it is now enforced rather than promised.*

| | |
|---|---|
| Topic pages | **60**, all `live`, every one with a `deeper` section and its own review date |
| Words | 133917; median 2140 per page |
| Interactive panels | **28**, including four flagship labs |
| SVG figures | 36 |
| Arithmetic claims checked | **114** across 34 pages (`check-numbers.py`) |
| Model assertions | **840** (`check-models.js`), with **0 claims pending** — named, with the item that owes each one |
| Mutation coverage | **44 of 44** known defects have an assertion that provably catches them (`mutate.js`) |
| Specification claims | **35 tracked: 7 verified, 7 scoped, 21 awaiting a primary source** | <!-- generated from docs/claims.json -->

**The last row is the honest weak spot, and the honesty is the point.** It has
said 24-tracked-2-verified and 18-tracked-0-verified at different times, both by
eye. It is now generated from [`docs/claims.json`](docs/claims.json), where each
claim carries its own source type — and compound claims have been split, because
verifying one half used to verify the whole row.

The seven **verified** rows are of two kinds, and neither is a standard. Four are
`public-rate`: data rates a standards body has published openly, which verify
themselves and nothing electrical. Three are `measured` — findings from a paper
whose authors published their method and signed their names to it, cited because
a measurement somebody stands behind is evidence in a way that a supplier's claim
about its own product is not.

**"Verified" here means a source check; it is separate from Geetansh's technical
review of every page published on 14 September 2026 and his hands-on exploration of the labs.**
That human review is recorded as a dated list of topic paths in `topics.json`, so future pages do
not inherit it automatically. `humanReviewedBy` remains unset in the claim ledger because a page
review does not independently verify each standards claim. `scaffold.py check` refuses a row that records both an AI source check and a
human review without saying so in the note. Of the twenty-one **normative** claims — actual
requirements in actual standards — none is verified, and `scaffold.py check`
refuses to let one become verified from a press release or an application note. Numbers derivable from physics are recomputed and
checked automatically; statements that are true only because a standards body
wrote them down are not. They are listed with their status in
[`docs/claims.md`](docs/claims.md), and the interface pages say where their
sourced numbers stop.

### The four gates

```bash
./check
```

| Gate | Scope |
|---|---|
| `scaffold.py check` | structure — dead links, tag balance, headings vs `topics.json`, unwired panels, model contracts, and assets that would be cached immutably without a version |
| `check-numbers.py` | **every number in the prose that is derivable from a formula** — recomputed from first principles and compared against what the page says. It does not check numbers nobody wrote down, and it does not check sourced claims. |
| `check-models.js` | physics, units, empty results and state drift — assertions written to be *independent* of the code they test |
| `mutate.js` | **whether the gate above can fail.** Each known defect is planted in an isolated copy of the tree, and the assertion that claims to catch it must be the one that fails. A syntax error or an unrelated failure counts as a harness error, not as detection |

The fourth gate exists because the third reached 276 passing assertions while a
6.02 dB error in the equaliser's applied gain went unnoticed by all fourteen of
its equaliser assertions — one of which compared a quantity to itself. An
assertion count is not a quality measure. `node mutate.js --selftest` checks the
harness the same way, by requiring it to report a behaviour-preserving edit as
*surviving*.

The first gate also enforces the evidence layer: every panel's badge must match
[`docs/model-types.json`](docs/model-types.json) and name test suites that
exist; every page with a panel must carry that panel's contract so Verify mode
has something to show; and every ledger row must satisfy its own rules — a
normative claim cannot be marked verified from a press release, and a review
attribution cannot exist without a reviewer and a date.

More: [model contracts](model-contract.html) · [architecture](docs/architecture.md) ·
[performance](docs/performance.md) · [colophon](colophon.html) ·
[changelog](CHANGELOG.md)

## Conventions

See [docs/architecture.md](docs/architecture.md) — stack rules, the visualisation module contract, the validated colour
palette, and how to add a topic page.

## Licence

Content CC BY 4.0. Code MIT.
# SIPI
