import { UI_FRAMES, UI_SHEET } from './uiSprites';

/** A frame from the LimeZu UI atlas (emote bubbles, timer, typing dots), scaled crisply. */
export function UiSprite({ frame, scale = 2 }: { frame: string; scale?: number }) {
  const f = UI_FRAMES[frame];
  if (!f) return null;
  const [x, y, w, h] = f;
  return (
    <span
      className="ui-sprite"
      style={{
        width: w * scale,
        height: h * scale,
        backgroundImage: `url(${UI_SHEET.url})`,
        backgroundSize: `${UI_SHEET.width * scale}px ${UI_SHEET.height * scale}px`,
        backgroundPosition: `-${x * scale}px -${y * scale}px`,
      }}
    />
  );
}
