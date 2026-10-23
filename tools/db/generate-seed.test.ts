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

  it('has 30–50 indoor items (the brief) plus garden items, unique ids, sprites in sheets', () => {
    const indoor = CATALOG.filter((i) => i.category !== 'garden');
    expect(indoor.length).toBeGreaterThanOrEqual(30);
    expect(indoor.length).toBeLessThanOrEqual(50);
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const item of CATALOG) {
      const sheet = SPRITE_SHEETS[item.sprite.sheet];
      expect((item.sprite.x + item.sprite.w) * 16).toBeLessThanOrEqual(sheet.width);
      expect((item.sprite.y + item.sprite.h) * 16).toBeLessThanOrEqual(sheet.height);
      expect(parseSpriteKey(spriteKey(item.sprite))).toEqual(item.sprite);
    }
  });

  it('draws furniture as wide as its footprint and at least as tall', () => {
    for (const item of CATALOG) {
      if (item.category === 'wall' || item.category === 'floor') continue;
      expect(item.sprite.w, item.id).toBe(item.size.w);
      expect(item.sprite.h, item.id).toBeGreaterThanOrEqual(item.size.h);
      expect(item.size.w * item.size.h, item.id).toBeGreaterThan(0);
      if (item.layer === 'wall' || item.layer === 'surface') expect(item.size.h, item.id).toBe(1);
    }
  });

  it('keeps prices in the ranges from the brief', () => {
    for (const item of CATALOG) {
      if (item.category === 'furniture') expect(item.price).toBeGreaterThanOrEqual(150);
      if (item.category === 'furniture') expect(item.price).toBeLessThanOrEqual(400);
      if (item.category === 'wall' || item.category === 'floor') expect(item.price).toBe(200);
      if (item.category === 'plant') expect(item.price).toBeLessThanOrEqual(80);
      if (item.category === 'garden') expect(item.price).toBeGreaterThanOrEqual(60);
      if (item.category === 'garden') expect(item.price).toBeLessThanOrEqual(400);
      // Small decor is 40–80; rugs are big decor and may cost a little more.
      if (item.category === 'decor' && item.layer !== 'rug') {
        expect(item.price).toBeGreaterThanOrEqual(40);
        expect(item.price).toBeLessThanOrEqual(80);
      }
    }
  });
});
