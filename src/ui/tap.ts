import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Knopfdruck, der auch dann ankommt, wenn der Browser das click-Ereignis verschluckt.
 * Auf dem iPhone kommt bei einem Tap, den die Textauswahl abfängt, manchmal nur
 * pointerdown/pointerup an. Für die wichtigsten Lernaktionen (umdrehen, bewerten,
 * antworten) reicht click allein darum nicht. Erfahrung aus der Offly-App.
 */
export function useTap<E extends HTMLElement = HTMLElement>(handler: () => void) {
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const handledAt = useRef(0);
  const fire = () => {
    handledAt.current = Date.now();
    handler();
  };
  return {
    onPointerDown: (e: ReactPointerEvent<E>) => {
      if (e.pointerType === 'mouse') return;
      down.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp: (e: ReactPointerEvent<E>) => {
      const d = down.current;
      down.current = null;
      if (!d || e.pointerType === 'mouse') return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved < 12 && Date.now() - d.t < 700) fire();
    },
    onClick: () => {
      // Der Tap wurde schon über pointerup ausgelöst: das nachfolgende click ignorieren.
      if (Date.now() - handledAt.current < 600) return;
      fire();
    },
  };
}
