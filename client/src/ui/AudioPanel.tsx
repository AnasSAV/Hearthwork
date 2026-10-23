import { useState } from 'react';
import { AMBIENT_LABEL, AMBIENT_SOUNDS, ambient, useAmbient } from '../audio/ambient';
import { radio, useRadio } from '../audio/radio';

/** Radio (synced for everyone) and ambient sounds (your own mix). */
export function AudioPanel() {
  const [open, setOpen] = useState(false);
  const playing = useRadio((s) => s.playing);
  const track = useRadio((s) => s.track);
  const volume = useRadio((s) => s.volume);
  const error = useRadio((s) => s.error);
  const levels = useAmbient();

  return (
    <div className="audio">
      <button
        type="button"
        className="panel audio-toggle"
        onClick={() => {
          setOpen(!open);
          if (!open) void ambient.resume();
        }}
        title="Radio and ambience"
      >
        {playing ? '♪ ' : '♫ '}
        {playing && track ? track.title : 'Sounds'}
      </button>
      {open && (
        <div className="panel audio-panel">
          <div className="audio-row">
            <button
              type="button"
              className="btn"
              onClick={() => (playing ? radio.stop() : void radio.play())}
            >
              {playing ? 'Pause radio' : 'Play radio'}
            </button>
            <div className="now-playing">
              {track ? (
                <>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </>
              ) : (
                <small>Lofi radio, in sync with everyone in town</small>
              )}
            </div>
          </div>
          <label className="slider">
            <span>Radio</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => radio.setVolume(Number(e.target.value))}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <h3 className="drawer-group">Ambience</h3>
          {AMBIENT_SOUNDS.map((s) => (
            <label key={s} className="slider">
              <span>{AMBIENT_LABEL[s]}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={levels[s]}
                onChange={(e) => void ambient.setVolume(s, Number(e.target.value))}
              />
            </label>
          ))}
          <p className="fine-print">Tip: with sound playing, pick audio-only when you focus.</p>
        </div>
      )}
    </div>
  );
}
