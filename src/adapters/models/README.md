# `src/adapters/models/` — empty by design (V1)

V1 ships **no AI, no automated voice, and no model dependency of any kind**
(PRODUCT_SPEC.md §8; DECISIONS.md Area 0 / 3.1; CLAUDE.md "No AI vendors in V1").
This directory is scaffolded empty on purpose.

If a model is ever reintroduced post-V1, it enters **only** through an adapter
in this directory:

- **No SDK import lives outside this directory.** Swapping a vendor is a
  one-file change.
- **No model output is ever trusted to make a state decision.** Confirmations,
  quorum, timers, and every transition in `src/domain/` are deterministic code.
  A hallucinating model must never be able to advance the machine toward
  release.

There is nothing to import here yet, and nothing in `src/domain/` depends on
this directory.
