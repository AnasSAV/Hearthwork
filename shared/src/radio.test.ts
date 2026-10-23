import { describe, expect, it } from 'vitest';
import { onAir, type RadioPlaylist } from './radio.js';

const track = (id: string, durationSec: number) => ({
  id,
  title: id,
  artist: 'x',
  src: `synth:${id}`,
  durationSec,
  license: 'CC0',
});
const playlist: RadioPlaylist = {
  startedAt: '2026-01-01T00:00:00Z',
  tracks: [track('a', 100), track('b', 50), track('c', 150)],
};
const start = Date.parse(playlist.startedAt);

describe('onAir', () => {
  it('finds the track and offset from the shared start time', () => {
    expect(onAir(playlist, start)).toEqual({ index: 0, offsetSec: 0 });
    expect(onAir(playlist, start + 99_000)).toEqual({ index: 0, offsetSec: 99 });
    expect(onAir(playlist, start + 120_000)).toEqual({ index: 1, offsetSec: 20 });
    expect(onAir(playlist, start + 160_000)).toEqual({ index: 2, offsetSec: 10 });
  });

  it('loops the playlist forever', () => {
    expect(onAir(playlist, start + 300_000 * 7 + 120_000)).toEqual({ index: 1, offsetSec: 20 });
  });

  it('works for clocks before the start time', () => {
    expect(onAir(playlist, start - 10_000)).toEqual({ index: 2, offsetSec: 140 });
  });
});
