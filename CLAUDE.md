# Project: Legacy Vault

Posthumous message delivery. Read PRODUCT_SPEC.md before any task.

## The one rule
A false positive (releasing while the user is alive) is catastrophic and
irreversible. A false negative (releasing late) is cheap. When any design
question is ambiguous, choose the slower, more conservative path.

## Invariants — never violate, never "optimize away"
1. CANCELLED is reachable from every state, unconditionally, with no
   grace period or point of no return.
2. No third party is contacted before day 30.
3. No content is released before a HOLD window has fully elapsed.
4. No two quorum confirmations may come from the same trustee group.
5. STALLED never auto-advances toward release.
6. No content, URL, or access code is ever spoken on a phone call.
7. Every outreach attempt and state transition is logged immutably.

## No AI vendors in V1
- V1 ships **no AI, no automated voice, and no automated calling**. There
  is no Gemini, no DeepSeek, and no model dependency of any kind. See
  DECISIONS.md Area 0 for the pivot.
- Verification and outreach are performed **manually by the operator team**
  through the operator console. All user-facing copy (NUDGE reminders,
  cancel prompts) uses **static, human-written templates** — a template
  cannot hallucinate.
- If AI is ever reintroduced post-V1, it goes through an adapter in
  `src/adapters/models/` (no SDK import outside that directory; swapping a
  vendor is a one-file change), and this hard rule binds it: **no model
  output is ever trusted to make a state decision.** Confirmations, quorum,
  timers, and transitions are deterministic code only. A hallucinating
  model must never be able to advance the machine toward release.

## Working style
- Never introduce a timer, threshold, or delay not specified in the spec.
  If the spec is silent, stop and ask.
- Every state transition goes through one guarded function. No ad-hoc
  status writes anywhere in the codebase.
- Tests before implementation for anything touching the state machine.
- If a requested change would break an invariant, say so and stop.
