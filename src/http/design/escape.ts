// Shared, dependency-free HTML escaping for every rendered surface. Kept in its
// own tiny module so the design system and the page renderers can share it
// without an import cycle (pages.ts historically owned it and still re-exports
// it for compatibility).

/** Minimal HTML-attribute/text escaping. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
