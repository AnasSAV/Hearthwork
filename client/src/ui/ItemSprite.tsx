import { parseSpriteKey, SPRITE_SHEETS } from '@focus-town/shared';

/**
 * Draws a catalog item's sprite (a rectangle of tiles from one of the tilesets), scaled by an
 * integer factor so the pixel art stays crisp and fits in a `box`×`box` square.
 */
export function ItemSprite({ spriteKey, box = 64 }: { spriteKey: string; box?: number }) {
  const rect = parseSpriteKey(spriteKey);
  if (!rect) return <span className="item-sprite" style={{ width: box, height: box }} />;
  const sheet = SPRITE_SHEETS[rect.sheet];
  // Leave a little padding so small items don't fill the box edge to edge.
  const scale = Math.max(1, Math.min(4, Math.floor((box - 8) / (Math.max(rect.w, rect.h) * 16))));
  return (
    <span className="item-sprite-box" style={{ width: box, height: box }}>
      <span
        className="item-sprite"
        style={{
          width: rect.w * 16 * scale,
          height: rect.h * 16 * scale,
          backgroundImage: `url(/${sheet.url})`,
          backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
          backgroundPosition: `-${rect.x * 16 * scale}px -${rect.y * 16 * scale}px`,
        }}
      />
    </span>
  );
}
