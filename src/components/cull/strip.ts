// A sideways strip of cells — the filmstrip, the row of scenes — that only
// makes the cells in view.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** How far either side of what is in view cells are kept, in pixels. */
const MARGIN = 1500;

/**
 * Works out which cells of a strip exist, and keeps one of them in the
 * middle of it.
 *
 * `starts` is where each cell begins, with where the last one stops on the
 * end; `pad` the space after that. `position` is the cell to keep centred
 * (below nought for none) and `anchor` what it stands for: while that stays
 * the same the strip may be scrolled away by hand and is left where it is
 * put, and when it changes the strip comes back.
 *
 * Give the scroller an isolated stacking context (`isolate`). WebKitGTK can
 * otherwise promote the entire wide content row to a graphics layer because
 * it overlaps composited photo/face previews. Isolation bounds that layer;
 * it does not by itself prevent all native paint corruption.
 *
 * This is done here and not by a list library because the strip has to be
 * scrolled and redrawn in ONE step. The library learned where a strip was
 * from the scroll event that follows a scroll — a frame later at best, and
 * in a busy view a good deal later — and until it heard, the cells drawn
 * were the ones for where the strip used to be. MEASURED: after a jump the
 * filmstrip stood empty for over 400 ms. It also answered "where is this
 * cell" from positions worked out before the widths last changed, for one
 * render after they did; the filmstrip's widths change every time the scan
 * finds which photos are one pose, and MEASURED, every second such change
 * left the photo in the loupe hundreds of pixels off centre — far enough
 * into a folder, off the strip altogether.
 */
export function useStrip({ starts, pad, position, anchor }: { starts: ArrayLike<number>; pad: number; position: number; anchor: unknown }) {
  const count = starts.length - 1;
  const length = starts[count] + pad;
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  // Back to the middle when the cell to show changes, and when the cells
  // before it change width or the window does — unless the strip has been
  // scrolled along by hand to look at something else.
  const strayed = useRef(false);
  const anchored = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    if (anchored.current !== anchor) strayed.current = false;
    anchored.current = anchor;
    const el = scroller.current;
    if (!el || position < 0 || position >= count || strayed.current || width <= 0) return;
    const middle = (starts[position] + starts[position + 1]) / 2;
    const target = Math.round(Math.max(0, Math.min(length - width, middle - width / 2)));
    if (Math.abs(el.scrollLeft - target) >= 1) el.scrollLeft = target;
    setOffset(el.scrollLeft);
  }, [position, anchor, starts, count, length, width]);

  // The cells in view and a margin either side, so that a scroll by hand
  // has cells waiting wherever it gets to before the next render.
  const [from, to] = useMemo(() => {
    const [low, high] = [offset - MARGIN, offset + width + MARGIN];
    let [a, b] = [0, count];
    while (a < b) {
      const mid = (a + b) >> 1;
      if (starts[mid + 1] > low) b = mid;
      else a = mid + 1;
    }
    const first = a;
    b = count;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (starts[mid] < high) a = mid + 1;
      else b = mid;
    }
    return [first, a];
  }, [offset, width, starts, count]);

  // Native scrolling can paint before React's batched continuous events
  // commit, especially with two photo canvases. Commit the next cells before
  // returning to the browser, but keep the margin so small scrolls are free.
  const committedOffset = useRef(offset);
  useLayoutEffect(() => { committedOffset.current = offset; }, [offset]);
  const followScroll = useCallback((at: number) => {
    if (Math.abs(at - committedOffset.current) > MARGIN / 3) flushSync(() => setOffset(at));
  }, []);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    followScroll(e.currentTarget.scrollLeft);
  };

  // React delegates wheel events through a passive listener. Mapping those
  // events while also allowing WebKit's default wheel handling gives native
  // scrolling and our virtual row competing owners. A non-passive listener
  // consumes the event once, retaining high-resolution fractional deltas.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let desired = el.scrollLeft;
    let applied = desired;
    const onWheel = (e: WheelEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      strayed.current = true;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY * 1.5;
      // Some web views quantize scrollLeft. Accumulate subpixel input rather
      // than discarding it on every event; a scrollbar drag or recenter resets
      // the accumulator to the new actual position.
      if (el.scrollLeft !== applied) desired = el.scrollLeft;
      desired = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, desired + delta * unit));
      el.scrollLeft = desired;
      applied = el.scrollLeft;
      // Cover the destination before returning control to native painting.
      followScroll(el.scrollLeft);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [followScroll]);

  return { scroller, length, from, to, onScroll };
}
