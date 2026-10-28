import { describe, expect, it } from 'vitest';
import { suggestUsername } from './username.js';

describe('suggestUsername', () => {
  it('turns a display name into a valid username', () => {
    expect(suggestUsername('Anas Hussaindeen')).toBe('anas_hussaindeen');
    expect(suggestUsername('  Zoë   O’Brien ')).toBe('zoe_o_brien');
  });

  it('keeps it within 16 characters without a trailing underscore', () => {
    expect(suggestUsername('Maximilian Alexander')).toBe('maximilian_alexa');
    expect(suggestUsername('abcdefghijklmno pq')).toBe('abcdefghijklmno');
  });

  it('falls back to the email when the name is unusable', () => {
    expect(suggestUsername('李', 'study.buddy+tag@gmail.com')).toBe('study_buddy_tag');
    expect(suggestUsername(undefined, 'jo@x.io')).toBe('');
  });

  it('returns an empty string when nothing fits', () => {
    expect(suggestUsername(null, null)).toBe('');
    expect(suggestUsername('!!', 'ab@x.io')).toBe('');
  });
});
