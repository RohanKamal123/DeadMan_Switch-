// Phase F — the operator application service (DECISIONS_PHASE_F_G.md F2).
//
// The tier that drives the operator console over persisted state. For a given
// account it loads the machine (WITH its durable audit sink), the contact
// roster, and the operational case file from the Phase D repositories,
// constructs an `OperatorConsole`, runs one action, and persists BOTH the
// machine snapshot and the case file.
//
// It adds NO logic of its own. Every guardrail already lives in the console and
// the machine: the confirmation group is read from the roster so group diversity
// (invariant 4) cannot be faked, consent/stale gates apply, START_HOLD stays
// blocked until quorum (10.2), STALLED never advances (invariant 5), and every
// action is logged as metadata only (invariant 7). A rejected console action
// leaves the account untouched (fail safe) — this service just reports it.

import { OperatorConsole, type ConsoleResult, type HoldReadinessView, type QuorumMeterView } from '../console';
import type { ContactState, State } from '../domain/states';
import type { CaseFileRepository, ContactRepository, MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';

export interface OperatorServiceOptions {
  readonly machines: MachineRepository;
  readonly contacts: ContactRepository;
  readonly caseFiles: CaseFileRepository;
  /** Durable, per-account audit sink so every operator action is logged (invariant 7). */
  readonly auditFor: AuditSinkFactory;
}

export type OperatorActionResult =
  | { readonly ok: true; readonly state: State; readonly quorum: QuorumMeterView }
  | { readonly ok: false; readonly reason: string };

export interface OperatorCaseView {
  readonly state: State;
  readonly quorum: QuorumMeterView;
  readonly holdReadiness: HoldReadinessView;
}

export class OperatorService {
  private readonly machines: MachineRepository;
  private readonly contacts: ContactRepository;
  private readonly caseFiles: CaseFileRepository;
  private readonly auditFor: AuditSinkFactory;

  constructor(options: OperatorServiceOptions) {
    this.machines = options.machines;
    this.contacts = options.contacts;
    this.caseFiles = options.caseFiles;
    this.auditFor = options.auditFor;
  }

  /** Load a console over the persisted state for one account, plus a persist closure. */
  private open(accountId: string): { console: OperatorConsole; persist: () => void } | undefined {
    const machine = this.machines.load(accountId, this.auditFor(accountId));
    if (machine === undefined) return undefined;
    const console = new OperatorConsole({ machine, contacts: this.contacts.forAccount(accountId) });
    const snapshot = this.caseFiles.get(accountId);
    if (snapshot !== undefined) console.restoreCaseFile(snapshot);
    const persist = (): void => {
      this.machines.save(accountId, machine);
      this.caseFiles.save(accountId, console.exportCaseFile());
    };
    return { console, persist };
  }

  /** Run one console action and, on success, persist the machine + case file. */
  private act(accountId: string, action: (console: OperatorConsole) => ConsoleResult): OperatorActionResult {
    const opened = this.open(accountId);
    if (opened === undefined) return { ok: false, reason: 'account not found' };
    const result = action(opened.console);
    if (!result.ok) return { ok: false, reason: result.reason };
    opened.persist();
    return { ok: true, state: opened.console.state, quorum: opened.console.quorumMeter() };
  }

  // --- audited operator actions (not state transitions) ---------------------

  viewContact(accountId: string, contactId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.viewContact(contactId, operatorId, at));
  }

  recordContactState(
    accountId: string,
    contactId: string,
    state: ContactState,
    operatorId: string,
    at: number,
  ): OperatorActionResult {
    return this.act(accountId, (c) => c.recordContactState(contactId, state, operatorId, at));
  }

  recordNote(
    accountId: string,
    contactId: string | null,
    text: string,
    operatorId: string,
    at: number,
  ): OperatorActionResult {
    return this.act(accountId, (c) => c.recordNote(contactId, text, operatorId, at));
  }

  // --- operator actions that fire a guarded transition ----------------------

  recordConfirmation(accountId: string, contactId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.recordConfirmation(contactId, operatorId, at));
  }

  recordWithdrawal(accountId: string, contactId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.recordWithdrawal(contactId, operatorId, at));
  }

  startHold(accountId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.startHold(operatorId, at));
  }

  markStalled(accountId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.markStalled(operatorId, at));
  }

  reopenVerification(accountId: string, operatorId: string, at: number): OperatorActionResult {
    return this.act(accountId, (c) => c.reopenVerification(operatorId, at));
  }

  // --- reads ----------------------------------------------------------------

  /** A read-only view of the case: state, quorum meter, and why HOLD can/can't start. */
  snapshot(accountId: string): OperatorCaseView | undefined {
    const opened = this.open(accountId);
    if (opened === undefined) return undefined;
    return {
      state: opened.console.state,
      quorum: opened.console.quorumMeter(),
      holdReadiness: opened.console.holdReadiness(),
    };
  }
}
