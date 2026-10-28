import { useEffect, useState } from 'react';
import { stick } from '../game/touch';
import { editor } from '../house/editor';
import { setZoom, uiStore, useUi } from '../store';

/** How far the knob travels from the base, in CSS px. */
const RADIUS = 44;
/** Below this the thumb is resting (or tapping), not steering. */
const DEAD_ZONE = 10;
/** Fingers spreading or pinching by this ratio step the zoom once. */
const PINCH_STEP = 1.3;

interface Knob {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Touch screens: put a thumb down anywhere on the world and drag to walk; a joystick appears
 * under it and its base follows a thumb that wanders off. Two fingers pinch to zoom. Plain taps
 * still reach the game (whisper to a player, place furniture).
 */
export function TouchStick() {
  const touch = useUi((s) => s.touch);
  const [knob, setKnob] = useState<Knob | null>(null);

  useEffect(() => {
    if (!touch) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let stickId: number | null = null;
    let base = { x: 0, y: 0 };
    let pinchFrom: number | null = null;

    const spread = () => {
      const [a, b] = [...fingers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const release = () => {
      stickId = null;
      stick.x = 0;
      stick.y = 0;
      setKnob(null);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof HTMLCanvasElement)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) {
        release();
        pinchFrom = spread();
        return;
      }
      const ui = uiStore.get();
      if (fingers.size === 1 && !ui.focus && !editor.get().active) {
        stickId = e.pointerId;
        base = { x: e.clientX, y: e.clientY };
      }
    };

    const onMove = (e: PointerEvent) => {
      const finger = fingers.get(e.pointerId);
      if (!finger) return;
      finger.x = e.clientX;
      finger.y = e.clientY;
      if (pinchFrom !== null && fingers.size === 2) {
        const now = spread();
        const ratio = now / pinchFrom;
        if (ratio > PINCH_STEP || ratio < 1 / PINCH_STEP) {
          setZoom(uiStore.get().zoom + (ratio > 1 ? 1 : -1));
          pinchFrom = now;
        }
        return;
      }
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - base.x;
      let dy = e.clientY - base.y;
      let len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        // Drag the base along so steering back the other way responds at once.
        base = { x: e.clientX - (dx / len) * RADIUS, y: e.clientY - (dy / len) * RADIUS };
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
        len = RADIUS;
      }
      if (len < DEAD_ZONE) {
        stick.x = 0;
        stick.y = 0;
        return;
      }
      // Eight directions, with wider straight sectors than diagonal ones so walking along a
      // path doesn't drift.
      const nx = dx / len;
      const ny = dy / len;
      stick.x = Math.abs(nx) > 0.5 ? Math.sign(nx) : 0;
      stick.y = Math.abs(ny) > 0.5 ? Math.sign(ny) : 0;
      setKnob({ x: base.x, y: base.y, dx, dy });
    };

    const onUp = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size < 2) pinchFrom = null;
      if (e.pointerId === stickId) release();
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      release();
    };
  }, [touch]);

  if (!knob) return null;
  return (
    <div className="stick" style={{ left: knob.x, top: knob.y }} aria-hidden="true">
      <span className="stick-knob" style={{ transform: `translate(${knob.dx}px, ${knob.dy}px)` }} />
    </div>
  );
}
