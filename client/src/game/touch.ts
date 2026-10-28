import { uiStore } from '../store';

/**
 * Touch play: the on-screen joystick's direction (read by the scenes every frame, like the
 * movement keys) and the "use" action that the E key and the tappable prompts share.
 */
export const stick = { x: 0, y: 0 };

let interactHandler: (() => void) | null = null;

/** The active world scene registers what "use" (E) does there; null when it shuts down. */
export function setInteract(handler: (() => void) | null): void {
  interactHandler = handler;
}

/** Use whatever is in front of you: the E key, or a tap on a prompt. */
export function interact(): void {
  interactHandler?.();
}

/**
 * Follow how the game is being played, so prompts show "E" for a keyboard and taps for touch.
 * A coarse pointer means touch at first; after that the last pointer used decides (a laptop
 * with a touch screen switches back and forth).
 */
export function watchInputKind(): () => void {
  const onPointer = (e: PointerEvent) => {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (uiStore.get().touch !== touch) uiStore.set({ touch });
  };
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  return () => window.removeEventListener('pointerdown', onPointer, { capture: true });
}
