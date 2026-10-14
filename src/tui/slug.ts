const SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,98}[a-zA-Z0-9])?$/;

/**
 * Strips a pasted skool.com URL (or a path within one) down to the bare slug,
 * and trims whitespace. Users are told to enter "the part after skool.com/",
 * but pasting the whole URL is common enough to normalize rather than reject.
 */
export function normalizeSlug(input: string): string {
  let value = input.trim();
  value = value.replace(/^https?:\/\//i, '');
  value = value.replace(/^(www\.)?skool\.com\//i, '');
  const slashIndex = value.indexOf('/');
  if (slashIndex !== -1) value = value.slice(0, slashIndex);
  return value;
}

export function isValidSlug(input: string): boolean {
  return SLUG_RE.test(input);
}
