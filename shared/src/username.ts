import { usernameSchema } from './schemas.js';

/**
 * A username to pre-fill for a new player, from what their sign-in provider knows (a Google
 * display name, or the part of their email before the @). Returns '' when nothing usable is
 * left, so the field just starts empty. Only a suggestion: the server still validates and the
 * name may already be taken.
 */
export function suggestUsername(name?: string | null, email?: string | null): string {
  for (const source of [name, email?.split('@')[0]]) {
    if (!source) continue;
    const candidate = source
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // é → e
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16)
      .replace(/_+$/, '');
    if (usernameSchema.safeParse(candidate).success) return candidate;
  }
  return '';
}
