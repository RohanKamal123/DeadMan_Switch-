// Phase E — runtime & scheduler (DECISIONS.md §12 Phase E).
//
// The pure planner (`due`) decides what timer event is due; the senders wire the
// notification cadence to channels; the scheduler is the worker that ticks over
// persisted state, firing events through the guarded `transition` only. The
// domain stays pure — the worker adds reliability, never a new decision.

export * from './due';
export * from './senders';
export * from './scheduler';
export * from './driver';
