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

## Model and vendor split
- Speech in and out (STT and TTS for the outreach calls): Gemini API.
- All other model work (drafting notification copy, summarizing, any
  reasoning inside the product): DeepSeek v4.
- Every model call goes through an adapter in `src/adapters/models/`.
  No SDK import anywhere outside that directory. Swapping a vendor must
  be a one-file change.
- Both are external dependencies and both are covered by the weekly
  health checks in spec §6.
- Hard rule: no model output is ever trusted to make a state decision.
  Models generate speech and text. Quorum, timers, and transitions are
  deterministic code only. A hallucinating model must never be able to
  advance the machine toward release.

## Working style
- Never introduce a timer, threshold, or delay not specified in the spec.
  If the spec is silent, stop and ask.
- Every state transition goes through one guarded function. No ad-hoc
  status writes anywhere in the codebase.
- Tests before implementation for anything touching the state machine.
- If a requested change would break an invariant, say so and stop.
