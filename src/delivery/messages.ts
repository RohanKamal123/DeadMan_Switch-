// Delivery channel messages. The SHAPES enforce invariant 6 structurally:
// there is no field on an email that could carry a code or content, and no
// field on an SMS that could carry a link or content (PRODUCT_SPEC.md §7;
// DECISIONS.md 4.2). Content appears only at the gated page, after both the
// link and the code are presented.

/** Email carries ONLY a link to the gated page. No content, no attachment, no code. */
export interface GatedEmail {
  readonly channel: 'email';
  readonly to: string;
  readonly gatedLink: string;
}

/** SMS carries ONLY the one-time code, to the same person on a separate channel. */
export interface CodeSms {
  readonly channel: 'sms';
  readonly to: string;
  readonly code: string;
}

export type DeliveryMessage = GatedEmail | CodeSms;
