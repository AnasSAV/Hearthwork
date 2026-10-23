import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG, parseSpriteKey, spriteKey, SPRITE_SHEETS } from '../../shared/src/catalog.js';
import { seedSql } from './generate-seed.js';

describe('item catalog', () => {
  it('supabase/seed.sql is up to date (run `npm run seed:items`)', () => {
    const seed = readFileSync(
      fileURLToPath(new URL('../../supabase/seed.sql', import.meta.url)),
      'utf8',
    );
    expect(seed).toBe(seedSql());
  });

  it('has 30–50 items with unique ids and sprites inside their sheets', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(30);
    expect(CATALOG.length).toBeLessThanOrEqual(50);
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const item of CATALOG) {
      const sheet = SPRITE_SHEETS[item.sprite.sheet];
      expect((item.sprite.x + item.sprite.w) * 16).toBeLessThanOrEqual(sheet.width);
      expect((item.sprite.y + item.sprite.h) * 16).toBeLessThanOrEqual(sheet.height);
      expect(parseSpriteKey(spriteKey(item.sprite))).toEqual(item.sprite);
    }
  });

  it('keeps prices in the ranges from the brief', () => {
    for (const item of CATALOG) {
      if (item.category === 'furniture') expect(item.price).toBeGreaterThanOrEqual(150);
      if (item.category === 'furniture') expect(item.price).toBeLessThanOrEqual(400);
      if (item.category === 'wall' || item.category === 'floor') expect(item.price).toBe(200);
      if (item.category === 'plant') expect(item.price).toBeLessThanOrEqual(80);
      // Small decor is 40–80; rugs are big decor and may cost a little more.
      if (item.category === 'decor' && item.layer !== 'rug') {
        expect(item.price).toBeGreaterThanOrEqual(40);
        expect(item.price).toBeLessThanOrEqual(80);
      }
    }
  });
});
