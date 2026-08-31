// The public memorial page — the destination public release publishes to. This
// is the one surface meant for the open internet, so it is indexable; it is also
// the most solemn, so it carries no product chrome, no upsell, and no nav. Just a
// name, a line, and the passages that were set aside to be published.

import { page, escapeHtml } from './design';
import type { MemorialDocument } from '../memorial/document';

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

export function renderMemorialPage(doc: MemorialDocument): string {
  const header = `<header class="masthead"><div class="wrap bar"><span class="brand"><span class="mark">LV</span>In memoriam</span></div></header>`;
  const blocks = doc.blocks
    .map((b) =>
      b.kind === 'passage'
        ? `<p class="serif" style="font-size:1.2rem;line-height:1.7">${escapeHtml(b.text)}</p>`
        : `<p class="quiet">${escapeHtml(b.text)}</p>`,
    )
    .join('');
  const body = [
    '<section class="wrap measure" style="padding:4rem 0 3rem">',
    '<div class="eyebrow">In memoriam</div>',
    `<h1 style="font-size:clamp(2.4rem,6vw,3.6rem)">${escapeHtml(doc.displayName)}</h1>`,
    doc.epitaph === undefined ? '' : `<p class="lede">${escapeHtml(doc.epitaph)}</p>`,
    '<hr>',
    blocks === '' ? '<p class="quiet">A memorial was published here.</p>' : blocks,
    `<p class="quiet" style="margin-top:2.4rem;font-size:.85rem">Published ${escapeHtml(fmtDate(doc.publishedAt))} · arranged in advance through Legacy Vault.</p>`,
    '</section>',
  ].join('');
  return page(
    { surface: 'public', title: `${doc.displayName} — In memoriam`, description: `A memorial for ${doc.displayName}.`, indexable: true, header, footer: false },
    body,
  );
}

export function renderMemorialNotFoundPage(): string {
  return page(
    { surface: 'public', title: 'Memorial not found', footer: false },
    [
      '<section class="wrap measure" style="padding:4rem 0">',
      '<div class="eyebrow">In memoriam</div>',
      '<h1>This memorial isn’t here</h1>',
      '<div class="panel"><p style="margin:0">The link may be mistyped, or nothing has been published at this address.</p></div>',
      '</section>',
    ].join(''),
  );
}
