import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AVATAR_PART_IDS } from '../../shared/src/avatarParts.js';

it('update_profile range checks match the generated avatar parts', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261023000005_avatars_v2.sql', import.meta.url),
    'utf8',
  );
  for (const [part, ids] of Object.entries(AVATAR_PART_IDS)) {
    expect(sql).toContain(`('${part}', ${part === 'acc' ? -1 : 0}, ${ids.length - 1})`);
  }
});
