// The legal layer. Plain-language, human-written documents in the shared design
// system — Terms, Privacy, a Data Processing Addendum, a Cookie Policy, the
// wills-and-trustees estate advisory the product spec insists must ship (not be
// deferred), and the sub-processor list. They are honest about the one thing
// most products hide: in V1 the company holds the keys and can decrypt to
// release (DECISIONS.md 8.1). Launch jurisdiction is Bangladesh (DECISIONS.md
// 1.1). None of this is legal advice, and the estate page says so.

import { page, eyebrow } from './design';

const UPDATED = '31 August 2026';

interface Section {
  readonly n: string;
  readonly h: string;
  /** Pre-rendered inner HTML (paragraphs, lists). */
  readonly body: string;
}

function legalDoc(slug: string, title: string, description: string, intro: string, sections: readonly Section[]): string {
  const rows = sections
    .map((s) => `<div class="doc-section"><div class="n">${s.n}</div><div><h2>${s.h}</h2>${s.body}</div></div>`)
    .join('');
  return page(
    { surface: 'public', title: `${title} — Legacy Vault`, description, indexable: true },
    [
      '<section class="wrap" style="padding:3.2rem 0;max-width:48rem">',
      eyebrow('Legal · ' + slug),
      `<h1>${title}</h1>`,
      `<p class="quiet" style="margin-top:-.4rem">Last updated ${UPDATED} · Governing law: Bangladesh</p>`,
      `<p class="lede">${intro}</p>`,
      '<div style="margin-top:1.4rem">',
      rows,
      '</div>',
      '<p class="quiet" style="margin-top:2rem;font-size:.85rem">Questions about this document: <a href="mailto:legal@legacyvault.example">legal@legacyvault.example</a>.</p>',
      '</section>',
    ].join(''),
  );
}

const p = (t: string): string => `<p class="quiet" style="margin:0 0 .9em">${t}</p>`;
const ul = (items: readonly string[]): string =>
  `<ul class="quiet" style="margin:0 0 .9em;padding-left:1.1rem">${items.map((i) => `<li style="margin:.3rem 0">${i}</li>`).join('')}</ul>`;

export function renderTermsPage(): string {
  return legalDoc('Terms', 'Terms of Service', 'The agreement between you and Legacy Vault.', 'These terms govern your use of Legacy Vault. The product does one deliberately narrow thing — it releases content you stored, to people you chose, only if a human team and a deterministic cancel window both conclude you have died. Read the security and estate advisory pages too; they carry the parts that matter most.', [
    { n: '1', h: 'What the service does', body: p('You store encrypted content and name the people who may receive it. If you stop responding to check-ins, our team attempts to verify what has happened. Content is released only after three independent confirmations and a cancel window that you can stop at any moment.') + p('The service is not a substitute for a will, a lawyer, or an executor. See the <a href="/legal/estate">estate advisory</a>.') },
    { n: '2', h: 'Being wrong is worse than being slow', body: p('Every safeguard is tuned to avoid releasing while you are alive, even at the cost of releasing late. You accept that a genuine release may be delayed — by design — and that the cancel path always takes priority over the release path.') },
    { n: '3', h: 'Your responsibilities', body: ul(['Keep your contact details and your recipients current.', 'Respond to check-ins, or use the cancel link if a process starts in error.', 'Only store content you have the right to share.', 'Name your trustees in a legally valid will — the product cannot compel a registrar or a trustee to act.']) },
    { n: '4', h: 'Accounts and recovery', body: p('Recovery is deliberately manual: a person verifies your identity before any reset, so no attacker can reset their way into your account and force a release. This is slower on purpose.') },
    { n: '5', h: 'Payment', body: p('Paid plans are billed monthly through our payment processor. A lapse or downgrade never deletes your content or alters a release you already configured; it only limits new set-up actions. You can cancel anytime from the billing portal.') },
    { n: '6', h: 'Acceptable use', body: p('You may not use the service to store unlawful content, to harass or endanger a named recipient, or to release material you have no right to distribute. We may freeze an account on a credible fraud or legal-hold report; a freeze only ever delays release.') },
    { n: '7', h: 'Disclaimers and liability', body: p('The service is provided as-is. To the extent permitted by law, we are not liable for indirect or consequential loss. Nothing here excludes liability that cannot lawfully be excluded.') },
    { n: '8', h: 'Changes', body: p('We will give notice of material changes to these terms. Continued use after a change means you accept it.') },
  ]);
}

export function renderPrivacyPage(): string {
  return legalDoc('Privacy', 'Privacy Policy', 'What we collect, why, and for how long.', 'We collect the minimum needed to run a safety-critical service, and we say plainly where your trust actually rests.', [
    { n: '1', h: 'What we collect', body: ul(['Account data: your email, phone, and password hash.', 'Your people: names, groups, and contact details for confirmers and recipients, with their consent timestamps.', 'Your content: stored as ciphertext.', 'Operational metadata: check-ins, state transitions, and outreach outcomes, kept as an immutable, metadata-only log — never your content, a URL, or an access code.']) },
    { n: '2', h: 'Encryption, and who holds the keys', body: p('Content is stored under envelope encryption. In V1 this is <strong>not</strong> end-to-end: our team holds the keys and can decrypt in order to release. We state this openly because it is the residual risk you are accepting in exchange for human verification and recovery. See <a href="/security">Security &amp; data</a>.') },
    { n: '3', h: 'How we use it', body: p('Only to operate the service: track liveness, verify death, and deliver content. We do not sell data, and we run no advertising or third-party tracking.') },
    { n: '4', h: 'Retention', body: ul(['After a release, private delivery material is purged 30 days later.', 'If you delete your account, it is soft-deleted for 7 days (recoverable via manual identity check) and then hard-deleted.', 'The immutable audit log retains metadata only, indefinitely, and never your content.']) },
    { n: '5', h: 'Your rights', body: p('You may access, correct, export, or delete your personal data, subject to the retention rules above and to the immutable audit trail (which holds no content). Contact <a href="mailto:privacy@legacyvault.example">privacy@legacyvault.example</a>.') },
    { n: '6', h: 'Sub-processors', body: p('We use a small set of vendors for email, SMS, storage, and payments. See the <a href="/legal/subprocessors">sub-processor list</a>.') },
  ]);
}

export function renderDpaPage(): string {
  return legalDoc('DPA', 'Data Processing Addendum', 'For customers who need a processor agreement.', 'This addendum applies where Legacy Vault processes personal data on your behalf. It supplements the Terms of Service.', [
    { n: '1', h: 'Roles', body: p('You are the controller of the personal data you enter about your contacts and recipients; Legacy Vault is the processor, acting on your documented instructions (the Terms and your in-app configuration).') },
    { n: '2', h: 'Processing scope', body: p('We process the categories of data in the Privacy Policy, for the sole purpose of operating the release service, for the duration of your account plus the retention windows.') },
    { n: '3', h: 'Security measures', body: ul(['Envelope encryption of content at rest.', 'An append-only, tamper-evident audit trail (metadata only).', 'Structural channel separation so no channel carries content it should not.', 'Manual, audited account recovery.']) },
    { n: '4', h: 'Sub-processors', body: p('We maintain the <a href="/legal/subprocessors">sub-processor list</a> and will give notice before adding one, giving you a reasonable window to object.') },
    { n: '5', h: 'Breach notification', body: p('We will notify you without undue delay after becoming aware of a personal-data breach affecting your data, with the information you need to meet your own obligations.') },
    { n: '6', h: 'Deletion and return', body: p('On termination we delete or return personal data per the retention rules, except metadata retained in the immutable audit log, which contains no content.') },
  ]);
}

export function renderCookiePage(): string {
  return legalDoc('Cookies', 'Cookie Policy', 'The one cookie we set, and the local storage we use.', 'We keep this short because there is little to say.', [
    { n: '1', h: 'Strictly-necessary session cookie', body: p('When you sign in, we set a single session cookie so the app knows it is you. It is HttpOnly, scoped to this site, and is removed when you sign out. Without it you could not stay signed in.') },
    { n: '2', h: 'Local storage', body: p('Your browser’s local storage remembers your light/dark theme and whether you have dismissed this cookie note. It never leaves your device and is not sent to us.') },
    { n: '3', h: 'What we do not use', body: p('No advertising cookies, no analytics cookies, no third-party trackers, no cross-site pixels.') },
  ]);
}

export function renderEstatePage(): string {
  return legalDoc('Estate', 'Wills & trustees advisory', 'The legal step the software cannot do for you.', 'This is advisory only and is not legal advice. It exists because the likeliest way this whole arrangement fails is not a software bug — it is a silent trustee or a locked registrar. Please read it and then speak to a qualified professional in your jurisdiction.', [
    { n: '1', h: 'Name your people in a valid will', body: p('Software can hold your messages and release them carefully. It cannot grant anyone legal authority over your accounts, your property, or your remains. Only a legally valid will (or the equivalent instrument where you live) can do that. Name the same people you trust here as trustees or beneficiaries there.') },
    { n: '2', h: 'Grant your executor authority over digital assets', body: p('Give your executor explicit, written authority over your digital assets and accounts. Without it, a registrar or platform can lawfully refuse to act, and content can be stranded regardless of how well this product works.') },
    { n: '3', h: 'Keep the two in step', body: p('If you change your recipients here, revisit your will. If you change your will, revisit your recipients here. Drift between the two is the most common real-world failure, which is why our quarterly drill repeats this reminder.') },
    { n: '4', h: 'This is not legal advice', body: p('Every jurisdiction differs, and Bangladesh — our launch jurisdiction — has its own succession practice. Please consult a qualified lawyer. Legacy Vault does not draft, store, or execute legal instruments.') },
  ]);
}

export function renderSubprocessorsPage(): string {
  return legalDoc('Sub-processors', 'Sub-processors', 'The vendors that help us run the service.', 'We keep this list current and give notice before adding a vendor that touches personal data.', [
    { n: '1', h: 'Categories', body: ul(['Email delivery — transactional email to you and your contacts.', 'SMS delivery — one-time codes and reminders.', 'Encrypted storage — ciphertext at rest.', 'Payments — subscription billing (card data never touches our servers).', 'Cloud hosting — compute and database.']) },
    { n: '2', h: 'Where they run', body: p('We prefer providers that let us keep data in-region for our launch jurisdiction. Specific vendor names and regions are provided to customers under the DPA on request.') },
  ]);
}

/** Route table for the legal surface: path → rendered page. */
export const LEGAL_PAGES: Readonly<Record<string, () => string>> = {
  '/legal/terms': renderTermsPage,
  '/legal/privacy': renderPrivacyPage,
  '/legal/dpa': renderDpaPage,
  '/legal/cookies': renderCookiePage,
  '/legal/estate': renderEstatePage,
  '/legal/subprocessors': renderSubprocessorsPage,
};
