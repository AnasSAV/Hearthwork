/** Front-facing idle frame of an avatar from characters.png, scaled up crisply. */
export function AvatarSprite({ body, scale = 4 }: { body: number; scale?: number }) {
  const size = 16 * scale;
  return (
    <span
      className="avatar-sprite"
      style={{
        width: size,
        height: size,
        backgroundSize: `${64 * scale}px ${288 * scale}px`,
        // Each avatar uses 3 rows of 16px; column 0 = facing down, row 0 = idle.
        backgroundPosition: `0px -${body * 48 * scale}px`,
      }}
    />
  );
}
