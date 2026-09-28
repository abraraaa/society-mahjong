'use client';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Holds a box at the tallest it has been, for as long as it's mounted, so that
 * shorter words in it don't move what's above it. A bottom sheet grows upwards:
 * when its line gets shorter, its heading drops. The exchange sheet's line goes
 * from the tutor's words to "Passed. Waiting for …" and back to the next
 * pass's words, and its heading and Pass button must stay put through all of
 * it. Measured before paint on every render, so the box never shows at the
 * shorter height first. A new width (the phone turned) lets go and measures
 * again, since the words wrap differently.
 */
export function useHeldHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const held = useRef({ width: -1, height: 0 });
  const hold = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth !== held.current.width) {
      el.style.minHeight = '';
      held.current = { width: el.clientWidth, height: 0 };
    }
    const height = el.getBoundingClientRect().height;
    if (height > held.current.height) {
      held.current.height = height;
      el.style.minHeight = `${height}px`;
    }
  }, []);
  useLayoutEffect(hold);
  useEffect(() => {
    window.addEventListener('resize', hold);
    return () => window.removeEventListener('resize', hold);
  }, [hold]);
  return ref;
}
