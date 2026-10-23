/** Synced radio: every client derives the same track and offset from the shared clock. */
export interface RadioTrack {
  id: string;
  title: string;
  artist: string;
  /** "synth:<seed>" (generated in the browser) or a path to a license-cleared audio file. */
  src: string;
  durationSec: number;
  license: string;
}

export interface RadioPlaylist {
  /** ISO time the station started; position = (now - startedAt) mod total length. */
  startedAt: string;
  tracks: RadioTrack[];
}

export function onAir(p: RadioPlaylist, nowMs: number): { index: number; offsetSec: number } {
  const total = p.tracks.reduce((sum, t) => sum + t.durationSec, 0);
  if (total <= 0) return { index: 0, offsetSec: 0 };
  const elapsed = (nowMs - Date.parse(p.startedAt)) / 1000;
  let pos = ((elapsed % total) + total) % total;
  for (let index = 0; index < p.tracks.length; index++) {
    const d = p.tracks[index]!.durationSec;
    if (pos < d) return { index, offsetSec: pos };
    pos -= d;
  }
  return { index: 0, offsetSec: 0 };
}
