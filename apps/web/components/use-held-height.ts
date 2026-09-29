'use client';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Holds a box at the tallest it has been, for as long as it's mounted, so that
 * shorter words in it don't move what's above it. A bottom sheet grows upwards:
 * when its line gets shorter, its heading drops. The exchange sheet's line goes
 * from the tutor's words to "Passed. Waiting for …" and back to the next
 * pass's words, and its heading and Pass button must stay put through all of
 * it. Measured before paint on every render, so the box never shows at the
 * shorter height first.
 *
 * A new width (the phone turned) wraps the words differently, so the box is
 * measured again there, and held at the taller of: the tallest it has been at
 * that width before, and the tallest words it has held, laid out afresh at the
 * new width. Turned while the short wait line shows, the sheet stays as tall as
 * the pass's words, so the next pass's words don't grow it.
 */
export function useHeldHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const held = useRef({ width: -1, height: 0, byWidth: new Map<number, number>(), tallest: null as HTMLElement | null });
  const hold = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const h = held.current;
    const width = el.clientWidth;
    if (width !== h.width) {
      h.width = width;
      h.height = Math.max(h.byWidth.get(width) ?? 0, h.tallest ? heightAt(h.tallest, el) : 0);
      el.style.minHeight = h.height > 0 ? `${h.height}px` : '';
    }
    const height = el.getBoundingClientRect().height;
    if (height > h.height) {
      h.height = height;
      h.tallest = el.cloneNode(true) as HTMLElement;
      el.style.minHeight = `${height}px`;
    }
    h.byWidth.set(width, h.height);
  }, []);
  useLayoutEffect(hold);
  useEffect(() => {
    window.addEventListener('resize', hold);
    return () => window.removeEventListener('resize', hold);
  }, [hold]);
  return ref;
}

/**
 * How tall `words` (a copy of the box, taken when it was at its tallest) would be in `box`'s place now. The copy goes
 * in beside the box for a moment, unseen and at the box's width, so the same styles reach it; it's gone before paint.
 */
function heightAt(words: HTMLElement, box: HTMLElement): number {
  words.setAttribute('aria-hidden', 'true');
  Object.assign(words.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', minHeight: '', width: `${box.getBoundingClientRect().width}px` });
  box.after(words);
  const height = words.getBoundingClientRect().height;
  words.remove();
  return height;
}
