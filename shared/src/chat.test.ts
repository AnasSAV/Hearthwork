import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LEN, cleanChatText, filterProfanity } from './chat.js';

describe('filterProfanity', () => {
  it('masks swear words, including longer forms and l33t spellings', () => {
    expect(filterProfanity('what the fuck')).toBe('what the ****');
    expect(filterProfanity('this is FUCKING great')).toBe('this is ******* great');
    expect(filterProfanity('sh1t happens')).toBe('**** happens');
    expect(filterProfanity('f.u.c.k off')).toBe('******* off');
    expect(filterProfanity('fuuuuck')).toBe('*******');
  });

  it('leaves innocent words alone', () => {
    for (const ok of [
      'cocktail party',
      'Dickens novels',
      'Scunthorpe',
      'assassin',
      'classic',
      'peacock',
    ]) {
      expect(filterProfanity(ok)).toBe(ok);
    }
  });

  it('masks short words only when they stand alone', () => {
    expect(filterProfanity('what a dick')).toBe('what a ****');
    expect(filterProfanity('dicks')).toBe('*****');
  });
});

describe('cleanChatText', () => {
  it('trims, collapses whitespace and strips invisible characters', () => {
    expect(cleanChatText('  hi \n\n there\u200b  ')).toBe('hi there');
  });

  it('caps the length', () => {
    expect(cleanChatText('x'.repeat(500))).toHaveLength(CHAT_MAX_LEN);
  });
});
