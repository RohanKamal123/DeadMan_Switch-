// The operator console (UX_SPEC.md §3; DECISIONS.md 10.x). It is the surface
// through which humans drive verification. The pivot to manual operations
// changes what FIRES the machine's events (an operator action) — not the
// transition table or the invariants (DECISIONS.md 10.4).
//
// The console adds structural guardrails on top of the machine:
//   - a confirmation's group is read from the enrolled roster, never typed by
//     the operator, so group diversity (invariant 4) cannot be faked;
//   - only a consented, non-stale confirmer can be recorded (1.3 / 4.3);
//   - there is no field anywhere to attach a link, a code, or content to
//     outreach — the console records outcomes, not messages (invariant 6);
//   - every view, note, and entry is written to the audit log as metadata only
//     (invariant 7). Free-text notes live in the operational case file, never
//     in the immutable trail (5.3).

import { Machine } from '../domain/machine';
import type { TransitionResult } from '../domain/transition';
import type { ContactState } from '../domain/states';
import type { Confirmation } from '../domain/quorum';
import { canRecordConfirmation, type Contact } from './contacts';
import {
  holdStartReadiness,
  quorumMeter,
  recipientEligibility,
  type HoldReadinessView,
  type QuorumMeterView,
  type RecipientEligibilityView,
} from './quorum-meter';

export type ConsoleResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface CaseNote {
  readonly text: string;
  readonly operatorId: string;
  readonly at: number;
}

export interface ContactCase {
  state: ContactState | null;
  readonly notes: CaseNote[];
  viewCount: number;
}

export interface OperatorConsoleOptions {
  readonly machine: Machine;
  readonly contacts: readonly Contact[];
  readonly recipientOrder?: readonly string[];
}

function mapResult(result: TransitionResult): ConsoleResult {
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export class OperatorConsole {
  readonly machine: Machine;
  private readonly roster: Map<string, Contact>;
  readonly recipientOrder: readonly string[];

  // Operational case file — NOT the audit trail. Holds working state tags and
  // free-text notes (5.3 keeps these out of the immutable, metadata-only log).
  private readonly cases = new Map<string, ContactCase>();
  private readonly overall: { state: ContactState | null; notes: CaseNote[] } = {
    state: null,
    notes: [],
  };

  constructor(options: OperatorConsoleOptions) {
    this.machine = options.machine;
    this.roster = new Map(options.contacts.map((c) => [c.id, c]));
    this.recipientOrder = options.recipientOrder ?? [];
  }

  get state() {
    return this.machine.state;
  }

  // --- reads ----------------------------------------------------------------

  contact(contactId: string): Contact | undefined {
    return this.roster.get(contactId);
  }

  caseFor(contactId: string): ContactCase {
    let existing = this.cases.get(contactId);
    if (existing === undefined) {
      existing = { state: null, notes: [], viewCount: 0 };
      this.cases.set(contactId, existing);
    }
    return existing;
  }

  overallState(): ContactState | null {
    return this.overall.state;
  }

  quorumMeter(): QuorumMeterView {
    return quorumMeter(this.machine.context.confirmations);
  }

  holdReadiness(): HoldReadinessView {
    const ctx = this.machine.context;
    return holdStartReadiness({
      state: ctx.state,
      confirmations: ctx.confirmations,
      dependencyHealthOk: ctx.dependencyHealthOk,
      adminFrozen: ctx.adminFrozen,
    });
  }

  recipientEligibility(recipientId: string): RecipientEligibilityView {
    return recipientEligibility(this.machine.context.confirmations, recipientId);
  }

  // --- audited operator actions that are not state transitions --------------

  viewContact(contactId: string, operatorId: string, at: number): ConsoleResult {
    const c = this.roster.get(contactId);
    if (c === undefined) return { ok: false, reason: `unknown contact ${contactId}` };
    this.caseFor(contactId).viewCount += 1;
    this.machine.audit.append({
      at,
      kind: 'CONTEXT',
      event: 'VIEW_CONTACT',
      actor: operatorId,
      metadata: { contactId },
    });
    return { ok: true };
  }

  recordNote(
    contactId: string | null,
    text: string,
    operatorId: string,
    at: number,
  ): ConsoleResult {
    const note: CaseNote = { text, operatorId, at };
    if (contactId === null) {
      this.overall.notes.push(note);
    } else {
      if (!this.roster.has(contactId)) return { ok: false, reason: `unknown contact ${contactId}` };
      this.caseFor(contactId).notes.push(note);
    }
    // Only metadata is logged — the note text stays in the operational case file.
    this.machine.audit.append({
      at,
      kind: 'CONTEXT',
      event: 'RECORD_NOTE',
      actor: operatorId,
      metadata:
        contactId === null
          ? { scope: 'overall', noteLength: text.length }
          : { contactId, noteLength: text.length },
    });
    return { ok: true };
  }

  recordContactState(
    contactId: string,
    state: ContactState,
    operatorId: string,
    at: number,
  ): ConsoleResult {
    if (!this.roster.has(contactId)) return { ok: false, reason: `unknown contact ${contactId}` };
    this.caseFor(contactId).state = state;
    this.machine.audit.append({
      at,
      kind: 'CONTEXT',
      event: 'RECORD_CONTACT_STATE',
      actor: operatorId,
      metadata: { contactId, contactState: state },
    });
    return { ok: true };
  }

  recordOverallState(state: ContactState, operatorId: string, at: number): ConsoleResult {
    this.overall.state = state;
    this.machine.audit.append({
      at,
      kind: 'CONTEXT',
      event: 'RECORD_OVERALL_STATE',
      actor: operatorId,
      metadata: { contactState: state },
    });
    return { ok: true };
  }

  /**
   * Admin-assisted re-verification of a stale contact (DECISIONS.md 4.3):
   * updates contact details ONLY and clears the stale flag. It never records a
   * confirmation — that remains a separate, deliberate action.
   */
  reVerifyContact(
    contactId: string,
    adminId: string,
    at: number,
    updates: { email?: string; phone?: string },
  ): ConsoleResult {
    const c = this.roster.get(contactId);
    if (c === undefined) return { ok: false, reason: `unknown contact ${contactId}` };
    const updated: Contact = {
      ...c,
      stale: false,
      ...(updates.email !== undefined ? { email: updates.email } : {}),
      ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
    };
    this.roster.set(contactId, updated);
    const updatedFields = Object.keys(updates).sort().join(',');
    this.machine.audit.append({
      at,
      kind: 'CONTEXT',
      event: 'REVERIFY_CONTACT',
      actor: adminId,
      metadata: { contactId, updatedFields },
    });
    return { ok: true };
  }

  // --- operator actions that fire a state transition ------------------------

  /**
   * Record a death confirmation toward quorum. The GROUP is taken from the
   * enrolled roster — the operator cannot supply one — so group diversity
   * cannot be manufactured (invariant 4). Consent/stale/role are gated here
   * before the event ever reaches the machine.
   */
  recordConfirmation(contactId: string, operatorId: string, at: number): ConsoleResult {
    const c = this.roster.get(contactId);
    if (c === undefined) return { ok: false, reason: `unknown contact ${contactId}` };
    const eligibility = canRecordConfirmation(c);
    if (!eligibility.ok) {
      return { ok: false, reason: eligibility.reason ?? 'contact cannot be confirmed' };
    }
    const confirmation: Confirmation = {
      contactId: c.id,
      group: c.group,
      recordingOperatorId: operatorId,
      at,
    };
    return mapResult(this.machine.apply({ type: 'RECORD_CONFIRMATION', at, confirmation }));
  }

  recordWithdrawal(contactId: string, operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'WITHDRAW_CONFIRMATION', at, contactId }));
  }

  startHold(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'START_HOLD', at, operatorId }));
  }

  markStalled(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'MARK_STALLED', at, operatorId }));
  }

  reopenVerification(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'REOPEN_VERIFICATION', at, operatorId }));
  }

  uploadCertificate(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'UPLOAD_DEATH_CERTIFICATE', at, operatorId }));
  }

  triggerPrivateRelease(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'TRIGGER_PRIVATE_RELEASE', at, operatorId }));
  }

  triggerPublicRelease(operatorId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'TRIGGER_PUBLIC_RELEASE', at, operatorId }));
  }

  setDependencyHealth(ok: boolean, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'SET_DEPENDENCY_HEALTH', at, ok }));
  }

  adminFreeze(adminId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'ADMIN_FREEZE', at, adminId }));
  }

  adminUnfreeze(adminId: string, at: number): ConsoleResult {
    return mapResult(this.machine.apply({ type: 'ADMIN_UNFREEZE', at, adminId }));
  }
}
