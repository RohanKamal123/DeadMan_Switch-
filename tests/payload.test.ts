// Phase C Payload schema (DECISIONS.md 9.1 / 11.5; UX_SPEC.md §1.4).
//
// The schema fixes the SHAPE of stored content (kinds, encryption envelope,
// addressing, versioning, the HOLD freeze rule). Numeric size limits are a
// DEPLOYMENT decision (DECISIONS.md 11.5 remains open) and are supplied as a
// ContentPolicy — never invented inside the domain.

import {
  validatePayload,
  isAddressed,
  isComplete,
  isEditable,
  editPayload,
  type Payload,
  type ContentPolicy,
  PayloadFrozenError,
} from '../src/domain/payload';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 100_000, photo: 10_000_000, pdf: 25_000_000 },
  allowedMimeTypes: {
    note: ['text/plain', 'text/markdown'],
    photo: ['image/jpeg', 'image/png'],
    pdf: ['application/pdf'],
  },
};

function note(overrides: Partial<Payload> = {}): Payload {
  return {
    id: 'p-1',
    kind: 'note',
    mimeType: 'text/plain',
    byteSize: 42,
    envelope: {
      algorithm: 'AES-256-GCM',
      keyId: 'kms-key-1',
      encryptedDataKey: 'd2hhdGV2ZXI=',
      iv: 'aXYtYmFzZTY0',
      ciphertext: 'Y2lwaGVydGV4dA==',
      version: 1,
    },
    recipientIds: ['r-1'],
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('payload schema', () => {
  it('accepts a well-formed note within policy', () => {
    expect(validatePayload(note(), POLICY)).toEqual({ ok: true, errors: [] });
  });

  it('rejects content that exceeds the supplied size limit', () => {
    const r = validatePayload(note({ byteSize: 200_000 }), POLICY);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/size/i);
  });

  it('rejects a disallowed mime type for the kind', () => {
    const r = validatePayload(note({ mimeType: 'application/zip' }), POLICY);
    expect(r.ok).toBe(false);
  });

  it('rejects a payload whose encryption envelope has no ciphertext (never store plaintext)', () => {
    const r = validatePayload(
      note({ envelope: { ...note().envelope, ciphertext: '' } }),
      POLICY,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ciphertext|encrypt/i);
  });

  it('flags an unaddressed item as incomplete', () => {
    const p = note({ recipientIds: [] });
    expect(isAddressed(p)).toBe(false);
    expect(isComplete(p, POLICY)).toBe(false);
  });

  it('a well-formed, addressed item is complete', () => {
    expect(isComplete(note(), POLICY)).toBe(true);
  });

  it('is editable while the account is not release-pending', () => {
    expect(isEditable('ACTIVE')).toBe(true);
    expect(isEditable('NUDGE')).toBe(true);
    expect(isEditable('VERIFYING')).toBe(true);
    expect(isEditable('STALLED')).toBe(true);
  });

  it('is frozen once a hold is running or content is released (UX §1.4)', () => {
    expect(isEditable('HOLD')).toBe(false);
    expect(isEditable('PRIVATE_RELEASE')).toBe(false);
    expect(isEditable('PUBLIC_RELEASE')).toBe(false);
  });

  it('editPayload bumps the version and updatedAt while editable', () => {
    const p = note({ version: 1, updatedAt: 1 });
    const edited = editPayload(p, { byteSize: 50 }, 'ACTIVE', 1234);
    expect(edited.version).toBe(2);
    expect(edited.updatedAt).toBe(1234);
    expect(edited.byteSize).toBe(50);
  });

  it('editPayload throws when the vault is frozen (HOLD)', () => {
    const p = note();
    expect(() => editPayload(p, { byteSize: 50 }, 'HOLD', 1234)).toThrow(PayloadFrozenError);
  });
});
